/**
 * Playbook lifecycle (`@qybaihe/dsh-pstack/playbook`, M1):
 * - Recognizes when a session opens a playbook (or `/playbook <name>`).
 * - Seeds steps directly into DSH's native `todo/write` log AND tracks
 *   multi-turn progress through `pstack_step`.
 * - Tightens runtime policy per playbook:
 *     - `babysit`: upgrades force-push from approval to outright denial.
 *     - `autopilot-stack`: denies `gh pr merge` and force-push so stacks stop at
 *       verified state until the operator signs off.
 *     - `investigation`: restricts mutating file tools (`write`, `edit`,
 *       `apply_patch`), mutating `pstack_*` tools, and shell file redirects
 *       until the operator or an evidenced transition switches playbooks.
 *
 * @module @qybaihe/dsh-pstack/playbook
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "pstack-playbook";
export declare const inject: string[];
export interface Config {
    /** Seed DSH's native `todo_write` list whenever a playbook is recognized. */
    seedNativeTodo: boolean;
    /** Automatically arm the TDD gate when entering a step that routes to `tdd`. */
    autoArmTddOnStep: boolean;
    /** Restrict mutating file tools while the `investigation` playbook is active. */
    lockWritesInInvestigation: boolean;
}
export declare const Config: Schema<Partial<Config>, Config>;
export declare function apply(ctx: Context, config: Config): void;
