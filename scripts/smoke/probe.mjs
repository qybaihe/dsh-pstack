// A plugin that scripts/smoke-dsh.mjs mounts in a real DeepSeek Harness. It
// asks the running harness what the bundle registered and enforced across
// M0–M4 and Web/SDK profiles, exercises real DSH SubprocessService, prints one
// JSON line, and exits cleanly.

import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'
import { execSubprocess } from '../../lib/host/dsh.js'

export const name = 'pstack-smoke-probe'
export const inject = ['skills', 'tools']

const WAIT_MS = 20_000

const EXPECTED_TOOLS = [
  'pstack_step',
  'pstack_log',
  'pstack_no_comments',
  'pstack_review_ledger',
  'pstack_arena',
  'pstack_arena_adopt',
  'pstack_interrogate',
  'pstack_swarm',
  'pstack_bench',
  'pstack_attempt',
  'pstack_ketchup',
  'pstack_autopilot',
  'pstack_correct',
]

const EXPECTED_PRESETS = [
  'poteto-agent',
  'comment-sicko',
  'pstack-adversary',
  'pstack-judge',
  'pstack-worker',
]

let calls = 0
const bash = (command, agent) => ({
  callId: `pstack-smoke-${(calls += 1)}`,
  name: 'bash',
  arguments: { command, description: 'pstack smoke probe' },
  signal: new AbortController().signal,
  ...(agent !== undefined ? { agent } : {}),
})

const writeCall = (filePath, agent) => ({
  callId: `pstack-smoke-${(calls += 1)}`,
  name: 'write',
  arguments: { file_path: filePath, content: 'export const x = 1\n' },
  signal: new AbortController().signal,
  ...(agent !== undefined ? { agent } : {}),
})

async function prepare(pipeline, call) {
  const step = await pipeline.prepare(call)
  if (step.kind === 'dispatch') return { outcome: 'would-run' }
  const { error } = step.result
  return { outcome: 'stopped', message: error?.message, code: error?.info?.code }
}

async function waitForSkills(ctx) {
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    const snapshot = await ctx.skills.snapshot({ cwd: process.cwd() })
    const ours = snapshot.skills.filter((skill) => skill.provider === 'pstack')
    if (ours.length > 0 || Date.now() > deadline) return ours
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

async function waitForTools(ctx) {
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    const present = EXPECTED_TOOLS.filter((toolName) => ctx.tools.get(toolName) !== undefined)
    if (present.length === EXPECTED_TOOLS.length || Date.now() > deadline) return present
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
}

async function probePresets(ctx) {
  const registry = ctx.get('agentPresets')
  if (registry === undefined) return null
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    const list = await registry.list()
    const ids = new Set(list.map((p) => p.id))
    if (EXPECTED_PRESETS.every((id) => ids.has(id)) || Date.now() > deadline) break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const resolved = {}
  for (const id of EXPECTED_PRESETS) {
    const preset = await registry.resolve(id)
    resolved[id] = { id: preset.id, broken: preset.broken ?? null }
  }
  return resolved
}

function probeClientBundle(ctx) {
  const clientModules = ctx.get('clientModules')
  if (clientModules === undefined) return null
  const graph = clientModules.graph()
  const entry = graph.entries.find((item) => item.id === '@qybaihe/dsh-pstack')
  return {
    registered: entry !== undefined,
    clientPath: clientModules.clientPath('@qybaihe/dsh-pstack') ?? null,
    inject: entry?.inject ?? [],
  }
}

async function probeRealSubprocess(ctx) {
  const res = await execSubprocess(ctx, process.execPath, ['-e', 'process.stdout.write("subprocess-ok")'], process.cwd(), {
    timeoutMs: 10_000,
  })
  return res.exitCode === 0 ? res.stdout.trim() : `failed(${res.exitCode}): ${res.stderr}`
}

async function probeSdkPipeline(ctx, pipeline) {
  if (ctx.tools.get('bash') === undefined || ctx.tools.get('write') === undefined) {
    return null
  }
  const signal = new AbortController().signal
  const fakeAgent = {
    id: 'smoke-agent-1',
    session: { id: 'smoke-session-1', meta: { cwd: process.cwd() }, append() {}, appendPluginRecord() {} },
  }

  // M0 shell guards (including quoted operator & command substitution checks)
  const addAll = await prepare(pipeline, bash('cd app && git add -A'))
  const quotedAddAll = await prepare(pipeline, bash('echo "safe && git add -A"'))
  const substAddAll = await prepare(pipeline, bash('echo "$(git add -A)"'))
  const draftPr = await prepare(pipeline, bash('gh pr create --draft --fill'))
  const forcePush = await prepare(pipeline, bash('git push --force origin feature'))
  const addFile = await prepare(pipeline, bash('git add src/a.ts'))
  const status = await prepare(pipeline, bash('git status'))

  // M1 TDD gate: arm via /tdd on command, verify red-before-write, traversal block, redirect block, echo spoof ignore & unlock on red test
  const commands = ctx.get('commands')
  const tddCmd = commands?.find(fakeAgent, 'tdd')
  if (tddCmd !== undefined) {
    await tddCmd.handler({
      commandId: 'smoke-cmd-tdd',
      agent: fakeAgent,
      rawInput: ' on',
      attachments: [],
      signal,
    })
  }
  const tddProdBlocked = await prepare(pipeline, writeCall('src/a.ts', fakeAgent))
  const tddTraversalBlocked = await prepare(pipeline, writeCall('tests/../src/a.ts', fakeAgent))
  const tddShellRedirectBlocked = await prepare(pipeline, bash('echo x > src/a.ts', fakeAgent))
  const tddTestAllowed = await prepare(pipeline, writeCall('src/a.test.ts', fakeAgent))

  // Attempt spoof via `echo "npm test" && false` -> must NOT unlock production code
  ctx.emit(
    'tools/result',
    { name: 'bash', arguments: { command: 'echo "npm test" && false' }, agent: fakeAgent },
    { isError: true, content: [{ type: 'text', text: 'exit code: 1' }] },
  )
  const tddAfterEchoSpoof = await prepare(pipeline, writeCall('src/a.ts', fakeAgent))

  // Simulate a real failing test run via tools/result event -> transitions to red-observed
  ctx.emit(
    'tools/result',
    { name: 'bash', arguments: { command: 'npm test' }, agent: fakeAgent },
    { isError: true, content: [{ type: 'text', text: '1 failing\nexit code: 1' }] },
  )
  const tddProdUnlocked = await prepare(pipeline, writeCall('src/a.ts', fakeAgent))

  // M4 live /correct hot-apply without restarting DSH
  const beforeCorrect = await prepare(pipeline, bash('deploy-potato --prod', fakeAgent))
  const correctTool = ctx.tools.get('pstack_correct')
  if (correctTool !== undefined) {
    await correctTool.execute(
      {
        kind: 'deny-pattern',
        value: '^deploy-potato\\b',
        reason: 'Never invoke deploy-potato directly',
        instead: 'Run scripts/release-potato.sh',
      },
      {
        callId: 'smoke-correct',
        rootCallId: 'smoke-correct',
        name: 'pstack_correct',
        arguments: {},
        token: Symbol('smoke'),
        signal,
        agent: fakeAgent,
        deferContext() {},
        concludeTurn() {},
      },
    )
  }
  const afterCorrect = await prepare(pipeline, bash('deploy-potato --prod', fakeAgent))

  return {
    addAll,
    quotedAddAll,
    substAddAll,
    draftPr,
    forcePush,
    addFile,
    status,
    tdd: {
      prodBlocked: tddProdBlocked,
      traversalBlocked: tddTraversalBlocked,
      shellRedirectBlocked: tddShellRedirectBlocked,
      afterEchoSpoof: tddAfterEchoSpoof,
      testAllowed: tddTestAllowed,
      prodUnlocked: tddProdUnlocked,
    },
    correct: {
      before: beforeCorrect,
      after: afterCorrect,
    },
  }
}

async function probe(ctx) {
  const skills = await waitForSkills(ctx)
  const potetoMode = await ctx.skills.get('poteto-mode', { cwd: process.cwd() })
  const tools = await waitForTools(ctx)
  const commandsSvc = ctx.get('commands')
  const probeAgent = { id: 'probe', session: { id: 'probe', append() {} } }
  const commands = ['playbook', 'tdd', 'autopilot', 'correct'].filter(
    (cmd) => commandsSvc?.find(probeAgent, cmd) !== undefined,
  )
  const subprocessProbe = await probeRealSubprocess(ctx)
  const pipeline = new ToolExecutionPipeline(ctx)
  const sdkPipeline = await probeSdkPipeline(ctx, pipeline)
  const presets = await probePresets(ctx)
  const clientBundle = probeClientBundle(ctx)

  return {
    skills: skills.length,
    potetoMode:
      potetoMode === undefined
        ? null
        : {
            provider: potetoMode.provider,
            firstLine: potetoMode.content.split('\n', 1)[0],
            invocation: potetoMode.invocation,
          },
    tools,
    commands,
    subprocessProbe,
    sdkPipeline,
    presets,
    clientBundle,
  }
}

export function apply(ctx) {
  let live = true
  ctx.effect(() => () => {
    live = false
  })
  probe(ctx)
    .catch((error) => ({ error: String(error?.stack ?? error) }))
    .then((report) => {
      if (live) process.stdout.write(`\nPSTACK_PROBE ${JSON.stringify(report)}\n`, () => process.exit(0))
    })
}
