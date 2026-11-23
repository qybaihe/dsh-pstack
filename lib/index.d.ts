/**
 * Root `pstack` plugin row (`@qybaihe/dsh-pstack`).
 *
 * Owns the browser client face (`./client`), registers the full `pstack`
 * session projection (`summary: false`) plus the lightweight `pstackSummary`
 * projection (`summary: true` for sidebar rows), registers pstack's five Agent
 * Presets when `agentPresets` is present, injects DSH tool-name mappings into
 * `systemPrompt`, and mounts the `/pstack` RPC channel when `connection` is
 * present.
 *
 * @module @qybaihe/dsh-pstack
 */
import type { Context } from '@deepseek-ai/cordis';
import type { PstackFoldState, PstackView } from './core/projection.ts';
export declare const name = "pstack";
export declare const inject: string[];
export declare const PSTACK_PROJECTION_KEY = "pstack";
export declare const PSTACK_SUMMARY_PROJECTION_KEY = "pstackSummary";
export declare const PSTACK_PRESET_IDS: readonly ['poteto-agent', 'comment-sicko', 'pstack-adversary', 'pstack-judge', 'pstack-worker'];
export declare function checkView(value: unknown): PstackView;
export declare function checkFoldState(value: unknown): PstackFoldState;
export declare function apply(ctx: Context): void;
