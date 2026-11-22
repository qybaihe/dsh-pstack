/**
 * Read a poteto-mode playbook into steps. poteto-mode tells the agent to
 * "copy its steps into the todolist tool first", so the plugin seeds the todo
 * list and the progress rail from the same parse.
 *
 * A playbook is a `### Title`, a stance line that usually leads in bold, its
 * steps, and a `**Reply:**` paragraph. The steps are a numbered list, a bullet
 * list in the playbooks that are rule lists, or plain paragraphs.
 */
export interface PlaybookStep {
    readonly index: number;
    /** The step as written, continuation lines joined with newlines. */
    readonly text: string;
    /** A label short enough for one row of a progress rail. */
    readonly label: string;
    /** pstack skills the step names, in the order they appear. */
    readonly routes: readonly string[];
}
export interface Playbook {
    readonly title: string;
    readonly stance: string;
    readonly steps: readonly PlaybookStep[];
    readonly reply: string;
}
/** `Bug fix` becomes `bug-fix`, the playbook's file name. */
export declare function playbookSlug(title: string): string;
export declare function parsePlaybook(markdown: string, knownSkills?: ReadonlySet<string>): Playbook | undefined;
