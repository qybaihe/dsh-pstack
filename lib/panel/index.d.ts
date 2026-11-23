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
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { parseSeatSpec } from '../core/model-routing.ts';
import type { Budget } from '../core/model-routing.ts';
export { parseSeatSpec };
export declare const name = "pstack-panel";
export declare const inject: string[];
export interface Config {
    budget: Budget;
    maxConcurrency: number;
    arenaSeats: string[];
    interrogateSeats: string[];
    swarmSeat: string;
    judgePool: string[];
    vendorOverrides: Record<string, string>;
}
export declare const Config: Schema<Partial<Config>, Config>;
export declare class BoundedQueue {
    private active;
    private readonly waiters;
    private readonly cap;
    constructor(cap: number);
    get waitingCount(): number;
    run<T>(fn: () => Promise<T>): Promise<T>;
}
export declare function apply(ctx: Context, config: Config): void;
