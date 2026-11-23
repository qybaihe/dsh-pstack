/**
 * Root `pstack` plugin row (`@qybaihe/dsh-pstack`).
 *
 * Owns the browser client face (`./client`), registers the full `pstack`
 * session projection (`summary: false`) plus the lightweight `pstackSummary`
 * projection (`summary: true` for sidebar rows), registers pstack's five Agent
 * Presets when `agentPresets` is present, injects DSH tool-name mappings into
 * `systemPrompt`, and mounts the `/pstack` RPC channel when `connection` is
 * present.
 *
 * @module @qybaihe/dsh-pstack
 */
import { join } from 'node:path';
import { EMPTY_PSTACK_SUMMARY, INITIAL_FOLD_STATE, reducePstackState, summarizePstackView, } from './core/projection.js';
import { vendorOf } from './core/model-routing.js';
import { PSTACK_ROW_IDS, appendPstackSessionRecord, buildHumanDecisionMessage, execSubprocess, extractSupportedEfforts, findPstackConfigEntry, getService, loadVendoredCatalog, resolveLiveSessionTarget, } from './host/dsh.js';
import { registerRpc, runtimeFor } from './host/state.js';
export const name = 'pstack';
export const inject = ['systemPrompt'];
export const PSTACK_PROJECTION_KEY = 'pstack';
export const PSTACK_SUMMARY_PROJECTION_KEY = 'pstackSummary';
export const PSTACK_PRESET_IDS = [
    'poteto-agent',
    'comment-sicko',
    'pstack-adversary',
    'pstack-judge',
    'pstack-worker',
];
function dshHarnessGuidance() {
    const catalog = loadVendoredCatalog();
    const potetoPath = catalog.vendorRoot === undefined
        ? 'vendor/pstack/skills/poteto-mode/SKILL.md'
        : join(catalog.vendorRoot, 'skills', 'poteto-mode', 'SKILL.md');
    const workerPath = catalog.vendorRoot === undefined
        ? 'vendor/pstack/skills/poteto-mode/worker.md'
        : join(catalog.vendorRoot, 'skills', 'poteto-mode', 'worker.md');
    return [
        '## pstack for DeepSeek Harness (Runtime Adapter)',
        `You are running in DeepSeek Harness with \`@qybaihe/dsh-pstack\` mounted. Bundled \`poteto-mode/SKILL.md\`: \`${potetoPath}\`; \`worker.md\`: \`${workerPath}\`.`,
        'When reading pstack skills or playbooks written for Cursor, map tool names to DeepSeek Harness tools:',
        '- `Shell` → `bash` (or `pwsh` on Windows); `Read` → `read`; `Write` → `write`; `StrReplace` → `edit`; `TodoWrite` → `todo_write`; `Task` → `subagent` (`agentPreset: "poteto-agent"`).',
        '- Report playbook progress and your initial goal restatement through `pstack_step`.',
        '- Record append-only decisions through `pstack_log` (`show-me-your-work`), run comment audits with `pstack_no_comments`, multi-model panels with `pstack_arena` / `pstack_interrogate` / `pstack_swarm`, hillclimb loops with `pstack_bench` + `pstack_attempt`, and operator handoffs with `pstack_ketchup`.',
        '- Runtime guards enforce path-only `git add`, non-draft PRs, TDD red-before-write when `/tdd on` is active, frozen benchmark files, and read-before-citing principles.',
    ].join('\n');
}
function isPlainRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function checkView(value) {
    if (!isPlainRecord(value) || value.v !== 1 || (value.mode !== 'off' && value.mode !== 'on')) {
        throw new Error('Invalid PstackView payload');
    }
    if (!Array.isArray(value.readSkills) || !Array.isArray(value.readPrinciples) || !Array.isArray(value.ketchup)) {
        throw new Error('Invalid PstackView arrays');
    }
    if (!isPlainRecord(value.guard) || !isPlainRecord(value.ledger) || !isPlainRecord(value.tdd)) {
        throw new Error('Invalid PstackView nested records');
    }
    return value;
}
export function checkFoldState(value) {
    if (!isPlainRecord(value) || !isPlainRecord(value.calls) || !isPlainRecord(value.gateTracker)) {
        throw new Error('Invalid PstackFoldState checkpoint');
    }
    const view = checkView(value.view);
    const commands = isPlainRecord(value.commands) ? value.commands : {};
    const gateTracker = value.gateTracker;
    if (typeof gateTracker.dirtySinceLastGate !== 'boolean' || !isPlainRecord(gateTracker.consecutiveFailures)) {
        throw new Error('Invalid PstackFoldState gateTracker');
    }
    return {
        view,
        calls: value.calls,
        commands,
        gateTracker: gateTracker,
    };
}
function checkSummaryView(value) {
    if (!isPlainRecord(value) || value.v !== 1 || typeof value.active !== 'boolean') {
        return EMPTY_PSTACK_SUMMARY;
    }
    return value;
}
function buildPresetPlugins(role, hasWebPresetPlane, readOnly) {
    const rows = [];
    if (hasWebPresetPlane) {
        rows.push({
            id: 'tool-fs',
            name: '@deepseek-ai/dsh-tool-fs',
            config: readOnly
                ? { read: true, readImage: false, write: false, edit: false, applyPatch: false }
                : { read: true, readImage: true, write: true, edit: true, applyPatch: true },
        });
        rows.push({
            id: 'tool-fs-search',
            name: '@deepseek-ai/dsh-tool-fs-search',
            config: { sampleOverCapGlobResults: false },
        });
        rows.push({
            id: 'tool-skill',
            name: '@deepseek-ai/dsh-tool-skill',
        });
        if (!readOnly) {
            if (process.platform === 'win32') {
                rows.push({ id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh' });
            }
            else {
                rows.push({ id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' });
            }
            rows.push({
                id: 'tool-todo',
                name: '@deepseek-ai/dsh-tool-todo',
                config: { allowParallelInProgress: true },
            });
        }
    }
    rows.push({
        id: 'pstack-role',
        name: '@qybaihe/dsh-pstack/preset-role',
        config: { role },
    });
    return rows;
}
async function detectPresetToolPlane(agentPresets) {
    try {
        await agentPresets.readDocument(agentPresets.defaultId || 'standard');
        return true;
    }
    catch {
        try {
            const list = await agentPresets.list?.();
            const firstId = list?.[0]?.id;
            if (firstId !== undefined) {
                await agentPresets.readDocument(firstId);
                return true;
            }
        }
        catch {
            // Headless SDK profiles without preset document templates mount `pstack-role` directly.
        }
        return false;
    }
}
async function registerPresets(agentPresets) {
    const hasWebPresetPlane = await detectPresetToolPlane(agentPresets);
    const definitions = [
        {
            id: 'poteto-agent',
            name: 'Poteto Agent',
            description: 'pstack delegate subagent that loads poteto-mode/SKILL.md and worker.md with full coding tools.',
            order: 50,
            plugins: buildPresetPlugins('poteto-agent', hasWebPresetPlane, false),
        },
        {
            id: 'comment-sicko',
            name: 'Comment Sicko',
            description: 'Read-only comment-hunting auditor from pstack (no write or shell tools).',
            order: 51,
            plugins: buildPresetPlugins('comment-sicko', hasWebPresetPlane, true),
        },
        {
            id: 'pstack-adversary',
            name: 'pstack Adversary',
            description: 'Interrogate reviewer operating in an isolated worktree; findings require failing repro runs.',
            order: 52,
            plugins: buildPresetPlugins('pstack-adversary', hasWebPresetPlane, false),
        },
        {
            id: 'pstack-judge',
            name: 'pstack Cross-Judge',
            description: 'Read-only cross-vendor rubric judge for Arena panels.',
            order: 53,
            plugins: buildPresetPlugins('pstack-judge', hasWebPresetPlane, true),
        },
        {
            id: 'pstack-worker',
            name: 'pstack Swarm Worker',
            description: 'Swarm slice worker required to report PASS/ISSUES/BLOCKED with SHA and approach.',
            order: 54,
            plugins: buildPresetPlugins('pstack-worker', hasWebPresetPlane, false),
        },
    ];
    const disposers = [];
    for (const def of definitions) {
        try {
            disposers.push(await agentPresets.register(def));
        }
        catch {
            // Ignore duplicate registration across hot-reload edges until previous disposer settles.
        }
    }
    return disposers;
}
export function apply(ctx) {
    const catalog = loadVendoredCatalog();
    const runtime = runtimeFor(ctx);
    // 1. DSH tool-name adaptation prompt
    ctx.systemPrompt.section({
        name: 'pstack:harness-adapter',
        order: 9200,
        text: dshHarnessGuidance(),
        interpolate: false,
    });
    // 2. Session projections: full `pstack` (`summary: false`) + compact `pstackSummary` (`summary: true`)
    ctx.inject(['sessionProjections'], (inner) => {
        const projections = getService(inner, 'sessionProjections');
        if (projections === undefined)
            return;
        const fullPromise = projections
            .register({
            key: PSTACK_PROJECTION_KEY,
            stateVersion: 2,
            stateSchema: { parse: checkFoldState },
            init: () => INITIAL_FOLD_STATE,
            apply: (state, event) => reducePstackState(state, event, catalog),
            wire: {
                viewSchema: { parse: checkView },
                view: (state) => state.view,
                summary: false,
            },
        })
            .then((handle) => {
            runtime.projectionHandle = handle;
            return handle;
        });
        const summaryPromise = projections
            .register({
            key: PSTACK_SUMMARY_PROJECTION_KEY,
            stateVersion: 1,
            stateSchema: { parse: checkFoldState },
            init: () => INITIAL_FOLD_STATE,
            apply: (state, event) => reducePstackState(state, event, catalog),
            wire: {
                viewSchema: { parse: checkSummaryView },
                view: (state) => summarizePstackView(state.view),
                summary: true,
            },
        })
            .catch(() => undefined);
        inner.effect(() => async () => {
            const [fullHandle, summaryHandle] = await Promise.all([
                fullPromise.catch(() => undefined),
                summaryPromise,
            ]);
            if (runtime.projectionHandle === fullHandle) {
                delete runtime.projectionHandle;
            }
            await Promise.all([fullHandle?.dispose(), summaryHandle?.dispose()]);
        });
    });
    // 3. Five Agent Presets
    ctx.inject(['agentPresets'], (inner) => {
        const presets = getService(inner, 'agentPresets');
        if (presets === undefined)
            return;
        const regPromise = registerPresets(presets);
        inner.effect(() => async () => {
            const disposers = await regPromise.catch(() => []);
            await Promise.all(disposers.map((d) => d().catch(() => { })));
        });
    });
    // 4. Built-in RPC endpoints (`models`, `getConfig`, `saveConfig`, `exportLedger`, `decideKetchup`, `commitDiff`)
    registerRpc(ctx, runtime, 'models', async (_payload, signal) => {
        const llm = getService(ctx, 'llm');
        if (llm === undefined)
            return { models: [] };
        const models = [];
        for (const provider of llm.listProviders()) {
            const listed = (await llm.listModels?.(provider.id).catch(() => [])) ?? [];
            for (const m of listed) {
                let efforts = extractSupportedEfforts(m);
                if (efforts.length === 0 && llm.resolveModelInfo !== undefined) {
                    const info = await llm.resolveModelInfo(provider.id, m.id, signal).catch(() => undefined);
                    efforts = extractSupportedEfforts(info);
                }
                models.push({
                    provider: provider.id,
                    model: m.id,
                    name: m.name ?? m.id,
                    vendor: vendorOf({ provider: provider.id, model: m.id }),
                    efforts,
                });
            }
        }
        return { models };
    });
    registerRpc(ctx, runtime, 'getConfig', async (payload) => {
        const editor = getService(ctx, 'configEditor');
        const rowId = typeof payload?.rowId === 'string'
            ? payload.rowId
            : '';
        if (editor === undefined || !PSTACK_ROW_IDS.has(rowId)) {
            return { found: false };
        }
        const found = editor
            .configuration()
            .find((item) => (item.entry.options?.id ?? item.entry.id) === rowId);
        if (found === undefined)
            return { found: false };
        return {
            found: true,
            config: { ...found.inherited, ...found.override },
        };
    });
    registerRpc(ctx, runtime, 'saveConfig', async (payload) => {
        const editor = getService(ctx, 'configEditor');
        const req = payload;
        if (editor === undefined ||
            typeof req?.rowId !== 'string' ||
            !PSTACK_ROW_IDS.has(req.rowId) ||
            !isPlainRecord(req.config)) {
            return { saved: false, reason: 'configEditor unavailable or disallowed rowId' };
        }
        const target = findPstackConfigEntry(editor, req.rowId);
        if (target === undefined)
            return { saved: false, reason: `row "${req.rowId}" not found` };
        await editor.edit(target, (current, inherited) => ({ ...inherited, ...current, ...req.config }));
        return { saved: true };
    });
    registerRpc(ctx, runtime, 'exportLedger', async (payload) => {
        const sessionId = typeof payload?.sessionId === 'string'
            ? payload.sessionId
            : '';
        if (sessionId === '' || runtime.ledgerExportFor === undefined) {
            return { available: false };
        }
        const tsv = await runtime.ledgerExportFor(sessionId);
        if (tsv === undefined)
            return { available: false };
        return { available: true, tsv };
    });
    registerRpc(ctx, runtime, 'decideKetchup', async (payload, signal) => {
        const req = payload;
        if (typeof req?.sessionId !== 'string' ||
            typeof req.itemId !== 'string' ||
            typeof req.label !== 'string' ||
            typeof req.prompt !== 'string') {
            return { accepted: false, reason: 'Invalid ketchup decision payload' };
        }
        const target = await resolveLiveSessionTarget(ctx, req.sessionId, signal);
        if (target === undefined) {
            return { accepted: false, reason: 'Session is unavailable on host' };
        }
        await appendPstackSessionRecord(target.session, {
            pstackKind: 'ketchup-decide',
            itemId: req.itemId,
            label: req.label,
        });
        let deliveredOnHost = false;
        const liveAgent = target.agent;
        if (liveAgent !== undefined) {
            const msg = buildHumanDecisionMessage(`[ketchup:${req.itemId}] ${req.prompt}`);
            if (typeof liveAgent.followup === 'function') {
                liveAgent.followup(msg);
                deliveredOnHost = true;
            }
            else if (typeof liveAgent.steer === 'function') {
                liveAgent.steer(msg);
                deliveredOnHost = true;
            }
        }
        return { accepted: true, deliveredOnHost };
    });
    registerRpc(ctx, runtime, 'commitDiff', async (payload, signal) => {
        const req = payload;
        const sha = typeof req?.sha === 'string' ? req.sha.trim() : '';
        if (!/^[0-9a-f]{7,40}$/i.test(sha) || typeof req?.sessionId !== 'string') {
            return { ok: false, diff: '' };
        }
        const target = await resolveLiveSessionTarget(ctx, req.sessionId, signal);
        if (target === undefined)
            return { ok: false, diff: '' };
        const res = await execSubprocess(ctx, 'git', ['show', '--stat', '--patch', sha], target.cwd, {
            timeoutMs: 15_000,
            signal,
        });
        return { ok: res.exitCode === 0, diff: res.exitCode === 0 ? res.stdout : res.stderr };
    });
    ctx.inject(['connection'], (inner) => {
        const connection = inner.connection;
        if (connection === undefined)
            return;
        const dispatchRpc = async (endpoint, payload, signal) => {
            const handler = runtime.rpcHandlers.get(endpoint);
            if (handler === undefined) {
                return {
                    ok: false,
                    error: { code: 'pstack/unknown-endpoint', message: `Unknown pstack endpoint: ${endpoint}`, details: {} },
                };
            }
            try {
                const value = await handler(payload, signal);
                return { ok: true, value };
            }
            catch (error) {
                return {
                    ok: false,
                    error: {
                        code: 'pstack/rpc-failed',
                        message: error instanceof Error ? error.message : String(error),
                        details: {},
                    },
                };
            }
        };
        if (connection.fetch !== undefined) {
            const disposeFetch = connection.fetch.register({
                path: '/api/pstack.rpc',
                methods: ['POST'],
                requestBody: 'buffered',
                async fetch(request) {
                    const body = (await request.json().catch(() => undefined));
                    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
                    const result = await dispatchRpc(endpoint, body?.payload, request.signal);
                    const status = result.ok ? 200 : result.error.code === 'pstack/unknown-endpoint' ? 404 : 500;
                    return new Response(JSON.stringify(result), {
                        status,
                        headers: { 'content-type': 'application/json; charset=utf-8' },
                    });
                },
            });
            inner.effect(() => disposeFetch);
        }
        else if (connection.rpc !== undefined) {
            const disposeRpc = connection.rpc.handle('/pstack', dispatchRpc);
            inner.effect(() => () => {
                void disposeRpc();
            });
        }
    });
}
