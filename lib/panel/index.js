/**
 * Multi-model panel orchestration (`@qybaihe/dsh-pstack/panel`, M2):
 * - `pstack_arena`: isolated git worktrees per candidate (seeded with the
 *   parent's live dirty state and pinned to a baseline commit), bounded
 *   concurrency queue, cross-vendor rubric judge (`pickCrossJudge`), and
 *   preflight-checked `pstack_arena_adopt`.
 * - `pstack_interrogate`: adversarial reviewers in isolated worktrees whose
 *   findings survive ONLY when the plugin independently re-runs their
 *   reproduction command and observes a real non-zero test/repro failure.
 * - `pstack_swarm`: slice fan-out where reports missing status, verified SHA /
 *   file pointer, or approach are re-dispatched once and marked `gap` on a
 *   second miss, while valid worker commits are preserved under `refs/pstack/swarm/*`.
 *
 * @module @qybaihe/dsh-pstack/panel
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';
import { effortForBudget, panelVendors, parseSeatSpec, pickCrossJudge, supportedEffort, vendorOf, } from '../core/model-routing.js';
import { evaluateArenaMatrix, evaluateSwarmSlice, verifyInterrogateFindings, } from '../core/panel-rules.js';
import { appendPstackSessionRecord, execShellCommand, execSubprocess, extractSupportedEfforts, getService, modelRouteOfAgent, resolveAgentCwd, resolveInsideWorkspace, resolveLiveSessionTarget, sessionIdOfAgent, sessionOfAgent, } from '../host/dsh.js';
import { registerRpc, runtimeFor } from '../host/state.js';
export { parseSeatSpec };
export const name = 'pstack-panel';
export const inject = ['tools'];
export const Config = Schema.object({
    budget: Schema.union(['large', 'medium', 'small']).default('large'),
    maxConcurrency: Schema.number().default(8),
    arenaSeats: Schema.array(Schema.string()).default(['inherit-parent', 'inherit-parent']),
    interrogateSeats: Schema.array(Schema.string()).default(['inherit-parent', 'inherit-parent']),
    swarmSeat: Schema.string().default('inherit-parent'),
    judgePool: Schema.array(Schema.string()).default([]),
    vendorOverrides: Schema.dict(Schema.string()).default({}),
});
export class BoundedQueue {
    active = 0;
    waiters = [];
    cap;
    constructor(cap) {
        this.cap = cap;
    }
    get waitingCount() {
        return this.waiters.length;
    }
    async run(fn) {
        if (this.active >= this.cap) {
            await new Promise((resolveWait) => this.waiters.push(resolveWait));
        }
        this.active += 1;
        try {
            return await fn();
        }
        finally {
            this.active -= 1;
            this.waiters.shift()?.();
        }
    }
}
/**
 * Create an isolated git worktree (or isolated copy directory for non-git/unborn
 * directories — NEVER mutating `workspaceCwd` in place!) seeded with the
 * parent's uncommitted tracked & untracked changes so candidates and reviewers
 * evaluate the exact live state.
 */
async function createIsolatedWorktree(ctx, workspaceCwd, cleanupCallbacks, signal) {
    const base = await mkdtemp(join(tmpdir(), 'pstack-wt-'));
    const wtPath = join(base, 'tree');
    const topRes = await execSubprocess(ctx, 'git', ['rev-parse', '--show-toplevel'], workspaceCwd, {
        timeoutMs: 10_000,
        ...(signal ? { signal } : {}),
    });
    const repoRoot = topRes.exitCode === 0 && topRes.stdout.trim() !== '' ? topRes.stdout.trim() : '';
    const headRes = repoRoot !== ''
        ? await execSubprocess(ctx, 'git', ['rev-parse', '--verify', 'HEAD'], repoRoot, {
            timeoutMs: 10_000,
            ...(signal ? { signal } : {}),
        })
        : { exitCode: 1, stdout: '' };
    if (repoRoot !== '' && headRes.exitCode === 0 && headRes.stdout.trim() !== '') {
        const added = await execSubprocess(ctx, 'git', ['worktree', 'add', '--detach', wtPath, 'HEAD'], repoRoot, {
            timeoutMs: 30_000,
            ...(signal ? { signal } : {}),
        });
        if (added.exitCode === 0) {
            let cleaned = false;
            const cleanup = async () => {
                if (cleaned)
                    return;
                cleaned = true;
                cleanupCallbacks.delete(cleanup);
                await execSubprocess(ctx, 'git', ['worktree', 'remove', '--force', wtPath], repoRoot, { timeoutMs: 15_000 }).catch(() => { });
                await rm(base, { recursive: true, force: true }).catch(() => { });
            };
            cleanupCallbacks.add(cleanup);
            // Mirror uncommitted tracked edits + non-ignored untracked files into the isolated worktree
            let baselineSha = headRes.stdout.trim();
            try {
                const dirtyDiff = await execSubprocess(ctx, 'git', ['diff', '--binary', 'HEAD'], repoRoot, {
                    maxBytes: 4 * 1024 * 1024,
                    timeoutMs: 15_000,
                });
                let seededDirty = false;
                if (dirtyDiff.exitCode === 0 && dirtyDiff.stdout.length > 0) {
                    const seedPatch = join(base, 'parent-dirty.patch');
                    await writeFile(seedPatch, dirtyDiff.stdout, 'utf8');
                    const applyDirty = await execSubprocess(ctx, 'git', ['apply', '--whitespace=nowarn', seedPatch], wtPath, {
                        timeoutMs: 15_000,
                    });
                    await rm(seedPatch, { force: true }).catch(() => { });
                    if (applyDirty.exitCode === 0)
                        seededDirty = true;
                }
                const untracked = await execSubprocess(ctx, 'git', ['ls-files', '--others', '--exclude-standard', '-z'], repoRoot, { maxBytes: 1024 * 1024, timeoutMs: 10_000 });
                if (untracked.exitCode === 0 && untracked.stdout.length > 0) {
                    const relFiles = untracked.stdout.split('\0').filter(Boolean).slice(0, 200);
                    for (const rel of relFiles) {
                        if (rel.startsWith('.audit/'))
                            continue;
                        const srcFile = join(repoRoot, rel);
                        const dstFile = join(wtPath, rel);
                        await mkdir(dirname(dstFile), { recursive: true }).catch(() => { });
                        await copyFile(srcFile, dstFile).catch(() => { });
                        seededDirty = true;
                    }
                }
                if (seededDirty) {
                    await execSubprocess(ctx, 'git', ['add', '-A'], wtPath, { timeoutMs: 10_000 });
                    const snapCommit = await execSubprocess(ctx, 'git', [
                        '-c',
                        'user.name=pstack',
                        '-c',
                        'user.email=pstack@local',
                        'commit',
                        '-q',
                        '--no-verify',
                        '-m',
                        'chore(pstack): parent dirty workspace snapshot',
                    ], wtPath, { timeoutMs: 10_000 });
                    if (snapCommit.exitCode === 0) {
                        const snapRev = await execSubprocess(ctx, 'git', ['rev-parse', 'HEAD'], wtPath, { timeoutMs: 5_000 });
                        if (snapRev.exitCode === 0 && snapRev.stdout.trim() !== '') {
                            baselineSha = snapRev.stdout.trim();
                        }
                    }
                }
            }
            catch {
                // Proceed with clean HEAD worktree if dirty-state seeding fails.
            }
            return { path: wtPath, repoRoot, baseSha: baselineSha, isGitWorktree: true, cleanup };
        }
    }
    // Non-git or unborn repo fallback: copy workspace into isolated temp directory (never share live workspace!)
    await cp(workspaceCwd, wtPath, {
        recursive: true,
        filter: (src) => {
            const baseName = src.split(/[/\\]/).pop() ?? '';
            return baseName !== '.git' && baseName !== 'node_modules';
        },
    }).catch(async () => {
        await mkdir(wtPath, { recursive: true });
    });
    let cleaned = false;
    const cleanup = async () => {
        if (cleaned)
            return;
        cleaned = true;
        cleanupCallbacks.delete(cleanup);
        await rm(base, { recursive: true, force: true }).catch(() => { });
    };
    cleanupCallbacks.add(cleanup);
    return { path: wtPath, repoRoot: resolve(workspaceCwd), baseSha: '', isGitWorktree: false, cleanup };
}
/**
 * Capture the complete binary-safe patch of an Arena candidate relative to its
 * pinned `baseSha` — including committed changes, unstaged edits, AND newly
 * created untracked files — using a throwaway `GIT_INDEX_FILE` so the candidate
 * worktree itself is never mutated.
 */
async function captureCandidatePatch(ctx, wt, signal) {
    if (wt.baseSha === '' || !existsSync(wt.path)) {
        return { ok: false, patch: '', error: 'Candidate worktree is no longer available.' };
    }
    const tempDir = await mkdtemp(join(tmpdir(), 'pstack-idx-'));
    const tempIndex = join(tempDir, 'index');
    try {
        const readTree = await execSubprocess(ctx, 'git', ['read-tree', 'HEAD'], wt.path, {
            timeoutMs: 10_000,
            env: { GIT_INDEX_FILE: tempIndex },
            ...(signal ? { signal } : {}),
        });
        if (readTree.exitCode !== 0) {
            return { ok: false, patch: '', error: readTree.stderr.trim() || 'git read-tree failed' };
        }
        await execSubprocess(ctx, 'git', ['add', '-A'], wt.path, {
            timeoutMs: 15_000,
            env: { GIT_INDEX_FILE: tempIndex },
            ...(signal ? { signal } : {}),
        });
        const diffRes = await execSubprocess(ctx, 'git', ['diff', '--binary', '--cached', wt.baseSha], wt.path, {
            maxBytes: 8 * 1024 * 1024,
            timeoutMs: 20_000,
            env: { GIT_INDEX_FILE: tempIndex },
            ...(signal ? { signal } : {}),
        });
        if (diffRes.exitCode !== 0) {
            return { ok: false, patch: '', error: diffRes.stderr.trim() || 'git diff failed' };
        }
        return { ok: true, patch: diffRes.stdout };
    }
    finally {
        await rm(tempDir, { recursive: true, force: true }).catch(() => { });
    }
}
async function resolveRouteForSeat(ctx, seat, parentRoute, defaultRoleEffort, budget, signal) {
    const raw = seat === 'inherit-parent' ? parentRoute : seat;
    if (raw === undefined)
        return undefined;
    const desiredEffort = raw.effort ?? effortForBudget(defaultRoleEffort, budget);
    const llm = getService(ctx, 'llm');
    if (llm !== undefined) {
        try {
            const info = llm.resolveModelInfo !== undefined
                ? await llm.resolveModelInfo(raw.provider, raw.model, signal)
                : llm.resolveModel !== undefined
                    ? await llm.resolveModel(raw.provider, raw.model, signal)
                    : undefined;
            const supported = extractSupportedEfforts(info);
            if (supported.length > 0) {
                const picked = supportedEffort(desiredEffort, supported);
                return {
                    provider: raw.provider,
                    model: raw.model,
                    ...(picked === undefined ? {} : { effort: picked }),
                };
            }
            // If model resolved with zero supported efforts, omit reasoningEffort so adapter defaults apply cleanly
            if (info !== undefined) {
                return { provider: raw.provider, model: raw.model };
            }
        }
        catch {
            // Keep requested route when model metadata lookup is unavailable.
        }
    }
    return { provider: raw.provider, model: raw.model, effort: desiredEffort };
}
async function activateSubagentWithQueue(ctx, queue, spec) {
    const subagents = getService(ctx, 'subagents');
    if (subagents === undefined)
        return undefined;
    return queue.run(async () => {
        for (let attempt = 0; attempt < 6; attempt += 1) {
            spec.signal.throwIfAborted?.();
            try {
                const handle = await subagents.startActivation(spec);
                try {
                    const result = await handle.result;
                    return { childId: handle.childId, result };
                }
                finally {
                    await handle.dispose().catch(() => { });
                }
            }
            catch (err) {
                const code = err?.code;
                if (code === 'ACTIVATION_LIMIT_REACHED' && attempt < 5) {
                    await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
                    continue;
                }
                throw err;
            }
        }
        return undefined;
    });
}
function candidateLabel(index) {
    return index < 26 ? String.fromCharCode(65 + index) : `C${index + 1}`;
}
export function apply(ctx, config) {
    const runtime = runtimeFor(ctx);
    const queue = new BoundedQueue(Math.max(1, config.maxConcurrency));
    const activeWorktreeCleanups = new Set();
    ctx.effect(() => async () => {
        await Promise.all([...activeWorktreeCleanups].map((fn) => fn().catch(() => { })));
    });
    let domainPromise = Promise.resolve(undefined);
    ctx.inject(['storageDomain'], (inner) => {
        const storageDomain = getService(inner, 'storageDomain');
        if (storageDomain === undefined)
            return;
        const opened = storageDomain
            .open({
            name: 'pstack_panel',
            version: 1,
            invalidRecords: 'backup-and-skip',
            tables: {
                runs: {
                    valueSchema: {
                        parse(raw) {
                            if (typeof raw !== 'object' || raw === null)
                                throw new Error('Invalid panel record');
                            return raw;
                        },
                    },
                },
            },
        })
            .catch(() => undefined);
        domainPromise = opened;
        inner.effect(() => async () => {
            const dom = await opened;
            await dom?.close();
        });
    });
    function findRetainedCandidate(sessionId, candId, runId) {
        const policy = runtime.sessions.get(sessionId);
        if (policy === undefined)
            return undefined;
        const effectiveRunId = runId ?? policy.latestArenaRunId;
        if (effectiveRunId !== undefined) {
            const exact = policy.candidateWorktrees.get(`${effectiveRunId}:${candId}`);
            if (exact !== undefined)
                return exact;
            if (runId !== undefined)
                return undefined;
        }
        return policy.candidateWorktrees.get(candId);
    }
    async function adoptCandidateIntoRepo(sessionId, candId, targetCwd, runId, signal) {
        const wt = findRetainedCandidate(sessionId, candId, runId);
        if (wt === undefined) {
            return {
                adopted: false,
                message: runId
                    ? `Candidate ${candId} from Arena run ${runId} is stale or already cleaned up.`
                    : `Candidate ${candId} has no retained worktree in this session.`,
            };
        }
        const topRes = await execSubprocess(ctx, 'git', ['rev-parse', '--show-toplevel'], targetCwd, {
            timeoutMs: 10_000,
            ...(signal ? { signal } : {}),
        });
        const targetRepoRoot = topRes.exitCode === 0 && topRes.stdout.trim() !== '' ? resolve(topRes.stdout.trim()) : '';
        if (targetRepoRoot === '' || targetRepoRoot !== resolve(wt.repoRoot)) {
            return {
                adopted: false,
                runId: wt.runId,
                message: `Refusing to apply candidate ${candId}: target checkout (${targetRepoRoot || targetCwd}) does not match Arena repository (${wt.repoRoot}).`,
            };
        }
        const captured = await captureCandidatePatch(ctx, wt, signal);
        if (!captured.ok) {
            return { adopted: false, runId: wt.runId, message: captured.error ?? 'Failed to capture candidate diff.' };
        }
        if (captured.patch.trim() === '') {
            return {
                adopted: true,
                runId: wt.runId,
                message: `Candidate ${candId} (${wt.model}) produced no file changes relative to the baseline.`,
            };
        }
        const tempPatchDir = await mkdtemp(join(tmpdir(), 'pstack-adopt-'));
        const patchFile = join(tempPatchDir, 'candidate.patch');
        await writeFile(patchFile, captured.patch, 'utf8');
        try {
            // Preflight `--check` first so a conflict never dirties index or working tree!
            const check = await execSubprocess(ctx, 'git', ['apply', '--check', '--3way', patchFile], wt.repoRoot, {
                timeoutMs: 15_000,
                ...(signal ? { signal } : {}),
            });
            if (check.exitCode !== 0) {
                return {
                    adopted: false,
                    runId: wt.runId,
                    message: `git apply preflight failed (working tree unchanged): ${(check.stderr || check.stdout).trim()}`,
                };
            }
            const applied = await execSubprocess(ctx, 'git', ['apply', '--3way', patchFile], wt.repoRoot, {
                timeoutMs: 20_000,
                ...(signal ? { signal } : {}),
            });
            if (applied.exitCode !== 0) {
                return {
                    adopted: false,
                    runId: wt.runId,
                    message: `git apply failed: ${(applied.stderr || applied.stdout).trim()}`,
                };
            }
            return {
                adopted: true,
                runId: wt.runId,
                message: `Adopted candidate ${candId} (${wt.model}) into ${wt.repoRoot}.`,
            };
        }
        finally {
            await rm(tempPatchDir, { recursive: true, force: true }).catch(() => { });
        }
    }
    // Lifecycle-owned RPC endpoints: `candidateDiff`, `adoptCandidate`, `panelPreview`
    registerRpc(ctx, runtime, 'candidateDiff', async (payload, signal) => {
        const req = payload;
        if (typeof req?.sessionId !== 'string' || req.sessionId === '') {
            return { ok: false, candidateId: req?.candidateId ?? 'A', diff: '', error: 'Missing sessionId' };
        }
        const candId = (req.candidateId ?? 'A').trim().toUpperCase();
        const wt = findRetainedCandidate(req.sessionId, candId, req.runId);
        if (wt === undefined) {
            return { ok: false, candidateId: candId, diff: '', error: `Candidate ${candId} worktree is unavailable or superseded.` };
        }
        const captured = await captureCandidatePatch(ctx, wt, signal);
        if (!captured.ok) {
            return { ok: false, candidateId: candId, model: wt.model, diff: '', error: captured.error };
        }
        return { ok: true, candidateId: candId, runId: wt.runId, model: wt.model, path: wt.path, diff: captured.patch };
    });
    registerRpc(ctx, runtime, 'adoptCandidate', async (payload, signal) => {
        const req = payload;
        if (typeof req?.sessionId !== 'string' || req.sessionId.trim() === '') {
            return { adopted: false, message: 'Cannot adopt candidate without an active sessionId.' };
        }
        const live = await resolveLiveSessionTarget(ctx, req.sessionId, signal);
        const candId = (req.candidateId ?? 'A').trim().toUpperCase();
        const wt = findRetainedCandidate(req.sessionId, candId, req.runId);
        const targetCwd = live?.cwd ?? wt?.repoRoot;
        if (targetCwd === undefined) {
            return { adopted: false, message: 'Unable to resolve workspace checkout for this session.' };
        }
        const outcome = await adoptCandidateIntoRepo(req.sessionId, candId, targetCwd, req.runId, signal);
        if (outcome.adopted) {
            await appendPstackSessionRecord(live?.session, {
                pstackKind: 'arena-adopt',
                candidateId: candId,
                ...(outcome.runId ? { runId: outcome.runId } : {}),
                adopted: true,
            });
        }
        return outcome;
    });
    registerRpc(ctx, runtime, 'panelPreview', async (payload) => {
        const req = payload;
        const overrides = req?.vendorOverrides ?? config.vendorOverrides;
        const seats = (req?.seats ?? config.arenaSeats).map(parseSeatSpec);
        const pool = (req?.judgePool ?? config.judgePool).map(parseSeatSpec);
        const vendors = panelVendors(seats, req?.parentModel, overrides);
        const judge = pickCrossJudge(pool, req?.parentModel, overrides);
        return { vendors, judge };
    });
    // 1. `pstack_arena`
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'pstack_arena',
        description: 'Run pstack Arena: spawn competing candidate subagents in isolated git worktrees, pick a cross-vendor judge (`pickCrossJudge`), and return a structured rubric matrix plus worktree paths without polluting the parent context.',
        parameters: {
            task: { type: 'string', required: true, description: 'Exact implementation or fix brief.' },
            rubric: {
                type: 'array',
                required: true,
                items: { type: 'string' },
                description: 'Scoring criteria (3 to 6 concrete observable checks).',
            },
            seats: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional `provider/model` seat overrides for this run.',
            },
            judgePool: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional ordered `provider/model` pool for cross-vendor judge selection.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    runId: { type: 'string', required: true },
                    task: { type: 'string', required: true },
                    phase: { type: 'string', required: true },
                    candidates: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
                    criteria: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
                    totals: { type: 'object', required: true, additionalProperties: true },
                    recommendedBase: { type: 'string' },
                    shape: { type: 'string', required: true },
                    judge: { type: 'object', required: true, additionalProperties: true },
                    queuedCount: { type: 'integer', required: true },
                    summaryText: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: String(value.summaryText) }],
            presentationMeta: (_args, value) => ({ pstackKind: 'arena', ...value }),
        },
        async execute(rawArgs, exec) {
            const args = rawArgs;
            const cwd = await resolveAgentCwd(ctx, exec.agent, exec.signal);
            const sessionId = sessionIdOfAgent(exec.agent) ?? '__default__';
            const policy = runtime.sessionPolicy(sessionId, sessionOfAgent(exec.agent));
            const runId = `arena-${randomUUID().slice(0, 8)}`;
            // Clean up any previous Arena run's retained candidate worktrees in this session to prevent tmpdir leaks
            const previousEntries = [...policy.candidateWorktrees.values()];
            policy.candidateWorktrees.clear();
            policy.latestArenaRunId = runId;
            await Promise.all(previousEntries.map((old) => old.cleanup().catch(() => { })));
            const parentSel = modelRouteOfAgent(exec.agent);
            const parentRoute = parentSel !== undefined ? { provider: parentSel.provider, model: parentSel.model } : undefined;
            const parentVendor = parentRoute !== undefined ? vendorOf(parentRoute, config.vendorOverrides) : undefined;
            const seatSpecs = (args.seats && args.seats.length > 0 ? args.seats : config.arenaSeats).map(parseSeatSpec);
            const candidates = await Promise.all(seatSpecs.map(async (seat, index) => {
                const id = candidateLabel(index);
                const route = await resolveRouteForSeat(ctx, seat, parentRoute, 'xhigh', config.budget, exec.signal);
                const vendor = (route ? vendorOf(route, config.vendorOverrides) : undefined) ?? 'unknown';
                if (exec.agent === undefined || route === undefined) {
                    return {
                        id,
                        provider: route?.provider ?? 'none',
                        model: route?.model ?? 'unconfigured',
                        vendor,
                        ...(route?.effort ? { effort: route.effort } : {}),
                        status: 'empty',
                    };
                }
                const wt = await createIsolatedWorktree(ctx, cwd, activeWorktreeCleanups, exec.signal);
                const startMs = Date.now();
                try {
                    const activated = await activateSubagentWithQueue(ctx, queue, {
                        provider: 'spawn',
                        label: `Arena ${id}: ${route.model}`,
                        agentPreset: 'poteto-agent',
                        cwd: wt.path,
                        parent: exec.agent,
                        signal: exec.signal,
                        delivery: 'caller',
                        agentOptions: {
                            provider: route.provider,
                            model: route.model,
                            ...(route.effort ? { reasoningEffort: route.effort } : {}),
                        },
                        prompt: [
                            {
                                type: 'text',
                                text: `Arena candidate ${id}.\nTask: ${args.task}\nRubric:\n${args.rubric.map((r) => `- ${r}`).join('\n')}\nImplement and verify in your worktree, then summarize your change and evidence.`,
                            },
                        ],
                    });
                    const durationMs = Date.now() - startMs;
                    const outText = activated?.result.output
                        .map((b) => b.text ?? '')
                        .join('\n')
                        .trim() ?? '';
                    if (activated === undefined || activated.result.stopReason !== 'completed' || outText === '') {
                        await wt.cleanup();
                        return {
                            id,
                            provider: route.provider,
                            model: route.model,
                            vendor,
                            ...(route.effort ? { effort: route.effort } : {}),
                            status: 'empty',
                            durationMs,
                        };
                    }
                    const retained = {
                        runId,
                        candidateId: id,
                        path: wt.path,
                        repoRoot: wt.repoRoot,
                        baseSha: wt.baseSha,
                        model: route.model,
                        cleanup: wt.cleanup,
                    };
                    policy.candidateWorktrees.set(`${runId}:${id}`, retained);
                    return {
                        id,
                        provider: route.provider,
                        model: route.model,
                        vendor,
                        ...(route.effort ? { effort: route.effort } : {}),
                        status: 'submitted',
                        durationMs,
                        worktreePath: wt.path,
                        sessionId: activated.childId,
                        summary: outText.slice(0, 600),
                    };
                }
                catch (err) {
                    await wt.cleanup();
                    throw err;
                }
            }));
            // Cross-vendor judge selection (`pickCrossJudge`)
            const llm = getService(ctx, 'llm');
            let rawPool = (args.judgePool && args.judgePool.length > 0 ? args.judgePool : config.judgePool).map(parseSeatSpec);
            if (rawPool.length === 0 && llm !== undefined) {
                const discovered = [];
                for (const prov of llm.listProviders()) {
                    const models = (await llm.listModels?.(prov.id).catch(() => [])) ?? [];
                    for (const m of models)
                        discovered.push({ provider: prov.id, model: m.id });
                }
                rawPool = discovered;
            }
            if (rawPool.length === 0) {
                rawPool = seatSpecs.filter((s) => s !== 'inherit-parent');
            }
            const judgePick = pickCrossJudge(rawPool, parentRoute, config.vendorOverrides);
            let criteria = args.rubric.map((criterion) => ({ criterion, scores: {} }));
            let recommendedBase;
            let shape = 'normal';
            let judgeRationale;
            let judgeScored = false;
            const submitted = candidates.filter((c) => c.status === 'submitted');
            if (judgePick.kind === 'picked' && submitted.length > 0 && exec.agent !== undefined) {
                const resolvedJudge = (await resolveRouteForSeat(ctx, judgePick.judge, parentRoute, 'high', config.budget, exec.signal)) ??
                    judgePick.judge;
                const judged = await activateSubagentWithQueue(ctx, queue, {
                    provider: 'spawn',
                    label: `Arena Judge: ${resolvedJudge.model}`,
                    agentPreset: 'pstack-judge',
                    cwd,
                    parent: exec.agent,
                    signal: exec.signal,
                    delivery: 'caller',
                    agentOptions: {
                        provider: resolvedJudge.provider,
                        model: resolvedJudge.model,
                        ...(resolvedJudge.effort ? { reasoningEffort: resolvedJudge.effort } : {}),
                    },
                    prompt: [
                        {
                            type: 'text',
                            text: [
                                `Score these Arena candidates against the rubric (1-5 per cell):`,
                                `Task: ${args.task}`,
                                `Rubric: ${JSON.stringify(args.rubric)}`,
                                ...submitted.map((c) => `Candidate ${c.id} (${c.model}, worktree ${c.worktreePath}):\n${c.summary ?? ''}`),
                            ].join('\n\n'),
                        },
                    ],
                    outputSchema: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['scores', 'recommendedBase', 'shape', 'rationale'],
                        properties: {
                            scores: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    additionalProperties: false,
                                    required: ['criterion', 'byCandidate'],
                                    properties: {
                                        criterion: { type: 'string' },
                                        byCandidate: { type: 'object' },
                                    },
                                },
                            },
                            recommendedBase: { type: 'string' },
                            shape: { type: 'string', enum: ['normal', 'converged', 'diverged'] },
                            rationale: { type: 'string' },
                        },
                    },
                });
                const structured = judged?.result.structured;
                if (structured !== undefined && Array.isArray(structured.scores)) {
                    criteria = args.rubric.map((criterion, idx) => {
                        const row = structured.scores?.find((s) => s.criterion === criterion) ?? structured.scores?.[idx];
                        return { criterion, scores: row?.byCandidate ?? {} };
                    });
                    recommendedBase = structured.recommendedBase;
                    shape = structured.shape ?? 'normal';
                    judgeRationale = structured.rationale;
                    judgeScored = true;
                }
            }
            const evalMatrix = evaluateArenaMatrix(candidates, criteria, recommendedBase, shape);
            const judgeInfo = judgePick.kind === 'picked'
                ? {
                    status: judgePick.vendorCheck === 'ran' ? 'picked' : 'skipped-unknown-parent',
                    model: judgePick.judge.model,
                    vendor: vendorOf(judgePick.judge, config.vendorOverrides) ?? judgePick.judge.provider,
                    ...(parentVendor ? { parentVendor } : {}),
                    ...(judgeRationale ? { rationale: judgeRationale } : {}),
                    scored: judgeScored,
                }
                : {
                    status: judgePick.reason,
                    ...(parentVendor ? { parentVendor } : {}),
                    scored: false,
                };
            const judgeVendorLabel = judgePick.kind === 'picked'
                ? (vendorOf(judgePick.judge, config.vendorOverrides) ?? judgePick.judge.provider)
                : undefined;
            const judgeLine = judgePick.kind === 'picked'
                ? `Judge: ${judgeVendorLabel}/${judgePick.judge.model}${judgePick.vendorCheck === 'skipped-unknown-parent' ? ' (parent vendor unknown; vendor check skipped)' : ` (cross-vendor vs ${parentVendor})`}.${evalMatrix.recommendedBase ? ` Recommended base: ${evalMatrix.recommendedBase}.` : ''}`
                : `Skipped judge: ${judgePick.reason} (no model from another vendor is configured; will not substitute same-vendor model).`;
            const summaryText = [
                `🥔 Arena "${args.task}" (run ${runId})`,
                ...candidates.map((c) => `- ${c.id} (${c.vendor}/${c.model}): ${c.status}${c.worktreePath ? ` · worktree: ${c.worktreePath}` : ''}${evalMatrix.totals[c.id] !== null && evalMatrix.totals[c.id] !== undefined ? ` · score: ${evalMatrix.totals[c.id]}` : ''}`),
                judgeLine,
            ].join('\n');
            const payload = {
                runId,
                task: args.task,
                phase: shape === 'diverged' ? 'define' : 'pick',
                candidates: candidates.map((c) => ({ ...c })),
                criteria: criteria.map((r) => ({ criterion: r.criterion, scores: { ...r.scores } })),
                totals: { ...evalMatrix.totals },
                ...(evalMatrix.recommendedBase === undefined ? {} : { recommendedBase: evalMatrix.recommendedBase }),
                shape,
                judge: judgeInfo,
                queuedCount: queue.waitingCount,
                summaryText,
            };
            const dom = await domainPromise;
            await dom?.table('runs').put(`arena:${sessionId}`, payload);
            return payload;
        },
    })));
    // 1b. `pstack_arena_adopt` (agent counterpart to the UI's "[以 B 为底]" button)
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'pstack_arena_adopt',
        description: 'Apply a completed Arena candidate worktree diff (`A`, `B`, `C`...) onto the current workspace as the base.',
        parameters: {
            candidateId: { type: 'string', required: true, description: 'Candidate letter (`A`, `B`, `C`...).' },
            runId: { type: 'string', description: 'Optional Arena `runId` to prevent adopting a stale candidate.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    candidateId: { type: 'string', required: true },
                    runId: { type: 'string' },
                    adopted: { type: 'boolean', required: true },
                    message: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: `🥔 ${value.message}` }],
            presentationMeta: (_args, value) => ({ pstackKind: 'arena-adopt', ...value }),
        },
        async execute(rawArgs, exec) {
            const { candidateId, runId } = rawArgs;
            const sessionId = sessionIdOfAgent(exec.agent) ?? '__default__';
            const cwd = await resolveAgentCwd(ctx, exec.agent, exec.signal);
            const normalizedId = candidateId.trim().toUpperCase();
            const res = await adoptCandidateIntoRepo(sessionId, normalizedId, cwd, runId, exec.signal);
            return {
                candidateId: normalizedId,
                ...(res.runId ? { runId: res.runId } : {}),
                adopted: res.adopted,
                message: res.message,
            };
        },
    })));
    // 2. `pstack_interrogate`
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'pstack_interrogate',
        description: 'Run pstack Interrogate: dispatch adversarial reviewers in isolated worktrees, independently re-run every claimed reproduction command, and discard any claim whose command passes, fails to spawn, or is missing.',
        parameters: {
            task: { type: 'string', required: true, description: 'Design, diff, or behavior to interrogate.' },
            seats: {
                type: 'array',
                items: { type: 'string' },
                description: 'Optional `provider/model` reviewer seats.',
            },
            claims: {
                type: 'array',
                description: 'Optional direct claims `{ reviewerId, title, detail?, command? }` to verify against the repository.',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        reviewerId: { type: 'string', required: true },
                        title: { type: 'string', required: true },
                        detail: { type: 'string' },
                        command: { type: 'string' },
                    },
                },
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task: { type: 'string', required: true },
                    verified: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
                    droppedCount: { type: 'integer', required: true },
                    discards: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
                    queuedCount: { type: 'integer', required: true },
                    summaryText: { type: 'string', required: true },
                },
            },
            render: (_args, value) => {
                const v = value;
                if (v.verified.length === 0) {
                    return [{ type: 'text', text: `🥔 Interrogate: no verified findings (${v.droppedCount} unverified claim(s) discarded).` }];
                }
                const lines = [
                    `🥔 Interrogate: ${v.summaryText}`,
                    ...v.verified.map((f) => `- [PROVEN by ${f.reviewers.join(', ')}] ${f.title}\n  $ ${f.command}\n  ${f.output.slice(0, 400)}`),
                ];
                return [{ type: 'text', text: lines.join('\n') }];
            },
            presentationMeta: (_args, value) => ({ pstackKind: 'interrogate', ...value }),
        },
        async execute(rawArgs, exec) {
            const args = rawArgs;
            const cwd = await resolveAgentCwd(ctx, exec.agent, exec.signal);
            const parentSel = modelRouteOfAgent(exec.agent);
            const parentRoute = parentSel !== undefined ? { provider: parentSel.provider, model: parentSel.model } : undefined;
            const rawClaims = [];
            const cleanupsToRun = new Set();
            try {
                if (args.claims !== undefined && args.claims.length > 0) {
                    const wt = await createIsolatedWorktree(ctx, cwd, activeWorktreeCleanups, exec.signal);
                    cleanupsToRun.add(wt.cleanup);
                    for (const c of args.claims) {
                        rawClaims.push({ claim: c, worktreePath: wt.path });
                    }
                }
                else if (exec.agent !== undefined) {
                    const seatSpecs = (args.seats && args.seats.length > 0 ? args.seats : config.interrogateSeats).map(parseSeatSpec);
                    await Promise.all(seatSpecs.map(async (seat, index) => {
                        const reviewerId = candidateLabel(index);
                        const route = await resolveRouteForSeat(ctx, seat, parentRoute, 'high', config.budget, exec.signal);
                        if (route === undefined)
                            return;
                        const wt = await createIsolatedWorktree(ctx, cwd, activeWorktreeCleanups, exec.signal);
                        cleanupsToRun.add(wt.cleanup);
                        const activated = await activateSubagentWithQueue(ctx, queue, {
                            provider: 'spawn',
                            label: `Interrogate ${reviewerId}: ${route.model}`,
                            agentPreset: 'pstack-adversary',
                            cwd: wt.path,
                            parent: exec.agent,
                            signal: exec.signal,
                            delivery: 'caller',
                            agentOptions: {
                                provider: route.provider,
                                model: route.model,
                                ...(route.effort ? { reasoningEffort: route.effort } : {}),
                            },
                            prompt: [
                                {
                                    type: 'text',
                                    text: `Interrogate: ${args.task}\nFind concrete defects and supply an exact shell command that reproduces each failure (non-zero exit code).`,
                                },
                            ],
                            outputSchema: {
                                type: 'object',
                                additionalProperties: false,
                                required: ['findings'],
                                properties: {
                                    findings: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            additionalProperties: false,
                                            required: ['title', 'command'],
                                            properties: {
                                                title: { type: 'string' },
                                                detail: { type: 'string' },
                                                command: { type: 'string' },
                                            },
                                        },
                                    },
                                },
                            },
                        });
                        const structured = activated?.result.structured;
                        for (const f of structured?.findings ?? []) {
                            rawClaims.push({
                                claim: {
                                    reviewerId,
                                    title: f.title,
                                    ...(f.detail ? { detail: f.detail } : {}),
                                    ...(f.command ? { command: f.command } : {}),
                                },
                                worktreePath: wt.path,
                            });
                        }
                    }));
                }
                // Independently re-run every claimed reproduction command inside its isolated worktree!
                const evaluated = [];
                for (const item of rawClaims) {
                    const cmd = item.claim.command?.trim() ?? '';
                    if (cmd === '') {
                        evaluated.push({ claim: item.claim });
                    }
                    else {
                        const res = await execShellCommand(ctx, cmd, item.worktreePath, {
                            timeoutMs: 45_000,
                            signal: exec.signal,
                        });
                        const out = [res.stdout.trim(), res.stderr.trim()].filter(Boolean).join('\n');
                        evaluated.push({
                            claim: item.claim,
                            repro: {
                                exitCode: res.exitCode,
                                output: out,
                                timedOut: res.timedOut,
                                spawnFailed: res.spawnFailed,
                            },
                        });
                    }
                }
                const verified = verifyInterrogateFindings(evaluated);
                return {
                    task: args.task,
                    verified: verified.verified.map((f) => ({
                        title: f.title,
                        ...(f.detail === undefined ? {} : { detail: f.detail }),
                        command: f.command,
                        output: f.output,
                        reviewers: [...f.reviewers],
                    })),
                    droppedCount: verified.droppedCount,
                    discards: verified.discards.map((d) => ({ ...d })),
                    queuedCount: queue.waitingCount,
                    summaryText: verified.summaryText,
                };
            }
            finally {
                await Promise.all([...cleanupsToRun].map((fn) => fn().catch(() => { })));
            }
        },
    })));
    // 3. `pstack_swarm`
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'pstack_swarm',
        description: 'Run pstack Swarm: dispatch parallel slice workers (`pstack-worker`), verify reported `PASS`/`ISSUES`/`BLOCKED` + SHA/file pointer + approach, preserve worker commits under `refs/pstack/swarm/*`, re-dispatch once on incomplete reports, and mark a second failure as an explicit `gap`.',
        parameters: {
            task: { type: 'string', required: true, description: 'Overall swarm objective.' },
            slices: {
                type: 'array',
                required: true,
                items: { type: 'string' },
                description: 'Independent slice briefs to fan out.',
            },
            seat: {
                type: 'string',
                description: 'Optional `provider/model` override for swarm workers.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    task: { type: 'string', required: true },
                    slices: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
                    passedCount: { type: 'integer', required: true },
                    gapCount: { type: 'integer', required: true },
                    summaryText: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: String(value.summaryText) }],
            presentationMeta: (_args, value) => ({ pstackKind: 'swarm', ...value }),
        },
        async execute(rawArgs, exec) {
            const args = rawArgs;
            const cwd = await resolveAgentCwd(ctx, exec.agent, exec.signal);
            const swarmRunShort = randomUUID().slice(0, 8);
            const parentSel = modelRouteOfAgent(exec.agent);
            const parentRoute = parentSel !== undefined ? { provider: parentSel.provider, model: parentSel.model } : undefined;
            const seatSpec = parseSeatSpec(args.seat ?? config.swarmSeat);
            const route = await resolveRouteForSeat(ctx, seatSpec, parentRoute, 'high', config.budget, exec.signal);
            const runSliceOnce = async (sliceText, sliceIndex, attempt) => {
                if (exec.agent === undefined || route === undefined) {
                    return { raw: {}, verifiedPointer: false };
                }
                const wt = await createIsolatedWorktree(ctx, cwd, activeWorktreeCleanups, exec.signal);
                try {
                    const activated = await activateSubagentWithQueue(ctx, queue, {
                        provider: 'spawn',
                        label: `Swarm #${sliceIndex} (${attempt}/2)`,
                        agentPreset: 'pstack-worker',
                        cwd: wt.path,
                        parent: exec.agent,
                        signal: exec.signal,
                        delivery: 'caller',
                        agentOptions: {
                            provider: route.provider,
                            model: route.model,
                            ...(route.effort ? { reasoningEffort: route.effort } : {}),
                        },
                        prompt: [
                            {
                                type: 'text',
                                text: `Task: ${args.task}\nSlice #${sliceIndex}: ${sliceText}\nCommit any edits in your worktree and report status (PASS/ISSUES/BLOCKED), commit SHA or file:line pointer, and approach.`,
                            },
                        ],
                        outputSchema: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['status', 'sha', 'approach'],
                            properties: {
                                status: { type: 'string', enum: ['PASS', 'ISSUES', 'BLOCKED'] },
                                sha: { type: 'string' },
                                approach: { type: 'string' },
                                summary: { type: 'string' },
                            },
                        },
                    });
                    const raw = activated?.result.structured ?? {};
                    let refName;
                    let verifiedPointer = true;
                    if (wt.isGitWorktree) {
                        const headNow = await execSubprocess(ctx, 'git', ['rev-parse', 'HEAD'], wt.path, { timeoutMs: 5_000 });
                        const workerHead = headNow.exitCode === 0 ? headNow.stdout.trim() : '';
                        if (workerHead !== '' && workerHead !== wt.baseSha) {
                            const candidateRef = `refs/pstack/swarm/${swarmRunShort}/slice-${sliceIndex}`;
                            const updated = await execSubprocess(ctx, 'git', ['update-ref', candidateRef, workerHead], wt.repoRoot, { timeoutMs: 5_000 });
                            if (updated.exitCode === 0)
                                refName = candidateRef;
                        }
                        // Verify file:line pointer if one was supplied
                        const shaField = raw.sha?.trim() ?? '';
                        if (shaField !== '' && shaField.toLowerCase() !== 'none-needed' && shaField.includes(':')) {
                            const filePart = shaField.slice(0, shaField.lastIndexOf(':'));
                            const resolvedFile = resolveInsideWorkspace(wt.path, filePart);
                            verifiedPointer = resolvedFile !== undefined && existsSync(resolvedFile);
                        }
                    }
                    return {
                        raw,
                        ...(refName === undefined ? {} : { refName }),
                        verifiedPointer,
                    };
                }
                finally {
                    await wt.cleanup();
                }
            };
            const results = await Promise.all(args.slices.map(async (label, idx) => {
                const sliceNum = idx + 1;
                const firstRun = await runSliceOnce(label, sliceNum, 1);
                const firstEval = evaluateSwarmSlice(firstRun.raw, 1);
                if (firstEval.valid && firstRun.verifiedPointer) {
                    return {
                        index: sliceNum,
                        label,
                        ...(route ? { workerModel: route.model } : {}),
                        outcome: firstEval.status,
                        retries: 0,
                        sha: firstEval.sha,
                        ...(firstRun.refName ? { refName: firstRun.refName } : {}),
                        approach: firstEval.approach,
                    };
                }
                // Attempt 1 lacked required/verified SHA or approach: re-dispatch once
                const secondRun = await runSliceOnce(label, sliceNum, 2);
                const secondEval = evaluateSwarmSlice(secondRun.raw, 2);
                if (secondEval.valid && secondRun.verifiedPointer) {
                    return {
                        index: sliceNum,
                        label,
                        ...(route ? { workerModel: route.model } : {}),
                        outcome: secondEval.status,
                        retries: 1,
                        sha: secondEval.sha,
                        ...(secondRun.refName ? { refName: secondRun.refName } : {}),
                        approach: `${secondEval.approach} (after 1 redispatch)`,
                    };
                }
                return {
                    index: sliceNum,
                    label,
                    ...(route ? { workerModel: route.model } : {}),
                    outcome: 'gap',
                    retries: 1,
                    reason: !secondRun.verifiedPointer
                        ? 'Reported file:line pointer does not exist in slice worktree.'
                        : secondEval.valid
                            ? 'Verification failed.'
                            : secondEval.reason,
                };
            }));
            const passedCount = results.filter((s) => s.outcome === 'PASS').length;
            const gapCount = results.filter((s) => s.outcome === 'gap').length;
            const summaryText = [
                `🥔 Swarm "${args.task}": ${passedCount}/${results.length} PASS, ${gapCount} gap(s).`,
                ...results.map((s) => `- #${s.index} [${s.outcome}] ${s.label}${s.sha ? ` (${s.sha}${s.refName ? ` @ ${s.refName}` : ''}: ${s.approach ?? ''})` : s.reason ? ` — ${s.reason}` : ''}`),
            ].join('\n');
            return {
                task: args.task,
                slices: results.map((s) => ({ ...s })),
                passedCount,
                gapCount,
                summaryText,
            };
        },
    })));
}
