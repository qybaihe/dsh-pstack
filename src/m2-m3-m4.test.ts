import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import ToolsService from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import SystemPromptService from '@deepseek-ai/dsh-system-prompt'
import * as guardPlugin from './guard/index.ts'
import * as panelPlugin from './panel/index.ts'
import * as benchPlugin from './bench/index.ts'
import * as autopilotPlugin from './autopilot/index.ts'

function initGitRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@pstack.local'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'pstack test'], { cwd: dir })
  return dir
}

function makeRunCtx(agent: unknown): ToolRunContext {
  return {
    callId: 'run-m234' as never,
    rootCallId: 'run-m234' as never,
    name: 'test',
    arguments: {},
    token: Symbol('token') as never,
    signal: new AbortController().signal,
    agent: agent as never,
    deferContext() {},
    concludeTurn() {},
  }
}

async function createHost() {
  const ctx = new Context()
  ctx.plugin(SystemPromptService, { personaPrefix: '' })
  ctx.plugin(ToolsService)
  for (const toolName of ['bash', 'read', 'write', 'edit']) {
    ctx.inject(['tools'], (inner) => {
      inner.tools.register({
        name: toolName,
        description: toolName,
        parameters: { type: 'object', properties: {} },
        output: { schema: { type: 'string' }, render: () => [{ type: 'text', text: 'ok' }] },
        async execute() {
          return 'ok'
        },
      })
    })
  }
  await new Promise((r) => setTimeout(r, 15))
  const pipeline = new ToolExecutionPipeline(ctx)
  return { ctx, pipeline }
}

describe('M2 panel (interrogate defect repro, single-vendor arena judge skip, swarm redispatch)', () => {
  it('verifies real failing repro commands in interrogate and discards passing/commandless claims', async () => {
    const repo = initGitRepo('pstack-m2-interrogate-')
    const { ctx } = await createHost()
    try {
      // Intentional bug: off-by-one in sum.mjs
      writeFileSync(join(repo, 'sum.mjs'), 'export const add = (a, b) => a + b + 1\n', 'utf8')
      writeFileSync(
        join(repo, 'repro-bug.mjs'),
        'import { add } from "./sum.mjs"; if (add(2, 2) !== 4) { console.error("expected 4, got", add(2, 2)); process.exit(1); }\n',
        'utf8',
      )
      writeFileSync(join(repo, 'false-alarm.mjs'), 'process.exit(0)\n', 'utf8')
      execFileSync('git', ['add', 'sum.mjs', 'repro-bug.mjs', 'false-alarm.mjs'], { cwd: repo })
      execFileSync('git', ['commit', '-q', '-m', 'seed fixture'], { cwd: repo })

      ctx.plugin(panelPlugin)
      await new Promise((r) => setTimeout(r, 20))

      const agent = {
        id: 'sess-m2-1',
        session: { id: 'sess-m2-1', meta: { cwd: repo }, append() {} },
        model: { current: () => ({ provider: 'deepseek', model: 'deepseek-v4' }) },
      }

      const interrogate = ctx.tools.get('pstack_interrogate')!
      const res = (await interrogate.execute(
        {
          task: 'Audit sum.mjs',
          claims: [
            { reviewerId: 'A', title: 'add() has an off-by-one error', command: 'node repro-bug.mjs' },
            { reviewerId: 'B', title: 'Fabricated memory leak', command: 'node false-alarm.mjs' },
            { reviewerId: 'B', title: 'Unbacked prose hunch' },
          ],
        },
        makeRunCtx(agent),
      )) as {
        verified: { title: string; command: string; output: string }[]
        droppedCount: number
      }

      assert.equal(res.verified.length, 1)
      assert.equal(res.verified[0]?.title, 'add() has an off-by-one error')
      assert.match(res.verified[0]?.output ?? '', /expected 4, got 5/)
      assert.equal(res.droppedCount, 2)
    } finally {
      rmSync(repo, { recursive: true, force: true })
      await ctx.fiber.dispose()
    }
  })

  it('skips cross-judge explicitly when only the parent vendor is configured, and redispatches incomplete swarm workers', async () => {
    const repo = initGitRepo('pstack-m2-arena-')
    const { ctx } = await createHost()
    try {
      writeFileSync(join(repo, 'index.js'), 'export default 1\n', 'utf8')
      execFileSync('git', ['add', 'index.js'], { cwd: repo })
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo })

      let swarmCalls = 0
      ctx.provide('llm', undefined)
      ;(ctx as unknown as Record<string, unknown>).llm = {
        listProviders: () => [{ id: 'deepseek', name: 'DeepSeek' }],
        listModels: async () => [{ id: 'deepseek-v4', name: 'DeepSeek V4' }],
      }
      ctx.provide('subagents', undefined)
      ;(ctx as unknown as Record<string, unknown>).subagents = {
        async startActivation(spec: { agentPreset?: string }) {
          if (spec.agentPreset === 'pstack-worker') {
            swarmCalls += 1
            // Attempt 1 omits `sha`; attempt 2 supplies `sha` + `approach`
            const structured =
              swarmCalls === 1
                ? { status: 'PASS', approach: 'forgot sha' }
                : { status: 'PASS', sha: 'a91f03d', approach: 'added guard' }
            return {
              childId: `child-${swarmCalls}`,
              name: `worker-${swarmCalls}`,
              result: Promise.resolve({ output: [{ type: 'text', text: 'done' }], structured, stopReason: 'completed' }),
              async dispose() {},
            }
          }
          return {
            childId: 'cand-1',
            name: 'cand-1',
            result: Promise.resolve({ output: [{ type: 'text', text: 'implemented candidate' }], stopReason: 'completed' }),
            async dispose() {},
          }
        },
        interrupt() {},
        listDescendants: async () => [],
      }

      ctx.plugin(panelPlugin, {
        arenaSeats: ['deepseek/deepseek-v4'],
        judgePool: ['deepseek/deepseek-chat'],
      })
      await new Promise((r) => setTimeout(r, 20))

      const agent = {
        id: 'sess-m2-2',
        session: { id: 'sess-m2-2', meta: { cwd: repo }, append() {} },
        model: { current: () => ({ provider: 'deepseek', model: 'deepseek-v4' }) },
      }

      const arenaRes = (await ctx.tools.get('pstack_arena')!.execute(
        { task: 'Fix bug', rubric: ['Minimal diff', 'Regression test'] },
        makeRunCtx(agent),
      )) as { judge: { status: string }; summaryText: string }

      assert.equal(arenaRes.judge.status, 'no-other-vendor')
      assert.match(arenaRes.summaryText, /Skipped judge: no-other-vendor/)

      const swarmRes = (await ctx.tools.get('pstack_swarm')!.execute(
        { task: 'Migrate slice', slices: ['slice-1'] },
        makeRunCtx(agent),
      )) as { passedCount: number; gapCount: number; slices: { outcome: string; approach?: string }[] }

      assert.equal(swarmCalls, 2)
      assert.equal(swarmRes.passedCount, 1)
      assert.equal(swarmRes.gapCount, 0)
      assert.match(swarmRes.slices[0]?.approach ?? '', /after 1 redispatch/)
    } finally {
      rmSync(repo, { recursive: true, force: true })
      await ctx.fiber.dispose()
    }
  })
})

describe('M3 bench (hillclimb keep, noise revert, work-changed revert, frozen file guard)', () => {
  it('keeps real gains with path-only commits, reverts noise and work changes cleanly, and blocks writes to frozen files', async () => {
    const repo = initGitRepo('pstack-m3-bench-')
    const { ctx, pipeline } = await createHost()
    try {
      writeFileSync(join(repo, 'tuning.json'), JSON.stringify({ latency: 100, work: 5000 }), 'utf8')
      writeFileSync(
        join(repo, 'bench.mjs'),
        'import { readFileSync } from "node:fs"; const c = JSON.parse(readFileSync("tuning.json", "utf8")); console.log(JSON.stringify({ value: c.latency, errors: 0, work: c.work }));\n',
        'utf8',
      )
      writeFileSync(join(repo, 'bystander.txt'), 'untracked work in progress\n', 'utf8')
      execFileSync('git', ['add', 'tuning.json', 'bench.mjs'], { cwd: repo })
      execFileSync('git', ['commit', '-q', '-m', 'baseline'], { cwd: repo })

      ctx.plugin(benchPlugin, { defaultMinSamples: 3 })
      await new Promise((r) => setTimeout(r, 20))

      const agent = {
        id: 'sess-m3-1',
        session: { id: 'sess-m3-1', meta: { cwd: repo }, append() {} },
      }

      // 1. Freeze benchmark at baseline 100
      const freezeRes = (await ctx.tools.get('pstack_bench')!.execute(
        {
          metricName: 'Latency ms',
          command: 'node bench.mjs',
          files: ['bench.mjs'],
          direction: 'lower',
          gateCommand: 'node -e "process.exit(0)"',
          minSamples: 3,
          targetRelativeGain: 0.3,
          minAttempts: 1,
        },
        makeRunCtx(agent),
      )) as { baseline: number }
      assert.equal(freezeRes.baseline, 100)

      // 2. Writing to frozen `bench.mjs` (either via `write` tool or shell redirect) is denied by guard
      const step = await pipeline.prepare({
        callId: 'freeze-write-1' as never,
        name: 'write',
        arguments: { file_path: 'bench.mjs', content: 'console.log(1)' },
        signal: new AbortController().signal,
        agent: agent as never,
      })
      assert.notEqual(step.kind, 'dispatch')
      if (step.kind !== 'dispatch') {
        assert.equal(step.result.error?.info?.code, 'PSTACK_BENCH_FROZEN')
      }
      const redirectStep = await pipeline.prepare({
        callId: 'freeze-write-2' as never,
        name: 'bash',
        arguments: { command: 'echo 1 > bench.mjs' },
        signal: new AbortController().signal,
        agent: agent as never,
      })
      assert.notEqual(redirectStep.kind, 'dispatch')
      if (redirectStep.kind !== 'dispatch') {
        assert.equal(redirectStep.result.error?.info?.code, 'PSTACK_BENCH_FROZEN')
      }

      // 3. Real improvement (100 -> 60): KEPT, committed by path (bystander.txt remains untracked!)
      writeFileSync(join(repo, 'tuning.json'), JSON.stringify({ latency: 60, work: 5000 }), 'utf8')
      const keepRes = (await ctx.tools.get('pstack_attempt')!.execute(
        { hypothesis: 'Remove startup telemetry', changedFiles: ['tuning.json'] },
        makeRunCtx(agent),
      )) as { verdict: string; predicateMet: boolean }
      assert.equal(keepRes.verdict, 'kept')
      assert.equal(keepRes.predicateMet, true)

      const committedFiles = execFileSync('git', ['show', '--name-only', '--pretty=format:', 'HEAD'], {
        cwd: repo,
        encoding: 'utf8',
      }).trim()
      assert.equal(committedFiles, 'tuning.json')

      // 4. Within-noise edit (60 -> 59.8, < 1% relative gain): REVERTED and tuning.json restored to 60
      writeFileSync(join(repo, 'tuning.json'), JSON.stringify({ latency: 59.8, work: 5000 }), 'utf8')
      const noiseRes = (await ctx.tools.get('pstack_attempt')!.execute(
        { hypothesis: 'Micro-tweak', changedFiles: ['tuning.json'] },
        makeRunCtx(agent),
      )) as { verdict: string; reason: string }
      assert.equal(noiseRes.verdict, 'reverted')
      assert.equal(noiseRes.reason, 'within-noise')
      assert.equal(JSON.parse(readFileSync(join(repo, 'tuning.json'), 'utf8')).latency, 60)

      // 5. Less-work edit (work 2500 != 5000): REVERTED (`work-changed`) and restored cleanly
      writeFileSync(join(repo, 'tuning.json'), JSON.stringify({ latency: 20, work: 2500 }), 'utf8')
      const workRes = (await ctx.tools.get('pstack_attempt')!.execute(
        { hypothesis: 'Skip offscreen items', changedFiles: ['tuning.json'] },
        makeRunCtx(agent),
      )) as { verdict: string; reason: string }
      assert.equal(workRes.verdict, 'reverted')
      assert.equal(workRes.reason, 'work-changed')
      assert.equal(JSON.parse(readFileSync(join(repo, 'tuning.json'), 'utf8')).work, 5000)
    } finally {
      rmSync(repo, { recursive: true, force: true })
      await ctx.fiber.dispose()
    }
  })
})

describe('M4 autopilot (stalled worker replacement, /correct live guard rule, ketchup cards)', () => {
  it('detects and replaces a stalled subagent worker and hot-applies /correct guard rules', async () => {
    const { ctx, pipeline } = await createHost()
    try {
      const interrupted: string[] = []
      let spawnedCount = 0
      ctx.provide('subagents', undefined)
      ;(ctx as unknown as Record<string, unknown>).subagents = {
        interrupt(id: string) {
          interrupted.push(id)
        },
        listDescendants: async () => [],
        async startActivation() {
          spawnedCount += 1
          return {
            childId: `replacement-${spawnedCount}`,
            name: `replacement-${spawnedCount}`,
            result: Promise.resolve({ output: [], stopReason: 'completed' }),
            async dispose() {},
          }
        },
      }

      let editedConfig: Record<string, unknown> | undefined
      ctx.provide('configEditor', undefined)
      ;(ctx as unknown as Record<string, unknown>).configEditor = {
        entries: () => [{ id: 'pstack-guard' }],
        configuration: () => [],
        async edit(_entry: unknown, fn: (cur: Record<string, unknown>, inh: Record<string, unknown>) => Record<string, unknown>) {
          editedConfig = fn({}, { askPatterns: [] })
        },
      }

      ctx.plugin(guardPlugin)
      ctx.plugin(autopilotPlugin, { stallTimeoutMs: 20, monitorPollMs: 60_000 })
      await new Promise((r) => setTimeout(r, 20))

      const agent = {
        id: 'sess-m4-1',
        session: { id: 'sess-m4-1', meta: { cwd: process.cwd() }, append() {} },
      }

      // 1. Watch a worker, wait past stallTimeoutMs, run patrol-now -> interrupted & replaced!
      const autopilotTool = ctx.tools.get('pstack_autopilot')!
      await autopilotTool.execute(
        { action: 'watch-worker', workerSessionId: 'hung-worker-1', workerLabel: 'PR #3', workerBrief: 'Fix PR #3' },
        makeRunCtx(agent),
      )
      await new Promise((r) => setTimeout(r, 35))
      const patrol = (await autopilotTool.execute(
        { action: 'patrol-now', stallTimeoutMs: 15 },
        makeRunCtx(agent),
      )) as { replacement?: { oldSessionId: string; newSessionId: string } }
      assert.deepEqual(interrupted, ['hung-worker-1'])
      assert.equal(patrol.replacement?.oldSessionId, 'hung-worker-1')
      assert.equal(patrol.replacement?.newSessionId, 'replacement-1')

      // 2. Before `/correct`, `rm -rf dist-prod` is allowed by pstack-guard
      const before = await pipeline.prepare({
        callId: 'corr-1' as never,
        name: 'bash',
        arguments: { command: 'rm -rf dist-prod' },
        signal: new AbortController().signal,
      })
      assert.equal(before.kind, 'dispatch')

      // Encode a new deny rule via `pstack_correct` without restarting DSH
      await ctx.tools.get('pstack_correct')!.execute(
        {
          kind: 'deny-pattern',
          value: '^rm -rf dist-prod\\b',
          reason: 'Never delete dist-prod directly.',
          instead: 'Run `pnpm run clean:staging` instead.',
        },
        makeRunCtx(agent),
      )
      const after = await pipeline.prepare({
        callId: 'corr-2' as never,
        name: 'bash',
        arguments: { command: 'rm -rf dist-prod' },
        signal: new AbortController().signal,
      })
      assert.notEqual(after.kind, 'dispatch')
      if (after.kind !== 'dispatch') {
        assert.equal(after.result.error?.info?.code, 'PSTACK_DEPLOY')
      }

      // Also persist an ask-pattern via configEditor
      const persisted = (await ctx.tools.get('pstack_correct')!.execute(
        { kind: 'ask-pattern', value: '^make release\\b' },
        makeRunCtx(agent),
      )) as { persistedToProfile: boolean }
      assert.equal(persisted.persistedToProfile, true)
      assert.deepEqual(editedConfig?.askPatterns, ['^make release\\b'])

      // 3. Ketchup structured operator decision card
      const ketchup = (await ctx.tools.get('pstack_ketchup')!.execute(
        {
          items: [
            {
              question: 'Merge this fix?',
              recommendation: 'Merge now.',
              change: 'Stops idle list jitter.',
              evidence: 'Repro script passes.',
              risk: 'Low.',
              options: [{ label: 'Merge', prompt: 'Merge the PR', primary: true }],
            },
          ],
        },
        makeRunCtx(agent),
      )) as { count: number }
      assert.equal(ketchup.count, 1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('captures committed + untracked Arena candidate diffs, adopts cleanly, rejects stale runId, and uses real schedule/goals contracts', async () => {
    const repo = initGitRepo('pstack-hardening-')
    const { ctx } = await createHost()
    try {
      writeFileSync(join(repo, 'app.js'), 'export const v = 1\n', 'utf8')
      execFileSync('git', ['add', 'app.js'], { cwd: repo })
      execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo })

      ctx.provide('subagents', undefined)
      ;(ctx as unknown as Record<string, unknown>).subagents = {
        async startActivation(spec: { cwd?: string }) {
          if (spec.cwd) {
            // Candidate modifies tracked file AND creates a brand-new untracked file + commits part of it
            writeFileSync(join(spec.cwd, 'app.js'), 'export const v = 2\n', 'utf8')
            execFileSync('git', ['add', 'app.js'], { cwd: spec.cwd })
            execFileSync('git', ['commit', '-q', '-m', 'cand commit'], { cwd: spec.cwd })
            writeFileSync(join(spec.cwd, 'helper.js'), 'export const h = true\n', 'utf8')
          }
          return {
            childId: 'cand-a',
            name: 'cand-a',
            result: Promise.resolve({ output: [{ type: 'text', text: 'updated app and added helper' }], stopReason: 'completed' }),
            async dispose() {},
          }
        },
        interrupt() {},
        listDescendants: async () => [{ id: 'done-worker', status: 'completed' }],
      }

      const createdSchedules: unknown[] = []
      const pausedGoals: { id: string; revision: number }[] = []
      let currentGoal: { id: string; revision: number; objective: string; phase: string } | undefined
      ctx.provide('schedule', undefined)
      ;(ctx as unknown as Record<string, unknown>).schedule = {
        async create(opts: unknown) {
          createdSchedules.push(opts)
          return { id: 'sched-1', status: 'active' }
        },
        async delete() {},
      }
      ctx.provide('goals', undefined)
      ;(ctx as unknown as Record<string, unknown>).goals = {
        get() {
          return currentGoal
        },
        create(_agent: unknown, req: { objective: string }) {
          // Flat GoalView shape (real DSH GoalService)
          currentGoal = { id: 'goal-flat-1', revision: 1, objective: req.objective, phase: 'active' }
          return currentGoal
        },
        pause(_agent: unknown, ref: { id: string; revision: number }) {
          pausedGoals.push(ref)
          currentGoal = { ...currentGoal!, revision: ref.revision + 1, phase: 'paused' }
          return currentGoal
        },
        resume(_agent: unknown, ref: { id: string; revision: number }) {
          currentGoal = { ...currentGoal!, revision: ref.revision + 1, phase: 'active' }
          return currentGoal
        },
      }

      ctx.plugin(panelPlugin, { arenaSeats: ['inherit-parent'] })
      ctx.plugin(autopilotPlugin, { monitorPollMs: 120_000 })
      await new Promise((r) => setTimeout(r, 20))

      const agent = {
        id: 'sess-hard-1',
        session: { id: 'sess-hard-1', meta: { cwd: repo }, append() {}, appendPluginRecord() {} },
        model: { current: () => ({ provider: 'deepseek', model: 'deepseek-v4' }) },
      }

      const arena = (await ctx.tools.get('pstack_arena')!.execute(
        { task: 'Add helper', rubric: ['Minimal'] },
        makeRunCtx(agent),
      )) as { runId: string }
      assert.ok(arena.runId.length > 0)

      // Stale runId must be rejected
      const staleAdopt = (await ctx.tools.get('pstack_arena_adopt')!.execute(
        { candidateId: 'A', runId: 'stale-run-id' },
        makeRunCtx(agent),
      )) as { adopted: boolean }
      assert.equal(staleAdopt.adopted, false)

      // Valid runId adopts BOTH committed `app.js` and untracked `helper.js` into parent repo
      const okAdopt = (await ctx.tools.get('pstack_arena_adopt')!.execute(
        { candidateId: 'A', runId: arena.runId },
        makeRunCtx(agent),
      )) as { adopted: boolean }
      assert.equal(okAdopt.adopted, true)
      assert.equal(readFileSync(join(repo, 'app.js'), 'utf8'), 'export const v = 2\n')
      assert.equal(readFileSync(join(repo, 'helper.js'), 'utf8'), 'export const h = true\n')

      // Autopilot uses `every_seconds` and flat GoalView `id`
      const started = (await ctx.tools.get('pstack_autopilot')!.execute(
        { action: 'start', mode: 'drive', objective: 'Drive PRs', everySeconds: 120 },
        makeRunCtx(agent),
      )) as { goalId: string; scheduleId: string }
      assert.equal(started.goalId, 'goal-flat-1')
      assert.equal(started.scheduleId, 'sched-1')
      assert.deepEqual((createdSchedules[0] as { timing: unknown }).timing, { kind: 'every', every_seconds: 120 })

      // Completed worker in `listDescendants` is NOT falsely interrupted/replaced
      await ctx.tools.get('pstack_autopilot')!.execute(
        { action: 'watch-worker', workerSessionId: 'done-worker', workerLabel: 'Done', workerBrief: 'Done' },
        makeRunCtx(agent),
      )
      await new Promise((r) => setTimeout(r, 25))
      const patrolDone = (await ctx.tools.get('pstack_autopilot')!.execute(
        { action: 'patrol-now', stallTimeoutMs: 5 },
        makeRunCtx(agent),
      )) as { replacement?: unknown }
      assert.equal(patrolDone.replacement, undefined)

      await ctx.tools.get('pstack_autopilot')!.execute({ action: 'pause', summary: 'Paused for tonight' }, makeRunCtx(agent))
      assert.deepEqual(pausedGoals, [{ id: 'goal-flat-1', revision: 1 }])
    } finally {
      rmSync(repo, { recursive: true, force: true })
      await ctx.fiber.dispose()
    }
  })
})
