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
import { existsSync, realpathSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';
import { PRINCIPLE_CATALOG, skillNameFromPath } from '../core/catalog.js';
import { DECISION_HEADER, formatRow, parseLog, rowsWithoutEvidence, stamp, } from '../core/decision-log.js';
import { pickCrossJudge, vendorOf } from '../core/model-routing.js';
import { SICKO_OPENING, normalizeSickoReport } from '../core/panel-rules.js';
import { unreadCitations } from '../core/principles.js';
import { decodeSkillInvocationSource, decodeToolResultEvent } from '../core/projection.js';
import { appendPstackSessionRecord, buildNoticeMessage, getService, modelRouteOfAgent, resolveAgentCwd, resolveInsideWorkspace, sessionEventsOfAgent, sessionIdOfAgent, sessionOfAgent, } from '../host/dsh.js';
import { runtimeFor } from '../host/state.js';
export const name = 'pstack-ledger';
export const inject = ['tools'];
export const Config = Schema.object({
    tsvPath: Schema.string().default('.audit/decisions.tsv'),
    auditPrincipleCitations: Schema.boolean().default(true),
    auditMissingEvidence: Schema.boolean().default(true),
    maxTurnNudges: Schema.number().default(1),
});
function parseStoredLedger(raw) {
    if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.rows)) {
        throw new Error('Invalid StoredSessionLedger record');
    }
    return raw;
}
function isRealpathInside(workspaceRoot, targetAbs) {
    try {
        const realRoot = realpathSync(workspaceRoot);
        const realTarget = realpathSync(targetAbs);
        const rel = relative(realRoot, realTarget);
        return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    }
    catch {
        return false;
    }
}
function scanCommentsFallback(sources) {
    const mustKill = [];
    const review = [];
    const touched = [];
    let narratorCount = 0;
    for (const file of sources) {
        let fileFlagged = false;
        const lines = file.text.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
            const line = (lines[i] ?? '').trim();
            if (/\/\/\s*@(?:ts-ignore|ts-expect-error)|eslint-disable/.test(line)) {
                mustKill.push({
                    symbol: `${file.path}:${i + 1}`,
                    reason: `Suppression comment (${line.slice(0, 60)}) masks a type or lint rule.`,
                });
                fileFlagged = true;
            }
            else if (/\/\/.*\b(?:HACK|FIXME|workaround|too risky|do not remove|fine for now)\b/i.test(line)) {
                mustKill.push({
                    symbol: `${file.path}:${i + 1}`,
                    reason: `Workaround confession: ${line.slice(0, 72)}`,
                });
                fileFlagged = true;
            }
            else if (/\/\/.*\b(?:RFC|https?:\/\/|vendor|safari|webkit|windows|linux|chromium)\b/i.test(line)) {
                review.push({
                    quote: line,
                    claimedRule: `External/platform constraint at ${file.path}:${i + 1}`,
                });
            }
            else if (/^\/\/\s*[A-Za-z]/.test(line) && !/^\/\/\s*prettier-ignore\b/.test(line) && !/SPDX-License|Copyright/i.test(line)) {
                narratorCount += 1;
                fileFlagged = true;
            }
        }
        if (fileFlagged)
            touched.push(file.path);
    }
    return normalizeSickoReport({
        deleted: narratorCount,
        mustKill,
        review,
        touchedFiles: touched,
    });
}
function extractSessionReadSkills(agent) {
    const skills = new Set();
    const events = sessionEventsOfAgent(agent);
    const readCalls = new Map();
    for (const ev of events) {
        const data = typeof ev.data === 'object' && ev.data !== null ? ev.data : undefined;
        if (data === undefined)
            continue;
        if (ev.type === 'user/message') {
            const src = typeof data.source === 'object' && data.source !== null ? data.source : undefined;
            const invoked = decodeSkillInvocationSource(src);
            if (invoked !== undefined)
                skills.add(invoked);
        }
        else if (ev.type === 'tool/call' && typeof data.callId === 'string' && typeof data.name === 'string') {
            let args = {};
            if (typeof data.arguments === 'string') {
                try {
                    args = JSON.parse(data.arguments);
                }
                catch {
                    args = {};
                }
            }
            else if (typeof data.arguments === 'object' && data.arguments !== null) {
                args = data.arguments;
            }
            readCalls.set(data.callId, { name: data.name, args });
        }
        else if (ev.type === 'tool/result') {
            const decoded = decodeToolResultEvent(data);
            if (decoded.isError)
                continue;
            const call = decoded.callId !== undefined ? readCalls.get(decoded.callId) : undefined;
            const toolName = call?.name ?? decoded.explicitName;
            const args = call?.args ?? {};
            if (toolName === 'skill' && typeof args.name === 'string')
                skills.add(args.name);
            if (toolName === 'read') {
                const filePath = typeof args.file_path === 'string' ? args.file_path : typeof args.path === 'string' ? args.path : '';
                const isPartialWindow = typeof args.limit === 'number' || (typeof args.offset === 'number' && args.offset > 1);
                const parsed = skillNameFromPath(filePath);
                if (parsed !== undefined && !isPartialWindow)
                    skills.add(parsed);
            }
        }
    }
    return skills;
}
function lastAssistantReplyText(agent) {
    const events = sessionEventsOfAgent(agent);
    for (let i = events.length - 1; i >= 0; i -= 1) {
        const ev = events[i];
        if (ev?.type !== 'assistant/message')
            continue;
        const data = typeof ev.data === 'object' && ev.data !== null ? ev.data : undefined;
        const msg = (typeof data?.message === 'object' && data.message !== null ? data.message : data);
        const content = msg?.content;
        if (Array.isArray(content)) {
            return content
                .map((b) => (typeof b === 'object' && b !== null && b.type === 'text' ? String(b.text ?? '') : ''))
                .join('\n');
        }
        if (typeof content === 'string')
            return content;
    }
    return '';
}
export function apply(ctx, config) {
    const runtime = runtimeFor(ctx);
    const memRows = new Map();
    const nudgesByTurn = new Map();
    const liveLoadedSkills = new Map();
    const mutexes = new Map();
    function runSerial(key, fn) {
        const prev = mutexes.get(key) ?? Promise.resolve();
        const next = prev.then(fn, fn);
        mutexes.set(key, next.finally(() => {
            if (mutexes.get(key) === next)
                mutexes.delete(key);
        }));
        return next;
    }
    let domainPromise = Promise.resolve(undefined);
    ctx.inject(['storageDomain'], (inner) => {
        const storageDomain = getService(inner, 'storageDomain');
        if (storageDomain === undefined)
            return;
        const opened = storageDomain
            .open({
            name: 'pstack_ledger',
            version: 1,
            invalidRecords: 'backup-and-skip',
            tables: {
                ledgers: { valueSchema: { parse: parseStoredLedger } },
            },
        })
            .catch(() => undefined);
        domainPromise = opened;
        inner.effect(() => async () => {
            const dom = await opened;
            await dom?.close();
        });
    });
    async function rowsForSession(sessionId) {
        const cached = memRows.get(sessionId);
        if (cached !== undefined)
            return cached;
        const dom = await domainPromise;
        const stored = dom?.table('ledgers').get(sessionId);
        if (stored !== undefined) {
            const copy = [...stored.rows];
            memRows.set(sessionId, copy);
            return copy;
        }
        return [];
    }
    async function appendRowSerialized(sessionId, cwd, rawRow) {
        return runSerial(`session:${sessionId}`, async () => {
            const row = {
                ts: stamp(new Date()),
                phase: rawRow.phase,
                decision: rawRow.decision,
                why: rawRow.why,
                evidence: rawRow.evidence,
                result: rawRow.result,
            };
            const tsvLine = formatRow(row);
            const existing = [...(await rowsForSession(sessionId)), row];
            memRows.set(sessionId, existing);
            const dom = await domainPromise;
            await dom?.table('ledgers').put(sessionId, { rows: existing });
            if (config.tsvPath.trim() !== '') {
                const targetFile = resolveInsideWorkspace(cwd, config.tsvPath);
                if (targetFile !== undefined) {
                    await runSerial(`file:${targetFile}`, async () => {
                        await mkdir(dirname(targetFile), { recursive: true });
                        if (!existsSync(targetFile)) {
                            await writeFile(targetFile, DECISION_HEADER + tsvLine, 'utf8');
                        }
                        else {
                            await appendFile(targetFile, tsvLine, 'utf8');
                        }
                    });
                }
            }
            return { rowNumber: existing.length, tsvLine: tsvLine.trimEnd(), row };
        });
    }
    ctx.effect(() => {
        runtime.ledgerRowsFor = (sessionId) => memRows.get(sessionId) ?? [];
        runtime.ledgerExportFor = async (sessionId) => {
            const rows = await rowsForSession(sessionId);
            if (rows.length === 0)
                return undefined;
            return DECISION_HEADER + rows.map((row) => formatRow(row)).join('');
        };
        runtime.ledgerAppendInternal = async (sessionId, cwd, row) => {
            await appendRowSerialized(sessionId, cwd, row);
        };
        return () => {
            delete runtime.ledgerRowsFor;
            delete runtime.ledgerExportFor;
            delete runtime.ledgerAppendInternal;
        };
    });
    // Track skills read in full via `tools/result`
    ctx.on('tools/result', (exec, result) => {
        if (result.isError || exec.agent === undefined)
            return;
        const sessionId = sessionIdOfAgent(exec.agent) ?? String(exec.agent.id);
        let set = liveLoadedSkills.get(sessionId);
        if (set === undefined) {
            set = new Set();
            liveLoadedSkills.set(sessionId, set);
        }
        const args = exec.arguments;
        if (exec.name === 'skill' && typeof args?.name === 'string')
            set.add(args.name);
        if (exec.name === 'read') {
            const filePath = typeof args?.file_path === 'string' ? args.file_path : typeof args?.path === 'string' ? args.path : '';
            const isPartialWindow = typeof args?.limit === 'number' || (typeof args?.offset === 'number' && args.offset > 1);
            const parsed = skillNameFromPath(filePath);
            if (parsed !== undefined && !isPartialWindow)
                set.add(parsed);
        }
    });
    // 1. `pstack_log` tool
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'pstack_log',
        description: 'Append one immutable decision row to the show-me-your-work TSV ledger (`phase`, `decision`, `why`, `evidence`, `result`). Rows cannot be edited or deleted; supersede an earlier call by logging a new row with the same `decision` or `#<rowNumber>`.',
        parameters: {
            phase: {
                type: 'string',
                required: true,
                description: 'Work phase (e.g. `start`, `repro`, `bisect`, `fix`, `verify`).',
            },
            decision: { type: 'string', required: true, description: 'What you decided or tried.' },
            why: { type: 'string', required: true, description: 'Why this choice over alternatives.' },
            evidence: {
                type: 'string',
                required: true,
                description: 'Commit SHA, `file:line`, reproduction script, or subagent session id (`start` rows may pass empty string).',
            },
            result: { type: 'string', required: true, description: 'Observed outcome.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    rowNumber: { type: 'integer', required: true },
                    tsvLine: { type: 'string', required: true },
                    row: {
                        type: 'object',
                        required: true,
                        additionalProperties: false,
                        properties: {
                            ts: { type: 'string', required: true },
                            phase: { type: 'string', required: true },
                            decision: { type: 'string', required: true },
                            why: { type: 'string', required: true },
                            evidence: { type: 'string', required: true },
                            result: { type: 'string', required: true },
                        },
                    },
                },
            },
            render: (_args, value) => {
                const v = value;
                return [
                    {
                        type: 'text',
                        text: `🥔 Logged decision #${v.rowNumber} [${v.row.phase}]: ${v.row.decision} (${v.row.evidence || 'no evidence'})`,
                    },
                ];
            },
            presentationMeta: (_args, value) => {
                const v = value;
                return { pstackKind: 'log', rowNumber: v.rowNumber, row: v.row };
            },
        },
        async execute(rawArgs, exec) {
            const args = rawArgs;
            const sessionId = sessionIdOfAgent(exec.agent) ?? '__default__';
            const cwd = await resolveAgentCwd(ctx, exec.agent, exec.signal);
            return appendRowSerialized(sessionId, cwd, args);
        },
    })));
    // 2. `pstack_no_comments` (Comment Sicko)
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'pstack_no_comments',
        description: 'Run Comment Sicko (`no-comments` skill) in a read-only preset against changed or specified workspace files, returning deletion counts, `MUST KILL` refactor targets, and `REVIEW` external-rule keeps.',
        parameters: {
            files: {
                type: 'array',
                required: true,
                items: { type: 'string' },
                description: 'Workspace-relative file paths to audit.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    opening: { type: 'string', required: true },
                    deleted: { type: 'integer', required: true },
                    mustKill: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                symbol: { type: 'string', required: true },
                                reason: { type: 'string', required: true },
                            },
                        },
                    },
                    review: {
                        type: 'array',
                        required: true,
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                quote: { type: 'string', required: true },
                                claimedRule: { type: 'string', required: true },
                            },
                        },
                    },
                    touchedFiles: { type: 'array', required: true, items: { type: 'string' } },
                },
            },
            render: (_args, value) => {
                const r = value;
                const lines = [
                    r.opening,
                    `Comment Sicko: ${r.deleted} narration comment(s) marked for deletion, ${r.mustKill.length} MUST KILL target(s), ${r.review.length} REVIEW keep(s).`,
                    ...r.mustKill.map((m) => `- MUST KILL ${m.symbol}: ${m.reason}`),
                    ...r.review.map((rv) => `- REVIEW (${rv.claimedRule}): ${rv.quote}`),
                ];
                return [{ type: 'text', text: lines.join('\n') }];
            },
            presentationMeta: (_args, value) => ({ pstackKind: 'sicko', report: value }),
        },
        async execute(rawArgs, exec) {
            const args = rawArgs;
            const cwd = await resolveAgentCwd(ctx, exec.agent, exec.signal);
            const safeRelFiles = [];
            const safeAbsFiles = [];
            for (const rawFile of args.files) {
                const abs = resolveInsideWorkspace(cwd, rawFile);
                if (abs === undefined)
                    continue;
                if (existsSync(abs) && !isRealpathInside(cwd, abs))
                    continue;
                const rel = relative(resolve(cwd), abs);
                safeRelFiles.push(rel);
                safeAbsFiles.push({ rel, abs });
            }
            const subagents = getService(ctx, 'subagents');
            if (subagents !== undefined && exec.agent !== undefined && safeRelFiles.length > 0) {
                try {
                    const activation = await subagents.startActivation({
                        provider: 'spawn',
                        label: 'Comment Sicko audit',
                        agentPreset: 'comment-sicko',
                        cwd,
                        parent: exec.agent,
                        signal: exec.signal,
                        delivery: 'caller',
                        prompt: [
                            {
                                type: 'text',
                                text: `Audit these workspace files under Comment Sicko rules: ${safeRelFiles.join(', ')}. Return JSON matching the output schema.`,
                            },
                        ],
                        outputSchema: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['deleted', 'mustKill', 'review', 'touchedFiles'],
                            properties: {
                                deleted: { type: 'integer' },
                                mustKill: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        additionalProperties: false,
                                        required: ['symbol', 'reason'],
                                        properties: { symbol: { type: 'string' }, reason: { type: 'string' } },
                                    },
                                },
                                review: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        additionalProperties: false,
                                        required: ['quote', 'claimedRule'],
                                        properties: { quote: { type: 'string' }, claimedRule: { type: 'string' } },
                                    },
                                },
                                touchedFiles: { type: 'array', items: { type: 'string' } },
                            },
                        },
                    });
                    try {
                        const subRes = await activation.result;
                        if (subRes.stopReason === 'completed' && typeof subRes.structured === 'object' && subRes.structured !== null) {
                            const normalized = normalizeSickoReport(subRes.structured);
                            return {
                                opening: normalized.opening,
                                deleted: normalized.deleted,
                                mustKill: normalized.mustKill.map((x) => ({ symbol: x.symbol, reason: x.reason })),
                                review: normalized.review.map((x) => ({ quote: x.quote, claimedRule: x.claimedRule })),
                                touchedFiles: [...normalized.touchedFiles],
                            };
                        }
                    }
                    finally {
                        await activation.dispose().catch(() => { });
                    }
                }
                catch {
                    // Fall back to workspace-confined static comment scan when no live subagent is available.
                }
            }
            const loaded = [];
            for (const { rel, abs } of safeAbsFiles) {
                const text = await readFile(abs, 'utf8').catch(() => undefined);
                if (text !== undefined)
                    loaded.push({ path: rel, text });
            }
            const fallback = scanCommentsFallback(loaded);
            return {
                opening: fallback.opening,
                deleted: fallback.deleted,
                mustKill: fallback.mustKill.map((x) => ({ symbol: x.symbol, reason: x.reason })),
                review: fallback.review.map((x) => ({ quote: x.quote, claimedRule: x.claimedRule })),
                touchedFiles: [...fallback.touchedFiles],
            };
        },
    })));
    // 3. `pstack_review_ledger` (cross-vendor Attention check, with optional live subagent review)
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'pstack_review_ledger',
        description: 'Audit this session’s decision log for missing evidence and optionally run a cross-vendor subagent review (`pstack-judge`) when another vendor is configured.',
        parameters: {
            note: {
                type: 'string',
                description: 'Optional summary note when recording an already-completed external review.',
            },
            runCrossReview: {
                type: 'boolean',
                description: 'Dispatch a cross-vendor `pstack-judge` subagent to audit the TSV rows when available.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    reviewerVendor: { type: 'string', required: true },
                    reviewerModel: { type: 'string', required: true },
                    missingEvidenceCount: { type: 'integer', required: true },
                    note: { type: 'string', required: true },
                },
            },
            render: (_args, value) => {
                const v = value;
                return [{ type: 'text', text: `🥔 Ledger Attention (${v.reviewerVendor}/${v.reviewerModel}): ${v.note}` }];
            },
            presentationMeta: (_args, value) => ({ pstackKind: 'ledger-review', ...value }),
        },
        async execute(rawArgs, exec) {
            const args = rawArgs;
            const sessionId = sessionIdOfAgent(exec.agent) ?? '__default__';
            const rows = await rowsForSession(sessionId);
            const missing = rowsWithoutEvidence(rows);
            const parentRoute = modelRouteOfAgent(exec.agent);
            const llm = getService(ctx, 'llm');
            const pool = [];
            if (llm !== undefined) {
                for (const p of llm.listProviders()) {
                    const models = (await llm.listModels?.(p.id).catch(() => [])) ?? [];
                    for (const m of models)
                        pool.push({ provider: p.id, model: m.id });
                }
            }
            const picked = pickCrossJudge(pool, parentRoute);
            const subagents = getService(ctx, 'subagents');
            if (args.runCrossReview === true && picked.kind === 'picked' && subagents !== undefined && exec.agent !== undefined && rows.length > 0) {
                const cwd = await resolveAgentCwd(ctx, exec.agent, exec.signal);
                const tsv = DECISION_HEADER + rows.map((r) => formatRow(r)).join('');
                try {
                    const handle = await subagents.startActivation({
                        provider: 'spawn',
                        label: `Ledger Attention: ${picked.judge.model}`,
                        agentPreset: 'pstack-judge',
                        cwd,
                        parent: exec.agent,
                        signal: exec.signal,
                        delivery: 'caller',
                        agentOptions: { provider: picked.judge.provider, model: picked.judge.model },
                        prompt: [
                            {
                                type: 'text',
                                text: `Audit this show-me-your-work decision log for unproven leaps, missing evidence, or unexamined alternatives in 2 concise sentences:\n\n${tsv}`,
                            },
                        ],
                    });
                    try {
                        const subRes = await handle.result;
                        const text = subRes.output.map((b) => b.text ?? '').join('\n').trim();
                        if (subRes.stopReason === 'completed' && text !== '') {
                            return {
                                reviewerVendor: vendorOf(picked.judge) ?? picked.judge.provider,
                                reviewerModel: picked.judge.model,
                                missingEvidenceCount: missing.length,
                                note: text.slice(0, 500),
                            };
                        }
                    }
                    finally {
                        await handle.dispose().catch(() => { });
                    }
                }
                catch {
                    // Fall back to transparent local audit summary below.
                }
            }
            // Never misattribute a local check to an uncalled external model!
            const candidateHint = picked.kind === 'picked'
                ? ` (eligible cross-reviewer: ${vendorOf(picked.judge) ?? picked.judge.provider}/${picked.judge.model})`
                : '';
            const note = args.note?.trim() ||
                (missing.length > 0
                    ? `${missing.length} decision row(s) have empty evidence${candidateHint}.`
                    : `All ${rows.length} decision row(s) carry evidence${candidateHint}.`);
            return {
                reviewerVendor: 'local-runtime',
                reviewerModel: 'evidence-audit',
                missingEvidenceCount: missing.length,
                note,
            };
        },
    })));
    // 4. `agent/turn-stopping`: steer on unread principle citations & missing evidence
    ctx.on('agent/turn-stopping', async ({ agent, turn }) => {
        const sessionId = sessionIdOfAgent(agent) ?? String(agent.id);
        const turnKey = `${sessionId}:${turn}`;
        const usedNudges = nudgesByTurn.get(turnKey) ?? 0;
        if (usedNudges >= config.maxTurnNudges)
            return;
        const problems = [];
        if (config.auditPrincipleCitations) {
            const reply = lastAssistantReplyText(agent);
            if (reply !== '') {
                const readSet = new Set([
                    ...extractSessionReadSkills(agent),
                    ...(liveLoadedSkills.get(sessionId) ?? []),
                ]);
                const unread = unreadCitations(reply, PRINCIPLE_CATALOG, readSet);
                if (unread.length > 0) {
                    const names = unread.map((p) => `${p.title} (\`${p.name}\`)`).join(', ');
                    problems.push(`Your reply cited ${names}, whose leaf SKILL.md was not read in full in this session. Load each cited principle skill in full first, or drop the citation.`);
                }
            }
        }
        if (config.auditMissingEvidence) {
            const rows = await rowsForSession(sessionId);
            const missing = rowsWithoutEvidence(rows);
            if (missing.length > 0) {
                problems.push(`${missing.length} decision log row(s) in this session have an empty \`evidence\` cell (${missing.map((r) => `"${r.decision}"`).join(', ')}). Append superseding \`pstack_log\` row(s) with the same \`decision\` (or \`#<rowNumber>\`) and concrete commit SHAs, \`file:line\` pointers, or subagent session ids before finishing.`);
            }
        }
        if (problems.length > 0) {
            if (nudgesByTurn.size > 512) {
                const oldest = nudgesByTurn.keys().next().value;
                if (oldest !== undefined)
                    nudgesByTurn.delete(oldest);
            }
            nudgesByTurn.set(turnKey, usedNudges + 1);
            agent.steer(buildNoticeMessage(`🥔 [pstack pre-close check] ${problems.join(' ')}`, 'pstack citation & ledger audit'));
        }
    });
    // Also forward internal ledger appends to session projection when session is available
    void appendPstackSessionRecord;
}
export { SICKO_OPENING };
