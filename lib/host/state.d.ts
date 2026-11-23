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
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { DecisionRow } from '../core/decision-log.ts';
import type { FrozenHarness, Measurement } from '../core/experiment.ts';
import type { PstackFoldState } from '../core/projection.ts';
import type { TddState } from '../core/tdd-gate.ts';
import type { ProjectionHandle } from './dsh.ts';
export interface RetainedCandidateWorktree {
    readonly runId: string;
    readonly candidateId: string;
    readonly path: string;
    readonly repoRoot: string;
    readonly baseSha: string;
    readonly model: string;
    readonly cleanup: () => Promise<void>;
}
export interface FrozenBenchState {
    readonly metricName: string;
    readonly direction: 'lower' | 'higher';
    readonly repoRoot: string;
    readonly harness: FrozenHarness;
    readonly baseline: Measurement;
    readonly currentBest: Measurement;
    readonly gateCommand?: string;
    readonly minSamples: number;
    readonly targetRelativeGain: number;
    readonly minAttempts: number;
    readonly attempts: number;
}
export interface SessionRuntimePolicy {
    hydratedFromProjection: boolean;
    playbookSlug?: string;
    forbidForcePush: boolean;
    holdPrMerge: boolean;
    investigationReadOnly: boolean;
    currentBranch?: string;
    tdd: TddState;
    frozenBench?: FrozenBenchState;
    latestArenaRunId?: string;
    candidateWorktrees: Map<string, RetainedCandidateWorktree>;
}
export interface ExtraGuardRules {
    protectedBranches: string[];
    askPatterns: string[];
    denyPatterns: {
        readonly pattern: string;
        readonly reason: string;
        readonly instead: string;
    }[];
}
export type RpcHandler = (payload: unknown, signal: AbortSignal) => Promise<unknown>;
export interface PstackRuntime {
    readonly sessions: Map<string, SessionRuntimePolicy>;
    readonly extraGuard: ExtraGuardRules;
    readonly rpcHandlers: Map<string, RpcHandler>;
    projectionHandle?: ProjectionHandle<PstackFoldState>;
    ledgerExportFor?: (sessionId: string) => Promise<string | undefined>;
    ledgerRowsFor?: (sessionId: string) => readonly DecisionRow[];
    ledgerAppendInternal?: (sessionId: string, cwd: string, row: Omit<DecisionRow, 'ts'>) => Promise<void>;
    sessionPolicy(sessionId: string, session?: unknown): SessionRuntimePolicy;
    policyForAgent(agent: Agent | undefined): SessionRuntimePolicy | undefined;
}
export declare function runtimeFor(ctx: Context): PstackRuntime;
/** Register an RPC endpoint owned by `ctx.effect` so disabling a plugin row unregisters its handler. */
export declare function registerRpc(ctx: Context, runtime: PstackRuntime, endpoint: string, handler: RpcHandler): void;
