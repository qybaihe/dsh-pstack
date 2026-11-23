/**
 * TDD write gate (`@qybaihe/dsh-pstack/tdd`, M1):
 * - `/tdd on` arms the gate (`red-pending`); `/tdd off` disarms it (`off`).
 *   Only the user owns `/tdd` and the UI toggle — no model tool can disarm it.
 * - While in `red-pending`, `ctx.tools.guard` denies writes to production paths
 *   across both file tools (`write`, `edit`, `apply_patch` — including `input`
 *   and `*** Move to:` targets) and shell file redirects, while allowing test
 *   files, docs, and `.audit/` logs (`decideWrite`).
 * - When a foreground test command runs via `bash`/`pwsh` and exits non-zero,
 *   `reduceTdd` moves to `red-observed` and unlocks production code; when tests
 *   pass afterward, it moves to `green`.
 *
 * @module @qybaihe/dsh-pstack/tdd
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ToolExecution, ToolGuardDenial } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';
import type { PstackRuntime } from '../host/state.ts';
export declare const name = "pstack-tdd";
export declare const inject: string[];
export interface Config {
    writeTools: string[];
    shellTools: string[];
    testPaths: string[];
    alwaysWritable: string[];
    testCommands: string[];
}
export declare const Config: Schema<Partial<Config>, Config>;
/**
 * Extract every file path touched by a mutating file tool call (`file_path`,
 * `path`, DSH `apply_patch`'s `input`, legacy `patch`, and `*** Move to:` targets).
 */
export declare function targetPathsOfWriteCall(call: Pick<ToolExecution, 'name' | 'arguments'>, writeTools: readonly string[]): string[];
export declare function tddDenialFor(call: Pick<ToolExecution, 'name' | 'arguments'> & {
    readonly agent?: Agent | {
        readonly id?: string;
    };
}, config: Config, runtime: PstackRuntime): ToolGuardDenial | undefined;
export declare function apply(ctx: Context, config: Config): void;
