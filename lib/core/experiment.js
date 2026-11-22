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
export function median(values) {
    if (values.length === 0)
        throw new RangeError('median of no values');
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
/** Median absolute deviation, scaled to estimate one standard deviation. */
export function scaledMad(values) {
    const center = median(values);
    return 1.4826 * median(values.map((value) => Math.abs(value - center)));
}
export function summarize(samples) {
    const values = samples.map((sample) => sample.value);
    const works = new Set(samples.map((sample) => sample.work));
    const [work] = works;
    return {
        count: samples.length,
        median: median(values),
        spread: scaledMad(values),
        errors: samples.reduce((sum, sample) => sum + (sample.errors ?? 0), 0),
        work: works.size === 1 ? work : undefined,
    };
}
export const DEFAULT_JUDGE_OPTIONS = {
    minSamples: 5,
    noiseFactor: 3,
    minRelativeGain: 0.01,
};
/**
 * Decide one attempt. Checks run in the order that invalidates the most: a
 * number from a broken or different run is rejected before it is compared.
 */
export function judgeAttempt(before, after, gateGreen, options) {
    const gain = options.direction === 'lower' ? before.median - after.median : after.median - before.median;
    const relativeGain = before.median === 0 ? 0 : gain / Math.abs(before.median);
    const noise = Math.max(options.noiseFactor * Math.max(before.spread, after.spread), options.minRelativeGain * Math.abs(before.median));
    const reverted = (reason) => ({ kind: 'reverted', reason, gain, relativeGain, noise });
    if (before.count < options.minSamples || after.count < options.minSamples)
        return reverted('too-few-samples');
    if (after.errors > 0)
        return reverted('harness-errors');
    if (before.work !== after.work)
        return reverted('work-changed');
    if (!gateGreen)
        return reverted('gate-red');
    if (gain < 0)
        return reverted('regressed');
    if (gain <= noise)
        return reverted('within-noise');
    return { kind: 'kept', gain, relativeGain, noise };
}
export function predicateMet(baseline, current, direction, attempts, predicate) {
    if (attempts < predicate.minAttempts || baseline === 0)
        return false;
    const gain = direction === 'lower' ? baseline - current : current - baseline;
    return gain / Math.abs(baseline) >= predicate.targetRelativeGain;
}
/** Paths whose content no longer matches the freeze. An empty list means intact. */
export function harnessDrift(frozen, currentHashes) {
    return Object.entries(frozen.files)
        .filter(([path, hash]) => currentHashes[path] !== hash)
        .map(([path]) => path)
        .sort();
}
