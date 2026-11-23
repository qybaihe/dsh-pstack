/**
 * Narrow TypeScript contracts for DeepSeek Harness host services consumed across
 * pstack's rows, plus the vendored catalog loader, subprocess/shell runners,
 * workspace-cwd resolvers, and ignorable session plugin-record helpers.
 *
 * Verified against DeepSeek Harness Desktop `0.2.2-rc.3` and CLI `0.2.2-rc.5`.
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import type { FoldCatalog, FoldEvent } from '../core/projection.ts'
import { parsePlaybook } from '../core/playbook.ts'
import type { Playbook } from '../core/playbook.ts'
import { parseSkillFile } from '../core/skill-file.ts'

const execFileAsync = promisify(execFile)

export const PSTACK_ROW_IDS: ReadonlySet<string> = new Set([
  'pstack',
  'pstack-skills',
  'pstack-guard',
  'pstack-playbook',
  'pstack-tdd',
  'pstack-ledger',
  'pstack-panel',
  'pstack-bench',
  'pstack-autopilot',
])

export interface ContentTextBlock {
  readonly type: 'text'
  readonly text: string
}

export interface DshUserMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly ContentTextBlock[]
  readonly source: {
    readonly kind: string
    readonly form?: string
    readonly summary?: string
  }
  readonly timestamp?: number
}

export function buildNoticeMessage(text: string, summary = 'pstack runtime rule'): DshUserMessage {
  return Object.freeze({
    id: `msg-pstack-${randomUUID()}`,
    role: 'user' as const,
    content: Object.freeze([Object.freeze({ type: 'text' as const, text })]),
    source: Object.freeze({ kind: 'pstack', form: 'notice', summary }),
    timestamp: Date.now(),
  })
}

export function buildHumanDecisionMessage(text: string): DshUserMessage {
  return Object.freeze({
    id: `msg-user-${randomUUID()}`,
    role: 'user' as const,
    content: Object.freeze([Object.freeze({ type: 'text' as const, text })]),
    source: Object.freeze({ kind: 'user' }),
    timestamp: Date.now(),
  })
}

export interface ProjectionUnit<K extends string, S, V = S> {
  readonly key: K
  readonly stateVersion: number
  readonly stateSchema: { parse(raw: unknown): S }
  init(header: unknown, inheritedEventCount: number): S
  apply(state: S, event: FoldEvent): S
  readonly wire?: {
    readonly viewSchema: { parse(raw: unknown): V }
    view(state: S): V
    readonly summary?: boolean
  }
}

export interface ProjectionHandle<S> {
  stateOf(session: unknown): S
  dispose(): Promise<void>
}

export interface SessionProjectionService {
  register<K extends string, S, V = S>(unit: ProjectionUnit<K, S, V>): Promise<ProjectionHandle<S>>
}

export interface PresetPluginEntry {
  readonly id: string
  readonly name: string
  readonly disabled?: unknown
  readonly group?: boolean
  readonly isolate?: Record<string, unknown>
  readonly config?: unknown
}

export interface PresetDefinition {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  readonly plugins: readonly PresetPluginEntry[]
}

export interface AgentPresetService {
  readonly defaultId: string
  register(definition: PresetDefinition): Promise<() => Promise<void>>
  resolve(id?: string): Promise<{ readonly id: string; readonly broken?: string }>
  readDocument(id: string): Promise<{ readonly agentPreset: string; readonly content: string }>
  list?(): Promise<readonly { readonly id: string; readonly broken?: string }[]>
}

export interface CommandInvocation {
  readonly commandId: string
  readonly agent: Agent
  readonly rawInput: string
  readonly signal: AbortSignal
}

export type CommandResult =
  | { readonly kind: 'success'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string }

export interface CommandsService {
  register(def: {
    readonly name: string
    readonly description: string
    readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
  }): () => void
}

export interface DomainKvTable<V> {
  get(key: string): V | undefined
  entries(): IterableIterator<[string, V]>
  keys(): IterableIterator<string>
  readonly size: number
  put(key: string, value: V): Promise<void>
  delete(key: string): Promise<boolean>
}

export interface OpenedDomain<Tables extends Record<string, unknown>> {
  readonly name: string
  table<N extends keyof Tables & string>(name: N): DomainKvTable<Tables[N]>
  close(): Promise<void>
}

export interface StorageDomainService {
  open<Tables extends Record<string, unknown>>(spec: {
    readonly name: string
    readonly version: number
    readonly invalidRecords?: 'fail' | 'backup-and-skip'
    readonly tables: { readonly [K in keyof Tables]: { readonly valueSchema: { parse(raw: unknown): Tables[K] } } }
  }): Promise<OpenedDomain<Tables>>
}

export interface SubagentResult {
  readonly output: readonly { readonly type: string; readonly text?: string }[]
  readonly structured?: unknown
  readonly diagnostic?: string
  readonly stopReason: string
}

export interface SubagentActivation {
  readonly childId: string
  readonly name: string
  readonly result: Promise<SubagentResult>
  dispose(): Promise<void>
}

export interface SubagentDescendantEntry {
  readonly kind?: string
  readonly sessionId?: string
  readonly id?: string
  readonly name?: string
  readonly status?: string
  readonly activity?: string | { readonly state?: string }
  readonly updatedAt?: number
}

export interface SubagentService {
  startActivation(spec: {
    readonly provider: string
    readonly label: string
    readonly name?: string
    readonly cwd?: string
    readonly agentPreset?: string
    readonly prompt: readonly ContentTextBlock[]
    readonly parent: Agent
    readonly signal: AbortSignal
    readonly delivery: 'parent' | 'caller'
    readonly agentOptions?: {
      readonly provider?: string
      readonly model?: string
      readonly reasoningEffort?: string
      readonly maxTokens?: number
    }
    readonly outputSchema?: Record<string, unknown>
  }): Promise<SubagentActivation>
  interrupt(targetSessionId: string, authority: { readonly kind: 'user' } | { readonly kind: 'ancestor'; readonly agent: Agent }): void
  listDescendants(rootSessionId: string, signal?: AbortSignal): Promise<readonly SubagentDescendantEntry[]>
}

export interface LlmModelCatalogItem {
  readonly id: string
  readonly name?: string
  readonly reasoningEfforts?: readonly string[]
  readonly reasoning?: {
    readonly supportedEfforts?: readonly string[]
    readonly efforts?: readonly { readonly id: string }[]
  }
}

export interface LlmResolvedInfo {
  readonly provider?: string
  readonly id?: string
  readonly name?: string
  readonly reasoning?: {
    readonly supportedEfforts?: readonly string[]
    readonly efforts?: readonly { readonly id: string }[]
  }
}

export interface LlmService {
  listProviders(): readonly { readonly id: string; readonly name: string }[]
  listModels?(provider: string): Promise<readonly LlmModelCatalogItem[]>
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedInfo>
  resolveModel?(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedInfo>
}

export function extractSupportedEfforts(info: LlmResolvedInfo | LlmModelCatalogItem | undefined): readonly string[] {
  if (info === undefined) return []
  if (Array.isArray(info.reasoning?.efforts) && info.reasoning.efforts.length > 0) {
    return info.reasoning.efforts.map((e) => e.id).filter(Boolean)
  }
  if (Array.isArray(info.reasoning?.supportedEfforts) && info.reasoning.supportedEfforts.length > 0) {
    return info.reasoning.supportedEfforts
  }
  if ('reasoningEfforts' in info && Array.isArray(info.reasoningEfforts)) {
    return info.reasoningEfforts
  }
  return []
}

/** Real DSH `ctx.subprocess` contract (`argv`, `stdio`, `graceMs`, `collected.stdout.readFrom(0)`). */
export interface SubprocessOutputReader {
  readFrom(fromByte: number): { readonly text: string; readonly nextOffset: number; readonly lossy: boolean }
}

export interface SubprocessService {
  spawn(spec: {
    readonly argv: readonly string[]
    readonly cwd: string
    readonly stdio: {
      readonly stdin: 'ignore' | 'pipe' | { readonly data: string }
      readonly stdout: 'pipe' | 'inherit' | { readonly maxBytes: number }
      readonly stderr: 'pipe' | 'inherit' | { readonly maxBytes: number }
    }
    readonly graceMs: number
    readonly signal?: AbortSignal
    readonly env?: Readonly<Record<string, string | undefined>>
  }): {
    readonly collected?: {
      readonly stdout?: SubprocessOutputReader
      readonly stderr?: SubprocessOutputReader
    }
    readonly done: Promise<{
      readonly exitCode: number | null
      readonly signal: string | null
      readonly outputs?: {
        readonly stdout?: { readonly text?: string }
        readonly stderr?: { readonly text?: string }
      }
    }>
    terminate(): void
    waitForExit?(signal?: AbortSignal): Promise<boolean>
  }
}

export interface ShellService {
  execute(request: {
    readonly command: string
    readonly workdir?: string
    readonly timeoutMs?: number
    readonly onExpiry?: 'kill' | 'none'
    readonly signal?: AbortSignal
  }): Promise<{
    readonly result: Promise<{
      readonly exitCode: number | null
      readonly timedOut?: boolean
      readonly aborted?: boolean
      readonly stdout?: { readonly text?: string }
      readonly stderr?: { readonly text?: string }
      readonly output?: string
    }>
  }>
}

export interface WorkingDirectoryService {
  get(session: unknown): string
  ensure(agent: Agent, signal?: AbortSignal): Promise<string>
}

export interface ScheduleService {
  create(
    request: {
      readonly title: string
      readonly prompt: string
      readonly timing: { readonly kind: 'every'; readonly every_seconds: number }
      readonly target: { readonly kind: 'session'; readonly sessionId: string }
    },
    actorSessionId?: string,
    signal?: AbortSignal,
  ): Promise<{ readonly id: string; readonly status: string }>
  delete?(request: { readonly id: string }, signal?: AbortSignal): Promise<unknown>
}

export interface GoalSnapshotLike {
  readonly id: string
  readonly revision: number
  readonly objective: string
  readonly phase: string
}

export type GoalViewLike = GoalSnapshotLike | { readonly goal: GoalSnapshotLike }

export function unwrapGoalSnapshot(view: GoalViewLike | undefined): GoalSnapshotLike | undefined {
  if (view === undefined || typeof view !== 'object' || view === null) return undefined
  if ('goal' in view && typeof view.goal === 'object' && view.goal !== null) {
    return view.goal
  }
  if ('id' in view && typeof view.id === 'string') {
    return view
  }
  return undefined
}

export interface GoalService {
  create(agent: Agent, request: { readonly objective: string; readonly maxGoalRounds?: number }): GoalViewLike
  get(agent: Agent): GoalViewLike | undefined
  pause?(agent: Agent, ref: { readonly id: string; readonly revision: number }): GoalViewLike
  resume?(agent: Agent, ref: { readonly id: string; readonly revision: number }): GoalViewLike
}

export interface ConfigEditorEntry {
  readonly id?: string
  readonly options?: { readonly id?: string; readonly name?: string }
}

export interface ConfigEditorService {
  entries(): readonly ConfigEditorEntry[]
  configuration(): readonly {
    readonly entry: ConfigEditorEntry
    readonly inherited: Record<string, unknown>
    readonly override: Record<string, unknown>
  }[]
  edit(
    entry: ConfigEditorEntry,
    change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<void>
}

/** Match a pstack row in `configEditor` by `entry.options.id` first (`entry.id` in Cordis is qualified like `include:pstack-guard`). */
export function findPstackConfigEntry(editor: ConfigEditorService, rowId: string): ConfigEditorEntry | undefined {
  if (!PSTACK_ROW_IDS.has(rowId)) return undefined
  return (
    editor.entries().find((entry) => entry.options?.id === rowId) ??
    editor.entries().find((entry) => entry.id === rowId)
  )
}

export interface HostConnectionFetchRoute {
  readonly path: string
  readonly methods: readonly ('GET' | 'HEAD' | 'POST')[]
  readonly requestBody: 'buffered' | 'streaming'
  readonly fetch: (request: Request) => Promise<Response>
}

export interface HostConnectionService {
  readonly rpc?: {
    handle(
      channel: string,
      handler: (
        endpoint: string,
        payload: unknown,
        signal: AbortSignal,
        peer: unknown,
      ) => Promise<
        | { readonly ok: true; readonly value: unknown }
        | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } }
      >,
    ): () => Promise<void>
  }
  readonly fetch?: {
    register(route: HostConnectionFetchRoute): () => void
  }
}

export function getService<T>(ctx: Context, key: string): T | undefined {
  return (ctx as unknown as { get(name: string): T | undefined }).get(key)
}

export interface SessionHandleLike {
  readonly id: string
  readonly header?: { readonly cwd?: string }
  readonly meta?: { readonly cwd?: string }
  append(type: string, data: unknown): unknown
  appendRecord?(type: `plugin:${string}`, data: unknown): unknown
  events?(): readonly FoldEvent[]
  ownEvents?(): readonly FoldEvent[]
}

export function sessionOfAgent(agent: Agent | undefined): SessionHandleLike | undefined {
  if (agent === undefined) return undefined
  const rec = agent as unknown as {
    id: string
    session?: SessionHandleLike
  }
  return rec.session
}

export function sessionIdOfAgent(agent: Agent | undefined): string | undefined {
  if (agent === undefined) return undefined
  return sessionOfAgent(agent)?.id ?? (agent.id ? String(agent.id) : undefined)
}

export function sessionEventsOfAgent(agent: Agent | undefined): readonly FoldEvent[] {
  const session = sessionOfAgent(agent)
  if (session === undefined) return []
  if (typeof session.events === 'function') return session.events()
  if (typeof session.ownEvents === 'function') return session.ownEvents()
  return []
}

/** Synchronous best-effort workspace directory for guards (prefers `ctx.workingDirectory.get(session)` and `session.header.cwd`). */
export function cwdOfAgent(agent: Agent | undefined, ctx?: Context): string {
  const session = sessionOfAgent(agent)
  if (ctx !== undefined && session !== undefined) {
    const wd = getService<WorkingDirectoryService>(ctx, 'workingDirectory')
    if (wd !== undefined) {
      try {
        const dir = wd.get(session)
        if (typeof dir === 'string' && dir !== '') return dir
      } catch {
        // Fall through to session header / meta.
      }
    }
  }
  return session?.header?.cwd ?? session?.meta?.cwd ?? process.cwd()
}

/** Validated async workspace directory for tool execution (`workingDirectory.ensure(agent, signal)`). */
export async function resolveAgentCwd(ctx: Context, agent: Agent | undefined, signal?: AbortSignal): Promise<string> {
  if (agent !== undefined) {
    const wd = getService<WorkingDirectoryService>(ctx, 'workingDirectory')
    if (wd !== undefined && typeof wd.ensure === 'function') {
      try {
        const ensured = await wd.ensure(agent, signal)
        if (typeof ensured === 'string' && ensured !== '') return ensured
      } catch {
        // Synthetic unit-test agents are not registered in `WorkingDirectoryService`; fall back to session header/meta.
      }
    }
  }
  return cwdOfAgent(agent, ctx)
}

/** Look up a live Agent or Session by `sessionId` for client RPC mutations; returns `undefined` if unknown so callers fail closed. */
export async function resolveLiveSessionTarget(
  ctx: Context,
  sessionId: string | undefined,
  signal?: AbortSignal,
): Promise<{ readonly sessionId: string; readonly agent?: Agent; readonly session?: SessionHandleLike; readonly cwd: string } | undefined> {
  if (sessionId === undefined || sessionId.trim() === '') return undefined
  const agentsSvc = getService<{
    get?(id: string): Agent | undefined
    list?(): Iterable<Agent> | readonly Agent[]
  }>(ctx, 'agents')
  let agent = agentsSvc?.get?.(sessionId)
  if (agent === undefined && typeof agentsSvc?.list === 'function') {
    for (const candidate of agentsSvc.list()) {
      if (String(candidate.id) === sessionId || sessionOfAgent(candidate)?.id === sessionId) {
        agent = candidate
        break
      }
    }
  }
  if (agent !== undefined) {
    const session = sessionOfAgent(agent)
    const cwd = await resolveAgentCwd(ctx, agent, signal)
    return {
      sessionId,
      agent,
      ...(session === undefined ? {} : { session }),
      cwd,
    }
  }
  const sessionsSvc = getService<{ get?(id: string): SessionHandleLike | undefined }>(ctx, 'sessions')
  const session = sessionsSvc?.get?.(sessionId)
  if (session !== undefined) {
    const wd = getService<WorkingDirectoryService>(ctx, 'workingDirectory')
    let cwd = session.header?.cwd ?? session.meta?.cwd
    if (cwd === undefined && wd !== undefined) {
      try {
        cwd = wd.get(session)
      } catch {
        cwd = undefined
      }
    }
    if (cwd !== undefined && cwd !== '') {
      return { sessionId, session, cwd }
    }
  }
  return undefined
}

/** Ensure `candidatePath` resolves strictly inside `workspaceRoot` (prevents `..` traversal outside workspace). */
export function resolveInsideWorkspace(workspaceRoot: string, candidatePath: string): string | undefined {
  const rootAbs = resolve(workspaceRoot)
  const targetAbs = isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(rootAbs, candidatePath)
  const rel = relative(rootAbs, targetAbs)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    return targetAbs
  }
  return undefined
}

export interface ProcessRunResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly spawnFailed: boolean
}

/**
 * Execute a subprocess using DSH's real `ctx.subprocess.spawn({ argv, cwd, stdio, graceMs, signal })`
 * contract, keeping stdout and stderr separate and draining managed process ranges on timeout/abort.
 */
export async function execSubprocess(
  ctx: Context,
  executable: string,
  args: readonly string[],
  cwd: string,
  options?: {
    readonly timeoutMs?: number
    readonly maxBytes?: number
    readonly signal?: AbortSignal
    readonly env?: Readonly<Record<string, string | undefined>>
  },
): Promise<ProcessRunResult> {
  const timeoutMs = options?.timeoutMs ?? 60_000
  const maxBytes = options?.maxBytes ?? 512 * 1024
  const subprocess = getService<SubprocessService>(ctx, 'subprocess')

  if (subprocess !== undefined) {
    const controller = new AbortController()
    let timedOut = false
    const onParentAbort = () => controller.abort()
    options?.signal?.addEventListener('abort', onParentAbort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    timer.unref?.()

    try {
      const handle = subprocess.spawn({
        argv: [executable, ...args],
        cwd,
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes },
          stderr: { maxBytes },
        },
        graceMs: 5_000,
        signal: controller.signal,
        ...(options?.env ? { env: options.env } : {}),
      })
      try {
        const outcome = await handle.done
        const stdout =
          handle.collected?.stdout?.readFrom(0).text ??
          outcome.outputs?.stdout?.text ??
          ''
        const stderr =
          handle.collected?.stderr?.readFrom(0).text ??
          outcome.outputs?.stderr?.text ??
          ''
        if (timedOut) {
          handle.terminate()
          await handle.waitForExit?.().catch(() => false)
        }
        return {
          exitCode: timedOut ? 124 : (outcome.exitCode ?? 1),
          stdout,
          stderr,
          timedOut,
          spawnFailed: false,
        }
      } catch (err) {
        handle.terminate()
        await handle.waitForExit?.().catch(() => false)
        return {
          exitCode: 127,
          stdout: '',
          stderr: err instanceof Error ? err.message : String(err),
          timedOut,
          spawnFailed: true,
        }
      }
    } catch (err) {
      return {
        exitCode: 127,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        timedOut,
        spawnFailed: true,
      }
    } finally {
      clearTimeout(timer)
      options?.signal?.removeEventListener('abort', onParentAbort)
    }
  }

  try {
    const mergedEnv = options?.env ? ({ ...process.env, ...options.env } as NodeJS.ProcessEnv) : process.env
    const { stdout, stderr } = await execFileAsync(executable, [...args], {
      cwd,
      timeout: timeoutMs,
      maxBuffer: maxBytes,
      signal: options?.signal,
      env: mergedEnv,
    })
    return { exitCode: 0, stdout, stderr, timedOut: false, spawnFailed: false }
  } catch (err) {
    const e = err as {
      code?: number | string
      killed?: boolean
      signal?: string
      stdout?: string
      stderr?: string
      message?: string
    }
    const timedOut = Boolean(e.killed && e.signal === 'SIGTERM')
    const spawnFailed = e.code === 'ENOENT' || e.code === 'EACCES'
    return {
      exitCode: typeof e.code === 'number' ? e.code : spawnFailed ? 127 : timedOut ? 124 : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
      timedOut,
      spawnFailed,
    }
  }
}

/** Execute a shell command via `ctx.shell` when mounted, falling back to `execSubprocess`. */
export async function execShellCommand(
  ctx: Context,
  command: string,
  cwd: string,
  options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
): Promise<ProcessRunResult> {
  const shell = getService<ShellService>(ctx, 'shell')
  if (shell !== undefined && typeof shell.execute === 'function') {
    try {
      const execHandle = await shell.execute({
        command,
        workdir: cwd,
        timeoutMs: options?.timeoutMs ?? 60_000,
        onExpiry: 'kill',
        ...(options?.signal ? { signal: options.signal } : {}),
      })
      const res = await execHandle.result
      const stdout = res.stdout?.text ?? res.output ?? ''
      const stderr = res.stderr?.text ?? ''
      return {
        exitCode: res.timedOut ? 124 : (res.exitCode ?? 1),
        stdout,
        stderr,
        timedOut: Boolean(res.timedOut),
        spawnFailed: false,
      }
    } catch {
      // Fall back to direct subprocess execution if `ctx.shell` requires session-only env context.
    }
  }
  if (process.platform === 'win32') {
    return execSubprocess(ctx, 'pwsh', ['-NoProfile', '-Command', command], cwd, options)
  }
  return execSubprocess(ctx, 'bash', ['-lc', command], cwd, options)
}

type AppendPluginRecordFn = (session: unknown, type: `plugin:${string}`, data: unknown) => unknown
let cachedAppendPluginRecord: AppendPluginRecordFn | null | undefined

/**
 * Append an ignorable `plugin:pstack/event` record to a real DSH Session log so
 * UI actions (`tdd` toggle, `adoptCandidate`, `decideKetchup`) and background
 * patrols (`autopilot` replacements) flow through `ctx.sessionProjections`
 * immediately and survive restart/fork/resume without corrupting session logs.
 */
export async function appendPstackSessionRecord(
  session: SessionHandleLike | undefined,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (session === undefined) return false
  if (typeof session.appendRecord === 'function') {
    try {
      session.appendRecord('plugin:pstack/event', payload)
      return true
    } catch {
      return false
    }
  }
  if (cachedAppendPluginRecord === undefined) {
    try {
      const mod = (await import('@deepseek-ai/dsh-session' as string)) as {
        appendPluginRecord?: AppendPluginRecordFn
      }
      cachedAppendPluginRecord = typeof mod.appendPluginRecord === 'function' ? mod.appendPluginRecord : null
    } catch {
      cachedAppendPluginRecord = null
    }
  }
  if (cachedAppendPluginRecord !== null) {
    try {
      cachedAppendPluginRecord(session, 'plugin:pstack/event', payload)
      return true
    } catch {
      return false
    }
  }
  return false
}

export function modelRouteOfAgent(agent: Agent | undefined): ModelSelection | undefined {
  const m = (agent as unknown as { model?: { current?: () => Readonly<ModelSelection> | undefined } } | undefined)?.model
  return m?.current?.()
}

export function vendorRootPath(): string | undefined {
  try {
    return fileURLToPath(new URL('../../vendor/pstack', import.meta.url))
  } catch {
    return undefined
  }
}

let cachedCatalog: (FoldCatalog & {
  readonly vendorRoot?: string
  readonly commentSickoBody: string
  readonly potetoAgentBody: string
  readonly workerRulesBody: string
}) | undefined

export function loadVendoredCatalog(): NonNullable<typeof cachedCatalog> {
  if (cachedCatalog !== undefined) return cachedCatalog
  const root = vendorRootPath()
  const knownSkills = new Set<string>()
  const playbooks = new Map<string, Playbook>()
  let commentSickoBody = 'Yes... Ha ha ha... Yes!'
  let potetoAgentBody = 'Read poteto-mode/SKILL.md in full before doing any work.'
  let workerRulesBody = 'Open every PR ready for review, never as a draft.'

  if (root !== undefined) {
    try {
      const skillsDir = join(root, 'skills')
      for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const parsed = parseSkillFile(readFileSync(join(skillsDir, entry.name, 'SKILL.md'), 'utf8'))
        if (parsed !== undefined) knownSkills.add(parsed.name)
      }
      const playbooksDir = join(skillsDir, 'poteto-mode', 'playbooks')
      for (const entry of readdirSync(playbooksDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const slug = entry.name.slice(0, -3).toLowerCase()
        const pb = parsePlaybook(readFileSync(join(playbooksDir, entry.name), 'utf8'), knownSkills)
        if (pb !== undefined) playbooks.set(slug, pb)
      }
      const sickoParsed = parseSkillFile(readFileSync(join(root, 'agents', 'comment-sicko.md'), 'utf8'))
      if (sickoParsed !== undefined) commentSickoBody = sickoParsed.body
      const agentParsed = parseSkillFile(readFileSync(join(root, 'agents', 'poteto-agent.md'), 'utf8'))
      if (agentParsed !== undefined) potetoAgentBody = agentParsed.body
      workerRulesBody = readFileSync(join(skillsDir, 'poteto-mode', 'worker.md'), 'utf8')
    } catch {
      // Keep graceful defaults when running against a synthetic test root.
    }
  }

  cachedCatalog = {
    ...(root === undefined ? {} : { vendorRoot: root }),
    playbooks,
    knownSkills,
    commentSickoBody,
    potetoAgentBody,
    workerRulesBody,
  }
  return cachedCatalog
}
