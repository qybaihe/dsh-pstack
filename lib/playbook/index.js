/**
 * Playbook lifecycle (`@qybaihe/dsh-pstack/playbook`, M1):
 * - Recognizes when a session opens a playbook (or `/playbook <name>`).
 * - Seeds steps directly into DSH's native `todo/write` log AND tracks
 *   multi-turn progress through `pstack_step`.
 * - Tightens runtime policy per playbook:
 *     - `babysit`: upgrades force-push from approval to outright denial.
 *     - `autopilot-stack`: denies `gh pr merge` and force-push so stacks stop at
 *       verified state until the operator signs off.
 *     - `investigation`: restricts mutating file tools (`write`, `edit`,
 *       `apply_patch`), mutating `pstack_*` tools, and shell file redirects
 *       until the operator or an evidenced transition switches playbooks.
 *
 * @module @qybaihe/dsh-pstack/playbook
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';
import { PLAYBOOK_TITLES, playbookSlugFromPath, resolvePlaybookSlug } from '../core/catalog.js';
import { parsePlaybook } from '../core/playbook.js';
import { shellWriteTargets } from '../core/shell-policy.js';
import { appendPstackSessionRecord, getService, loadVendoredCatalog, sessionIdOfAgent, sessionOfAgent, } from '../host/dsh.js';
import { runtimeFor } from '../host/state.js';
export const name = 'pstack-playbook';
export const inject = ['tools'];
export const Config = Schema.object({
    seedNativeTodo: Schema.boolean().default(true),
    autoArmTddOnStep: Schema.boolean().default(true),
    lockWritesInInvestigation: Schema.boolean().default(true),
});
const WRITE_TOOLS = ['write', 'edit', 'apply_patch', 'pstack_arena_adopt', 'pstack_attempt'];
const SHELL_TOOLS = new Set(['bash', 'pwsh']);
function writeTodoSnapshot(agent, playbook, currentStep, completed) {
    const session = sessionOfAgent(agent);
    if (session === undefined || playbook.steps.length === 0)
        return;
    const seen = new Set();
    const todos = playbook.steps.map((step) => {
        let content = `${step.index}. ${step.label}`;
        if (seen.has(content))
            content = `${content} (#${step.index})`;
        seen.add(content);
        const status = completed || (currentStep > 0 && step.index < currentStep)
            ? 'completed'
            : step.index === currentStep
                ? 'in_progress'
                : 'pending';
        return { content, status };
    });
    try {
        session.append('todo/write', { todos });
    }
    catch {
        // Non-standard session mocks without `todo/write` support ignore seeding.
    }
}
export function apply(ctx, config) {
    const catalog = loadVendoredCatalog();
    const runtime = runtimeFor(ctx);
    const restrictionDisposers = new Map();
    ctx.effect(() => () => {
        for (const dispose of restrictionDisposers.values()) {
            try {
                dispose();
            }
            catch {
                // Ignore disposed scopes on plugin teardown.
            }
        }
        restrictionDisposers.clear();
    });
    function applyPlaybookPolicy(agent, slug) {
        const sessionId = sessionIdOfAgent(agent);
        if (sessionId === undefined)
            return;
        const policy = runtime.sessionPolicy(sessionId, sessionOfAgent(agent));
        policy.playbookSlug = slug;
        policy.forbidForcePush = slug === 'babysit' || slug === 'autopilot-stack';
        policy.holdPrMerge = slug === 'autopilot-stack';
        const shouldLockWrites = config.lockWritesInInvestigation && slug === 'investigation';
        policy.investigationReadOnly = shouldLockWrites;
        const prevDispose = restrictionDisposers.get(sessionId);
        if (!shouldLockWrites && prevDispose !== undefined) {
            prevDispose();
            restrictionDisposers.delete(sessionId);
        }
        else if (shouldLockWrites && prevDispose === undefined) {
            const agentCtx = agent?.ctx;
            if (agentCtx !== undefined) {
                try {
                    const agentTools = agentCtx.tools;
                    const deny = WRITE_TOOLS.filter((t) => {
                        try {
                            return agentTools.get(t, agent) !== undefined;
                        }
                        catch {
                            return false;
                        }
                    });
                    if (deny.length > 0) {
                        const dispose = agentTools.restrict({ deny: [...deny] });
                        restrictionDisposers.set(sessionId, dispose);
                    }
                }
                catch {
                    // Guard below catches any mutating call even when global tool names aren't restrictable.
                }
            }
        }
    }
    // Guard backing `investigation` read-only phase across write tools AND shell file redirects
    ctx.effect(() => ctx.tools.guard((exec) => {
        const policy = runtime.policyForAgent(exec.agent);
        if (policy?.investigationReadOnly !== true)
            return undefined;
        if (WRITE_TOOLS.includes(exec.name)) {
            return {
                reason: '🥔 The `investigation` playbook is read-only until root cause is proven. Gather evidence first, or switch playbooks with `/playbook <name>` once ready to implement.',
                info: { name: 'PstackInvestigationReadOnlyError', code: 'PSTACK_INVESTIGATION_READONLY' },
            };
        }
        if (SHELL_TOOLS.has(exec.name)) {
            const args = exec.arguments;
            const cmd = typeof args?.command === 'string' ? args.command : '';
            const targets = shellWriteTargets(cmd);
            if (targets.length > 0) {
                return {
                    reason: `🥔 The \`investigation\` playbook is read-only; shell command mutates \`${targets[0]}\`. Gather read-only evidence first, or switch playbooks with \`/playbook <name>\`.`,
                    info: { name: 'PstackInvestigationReadOnlyError', code: 'PSTACK_INVESTIGATION_READONLY' },
                };
            }
        }
        return undefined;
    }));
    // Observe `read` of `playbooks/<slug>.md` to seed steps and apply policy immediately
    ctx.on('tools/result', (exec, result) => {
        if (result.isError || exec.name !== 'read')
            return;
        const args = exec.arguments;
        const filePath = typeof args?.file_path === 'string'
            ? args.file_path
            : typeof args?.path === 'string'
                ? args.path
                : '';
        const slug = playbookSlugFromPath(filePath);
        if (slug === undefined)
            return;
        const text = result.content
            .map((b) => (b.type === 'text' ? b.text : ''))
            .join('\n');
        const pb = catalog.playbooks.get(slug) ?? parsePlaybook(text, catalog.knownSkills);
        if (pb === undefined)
            return;
        // Do not let an agent silently relax `babysit` or `autopilot-stack` restrictions just by reading another playbook
        const existing = runtime.policyForAgent(exec.agent);
        const activeProtected = existing?.playbookSlug === 'babysit' || existing?.playbookSlug === 'autopilot-stack';
        if (!activeProtected || slug === 'babysit' || slug === 'autopilot-stack') {
            applyPlaybookPolicy(exec.agent, slug);
        }
        if (config.seedNativeTodo)
            writeTodoSnapshot(exec.agent, pb, 0, false);
    });
    // Register `pstack_step` for agent goal restatement and step progression
    ctx.effect(() => ctx.tools.register(defineTool({
        name: 'pstack_step',
        description: 'Report poteto-mode playbook progress: restate the user goal (on step 1), select or confirm the active playbook, and advance steps (`in_progress` or `completed`).',
        parameters: {
            playbook: {
                type: 'string',
                description: `Optional playbook slug or title (${PLAYBOOK_TITLES.slice(0, 6).join(', ')}, …).`,
            },
            goal: {
                type: 'string',
                description: 'Concise restatement of the user goal and the smallest change that meets it.',
            },
            step: {
                type: 'integer',
                required: true,
                description: '1-based playbook step index.',
            },
            status: {
                type: 'string',
                required: true,
                enum: ['in_progress', 'completed'],
                description: 'Whether this step is now starting (`in_progress`) or finished (`completed`).',
            },
            note: {
                type: 'string',
                description: 'Short evidence or outcome note for this step.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    playbookSlug: { type: 'string', required: true },
                    playbookTitle: { type: 'string', required: true },
                    step: { type: 'integer', required: true },
                    totalSteps: { type: 'integer', required: true },
                    status: { type: 'string', required: true },
                    completed: { type: 'boolean', required: true },
                    goal: { type: 'string' },
                    autoArmTdd: { type: 'boolean', required: true },
                },
            },
            render: (_args, value) => {
                const v = value;
                const progress = v.completed
                    ? `🥔 ${v.playbookTitle}: all ${v.totalSteps} steps completed.`
                    : `🥔 ${v.playbookTitle}: step ${v.step}/${Math.max(1, v.totalSteps)} (${v.status}).`;
                return [{ type: 'text', text: v.goal ? `${progress} Goal: ${v.goal}` : progress }];
            },
            presentationMeta: (_args, value) => {
                const v = value;
                return { pstackKind: 'step', ...v };
            },
        },
        async execute(rawArgs, exec) {
            const args = rawArgs;
            const sessionId = sessionIdOfAgent(exec.agent);
            const policy = sessionId !== undefined ? runtime.sessionPolicy(sessionId, sessionOfAgent(exec.agent)) : undefined;
            let slug = policy?.playbookSlug ?? 'figure-it-out';
            if (args.playbook !== undefined && args.playbook.trim() !== '') {
                const candidate = resolvePlaybookSlug(args.playbook);
                if (candidate === 'figure-it-out' || catalog.playbooks.has(candidate)) {
                    const protectedActive = policy?.playbookSlug === 'babysit' ||
                        policy?.playbookSlug === 'autopilot-stack' ||
                        policy?.investigationReadOnly === true;
                    // Never allow model-initiated `pstack_step` to drop `babysit`/`autopilot-stack`/`investigation` locks
                    if (!protectedActive || candidate === 'babysit' || candidate === 'autopilot-stack') {
                        slug = candidate;
                    }
                }
            }
            const pb = catalog.playbooks.get(slug);
            applyPlaybookPolicy(exec.agent, slug);
            const totalSteps = pb?.steps.length ?? 0;
            const step = Math.max(1, Math.trunc(args.step));
            const completed = totalSteps > 0 && args.status === 'completed' && step >= totalSteps;
            const nextActive = args.status === 'completed' ? step + 1 : step;
            // Completing investigation lifts write lock only when an outcome `note` or `goal` states the root cause
            if (completed && policy?.investigationReadOnly === true) {
                const hasEvidenceNote = Boolean((args.note && args.note.trim() !== '') || (args.goal && args.goal.trim() !== ''));
                if (hasEvidenceNote) {
                    policy.investigationReadOnly = false;
                    if (sessionId !== undefined) {
                        restrictionDisposers.get(sessionId)?.();
                        restrictionDisposers.delete(sessionId);
                    }
                }
            }
            const nextStepObj = pb?.steps.find((s) => s.index === nextActive);
            const autoArmTdd = Boolean(config.autoArmTddOnStep && nextStepObj?.routes.includes('tdd'));
            if (autoArmTdd && policy !== undefined && policy.tdd.phase === 'off') {
                policy.tdd = { phase: 'red-pending' };
            }
            if (pb !== undefined && config.seedNativeTodo) {
                writeTodoSnapshot(exec.agent, pb, nextActive, completed);
            }
            return {
                playbookSlug: slug,
                playbookTitle: pb?.title ?? slug,
                step,
                totalSteps,
                status: args.status,
                completed,
                ...(args.goal !== undefined && args.goal.trim() !== '' ? { goal: args.goal.trim() } : {}),
                autoArmTdd,
            };
        },
    })));
    // `/playbook` slash command for human selection or status check (human authority CAN switch away from any playbook)
    ctx.inject(['commands'], (inner) => {
        const commands = getService(inner, 'commands');
        if (commands === undefined)
            return;
        inner.effect(() => commands.register({
            name: 'playbook',
            description: 'Select or inspect the active pstack playbook (e.g. /playbook bug-fix)',
            async handler(invocation) {
                const input = invocation.rawInput.trim();
                const sessionId = sessionIdOfAgent(invocation.agent) ?? String(invocation.agent.id);
                const session = sessionOfAgent(invocation.agent);
                if (input === '') {
                    const current = runtime.sessionPolicy(sessionId, session).playbookSlug;
                    return {
                        kind: 'success',
                        text: current
                            ? `🥔 Active playbook: ${current}`
                            : `🥔 No playbook active. Available: ${PLAYBOOK_TITLES.join(', ')}`,
                    };
                }
                const slug = resolvePlaybookSlug(input);
                const pb = catalog.playbooks.get(slug);
                if (pb === undefined) {
                    return {
                        kind: 'error',
                        text: `🥔 Unknown playbook "${input}". Available: ${PLAYBOOK_TITLES.join(', ')}`,
                    };
                }
                applyPlaybookPolicy(invocation.agent, slug);
                if (config.seedNativeTodo)
                    writeTodoSnapshot(invocation.agent, pb, 0, false);
                await appendPstackSessionRecord(session, { pstackKind: 'step', playbookSlug: slug, step: 0, status: 'in_progress' });
                return {
                    kind: 'success',
                    text: `🥔 Activated playbook "${pb.title}" (${pb.steps.length} steps): ${pb.stance}`,
                };
            },
        }));
    });
}
