/**
 * poteto-mode's citation rule: "Cite only principles whose leaf SKILL.md you
 * read this session." The harness knows which skills a session loaded, so it
 * can check a reply against that list.
 */
export interface Principle {
    /** The skill name, such as `principle-laziness-protocol`. */
    readonly name: string;
    /** The heading of the leaf skill, such as `Laziness Protocol`. */
    readonly title: string;
}
/** The principles a text names, by title or by skill name. */
export declare function citedPrinciples(text: string, principles: readonly Principle[]): Principle[];
/** The principles a text names whose leaf skill the session never loaded. */
export declare function unreadCitations(text: string, principles: readonly Principle[], loadedSkills: ReadonlySet<string>): Principle[];
