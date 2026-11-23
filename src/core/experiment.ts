/**
 * The hillclimb loop's arithmetic: sample a frozen harness, decide keep or
 * revert, and check the stop predicate. The agent proposes changes. This code
 * owns the number.
 *
 * Source: skills/poteto-mode/playbooks/hillclimb.md ("median of N, not a single
 * run", "Accept only when the metric moves past noise and the gate stays
 * green", "print its error count and a count of the work done") and the
 * explain-the-number principle.
 */

export interface Sample {
  readonly value: number
  /** Errors the harness counted during this sample. */
  readonly errors?: number
  /** Units of work the harness counted, so a faster run that did less is caught. */
  readonly work?: number
}

export type Direction = 'lower' | 'higher'

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('median of no values')
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
}

/** Median absolute deviation, scaled to estimate one standard deviation. */
export function scaledMad(values: readonly number[]): number {
  const center = median(values)
  return 1.4826 * median(values.map((value) => Math.abs(value - center)))
}

export interface Measurement {
  readonly count: number
  readonly median: number
  readonly spread: number
  readonly errors: number
  /** Undefined when the harness reports no work count or the samples disagree. */
  readonly work: number | undefined
  /** True when samples disagreed on `work` or reported non-finite work counts. */
  readonly workInconsistent?: boolean
}

export function summarize(samples: readonly Sample[]): Measurement {
  const values = samples.map((sample) => sample.value)
  const works = new Set(samples.map((sample) => sample.work))
  const [work] = works
  const anyWorkReported = samples.some((sample) => sample.work !== undefined)
  const invalidWorkValue = samples.some((sample) => sample.work !== undefined && !Number.isFinite(sample.work))
  const workInconsistent = (anyWorkReported && works.size > 1) || invalidWorkValue
  const errors = samples.reduce((sum, sample) => {
    if (sample.errors === undefined) return sum
    if (!Number.isFinite(sample.errors) || sample.errors < 0) return sum + 1
    return sum + sample.errors
  }, 0)
  return {
    count: samples.length,
    median: median(values),
    spread: scaledMad(values),
    errors,
    work: !workInconsistent && works.size === 1 ? work : undefined,
    ...(workInconsistent ? { workInconsistent: true } : {}),
  }
}

export interface JudgeOptions {
  readonly direction: Direction
  /** Samples each side needs before a verdict means anything. */
  readonly minSamples: number
  /** The gain must exceed this many spreads of the noisier side. */
  readonly noiseFactor: number
  /** The gain must also exceed this fraction of the baseline. */
  readonly minRelativeGain: number
}

export const DEFAULT_JUDGE_OPTIONS: Omit<JudgeOptions, 'direction'> = {
  minSamples: 5,
  noiseFactor: 3,
  minRelativeGain: 0.01,
}

export type RevertReason = 'too-few-samples' | 'harness-errors' | 'work-changed' | 'gate-red' | 'regressed' | 'within-noise'

export type AttemptVerdict =
  | { readonly kind: 'kept'; readonly gain: number; readonly relativeGain: number; readonly noise: number }
  | {
      readonly kind: 'reverted'
      readonly reason: RevertReason
      readonly gain: number
      readonly relativeGain: number
      readonly noise: number
    }

/**
 * Decide one attempt. Checks run in the order that invalidates the most: a
 * number from a broken or different run is rejected before it is compared.
 */
export function judgeAttempt(
  before: Measurement,
  after: Measurement,
  gateGreen: boolean,
  options: JudgeOptions,
): AttemptVerdict {
  const gain = options.direction === 'lower' ? before.median - after.median : after.median - before.median
  const relativeGain = before.median === 0 ? 0 : gain / Math.abs(before.median)
  const minFloor = before.median === 0 ? options.minRelativeGain : options.minRelativeGain * Math.abs(before.median)
  const noise = Math.max(options.noiseFactor * Math.max(before.spread, after.spread), minFloor)
  const reverted = (reason: RevertReason): AttemptVerdict => ({ kind: 'reverted', reason, gain, relativeGain, noise })

  if (before.count < options.minSamples || after.count < options.minSamples) return reverted('too-few-samples')
  if (after.errors > 0 || before.errors > 0) return reverted('harness-errors')
  if (before.workInconsistent === true || after.workInconsistent === true || before.work !== after.work) {
    return reverted('work-changed')
  }
  if (!gateGreen) return reverted('gate-red')
  if (gain < 0) return reverted('regressed')
  if (gain <= noise) return reverted('within-noise')
  return { kind: 'kept', gain, relativeGain, noise }
}

export interface StopPredicate {
  /** Fraction better than baseline, such as 0.5 for "at least 50% better". */
  readonly targetRelativeGain: number
  /** Floor on attempts, so a lucky early win cannot end the run. */
  readonly minAttempts: number
}

/** Signed target value matching `predicateMet` across positive and negative baselines. */
export function computeTargetValue(baseline: number, direction: Direction, targetRelativeGain: number): number {
  const delta = Math.abs(baseline) * targetRelativeGain
  return direction === 'lower' ? baseline - delta : baseline + delta
}

export function predicateMet(
  baseline: number,
  current: number,
  direction: Direction,
  attempts: number,
  predicate: StopPredicate,
): boolean {
  if (attempts < predicate.minAttempts || baseline === 0) return false
  const gain = direction === 'lower' ? baseline - current : current - baseline
  return gain / Math.abs(baseline) >= predicate.targetRelativeGain
}

/** A harness command and the files behind it, hashed when the harness froze. */
export interface FrozenHarness {
  readonly command: string
  readonly files: Readonly<Record<string, string>>
}

/** Paths whose content no longer matches the freeze. An empty list means intact. */
export function harnessDrift(frozen: FrozenHarness, currentHashes: Readonly<Record<string, string | undefined>>): string[] {
  return Object.entries(frozen.files)
    .filter(([path, hash]) => currentHashes[path] !== hash)
    .map(([path]) => path)
    .sort()
}
