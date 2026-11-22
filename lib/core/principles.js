/**
 * poteto-mode's citation rule: "Cite only principles whose leaf SKILL.md you
 * read this session." The harness knows which skills a session loaded, so it
 * can check a reply against that list.
 */
const PREFIX = 'principle-';
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** One pattern per principle: its title, its skill name, or its bare slug. */
function mentionPattern(principle) {
    const slug = principle.name.startsWith(PREFIX) ? principle.name.slice(PREFIX.length) : principle.name;
    const forms = [principle.title, principle.name, slug].map(escapeRegExp);
    return new RegExp(`(?<![A-Za-z0-9-])(?:${forms.join('|')})(?![A-Za-z0-9-])`, 'i');
}
/** The principles a text names, by title or by skill name. */
export function citedPrinciples(text, principles) {
    return principles.filter((principle) => mentionPattern(principle).test(text));
}
/** The principles a text names whose leaf skill the session never loaded. */
export function unreadCitations(text, principles, loadedSkills) {
    return citedPrinciples(text, principles).filter((principle) => !loadedSkills.has(principle.name));
}
