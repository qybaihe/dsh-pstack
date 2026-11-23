import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_JUDGE_OPTIONS,
  computeTargetValue,
  harnessDrift,
  judgeAttempt,
  median,
  predicateMet,
  scaledMad,
  summarize,
} from './experiment.ts'
import type { Sample } from './experiment.ts'

const samples = (values: readonly number[], extra: Omit<Sample, 'value'> = {}): Sample[] =>
  values.map((value) => ({ value, ...extra }))

const lower = { ...DEFAULT_JUDGE_OPTIONS, direction: 'lower' as const }

test('median and scaled MAD', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([4, 1, 3, 2]), 2.5)
  assert.throws(() => median([]), RangeError)
  assert.equal(scaledMad([10, 10, 10]), 0)
  assert.ok(Math.abs(scaledMad([1, 2, 3, 4, 5]) - 1.4826) < 1e-9)
})

test('a gain past the noise with a green gate is kept', () => {
  const before = summarize(samples([142, 140, 145, 141, 143]))
  const after = summarize(samples([89, 90, 88, 91, 89]))
  const verdict = judgeAttempt(before, after, true, lower)
  assert.equal(verdict.kind, 'kept')
  assert.equal(verdict.gain, 53)
  assert.ok(Math.abs(verdict.relativeGain - 53 / 142) < 1e-9)
})

test('a gain inside the noise is reverted', () => {
  const before = summarize(samples([100, 120, 90, 110, 105]))
  const after = summarize(samples([98, 118, 92, 108, 101]))
  const verdict = judgeAttempt(before, after, true, lower)
  assert.equal(verdict.kind, 'reverted')
  assert.equal(verdict.kind === 'reverted' ? verdict.reason : undefined, 'within-noise')
})

test('identical samples still need the minimum relative gain', () => {
  const before = summarize(samples([100, 100, 100, 100, 100]))
  const tiny = summarize(samples([99.5, 99.5, 99.5, 99.5, 99.5]))
  const real = summarize(samples([97, 97, 97, 97, 97]))
  assert.equal(judgeAttempt(before, tiny, true, lower).kind, 'reverted')
  assert.equal(judgeAttempt(before, real, true, lower).kind, 'kept')
})

test('a red gate reverts even a large gain', () => {
  const before = summarize(samples([100, 101, 99, 100, 100]))
  const after = summarize(samples([50, 51, 49, 50, 50]))
  const verdict = judgeAttempt(before, after, false, lower)
  assert.equal(verdict.kind === 'reverted' ? verdict.reason : undefined, 'gate-red')
})

test('a faster run that did less work is reverted', () => {
  const before = summarize(samples([100, 101, 99, 100, 100], { work: 5000 }))
  const after = summarize(samples([50, 51, 49, 50, 50], { work: 2500 }))
  const verdict = judgeAttempt(before, after, true, lower)
  assert.equal(verdict.kind === 'reverted' ? verdict.reason : undefined, 'work-changed')
})

test('samples that disagree on the work count cannot be compared', () => {
  const before = summarize(samples([100, 101, 99, 100, 100], { work: 5000 }))
  const after = summarize([...samples([50, 51, 49, 50], { work: 5000 }), { value: 50, work: 4999 }])
  assert.equal(after.work, undefined)
  const verdict = judgeAttempt(before, after, true, lower)
  assert.equal(verdict.kind === 'reverted' ? verdict.reason : undefined, 'work-changed')
})

test('harness errors and thin samples invalidate the number before it is compared', () => {
  const before = summarize(samples([100, 101, 99, 100, 100]))
  const errored = summarize(samples([50, 51, 49, 50, 50], { errors: 1 }))
  const thin = summarize(samples([50, 51, 49]))
  const erroredVerdict = judgeAttempt(before, errored, true, lower)
  const thinVerdict = judgeAttempt(before, thin, true, lower)
  assert.equal(erroredVerdict.kind === 'reverted' ? erroredVerdict.reason : undefined, 'harness-errors')
  assert.equal(thinVerdict.kind === 'reverted' ? thinVerdict.reason : undefined, 'too-few-samples')
})

test('direction decides which way is better', () => {
  const before = summarize(samples([100, 101, 99, 100, 100]))
  const after = summarize(samples([150, 151, 149, 150, 150]))
  const asLower = judgeAttempt(before, after, true, lower)
  const asHigher = judgeAttempt(before, after, true, { ...DEFAULT_JUDGE_OPTIONS, direction: 'higher' })
  assert.equal(asLower.kind === 'reverted' ? asLower.reason : undefined, 'regressed')
  assert.equal(asHigher.kind, 'kept')
})

test('the stop predicate needs both the target and the attempt floor', () => {
  const predicate = { targetRelativeGain: 0.5, minAttempts: 10 }
  assert.equal(predicateMet(142, 60, 'lower', 3, predicate), false)
  assert.equal(predicateMet(142, 89, 'lower', 12, predicate), false)
  assert.equal(predicateMet(142, 71, 'lower', 10, predicate), true)
  assert.equal(predicateMet(100, 150, 'higher', 10, predicate), true)
})

test('harness drift names every frozen file that changed or vanished', () => {
  const frozen = { command: 'node bench.mjs', files: { 'bench.mjs': 'aaa', 'fixtures/big.json': 'bbb', 'bench.config.json': 'ccc' } }
  assert.deepEqual(harnessDrift(frozen, { 'bench.mjs': 'aaa', 'fixtures/big.json': 'bbb', 'bench.config.json': 'ccc' }), [])
  assert.deepEqual(harnessDrift(frozen, { 'bench.mjs': 'zzz', 'bench.config.json': 'ccc' }), ['bench.mjs', 'fixtures/big.json'])
})

test('both runs having inconsistent work still revert as work-changed, and negative baselines compute signed targets', () => {
  const inconsistentBefore = summarize([...samples([100, 100, 100, 100], { work: 10 }), { value: 100, work: 11 }])
  const inconsistentAfter = summarize([...samples([50, 50, 50, 50], { work: 10 }), { value: 50, work: 12 }])
  assert.equal(inconsistentBefore.workInconsistent, true)
  assert.equal(inconsistentAfter.workInconsistent, true)
  const verdict = judgeAttempt(inconsistentBefore, inconsistentAfter, true, lower)
  assert.equal(verdict.kind === 'reverted' ? verdict.reason : undefined, 'work-changed')

  assert.equal(computeTargetValue(-100, 'higher', 0.2), -80)
  assert.equal(computeTargetValue(-100, 'lower', 0.2), -120)
  assert.equal(predicateMet(-100, -75, 'higher', 5, { targetRelativeGain: 0.2, minAttempts: 5 }), true)
})
