/**
 * Unattended execution, ketchup decision handoff, and `/correct` self-hardening
 * (`@qybaihe/dsh-pstack/autopilot`, M4):
 * - `pstack_ketchup`: structured operator decision cards (`ketchup` skill).
 * - `pstack_autopilot` + `/autopilot`: recurring patrol (`ctx.schedule` with
 *   `every_seconds`), completion-driven goals (`ctx.goals` with revision-aware
 *   pause/resume), contiguous verified PR stack audit, durable checkpoints
 *   (`ctx.storageDomain`), and serialized stalled subagent detection +
 *   replacement (`ctx.subagents`) logged to both projection and ledger.
 * - `pstack_correct` + `/correct`: encodes new shell rules (`ask-pattern`,
 *   `deny-pattern`, `protected-branch`) into runtime structure immediately and
 *   persists all three through `ctx.configEditor.edit`.
 *
 * @module @qybaihe/dsh-pstack/autopilot
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "pstack-autopilot";
export declare const inject: string[];
export interface Config {
    /** Default patrol interval in seconds for `/autopilot` schedules (minimum 60). */
    patrolIntervalSeconds: number;
    /** Milliseconds without activity before a tracked worker subagent is considered stalled. */
    stallTimeoutMs: number;
    /** Polling interval in milliseconds for the stalled-subagent monitor. */
    monitorPollMs: number;
}
export declare const Config: Schema<Partial<Config>, Config>;
export interface AutopilotCheckpoint {
    readonly sessionId: string;
    readonly workspaceCwd: string;
    readonly playbookSlug?: string;
    readonly step?: number;
    readonly scheduleId?: string;
    readonly goalId?: string;
    readonly goalRevision?: number;
    readonly summary: string;
    readonly savedAt: string;
}
export interface WatchedWorker {
    readonly parent: Agent;
    readonly parentSessionId: string;
    readonly childId: string;
    readonly label: string;
    readonly brief: string;
    readonly cwd: string;
    readonly agentPreset: string;
    lastProgressAt: number;
}
export declare function apply(ctx: Context, config: Config): void;
