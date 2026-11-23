/**
 * Scoped persona and tool-surface discipline mounted inside each of pstack's
 * five Agent Presets (`poteto-agent`, `comment-sicko`, `pstack-adversary`,
 * `pstack-judge`, `pstack-worker`).
 *
 * Read-only roles (`comment-sicko` and `pstack-judge`) enforce a strict
 * capability ALLOWLIST (`read`, `glob`, `grep`, `skill`) through both
 * `ctx.tools.restrict` and a synchronous `ctx.tools.guard`, so neither host
 * write/shell tools nor global `pstack_*` effect tools can execute.
 *
 * @module @qybaihe/dsh-pstack/preset-role
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "pstack-preset-role";
export declare const inject: string[];
export type PresetRoleId = 'poteto-agent' | 'comment-sicko' | 'pstack-adversary' | 'pstack-judge' | 'pstack-worker';
export interface Config {
    role: PresetRoleId;
}
export declare const Config: Schema<Config, Config>;
export declare const READ_ONLY_ALLOWED_TOOLS: ReadonlySet<string>;
export declare function promptForRole(role: PresetRoleId): string;
export declare function apply(ctx: Context, config: Config): void;
