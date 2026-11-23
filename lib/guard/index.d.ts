/**
 * Enforces pstack's git and irreversible-action rules on shell tool calls.
 *
 * A rule the agent can satisfy by rewriting its command is a guard denial,
 * which no other plugin can turn back into permission. A rule that needs a
 * person, such as a force push, raises an approval and never overrides
 * another plugin's denial.
 *
 * When `pstack-playbook` or `pstack-autopilot` is active in the same runtime,
 * sessions running `babysit` or `autopilot-stack` upgrade force-push from
 * approval to outright denial, `autopilot-stack` holds `gh pr merge`, and
 * `/correct` rules (`askPatterns`, `denyPatterns`, `protectedBranches`) persist
 * and take effect immediately.
 *
 * @module @qybaihe/dsh-pstack/guard
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { PreToolDecision, ToolExecution, ToolGuardDenial } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';
import type { ShellVerdict } from '../core/shell-policy.ts';
import type { PstackRuntime } from '../host/state.ts';
export declare const name = "pstack-guard";
export declare const inject: string[];
export interface DenyPatternRule {
    pattern: string;
    reason: string;
    instead: string;
}
export interface Config {
    /** Tools whose `command` argument is a shell command line. */
    shellTools: string[];
    /** A leased force push to one of these branches still asks. */
    protectedBranches: string[];
    /** Deny every force push, as the babysit playbook requires. */
    forbidForcePush: boolean;
    /** Regex sources for commands that publish or deploy. A match asks. */
    askPatterns: string[];
    /** Regex deny rules added by configuration or `/correct`. */
    denyPatterns: DenyPatternRule[];
}
export declare const Config: Schema<Partial<Config>, Config>;
type Call = Pick<ToolExecution, 'name' | 'arguments'> & {
    readonly agent?: Agent | {
        readonly id?: string;
    };
};
/** The shell command line of a call, or undefined when the call is not a shell call. */
export declare function shellCommandOf(call: Pick<ToolExecution, 'name' | 'arguments'>, shellTools: readonly string[]): string | undefined;
export declare function verdictFor(call: Call, config: Config, runtime?: PstackRuntime): ShellVerdict;
export declare function denialFor(call: Call, config: Config, runtime?: PstackRuntime): ToolGuardDenial | undefined;
export declare function approvalFor(call: Call, config: Config, runtime?: PstackRuntime): Extract<PreToolDecision, {
    kind: 'ask';
}> | undefined;
export declare function apply(ctx: Context, config: Config): void;
export {};
