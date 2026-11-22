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
/**
 * Split a command line into words and operators. Quotes group, backslash
 * escapes, `$(` and backticks open a nested command that is checked too.
 */
export function tokenize(input) {
    const tokens = [];
    let word = '';
    let hasWord = false;
    let quote;
    const flush = () => {
        if (hasWord)
            tokens.push(word);
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
            if (ch === '"')
                quote = undefined;
            else if (ch === '\\' && i + 1 < input.length) {
                i += 1;
                word += input[i];
            }
            else
                word += ch;
            continue;
        }
        if (ch === "'" || ch === '"') {
            quote = ch;
            hasWord = true;
            continue;
        }
        if (ch === '\\' && i + 1 < input.length) {
            i += 1;
            if (input[i] !== '\n') {
                word += input[i];
                hasWord = true;
            }
            continue;
        }
        if (ch === ' ' || ch === '\t') {
            flush();
            continue;
        }
        const two = input.slice(i, i + 2);
        if (two === '&&' || two === '||') {
            flush();
            tokens.push(two);
            i += 1;
            continue;
        }
        if (two === '$(') {
            flush();
            tokens.push('(');
            i += 1;
            continue;
        }
        if (OPERATORS.has(ch)) {
            flush();
            tokens.push(ch);
            continue;
        }
        word += ch;
        hasWord = true;
    }
    flush();
    return tokens;
}
/** Group tokens into simple commands, dropping the operators between them. */
export function simpleCommands(input) {
    const commands = [];
    let current = [];
    for (const token of tokenize(input)) {
        if (OPERATORS.has(token)) {
            if (current.length > 0)
                commands.push(current);
            current = [];
        }
        else
            current.push(token);
    }
    if (current.length > 0)
        commands.push(current);
    return commands;
}
const WRAPPERS = new Set(['sudo', 'env', 'command', 'exec', 'time', 'nohup', 'nice', 'xargs', 'builtin']);
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
/** Drop leading `VAR=value` words, wrapper commands, and the wrappers' flags. */
function unwrap(words) {
    let i = 0;
    for (;;) {
        const word = words[i];
        if (word === undefined)
            break;
        if (ASSIGNMENT.test(word))
            i += 1;
        else if (WRAPPERS.has(word)) {
            i += 1;
            while (words[i]?.startsWith('-') === true)
                i += 1;
        }
        else
            break;
    }
    return words.slice(i);
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
function pushTargets(positional) {
    return positional.slice(1).map((refspec) => {
        const dst = refspec.includes(':') ? refspec.split(':')[1] : refspec;
        return dst.replace(/^\+/, '').replace(/^refs\/heads\//, '');
    });
}
function checkGitPush(args, command, options) {
    const { short, long, positional } = parseArgs(args, 'o', new Set(['--repo', '--push-option', '--receive-pack', '--exec']));
    const forcedRefspec = positional.slice(1).some((refspec) => refspec.startsWith('+'));
    const plainForce = short.has('f') || long.has('--force') || long.has('--mirror') || forcedRefspec;
    const leased = long.has('--force-with-lease');
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
    const explicit = pushTargets(positional);
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
    const cmd = unwrap(words);
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
    if (asks.some((pattern) => pattern.test(command))) {
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
    const asks = options.askPatterns.map((source) => new RegExp(source));
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
