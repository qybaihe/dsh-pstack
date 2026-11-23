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

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { DecisionRow } from '../core/decision-log.ts'
import type { FrozenHarness, Measurement } from '../core/experiment.ts'
import type { PstackFoldState } from '../core/projection.ts'
import type { TddState } from '../core/tdd-gate.ts'
import { TDD_OFF } from '../core/tdd-gate.ts'
import type { ProjectionHandle } from './dsh.ts'
import { sessionIdOfAgent, sessionOfAgent } from './dsh.ts'

export interface RetainedCandidateWorktree {
  readonly runId: string
  readonly candidateId: string
  readonly path: string
  readonly repoRoot: string
  readonly baseSha: string
  readonly model: string
  readonly cleanup: () => Promise<void>
}

export interface FrozenBenchState {
  readonly metricName: string
  readonly direction: 'lower' | 'higher'
  readonly repoRoot: string
  readonly harness: FrozenHarness
  readonly baseline: Measurement
  readonly currentBest: Measurement
  readonly gateCommand?: string
  readonly minSamples: number
  readonly targetRelativeGain: number
  readonly minAttempts: number
  readonly attempts: number
}

export interface SessionRuntimePolicy {
  hydratedFromProjection: boolean
  playbookSlug?: string
  forbidForcePush: boolean
  holdPrMerge: boolean
  investigationReadOnly: boolean
  currentBranch?: string
  tdd: TddState
  frozenBench?: FrozenBenchState
  latestArenaRunId?: string
  candidateWorktrees: Map<string, RetainedCandidateWorktree>
}

export interface ExtraGuardRules {
  protectedBranches: string[]
  askPatterns: string[]
  denyPatterns: { readonly pattern: string; readonly reason: string; readonly instead: string }[]
}

export type RpcHandler = (payload: unknown, signal: AbortSignal) => Promise<unknown>

export interface PstackRuntime {
  readonly sessions: Map<string, SessionRuntimePolicy>
  readonly extraGuard: ExtraGuardRules
  readonly rpcHandlers: Map<string, RpcHandler>
  projectionHandle?: ProjectionHandle<PstackFoldState>
  ledgerExportFor?: (sessionId: string) => Promise<string | undefined>
  ledgerRowsFor?: (sessionId: string) => readonly DecisionRow[]
  ledgerAppendInternal?: (sessionId: string, cwd: string, row: Omit<DecisionRow, 'ts'>) => Promise<void>
  sessionPolicy(sessionId: string, session?: unknown): SessionRuntimePolicy
  policyForAgent(agent: Agent | undefined): SessionRuntimePolicy | undefined
}

const byRoot = new WeakMap<object, PstackRuntime>()

function rehydrateFromProjection(
  entry: SessionRuntimePolicy,
  handle: ProjectionHandle<PstackFoldState> | undefined,
  session: unknown,
): void {
  if (entry.hydratedFromProjection || handle === undefined || session === undefined) return
  entry.hydratedFromProjection = true
  try {
    const state = handle.stateOf(session)
    const view = state?.view
    if (view === undefined) return
    if (entry.playbookSlug === undefined && view.playbook !== null) {
      entry.playbookSlug = view.playbook.slug
      entry.forbidForcePush = view.guard.forbidForcePush
      entry.holdPrMerge = view.guard.holdPrMerge === true || view.playbook.slug === 'autopilot-stack'
      entry.investigationReadOnly = view.playbook.slug === 'investigation' && !view.playbook.completed
    }
    if (entry.tdd.phase === 'off' && view.tdd.phase !== 'off') {
      entry.tdd = view.tdd
    }
  } catch {
    // Synthetic test doubles without full Session instances skip projection rehydration.
  }
}

export function runtimeFor(ctx: Context): PstackRuntime {
  const rootKey = ((ctx as unknown as { root?: object }).root ?? ctx) as object
  let state = byRoot.get(rootKey)
  if (state === undefined) {
    state = {
      sessions: new Map(),
      extraGuard: { protectedBranches: [], askPatterns: [], denyPatterns: [] },
      rpcHandlers: new Map(),
      sessionPolicy(sessionId: string, session?: unknown): SessionRuntimePolicy {
        let entry = state!.sessions.get(sessionId)
        if (entry === undefined) {
          entry = {
            hydratedFromProjection: false,
            forbidForcePush: false,
            holdPrMerge: false,
            investigationReadOnly: false,
            tdd: TDD_OFF,
            candidateWorktrees: new Map(),
          }
          state!.sessions.set(sessionId, entry)
        }
        rehydrateFromProjection(entry, state!.projectionHandle, session)
        return entry
      },
      policyForAgent(agent: Agent | undefined): SessionRuntimePolicy | undefined {
        const sid = sessionIdOfAgent(agent)
        if (sid === undefined) return undefined
        return state!.sessionPolicy(sid, sessionOfAgent(agent))
      },
    }
    byRoot.set(rootKey, state)
  }
  return state
}

/** Register an RPC endpoint owned by `ctx.effect` so disabling a plugin row unregisters its handler. */
export function registerRpc(ctx: Context, runtime: PstackRuntime, endpoint: string, handler: RpcHandler): void {
  ctx.effect(() => {
    runtime.rpcHandlers.set(endpoint, handler)
    return () => {
      if (runtime.rpcHandlers.get(endpoint) === handler) {
        runtime.rpcHandlers.delete(endpoint)
      }
    }
  })
}
