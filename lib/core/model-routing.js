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
/** Model-name prefixes, most specific first. */
const MODEL_FAMILIES = [
    ['claude', 'anthropic'],
    ['gpt', 'openai'],
    ['chatgpt', 'openai'],
    ['codex', 'openai'],
    ['o1', 'openai'],
    ['o3', 'openai'],
    ['o4', 'openai'],
    ['gemini', 'google'],
    ['gemma', 'google'],
    ['deepseek', 'deepseek'],
    ['grok', 'xai'],
    ['glm', 'zai'],
    ['kimi', 'moonshotai'],
    ['moonshot', 'moonshotai'],
    ['qwen', 'alibaba'],
    ['mistral', 'mistral'],
    ['codestral', 'mistral'],
    ['devstral', 'mistral'],
    ['llama', 'meta'],
    ['minimax', 'minimax'],
    ['doubao', 'bytedance'],
];
/** Provider routes that serve one vendor's models and no one else's. */
const DIRECT_PROVIDERS = {
    anthropic: 'anthropic',
    openai: 'openai',
    google: 'google',
    deepseek: 'deepseek',
    'deepseek-official': 'deepseek',
    xai: 'xai',
    mistral: 'mistral',
    zai: 'zai',
    moonshotai: 'moonshotai',
    minimax: 'minimax',
};
const KNOWN_VENDORS = new Set([...MODEL_FAMILIES.map(([, vendor]) => vendor), ...Object.values(DIRECT_PROVIDERS)]);
function vendorOfModelId(model) {
    const id = model.toLowerCase();
    // A gateway writes the vendor in front: `anthropic/claude-...`.
    const slash = id.indexOf('/');
    if (slash > 0) {
        const head = id.slice(0, slash);
        if (KNOWN_VENDORS.has(head))
            return head;
        return vendorOfModelId(id.slice(slash + 1));
    }
    return MODEL_FAMILIES.find(([prefix]) => id === prefix || id.startsWith(`${prefix}-`) || id.startsWith(`${prefix}.`))?.[1];
}
/**
 * The vendor of a route, or undefined when nothing identifies it. `overrides`
 * maps `provider/model` or `provider` to a vendor and wins over every guess.
 * The model name outranks the provider, because a gateway serves many vendors.
 */
export function vendorOf(route, overrides = {}) {
    return (overrides[`${route.provider}/${route.model}`] ??
        overrides[route.provider] ??
        vendorOfModelId(route.model) ??
        DIRECT_PROVIDERS[route.provider.toLowerCase()]);
}
/**
 * Pick the cross-judge from a pool ordered by preference. A seat judges only
 * when its vendor is known and differs from the parent's. When the parent's
 * vendor is unknown the check cannot run, and the result says so.
 */
export function pickCrossJudge(pool, parent, overrides = {}) {
    const routes = pool.filter((seat) => seat !== 'inherit-parent');
    const [first] = routes;
    if (first === undefined)
        return { kind: 'none', reason: 'empty-pool' };
    const parentVendor = parent === undefined ? undefined : vendorOf(parent, overrides);
    if (parentVendor === undefined)
        return { kind: 'picked', judge: first, vendorCheck: 'skipped-unknown-parent' };
    const judge = routes.find((route) => {
        const vendor = vendorOf(route, overrides);
        return vendor !== undefined && vendor !== parentVendor;
    });
    return judge === undefined ? { kind: 'none', reason: 'no-other-vendor' } : { kind: 'picked', judge, vendorCheck: 'ran' };
}
/** The distinct vendors on a panel. A seat with no known vendor counts as `unknown`. */
export function panelVendors(seats, parent, overrides = {}) {
    const vendors = seats.map((seat) => {
        const route = seat === 'inherit-parent' ? parent : seat;
        return (route === undefined ? undefined : vendorOf(route, overrides)) ?? 'unknown';
    });
    return [...new Set(vendors)].sort();
}
export const EFFORT_LADDER = ['low', 'medium', 'high', 'xhigh'];
const BUDGET_STEPS = { large: 0, medium: 1, small: 2 };
/** A role's default effort moved down by the budget. The bottom of the ladder holds. */
export function effortForBudget(defaultEffort, budget) {
    const index = Math.max(0, EFFORT_LADDER.indexOf(defaultEffort) - BUDGET_STEPS[budget]);
    return EFFORT_LADDER[index];
}
/**
 * The highest effort a model supports at or below the target, or undefined
 * when it supports none that low. Efforts off the ladder are ignored.
 */
export function supportedEffort(target, supported) {
    for (let index = EFFORT_LADDER.indexOf(target); index >= 0; index -= 1) {
        const effort = EFFORT_LADDER[index];
        if (supported.includes(effort))
            return effort;
    }
    return undefined;
}
