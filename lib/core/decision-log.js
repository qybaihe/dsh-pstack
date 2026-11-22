/**
 * The show-me-your-work decision log: one TSV row per decision, append-only.
 *
 * Source: skills/show-me-your-work/SKILL.md and scripts/log.sh. `cleanCell`
 * matches log.sh byte for byte, so rows written here and rows written by the
 * script read the same.
 */
export const DECISION_COLUMNS = ['ts', 'phase', 'decision', 'why', 'evidence', 'result'];
export const DECISION_HEADER = `${DECISION_COLUMNS.join('\t')}\n`;
/**
 * Keep a cell on one line, and stop a spreadsheet from running it as a
 * formula. Evidence cells can carry text an attacker chose, such as a PR title.
 */
export function cleanCell(value) {
    const flat = value.replace(/[\t\n\r]/g, ' ');
    return /^[=+\-@]/.test(flat) ? `'${flat}` : flat;
}
/** One log line, newline included. `ts` is written as given. */
export function formatRow(row) {
    const cells = DECISION_COLUMNS.map((column) => (column === 'ts' ? row.ts : cleanCell(row[column])));
    return `${cells.join('\t')}\n`;
}
/** `2026-05-24T09:02:00Z`, the second-resolution UTC stamp log.sh writes. */
export function stamp(date) {
    return `${date.toISOString().slice(0, 19)}Z`;
}
/**
 * Read a log for display. A repeated header line is skipped, since log.sh can
 * write one on a network mount. A short row is padded, never dropped.
 */
export function parseLog(text) {
    const header = DECISION_COLUMNS.join('\t');
    const rows = [];
    for (const line of text.split('\n')) {
        if (line.trim() === '' || line === header)
            continue;
        const cells = line.split('\t');
        const cell = (index) => cells[index] ?? '';
        rows.push({ ts: cell(0), phase: cell(1), decision: cell(2), why: cell(3), evidence: cell(4), result: cell(5) });
    }
    return rows;
}
/**
 * The rows one run wrote. A run's rows start at the top of a log it created or
 * at one of its `start` rows, and end at another run's `start` row.
 */
export function rowsOfRun(rows, isOwnStart, createdLog) {
    const own = [];
    let inside = createdLog;
    for (const row of rows) {
        if (row.phase === 'start')
            inside = isOwnStart(row);
        if (inside)
            own.push(row);
    }
    return own;
}
/** Rows whose evidence cell is empty, which the audit flags before handing back. */
export function rowsWithoutEvidence(rows) {
    return rows.filter((row) => row.phase !== 'start' && row.evidence.trim() === '');
}
