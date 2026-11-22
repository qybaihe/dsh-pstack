/**
 * Enforces pstack's git and irreversible-action rules on shell tool calls.
 *
 * A rule the agent can satisfy by rewriting its command is a guard denial,
 * which no other plugin can turn back into permission. A rule that needs a
 * person, such as a force push, raises an approval and never overrides
 * another plugin's denial.
 *
 * @module @qybaihe/dsh-pstack/guard
 */
import type { Context } from '@deepseek-ai/cordis';
import type { PreToolDecision, ToolExecution, ToolGuardDenial } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';
import type { ShellVerdict } from '../core/shell-policy.ts';
export declare const name = "pstack-guard";
export declare const inject: string[];
export interface Config {
    /** Tools whose `command` argument is a shell command line. */
    shellTools: string[];
    /** A leased force push to one of these branches still asks. */
    protectedBranches: string[];
    /** Deny every force push, as the babysit playbook requires. */
    forbidForcePush: boolean;
    /** Regex sources for commands that publish or deploy. A match asks. */
    askPatterns: string[];
}
export declare const Config: Schema<Partial<Config>, Config>;
type Call = Pick<ToolExecution, 'name' | 'arguments'>;
/** The shell command line of a call, or undefined when the call is not a shell call. */
export declare function shellCommandOf(call: Call, shellTools: readonly string[]): string | undefined;
export declare function verdictFor(call: Call, config: Config): ShellVerdict;
export declare function denialFor(call: Call, config: Config): ToolGuardDenial | undefined;
export declare function approvalFor(call: Call, config: Config): Extract<PreToolDecision, {
    kind: 'ask';
}> | undefined;
export declare function apply(ctx: Context, config: Config): void;
export {};
