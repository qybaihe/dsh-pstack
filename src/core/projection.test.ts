import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PLAYBOOK_TITLES, PRINCIPLE_CATALOG, playbookSlugFromPath, resolvePlaybookSlug, skillNameFromPath } from './catalog.ts'
import {
  SICKO_OPENING,
  contiguousLandablePrefix,
  evaluateArenaMatrix,
  evaluateSwarmSlice,
  normalizeSickoReport,
  verifyInterrogateFindings,
} from './panel-rules.ts'
import { parsePlaybook } from './playbook.ts'
import { INITIAL_FOLD_STATE, reducePstackState, summarizePstackView } from './projection.ts'

describe('catalog & panel rules', () => {
  it('catalogs all 24 principles across 5 groups and 22 playbooks', () => {
    assert.equal(PRINCIPLE_CATALOG.length, 24)
    assert.equal(PRINCIPLE_CATALOG.filter((p) => p.group === 'core').length, 10)
    assert.equal(PRINCIPLE_CATALOG.filter((p) => p.group === 'architecture').length, 6)
    assert.equal(PRINCIPLE_CATALOG.filter((p) => p.group === 'verification').length, 5)
    assert.equal(PRINCIPLE_CATALOG.filter((p) => p.group === 'delegation').length, 2)
    assert.equal(PRINCIPLE_CATALOG.filter((p) => p.group === 'meta').length, 1)
    assert.equal(PLAYBOOK_TITLES.length, 22)
    assert.equal(playbookSlugFromPath('/x/skills/poteto-mode/playbooks/bug-fix.md'), 'bug-fix')
    assert.equal(skillNameFromPath('/x/skills/poteto-mode/SKILL.md'), 'poteto-mode')
    assert.equal(resolvePlaybookSlug('Bug fix'), 'bug-fix')
  })

  it('evaluates arena matrix totals, base pick, and judge disagreement', () => {
    const res = evaluateArenaMatrix(
      [
        { id: 'A', status: 'submitted' },
        { id: 'B', status: 'submitted' },
        { id: 'C', status: 'empty' },
      ],
      [
        { criterion: 'minimal', scores: { A: 3, B: 5 } },
        { criterion: 'tested', scores: { A: 5, B: 4 } },
      ],
      'B',
      'normal',
      'A',
    )
    assert.deepEqual(res.totals, { A: 8, B: 9, C: null })
    assert.equal(res.recommendedBase, 'B')
    assert.equal(res.baseDisagreement, true)
  })

  it('interrogate keeps only findings whose reproduction command fails', () => {
    const out = verifyInterrogateFindings([
      {
        claim: { reviewerId: 'A', title: 'Idle scroll drift', command: 'node repro.mjs' },
        repro: { exitCode: 1, output: 'expected 120, got 980' },
      },
      {
        claim: { reviewerId: 'C', title: 'idle scroll drift', command: 'node repro.mjs' },
        repro: { exitCode: 1, output: 'expected 120, got 980' },
      },
      {
        claim: { reviewerId: 'A', title: 'Fabricated race', command: 'node pass.mjs' },
        repro: { exitCode: 0, output: 'ok' },
      },
      {
        claim: { reviewerId: 'B', title: 'Prose-only hunch' },
      },
    ])
    assert.equal(out.verified.length, 1)
    assert.deepEqual(out.verified[0]?.reviewers, ['A', 'C'])
    assert.equal(out.droppedCount, 2)
    assert.deepEqual(out.discards, [
      { reviewerId: 'A', missingCommand: 0, commandPassed: 1 },
      { reviewerId: 'B', missingCommand: 1, commandPassed: 0 },
    ])

    const none = verifyInterrogateFindings([
      { claim: { reviewerId: 'A', title: 'Pass', command: 'true' }, repro: { exitCode: 0, output: '' } },
      { claim: { reviewerId: 'B', title: 'Missing binary', command: 'nonexistent-cmd' }, repro: { exitCode: 127, output: 'not found' } },
      { claim: { reviewerId: 'C', title: 'Hung command', command: 'sleep 99' }, repro: { exitCode: 1, output: 'timeout', timedOut: true } },
    ])
    assert.equal(none.verified.length, 0)
    assert.equal(none.droppedCount, 3)
    assert.equal(none.summaryText, 'no verified findings')
  })

  it('swarm redispatches once on missing SHA/approach and marks a second miss as a gap', () => {
    const first = evaluateSwarmSlice({ status: 'PASS', approach: 'edited a.ts' }, 1)
    assert.deepEqual(first, {
      valid: false,
      action: 'redispatch',
      reason: 'Missing commit SHA/evidence pointer or approach summary required by the brief.',
    })
    const second = evaluateSwarmSlice({ status: 'PASS', approach: 'edited a.ts' }, 2)
    assert.equal(second.valid, false)
    if (!second.valid) assert.equal(second.action, 'gap')

    const valid = evaluateSwarmSlice({ status: 'PASS', sha: 'a91f03d', approach: 'guarded timer' }, 1)
    assert.equal(valid.valid, true)
  })

  it('normalizes Comment Sicko reports and computes contiguous PR stacks', () => {
    const sicko = normalizeSickoReport({ deleted: 14, mustKill: [{ symbol: 'foo', reason: 'rename' }] })
    assert.equal(sicko.opening, SICKO_OPENING)
    assert.equal(sicko.deleted, 14)

    const { landable, waiting } = contiguousLandablePrefix([
      { number: 1, branch: 'pr-1', title: 'one', status: 'PASS' },
      { number: 2, branch: 'pr-2', title: 'two', status: 'PASS' },
      { number: 3, branch: 'pr-3', title: 'three', status: 'PENDING' },
      { number: 4, branch: 'pr-4', title: 'four', status: 'PASS' },
    ])
    assert.equal(landable.length, 2)
    assert.equal(waiting.length, 2)
  })
})

describe('session projection fold', () => {
  const bugFix = parsePlaybook(
    '### Bug fix\n\n**You own this task.**\n\n1. Reproduce it.\n2. Run **tdd**.\n\n**Reply:** Lead with fix.',
    new Set(['tdd']),
  )!
  const catalog = {
    playbooks: new Map([['bug-fix', bugFix]]),
    knownSkills: new Set(['poteto-mode', 'tdd', 'principle-explain-the-number']),
  }

  it('folds poteto-mode, playbook read, TDD red-to-green, guard blocks, and unread principle citations', () => {
    let state = INITIAL_FOLD_STATE
    // 1. User invokes /poteto-mode
    state = reducePstackState(state, { seq: 1, type: 'user/message', data: { content: '/poteto-mode fix it' } }, catalog)
    assert.equal(state.view.mode, 'on')

    // 2. Agent reads bug-fix.md
    state = reducePstackState(
      state,
      { seq: 2, type: 'tool/call', data: { callId: 'c1', name: 'read', arguments: JSON.stringify({ file_path: '/v/playbooks/bug-fix.md' }) } },
      catalog,
    )
    state = reducePstackState(state, { seq: 3, type: 'tool/result', data: { callId: 'c1', content: 'ok' } }, catalog)
    assert.equal(state.view.playbook?.title, 'Bug fix')
    assert.equal(state.view.playbook?.steps.length, 2)

    // 3. Guard blocks git add -A
    state = reducePstackState(
      state,
      { seq: 4, type: 'tool/call', data: { callId: 'c2', name: 'bash', arguments: JSON.stringify({ command: 'git add -A' }) } },
      catalog,
    )
    state = reducePstackState(
      state,
      { seq: 5, type: 'tool/result', data: { callId: 'c2', isError: true, error: { code: 'PSTACK_GIT_ADD_ALL' } } },
      catalog,
    )
    assert.equal(state.view.guard.blocks, 1)
    assert.equal(state.view.guard.lastBlockedCommand, 'git add -A')

    // 4. User arms /tdd on, test fails -> red-observed, test passes -> green
    state = reducePstackState(state, { seq: 6, type: 'command/run', data: { name: 'tdd', rawInput: 'on' } }, catalog)
    assert.equal(state.view.tdd.phase, 'red-pending')

    state = reducePstackState(
      state,
      { seq: 7, type: 'tool/call', data: { callId: 'c3', name: 'bash', arguments: JSON.stringify({ command: 'pnpm test' }) } },
      catalog,
    )
    state = reducePstackState(
      state,
      { seq: 8, type: 'tool/result', data: { callId: 'c3', isError: true, content: 'exit code: 1' } },
      catalog,
    )
    assert.equal(state.view.tdd.phase, 'red-observed')

    state = reducePstackState(
      state,
      { seq: 9, type: 'tool/call', data: { callId: 'c4', name: 'bash', arguments: JSON.stringify({ command: 'pnpm test' }) } },
      catalog,
    )
    state = reducePstackState(
      state,
      { seq: 10, type: 'tool/result', data: { callId: 'c4', isError: false, content: 'exit code: 0' } },
      catalog,
    )
    assert.equal(state.view.tdd.phase, 'green')

    // 5. Assistant cites Explain the Number without reading it
    state = reducePstackState(
      state,
      { seq: 11, type: 'assistant/message', data: { content: 'Per Explain the Number, we checked noise.' } },
      catalog,
    )
    assert.deepEqual(state.view.flaggedPrinciples, ['principle-explain-the-number'])
  })

  it('detects attack-the-premise when two edits fail the same test gate', () => {
    let state = INITIAL_FOLD_STATE
    const editAndFail = (seqBase: number) => {
      state = reducePstackState(
        state,
        { seq: seqBase, type: 'tool/call', data: { callId: `e${seqBase}`, name: 'edit', arguments: '{"file_path":"src/a.ts"}' } },
        catalog,
      )
      state = reducePstackState(state, { seq: seqBase + 1, type: 'tool/result', data: { callId: `e${seqBase}`, content: 'ok' } }, catalog)
      state = reducePstackState(
        state,
        { seq: seqBase + 2, type: 'tool/call', data: { callId: `t${seqBase}`, name: 'bash', arguments: '{"command":"pnpm test"}' } },
        catalog,
      )
      state = reducePstackState(
        state,
        { seq: seqBase + 3, type: 'tool/result', data: { callId: `t${seqBase}`, isError: true, content: 'exit code 1' } },
        catalog,
      )
    }
    editAndFail(1)
    assert.equal(state.view.premiseWarning, null)
    editAndFail(10)
    assert.deepEqual(state.view.premiseWarning, { command: 'pnpm test', count: 2 })
  })

  it('decodes real DSH SessionEvent shapes, plugin:pstack/event records, single-item ketchup resolution, and pstackSummary', () => {
    let state = INITIAL_FOLD_STATE

    // Real DSH skill-invocation uses `source.name`
    state = reducePstackState(
      state,
      {
        seq: 1,
        type: 'user/message',
        data: { content: [{ type: 'text', text: 'fix it' }], source: { kind: 'skill-invocation', name: 'poteto-mode' } },
      },
      catalog,
    )
    assert.equal(state.view.mode, 'on')

    // Real DSH command/run pairs with command/done by commandId and uses `args`
    state = reducePstackState(
      state,
      { seq: 2, type: 'command/run', data: { commandId: 'cmd-1', name: 'tdd', args: 'on' } },
      catalog,
    )
    assert.equal(state.view.tdd.phase, 'off')
    state = reducePstackState(
      state,
      { seq: 3, type: 'command/done', data: { commandId: 'cmd-1', kind: 'success' } },
      catalog,
    )
    assert.equal(state.view.tdd.phase, 'red-pending')

    // Real DSH tool/result nests `toolCallId`, `isError`, and `content` inside `data.message`
    state = reducePstackState(
      state,
      { seq: 4, type: 'tool/call', data: { callId: 'real-c1', name: 'bash', arguments: { command: 'pnpm test' } } },
      catalog,
    )
    state = reducePstackState(
      state,
      {
        seq: 5,
        type: 'tool/result',
        data: {
          message: {
            role: 'tool',
            toolCallId: 'real-c1',
            isError: true,
            content: [{ type: 'text', text: 'exit code: 1' }],
          },
        },
      },
      catalog,
    )
    assert.equal(state.view.tdd.phase, 'red-observed')

    // Ketchup with 2 items: one human reply resolves only the targeted item, not all items
    state = reducePstackState(
      state,
      {
        seq: 6,
        type: 'tool/result',
        data: {
          meta: {
            pstackKind: 'ketchup',
            items: [
              { id: 'k1', question: 'Q1?', recommendation: 'R1', options: [{ label: 'Yes', prompt: 'Approve 1' }] },
              { id: 'k2', question: 'Q2?', recommendation: 'R2', options: [{ label: 'No', prompt: 'Skip 2' }] },
            ],
          },
        },
      },
      catalog,
    )
    assert.equal(state.view.pendingKetchupCount, 2)

    // Non-human synthetic message does NOT resolve ketchup
    state = reducePstackState(
      state,
      { seq: 7, type: 'user/message', data: { content: 'Approve 1', source: { kind: 'subagent' } } },
      catalog,
    )
    assert.equal(state.view.pendingKetchupCount, 2)

    // Tagged human decision resolves only k1
    state = reducePstackState(
      state,
      { seq: 8, type: 'user/message', data: { content: '[ketchup:k1] Approve 1', source: { kind: 'user' } } },
      catalog,
    )
    assert.equal(state.view.pendingKetchupCount, 1)
    assert.equal(state.view.ketchup[0]?.decided, 'Yes')
    assert.equal(state.view.ketchup[1]?.decided, undefined)

    // Host RPC record `plugin:pstack/event` resolves k2
    state = reducePstackState(
      state,
      { seq: 9, type: 'plugin:pstack/event', data: { pstackKind: 'ketchup-decide', itemId: 'k2', label: 'No' } },
      catalog,
    )
    assert.equal(state.view.pendingKetchupCount, 0)

    const summary = summarizePstackView(state.view)
    assert.equal(summary.active, true)
    assert.equal(summary.pendingCount, 0)
  })
})
