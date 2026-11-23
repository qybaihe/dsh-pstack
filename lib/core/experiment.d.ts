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
    readonly value: number;
    /** Errors the harness counted during this sample. */
    readonly errors?: number;
    /** Units of work the harness counted, so a faster run that did less is caught. */
    readonly work?: number;
}
export type Direction = 'lower' | 'higher';
export declare function median(values: readonly number[]): number;
/** Median absolute deviation, scaled to estimate one standard deviation. */
export declare function scaledMad(values: readonly number[]): number;
export interface Measurement {
    readonly count: number;
    readonly median: number;
    readonly spread: number;
    readonly errors: number;
    /** Undefined when the harness reports no work count or the samples disagree. */
    readonly work: number | undefined;
    /** True when samples disagreed on `work` or reported non-finite work counts. */
    readonly workInconsistent?: boolean;
}
export declare function summarize(samples: readonly Sample[]): Measurement;
export interface JudgeOptions {
    readonly direction: Direction;
    /** Samples each side needs before a verdict means anything. */
    readonly minSamples: number;
    /** The gain must exceed this many spreads of the noisier side. */
    readonly noiseFactor: number;
    /** The gain must also exceed this fraction of the baseline. */
    readonly minRelativeGain: number;
}
export declare const DEFAULT_JUDGE_OPTIONS: Omit<JudgeOptions, 'direction'>;
export type RevertReason = 'too-few-samples' | 'harness-errors' | 'work-changed' | 'gate-red' | 'regressed' | 'within-noise';
export type AttemptVerdict = {
    readonly kind: 'kept';
    readonly gain: number;
    readonly relativeGain: number;
    readonly noise: number;
} | {
    readonly kind: 'reverted';
    readonly reason: RevertReason;
    readonly gain: number;
    readonly relativeGain: number;
    readonly noise: number;
};
/**
 * Decide one attempt. Checks run in the order that invalidates the most: a
 * number from a broken or different run is rejected before it is compared.
 */
export declare function judgeAttempt(before: Measurement, after: Measurement, gateGreen: boolean, options: JudgeOptions): AttemptVerdict;
export interface StopPredicate {
    /** Fraction better than baseline, such as 0.5 for "at least 50% better". */
    readonly targetRelativeGain: number;
    /** Floor on attempts, so a lucky early win cannot end the run. */
    readonly minAttempts: number;
}
/** Signed target value matching `predicateMet` across positive and negative baselines. */
export declare function computeTargetValue(baseline: number, direction: Direction, targetRelativeGain: number): number;
export declare function predicateMet(baseline: number, current: number, direction: Direction, attempts: number, predicate: StopPredicate): boolean;
/** A harness command and the files behind it, hashed when the harness froze. */
export interface FrozenHarness {
    readonly command: string;
    readonly files: Readonly<Record<string, string>>;
}
/** Paths whose content no longer matches the freeze. An empty list means intact. */
export declare function harnessDrift(frozen: FrozenHarness, currentHashes: Readonly<Record<string, string | undefined>>): string[];
