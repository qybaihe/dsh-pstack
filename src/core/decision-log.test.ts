import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DECISION_HEADER, cleanCell, formatRow, parseLog, rowsOfRun, rowsWithoutEvidence, stamp } from './decision-log.ts'
import type { DecisionRow } from './decision-log.ts'

const row = (overrides: Partial<DecisionRow> = {}): DecisionRow => ({
  ts: '2026-05-24T09:02:00Z',
  phase: 'frame',
  decision: 'counted the work first',
  why: 'wanted the size before a long run',
  evidence: 'commit 3a9f1c2',
  result: 'found 5 things to sort out',
  ...overrides,
})

test('cells stay on one line', () => {
  assert.equal(cleanCell('a\tb\nc\rd'), 'a b c d')
})

test('a cell a spreadsheet would run as a formula gets a quote prefix', () => {
  assert.equal(cleanCell('=HYPERLINK("http://x")'), `'=HYPERLINK("http://x")`)
  assert.equal(cleanCell('+1'), `'+1`)
  assert.equal(cleanCell('-rf'), `'-rf`)
  assert.equal(cleanCell('@import'), `'@import`)
  assert.equal(cleanCell('commit 7c21e0a'), 'commit 7c21e0a')
})

test('a row round-trips through format and parse', () => {
  const written = row()
  assert.deepEqual(parseLog(DECISION_HEADER + formatRow(written)), [written])
})

test('parse skips a repeated header and pads a short row', () => {
  const text = `${DECISION_HEADER}${formatRow(row())}${DECISION_HEADER}2026-05-24T10:00:00Z\twidget\tmoved styles\n`
  const rows = parseLog(text)
  assert.equal(rows.length, 2)
  assert.equal(rows[1]?.decision, 'moved styles')
  assert.equal(rows[1]?.result, '')
})

test('stamp writes second-resolution UTC', () => {
  assert.equal(stamp(new Date('2026-05-24T09:02:00.789Z')), '2026-05-24T09:02:00Z')
})

test('a run owns the rows from its start row to the next run', () => {
  const rows = [
    row({ decision: 'by A' }),
    row({ phase: 'start', evidence: 'agent B', decision: 'B picks up' }),
    row({ decision: 'by B' }),
    row({ phase: 'start', evidence: 'agent A', decision: 'A returns' }),
    row({ decision: 'by A again' }),
  ]
  const ofA = rowsOfRun(rows, (start) => start.evidence === 'agent A', true)
  const ofB = rowsOfRun(rows, (start) => start.evidence === 'agent B', false)
  assert.deepEqual(ofA.map((r) => r.decision), ['by A', 'A returns', 'by A again'])
  assert.deepEqual(ofB.map((r) => r.decision), ['B picks up', 'by B'])
})

test('the audit flags rows with no evidence, and never a start row', () => {
  const rows = [row(), row({ evidence: ' ' }), row({ phase: 'start', evidence: '' })]
  assert.deepEqual(rowsWithoutEvidence(rows), [rows[1]])
})

test('a later evidenced row superseding an earlier empty-evidence row clears the audit flag', () => {
  const rowsByDecision = [
    row({ decision: 'drop legacy cache', evidence: '' }),
    row({ decision: 'drop legacy cache', evidence: 'src/cache.ts:42' }),
  ]
  assert.deepEqual(rowsWithoutEvidence(rowsByDecision), [])

  const rowsByIndexRef = [
    row({ decision: 'initial call', evidence: '' }),
    row({ decision: 'supersede #1 with repro', evidence: 'commit 91ab23c' }),
  ]
  assert.deepEqual(rowsWithoutEvidence(rowsByIndexRef), [])
})

const upstreamScript = join(import.meta.dirname, '../../vendor/pstack/skills/show-me-your-work/scripts/log.sh')

test('rows match the ones pstack log.sh writes', { skip: !existsSync(upstreamScript) }, () => {
  const logfile = join(mkdtempSync(join(tmpdir(), 'pstack-log-')), 'decisions.tsv')
  const cells = ['widget', 'threw out\ta helper', '=SUM(A1)', '-rf evidence\nline', 'reverted']
  execFileSync('bash', [upstreamScript, logfile, ...cells])
  const [header, line] = readFileSync(logfile, 'utf8').split('\n')
  assert.equal(`${header}\n`, DECISION_HEADER)
  const ts = (line as string).split('\t')[0] as string
  const [phase, decision, why, evidence, result] = cells as [string, string, string, string, string]
  assert.equal(`${line}\n`, formatRow({ ts, phase, decision, why, evidence, result }))
})
