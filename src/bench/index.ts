/**
 * Hillclimb experiment bench (`@qybaihe/dsh-pstack/bench`, M3):
 * - `pstack_bench`: verifies the 7-question `benchmark-checklist`, SHA-256
 *   freezes the measurement script/files, samples N baseline runs, runs the
 *   regression gate, and persists the full frozen state to `storageDomain` so
 *   restarts rehydrate enforcement seamlessly.
 * - Guards BOTH `write` / `edit` / `apply_patch` AND `bash` / `pwsh` file
 *   redirects/mutations against touching frozen benchmark files (`PSTACK_BENCH_FROZEN`).
 * - `pstack_attempt`: checks `harnessDrift` BEFORE AND AFTER sampling + gate,
 *   evaluates `judgeAttempt`, stages and commits ONLY `changedFiles` (`--only`)
 *   when `kept` (checking exit status before updating `currentBest`), and
 *   restores pre-attempt file snapshots safely on `reverted` without destroying
 *   pre-existing user edits or unrelated untracked files.
 *
 * @module @qybaihe/dsh-pstack/bench
 */

import { createHash } from 'node:crypto'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import {
  DEFAULT_JUDGE_OPTIONS,
  harnessDrift,
  judgeAttempt,
  predicateMet,
  summarize,
} from '../core/experiment.ts'
import type { Direction, FrozenHarness, Sample } from '../core/experiment.ts'
import type { BenchAttemptView, BenchChecklistView } from '../core/projection.ts'
import { shellWriteTargets } from '../core/shell-policy.ts'
import type { OpenedDomain, StorageDomainService } from '../host/dsh.ts'
import {
  cwdOfAgent,
  execShellCommand,
  execSubprocess,
  getService,
  resolveAgentCwd,
  resolveInsideWorkspace,
  sessionIdOfAgent,
  sessionOfAgent,
} from '../host/dsh.ts'
import { runtimeFor } from '../host/state.ts'
import type { FrozenBenchState } from '../host/state.ts'
import { targetPathsOfWriteCall } from '../tdd/index.ts'

export const name = 'pstack-bench'
export const inject = ['tools']

export interface Config {
  writeTools: string[]
  shellTools: string[]
  defaultMinSamples: number
  noiseFactor: number
  minRelativeGain: number
}

export const Config: Schema<Partial<Config>, Config> = Schema.object({
  writeTools: Schema.array(Schema.string()).default(['write', 'edit', 'apply_patch']),
  shellTools: Schema.array(Schema.string()).default(['bash', 'pwsh']),
  defaultMinSamples: Schema.number().default(DEFAULT_JUDGE_OPTIONS.minSamples),
  noiseFactor: Schema.number().default(DEFAULT_JUDGE_OPTIONS.noiseFactor),
  minRelativeGain: Schema.number().default(DEFAULT_JUDGE_OPTIONS.minRelativeGain),
})

async function hashFile(absPath: string): Promise<string | undefined> {
  try {
    const bytes = await readFile(absPath)
    return createHash('sha256').update(bytes).digest('hex')
  } catch {
    return undefined
  }
}

function canonicalExistingPath(absPath: string): string {
  try {
    return existsSync(absPath) ? realpathSync(absPath) : resolve(absPath)
  } catch {
    return resolve(absPath)
  }
}

export function parseSampleLine(stdout: string): Sample | undefined {
  const candidates = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{') && l.endsWith('}'))
  // Walk from last JSON line backward so trailing non-metric diagnostic JSON never masks a valid `{ value }` line
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(candidates[i]!) as { value?: unknown; errors?: unknown; work?: unknown }
      if (typeof parsed.value !== 'number' || !Number.isFinite(parsed.value)) continue
      return {
        value: parsed.value,
        ...(typeof parsed.errors === 'number' ? { errors: parsed.errors } : {}),
        ...(typeof parsed.work === 'number' ? { work: parsed.work } : {}),
      }
    } catch {
      continue
    }
  }
  return undefined
}

async function sampleHarness(
  ctx: Context,
  command: string,
  count: number,
  cwd: string,
  signal?: AbortSignal,
): Promise<{ readonly samples: Sample[]; readonly failedRuns: number }> {
  const samples: Sample[] = []
  let failedRuns = 0
  for (let i = 0; i < count; i += 1) {
    signal?.throwIfAborted?.()
    const res = await execShellCommand(ctx, command, cwd, { timeoutMs: 60_000, ...(signal ? { signal } : {}) })
    if (res.exitCode !== 0) {
      failedRuns += 1
      continue
    }
    const parsed = parseSampleLine(res.stdout)
    if (parsed !== undefined) samples.push(parsed)
    else failedRuns += 1
  }
  return { samples, failedRuns }
}

async function resolveGitRoot(ctx: Context, cwd: string, signal?: AbortSignal): Promise<string> {
  const top = await execSubprocess(ctx, 'git', ['rev-parse', '--show-toplevel'], cwd, {
    timeoutMs: 10_000,
    ...(signal ? { signal } : {}),
  })
  return top.exitCode === 0 && top.stdout.trim() !== '' ? resolve(top.stdout.trim()) : resolve(cwd)
}

/**
 * Safely revert only the files mutated in a rejected hillclimb attempt:
 * - Tracked files that existed in `HEAD` (`git cat-file -e HEAD:<rel>`) are
 *   restored from `HEAD` (`git checkout HEAD -- <rel>`).
 * - Newly created files not in `HEAD` are unstaged (`git rm -f --cached`) and
 *   removed ONLY if they are strictly inside `repoRoot` and outside `.audit/`.
 */
async function restoreAttemptFiles(
  ctx: Context,
  files: readonly string[],
  repoRoot: string,
  signal?: AbortSignal,
): Promise<void> {
  for (const file of files) {
    const abs = resolveInsideWorkspace(repoRoot, file)
    if (abs === undefined) continue
    const rel = relative(repoRoot, abs)
    const relPosix = rel.replaceAll('\\', '/')
    if (relPosix === '' || relPosix.startsWith('.audit/') || relPosix === '.git') continue

    if (existsSync(abs)) {
      try {
        if (statSync(abs).isDirectory()) continue
      } catch {
        continue
      }
    }

    const inHead = await execSubprocess(ctx, 'git', ['cat-file', '-e', `HEAD:${relPosix}`], repoRoot, {
      timeoutMs: 5_000,
      ...(signal ? { signal } : {}),
    })
    if (inHead.exitCode === 0) {
      await execSubprocess(ctx, 'git', ['checkout', 'HEAD', '--', rel], repoRoot, {
        timeoutMs: 10_000,
        ...(signal ? { signal } : {}),
      })
    } else {
      await execSubprocess(ctx, 'git', ['rm', '-f', '--cached', '--ignore-unmatch', '--', rel], repoRoot, {
        timeoutMs: 10_000,
        ...(signal ? { signal } : {}),
      })
      if (existsSync(abs)) {
        await rm(abs, { force: true }).catch(() => {})
      }
    }
  }
}

export function apply(ctx: Context, config: Config): void {
  const runtime = runtimeFor(ctx)
  const frozenBySession = new Map<string, FrozenBenchState>()
  const preFreezeFileSnapshots = new Map<string, Map<string, Buffer>>()

  let domainPromise: Promise<OpenedDomain<{ benches: FrozenBenchState }> | undefined> = Promise.resolve(undefined)
  ctx.inject(['storageDomain'], (inner) => {
    const storageDomain = getService<StorageDomainService>(inner, 'storageDomain')
    if (storageDomain === undefined) return
    const opened = storageDomain
      .open<{ benches: FrozenBenchState }>({
        name: 'pstack_bench',
        version: 2,
        invalidRecords: 'backup-and-skip',
        tables: {
          benches: {
            valueSchema: {
              parse(raw: unknown) {
                if (
                  typeof raw !== 'object' ||
                  raw === null ||
                  typeof (raw as { harness?: unknown }).harness !== 'object' ||
                  typeof (raw as { baseline?: unknown }).baseline !== 'object'
                ) {
                  throw new Error('Invalid FrozenBenchState record')
                }
                return raw as FrozenBenchState
              },
            },
          },
        },
      })
      .then((dom) => {
        // Eagerly seed `frozenBySession` from durable storage so synchronous guards enforce immediately after restart!
        for (const [sid, state] of dom.table('benches').entries()) {
          frozenBySession.set(sid, state)
        }
        return dom
      })
      .catch(() => undefined)
    domainPromise = opened
    inner.effect(() => async () => {
      const dom = await opened
      await dom?.close()
    })
  })

  function activeFrozenFor(sessionId: string, session?: unknown): FrozenBenchState | undefined {
    const policy = runtime.sessionPolicy(sessionId, session)
    if (policy.frozenBench !== undefined) return policy.frozenBench
    const persisted = frozenBySession.get(sessionId)
    if (persisted !== undefined) {
      policy.frozenBench = persisted
      return persisted
    }
    return undefined
  }

  // Guard writes AND shell mutations against frozen benchmark files
  ctx.effect(() =>
    ctx.tools.guard((exec) => {
      const sessionId = sessionIdOfAgent(exec.agent) ?? '__default__'
      const frozen = activeFrozenFor(sessionId, sessionOfAgent(exec.agent))
      if (frozen === undefined) return undefined
      const cwd = cwdOfAgent(exec.agent, ctx)
      const rootDir = frozen.repoRoot || cwd
      const frozenCanonical = new Set(
        Object.keys(frozen.harness.files).map((f) =>
          canonicalExistingPath(isAbsolute(f) ? f : resolve(rootDir, f)),
        ),
      )

      let targets = targetPathsOfWriteCall(exec as Pick<ToolExecution, 'name' | 'arguments'>, config.writeTools)
      if (targets.length === 0 && config.shellTools.includes(exec.name)) {
        const args = exec.arguments as { command?: unknown } | null
        if (typeof args?.command === 'string') {
          targets = shellWriteTargets(args.command)
        }
      }

      for (const target of targets) {
        const abs = canonicalExistingPath(isAbsolute(target) ? target : resolve(cwd, target))
        if (frozenCanonical.has(abs)) {
          return {
            reason: `🥔 \`${target}\` is part of the frozen hillclimb measurement harness. Modifying the benchmark invalidates all numbers.`,
            info: { name: 'PstackBenchFrozenError', code: 'PSTACK_BENCH_FROZEN' },
          }
        }
      }
      return undefined
    }),
  )

  // 1. `pstack_bench`: freeze harness & record baseline
  ctx.effect(() =>
    ctx.tools.register(
      defineTool({
        name: 'pstack_bench',
        description:
          'Freeze a hillclimb measurement harness (`benchmark-checklist`), SHA-256 hash its script files so neither tools nor shell redirects can alter them, sample the baseline N times, and check the regression gate.',
        parameters: {
          metricName: { type: 'string', required: true, description: 'Metric label (e.g. `First paint p50 ms`).' },
          command: {
            type: 'string',
            required: true,
            description: 'Shell command printing one JSON line `{"value": <number>, "errors": 0, "work": <units>}`.',
          },
          files: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: 'Benchmark script and fixture paths inside the repository to hash and freeze.',
          },
          direction: {
            type: 'string',
            required: true,
            enum: ['lower', 'higher'],
            description: 'Whether lower or higher metric values are better.',
          },
          gateCommand: {
            type: 'string',
            description: 'Regression test command that must stay green on every kept attempt.',
          },
          minSamples: { type: 'integer', description: 'Samples per measurement (default 5).' },
          targetRelativeGain: {
            type: 'number',
            description: 'Relative improvement target from 0 to 1, e.g. 0.5 for 50% better.',
          },
          minAttempts: { type: 'integer', description: 'Minimum attempts before stop predicate can fire (default 5).' },
          representative: { type: 'boolean', description: 'Attestation: workload matches production shape.' },
          steadyState: { type: 'boolean', description: 'Attestation: warmup/cold-start accounted for.' },
          isolatedNoise: { type: 'boolean', description: 'Attestation: external variance minimized.' },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              metricName: { type: 'string', required: true },
              direction: { type: 'string', required: true },
              baseline: { type: 'number', required: true },
              spread: { type: 'number', required: true },
              work: { type: 'number' },
              minSamples: { type: 'integer', required: true },
              targetRelativeGain: { type: 'number', required: true },
              minAttempts: { type: 'integer', required: true },
              gateCommand: { type: 'string' },
              frozenFiles: { type: 'array', required: true, items: { type: 'string' } },
              checklist: { type: 'object', required: true, additionalProperties: true },
            },
          },
          render: (_args, value) => {
            const v = value as { metricName: string; baseline: number; spread: number; frozenFiles: string[] }
            return [
              {
                type: 'text',
                text: `🥔 Frozen benchmark "${v.metricName}": baseline median ${v.baseline} (±${Math.round(v.spread * 100) / 100}), locked files: ${v.frozenFiles.join(', ')}.`,
              },
            ]
          },
          presentationMeta: (_args, value) => ({ pstackKind: 'bench-freeze', ...(value as Record<string, unknown>) }),
        },
        async execute(rawArgs, exec) {
          const args = rawArgs as {
            metricName: string
            command: string
            files: string[]
            direction: Direction
            gateCommand?: string
            minSamples?: number
            targetRelativeGain?: number
            minAttempts?: number
            representative?: boolean
            steadyState?: boolean
            isolatedNoise?: boolean
          }
          if (args.files.length === 0) {
            throw new Error('`files` must list at least one benchmark script or fixture file to freeze.')
          }
          const cwd = await resolveAgentCwd(ctx, exec.agent, exec.signal)
          const repoRoot = await resolveGitRoot(ctx, cwd, exec.signal)
          const sessionId = sessionIdOfAgent(exec.agent) ?? '__default__'
          const minSamples = Math.max(1, args.minSamples ?? config.defaultMinSamples)
          const targetRelativeGain = args.targetRelativeGain ?? 0.25
          const minAttempts = Math.max(1, args.minAttempts ?? 5)

          const fileHashes: Record<string, string> = {}
          const fileSnapshots = new Map<string, Buffer>()
          for (const f of args.files) {
            const abs = resolveInsideWorkspace(repoRoot, f)
            if (abs === undefined || !existsSync(abs) || statSync(abs).isDirectory()) {
              throw new Error(`Benchmark file must be an existing file inside repository (${repoRoot}): ${f}`)
            }
            const bytes = await readFile(abs)
            const rel = relative(repoRoot, abs)
            fileHashes[rel] = createHash('sha256').update(bytes).digest('hex')
            fileSnapshots.set(rel, bytes)
          }

          const { samples, failedRuns } = await sampleHarness(ctx, args.command, minSamples, cwd, exec.signal)
          if (failedRuns > 0 || samples.length < minSamples) {
            throw new Error(
              `Baseline produced ${samples.length}/${minSamples} valid JSON samples (${failedRuns} failed run(s)). Fix the harness before freezing.`,
            )
          }
          const baseline = summarize(samples)
          if (baseline.errors > 0) {
            throw new Error(`Baseline reported ${baseline.errors} error(s); fix the harness before freezing.`)
          }
          if (baseline.workInconsistent === true) {
            throw new Error('Baseline samples reported inconsistent `work` counts; stabilize the workload first.')
          }
          if (args.gateCommand !== undefined && args.gateCommand.trim() !== '') {
            const gate = await execShellCommand(ctx, args.gateCommand, cwd, {
              timeoutMs: 60_000,
              signal: exec.signal,
            })
            if (gate.exitCode !== 0) {
              throw new Error(`Baseline regression gate failed:\n${gate.stdout}\n${gate.stderr}`)
            }
          }

          const harness: FrozenHarness = { command: args.command, files: fileHashes }
          const frozenState: FrozenBenchState = {
            metricName: args.metricName,
            direction: args.direction,
            repoRoot,
            harness,
            baseline,
            currentBest: baseline,
            ...(args.gateCommand && args.gateCommand.trim() !== '' ? { gateCommand: args.gateCommand.trim() } : {}),
            minSamples,
            targetRelativeGain,
            minAttempts,
            attempts: 0,
          }

          runtime.sessionPolicy(sessionId, sessionOfAgent(exec.agent)).frozenBench = frozenState
          frozenBySession.set(sessionId, frozenState)
          preFreezeFileSnapshots.set(sessionId, fileSnapshots)

          const dom = await domainPromise
          await dom?.table('benches').put(sessionId, frozenState)

          const checklist: BenchChecklistView = {
            zeroErrors: baseline.errors === 0,
            enoughSamples: baseline.count >= minSamples,
            workCounted: baseline.work !== undefined,
            ...(args.representative === undefined ? {} : { representative: args.representative }),
            ...(args.steadyState === undefined ? {} : { steadyState: args.steadyState }),
            ...(args.isolatedNoise === undefined ? {} : { isolatedNoise: args.isolatedNoise }),
            gateNamed: Boolean(args.gateCommand && args.gateCommand.trim() !== ''),
          }

          return {
            metricName: args.metricName,
            direction: args.direction,
            baseline: baseline.median,
            spread: baseline.spread,
            ...(baseline.work === undefined ? {} : { work: baseline.work }),
            minSamples,
            targetRelativeGain,
            minAttempts,
            ...(frozenState.gateCommand ? { gateCommand: frozenState.gateCommand } : {}),
            frozenFiles: Object.keys(fileHashes),
            checklist: { ...checklist },
          }
        },
      }),
    ),
  )

  // 2. `pstack_attempt`: sample, verify integrity & work before AND after run, keep (path-only commit) or revert
  ctx.effect(() =>
    ctx.tools.register(
      defineTool({
        name: 'pstack_attempt',
        description:
          'Evaluate one hillclimb hypothesis against the frozen benchmark: verify no benchmark drift before and after running, sample N runs, run the regression gate, commit `changedFiles` by path when kept, or restore `changedFiles` when reverted.',
        parameters: {
          hypothesis: { type: 'string', required: true, description: 'Specific causal hypothesis for this attempt.' },
          changedFiles: {
            type: 'array',
            required: true,
            items: { type: 'string' },
            description: 'Exact production files touched by this attempt (staged by path on keep, restored on revert).',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              verdict: { type: 'string', required: true },
              reason: { type: 'string' },
              driftedFiles: { type: 'array', items: { type: 'string' } },
              attempt: { type: 'object', additionalProperties: true },
              predicateMet: { type: 'boolean', required: true },
              summaryText: { type: 'string', required: true },
            },
          },
          render: (_args, value) => [{ type: 'text', text: String((value as { summaryText: string }).summaryText) }],
          presentationMeta: (_args, value) => ({ pstackKind: 'bench-attempt', ...(value as Record<string, unknown>) }),
        },
        async execute(rawArgs, exec) {
          const args = rawArgs as { hypothesis: string; changedFiles: string[] }
          const cwd = await resolveAgentCwd(ctx, exec.agent, exec.signal)
          const sessionId = sessionIdOfAgent(exec.agent) ?? '__default__'
          const session = sessionOfAgent(exec.agent)

          let bench = activeFrozenFor(sessionId, session)
          if (bench === undefined) {
            const dom = await domainPromise
            const stored = dom?.table('benches').get(sessionId)
            if (stored !== undefined) {
              bench = stored
              runtime.sessionPolicy(sessionId, session).frozenBench = stored
              frozenBySession.set(sessionId, stored)
            }
          }
          if (bench === undefined) {
            throw new Error('No benchmark is frozen in this session. Call `pstack_bench` first.')
          }

          const repoRoot = bench.repoRoot || (await resolveGitRoot(ctx, cwd, exec.signal))
          const validatedRelFiles: string[] = []
          const frozenCanon = new Set(
            Object.keys(bench.harness.files).map((f) =>
              canonicalExistingPath(isAbsolute(f) ? f : resolve(repoRoot, f)),
            ),
          )

          for (const f of args.changedFiles) {
            const abs = resolveInsideWorkspace(repoRoot, f)
            if (abs === undefined) {
              throw new Error(`changedFiles entry "${f}" resolves outside repository root (${repoRoot}).`)
            }
            if (existsSync(abs) && statSync(abs).isDirectory()) {
              throw new Error(`changedFiles entry "${f}" must name a file, not a directory.`)
            }
            if (frozenCanon.has(canonicalExistingPath(abs))) {
              throw new Error(`changedFiles entry "${f}" is a frozen benchmark file and cannot be modified.`)
            }
            const rel = relative(repoRoot, abs)
            if (rel.replaceAll('\\', '/').startsWith('.audit/')) {
              throw new Error(`changedFiles must not include ledger files (${rel}).`)
            }
            validatedRelFiles.push(rel)
          }

          const checkFrozenHashes = async (): Promise<string[]> => {
            const currentHashes: Record<string, string | undefined> = {}
            for (const f of Object.keys(bench!.harness.files)) {
              const abs = isAbsolute(f) ? f : resolve(repoRoot, f)
              currentHashes[f] = await hashFile(abs)
            }
            return harnessDrift(bench!.harness, currentHashes)
          }

          const restoreDriftedFrozenFiles = async (drifted: readonly string[]) => {
            const snaps = preFreezeFileSnapshots.get(sessionId)
            for (const f of drifted) {
              const abs = isAbsolute(f) ? f : resolve(repoRoot, f)
              const bytes = snaps?.get(f)
              if (bytes !== undefined) {
                await writeFile(abs, bytes).catch(() => {})
              } else {
                await restoreAttemptFiles(ctx, [f], repoRoot, exec.signal)
              }
            }
          }

          // 1. Pre-run frozen hash check (`harnessDrift`)
          const preDrifted = await checkFrozenHashes()
          if (preDrifted.length > 0) {
            await restoreAttemptFiles(ctx, validatedRelFiles, repoRoot, exec.signal)
            await restoreDriftedFrozenFiles(preDrifted)
            return {
              verdict: 'voided',
              reason: 'harness-drift',
              driftedFiles: preDrifted,
              predicateMet: false,
              summaryText: `🥔 Attempt voided: frozen benchmark file(s) changed (${preDrifted.join(', ')}). Restored working tree.`,
            }
          }

          // 2. Sample & gate
          const { samples, failedRuns } = await sampleHarness(
            ctx,
            bench.harness.command,
            bench.minSamples,
            cwd,
            exec.signal,
          )
          const after =
            samples.length > 0
              ? {
                  ...summarize(samples),
                  errors: summarize(samples).errors + failedRuns,
                }
              : { count: 0, median: bench.currentBest.median, spread: 0, errors: 1, work: bench.currentBest.work }

          let gateGreen = true
          if (bench.gateCommand !== undefined && bench.gateCommand.trim() !== '') {
            const gateRes = await execShellCommand(ctx, bench.gateCommand, cwd, {
              timeoutMs: 60_000,
              signal: exec.signal,
            })
            gateGreen = gateRes.exitCode === 0
          }

          // 3. Post-run frozen hash re-check (catches benchmark/gate scripts mutating frozen files during execution!)
          const postDrifted = await checkFrozenHashes()
          if (postDrifted.length > 0) {
            await restoreAttemptFiles(ctx, validatedRelFiles, repoRoot, exec.signal)
            await restoreDriftedFrozenFiles(postDrifted)
            return {
              verdict: 'voided',
              reason: 'harness-drift',
              driftedFiles: postDrifted,
              predicateMet: false,
              summaryText: `🥔 Attempt voided: frozen benchmark file(s) mutated during execution (${postDrifted.join(', ')}). Restored working tree.`,
            }
          }

          const judged = judgeAttempt(bench.currentBest, after, gateGreen, {
            direction: bench.direction,
            minSamples: bench.minSamples,
            noiseFactor: config.noiseFactor,
            minRelativeGain: config.minRelativeGain,
          })

          const nextAttemptIndex = bench.attempts + 1
          let commitSha: string | undefined
          let finalVerdict = judged

          if (judged.kind === 'kept') {
            if (validatedRelFiles.length === 0) {
              throw new Error('Cannot commit a kept attempt with empty `changedFiles`.')
            }
            const added = await execSubprocess(ctx, 'git', ['add', '--', ...validatedRelFiles], repoRoot, {
              timeoutMs: 15_000,
              signal: exec.signal,
            })
            // `--only` commits ONLY `validatedRelFiles` without sweeping unrelated pre-staged index entries!
            const committed =
              added.exitCode === 0
                ? await execSubprocess(
                    ctx,
                    'git',
                    ['commit', '--only', '-m', `perf(hillclimb): ${args.hypothesis}`, '--', ...validatedRelFiles],
                    repoRoot,
                    { timeoutMs: 20_000, signal: exec.signal },
                  )
                : added

            if (committed.exitCode !== 0) {
              throw new Error(
                `Benchmark improved (${bench.currentBest.median} → ${after.median}), but path-only git commit failed: ${(committed.stderr || committed.stdout).trim()}`,
              )
            }
            const rev = await execSubprocess(ctx, 'git', ['rev-parse', '--short', 'HEAD'], repoRoot, {
              timeoutMs: 5_000,
            })
            if (rev.exitCode === 0 && rev.stdout.trim() !== '') commitSha = rev.stdout.trim()

            const updatedBench: FrozenBenchState = {
              ...bench,
              currentBest: after,
              attempts: nextAttemptIndex,
            }
            runtime.sessionPolicy(sessionId, session).frozenBench = updatedBench
            frozenBySession.set(sessionId, updatedBench)
            const dom = await domainPromise
            await dom?.table('benches').put(sessionId, updatedBench)
          } else {
            await restoreAttemptFiles(ctx, validatedRelFiles, repoRoot, exec.signal)
            const updatedBench: FrozenBenchState = {
              ...bench,
              attempts: nextAttemptIndex,
            }
            runtime.sessionPolicy(sessionId, session).frozenBench = updatedBench
            frozenBySession.set(sessionId, updatedBench)
            const dom = await domainPromise
            await dom?.table('benches').put(sessionId, updatedBench)
          }

          const newBest = finalVerdict.kind === 'kept' ? after.median : bench.currentBest.median
          const met = predicateMet(bench.baseline.median, newBest, bench.direction, nextAttemptIndex, {
            targetRelativeGain: bench.targetRelativeGain,
            minAttempts: bench.minAttempts,
          })

          const attemptView: BenchAttemptView = {
            index: nextAttemptIndex,
            hypothesis: args.hypothesis,
            before: bench.currentBest.median,
            after: after.median,
            noise: Math.round(finalVerdict.noise * 100) / 100,
            spread: Math.round(after.spread * 100) / 100,
            kept: finalVerdict.kind === 'kept',
            relativeGain: Math.round(finalVerdict.relativeGain * 1000) / 1000,
            ...(finalVerdict.kind === 'reverted' ? { revertReason: finalVerdict.reason } : {}),
            ...(commitSha ? { commitSha } : {}),
          }

          const pct = Math.round(finalVerdict.relativeGain * 100)
          const summaryText =
            finalVerdict.kind === 'kept'
              ? `🥔 Attempt #${nextAttemptIndex} KEPT (${bench.currentBest.median} → ${after.median}, ${pct >= 0 ? '+' : ''}${pct}%${commitSha ? `, commit ${commitSha}` : ''})${met ? ' · STOP PREDICATE MET' : ''}`
              : `🥔 Attempt #${nextAttemptIndex} REVERTED (${finalVerdict.reason}: ${bench.currentBest.median} → ${after.median}). Restored attempt files.`

          return {
            verdict: finalVerdict.kind,
            ...(finalVerdict.kind === 'reverted' ? { reason: finalVerdict.reason } : {}),
            attempt: { ...attemptView },
            predicateMet: met,
            summaryText,
          }
        },
      }),
    ),
  )
}
