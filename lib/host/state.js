/**
 * Per-Cordis-root state coordinator shared across pstack's independently
 * toggleable plugin rows (`pstack`, `pstack-guard`, `pstack-playbook`,
 * `pstack-tdd`, `pstack-ledger`, `pstack-panel`, `pstack-bench`,
 * `pstack-autopilot`).
 *
 * Keyed on `ctx.root` via a `WeakMap` so multiple isolated harness instances
 * inside one test process never share state, and backed by `projectionHandle`
 * so resumed or forked sessions rehydrate policy automatically.
 */
import { TDD_OFF } from '../core/tdd-gate.js';
import { sessionIdOfAgent, sessionOfAgent } from './dsh.js';
const byRoot = new WeakMap();
function rehydrateFromProjection(entry, handle, session) {
    if (entry.hydratedFromProjection || handle === undefined || session === undefined)
        return;
    entry.hydratedFromProjection = true;
    try {
        const state = handle.stateOf(session);
        const view = state?.view;
        if (view === undefined)
            return;
        if (entry.playbookSlug === undefined && view.playbook !== null) {
            entry.playbookSlug = view.playbook.slug;
            entry.forbidForcePush = view.guard.forbidForcePush;
            entry.holdPrMerge = view.guard.holdPrMerge === true || view.playbook.slug === 'autopilot-stack';
            entry.investigationReadOnly = view.playbook.slug === 'investigation' && !view.playbook.completed;
        }
        if (entry.tdd.phase === 'off' && view.tdd.phase !== 'off') {
            entry.tdd = view.tdd;
        }
    }
    catch {
        // Synthetic test doubles without full Session instances skip projection rehydration.
    }
}
export function runtimeFor(ctx) {
    const rootKey = (ctx.root ?? ctx);
    let state = byRoot.get(rootKey);
    if (state === undefined) {
        state = {
            sessions: new Map(),
            extraGuard: { protectedBranches: [], askPatterns: [], denyPatterns: [] },
            rpcHandlers: new Map(),
            sessionPolicy(sessionId, session) {
                let entry = state.sessions.get(sessionId);
                if (entry === undefined) {
                    entry = {
                        hydratedFromProjection: false,
                        forbidForcePush: false,
                        holdPrMerge: false,
                        investigationReadOnly: false,
                        tdd: TDD_OFF,
                        candidateWorktrees: new Map(),
                    };
                    state.sessions.set(sessionId, entry);
                }
                rehydrateFromProjection(entry, state.projectionHandle, session);
                return entry;
            },
            policyForAgent(agent) {
                const sid = sessionIdOfAgent(agent);
                if (sid === undefined)
                    return undefined;
                return state.sessionPolicy(sid, sessionOfAgent(agent));
            },
        };
        byRoot.set(rootKey, state);
    }
    return state;
}
/** Register an RPC endpoint owned by `ctx.effect` so disabling a plugin row unregisters its handler. */
export function registerRpc(ctx, runtime, endpoint, handler) {
    ctx.effect(() => {
        runtime.rpcHandlers.set(endpoint, handler);
        return () => {
            if (runtime.rpcHandlers.get(endpoint) === handler) {
                runtime.rpcHandlers.delete(endpoint);
            }
        };
    });
}
