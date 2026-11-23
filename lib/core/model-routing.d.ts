/**
 * Which vendor trained a model, and which seat may judge.
 *
 * DeepSeek Harness names a model by the pair `{ provider, model }`, and a
 * provider can be a gateway that serves many vendors. Nothing in the harness
 * records the vendor, so pstack's cross-vendor rule needs this table.
 *
 * Source: skills/arena/SKILL.md Phase C ("The judge is never from the parent's
 * vendor", "use the first entry from another vendor") and
 * skills/setup-pstack/SKILL.md (an `inherit-parent` value never judges; the
 * budget lowers each role's effort on the ladder).
 */
export interface ModelRoute {
    readonly provider: string;
    readonly model: string;
    readonly effort?: string;
}
/** A panel entry: a route, or the parent chat's own model. */
export type Seat = ModelRoute | 'inherit-parent';
/** Parse `inherit-parent`, `auto`, `provider/model`, or `provider/model@effort` identically on host and client. */
export declare function parseSeatSpec(raw: string): Seat;
/** Parse manual `provider/model=vendor` override lines and report malformed non-empty lines. */
export declare function parseVendorOverridesText(text: string): {
    readonly overrides: Record<string, string>;
    readonly invalidLines: string[];
};
/**
 * The vendor of a route, or undefined when nothing identifies it. `overrides`
 * maps `provider/model` or `provider` to a vendor and wins over every guess.
 * The model name outranks the provider, because a gateway serves many vendors.
 */
export declare function vendorOf(route: ModelRoute, overrides?: Readonly<Record<string, string>>): string | undefined;
export type JudgePick = {
    readonly kind: 'picked';
    readonly judge: ModelRoute;
    readonly vendorCheck: 'ran' | 'skipped-unknown-parent';
} | {
    readonly kind: 'none';
    readonly reason: 'empty-pool' | 'no-other-vendor';
};
/**
 * Pick the cross-judge from a pool ordered by preference. A seat judges only
 * when its vendor is known and differs from the parent's. When the parent's
 * vendor is unknown the check cannot run, and the result says so.
 */
export declare function pickCrossJudge(pool: readonly Seat[], parent: ModelRoute | undefined, overrides?: Readonly<Record<string, string>>): JudgePick;
/** The distinct vendors on a panel. A seat with no known vendor counts as `unknown`. */
export declare function panelVendors(seats: readonly Seat[], parent: ModelRoute | undefined, overrides?: Readonly<Record<string, string>>): string[];
export declare const EFFORT_LADDER: readonly ['low', 'medium', 'high', 'xhigh'];
export type Effort = (typeof EFFORT_LADDER)[number];
export type Budget = 'large' | 'medium' | 'small';
/** A role's default effort moved down by the budget. The bottom of the ladder holds. */
export declare function effortForBudget(defaultEffort: Effort, budget: Budget): Effort;
/**
 * The highest effort a model supports at or below the target, or undefined
 * when it supports none that low. Efforts off the ladder are ignored.
 */
export declare function supportedEffort(target: Effort, supported: readonly string[]): Effort | undefined;
