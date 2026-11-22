// A plugin that scripts/smoke-dsh.mjs mounts in a real DeepSeek Harness. It
// asks the running harness what the bundle did, prints one JSON line, and
// exits. It prepares tool calls and never dispatches one, so no command runs.

import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'

export const name = 'pstack-smoke-probe'
export const inject = ['skills', 'tools']

const WAIT_MS = 15_000

let calls = 0
const bash = (command) => ({
  callId: `pstack-smoke-${(calls += 1)}`,
  name: 'bash',
  arguments: { command, description: 'pstack smoke probe' },
  signal: new AbortController().signal,
})

async function prepare(pipeline, command) {
  const step = await pipeline.prepare(bash(command))
  if (step.kind === 'dispatch') return { outcome: 'would-run' }
  const { error } = step.result
  return { outcome: 'stopped', message: error?.message, code: error?.info?.code }
}

async function pstackSkills(ctx) {
  const deadline = Date.now() + WAIT_MS
  for (;;) {
    const snapshot = await ctx.skills.snapshot({ cwd: process.cwd() })
    const ours = snapshot.skills.filter((skill) => skill.provider === 'pstack')
    if (ours.length > 0 || Date.now() > deadline) return ours
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

async function probe(ctx) {
  const skills = await pstackSkills(ctx)
  const potetoMode = await ctx.skills.get('poteto-mode', { cwd: process.cwd() })
  const pipeline = new ToolExecutionPipeline(ctx)
  return {
    skills: skills.length,
    potetoMode: potetoMode === undefined ? null : {
      provider: potetoMode.provider,
      firstLine: potetoMode.content.split('\n', 1)[0],
      invocation: potetoMode.invocation,
    },
    addAll: await prepare(pipeline, 'cd app && git add -A'),
    draftPr: await prepare(pipeline, 'gh pr create --draft --fill'),
    forcePush: await prepare(pipeline, 'git push --force origin feature'),
    addFile: await prepare(pipeline, 'git add src/a.ts'),
    status: await prepare(pipeline, 'git status'),
  }
}

export function apply(ctx) {
  let live = true
  ctx.effect(() => () => { live = false })
  probe(ctx)
    .catch((error) => ({ error: String(error?.stack ?? error) }))
    .then((report) => {
      if (live) process.stdout.write(`\nPSTACK_PROBE ${JSON.stringify(report)}\n`, () => process.exit(0))
    })
}
