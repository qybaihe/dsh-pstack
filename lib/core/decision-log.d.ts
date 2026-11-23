/**
 * The show-me-your-work decision log: one TSV row per decision, append-only.
 *
 * Source: skills/show-me-your-work/SKILL.md and scripts/log.sh. `cleanCell`
 * matches log.sh byte for byte, so rows written here and rows written by the
 * script read the same.
 */
export declare const DECISION_COLUMNS: readonly ['ts', 'phase', 'decision', 'why', 'evidence', 'result'];
export type DecisionColumn = (typeof DECISION_COLUMNS)[number];
export type DecisionRow = Readonly<Record<DecisionColumn, string>>;
export declare const DECISION_HEADER: string;
/**
 * Keep a cell on one line, and stop a spreadsheet from running it as a
 * formula. Evidence cells can carry text an attacker chose, such as a PR title.
 */
export declare function cleanCell(value: string): string;
/** One log line, newline included. `ts` is written as given. */
export declare function formatRow(row: DecisionRow): string;
/** `2026-05-24T09:02:00Z`, the second-resolution UTC stamp log.sh writes. */
export declare function stamp(date: Date): string;
/**
 * Read a log for display. A repeated header line is skipped, since log.sh can
 * write one on a network mount. A short row is padded, never dropped.
 */
export declare function parseLog(text: string): DecisionRow[];
/**
 * The rows one run wrote. A run's rows start at the top of a log it created or
 * at one of its `start` rows, and end at another run's `start` row.
 */
export declare function rowsOfRun(rows: readonly DecisionRow[], isOwnStart: (row: DecisionRow) => boolean, createdLog: boolean): DecisionRow[];
/**
 * Rows whose evidence cell is empty and have not been superseded by a later
 * evidenced row (matching the same decision or explicitly citing `#<rowNumber>`
 * / `row <rowNumber>`). `start` rows are never flagged.
 */
export declare function rowsWithoutEvidence(rows: readonly DecisionRow[]): DecisionRow[];
