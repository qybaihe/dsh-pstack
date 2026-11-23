/**
 * Pure session-log fold producing the `pstack` projection view shared by the
 * Host (`ctx.sessionProjections`) and the Web/Desktop Client (`useProjection`).
 *
 * Kept in `src/core` so both halves and unit tests share one exact data shape
 * with zero harness dependencies.
 */
import type { DecisionRow } from './decision-log.ts';
import type { Direction, RevertReason } from './experiment.ts';
import type { ArenaCandidate, ArenaCriterionScore, ArenaPhase, ArenaShapeSignal, PrStackItem, ReviewerDiscardSummary, SickoReport, VerifiedFinding } from './panel-rules.ts';
import type { Playbook } from './playbook.ts';
import type { TddState } from './tdd-gate.ts';
export type StampTone = 'red' | 'green' | 'gold' | 'purple' | 'mute';
export interface MomentEvent {
    readonly seq: number;
    readonly skill: string;
    readonly textZh: string;
    readonly textEn: string;
    readonly stampZh: string;
    readonly stampEn: string;
    readonly tone: StampTone;
    readonly said?: boolean;
}
export interface PlaybookStepView {
    readonly index: number;
    readonly label: string;
    readonly text: string;
    readonly routes: readonly string[];
    readonly status: 'pending' | 'in_progress' | 'completed';
}
export interface ArenaView {
    readonly runId?: string;
    readonly task: string;
    readonly phase: ArenaPhase;
    readonly candidates: readonly ArenaCandidate[];
    readonly criteria: readonly ArenaCriterionScore[];
    readonly totals: Readonly<Record<string, number | null>>;
    readonly recommendedBase?: string;
    readonly parentChosenBase?: string;
    readonly baseDisagreement: boolean;
    readonly shape: ArenaShapeSignal;
    readonly judge?: {
        readonly status: 'picked' | 'no-other-vendor' | 'skipped-unknown-parent' | 'empty-pool';
        readonly model?: string;
        readonly vendor?: string;
        readonly parentVendor?: string;
        readonly rationale?: string;
        readonly scored?: boolean;
    };
    readonly queuedCount: number;
}
export interface InterrogateView {
    readonly task: string;
    readonly verified: readonly VerifiedFinding[];
    readonly droppedCount: number;
    readonly discards: readonly ReviewerDiscardSummary[];
    readonly queuedCount: number;
}
export interface SwarmSliceView {
    readonly index: number;
    readonly label: string;
    readonly workerModel?: string;
    readonly outcome: 'PASS' | 'ISSUES' | 'BLOCKED' | 'redispatched' | 'gap';
    readonly retries?: number;
    readonly sha?: string;
    readonly refName?: string;
    readonly approach?: string;
    readonly reason?: string;
}
export interface SwarmView {
    readonly task: string;
    readonly slices: readonly SwarmSliceView[];
}
export interface BenchAttemptView {
    readonly index: number;
    readonly hypothesis: string;
    readonly before: number;
    readonly after: number;
    readonly noise: number;
    readonly spread?: number;
    readonly kept: boolean;
    readonly relativeGain: number;
    readonly revertReason?: RevertReason | 'harness-drift';
    readonly commitSha?: string;
}
export interface BenchChecklistView {
    readonly zeroErrors: boolean;
    readonly enoughSamples: boolean;
    readonly workCounted: boolean;
    readonly representative?: boolean;
    readonly steadyState?: boolean;
    readonly isolatedNoise?: boolean;
    readonly gateNamed: boolean;
}
export interface BenchView {
    readonly metricName: string;
    readonly direction: Direction;
    readonly minSamples: number;
    readonly baseline: number;
    readonly targetValue: number;
    readonly targetRelativeGain: number;
    readonly minAttempts: number;
    readonly frozen: boolean;
    readonly driftedFiles: readonly string[];
    readonly gateCommand?: string;
    readonly checklist?: BenchChecklistView;
    readonly attempts: readonly BenchAttemptView[];
    readonly plateau: boolean;
    readonly met: boolean;
}
export interface KetchupOptionView {
    readonly label: string;
    readonly prompt: string;
    readonly cost?: string;
    readonly primary?: boolean;
}
export interface KetchupItemView {
    readonly id: string;
    readonly question: string;
    readonly recommendation: string;
    readonly change?: string;
    readonly evidence?: string;
    readonly risk?: string;
    readonly options: readonly KetchupOptionView[];
    readonly decided?: string;
}
export interface LedgerEntryView extends DecisionRow {
    readonly runStart?: boolean;
}
export interface AutopilotView {
    readonly mode?: 'drive' | 'threads-only' | 'check';
    readonly active: boolean;
    readonly scheduleId?: string;
    readonly goalId?: string;
    readonly waitingApproval?: boolean;
    readonly checkpointSaved?: boolean;
    readonly resumeHint?: string;
    readonly replacements: readonly {
        readonly target: string;
        readonly oldSessionId?: string;
        readonly newSessionId?: string;
        readonly reason: string;
        readonly at: string;
    }[];
    readonly stack: readonly PrStackItem[];
}
export interface PstackView {
    readonly v: 1;
    readonly mode: 'off' | 'on';
    readonly playbook: {
        readonly slug: string;
        readonly title: string;
        readonly stance: string;
        readonly goal?: string;
        readonly steps: readonly PlaybookStepView[];
        readonly currentStep: number;
        readonly completed: boolean;
    } | null;
    readonly readSkills: readonly string[];
    readonly readPrinciples: readonly string[];
    readonly flaggedPrinciples: readonly string[];
    readonly premiseWarning: {
        readonly command: string;
        readonly count: number;
    } | null;
    readonly tdd: TddState;
    readonly guard: {
        readonly blocks: number;
        readonly lastBlockedCommand?: string;
        readonly asks: number;
        readonly pendingApprovals?: number;
        readonly forbidForcePush: boolean;
        readonly holdPrMerge?: boolean;
    };
    readonly arena: ArenaView | null;
    readonly interrogate: InterrogateView | null;
    readonly swarm: SwarmView | null;
    readonly bench: BenchView | null;
    readonly ledger: {
        readonly rows: readonly LedgerEntryView[];
        readonly missingEvidenceIndices: readonly number[];
        readonly attention?: {
            readonly reviewerVendor: string;
            readonly reviewerModel: string;
            readonly note: string;
        };
    };
    readonly sicko: SickoReport | null;
    readonly ketchup: readonly KetchupItemView[];
    readonly pendingKetchupCount: number;
    readonly autopilot: AutopilotView | null;
    readonly moment: MomentEvent | null;
}
/** Compact per-session summary published to `SessionSummary.projectionValues.pstackSummary` so sidebar rows never haul full tables. */
export interface PstackSummaryView {
    readonly v: 1;
    readonly active: boolean;
    readonly mode: 'off' | 'on';
    readonly playbookTitle?: string;
    readonly activeStepLabel?: string;
    readonly currentStep: number;
    readonly totalSteps: number;
    readonly completed: boolean;
    readonly pendingCount: number;
    readonly autopilotActive: boolean;
    readonly autopilotMode?: string;
    readonly checkpointSaved: boolean;
}
export declare const EMPTY_PSTACK_VIEW: PstackView;
export declare const EMPTY_PSTACK_SUMMARY: PstackSummaryView;
export declare function summarizePstackView(view: PstackView): PstackSummaryView;
/** Minimal shape of a committed DSH SessionEvent that the fold inspects. */
export interface FoldEvent {
    readonly seq: number;
    readonly type: string;
    readonly time?: number;
    readonly data?: unknown;
    readonly ignorable?: boolean;
}
export interface FoldCatalog {
    readonly playbooks: ReadonlyMap<string, Playbook>;
    readonly knownSkills: ReadonlySet<string>;
}
interface PendingCall {
    readonly name: string;
    readonly args: Record<string, unknown>;
}
interface PendingCommand {
    readonly name: string;
    readonly args: string;
}
export interface PstackFoldState {
    readonly view: PstackView;
    /** Tool calls seen in `tool/call`, keyed by `callId` so `tool/result` knows their arguments. */
    readonly calls: Readonly<Record<string, PendingCall>>;
    /** Slash commands seen in `command/run` awaiting `command/done`. */
    readonly commands: Readonly<Record<string, PendingCommand>>;
    /** Tracks edits between failing runs of the same gate command for `attack-the-premise`. */
    readonly gateTracker: {
        readonly dirtySinceLastGate: boolean;
        readonly consecutiveFailures: Readonly<Record<string, number>>;
    };
}
export declare const INITIAL_FOLD_STATE: PstackFoldState;
/** Decode a DSH `tool/result` event across both real SessionEvent (`data.message.toolCallId`) and synthetic test fixtures. */
export declare function decodeToolResultEvent(data: Record<string, unknown>): {
    readonly callId: string | undefined;
    readonly explicitName: string | undefined;
    readonly isError: boolean;
    readonly errorCode: string | undefined;
    readonly resultText: string;
    readonly meta: Record<string, unknown> | undefined;
};
/** Decode skill name from a `user/message` `source` across real DSH (`source.name`) and synthetic fixtures (`source.skill`). */
export declare function decodeSkillInvocationSource(source: Record<string, unknown> | undefined): string | undefined;
/**
 * Pure transition over one DSH session event. Returns the exact same state
 * reference (`Object.is`) whenever an event leaves pstack's state unchanged.
 */
export declare function reducePstackState(state: PstackFoldState, event: FoldEvent, catalog: FoldCatalog): PstackFoldState;
export declare function applyPstackMeta(view: PstackView, meta: Record<string, unknown>, seq: number, catalog: FoldCatalog): PstackView;
export {};
