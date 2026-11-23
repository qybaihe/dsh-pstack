/**
 * Unattended execution, ketchup decision handoff, and `/correct` self-hardening
 * (`@qybaihe/dsh-pstack/autopilot`, M4):
 * - `pstack_ketchup`: structured operator decision cards (`ketchup` skill).
 * - `pstack_autopilot` + `/autopilot`: recurring patrol (`ctx.schedule` with
 *   `every_seconds`), completion-driven goals (`ctx.goals` with revision-aware
 *   pause/resume), contiguous verified PR stack audit, durable checkpoints
 *   (`ctx.storageDomain`), and serialized stalled subagent detection +
 *   replacement (`ctx.subagents`) logged to both projection and ledger.
 * - `pstack_correct` + `/correct`: encodes new shell rules (`ask-pattern`,
 *   `deny-pattern`, `protected-branch`) into runtime structure immediately and
 *   persists all three through `ctx.configEditor.edit`.
 *
 * @module @qybaihe/dsh-pstack/autopilot
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { contiguousLandablePrefix } from '../core/panel-rules.ts'
import type { PrStackItem } from '../core/panel-rules.ts'
import type { KetchupItemView } from '../core/projection.ts'
import type { DenyPatternRule } from '../guard/index.ts'
import type {
  CommandsService,
  ConfigEditorService,
  GoalService,
  OpenedDomain,
  ScheduleService,
  StorageDomainService,
  SubagentDescendantEntry,
  SubagentService,
} from '../host/dsh.ts'
import {
  appendPstackSessionRecord,
  cwdOfAgent,
  findPstackConfigEntry,
  getService,
  resolveAgentCwd,
  sessionIdOfAgent,
  sessionOfAgent,
  unwrapGoalSnapshot,
} from '../host/dsh.ts'
import { registerRpc, runtimeFor } from '../host/state.ts'

export const name = 'pstack-autopilot'
export const inject = ['tools']

export interface Config {
  /** Default patrol interval in seconds for `/autopilot` schedules (minimum 60). */
  patrolIntervalSeconds: number
  /** Milliseconds without activity before a tracked worker subagent is considered stalled. */
  stallTimeoutMs: number
  /** Polling interval in milliseconds for the stalled-subagent monitor. */
  monitorPollMs: number
}

export const Config: Schema<Partial<Config>, Config> = Schema.object({
  patrolIntervalSeconds: Schema.number().default(3600),
  stallTimeoutMs: Schema.number().default(40 * 60 * 1000),
  monitorPollMs: Schema.number().default(30_000),
})

export interface AutopilotCheckpoint {
  readonly sessionId: string
  readonly workspaceCwd: string
  readonly playbookSlug?: string
  readonly step?: number
  readonly scheduleId?: string
  readonly goalId?: string
  readonly goalRevision?: number
  readonly summary: string
  readonly savedAt: string
}

export interface WatchedWorker {
  readonly parent: Agent
  readonly parentSessionId: string
  readonly childId: string
  readonly label: string
  readonly brief: string
  readonly cwd: string
  readonly agentPreset: string
  lastProgressAt: number
}

function isDescendantSettled(entry: SubagentDescendantEntry): boolean {
  const status = entry.status?.toLowerCase()
  if (status === 'completed' || status === 'stopped' || status === 'failed' || status === 'cancelled' || status === 'aborted') {
    return true
  }
  const actState =
    typeof entry.activity === 'string'
      ? entry.activity.toLowerCase()
      : typeof entry.activity?.state === 'string'
        ? entry.activity.state.toLowerCase()
        : undefined
  return actState === 'completed' || actState === 'stopped' || actState === 'ended'
}

export function apply(ctx: Context, config: Config): void {
  const runtime = runtimeFor(ctx)
  const watchedWorkers = new Map<string, WatchedWorker>()
  const memCheckpoints = new Map<string, AutopilotCheckpoint>()
  const activeSessionAutopilot = new Map<
    string,
    { scheduleId?: string; goalId?: string; goalRevision?: number; mode: 'drive' | 'threads-only' | 'check' }
  >()
  const lifecycleAbort = new AbortController()
  let patrolChain: Promise<unknown> = Promise.resolve()

  ctx.effect(() => () => {
    lifecycleAbort.abort()
    watchedWorkers.clear()
  })

  let domainPromise: Promise<OpenedDomain<{ checkpoints: AutopilotCheckpoint }> | undefined> = Promise.resolve(undefined)
  ctx.inject(['storageDomain'], (inner) => {
    const storageDomain = getService<StorageDomainService>(inner, 'storageDomain')
    if (storageDomain === undefined) return
    const opened = storageDomain
      .open<{ checkpoints: AutopilotCheckpoint }>({
        name: 'pstack_autopilot',
        version: 1,
        invalidRecords: 'backup-and-skip',
        tables: {
          checkpoints: {
            valueSchema: {
              parse(raw: unknown) {
                if (typeof raw !== 'object' || raw === null || typeof (raw as { summary?: unknown }).summary !== 'string') {
                  throw new Error('Invalid checkpoint record')
                }
                return raw as AutopilotCheckpoint
              },
            },
          },
        },
      })
      .catch(() => undefined)
    domainPromise = opened
    inner.effect(() => async () => {
      const dom = await opened
      await dom?.close()
    })
  })

  // Track real tool progress and subagent completion so healthy/finished workers are never misclassified as stalled!
  ctx.on('tools/result', (exec) => {
    const childId = sessionIdOfAgent(exec.agent)
    if (childId === undefined) return
    const tracked = watchedWorkers.get(childId)
    if (tracked !== undefined) tracked.lastProgressAt = Date.now()
  })

  ;(ctx as unknown as { on(ev: string, fn: (payload: unknown) => void): void }).on('subagent/end', (payload) => {
    const p = payload as { childId?: string; sessionId?: string } | undefined
    const id = p?.childId ?? p?.sessionId
    if (typeof id === 'string') watchedWorkers.delete(id)
  })

  async function runSerializedPatrol(
    now = Date.now(),
    thresholdMs = config.stallTimeoutMs,
  ): Promise<{ target: string; oldSessionId: string; newSessionId?: string; reason: string; at: string }[]> {
    const task = patrolChain.then(async () => {
      if (lifecycleAbort.signal.aborted || watchedWorkers.size === 0) return []
      const subagents = getService<SubagentService>(ctx, 'subagents')
      if (subagents === undefined) return []
      const replaced: { target: string; oldSessionId: string; newSessionId?: string; reason: string; at: string }[] = []

      const parents = new Map<string, Agent>()
      for (const w of watchedWorkers.values()) parents.set(w.parentSessionId, w.parent)

      for (const [parentSid, parent] of parents) {
        const descendants = await subagents.listDescendants(parentSid, lifecycleAbort.signal).catch(() => [])
        for (const d of descendants) {
          const id = d.sessionId ?? d.id
          if (id === undefined) continue
          const tracked = watchedWorkers.get(id)
          if (tracked === undefined) continue
          if (isDescendantSettled(d)) {
            watchedWorkers.delete(id)
            continue
          }
          if (typeof d.updatedAt === 'number' && d.updatedAt > tracked.lastProgressAt) {
            tracked.lastProgressAt = d.updatedAt
          }
        }
      }

      for (const [childId, worker] of [...watchedWorkers.entries()]) {
        if (lifecycleAbort.signal.aborted) break
        const idleFor = now - worker.lastProgressAt
        if (idleFor < thresholdMs) continue
        watchedWorkers.delete(childId)

        try {
          subagents.interrupt(childId, { kind: 'ancestor', agent: worker.parent })
        } catch {
          // Already exited or non-interruptible.
        }

        let newSessionId: string | undefined
        try {
          const replacement = await subagents.startActivation({
            provider: 'spawn',
            label: `${worker.label} (replacement)`,
            agentPreset: worker.agentPreset,
            cwd: worker.cwd,
            parent: worker.parent,
            signal: lifecycleAbort.signal,
            delivery: 'parent',
            prompt: [
              {
                type: 'text',
                text: `Handoff replacement for stalled worker ${childId} (no progress for ${Math.round(idleFor / 1000)}s).\nOriginal brief: ${worker.brief}`,
              },
            ],
          })
          newSessionId = replacement.childId
          watchedWorkers.set(replacement.childId, {
            ...worker,
            childId: replacement.childId,
            lastProgressAt: Date.now(),
          })
        } catch {
          // Record replacement attempt even when subagent capacity declined immediate respawn.
        }

        const record = {
          target: worker.label,
          oldSessionId: childId,
          ...(newSessionId === undefined ? {} : { newSessionId }),
          reason: `No progress for ${Math.round(idleFor / 1000)}s`,
          at: new Date(now).toISOString(),
        }
        replaced.push(record)

        // Persist replacement to both session projection AND show-me-your-work decision ledger!
        await appendPstackSessionRecord(sessionOfAgent(worker.parent), {
          pstackKind: 'autopilot',
          active: true,
          replacement: record,
        })
        await runtime.ledgerAppendInternal?.(worker.parentSessionId, worker.cwd, {
          phase: 'patrol',
          decision: `Replaced stalled worker ${worker.label}`,
          why: record.reason,
          evidence: newSessionId ? `${childId} -> ${newSessionId}` : childId,
          result: newSessionId ? 'respawned replacement worker' : 'interrupted stalled worker (capacity full)',
        })
      }

      return replaced
    })
    patrolChain = task.catch(() => [])
    return task
  }

  // Periodic background patrol for stalled workers
  ctx.effect(() => {
    const timer = setInterval(() => {
      void runSerializedPatrol()
    }, Math.max(250, config.monitorPollMs))
    timer.unref?.()
    return () => clearInterval(timer)
  })

  // Lifecycle-owned RPC endpoint for reading saved checkpoint on session pickup
  registerRpc(ctx, runtime, 'resumeCheckpoint', async (payload) => {
    const req = payload as { cwd?: string; sessionId?: string } | undefined
    const dom = await domainPromise
    const sessionKey =
      req?.cwd && req?.sessionId
        ? `${req.cwd}::${req.sessionId}`
        : req?.sessionId
          ? `session::${req.sessionId}`
          : undefined
    const workspaceKey = req?.cwd ? `${req.cwd}::latest` : undefined
    const cp =
      (sessionKey ? memCheckpoints.get(sessionKey) ?? dom?.table('checkpoints').get(sessionKey) : undefined) ??
      (workspaceKey ? memCheckpoints.get(workspaceKey) ?? dom?.table('checkpoints').get(workspaceKey) : undefined) ??
      (req?.cwd ? memCheckpoints.get(req.cwd) ?? dom?.table('checkpoints').get(req.cwd) : undefined)
    return { checkpoint: cp ?? null }
  })

  // 1. `pstack_ketchup` (structured operator decision cards)
  ctx.effect(() =>
    ctx.tools.register(
      defineTool({
        name: 'pstack_ketchup',
        description:
          'Present structured operator decisions (`ketchup` skill) in plain language: what needs a call, your recommendation, what changes for the user, evidence, risk/option costs, and clickable choices.',
        parameters: {
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                question: { type: 'string', required: true },
                recommendation: { type: 'string', required: true },
                change: { type: 'string' },
                evidence: { type: 'string' },
                risk: { type: 'string' },
                options: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      label: { type: 'string', required: true },
                      prompt: { type: 'string', required: true },
                      cost: { type: 'string' },
                      primary: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              count: { type: 'integer', required: true },
              items: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
              summaryText: { type: 'string', required: true },
            },
          },
          render: (_args, value) => [{ type: 'text', text: String((value as { summaryText: string }).summaryText) }],
          presentationMeta: (_args, value) => ({ pstackKind: 'ketchup', ...(value as Record<string, unknown>) }),
        },
        async execute(rawArgs) {
          const args = rawArgs as {
            items: {
              question: string
              recommendation: string
              change?: string
              evidence?: string
              risk?: string
              options: { label: string; prompt: string; cost?: string; primary?: boolean }[]
            }[]
          }
          if (args.items.length === 0) {
            throw new Error('`items` must contain at least one decision item.')
          }
          const items: KetchupItemView[] = args.items.map((item, idx) => {
            const seenLabels = new Set<string>()
            const validOptions = (item.options ?? [])
              .filter((o) => o.label.trim() !== '' && o.prompt.trim() !== '')
              .filter((o) => {
                const key = o.label.trim().toLowerCase()
                if (seenLabels.has(key)) return false
                seenLabels.add(key)
                return true
              })
            if (validOptions.length === 0) {
              throw new Error(`Ketchup item #${idx + 1} ("${item.question}") must provide at least one distinct option.`)
            }
            return {
              id: `ketchup-${randomUUID().slice(0, 8)}-${idx + 1}`,
              question: item.question,
              recommendation: item.recommendation,
              ...(item.change ? { change: item.change } : {}),
              ...(item.evidence ? { evidence: item.evidence } : {}),
              ...(item.risk ? { risk: item.risk } : {}),
              options: validOptions.map((opt) => ({
                label: opt.label.trim(),
                prompt: opt.prompt.trim(),
                ...(opt.cost ? { cost: opt.cost } : {}),
                ...(opt.primary === undefined ? {} : { primary: opt.primary }),
              })),
            }
          })

          const summaryText = [
            `🥔 ${items.length} decision(s) waiting for you:`,
            ...items.map(
              (item, i) =>
                `${i + 1}. ${item.question} — Recommendation: ${item.recommendation} [${item.options.map((o) => o.label).join(' | ')}]`,
            ),
          ].join('\n')

          return {
            count: items.length,
            items: items.map((i) => ({ ...i, options: i.options.map((o) => ({ ...o })) })),
            summaryText,
          }
        },
      }),
    ),
  )

  // 2. `pstack_autopilot`
  ctx.effect(() =>
    ctx.tools.register(
      defineTool({
        name: 'pstack_autopilot',
        description:
          'Manage unattended poteto-mode runs: start a recurring patrol (`ctx.schedule`) or goal (`ctx.goals`), register/watch worker subagents for stalls, audit contiguous verified PR stacks, or save/resume checkpoints.',
        parameters: {
          action: {
            type: 'string',
            required: true,
            enum: ['start', 'watch-worker', 'patrol-now', 'stack', 'pause', 'resume'],
          },
          mode: {
            type: 'string',
            enum: ['drive', 'threads-only', 'check'],
            description: 'Babysit / autopilot mode.',
          },
          objective: { type: 'string', description: 'Completion objective for `ctx.goals` or patrol prompt.' },
          everySeconds: { type: 'integer', description: 'Patrol schedule interval in seconds (>= 60).' },
          maxGoalRounds: { type: 'integer', description: 'Maximum rounds when creating a session goal.' },
          workerSessionId: { type: 'string', description: 'Subagent session id to monitor (`watch-worker`).' },
          workerLabel: { type: 'string', description: 'Human-readable slice/PR label for the watched worker.' },
          workerBrief: { type: 'string', description: 'Original brief for replacement handoff if the worker stalls.' },
          workerCwd: { type: 'string', description: 'Optional working directory of the watched worker.' },
          stallTimeoutMs: { type: 'integer', description: 'Override stall threshold in ms (`patrol-now`).' },
          stack: {
            type: 'array',
            description: 'PR stack bottom-up (`[{ number, branch, title, status }]`) for `stack` check.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                number: { type: 'integer', required: true },
                branch: { type: 'string', required: true },
                title: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: ['PASS', 'PENDING', 'FAIL'] },
              },
            },
          },
          summary: { type: 'string', description: 'Checkpoint state summary for `pause`.' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              action: { type: 'string', required: true },
              active: { type: 'boolean', required: true },
              mode: { type: 'string' },
              scheduleId: { type: 'string' },
              goalId: { type: 'string' },
              warnings: { type: 'array', items: { type: 'string' } },
              checkpointSaved: { type: 'boolean' },
              resumeHint: { type: 'string' },
              replacement: { type: 'object', additionalProperties: true },
              replacements: { type: 'array', items: { type: 'object', additionalProperties: true } },
              stack: { type: 'array', items: { type: 'object', additionalProperties: true } },
              landableNumbers: { type: 'array', items: { type: 'integer' } },
              summaryText: { type: 'string', required: true },
            },
          },
          render: (_args, value) => [{ type: 'text', text: String((value as { summaryText: string }).summaryText) }],
          presentationMeta: (_args, value) => ({ pstackKind: 'autopilot', ...(value as Record<string, unknown>) }),
        },
        async execute(rawArgs, exec) {
          const args = rawArgs as {
            action: 'start' | 'watch-worker' | 'patrol-now' | 'stack' | 'pause' | 'resume'
            mode?: 'drive' | 'threads-only' | 'check'
            objective?: string
            everySeconds?: number
            maxGoalRounds?: number
            workerSessionId?: string
            workerLabel?: string
            workerBrief?: string
            workerCwd?: string
            stallTimeoutMs?: number
            stack?: PrStackItem[]
            summary?: string
          }
          const cwd = await resolveAgentCwd(ctx, exec.agent, exec.signal)
          const sessionId = sessionIdOfAgent(exec.agent) ?? '__default__'
          const session = sessionOfAgent(exec.agent)

          if (args.action === 'start') {
            const mode = args.mode ?? 'drive'
            const objective = args.objective?.trim() || `Autopilot (${mode}): check PRs, CI, and subagents; act on verified progress.`
            let scheduleId: string | undefined
            let goalId: string | undefined
            let goalRevision: number | undefined
            const warnings: string[] = []

            const goals = getService<GoalService>(ctx, 'goals')
            if (goals !== undefined && exec.agent !== undefined && args.objective !== undefined) {
              try {
                const existing = unwrapGoalSnapshot(await Promise.resolve(goals.get?.(exec.agent)))
                const snap =
                  existing !== undefined && existing.phase !== 'complete'
                    ? existing
                    : unwrapGoalSnapshot(
                        await Promise.resolve(
                          goals.create(exec.agent, {
                            objective,
                            ...(args.maxGoalRounds ? { maxGoalRounds: Math.max(1, Math.trunc(args.maxGoalRounds)) } : {}),
                          }),
                        ),
                      )
                goalId = snap?.id
                goalRevision = snap?.revision
              } catch (err) {
                warnings.push(`goal creation skipped: ${err instanceof Error ? err.message : String(err)}`)
              }
            }

            const schedule = getService<ScheduleService>(ctx, 'schedule')
            const requestedEvery = args.everySeconds ?? config.patrolIntervalSeconds
            if (schedule !== undefined && exec.agent !== undefined && requestedEvery > 0) {
              try {
                // Clean up previous schedule on this session before creating a new one (idempotent start)
                const prev = activeSessionAutopilot.get(sessionId)
                if (prev?.scheduleId && schedule.delete !== undefined) {
                  await schedule.delete({ id: prev.scheduleId }, exec.signal).catch(() => {})
                }
                const everySeconds = Math.max(60, Math.trunc(requestedEvery))
                const entry = await schedule.create(
                  {
                    title: `pstack autopilot (${mode})`,
                    prompt: objective,
                    timing: { kind: 'every', every_seconds: everySeconds },
                    target: { kind: 'session', sessionId },
                  },
                  sessionId,
                  exec.signal,
                )
                scheduleId = entry.id
              } catch (err) {
                warnings.push(`schedule creation skipped: ${err instanceof Error ? err.message : String(err)}`)
              }
            }

            runtime.sessionPolicy(sessionId, session).forbidForcePush = true
            activeSessionAutopilot.set(sessionId, {
              mode,
              ...(scheduleId ? { scheduleId } : {}),
              ...(goalId ? { goalId } : {}),
              ...(goalRevision !== undefined ? { goalRevision } : {}),
            })

            const warnSuffix = warnings.length > 0 ? ` [${warnings.join('; ')}]` : ''
            return {
              action: 'start',
              active: true,
              mode,
              ...(scheduleId ? { scheduleId } : {}),
              ...(goalId ? { goalId } : {}),
              ...(warnings.length > 0 ? { warnings } : {}),
              summaryText: `🥔 Autopilot started in \`${mode}\` mode${goalId ? ` (goal ${goalId})` : ''}${scheduleId ? ` (schedule ${scheduleId})` : ''}.${warnSuffix}`,
            }
          }

          if (args.action === 'watch-worker') {
            if (exec.agent === undefined || !args.workerSessionId) {
              throw new Error('watch-worker requires an owning agent and workerSessionId.')
            }
            watchedWorkers.set(args.workerSessionId, {
              parent: exec.agent,
              parentSessionId: sessionId,
              childId: args.workerSessionId,
              label: args.workerLabel ?? args.workerSessionId,
              brief: args.workerBrief ?? 'Continue slice work.',
              cwd: args.workerCwd ?? cwd,
              agentPreset: 'poteto-agent',
              lastProgressAt: Date.now(),
            })
            return {
              action: 'watch-worker',
              active: true,
              summaryText: `🥔 Watching worker ${args.workerLabel ?? args.workerSessionId} (${args.workerSessionId}) for stalls.`,
            }
          }

          if (args.action === 'patrol-now') {
            const replaced = await runSerializedPatrol(Date.now(), args.stallTimeoutMs ?? config.stallTimeoutMs)
            const first = replaced[0]
            return {
              action: 'patrol-now',
              active: true,
              ...(first ? { replacement: first } : {}),
              ...(replaced.length > 0 ? { replacements: replaced } : {}),
              summaryText:
                replaced.length > 0
                  ? `🥔 Patrol replaced ${replaced.length} stalled worker(s): ${replaced.map((r) => `${r.target} (${r.oldSessionId} → ${r.newSessionId ?? 'queued'})`).join(', ')}.`
                  : '🥔 Patrol checked watched workers: all healthy.',
            }
          }

          if (args.action === 'stack') {
            const stack = args.stack ?? []
            const { landable, waiting } = contiguousLandablePrefix(stack)
            runtime.sessionPolicy(sessionId, session).holdPrMerge = true
            runtime.sessionPolicy(sessionId, session).forbidForcePush = true
            return {
              action: 'stack',
              active: true,
              stack: stack.map((s) => ({ ...s })),
              landableNumbers: landable.map((s) => s.number),
              summaryText: `🥔 PR stack: ${landable.length} bottom-up verified PR(s) ready to land (${landable.map((p) => `#${p.number}`).join(', ') || 'none'}); ${waiting.length} waiting above.`,
            }
          }

          if (args.action === 'pause') {
            const policy = runtime.sessionPolicy(sessionId, session)
            const tracked = activeSessionAutopilot.get(sessionId)

            // Pause live goal and remove active recurring patrol schedule!
            const goals = getService<GoalService>(ctx, 'goals')
            let pausedGoalRevision = tracked?.goalRevision
            if (goals !== undefined && exec.agent !== undefined) {
              try {
                const liveGoal = unwrapGoalSnapshot(await Promise.resolve(goals.get?.(exec.agent)))
                if (liveGoal !== undefined && liveGoal.phase === 'active' && typeof goals.pause === 'function') {
                  const paused = unwrapGoalSnapshot(
                    await Promise.resolve(goals.pause(exec.agent, { id: liveGoal.id, revision: liveGoal.revision })),
                  )
                  pausedGoalRevision = paused?.revision ?? liveGoal.revision
                }
              } catch {
                // Goal may already be paused or absent.
              }
            }
            const schedule = getService<ScheduleService>(ctx, 'schedule')
            if (tracked?.scheduleId && schedule?.delete !== undefined) {
              await schedule.delete({ id: tracked.scheduleId }, exec.signal).catch(() => {})
            }
            for (const [wid, w] of watchedWorkers) {
              if (w.parentSessionId === sessionId) watchedWorkers.delete(wid)
            }

            const cp: AutopilotCheckpoint = {
              sessionId,
              workspaceCwd: cwd,
              ...(policy.playbookSlug ? { playbookSlug: policy.playbookSlug } : {}),
              ...(tracked?.goalId ? { goalId: tracked.goalId } : {}),
              ...(pausedGoalRevision !== undefined ? { goalRevision: pausedGoalRevision } : {}),
              summary: args.summary?.trim() || 'Paused cleanly at verifiable boundary.',
              savedAt: new Date().toISOString(),
            }
            const sessionKey = `${cwd}::${sessionId}`
            const latestKey = `${cwd}::latest`
            memCheckpoints.set(sessionKey, cp)
            memCheckpoints.set(latestKey, cp)
            const dom = await domainPromise
            await dom?.table('checkpoints').put(sessionKey, cp)
            await dom?.table('checkpoints').put(latestKey, cp)
            activeSessionAutopilot.delete(sessionId)

            return {
              action: 'pause',
              active: false,
              checkpointSaved: true,
              summaryText: `🥔 Saved checkpoint for ${cwd} (goal & patrol paused): ${cp.summary}`,
            }
          }

          // `resume`
          const dom = await domainPromise
          const sessionKey = `${cwd}::${sessionId}`
          const latestKey = `${cwd}::latest`
          const cp =
            memCheckpoints.get(sessionKey) ??
            dom?.table('checkpoints').get(sessionKey) ??
            memCheckpoints.get(latestKey) ??
            dom?.table('checkpoints').get(latestKey)

          const goals = getService<GoalService>(ctx, 'goals')
          if (cp !== undefined && goals !== undefined && exec.agent !== undefined && typeof goals.resume === 'function') {
            try {
              const liveGoal = unwrapGoalSnapshot(await Promise.resolve(goals.get?.(exec.agent)))
              if (liveGoal !== undefined && liveGoal.phase === 'paused') {
                await Promise.resolve(goals.resume(exec.agent, { id: liveGoal.id, revision: liveGoal.revision }))
              }
            } catch {
              // Resumed session may create a fresh goal on its own.
            }
          }

          return {
            action: 'resume',
            active: cp !== undefined,
            ...(cp ? { resumeHint: `${cp.summary} (saved ${cp.savedAt})` } : {}),
            summaryText: cp
              ? `🥔 Resumed from checkpoint (${cp.savedAt}): ${cp.summary}`
              : '🥔 No saved checkpoint found for this workspace.',
          }
        },
      }),
    ),
  )

  // 3. `pstack_correct` + `/correct`: encode lessons into guard config & hot-reload
  async function applyCorrection(spec: {
    kind: 'ask-pattern' | 'deny-pattern' | 'protected-branch'
    value: string
    reason?: string
    instead?: string
  }): Promise<{ persistedToProfile: boolean; summary: string }> {
    const trimmed = spec.value.trim()
    if (trimmed === '') throw new Error('Rule value must not be empty.')
    if (trimmed.length > 512) throw new Error('Rule pattern exceeds maximum length (512 chars).')
    if (spec.kind === 'ask-pattern' || spec.kind === 'deny-pattern') {
      new RegExp(trimmed)
    }

    const denyRule: DenyPatternRule = {
      pattern: trimmed,
      reason: spec.reason?.trim() || `Blocked by a rule encoded via /correct (${trimmed}).`,
      instead: spec.instead?.trim() || 'Rewrite the command to avoid this pattern.',
    }

    let persistedToProfile = false
    const editor = getService<ConfigEditorService>(ctx, 'configEditor')
    if (editor !== undefined) {
      const target = findPstackConfigEntry(editor, 'pstack-guard')
      if (target !== undefined) {
        await editor.edit(target, (current, inherited) => {
          const base = { ...inherited, ...current }
          if (spec.kind === 'protected-branch') {
            const list = Array.isArray(base.protectedBranches) ? (base.protectedBranches as string[]) : []
            return { ...base, protectedBranches: [...new Set([...list, trimmed])] }
          }
          if (spec.kind === 'ask-pattern') {
            const list = Array.isArray(base.askPatterns) ? (base.askPatterns as string[]) : []
            return { ...base, askPatterns: [...new Set([...list, trimmed])] }
          }
          const list = Array.isArray(base.denyPatterns) ? (base.denyPatterns as DenyPatternRule[]) : []
          const filtered = list.filter((item) => item.pattern !== trimmed)
          return { ...base, denyPatterns: [...filtered, denyRule] }
        })
        persistedToProfile = true
      }
    }

    // Activate immediately in shared runtime state (both for SDK profiles without configEditor and across reload window)
    if (spec.kind === 'protected-branch') {
      if (!runtime.extraGuard.protectedBranches.includes(trimmed)) {
        runtime.extraGuard.protectedBranches.push(trimmed)
      }
    } else if (spec.kind === 'ask-pattern') {
      if (!runtime.extraGuard.askPatterns.includes(trimmed)) {
        runtime.extraGuard.askPatterns.push(trimmed)
      }
    } else if (!runtime.extraGuard.denyPatterns.some((d) => d.pattern === trimmed)) {
      runtime.extraGuard.denyPatterns.push(denyRule)
    }

    return {
      persistedToProfile,
      summary: `🥔 Encoded ${spec.kind} \`${trimmed}\` into runtime guard${persistedToProfile ? ' (persisted to profile & hot-reloaded)' : ' (active immediately in runtime)'}.`,
    }
  }

  ctx.effect(() =>
    ctx.tools.register(
      defineTool({
        name: 'pstack_correct',
        description:
          'Encode a repeated mistake into runtime guard structure (`encode-lessons-in-structure` / `/correct`): add an `ask-pattern`, `deny-pattern`, or `protected-branch` live without restarting DSH.',
        parameters: {
          kind: {
            type: 'string',
            required: true,
            enum: ['ask-pattern', 'deny-pattern', 'protected-branch'],
          },
          value: { type: 'string', required: true, description: 'Regex source or protected branch name.' },
          reason: { type: 'string', description: 'Explanation shown when a `deny-pattern` triggers.' },
          instead: { type: 'string', description: 'Safe replacement command shown when a `deny-pattern` triggers.' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              persistedToProfile: { type: 'boolean', required: true },
              summary: { type: 'string', required: true },
            },
          },
          render: (_args, value) => [{ type: 'text', text: String((value as { summary: string }).summary) }],
        },
        async execute(rawArgs) {
          const args = rawArgs as {
            kind: 'ask-pattern' | 'deny-pattern' | 'protected-branch'
            value: string
            reason?: string
            instead?: string
          }
          return applyCorrection(args)
        },
      }),
    ),
  )

  ctx.inject(['commands'], (inner) => {
    const commands = getService<CommandsService>(inner, 'commands')
    if (commands === undefined) return
    inner.effect(() =>
      commands.register({
        name: 'correct',
        description: 'Add a live shell guard rule without restarting DSH: /correct <ask|deny|branch> <pattern-or-branch>',
        async handler(invocation) {
          const raw = invocation.rawInput.trim()
          const space = raw.indexOf(' ')
          if (space <= 0) {
            return {
              kind: 'error',
              text: 'Usage: /correct ask <regex> | /correct deny <regex> | /correct branch <name>',
            }
          }
          const head = raw.slice(0, space).toLowerCase()
          const rest = raw.slice(space + 1).trim()
          const kind =
            head === 'ask' ? 'ask-pattern' : head === 'deny' ? 'deny-pattern' : head === 'branch' ? 'protected-branch' : undefined
          if (kind === undefined) {
            return { kind: 'error', text: 'First argument must be `ask`, `deny`, or `branch`.' }
          }
          try {
            const res = await applyCorrection({ kind, value: rest })
            return { kind: 'success', text: res.summary }
          } catch (err) {
            return { kind: 'error', text: `🥔 ${err instanceof Error ? err.message : String(err)}` }
          }
        },
      }),
    )

    inner.effect(() =>
      commands.register({
        name: 'autopilot',
        description: 'Inspect or pause/resume unattended autopilot state (/autopilot status | pause <note> | resume)',
        async handler(invocation) {
          const raw = invocation.rawInput.trim()
          const cwd = cwdOfAgent(invocation.agent, ctx)
          const sessionId = sessionIdOfAgent(invocation.agent) ?? String(invocation.agent.id)
          const session = sessionOfAgent(invocation.agent)
          if (raw === 'resume') {
            const dom = await domainPromise
            const cp =
              memCheckpoints.get(`${cwd}::${sessionId}`) ??
              dom?.table('checkpoints').get(`${cwd}::${sessionId}`) ??
              memCheckpoints.get(`${cwd}::latest`) ??
              dom?.table('checkpoints').get(`${cwd}::latest`)
            if (cp !== undefined) {
              await appendPstackSessionRecord(session, {
                pstackKind: 'autopilot',
                active: true,
                resumeHint: `${cp.summary} (saved ${cp.savedAt})`,
              })
            }
            return {
              kind: 'success',
              text: cp ? `🥔 Checkpoint (${cp.savedAt}): ${cp.summary}` : '🥔 No checkpoint saved for this workspace.',
            }
          }
          if (raw.startsWith('pause')) {
            const note = raw.slice('pause'.length).trim() || 'Operator paused session.'
            const tracked = activeSessionAutopilot.get(sessionId)
            const schedule = getService<ScheduleService>(ctx, 'schedule')
            if (tracked?.scheduleId && schedule?.delete !== undefined) {
              await schedule.delete({ id: tracked.scheduleId }, invocation.signal).catch(() => {})
            }
            const cp: AutopilotCheckpoint = {
              sessionId,
              workspaceCwd: cwd,
              summary: note,
              savedAt: new Date().toISOString(),
            }
            memCheckpoints.set(`${cwd}::${sessionId}`, cp)
            memCheckpoints.set(`${cwd}::latest`, cp)
            const dom = await domainPromise
            await dom?.table('checkpoints').put(`${cwd}::${sessionId}`, cp)
            await dom?.table('checkpoints').put(`${cwd}::latest`, cp)
            await appendPstackSessionRecord(session, {
              pstackKind: 'autopilot',
              active: false,
              checkpointSaved: true,
            })
            return { kind: 'success', text: `🥔 Saved checkpoint: ${note}` }
          }
          return {
            kind: 'success',
            text: `🥔 Autopilot watching ${watchedWorkers.size} worker(s).`,
          }
        },
      }),
    )
  })
}
