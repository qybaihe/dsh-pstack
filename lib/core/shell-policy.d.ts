/**
 * Shell command policy: pstack's git and irreversible-action rules as a pure
 * classifier. The host wires `deny` to `ctx.tools.guard()` and `ask` to the
 * approval seam; this module never touches the harness.
 *
 * This guards against habitual slips by a cooperating agent. It is not a
 * security boundary: an alias, a script file, or an encoded command passes.
 *
 * Rule sources in pstack:
 *   git-add-all, git-commit-all  playbooks/hillclimb.md step 5
 *                                ("`git add <files>`, never `-A`")
 *   force-push                   poteto-mode/SKILL.md Autonomy ("Always pause"),
 *                                playbooks/babysit.md ("Never rebase, retarget,
 *                                or force-push")
 *   draft-pr                     poteto-mode/worker.md ("never as a draft")
 *   deploy                       poteto-mode/SKILL.md Autonomy ("deploys")
 */
export type RuleId = 'git-add-all' | 'git-commit-all' | 'force-push' | 'draft-pr' | 'deploy';
export type ShellVerdict = {
    readonly kind: 'allow';
} | {
    readonly kind: 'deny';
    readonly rule: RuleId;
    readonly command: string;
    readonly reason: string;
    readonly instead: string;
} | {
    readonly kind: 'ask';
    readonly rule: RuleId;
    readonly command: string;
    readonly reason: string;
};
export interface ShellPolicyOptions {
    /** A force push with a lease still asks when it targets one of these. */
    readonly protectedBranches: readonly string[];
    /** The branch a refspec-less push would update, when the caller knows it. */
    readonly currentBranch?: string;
    /** Babysit playbook: a force push is denied outright, not asked. */
    readonly forbidForcePush: boolean;
    /** Regex sources matched against each simple command. A match asks. */
    readonly askPatterns: readonly string[];
}
export declare const DEFAULT_SHELL_POLICY: ShellPolicyOptions;
/**
 * Split a command line into words and operators. Quotes group, backslash
 * escapes, `$(` and backticks open a nested command that is checked too.
 */
export declare function tokenize(input: string): string[];
/** Group tokens into simple commands, dropping the operators between them. */
export declare function simpleCommands(input: string): string[][];
/**
 * Classify a whole command line. A deny anywhere wins over an ask, and an ask
 * wins over allow, so one bad link fails the chain.
 */
export declare function classifyShellCommand(input: string, options?: ShellPolicyOptions): ShellVerdict;
