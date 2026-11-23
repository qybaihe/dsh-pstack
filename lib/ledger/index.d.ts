/**
 * Decision ledger, principle citation audit, and Comment Sicko
 * (`@qybaihe/dsh-pstack/ledger`, M1 + M2):
 * - `pstack_log`: append-only TSV decision log matching `show-me-your-work`'s
 *   `log.sh` byte-for-byte, serialized per session & file, persisted in
 *   `ctx.storageDomain` and mirrored to `<cwd>/.audit/decisions.tsv`.
 * - `pstack_no_comments`: spawns `comment-sicko` (or inspects workspace-confined
 *   files statically when subagents are absent) and produces the Sicko card.
 * - `pstack_review_ledger`: records cross-vendor Attention review or runs a
 *   transparent local evidence audit without misattributing to uncalled models.
 * - `agent/turn-stopping`: audits closing prose for unread principle citations
 *   (`unreadCitations`) and decision rows lacking evidence (`rowsWithoutEvidence`),
 *   steering the agent once per turn to fix either before closing.
 *
 * @module @qybaihe/dsh-pstack/ledger
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { SICKO_OPENING } from '../core/panel-rules.ts';
export declare const name = "pstack-ledger";
export declare const inject: string[];
export interface Config {
    /** Relative path in the workspace where TSV rows are mirrored (`log.sh` compatible). */
    tsvPath: string;
    /** Steer the agent at `agent/turn-stopping` when it cites an unread principle. */
    auditPrincipleCitations: boolean;
    /** Steer the agent at `agent/turn-stopping` when logged decisions lack evidence. */
    auditMissingEvidence: boolean;
    /** Maximum steering nudges per turn so an uncooperative model never loops forever. */
    maxTurnNudges: number;
}
export declare const Config: Schema<Partial<Config>, Config>;
export declare function apply(ctx: Context, config: Config): void;
export { SICKO_OPENING };
