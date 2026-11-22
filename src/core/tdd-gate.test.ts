import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TDD_OFF, decideWrite, isTestCommand, isTestPath, reduceTdd } from './tdd-gate.ts'
import type { TddEvent, TddState } from './tdd-gate.ts'

const run = (exitCode: number, command = 'pnpm test'): TddEvent => ({
  type: 'test-run',
  run: { command, exitCode, at: '2026-11-22T00:00:00Z' },
})

const play = (...events: TddEvent[]): TddState => events.reduce(reduceTdd, TDD_OFF)

test('production code stays closed until a test run fails', () => {
  const armed = play({ type: 'arm' })
  assert.equal(armed.phase, 'red-pending')
  assert.equal(decideWrite(armed, 'src/cart.ts').kind, 'deny')
  assert.equal(decideWrite(armed, 'src/cart.test.ts').kind, 'allow')

  const red = reduceTdd(armed, run(1))
  assert.equal(red.phase, 'red-observed')
  assert.equal(decideWrite(red, 'src/cart.ts').kind, 'allow')
})

test('a passing run does not open production code', () => {
  const state = play({ type: 'arm' }, run(0), run(0))
  assert.equal(state.phase, 'red-pending')
  assert.equal(decideWrite(state, 'src/cart.ts').kind, 'deny')
})

test('the cycle keeps the failing run and the passing run as evidence', () => {
  const state = play({ type: 'arm' }, run(1, 'vitest cart'), run(1, 'vitest cart again'), run(0, 'vitest cart'))
  assert.equal(state.phase, 'green')
  if (state.phase !== 'green') return
  assert.equal(state.red.command, 'vitest cart')
  assert.equal(state.green.exitCode, 0)
})

test('a failure after green reopens the cycle and keeps the first failing run', () => {
  const state = play({ type: 'arm' }, run(1, 'first'), run(0), run(2, 'later'))
  assert.equal(state.phase, 'red-observed')
  if (state.phase !== 'red-observed') return
  assert.equal(state.red.command, 'first')
})

test('an unarmed gate ignores test runs and allows every write', () => {
  const state = play(run(1), run(0))
  assert.equal(state.phase, 'off')
  assert.equal(decideWrite(state, 'src/cart.ts').kind, 'allow')
})

test('disarm turns the gate off and arm starts a new cycle', () => {
  assert.equal(play({ type: 'arm' }, { type: 'disarm' }).phase, 'off')
  assert.equal(play({ type: 'arm' }, run(1), run(0), { type: 'arm' }).phase, 'red-pending')
})

test('docs and the decision log stay writable while the gate waits', () => {
  const armed = play({ type: 'arm' })
  for (const path of ['README.md', 'decisions.tsv', '.audit/cart.tsv', 'docs/notes.mdx']) {
    assert.equal(decideWrite(armed, path).kind, 'allow', path)
  }
  for (const path of ['src/index.ts', 'package.json', 'lib/cart.py', 'contest/run.go']) {
    assert.equal(decideWrite(armed, path).kind, 'deny', path)
  }
})

test('test paths are recognized across ecosystems', () => {
  for (const path of [
    'src/cart.test.ts',
    'src/cart.spec.tsx',
    'tests/test_cart.py',
    'pkg/cart_test.go',
    'spec/cart_spec.rb',
    'src/__tests__/cart.js',
    'app/CartTests.swift',
    'test/fixtures/cart.json',
  ]) {
    assert.equal(isTestPath(path), true, path)
  }
  for (const path of ['src/cart.ts', 'src/latest.ts', 'src/attest/sign.go', 'src/protest.py']) {
    assert.equal(isTestPath(path), false, path)
  }
})

test('test commands are recognized across ecosystems', () => {
  for (const command of [
    'pnpm test',
    'npm run test -- cart',
    'npx vitest run src/cart.test.ts',
    'node --test "src/**/*.test.ts"',
    'pytest -k cart',
    'python -m pytest',
    'go test ./...',
    'cargo test cart',
    './gradlew :app:test',
    'make check',
  ]) {
    assert.equal(isTestCommand(command), true, command)
  }
  for (const command of ['pnpm build', 'git status', 'node scripts/latest.mjs', 'echo contest']) {
    assert.equal(isTestCommand(command), false, command)
  }
})
