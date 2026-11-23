/**
 * Pure verification and aggregation rules for M2 (arena, interrogate, swarm,
 * comment-sicko) and M4 (autopilot PR stack). None of these touch the harness.
 */
export type ArenaPhase = 'define' | 'fanout' | 'judge' | 'pick' | 'graft' | 'verify';
export declare const ARENA_PHASES: readonly ArenaPhase[];
export type CandidateSeatStatus = 'queued' | 'starting' | 'running' | 'submitted' | 'empty';
export interface ArenaCandidate {
    readonly id: string;
    readonly model: string;
    readonly provider: string;
    readonly vendor: string;
    readonly effort?: string;
    readonly status: CandidateSeatStatus;
    readonly durationMs?: number;
    readonly worktreePath?: string;
    readonly sessionId?: string;
    readonly summary?: string;
}
export interface ArenaCriterionScore {
    readonly criterion: string;
    /** Scores keyed by candidate id (`A`, `B`, `C`...). Absent or null means unscored (`–`). */
    readonly scores: Readonly<Record<string, number | null>>;
}
export type ArenaShapeSignal = 'normal' | 'converged' | 'diverged';
export interface ArenaEvaluation {
    readonly totals: Readonly<Record<string, number | null>>;
    readonly recommendedBase?: string;
    readonly parentChosenBase?: string;
    readonly baseDisagreement: boolean;
    readonly shape: ArenaShapeSignal;
}
export declare function evaluateArenaMatrix(candidates: readonly Pick<ArenaCandidate, 'id' | 'status'>[], criteria: readonly ArenaCriterionScore[], judgeRecommendedBase?: string, shape?: ArenaShapeSignal, parentChosenBase?: string): ArenaEvaluation;
export interface InterrogateClaim {
    readonly reviewerId: string;
    readonly title: string;
    readonly detail?: string;
    readonly command?: string;
}
export interface CommandReproOutcome {
    readonly exitCode: number;
    readonly output: string;
    readonly timedOut?: boolean;
    readonly spawnFailed?: boolean;
}
export type DiscardReason = 'missing-command' | 'command-passed' | 'invalid-command';
export interface VerifiedFinding {
    readonly title: string;
    readonly detail?: string;
    readonly command: string;
    readonly output: string;
    readonly reviewers: readonly string[];
}
export interface ReviewerDiscardSummary {
    readonly reviewerId: string;
    readonly missingCommand: number;
    readonly commandPassed: number;
    readonly invalidCommand?: number;
}
export interface InterrogateVerification {
    readonly verified: readonly VerifiedFinding[];
    readonly droppedCount: number;
    readonly discards: readonly ReviewerDiscardSummary[];
    readonly summaryText: string;
}
/**
 * Interrogate's core rule ("A finding survives only when a run proves it"):
 * claims without a runnable command, claims whose command fails due to a
 * missing executable (126/127) or timeout/spawn error, or claims whose command
 * exits 0 are dropped before reaching the parent context.
 */
export declare function verifyInterrogateFindings(claims: readonly {
    readonly claim: InterrogateClaim;
    readonly repro?: CommandReproOutcome;
}[]): InterrogateVerification;
export type SwarmStatus = 'PASS' | 'ISSUES' | 'BLOCKED';
export interface SwarmWorkerOutput {
    readonly status?: string;
    readonly sha?: string;
    readonly approach?: string;
    readonly summary?: string;
}
export type SwarmSliceOutcome = {
    readonly valid: true;
    readonly status: SwarmStatus;
    readonly sha: string;
    readonly approach: string;
    readonly summary: string;
} | {
    readonly valid: false;
    readonly action: 'redispatch' | 'gap';
    readonly reason: string;
};
/**
 * Swarm's quality bar: a worker report must name `PASS` | `ISSUES` | `BLOCKED`,
 * a commit SHA (or file:line pointer), and what approach it took. Missing
 * evidence triggers one re-dispatch; a second miss becomes an explicit `gap`
 * that never counts as `PASS`.
 */
export declare function evaluateSwarmSlice(output: SwarmWorkerOutput, attempt: 1 | 2): SwarmSliceOutcome;
export declare const SICKO_OPENING = "Yes... Ha ha ha... Yes!";
export interface SickoReport {
    readonly opening: string;
    readonly deleted: number;
    readonly mustKill: readonly {
        readonly symbol: string;
        readonly reason: string;
    }[];
    readonly review: readonly {
        readonly quote: string;
        readonly claimedRule: string;
    }[];
    readonly touchedFiles: readonly string[];
}
export declare function normalizeSickoReport(raw: Partial<SickoReport>): SickoReport;
export interface PrStackItem {
    readonly number: number;
    readonly branch: string;
    readonly title: string;
    readonly status: 'PASS' | 'PENDING' | 'FAIL';
}
/**
 * Autopilot-stack's landing rule (`docs/03-ui.md`): count from the bottom of
 * the stack up to the first PR without `PASS`. Everything below that point is
 * landable; everything at or above waits.
 */
export declare function contiguousLandablePrefix(stack: readonly PrStackItem[]): {
    readonly landable: readonly PrStackItem[];
    readonly waiting: readonly PrStackItem[];
};
