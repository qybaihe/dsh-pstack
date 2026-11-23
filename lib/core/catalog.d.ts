/**
 * Canonical catalog of pstack's 24 principles and 22 playbooks, matching
 * `skills/poteto-mode/SKILL.md` so the runtime and the UI agree on order,
 * grouping, and slugs without touching the harness.
 */
import type { Playbook } from './playbook.ts';
import type { Principle } from './principles.ts';
export type PrincipleGroupId = 'core' | 'architecture' | 'verification' | 'delegation' | 'meta';
export interface CatalogPrinciple extends Principle {
    readonly group: PrincipleGroupId;
}
export declare const PRINCIPLE_GROUPS: readonly {
    readonly id: PrincipleGroupId;
    readonly labelEn: string;
    readonly labelZh: string;
}[];
/** All 24 leaf principles in the exact order `poteto-mode/SKILL.md` lists them. */
export declare const PRINCIPLE_CATALOG: readonly CatalogPrinciple[];
/** All 22 playbooks in the order `poteto-mode/SKILL.md` lists them. */
export declare const PLAYBOOK_TITLES: readonly string[];
export interface PlaybookSummary {
    readonly slug: string;
    readonly title: string;
    readonly stance: string;
    readonly stepCount: number;
}
export interface HeroPlaybookInfo {
    readonly slug: string;
    readonly title: string;
    readonly hintZh: string;
    readonly hintEn: string;
    readonly stanceZh: string;
    readonly stanceEn: string;
    readonly previewSteps: readonly string[];
    readonly previewStepsZh: readonly string[];
}
export declare const HERO_FEATURED_PLAYBOOKS: readonly HeroPlaybookInfo[];
export interface LoadedPlaybookCatalog {
    readonly bySlug: ReadonlyMap<string, Playbook>;
    readonly knownSkills: ReadonlySet<string>;
}
export declare function playbookSlugFromPath(filePath: string): string | undefined;
export declare function skillNameFromPath(filePath: string): string | undefined;
export declare function resolvePlaybookSlug(input: string): string;
