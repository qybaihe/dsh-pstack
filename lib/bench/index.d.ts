/**
 * Hillclimb experiment bench (`@qybaihe/dsh-pstack/bench`, M3):
 * - `pstack_bench`: verifies the 7-question `benchmark-checklist`, SHA-256
 *   freezes the measurement script/files, samples N baseline runs, runs the
 *   regression gate, and persists the full frozen state to `storageDomain` so
 *   restarts rehydrate enforcement seamlessly.
 * - Guards BOTH `write` / `edit` / `apply_patch` AND `bash` / `pwsh` file
 *   redirects/mutations against touching frozen benchmark files (`PSTACK_BENCH_FROZEN`).
 * - `pstack_attempt`: checks `harnessDrift` BEFORE AND AFTER sampling + gate,
 *   evaluates `judgeAttempt`, stages and commits ONLY `changedFiles` (`--only`)
 *   when `kept` (checking exit status before updating `currentBest`), and
 *   restores pre-attempt file snapshots safely on `reverted` without destroying
 *   pre-existing user edits or unrelated untracked files.
 *
 * @module @qybaihe/dsh-pstack/bench
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type { Sample } from '../core/experiment.ts';
export declare const name = "pstack-bench";
export declare const inject: string[];
export interface Config {
    writeTools: string[];
    shellTools: string[];
    defaultMinSamples: number;
    noiseFactor: number;
    minRelativeGain: number;
}
export declare const Config: Schema<Partial<Config>, Config>;
export declare function parseSampleLine(stdout: string): Sample | undefined;
export declare function apply(ctx: Context, config: Config): void;
