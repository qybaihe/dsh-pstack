/**
 * TDD write gate (`@qybaihe/dsh-pstack/tdd`, M1):
 * - `/tdd on` arms the gate (`red-pending`); `/tdd off` disarms it (`off`).
 *   Only the user owns `/tdd` and the UI toggle — no model tool can disarm it.
 * - While in `red-pending`, `ctx.tools.guard` denies writes to production paths
 *   across both file tools (`write`, `edit`, `apply_patch` — including `input`
 *   and `*** Move to:` targets) and shell file redirects, while allowing test
 *   files, docs, and `.audit/` logs (`decideWrite`).
 * - When a foreground test command runs via `bash`/`pwsh` and exits non-zero,
 *   `reduceTdd` moves to `red-observed` and unlocks production code; when tests
 *   pass afterward, it moves to `green`.
 *
 * @module @qybaihe/dsh-pstack/tdd
 */
import Schema from '@deepseek-ai/schemastery';
import { shellWriteTargets } from '../core/shell-policy.js';
import { DEFAULT_TDD_OPTIONS, decideWrite, isTestCommand, reduceTdd } from '../core/tdd-gate.js';
import { appendPstackSessionRecord, getService, resolveLiveSessionTarget, sessionIdOfAgent, sessionOfAgent, } from '../host/dsh.js';
import { registerRpc, runtimeFor } from '../host/state.js';
export const name = 'pstack-tdd';
export const inject = ['tools'];
export const Config = Schema.object({
    writeTools: Schema.array(Schema.string()).default(['write', 'edit', 'apply_patch']),
    shellTools: Schema.array(Schema.string()).default(['bash', 'pwsh']),
    testPaths: Schema.array(Schema.string()).default([...DEFAULT_TDD_OPTIONS.testPaths]),
    alwaysWritable: Schema.array(Schema.string()).default([...DEFAULT_TDD_OPTIONS.alwaysWritable]),
    testCommands: Schema.array(Schema.string()).default([...DEFAULT_TDD_OPTIONS.testCommands]),
});
const DEFAULT_SESSION_KEY = '__default__';
/**
 * Extract every file path touched by a mutating file tool call (`file_path`,
 * `path`, DSH `apply_patch`'s `input`, legacy `patch`, and `*** Move to:` targets).
 */
export function targetPathsOfWriteCall(call, writeTools) {
    if (!writeTools.includes(call.name))
        return [];
    const args = call.arguments;
    if (typeof args !== 'object' || args === null)
        return [];
    const rec = args;
    const paths = [];
    if (typeof rec.file_path === 'string' && rec.file_path.trim() !== '')
        paths.push(rec.file_path.trim());
    if (typeof rec.path === 'string' && rec.path.trim() !== '')
        paths.push(rec.path.trim());
    const patchSource = typeof rec.input === 'string'
        ? rec.input
        : typeof rec.patch === 'string'
            ? rec.patch
            : undefined;
    if (patchSource !== undefined) {
        for (const match of patchSource.matchAll(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/gm)) {
            if (match[1] !== undefined)
                paths.push(match[1].trim());
        }
        for (const move of patchSource.matchAll(/^\*\*\* Move to:\s*(.+)$/gm)) {
            if (move[1] !== undefined)
                paths.push(move[1].trim());
        }
    }
    return [...new Set(paths)];
}
function parseShellExitCode(contentText, isError) {
    const match = /(?:exit(?:ed with)? code|status)[:\s]+(-?\d+)/i.exec(contentText);
    if (match !== null)
        return Number.parseInt(match[1], 10);
    return isError ? 1 : 0;
}
export function tddDenialFor(call, config, runtime) {
    let paths = targetPathsOfWriteCall(call, config.writeTools);
    if (paths.length === 0 && config.shellTools.includes(call.name)) {
        const args = call.arguments;
        if (typeof args?.command === 'string') {
            paths = shellWriteTargets(args.command);
        }
    }
    if (paths.length === 0)
        return undefined;
    const policy = call.agent !== undefined
        ? runtime.policyForAgent(call.agent)
        : runtime.sessionPolicy(DEFAULT_SESSION_KEY);
    const state = policy?.tdd ?? { phase: 'off' };
    if (state.phase !== 'red-pending')
        return undefined;
    const options = {
        testPaths: config.testPaths,
        alwaysWritable: config.alwaysWritable,
        testCommands: config.testCommands,
    };
    for (const path of paths) {
        const verdict = decideWrite(state, path, options);
        if (verdict.kind === 'deny') {
            return {
                reason: `🥔 ${verdict.reason} ${verdict.instead}`,
                info: { name: 'PstackTddError', code: 'PSTACK_TDD_RED_PENDING' },
            };
        }
    }
    return undefined;
}
export function apply(ctx, config) {
    const runtime = runtimeFor(ctx);
    const options = {
        testPaths: config.testPaths,
        alwaysWritable: config.alwaysWritable,
        testCommands: config.testCommands,
    };
    ctx.effect(() => ctx.tools.guard((exec) => tddDenialFor(exec, config, runtime)));
    // Observe foreground test command results to transition red-pending -> red-observed -> green
    ctx.on('tools/result', (exec, result) => {
        if (!config.shellTools.includes(exec.name))
            return;
        const args = exec.arguments;
        if (args?.run_in_background === true)
            return;
        const errorCode = result.error;
        const code = errorCode?.info?.code ?? errorCode?.code;
        if (code === 'TOOL_CANCELLED' || code === 'TOOL_ABORTED' || code?.startsWith('APPROVAL_') === true || code?.startsWith('PSTACK_') === true) {
            return;
        }
        const command = typeof args?.command === 'string' ? args.command.trim() : '';
        if (command === '' || !isTestCommand(command, options))
            return;
        const sessionKey = sessionIdOfAgent(exec.agent) ?? DEFAULT_SESSION_KEY;
        const policy = runtime.sessionPolicy(sessionKey, sessionOfAgent(exec.agent));
        const text = result.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
        const exitCode = parseShellExitCode(text, result.isError);
        if (exitCode === 126 || exitCode === 127)
            return;
        policy.tdd = reduceTdd(policy.tdd, {
            type: 'test-run',
            run: { command, exitCode, at: new Date().toISOString() },
        });
    });
    // RPC endpoint for UI human-only TDD toggle: commits an ignorable plugin record so all UI surfaces update in sync!
    registerRpc(ctx, runtime, 'tdd', async (payload, signal) => {
        const req = payload;
        if (typeof req?.sessionId !== 'string' || req.sessionId.trim() === '') {
            return { ok: false, reason: 'Missing sessionId' };
        }
        const live = await resolveLiveSessionTarget(ctx, req.sessionId, signal);
        const policy = runtime.sessionPolicy(req.sessionId, live?.session);
        if (req.action === 'on' || req.action === 'off') {
            policy.tdd = reduceTdd(policy.tdd, { type: req.action === 'on' ? 'arm' : 'disarm' });
            await appendPstackSessionRecord(live?.session, {
                pstackKind: 'tdd',
                action: req.action === 'on' ? 'arm' : 'disarm',
            });
        }
        return { ok: true, tdd: policy.tdd };
    });
    // `/tdd` slash command
    ctx.inject(['commands'], (inner) => {
        const commands = getService(inner, 'commands');
        if (commands === undefined)
            return;
        inner.effect(() => commands.register({
            name: 'tdd',
            description: 'Arm or disarm the pstack TDD write gate (/tdd on | /tdd off | /tdd status)',
            handler: (invocation) => {
                const sub = invocation.rawInput.trim().toLowerCase();
                const sessionKey = sessionIdOfAgent(invocation.agent) ?? String(invocation.agent.id);
                const policy = runtime.sessionPolicy(sessionKey, sessionOfAgent(invocation.agent));
                if (sub === 'on' || sub === 'arm') {
                    policy.tdd = reduceTdd(policy.tdd, { type: 'arm' });
                    return {
                        kind: 'success',
                        text: '🥔 TDD gate armed (red-pending). Production code is locked until a test run fails.',
                    };
                }
                if (sub === 'off' || sub === 'disarm') {
                    policy.tdd = reduceTdd(policy.tdd, { type: 'disarm' });
                    return { kind: 'success', text: '🥔 TDD gate disarmed.' };
                }
                if (sub === '' || sub === 'status') {
                    return { kind: 'success', text: `🥔 TDD gate status: ${policy.tdd.phase}` };
                }
                return { kind: 'error', text: 'Usage: /tdd on | /tdd off | /tdd status' };
            },
        }));
    });
}
