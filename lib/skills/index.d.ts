/**
 * Serves the vendored pstack skills through `ctx.skills`.
 *
 * A skill keeps upstream's invocation policy: one marked
 * `disable-model-invocation` appears in the user's `/` list and stays out of
 * the model's catalog. poteto-mode reaches those by path, and every skill's
 * resource base is its real folder, so `../<name>/SKILL.md` resolves.
 *
 * @module @qybaihe/dsh-pstack/skills
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill';
export declare const name = "pstack-skills";
export declare const inject: string[];
export declare const PROVIDER_NAME = "pstack";
export declare function createProvider(control: SkillProviderControl, root?: string | undefined): SkillProvider;
export declare function apply(ctx: Context): void;
