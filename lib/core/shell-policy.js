/**
 * Shell command policy: pstack's git and irreversible-action rules as a pure
 * classifier. The host wires `deny` to `ctx.tools.guard()` and `ask` to the
 * approval seam; this module never touches the harness.
 *
 * This guards against habitual slips by a cooperating agent. It is not a
 * security boundary: an alias, a script file, or an encoded command passes.
 *
 * Rule sources in pstack:
 *   git-add-all, git-commit-all  playbooks/hillclimb.md step 5
 *                                ("`git add <files>`, never `-A`")
 *   force-push                   poteto-mode/SKILL.md Autonomy ("Always pause"),
 *                                playbooks/babysit.md ("Never rebase, retarget,
 *                                or force-push")
 *   draft-pr                     poteto-mode/worker.md ("never as a draft")
 *   deploy                       poteto-mode/SKILL.md Autonomy ("deploys")
 */
export const DEFAULT_SHELL_POLICY = {
    protectedBranches: ['main', 'master', 'trunk', 'develop', 'release'],
    forbidForcePush: false,
    askPatterns: [
        '^(npm|pnpm|yarn|bun) publish\\b',
        '^cargo publish\\b',
        '^terraform (apply|destroy)\\b',
        '^kubectl (apply|delete|replace)\\b',
        '^gh release create\\b',
    ],
};
const ALLOW = { kind: 'allow' };
const OPERATORS = new Set(['&&', '||', ';', '|', '&', '\n', '(', ')', '`']);
const MAX_REGEX_INPUT = 4096;
/** Compile a user-supplied regex safely without throwing on malformed syntax. */
export function safeRegExp(source) {
    try {
        return new RegExp(source);
    }
    catch {
        return undefined;
    }
}
function extractBalancedDollarParen(input, openIndex) {
    let depth = 1;
    let quote;
    let i = openIndex;
    while (i < input.length && depth > 0) {
        const ch = input[i];
        if (quote === "'") {
            if (ch === "'")
                quote = undefined;
        }
        else if (quote === '"') {
            if (ch === '\\' && i + 1 < input.length)
                i += 1;
            else if (ch === '"')
                quote = undefined;
        }
        else {
            if (ch === "'" || ch === '"')
                quote = ch;
            else if (ch === '\\' && i + 1 < input.length)
                i += 1;
            else if (ch === '(')
                depth += 1;
            else if (ch === ')') {
                depth -= 1;
                if (depth === 0)
                    return { inner: input.slice(openIndex, i), endIndex: i };
            }
        }
        i += 1;
    }
    return { inner: input.slice(openIndex), endIndex: input.length - 1 };
}
/**
 * Lex a command line into typed tokens (`word`, `op`, `redir`) plus any command
 * substitutions (`$(...)` or backticks) embedded inside double-quoted strings.
 */
export function lexShell(input) {
    const tokens = [];
    const embeddedScripts = [];
    let word = '';
    let hasWord = false;
    let quote;
    const flush = () => {
        if (hasWord)
            tokens.push({ kind: 'word', value: word });
        word = '';
        hasWord = false;
    };
    for (let i = 0; i < input.length; i += 1) {
        const ch = input[i];
        if (quote === "'") {
            if (ch === "'")
                quote = undefined;
            else
                word += ch;
            continue;
        }
        if (quote === '"') {
            if (ch === '"') {
                quote = undefined;
            }
            else if (ch === '\\' && i + 1 < input.length) {
                i += 1;
                word += input[i];
            }
            else if (ch === '$' && input[i + 1] === '(') {
                const sub = extractBalancedDollarParen(input, i + 2);
                embeddedScripts.push(sub.inner);
                word += `$(${sub.inner})`;
                i = sub.endIndex;
            }
            else if (ch === '`') {
                let end = i + 1;
                while (end < input.length && input[end] !== '`') {
                    if (input[end] === '\\' && end + 1 < input.length)
                        end += 2;
                    else
                        end += 1;
                }
                const inner = input.slice(i + 1, end);
                embeddedScripts.push(inner);
                word += `\`${inner}\``;
                i = end;
            }
            else {
                word += ch;
            }
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            hasWord = true;
            continue;
        }
        if (ch === '#') {
            if (!hasWord) {
                while (i < input.length && input[i] !== '\n')
                    i += 1;
                tokens.push({ kind: 'op', value: '\n' });
                continue;
            }
        }
        if (ch === '\\' && i + 1 < input.length) {
            i += 1;
            if (input[i] !== '\n') {
                word += input[i];
                hasWord = true;
            }
            continue;
        }
        if (ch === ' ' || ch === '\t' || ch === '\r') {
            flush();
            continue;
        }
        const two = input.slice(i, i + 2);
        if (two === '&&' || two === '||') {
            flush();
            tokens.push({ kind: 'op', value: two });
            i += 1;
            continue;
        }
        if (two === '$(') {
            flush();
            tokens.push({ kind: 'op', value: '(' });
            i += 1;
            continue;
        }
        // Output redirections (`>`, `>>`, `>|`, `&>`, `&>>`, `1>`, `2>`, etc.)
        if (!hasWord && (ch === '>' || (ch === '&' && input[i + 1] === '>'))) {
            let redir = ch;
            if (ch === '&') {
                redir = input.slice(i, input[i + 2] === '>' ? i + 3 : i + 2);
                i += redir.length - 1;
            }
            else if (input[i + 1] === '>' || input[i + 1] === '|' || input[i + 1] === '&') {
                redir = input.slice(i, i + 2);
                i += 1;
            }
            tokens.push({ kind: 'redir', value: redir });
            continue;
        }
        if (hasWord && /^[0-9]+$/.test(word) && ch === '>') {
            const fd = word;
            word = '';
            hasWord = false;
            let redir = `${fd}>`;
            if (input[i + 1] === '>' || input[i + 1] === '|' || input[i + 1] === '&') {
                redir += input[i + 1];
                i += 1;
            }
            tokens.push({ kind: 'redir', value: redir });
            continue;
        }
        if (OPERATORS.has(ch)) {
            flush();
            tokens.push({ kind: 'op', value: ch });
            continue;
        }
        word += ch;
        hasWord = true;
    }
    flush();
    return { tokens, embeddedScripts };
}
/**
 * Split a command line into words and operators. Quotes group, backslash
 * escapes, `$(` and backticks open a nested command that is checked too.
 */
export function tokenize(input) {
    return lexShell(input).tokens.map((t) => t.value);
}
/** Group tokens into simple commands, dropping operators and redirect targets while preserving quoted operators. */
export function simpleCommands(input) {
    const { tokens, embeddedScripts } = lexShell(input);
    const commands = [];
    let current = [];
    for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i];
        if (token.kind === 'op') {
            if (current.length > 0)
                commands.push(current);
            current = [];
        }
        else if (token.kind === 'redir') {
            // Skip the redirection target word if not an fd dup like `>&2`
            if (!token.value.endsWith('&') && tokens[i + 1]?.kind === 'word') {
                i += 1;
            }
        }
        else {
            current.push(token.value);
        }
    }
    if (current.length > 0)
        commands.push(current);
    for (const sub of embeddedScripts) {
        commands.push(...simpleCommands(sub));
    }
    return commands;
}
const WRAPPERS = new Set([
    'sudo',
    'env',
    'command',
    'exec',
    'time',
    'nohup',
    'nice',
    'xargs',
    'builtin',
    'timeout',
    'stdbuf',
    'caffeinate',
]);
const WRAPPER_VALUE_FLAGS = {
    sudo: new Set(['-u', '-g', '-C', '-D', '-R', '-T', '-p', '-r', '-t']),
    env: new Set(['-u', '-C', '-S']),
    nice: new Set(['-n']),
    timeout: new Set(['-k', '-s', '--kill-after', '--signal']),
    xargs: new Set(['-I', '-L', '-n', '-P', '-s', '-d', '-a']),
    stdbuf: new Set(['-i', '-o', '-e']),
};
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Drop leading `VAR=value` words, wrapper commands, and the wrappers' flags/arguments. */
export function unwrapCommandWords(words) {
    let i = 0;
    for (;;) {
        const word = words[i];
        if (word === undefined)
            break;
        if (ASSIGNMENT.test(word)) {
            i += 1;
            continue;
        }
        if (WRAPPERS.has(word)) {
            const wrapper = word;
            const valFlags = WRAPPER_VALUE_FLAGS[wrapper];
            i += 1;
            while (words[i]?.startsWith('-') === true) {
                const flag = words[i];
                if (flag === '--') {
                    i += 1;
                    break;
                }
                if (valFlags?.has(flag) === true && !flag.includes('=')) {
                    i += 2;
                }
                else {
                    i += 1;
                }
            }
            // `timeout` takes one positional duration token before the wrapped command
            if (wrapper === 'timeout' && words[i] !== undefined) {
                i += 1;
            }
            continue;
        }
        break;
    }
    return words.slice(i);
}
/** Extract candidate file paths mutated by shell redirects or common file-mutating utilities. */
export function shellWriteTargets(input) {
    const { tokens, embeddedScripts } = lexShell(input);
    const targets = new Set();
    const addTarget = (raw) => {
        if (raw === undefined)
            return;
        const trimmed = raw.trim();
        if (trimmed === '' || trimmed.startsWith('-') || trimmed === '/dev/null' || /^&\d+$/.test(trimmed))
            return;
        targets.add(trimmed);
    };
    for (let i = 0; i < tokens.length; i += 1) {
        const tok = tokens[i];
        if (tok.kind === 'redir' && !tok.value.endsWith('&')) {
            if (tokens[i + 1]?.kind === 'word')
                addTarget(tokens[i + 1].value);
        }
    }
    for (const rawWords of simpleCommands(input)) {
        const cmd = unwrapCommandWords(rawWords);
        const head = cmd[0];
        if (head === undefined)
            continue;
        if (SHELLS.has(head)) {
            const flagIndex = cmd.findIndex((w) => /^-[a-zA-Z]*c$/.test(w));
            const script = flagIndex === -1 ? undefined : cmd[flagIndex + 1];
            if (script !== undefined) {
                for (const nested of shellWriteTargets(script))
                    targets.add(nested);
            }
            continue;
        }
        if (head === 'tee' || head === 'touch' || head === 'rm' || head === 'unlink' || head === 'truncate') {
            const { positional } = parseArgs(cmd.slice(1), 's', new Set(['--size', '--reference']));
            for (const p of positional)
                addTarget(p);
        }
        else if (head === 'cp' || head === 'mv' || head === 'install') {
            const { short, long, positional } = parseArgs(cmd.slice(1), 'tS', new Set(['--target-directory', '--suffix']));
            if (short.has('t') || long.has('--target-directory')) {
                const idx = cmd.findIndex((w) => w === '-t' || w === '--target-directory' || w.startsWith('--target-directory='));
                if (idx !== -1) {
                    const opt = cmd[idx];
                    addTarget(opt.includes('=') ? opt.split('=', 2)[1] : cmd[idx + 1]);
                }
            }
            else if (positional.length >= 2) {
                addTarget(positional.at(-1));
                if (head === 'mv') {
                    for (const src of positional.slice(0, -1))
                        addTarget(src);
                }
            }
        }
        else if (head === 'sed' || head === 'perl') {
            const rawRest = cmd.slice(1);
            const inPlace = rawRest.some((w) => w === '-i' || w.startsWith('-i') || w === '--in-place' || w.startsWith('--in-place='));
            if (inPlace) {
                const normalizedRest = [];
                for (let idx = 0; idx < rawRest.length; idx += 1) {
                    const tok = rawRest[idx];
                    normalizedRest.push(tok);
                    // BSD/macOS `sed -i "" 's/a/b/' file` passes a separate backup-extension token after bare `-i`
                    if (head === 'sed' &&
                        tok === '-i' &&
                        rawRest[idx + 1] !== undefined &&
                        !rawRest[idx + 1].startsWith('-') &&
                        rawRest.length - idx > 3) {
                        idx += 1;
                    }
                }
                const { positional } = parseArgs(normalizedRest, 'ef', new Set(['--expression', '--file']));
                // First positional is the script unless `-e` or `-f` was given
                const hasExplicitExpr = normalizedRest.some((w) => w === '-e' || w === '-f' || w.startsWith('--expression') || w.startsWith('--file'));
                const files = hasExplicitExpr ? positional : positional.slice(1);
                for (const f of files)
                    addTarget(f);
            }
        }
        else if (head === 'dd') {
            for (const arg of cmd.slice(1)) {
                if (arg.startsWith('of='))
                    addTarget(arg.slice(3));
            }
        }
    }
    for (const sub of embeddedScripts) {
        for (const nested of shellWriteTargets(sub))
            targets.add(nested);
    }
    return [...targets];
}
/** Git options that come before the subcommand and take a separate value. */
const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']);
function gitSubcommand(words) {
    let i = 1;
    for (;;) {
        const word = words[i];
        if (word === undefined)
            return undefined;
        if (GIT_GLOBAL_WITH_VALUE.has(word))
            i += 2;
        else if (word.startsWith('-'))
            i += 1;
        else
            return { sub: word, args: words.slice(i + 1) };
    }
}
/**
 * Walk the arguments of a command. `valueFlags` names the short flags, and
 * `valueOptions` the long options, whose value is a separate word.
 */
function parseArgs(args, valueFlags, valueOptions) {
    const short = new Set();
    const long = new Set();
    const positional = [];
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--') {
            positional.push(...args.slice(i + 1));
            break;
        }
        if (arg.startsWith('--')) {
            const name = arg.split('=', 1)[0];
            long.add(name);
            if (valueOptions.has(name) && !arg.includes('='))
                i += 1;
            continue;
        }
        if (arg.startsWith('-') && arg.length > 1) {
            for (let j = 1; j < arg.length; j += 1) {
                const flag = arg[j];
                short.add(flag);
                if (valueFlags.includes(flag)) {
                    if (j === arg.length - 1)
                        i += 1;
                    break;
                }
            }
            continue;
        }
        positional.push(arg);
    }
    return { short, long, positional };
}
const WHOLE_TREE = new Set(['.', './', ':/', '*', ':/*', ':(top)']);
function checkGitAdd(args, command) {
    const { short, long, positional } = parseArgs(args, '', new Set(['--chmod', '--pathspec-from-file']));
    const sweeping = short.has('A') || short.has('u') || long.has('--all') || long.has('--update') || long.has('--no-ignore-removal');
    const wholeTree = positional.some((path) => WHOLE_TREE.has(path));
    if ((sweeping && positional.length === 0) || wholeTree) {
        return {
            kind: 'deny',
            rule: 'git-add-all',
            command,
            reason: 'This stages every change in the tree, including files this task did not touch.',
            instead: 'Stage the files you changed by path: git add <file> <file>',
        };
    }
    return ALLOW;
}
function checkGitCommit(args, command) {
    const { short, long } = parseArgs(args, 'mFCct', new Set(['--message', '--file', '--author', '--date', '--reuse-message', '--reedit-message', '--fixup', '--squash', '--template', '--cleanup', '--trailer']));
    if (short.has('a') || long.has('--all')) {
        return {
            kind: 'deny',
            rule: 'git-commit-all',
            command,
            reason: 'commit -a stages every tracked change, including files this task did not touch.',
            instead: 'Stage the files you changed by path, then commit: git add <file> && git commit -m "..."',
        };
    }
    return ALLOW;
}
function pushTargets(refspecs) {
    return refspecs.map((refspec) => {
        const dst = refspec.includes(':') ? refspec.split(':')[1] : refspec;
        return dst.replace(/^\+/, '').replace(/^refs\/heads\//, '');
    });
}
function checkGitPush(args, command, options) {
    const { short, long, positional } = parseArgs(args, 'o', new Set(['--repo', '--push-option', '--receive-pack', '--exec']));
    const refspecs = long.has('--repo') ? positional : positional.slice(1);
    const forcedRefspec = refspecs.some((refspec) => refspec.startsWith('+'));
    const plainForce = short.has('f') || long.has('--force') || long.has('--mirror') || forcedRefspec;
    const leased = long.has('--force-with-lease') || long.has('--force-if-includes');
    if (!plainForce && !leased)
        return ALLOW;
    if (options.forbidForcePush) {
        return {
            kind: 'deny',
            rule: 'force-push',
            command,
            reason: 'The active playbook forbids rebasing, retargeting, and force-pushing.',
            instead: 'Report the conflict or stale base with the branch that needs the rebase, and stop.',
        };
    }
    if (plainForce) {
        return {
            kind: 'ask',
            rule: 'force-push',
            command,
            reason: 'A force push without a lease overwrites remote commits it has not seen. Prefer --force-with-lease.',
        };
    }
    const explicit = pushTargets(refspecs);
    const targets = explicit.length > 0 ? explicit : options.currentBranch === undefined ? [] : [options.currentBranch];
    const protectedTarget = targets.find((branch) => options.protectedBranches.includes(branch));
    if (protectedTarget !== undefined) {
        return {
            kind: 'ask',
            rule: 'force-push',
            command,
            reason: `This rewrites the shared branch "${protectedTarget}".`,
        };
    }
    return ALLOW;
}
function checkGh(words, command) {
    if (words[1] !== 'pr')
        return ALLOW;
    const rest = words.slice(3);
    const draft = (words[2] === 'create' && (rest.includes('--draft') || rest.includes('-d'))) ||
        (words[2] === 'ready' && rest.includes('--undo'));
    if (!draft)
        return ALLOW;
    return {
        kind: 'deny',
        rule: 'draft-pr',
        command,
        reason: 'pstack opens every pull request ready for review, never as a draft.',
        instead: 'Run the same command without the draft flag.',
    };
}
function checkSimple(words, options, asks) {
    const cmd = unwrapCommandWords(words);
    const head = cmd[0];
    if (head === undefined)
        return ALLOW;
    const command = cmd.join(' ');
    if (SHELLS.has(head)) {
        const flagIndex = cmd.findIndex((word) => /^-[a-zA-Z]*c$/.test(word));
        const script = flagIndex === -1 ? undefined : cmd[flagIndex + 1];
        return script === undefined ? ALLOW : classifyShellCommand(script, options);
    }
    if (head === 'git') {
        const git = gitSubcommand(cmd);
        if (git?.sub === 'add')
            return checkGitAdd(git.args, command);
        if (git?.sub === 'commit')
            return checkGitCommit(git.args, command);
        if (git?.sub === 'push')
            return checkGitPush(git.args, command, options);
    }
    if (head === 'gh') {
        const verdict = checkGh(cmd, command);
        if (verdict.kind !== 'allow')
            return verdict;
    }
    const bounded = command.length > MAX_REGEX_INPUT ? command.slice(0, MAX_REGEX_INPUT) : command;
    if (asks.some((pattern) => pattern.test(bounded))) {
        return {
            kind: 'ask',
            rule: 'deploy',
            command,
            reason: 'This publishes or deploys, which pstack treats as irreversible.',
        };
    }
    return ALLOW;
}
/**
 * Classify a whole command line. A deny anywhere wins over an ask, and an ask
 * wins over allow, so one bad link fails the chain.
 */
export function classifyShellCommand(input, options = DEFAULT_SHELL_POLICY) {
    const asks = options.askPatterns.map(safeRegExp).filter((r) => r !== undefined);
    let ask;
    for (const words of simpleCommands(input)) {
        const verdict = checkSimple(words, options, asks);
        if (verdict.kind === 'deny')
            return verdict;
        if (verdict.kind === 'ask' && ask === undefined)
            ask = verdict;
    }
    return ask ?? ALLOW;
}
