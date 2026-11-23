import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import ToolsService from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import SystemPromptService from '@deepseek-ai/dsh-system-prompt'
import * as rootPlugin from './index.ts'
import * as guardPlugin from './guard/index.ts'
import * as playbookPlugin from './playbook/index.ts'
import * as tddPlugin from './tdd/index.ts'
import * as ledgerPlugin from './ledger/index.ts'
import * as presetRolePlugin from './preset-role/index.ts'
import type { PresetDefinition } from './host/dsh.ts'
import { runtimeFor } from './host/state.ts'

async function createTestHost() {
  const ctx = new Context()
  ctx.plugin(SystemPromptService, { personaPrefix: '' })
  ctx.plugin(ToolsService)
  // Register dummy tools so ToolExecutionPipeline.prepare reaches guards cleanly
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

  const registeredPresets = new Map<string, PresetDefinition>()
  const registeredProjections = new Map<string, unknown>()
  const registeredCommands = new Map<string, { handler: (inv: unknown) => unknown }>()

  ctx.provide('agentPresets', undefined)
  ;(ctx as unknown as Record<string, unknown>).agentPresets = {
    defaultId: 'standard',
    async register(def: PresetDefinition) {
      registeredPresets.set(def.id, def)
      return async () => {
        registeredPresets.delete(def.id)
      }
    },
    async resolve(id = 'standard') {
      return { id }
    },
    async readDocument() {
      throw new Error('no web preset plane')
    },
  }

  ctx.provide('sessionProjections', undefined)
  ;(ctx as unknown as Record<string, unknown>).sessionProjections = {
    async register(unit: { key: string }) {
      registeredProjections.set(unit.key, unit)
      return {
        stateOf: () => undefined,
        async dispose() {},
      }
    },
  }

  ctx.provide('commands', undefined)
  ;(ctx as unknown as Record<string, unknown>).commands = {
    register(def: { name: string; handler: (inv: unknown) => unknown }) {
      registeredCommands.set(def.name, def)
      return () => {
        registeredCommands.delete(def.name)
      }
    },
  }

  await new Promise((r) => setTimeout(r, 15))
  const pipeline = new ToolExecutionPipeline(ctx)
  return { ctx, pipeline, registeredPresets, registeredProjections, registeredCommands }
}

let seqCall = 0
async function prepareCode(
  pipeline: ToolExecutionPipeline,
  name: string,
  args: Record<string, unknown>,
  agent?: unknown,
): Promise<string | undefined> {
  seqCall += 1
  const step = await pipeline.prepare({
    callId: `test-call-${seqCall}` as never,
    name,
    arguments: args,
    signal: new AbortController().signal,
    ...(agent === undefined ? {} : { agent: agent as never }),
  })
  if (step.kind === 'dispatch') return undefined
  return step.result.error?.info?.code
}

function makeRunCtx(agent: unknown): ToolRunContext {
  return {
    callId: 'run-1' as never,
    rootCallId: 'run-1' as never,
    name: 'test',
    arguments: {},
    token: Symbol('token') as never,
    signal: new AbortController().signal,
    agent: agent as never,
    deferContext() {},
    concludeTurn() {},
  }
}

describe('M1 host plugins (root, playbook, tdd, ledger, preset-role)', () => {
  it('registers all 5 presets, projection, and read-only preset guard', async () => {
    const { ctx, pipeline, registeredPresets, registeredProjections } = await createTestHost()
    try {
      ctx.plugin(rootPlugin)
      await new Promise((r) => setTimeout(r, 30))

      for (const id of rootPlugin.PSTACK_PRESET_IDS) {
        assert.ok(registeredPresets.has(id), `missing preset ${id}`)
      }
      assert.ok(registeredProjections.has('pstack'))

      // Mounting `comment-sicko` preset role denies mutating calls
      ctx.plugin(presetRolePlugin, { role: 'comment-sicko' })
      await new Promise((r) => setTimeout(r, 20))
      const code = await prepareCode(pipeline, 'bash', { command: 'echo hi' })
      assert.equal(code, 'PSTACK_READ_ONLY_PRESET')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('enforces TDD red-before-write and unlocks after a failing test run', async () => {
    const { ctx, pipeline, registeredCommands } = await createTestHost()
    try {
      ctx.plugin(tddPlugin)
      await new Promise((r) => setTimeout(r, 20))

      const agent = { id: 'sess-tdd-1' }
      const cmd = registeredCommands.get('tdd')
      assert.ok(cmd !== undefined)

      // Arm via /tdd on
      const armed = await cmd.handler({
        commandId: '1',
        agent,
        rawInput: 'on',
        signal: new AbortController().signal,
      })
      assert.equal((armed as { kind: string }).kind, 'success')

      // Production write blocked, test write allowed
      assert.equal(await prepareCode(pipeline, 'write', { file_path: 'src/a.ts', content: 'x' }, agent), 'PSTACK_TDD_RED_PENDING')
      assert.equal(await prepareCode(pipeline, 'write', { file_path: 'src/a.test.ts', content: 'x' }, agent), undefined)

      // Passing test does NOT unlock production code
      ctx.emit(
        'tools/result' as never,
        { callId: 'c1', name: 'bash', arguments: { command: 'pnpm test' }, agent } as never,
        { content: [{ type: 'text', text: 'exit code: 0' }], isError: false } as never,
      )
      assert.equal(await prepareCode(pipeline, 'write', { file_path: 'src/a.ts', content: 'x' }, agent), 'PSTACK_TDD_RED_PENDING')

      // Failing test unlocks production code (`red-observed`)
      ctx.emit(
        'tools/result' as never,
        { callId: 'c2', name: 'bash', arguments: { command: 'pnpm test' }, agent } as never,
        { content: [{ type: 'text', text: 'exit code: 1' }], isError: true } as never,
      )
      assert.equal(runtimeFor(ctx).sessionPolicy('sess-tdd-1').tdd.phase, 'red-observed')
      assert.equal(await prepareCode(pipeline, 'write', { file_path: 'src/a.ts', content: 'x' }, agent), undefined)

      // Subsequent passing test advances to `green`
      ctx.emit(
        'tools/result' as never,
        { callId: 'c3', name: 'bash', arguments: { command: 'pnpm test' }, agent } as never,
        { content: [{ type: 'text', text: 'exit code: 0' }], isError: false } as never,
      )
      assert.equal(runtimeFor(ctx).sessionPolicy('sess-tdd-1').tdd.phase, 'green')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('seeds native todo_write on playbook read, locks writes in investigation, and denies force-push in babysit', async () => {
    const { ctx, pipeline } = await createTestHost()
    try {
      ctx.plugin(guardPlugin)
      ctx.plugin(playbookPlugin)
      await new Promise((r) => setTimeout(r, 20))

      const appended: { type: string; data: unknown }[] = []
      const agent = {
        id: 'sess-pb-1',
        session: {
          id: 'sess-pb-1',
          append(type: string, data: unknown) {
            appended.push({ type, data })
          },
        },
      }

      // Reading `investigation.md` seeds todos and locks mutating writes AND shell redirects
      ctx.emit(
        'tools/result' as never,
        { callId: 'r1', name: 'read', arguments: { file_path: '/vendor/pstack/skills/poteto-mode/playbooks/investigation.md' }, agent } as never,
        { content: [{ type: 'text', text: '' }], isError: false } as never,
      )
      assert.ok(appended.some((e) => e.type === 'todo/write'))
      assert.equal(await prepareCode(pipeline, 'edit', { file_path: 'src/a.ts' }, agent), 'PSTACK_INVESTIGATION_READONLY')
      assert.equal(await prepareCode(pipeline, 'bash', { command: 'echo x > src/a.ts' }, agent), 'PSTACK_INVESTIGATION_READONLY')

      // Switching to `babysit` lifts investigation lock and upgrades force-push to outright denial
      ctx.emit(
        'tools/result' as never,
        { callId: 'r2', name: 'read', arguments: { file_path: '/vendor/pstack/skills/poteto-mode/playbooks/babysit.md' }, agent } as never,
        { content: [{ type: 'text', text: '' }], isError: false } as never,
      )
      assert.equal(await prepareCode(pipeline, 'edit', { file_path: 'src/a.ts' }, agent), undefined)
      assert.equal(await prepareCode(pipeline, 'bash', { command: 'git push --force origin feat' }, agent), 'PSTACK_FORCE_PUSH')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('writes TSV decision rows, runs Comment Sicko fallback, and steers on unread citations', async () => {
    const { ctx } = await createTestHost()
    const tempDir = mkdtempSync(join(tmpdir(), 'pstack-ledger-'))
    try {
      ctx.plugin(ledgerPlugin)
      await new Promise((r) => setTimeout(r, 20))

      const steered: unknown[] = []
      const events: { seq: number; type: string; data: unknown }[] = []
      const agent = {
        id: 'sess-ledger-1',
        session: {
          id: 'sess-ledger-1',
          meta: { cwd: tempDir },
          append() {},
          ownEvents: () => events,
        },
        steer(msg: unknown) {
          steered.push(msg)
        },
      }

      const logTool = ctx.tools.get('pstack_log')!
      const res = await logTool.execute(
        { phase: 'repro', decision: 'wrote repro script', why: 'avoid manual check', evidence: 'repro.mjs', result: 'failed as expected' },
        makeRunCtx(agent),
      )
      assert.equal((res as { rowNumber: number }).rowNumber, 1)
      const writtenTsv = readFileSync(join(tempDir, '.audit/decisions.tsv'), 'utf8')
      assert.match(writtenTsv, /^ts\tphase\tdecision\twhy\tevidence\tresult\n/)
      assert.match(writtenTsv, /\trepro\twrote repro script\tavoid manual check\trepro\.mjs\tfailed as expected\n$/)

      // Comment Sicko static audit
      writeFileSync(
        join(tempDir, 'dirty.ts'),
        '// narration comment\n// @ts-ignore bad type\nexport const x = 1\n// Safari WebKit quirk https://bugs.webkit.org/1\n',
        'utf8',
      )
      const sickoTool = ctx.tools.get('pstack_no_comments')!
      const sicko = (await sickoTool.execute({ files: ['dirty.ts'] }, makeRunCtx(agent))) as {
        opening: string
        deleted: number
        mustKill: unknown[]
        review: unknown[]
      }
      assert.equal(sicko.opening, 'Yes... Ha ha ha... Yes!')
      assert.equal(sicko.deleted, 1)
      assert.equal(sicko.mustKill.length, 1)
      assert.equal(sicko.review.length, 1)

      // Unread citation steers at turn-stopping
      events.push({
        seq: 1,
        type: 'assistant/message',
        data: { content: [{ type: 'text', text: 'Following Laziness Protocol, we deleted the wrapper.' }] },
      })
      await ctx.serial('agent/turn-stopping' as never, { agent, turn: 1, signal: new AbortController().signal } as never)
      assert.equal(steered.length, 1)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
      await ctx.fiber.dispose()
    }
  })
})
