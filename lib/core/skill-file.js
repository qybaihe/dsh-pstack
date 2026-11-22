/**
 * Read a SKILL.md: the frontmatter fields pstack uses, and the body.
 *
 * This is not a YAML parser. It reads what pstack writes: one `key: value` per
 * line, the value plain, quoted, or a `>-` or `|` block. The test suite checks
 * that every vendored skill parses.
 */
const FIELD = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/;
function unquote(value) {
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
    }
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1).replace(/''/g, "'");
    }
    return value;
}
const BLOCK_SCALAR = /^[|>][+-]?$/;
/** Read `key: >-` and `key: |` values: the indented lines that follow the key. */
function readBlock(lines, start, folded) {
    const block = [];
    let next = start;
    while (next < lines.length && (/^[ \t]/.test(lines[next]) || lines[next].trim() === '')) {
        block.push(lines[next].trim());
        next += 1;
    }
    const value = folded ? block.filter((line) => line !== '').join(' ') : block.join('\n').trim();
    return { value, next };
}
export function parseSkillFile(text) {
    const source = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    if (!source.startsWith('---\n'))
        return undefined;
    const end = source.indexOf('\n---', 3);
    if (end === -1)
        return undefined;
    const fields = new Map();
    const lines = source.slice(4, end).split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        const match = FIELD.exec(lines[i]);
        if (match === null)
            continue;
        const raw = match[2].trim();
        if (BLOCK_SCALAR.test(raw)) {
            const block = readBlock(lines, i + 1, raw.startsWith('>'));
            fields.set(match[1], block.value);
            i = block.next - 1;
        }
        else
            fields.set(match[1], unquote(raw));
    }
    const name = fields.get('name');
    if (name === undefined || name === '')
        return undefined;
    const afterFence = source.indexOf('\n', end + 1);
    return {
        name,
        description: fields.get('description') ?? '',
        modelInvocable: fields.get('disable-model-invocation') !== 'true',
        body: afterFence === -1 ? '' : source.slice(afterFence + 1).replace(/^\n+/, ''),
    };
}
/** The first `# ` heading of a skill body, which pstack uses as the display title. */
export function bodyTitle(body) {
    const match = /^# +(.+)$/m.exec(body);
    return match === null ? undefined : match[1].trim();
}
