/**
 * Narrow TypeScript contracts for DeepSeek Harness host services consumed across
 * pstack's rows, plus the vendored catalog loader, subprocess/shell runners,
 * workspace-cwd resolvers, and ignorable session plugin-record helpers.
 *
 * Verified against DeepSeek Harness Desktop `0.2.2-rc.3` and CLI `0.2.2-rc.5`.
 */
var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parsePlaybook } from '../core/playbook.js';
import { parseSkillFile } from '../core/skill-file.js';
const execFileAsync = promisify(execFile);
export const PSTACK_ROW_IDS = new Set([
    'pstack',
    'pstack-skills',
    'pstack-guard',
    'pstack-playbook',
    'pstack-tdd',
    'pstack-ledger',
    'pstack-panel',
    'pstack-bench',
    'pstack-autopilot',
]);
export function buildNoticeMessage(text, summary = 'pstack runtime rule') {
    return Object.freeze({
        id: `msg-pstack-${randomUUID()}`,
        role: 'user',
        content: Object.freeze([Object.freeze({ type: 'text', text })]),
        source: Object.freeze({ kind: 'pstack', form: 'notice', summary }),
        timestamp: Date.now(),
    });
}
export function buildHumanDecisionMessage(text) {
    return Object.freeze({
        id: `msg-user-${randomUUID()}`,
        role: 'user',
        content: Object.freeze([Object.freeze({ type: 'text', text })]),
        source: Object.freeze({ kind: 'user' }),
        timestamp: Date.now(),
    });
}
export function extractSupportedEfforts(info) {
    if (info === undefined)
        return [];
    if (Array.isArray(info.reasoning?.efforts) && info.reasoning.efforts.length > 0) {
        return info.reasoning.efforts.map((e) => e.id).filter(Boolean);
    }
    if (Array.isArray(info.reasoning?.supportedEfforts) && info.reasoning.supportedEfforts.length > 0) {
        return info.reasoning.supportedEfforts;
    }
    if ('reasoningEfforts' in info && Array.isArray(info.reasoningEfforts)) {
        return info.reasoningEfforts;
    }
    return [];
}
export function unwrapGoalSnapshot(view) {
    if (view === undefined || typeof view !== 'object' || view === null)
        return undefined;
    if ('goal' in view && typeof view.goal === 'object' && view.goal !== null) {
        return view.goal;
    }
    if ('id' in view && typeof view.id === 'string') {
        return view;
    }
    return undefined;
}
/** Match a pstack row in `configEditor` by `entry.options.id` first (`entry.id` in Cordis is qualified like `include:pstack-guard`). */
export function findPstackConfigEntry(editor, rowId) {
    if (!PSTACK_ROW_IDS.has(rowId))
        return undefined;
    return (editor.entries().find((entry) => entry.options?.id === rowId) ??
        editor.entries().find((entry) => entry.id === rowId));
}
export function getService(ctx, key) {
    return ctx.get(key);
}
export function sessionOfAgent(agent) {
    if (agent === undefined)
        return undefined;
    const rec = agent;
    return rec.session;
}
export function sessionIdOfAgent(agent) {
    if (agent === undefined)
        return undefined;
    return sessionOfAgent(agent)?.id ?? (agent.id ? String(agent.id) : undefined);
}
export function sessionEventsOfAgent(agent) {
    const session = sessionOfAgent(agent);
    if (session === undefined)
        return [];
    if (typeof session.events === 'function')
        return session.events();
    if (typeof session.ownEvents === 'function')
        return session.ownEvents();
    return [];
}
/** Synchronous best-effort workspace directory for guards (prefers `ctx.workingDirectory.get(session)` and `session.header.cwd`). */
export function cwdOfAgent(agent, ctx) {
    const session = sessionOfAgent(agent);
    if (ctx !== undefined && session !== undefined) {
        const wd = getService(ctx, 'workingDirectory');
        if (wd !== undefined) {
            try {
                const dir = wd.get(session);
                if (typeof dir === 'string' && dir !== '')
                    return dir;
            }
            catch {
                // Fall through to session header / meta.
            }
        }
    }
    return session?.header?.cwd ?? session?.meta?.cwd ?? process.cwd();
}
/** Validated async workspace directory for tool execution (`workingDirectory.ensure(agent, signal)`). */
export async function resolveAgentCwd(ctx, agent, signal) {
    if (agent !== undefined) {
        const wd = getService(ctx, 'workingDirectory');
        if (wd !== undefined && typeof wd.ensure === 'function') {
            try {
                const ensured = await wd.ensure(agent, signal);
                if (typeof ensured === 'string' && ensured !== '')
                    return ensured;
            }
            catch {
                // Synthetic unit-test agents are not registered in `WorkingDirectoryService`; fall back to session header/meta.
            }
        }
    }
    return cwdOfAgent(agent, ctx);
}
/** Look up a live Agent or Session by `sessionId` for client RPC mutations; returns `undefined` if unknown so callers fail closed. */
export async function resolveLiveSessionTarget(ctx, sessionId, signal) {
    if (sessionId === undefined || sessionId.trim() === '')
        return undefined;
    const agentsSvc = getService(ctx, 'agents');
    let agent = agentsSvc?.get?.(sessionId);
    if (agent === undefined && typeof agentsSvc?.list === 'function') {
        for (const candidate of agentsSvc.list()) {
            if (String(candidate.id) === sessionId || sessionOfAgent(candidate)?.id === sessionId) {
                agent = candidate;
                break;
            }
        }
    }
    if (agent !== undefined) {
        const session = sessionOfAgent(agent);
        const cwd = await resolveAgentCwd(ctx, agent, signal);
        return {
            sessionId,
            agent,
            ...(session === undefined ? {} : { session }),
            cwd,
        };
    }
    const sessionsSvc = getService(ctx, 'sessions');
    const session = sessionsSvc?.get?.(sessionId);
    if (session !== undefined) {
        const wd = getService(ctx, 'workingDirectory');
        let cwd = session.header?.cwd ?? session.meta?.cwd;
        if (cwd === undefined && wd !== undefined) {
            try {
                cwd = wd.get(session);
            }
            catch {
                cwd = undefined;
            }
        }
        if (cwd !== undefined && cwd !== '') {
            return { sessionId, session, cwd };
        }
    }
    return undefined;
}
/** Ensure `candidatePath` resolves strictly inside `workspaceRoot` (prevents `..` traversal outside workspace). */
export function resolveInsideWorkspace(workspaceRoot, candidatePath) {
    const rootAbs = resolve(workspaceRoot);
    const targetAbs = isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(rootAbs, candidatePath);
    const rel = relative(rootAbs, targetAbs);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
        return targetAbs;
    }
    return undefined;
}
/**
 * Execute a subprocess using DSH's real `ctx.subprocess.spawn({ argv, cwd, stdio, graceMs, signal })`
 * contract, keeping stdout and stderr separate and draining managed process ranges on timeout/abort.
 */
export async function execSubprocess(ctx, executable, args, cwd, options) {
    const timeoutMs = options?.timeoutMs ?? 60_000;
    const maxBytes = options?.maxBytes ?? 512 * 1024;
    const subprocess = getService(ctx, 'subprocess');
    if (subprocess !== undefined) {
        const controller = new AbortController();
        let timedOut = false;
        const onParentAbort = () => controller.abort();
        options?.signal?.addEventListener('abort', onParentAbort, { once: true });
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, timeoutMs);
        timer.unref?.();
        try {
            const handle = subprocess.spawn({
                argv: [executable, ...args],
                cwd,
                stdio: {
                    stdin: 'ignore',
                    stdout: { maxBytes },
                    stderr: { maxBytes },
                },
                graceMs: 5_000,
                signal: controller.signal,
                ...(options?.env ? { env: options.env } : {}),
            });
            try {
                const outcome = await handle.done;
                const stdout = handle.collected?.stdout?.readFrom(0).text ??
                    outcome.outputs?.stdout?.text ??
                    '';
                const stderr = handle.collected?.stderr?.readFrom(0).text ??
                    outcome.outputs?.stderr?.text ??
                    '';
                if (timedOut) {
                    handle.terminate();
                    await handle.waitForExit?.().catch(() => false);
                }
                return {
                    exitCode: timedOut ? 124 : (outcome.exitCode ?? 1),
                    stdout,
                    stderr,
                    timedOut,
                    spawnFailed: false,
                };
            }
            catch (err) {
                handle.terminate();
                await handle.waitForExit?.().catch(() => false);
                return {
                    exitCode: 127,
                    stdout: '',
                    stderr: err instanceof Error ? err.message : String(err),
                    timedOut,
                    spawnFailed: true,
                };
            }
        }
        catch (err) {
            return {
                exitCode: 127,
                stdout: '',
                stderr: err instanceof Error ? err.message : String(err),
                timedOut,
                spawnFailed: true,
            };
        }
        finally {
            clearTimeout(timer);
            options?.signal?.removeEventListener('abort', onParentAbort);
        }
    }
    try {
        const mergedEnv = options?.env ? { ...process.env, ...options.env } : process.env;
        const { stdout, stderr } = await execFileAsync(executable, [...args], {
            cwd,
            timeout: timeoutMs,
            maxBuffer: maxBytes,
            signal: options?.signal,
            env: mergedEnv,
        });
        return { exitCode: 0, stdout, stderr, timedOut: false, spawnFailed: false };
    }
    catch (err) {
        const e = err;
        const timedOut = Boolean(e.killed && e.signal === 'SIGTERM');
        const spawnFailed = e.code === 'ENOENT' || e.code === 'EACCES';
        return {
            exitCode: typeof e.code === 'number' ? e.code : spawnFailed ? 127 : timedOut ? 124 : 1,
            stdout: e.stdout ?? '',
            stderr: e.stderr ?? e.message ?? '',
            timedOut,
            spawnFailed,
        };
    }
}
/** Execute a shell command via `ctx.shell` when mounted, falling back to `execSubprocess`. */
export async function execShellCommand(ctx, command, cwd, options) {
    const shell = getService(ctx, 'shell');
    if (shell !== undefined && typeof shell.execute === 'function') {
        try {
            const execHandle = await shell.execute({
                command,
                workdir: cwd,
                timeoutMs: options?.timeoutMs ?? 60_000,
                onExpiry: 'kill',
                ...(options?.signal ? { signal: options.signal } : {}),
            });
            const res = await execHandle.result;
            const stdout = res.stdout?.text ?? res.output ?? '';
            const stderr = res.stderr?.text ?? '';
            return {
                exitCode: res.timedOut ? 124 : (res.exitCode ?? 1),
                stdout,
                stderr,
                timedOut: Boolean(res.timedOut),
                spawnFailed: false,
            };
        }
        catch {
            // Fall back to direct subprocess execution if `ctx.shell` requires session-only env context.
        }
    }
    if (process.platform === 'win32') {
        return execSubprocess(ctx, 'pwsh', ['-NoProfile', '-Command', command], cwd, options);
    }
    return execSubprocess(ctx, 'bash', ['-lc', command], cwd, options);
}
let cachedAppendPluginRecord;
/**
 * Append an ignorable `plugin:pstack/event` record to a real DSH Session log so
 * UI actions (`tdd` toggle, `adoptCandidate`, `decideKetchup`) and background
 * patrols (`autopilot` replacements) flow through `ctx.sessionProjections`
 * immediately and survive restart/fork/resume without corrupting session logs.
 */
export async function appendPstackSessionRecord(session, payload) {
    if (session === undefined)
        return false;
    if (typeof session.appendRecord === 'function') {
        try {
            session.appendRecord('plugin:pstack/event', payload);
            return true;
        }
        catch {
            return false;
        }
    }
    if (cachedAppendPluginRecord === undefined) {
        try {
            const mod = (await import(__rewriteRelativeImportExtension('@deepseek-ai/dsh-session')));
            cachedAppendPluginRecord = typeof mod.appendPluginRecord === 'function' ? mod.appendPluginRecord : null;
        }
        catch {
            cachedAppendPluginRecord = null;
        }
    }
    if (cachedAppendPluginRecord !== null) {
        try {
            cachedAppendPluginRecord(session, 'plugin:pstack/event', payload);
            return true;
        }
        catch {
            return false;
        }
    }
    return false;
}
export function modelRouteOfAgent(agent) {
    const m = agent?.model;
    return m?.current?.();
}
export function vendorRootPath() {
    try {
        return fileURLToPath(new URL('../../vendor/pstack', import.meta.url));
    }
    catch {
        return undefined;
    }
}
let cachedCatalog;
export function loadVendoredCatalog() {
    if (cachedCatalog !== undefined)
        return cachedCatalog;
    const root = vendorRootPath();
    const knownSkills = new Set();
    const playbooks = new Map();
    let commentSickoBody = 'Yes... Ha ha ha... Yes!';
    let potetoAgentBody = 'Read poteto-mode/SKILL.md in full before doing any work.';
    let workerRulesBody = 'Open every PR ready for review, never as a draft.';
    if (root !== undefined) {
        try {
            const skillsDir = join(root, 'skills');
            for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
                if (!entry.isDirectory())
                    continue;
                const parsed = parseSkillFile(readFileSync(join(skillsDir, entry.name, 'SKILL.md'), 'utf8'));
                if (parsed !== undefined)
                    knownSkills.add(parsed.name);
            }
            const playbooksDir = join(skillsDir, 'poteto-mode', 'playbooks');
            for (const entry of readdirSync(playbooksDir, { withFileTypes: true })) {
                if (!entry.isFile() || !entry.name.endsWith('.md'))
                    continue;
                const slug = entry.name.slice(0, -3).toLowerCase();
                const pb = parsePlaybook(readFileSync(join(playbooksDir, entry.name), 'utf8'), knownSkills);
                if (pb !== undefined)
                    playbooks.set(slug, pb);
            }
            const sickoParsed = parseSkillFile(readFileSync(join(root, 'agents', 'comment-sicko.md'), 'utf8'));
            if (sickoParsed !== undefined)
                commentSickoBody = sickoParsed.body;
            const agentParsed = parseSkillFile(readFileSync(join(root, 'agents', 'poteto-agent.md'), 'utf8'));
            if (agentParsed !== undefined)
                potetoAgentBody = agentParsed.body;
            workerRulesBody = readFileSync(join(skillsDir, 'poteto-mode', 'worker.md'), 'utf8');
        }
        catch {
            // Keep graceful defaults when running against a synthetic test root.
        }
    }
    cachedCatalog = {
        ...(root === undefined ? {} : { vendorRoot: root }),
        playbooks,
        knownSkills,
        commentSickoBody,
        potetoAgentBody,
        workerRulesBody,
    };
    return cachedCatalog;
}
