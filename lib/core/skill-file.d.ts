/**
 * Read a SKILL.md: the frontmatter fields pstack uses, and the body.
 *
 * This is not a YAML parser. It reads what pstack writes: one `key: value` per
 * line, the value plain, quoted, or a `>-` or `|` block. The test suite checks
 * that every vendored skill parses.
 */
export interface SkillFile {
    readonly name: string;
    readonly description: string;
    /** pstack marks skills only a person may start with `disable-model-invocation`. */
    readonly modelInvocable: boolean;
    readonly body: string;
}
export declare function parseSkillFile(text: string): SkillFile | undefined;
/** The first `# ` heading of a skill body, which pstack uses as the display title. */
export declare function bodyTitle(body: string): string | undefined;
