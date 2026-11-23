/**
 * Pure session-log fold producing the `pstack` projection view shared by the
 * Host (`ctx.sessionProjections`) and the Web/Desktop Client (`useProjection`).
 *
 * Kept in `src/core` so both halves and unit tests share one exact data shape
 * with zero harness dependencies.
 */

import { PRINCIPLE_CATALOG, playbookSlugFromPath, resolvePlaybookSlug, skillNameFromPath } from './catalog.ts'
import type { DecisionRow } from './decision-log.ts'
import { rowsWithoutEvidence } from './decision-log.ts'
import type { Direction, RevertReason } from './experiment.ts'
import { computeTargetValue, predicateMet } from './experiment.ts'
import type {
  ArenaCandidate,
  ArenaCriterionScore,
  ArenaPhase,
  ArenaShapeSignal,
  PrStackItem,
  ReviewerDiscardSummary,
  SickoReport,
  SwarmStatus,
  VerifiedFinding,
} from './panel-rules.ts'
import { evaluateArenaMatrix } from './panel-rules.ts'
import type { Playbook } from './playbook.ts'
import { parsePlaybook } from './playbook.ts'
import { unreadCitations } from './principles.ts'
import type { TddState } from './tdd-gate.ts'
import { TDD_OFF, isTestCommand, reduceTdd } from './tdd-gate.ts'

export type StampTone = 'red' | 'green' | 'gold' | 'purple' | 'mute'

export interface MomentEvent {
  readonly seq: number
  readonly skill: string
  readonly textZh: string
  readonly textEn: string
  readonly stampZh: string
  readonly stampEn: string
  readonly tone: StampTone
  readonly said?: boolean
}

export interface PlaybookStepView {
  readonly index: number
  readonly label: string
  readonly text: string
  readonly routes: readonly string[]
  readonly status: 'pending' | 'in_progress' | 'completed'
}

export interface ArenaView {
  readonly runId?: string
  readonly task: string
  readonly phase: ArenaPhase
  readonly candidates: readonly ArenaCandidate[]
  readonly criteria: readonly ArenaCriterionScore[]
  readonly totals: Readonly<Record<string, number | null>>
  readonly recommendedBase?: string
  readonly parentChosenBase?: string
  readonly baseDisagreement: boolean
  readonly shape: ArenaShapeSignal
  readonly judge?: {
    readonly status: 'picked' | 'no-other-vendor' | 'skipped-unknown-parent' | 'empty-pool'
    readonly model?: string
    readonly vendor?: string
    readonly parentVendor?: string
    readonly rationale?: string
    readonly scored?: boolean
  }
  readonly queuedCount: number
}

export interface InterrogateView {
  readonly task: string
  readonly verified: readonly VerifiedFinding[]
  readonly droppedCount: number
  readonly discards: readonly ReviewerDiscardSummary[]
  readonly queuedCount: number
}

export interface SwarmSliceView {
  readonly index: number
  readonly label: string
  readonly workerModel?: string
  readonly outcome: 'PASS' | 'ISSUES' | 'BLOCKED' | 'redispatched' | 'gap'
  readonly retries?: number
  readonly sha?: string
  readonly refName?: string
  readonly approach?: string
  readonly reason?: string
}

export interface SwarmView {
  readonly task: string
  readonly slices: readonly SwarmSliceView[]
}

export interface BenchAttemptView {
  readonly index: number
  readonly hypothesis: string
  readonly before: number
  readonly after: number
  readonly noise: number
  readonly spread?: number
  readonly kept: boolean
  readonly relativeGain: number
  readonly revertReason?: RevertReason | 'harness-drift'
  readonly commitSha?: string
}

export interface BenchChecklistView {
  readonly zeroErrors: boolean
  readonly enoughSamples: boolean
  readonly workCounted: boolean
  readonly representative?: boolean
  readonly steadyState?: boolean
  readonly isolatedNoise?: boolean
  readonly gateNamed: boolean
}

export interface BenchView {
  readonly metricName: string
  readonly direction: Direction
  readonly minSamples: number
  readonly baseline: number
  readonly targetValue: number
  readonly targetRelativeGain: number
  readonly minAttempts: number
  readonly frozen: boolean
  readonly driftedFiles: readonly string[]
  readonly gateCommand?: string
  readonly checklist?: BenchChecklistView
  readonly attempts: readonly BenchAttemptView[]
  readonly plateau: boolean
  readonly met: boolean
}

export interface KetchupOptionView {
  readonly label: string
  readonly prompt: string
  readonly cost?: string
  readonly primary?: boolean
}

export interface KetchupItemView {
  readonly id: string
  readonly question: string
  readonly recommendation: string
  readonly change?: string
  readonly evidence?: string
  readonly risk?: string
  readonly options: readonly KetchupOptionView[]
  readonly decided?: string
}

export interface LedgerEntryView extends DecisionRow {
  readonly runStart?: boolean
}

export interface AutopilotView {
  readonly mode?: 'drive' | 'threads-only' | 'check'
  readonly active: boolean
  readonly scheduleId?: string
  readonly goalId?: string
  readonly waitingApproval?: boolean
  readonly checkpointSaved?: boolean
  readonly resumeHint?: string
  readonly replacements: readonly {
    readonly target: string
    readonly oldSessionId?: string
    readonly newSessionId?: string
    readonly reason: string
    readonly at: string
  }[]
  readonly stack: readonly PrStackItem[]
}

export interface PstackView {
  readonly v: 1
  readonly mode: 'off' | 'on'
  readonly playbook: {
    readonly slug: string
    readonly title: string
    readonly stance: string
    readonly goal?: string
    readonly steps: readonly PlaybookStepView[]
    readonly currentStep: number
    readonly completed: boolean
  } | null
  readonly readSkills: readonly string[]
  readonly readPrinciples: readonly string[]
  readonly flaggedPrinciples: readonly string[]
  readonly premiseWarning: {
    readonly command: string
    readonly count: number
  } | null
  readonly tdd: TddState
  readonly guard: {
    readonly blocks: number
    readonly lastBlockedCommand?: string
    readonly asks: number
    readonly pendingApprovals?: number
    readonly forbidForcePush: boolean
    readonly holdPrMerge?: boolean
  }
  readonly arena: ArenaView | null
  readonly interrogate: InterrogateView | null
  readonly swarm: SwarmView | null
  readonly bench: BenchView | null
  readonly ledger: {
    readonly rows: readonly LedgerEntryView[]
    readonly missingEvidenceIndices: readonly number[]
    readonly attention?: {
      readonly reviewerVendor: string
      readonly reviewerModel: string
      readonly note: string
    }
  }
  readonly sicko: SickoReport | null
  readonly ketchup: readonly KetchupItemView[]
  readonly pendingKetchupCount: number
  readonly autopilot: AutopilotView | null
  readonly moment: MomentEvent | null
}

/** Compact per-session summary published to `SessionSummary.projectionValues.pstackSummary` so sidebar rows never haul full tables. */
export interface PstackSummaryView {
  readonly v: 1
  readonly active: boolean
  readonly mode: 'off' | 'on'
  readonly playbookTitle?: string
  readonly activeStepLabel?: string
  readonly currentStep: number
  readonly totalSteps: number
  readonly completed: boolean
  readonly pendingCount: number
  readonly autopilotActive: boolean
  readonly autopilotMode?: string
  readonly checkpointSaved: boolean
}

export const EMPTY_PSTACK_VIEW: PstackView = Object.freeze({
  v: 1,
  mode: 'off',
  playbook: null,
  readSkills: [],
  readPrinciples: [],
  flaggedPrinciples: [],
  premiseWarning: null,
  tdd: TDD_OFF,
  guard: { blocks: 0, asks: 0, pendingApprovals: 0, forbidForcePush: false, holdPrMerge: false },
  arena: null,
  interrogate: null,
  swarm: null,
  bench: null,
  ledger: { rows: [], missingEvidenceIndices: [] },
  sicko: null,
  ketchup: [],
  pendingKetchupCount: 0,
  autopilot: null,
  moment: null,
})

export const EMPTY_PSTACK_SUMMARY: PstackSummaryView = Object.freeze({
  v: 1,
  active: false,
  mode: 'off',
  currentStep: 0,
  totalSteps: 0,
  completed: false,
  pendingCount: 0,
  autopilotActive: false,
  checkpointSaved: false,
})

export function summarizePstackView(view: PstackView): PstackSummaryView {
  const pb = view.playbook
  const pendingCount = view.pendingKetchupCount + (view.guard.pendingApprovals ?? 0) + (view.autopilot?.waitingApproval ? 1 : 0)
  const autopilotActive = view.autopilot?.active === true
  const checkpointSaved = view.autopilot?.checkpointSaved === true
  const active =
    view.mode === 'on' ||
    pb !== null ||
    view.tdd.phase !== 'off' ||
    view.guard.blocks > 0 ||
    pendingCount > 0 ||
    autopilotActive ||
    checkpointSaved ||
    view.arena !== null ||
    view.interrogate !== null ||
    view.swarm !== null ||
    view.bench !== null ||
    view.ledger.rows.length > 0 ||
    view.sicko !== null

  if (!active) return EMPTY_PSTACK_SUMMARY
  const activeStep = pb?.steps.find((s) => s.index === pb.currentStep)
  return {
    v: 1,
    active: true,
    mode: view.mode,
    ...(pb ? { playbookTitle: pb.title } : {}),
    ...(activeStep ? { activeStepLabel: activeStep.label } : {}),
    currentStep: pb?.currentStep ?? 0,
    totalSteps: pb?.steps.length ?? 0,
    completed: pb?.completed === true,
    pendingCount,
    autopilotActive,
    ...(view.autopilot?.mode ? { autopilotMode: view.autopilot.mode } : {}),
    checkpointSaved,
  }
}

/** Minimal shape of a committed DSH SessionEvent that the fold inspects. */
export interface FoldEvent {
  readonly seq: number
  readonly type: string
  readonly time?: number
  readonly data?: unknown
  readonly ignorable?: boolean
}

export interface FoldCatalog {
  readonly playbooks: ReadonlyMap<string, Playbook>
  readonly knownSkills: ReadonlySet<string>
}

interface PendingCall {
  readonly name: string
  readonly args: Record<string, unknown>
}

interface PendingCommand {
  readonly name: string
  readonly args: string
}

export interface PstackFoldState {
  readonly view: PstackView
  /** Tool calls seen in `tool/call`, keyed by `callId` so `tool/result` knows their arguments. */
  readonly calls: Readonly<Record<string, PendingCall>>
  /** Slash commands seen in `command/run` awaiting `command/done`. */
  readonly commands: Readonly<Record<string, PendingCommand>>
  /** Tracks edits between failing runs of the same gate command for `attack-the-premise`. */
  readonly gateTracker: {
    readonly dirtySinceLastGate: boolean
    readonly consecutiveFailures: Readonly<Record<string, number>>
  }
}

export const INITIAL_FOLD_STATE: PstackFoldState = Object.freeze({
  view: EMPTY_PSTACK_VIEW,
  calls: {},
  commands: {},
  gateTracker: { dirtySinceLastGate: false, consecutiveFailures: {} },
})

const PRINCIPLE_NAMES = new Set(PRINCIPLE_CATALOG.map((p) => p.name))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => (isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (isRecord(raw)) return raw
  if (typeof raw !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function parseExitCode(text: string, isError: boolean): number {
  const match = /(?:exit(?:ed with)? code|status)[:\s]+(-?\d+)/i.exec(text)
  if (match !== null) return Number.parseInt(match[1] as string, 10)
  return isError ? 1 : 0
}

function addUnique(list: readonly string[], item: string): readonly string[] {
  return list.includes(item) ? list : [...list, item]
}

/** Decode a DSH `tool/result` event across both real SessionEvent (`data.message.toolCallId`) and synthetic test fixtures. */
export function decodeToolResultEvent(data: Record<string, unknown>): {
  readonly callId: string | undefined
  readonly explicitName: string | undefined
  readonly isError: boolean
  readonly errorCode: string | undefined
  readonly resultText: string
  readonly meta: Record<string, unknown> | undefined
} {
  const messageRecord = isRecord(data.message) ? data.message : undefined
  const messageSource = isRecord(messageRecord?.source) ? messageRecord.source : undefined
  const callId =
    typeof messageRecord?.toolCallId === 'string'
      ? messageRecord.toolCallId
      : typeof messageSource?.callId === 'string'
        ? messageSource.callId
        : typeof data.toolCallId === 'string'
          ? data.toolCallId
          : typeof data.callId === 'string'
            ? data.callId
            : undefined
  const explicitName =
    typeof messageSource?.name === 'string'
      ? messageSource.name
      : typeof data.name === 'string'
        ? data.name
        : undefined
  const errorObj = isRecord(data.error) ? data.error : undefined
  const errorCode = typeof errorObj?.code === 'string' ? errorObj.code : undefined
  const isError = Boolean(messageRecord?.isError) || Boolean(data.isError) || errorCode !== undefined
  const resultText = extractText(messageRecord?.content ?? data.content)
  const meta = isRecord(data.meta) ? data.meta : undefined
  return { callId, explicitName, isError, errorCode, resultText, meta }
}

/** Decode skill name from a `user/message` `source` across real DSH (`source.name`) and synthetic fixtures (`source.skill`). */
export function decodeSkillInvocationSource(source: Record<string, unknown> | undefined): string | undefined {
  if (source?.kind !== 'skill-invocation') return undefined
  if (typeof source.name === 'string' && source.name !== '') return source.name
  if (typeof source.skill === 'string' && source.skill !== '') return source.skill
  return undefined
}

function applySkillRead(view: PstackView, skillName: string, seq: number): PstackView {
  let next: PstackView = {
    ...view,
    readSkills: addUnique(view.readSkills, skillName),
  }
  if (PRINCIPLE_NAMES.has(skillName)) {
    next = {
      ...next,
      readPrinciples: addUnique(next.readPrinciples, skillName),
      flaggedPrinciples: next.flaggedPrinciples.filter((name) => name !== skillName),
    }
  }
  if (skillName === 'poteto-mode' && next.mode !== 'on') {
    next = {
      ...next,
      mode: 'on',
      moment: {
        seq,
        skill: 'poteto-mode',
        textZh: 'poteto-mode 已开启，王冠就位',
        textEn: 'poteto-mode active',
        stampZh: '就位',
        stampEn: 'ON',
        tone: 'gold',
      },
    }
  }
  if (skillName === 'figure-it-out' && next.playbook === null) {
    next = {
      ...next,
      mode: 'on',
      playbook: {
        slug: 'figure-it-out',
        title: 'figure-it-out',
        stance: 'First-principles decomposition for open-ended work.',
        steps: [],
        currentStep: 0,
        completed: false,
      },
    }
  }
  return next
}

function applyPlaybookOpen(view: PstackView, slug: string, playbook: Playbook, seq: number): PstackView {
  // Loaded steps start raw (`pending`) until `pstack_step` reports step 1 (`docs/03-ui.md` §1)
  const steps: PlaybookStepView[] = playbook.steps.map((step) => ({
    index: step.index,
    label: step.label,
    text: step.text,
    routes: step.routes,
    status: 'pending' as const,
  }))
  const forbidForcePush = slug === 'babysit' || slug === 'autopilot-stack'
  const holdPrMerge = slug === 'autopilot-stack'
  return {
    ...view,
    mode: 'on',
    playbook: {
      slug,
      title: playbook.title,
      stance: playbook.stance,
      ...(view.playbook?.goal === undefined ? {} : { goal: view.playbook.goal }),
      steps,
      currentStep: 0,
      completed: false,
    },
    guard: {
      ...view.guard,
      forbidForcePush,
      holdPrMerge,
    },
    moment: {
      seq,
      skill: 'poteto-mode',
      textZh: `认出这是 ${playbook.title}，切成 ${steps.length} 步`,
      textEn: `Loaded ${playbook.title} (${steps.length} steps)`,
      stampZh: '就位',
      stampEn: 'READY',
      tone: 'gold',
    },
  }
}

function applyCommandEffect(
  view: PstackView,
  commandName: string,
  rawArgs: string,
  seq: number,
  catalog: FoldCatalog,
): PstackView {
  const trimmed = rawArgs.trim()
  if (commandName === 'tdd') {
    const sub = trimmed.toLowerCase()
    if (sub === 'on' || sub === 'arm') {
      return {
        ...view,
        tdd: reduceTdd(view.tdd, { type: 'arm' }),
        moment: {
          seq,
          skill: 'tdd',
          textZh: '生产代码先锁上，等一次失败的测试',
          textEn: 'Production code locked until a failing test runs',
          stampZh: '等红灯',
          stampEn: 'RED?',
          tone: 'red',
        },
      }
    }
    if (sub === 'off' || sub === 'disarm') {
      return {
        ...view,
        tdd: reduceTdd(view.tdd, { type: 'disarm' }),
        moment: {
          seq,
          skill: 'tdd',
          textZh: 'TDD 门禁已关闭',
          textEn: 'TDD gate disarmed',
          stampZh: '已关闭',
          stampEn: 'OFF',
          tone: 'mute',
        },
      }
    }
  }
  if (commandName === 'playbook' && trimmed !== '') {
    const slug = resolvePlaybookSlug(trimmed)
    const pb = catalog.playbooks.get(slug)
    if (pb !== undefined) {
      return applyPlaybookOpen(view, slug, pb, seq)
    }
  }
  if (commandName === 'autopilot') {
    if (trimmed.startsWith('pause')) {
      const prev = view.autopilot ?? { active: false, replacements: [], stack: [] }
      return {
        ...view,
        autopilot: { ...prev, active: false, checkpointSaved: true },
      }
    }
    if (trimmed === 'resume') {
      const prev = view.autopilot ?? { active: false, replacements: [], stack: [] }
      return {
        ...view,
        autopilot: { ...prev, active: true },
      }
    }
  }
  return view
}

function recomputeMissingEvidence(rows: readonly LedgerEntryView[]): readonly number[] {
  const missingSet = new Set(rowsWithoutEvidence(rows))
  const indices: number[] = []
  rows.forEach((row, idx) => {
    if (missingSet.has(row)) indices.push(idx + 1)
  })
  return indices
}

function isHumanMessageSource(source: Record<string, unknown> | undefined): boolean {
  if (source === undefined) return true
  const kind = source.kind
  return kind === 'user' || kind === 'human' || kind === 'prompt' || kind === 'client'
}

function resolveOneKetchupReply(view: PstackView, trimmed: string): PstackView {
  if (view.pendingKetchupCount <= 0 || trimmed === '') return view
  const tagged = /^\[ketchup:([^\]]+)\]\s*(.*)$/i.exec(trimmed)
  let resolvedOne = false

  const updated = view.ketchup.map((item) => {
    if (resolvedOne || item.decided !== undefined) return item
    if (tagged !== null) {
      if (item.id !== tagged[1]) return item
      const answer = (tagged[2] ?? '').trim()
      const opt = item.options.find(
        (o) => o.label.trim().toLowerCase() === answer.toLowerCase() || o.prompt.trim() === answer,
      )
      resolvedOne = true
      return { ...item, decided: opt?.label ?? (answer || item.options[0]?.label || 'OK') }
    }
    const exactOption = item.options.find(
      (opt) => opt.prompt.trim() === trimmed || opt.label.trim().toLowerCase() === trimmed.toLowerCase(),
    )
    if (exactOption !== undefined) {
      resolvedOne = true
      return { ...item, decided: exactOption.label }
    }
    return item
  })

  if (!resolvedOne) return view
  const pending = updated.filter((item) => item.decided === undefined).length
  return { ...view, ketchup: updated, pendingKetchupCount: pending }
}

/**
 * Pure transition over one DSH session event. Returns the exact same state
 * reference (`Object.is`) whenever an event leaves pstack's state unchanged.
 */
export function reducePstackState(
  state: PstackFoldState,
  event: FoldEvent,
  catalog: FoldCatalog,
): PstackFoldState {
  const data = isRecord(event.data) ? event.data : undefined

  if (event.type === 'plugin:pstack/event') {
    if (data === undefined || typeof data.pstackKind !== 'string') return state
    const view = applyPstackMeta(state.view, data, event.seq, catalog)
    return view === state.view ? state : { ...state, view }
  }

  switch (event.type) {
    case 'user/message': {
      if (data === undefined) return state
      const text = extractText(data.content)
      const source = isRecord(data.source) ? data.source : undefined
      let view = state.view
      let changed = false

      const invokedSkill = decodeSkillInvocationSource(source)
      if (invokedSkill !== undefined) {
        view = applySkillRead(view, invokedSkill, event.seq)
        changed = view !== state.view
      } else if (/(?:^|\s)\/poteto-mode\b/.test(text) && view.mode !== 'on') {
        view = applySkillRead(view, 'poteto-mode', event.seq)
        changed = true
      }

      if (isHumanMessageSource(source) && view.pendingKetchupCount > 0 && text.trim() !== '') {
        const afterKetchup = resolveOneKetchupReply(view, text.trim())
        if (afterKetchup !== view) {
          view = afterKetchup
          changed = true
        }
      }

      return changed ? { ...state, view } : state
    }

    case 'command/run': {
      if (data === undefined || typeof data.name !== 'string') return state
      const rawArgs =
        typeof data.args === 'string'
          ? data.args
          : typeof data.rawInput === 'string'
            ? data.rawInput
            : ''
      // Real DSH pairs `command/run` with `command/done` by `commandId`; synthetic unit fixtures omit `commandId`.
      if (typeof data.commandId === 'string' && data.commandId !== '') {
        return {
          ...state,
          commands: { ...state.commands, [data.commandId]: { name: data.name, args: rawArgs } },
        }
      }
      const nextView = applyCommandEffect(state.view, data.name, rawArgs, event.seq, catalog)
      return nextView === state.view ? state : { ...state, view: nextView }
    }

    case 'command/done': {
      if (data === undefined || typeof data.commandId !== 'string') return state
      const pending = state.commands[data.commandId]
      if (pending === undefined) return state
      const restCommands = Object.fromEntries(
        Object.entries(state.commands).filter(([id]) => id !== data.commandId),
      )
      if (data.kind !== 'success') {
        return { ...state, commands: restCommands }
      }
      const nextView = applyCommandEffect(state.view, pending.name, pending.args, event.seq, catalog)
      return { ...state, view: nextView, commands: restCommands }
    }

    case 'approval/asked': {
      const reasonText =
        data !== undefined
          ? `${typeof data.reason === 'string' ? data.reason : ''} ${JSON.stringify(data.displayReason ?? '')}`
          : ''
      if (!reasonText.includes('pstack') && !reasonText.includes('🥔')) return state
      return {
        ...state,
        view: {
          ...state.view,
          guard: {
            ...state.view.guard,
            asks: state.view.guard.asks + 1,
            pendingApprovals: (state.view.guard.pendingApprovals ?? 0) + 1,
          },
        },
      }
    }

    case 'approval/decided': {
      const currentPending = state.view.guard.pendingApprovals ?? 0
      if (currentPending <= 0) return state
      return {
        ...state,
        view: {
          ...state.view,
          guard: {
            ...state.view.guard,
            pendingApprovals: Math.max(0, currentPending - 1),
          },
        },
      }
    }

    case 'tool/call': {
      if (data === undefined || typeof data.callId !== 'string' || typeof data.name !== 'string') return state
      const args = parseJsonObject(data.arguments)
      return {
        ...state,
        calls: { ...state.calls, [data.callId]: { name: data.name, args } },
      }
    }

    case 'tool/result': {
      if (data === undefined) return state
      const { callId, explicitName, isError, errorCode, resultText, meta } = decodeToolResultEvent(data)
      const pending = callId === undefined ? undefined : state.calls[callId]
      const restCalls = callId !== undefined && callId in state.calls
        ? Object.fromEntries(Object.entries(state.calls).filter(([id]) => id !== callId))
        : state.calls

      const toolName = pending?.name ?? explicitName ?? ''
      const args = pending?.args ?? {}

      let view = state.view
      let gateTracker = state.gateTracker

      // 1. Guard denials & approvals
      if (errorCode?.startsWith('PSTACK_') === true) {
        if (errorCode === 'PSTACK_TDD_RED_PENDING') {
          view = {
            ...view,
            moment: {
              seq: event.seq,
              skill: 'tdd',
              textZh: '还没见到失败的测试，已拦下对生产代码的写入',
              textEn: 'Blocked production write before failing test',
              stampZh: '拦下',
              stampEn: 'STOP',
              tone: 'red',
            },
          }
        } else if (errorCode === 'PSTACK_BENCH_FROZEN') {
          view = {
            ...view,
            moment: {
              seq: event.seq,
              skill: 'hillclimb',
              textZh: '基准已冻结，禁止修改测量脚本',
              textEn: 'Blocked edit to frozen benchmark file',
              stampZh: '拦下',
              stampEn: 'FROZEN',
              tone: 'red',
            },
          }
        } else {
          const cmd = typeof args.command === 'string' ? args.command : ''
          const waitingMerge = errorCode === 'PSTACK_AUTOPILOT_MERGE_HOLD'
          view = {
            ...view,
            guard: {
              ...view.guard,
              blocks: view.guard.blocks + 1,
              ...(cmd === '' ? {} : { lastBlockedCommand: cmd }),
            },
            ...(waitingMerge && view.autopilot
              ? { autopilot: { ...view.autopilot, waitingApproval: true } }
              : {}),
            moment: {
              seq: event.seq,
              skill: 'guard',
              textZh: cmd ? `已拦下 ${cmd}` : '已拦下违规命令',
              textEn: cmd ? `Blocked ${cmd}` : 'Blocked command',
              stampZh: '拦下',
              stampEn: 'DENY',
              tone: 'red',
            },
          }
        }
        return { ...state, view, calls: restCalls, gateTracker }
      }

      if (errorCode?.startsWith('APPROVAL_') === true) {
        view = {
          ...view,
          guard: { ...view.guard, asks: view.guard.asks + 1 },
        }
      }

      // 2. Skill loads (`skill` tool or `read` on SKILL.md / playbooks/*.md)
      if (!isError && toolName === 'skill') {
        const loadedName = typeof args.name === 'string' ? args.name : ''
        if (loadedName !== '') view = applySkillRead(view, loadedName, event.seq)
      }
      if (!isError && toolName === 'read') {
        const filePath =
          typeof args.file_path === 'string'
            ? args.file_path
            : typeof args.path === 'string'
              ? args.path
              : ''
        const skillFromRead = skillNameFromPath(filePath)
        if (skillFromRead !== undefined) view = applySkillRead(view, skillFromRead, event.seq)
        const pbSlug = playbookSlugFromPath(filePath)
        if (pbSlug !== undefined) {
          const pb = catalog.playbooks.get(pbSlug) ?? parsePlaybook(resultText, catalog.knownSkills)
          if (pb !== undefined) view = applyPlaybookOpen(view, pbSlug, pb, event.seq)
        }
      }

      // 3. File mutations mark gateTracker dirty for attack-the-premise
      if (!isError && (toolName === 'write' || toolName === 'edit' || toolName === 'apply_patch')) {
        gateTracker = { ...gateTracker, dirtySinceLastGate: true }
      }

      // 4. Foreground shell runs: TDD test-run transitions + attack-the-premise tracker
      const cancelledOrBackground =
        args.run_in_background === true ||
        errorCode === 'TOOL_CANCELLED' ||
        errorCode === 'TOOL_ABORTED' ||
        errorCode?.startsWith('APPROVAL_') === true
      if (!cancelledOrBackground && (toolName === 'bash' || toolName === 'pwsh')) {
        const command = typeof args.command === 'string' ? args.command.trim() : ''
        if (command !== '' && isTestCommand(command)) {
          const exitCode = parseExitCode(resultText, isError)
          const at = event.time !== undefined ? new Date(event.time).toISOString() : ''
          const prevPhase = view.tdd.phase
          const nextTdd = reduceTdd(view.tdd, { type: 'test-run', run: { command, exitCode, at } })
          if (nextTdd !== view.tdd) {
            view = {
              ...view,
              tdd: nextTdd,
              moment:
                prevPhase === 'red-pending' && nextTdd.phase === 'red-observed'
                  ? {
                      seq: event.seq,
                      skill: 'tdd',
                      textZh: '测试失败了，可以改生产代码了',
                      textEn: 'Failing test observed; production code unlocked',
                      stampZh: '红灯已见',
                      stampEn: 'RED',
                      tone: 'red',
                    }
                  : nextTdd.phase === 'green' && prevPhase !== 'green'
                    ? {
                        seq: event.seq,
                        skill: 'tdd',
                        textZh: '测试命令现在通过',
                        textEn: 'Regression test is now green',
                        stampZh: '已转绿',
                        stampEn: 'GREEN',
                        tone: 'green',
                      }
                    : view.moment,
            }
          }
          // Attack-the-premise: two distinct edits fail the same gate command
          if (exitCode !== 0 && gateTracker.dirtySinceLastGate) {
            const count = (gateTracker.consecutiveFailures[command] ?? 0) + 1
            gateTracker = {
              dirtySinceLastGate: false,
              consecutiveFailures: { ...gateTracker.consecutiveFailures, [command]: count },
            }
            if (count >= 2) {
              view = {
                ...view,
                premiseWarning: { command, count },
                moment: {
                  seq: event.seq,
                  skill: 'attack-the-premise',
                  textZh: '两个修法败在同一关，先检验共同前提',
                  textEn: 'Two fixes failed the same gate; test the shared premise first',
                  stampZh: '停一下',
                  stampEn: 'HOLD',
                  tone: 'gold',
                },
              }
            }
          } else if (exitCode === 0) {
            const nextFailures = { ...gateTracker.consecutiveFailures }
            delete nextFailures[command]
            gateTracker = { dirtySinceLastGate: false, consecutiveFailures: nextFailures }
            if (view.premiseWarning?.command === command) {
              view = { ...view, premiseWarning: null }
            }
          }
        }
      }

      // 5. Rich `pstack_*` tool presentation metadata
      if (!isError && meta !== undefined && typeof meta.pstackKind === 'string') {
        view = applyPstackMeta(view, meta, event.seq, catalog)
      }

      if (view === state.view && restCalls === state.calls && gateTracker === state.gateTracker) return state
      return { ...state, view, calls: restCalls, gateTracker }
    }

    case 'assistant/message': {
      if (data === undefined) return state
      const message = isRecord(data.message) ? data.message : data
      const text = extractText(message.content)
      if (text === '') return state
      const unread = unreadCitations(text, PRINCIPLE_CATALOG, new Set(state.view.readPrinciples))
      if (unread.length === 0) return state
      const added = unread.map((p) => p.name).filter((name) => !state.view.flaggedPrinciples.includes(name))
      if (added.length === 0) return state
      const firstTitle = unread[0]?.title ?? added[0] ?? 'principle'
      return {
        ...state,
        view: {
          ...state.view,
          flaggedPrinciples: [...state.view.flaggedPrinciples, ...added],
          moment: {
            seq: event.seq,
            skill: 'poteto-mode',
            textZh: `回复里提到 ${firstTitle}，但没读过它`,
            textEn: `Cited ${firstTitle} without reading its SKILL.md`,
            stampZh: '先去读',
            stampEn: 'READ',
            tone: 'red',
          },
        },
      }
    }

    default:
      return state
  }
}

export function applyPstackMeta(
  view: PstackView,
  meta: Record<string, unknown>,
  seq: number,
  catalog: FoldCatalog,
): PstackView {
  switch (meta.pstackKind) {
    case 'step': {
      let current = view
      if (typeof meta.playbookSlug === 'string' && (current.playbook === null || current.playbook.slug !== meta.playbookSlug)) {
        const pb = catalog.playbooks.get(meta.playbookSlug)
        if (pb !== undefined) current = applyPlaybookOpen(current, meta.playbookSlug, pb, seq)
      }
      const pbView = current.playbook ?? {
        slug: 'figure-it-out',
        title: 'figure-it-out',
        stance: 'You own this task. Plan, review, verify.',
        steps: [],
        currentStep: 1,
        completed: false,
      }
      const goal = typeof meta.goal === 'string' && meta.goal.trim() !== '' ? meta.goal.trim() : pbView.goal
      const stepIndex = typeof meta.step === 'number' ? meta.step : Math.max(1, pbView.currentStep)
      const status: 'completed' | 'in_progress' = meta.status === 'completed' ? 'completed' : 'in_progress'

      const updatedSteps = pbView.steps.map((s) => {
        if (s.index < stepIndex) return { ...s, status: 'completed' as const }
        if (s.index === stepIndex) return { ...s, status }
        if (status === 'completed' && s.index === stepIndex + 1) return { ...s, status: 'in_progress' as const }
        return s
      })
      const allDone = updatedSteps.length > 0 && updatedSteps.every((s) => s.status === 'completed')
      const nextCurrent = allDone
        ? updatedSteps.length
        : status === 'completed'
          ? Math.min(Math.max(1, updatedSteps.length), stepIndex + 1)
          : stepIndex

      const activeStepObj = updatedSteps.find((s) => s.index === nextCurrent)
      const shouldArmTdd =
        meta.autoArmTdd === true &&
        activeStepObj?.routes.includes('tdd') === true &&
        current.tdd.phase === 'off'

      return {
        ...current,
        mode: 'on',
        tdd: shouldArmTdd ? reduceTdd(current.tdd, { type: 'arm' }) : current.tdd,
        playbook: {
          ...pbView,
          ...(goal === undefined ? {} : { goal }),
          steps: updatedSteps,
          currentStep: nextCurrent,
          completed: allDone,
        },
        moment: {
          seq,
          skill: 'poteto-mode',
          textZh: allDone ? `${pbView.steps.length} 步全部做完了` : `进入第 ${nextCurrent} 步`,
          textEn: allDone ? 'All playbook steps complete' : `Now on step ${nextCurrent}`,
          stampZh: allDone ? '做完了' : '推进',
          stampEn: allDone ? 'DONE' : 'STEP',
          tone: 'gold',
          said: true,
        },
      }
    }

    case 'tdd': {
      const action = meta.action === 'arm' || meta.action === 'on' ? 'arm' : 'disarm'
      return {
        ...view,
        tdd: reduceTdd(view.tdd, { type: action }),
        moment: {
          seq,
          skill: 'tdd',
          textZh: action === 'arm' ? '生产代码先锁上，等一次失败的测试' : 'TDD 门禁已关闭',
          textEn: action === 'arm' ? 'TDD gate armed' : 'TDD gate disarmed',
          stampZh: action === 'arm' ? '等红灯' : '已关闭',
          stampEn: action === 'arm' ? 'RED?' : 'OFF',
          tone: action === 'arm' ? 'red' : 'mute',
        },
      }
    }

    case 'ketchup-decide': {
      if (typeof meta.itemId !== 'string' || typeof meta.label !== 'string') return view
      let changed = false
      const updated = view.ketchup.map((item) => {
        if (item.id !== meta.itemId || item.decided !== undefined) return item
        changed = true
        return { ...item, decided: meta.label as string }
      })
      if (!changed) return view
      const pending = updated.filter((item) => item.decided === undefined).length
      return { ...view, ketchup: updated, pendingKetchupCount: pending }
    }

    case 'log': {
      const row = meta.row as DecisionRow | undefined
      if (!isRecord(row)) return view
      const entry: LedgerEntryView = {
        ts: String(row.ts ?? ''),
        phase: String(row.phase ?? ''),
        decision: String(row.decision ?? ''),
        why: String(row.why ?? ''),
        evidence: String(row.evidence ?? ''),
        result: String(row.result ?? ''),
        ...(row.phase === 'start' && view.ledger.rows.length > 0 ? { runStart: true } : {}),
      }
      const rows = [...view.ledger.rows, entry]
      const missing = recomputeMissingEvidence(rows)
      const lacksEvidence = entry.phase !== 'start' && entry.evidence.trim() === ''
      return {
        ...view,
        ledger: { ...view.ledger, rows, missingEvidenceIndices: missing },
        moment: {
          seq,
          skill: 'show-me-your-work',
          textZh: lacksEvidence ? '新记录缺少证据引用' : '决策记录多了一行',
          textEn: lacksEvidence ? 'Decision row lacks evidence' : 'Decision logged',
          stampZh: lacksEvidence ? '缺' : '已记',
          stampEn: lacksEvidence ? 'LACKS' : 'LOG',
          tone: lacksEvidence ? 'red' : 'green',
        },
      }
    }

    case 'ledger-review': {
      if (typeof meta.reviewerVendor !== 'string' || typeof meta.reviewerModel !== 'string') return view
      return {
        ...view,
        ledger: {
          ...view.ledger,
          attention: {
            reviewerVendor: meta.reviewerVendor,
            reviewerModel: meta.reviewerModel,
            note: String(meta.note ?? ''),
          },
        },
      }
    }

    case 'arena': {
      const candidates = Array.isArray(meta.candidates) ? (meta.candidates as ArenaCandidate[]) : []
      const criteria = Array.isArray(meta.criteria) ? (meta.criteria as ArenaCriterionScore[]) : []
      const shape = (meta.shape === 'converged' || meta.shape === 'diverged' ? meta.shape : 'normal') as ArenaShapeSignal
      const judgeBase = typeof meta.recommendedBase === 'string' ? meta.recommendedBase : undefined
      const parentBase = typeof meta.parentChosenBase === 'string' ? meta.parentChosenBase : undefined
      const evalResult = evaluateArenaMatrix(candidates, criteria, judgeBase, shape, parentBase)
      const judge = isRecord(meta.judge) ? (meta.judge as ArenaView['judge']) : undefined
      const arena: ArenaView = {
        ...(typeof meta.runId === 'string' ? { runId: meta.runId } : {}),
        task: String(meta.task ?? ''),
        phase: (typeof meta.phase === 'string' ? meta.phase : shape === 'diverged' ? 'define' : 'pick') as ArenaPhase,
        candidates,
        criteria,
        totals: evalResult.totals,
        ...(evalResult.recommendedBase === undefined ? {} : { recommendedBase: evalResult.recommendedBase }),
        ...(evalResult.parentChosenBase === undefined ? {} : { parentChosenBase: evalResult.parentChosenBase }),
        baseDisagreement: evalResult.baseDisagreement,
        shape,
        ...(judge === undefined ? {} : { judge }),
        queuedCount: typeof meta.queuedCount === 'number' ? meta.queuedCount : 0,
      }
      const crossPicked = judge?.status === 'picked'
      const judgeScored = judge?.scored !== false && Object.values(evalResult.totals).some((v) => typeof v === 'number')
      return {
        ...view,
        arena,
        moment: {
          seq,
          skill: 'arena',
          textZh: crossPicked
            ? judgeScored
              ? `裁判来自 ${judge?.vendor ?? '异构厂商'}，已完成评分`
              : `已挑出异构裁判 ${judge?.vendor ?? ''}`
            : 'Arena 编排已完成',
          textEn: crossPicked
            ? judgeScored
              ? `Cross-vendor judge (${judge?.vendor ?? 'external'}) scored candidates`
              : `Selected cross-vendor judge (${judge?.vendor ?? 'external'})`
            : 'Arena run finished',
          stampZh: crossPicked ? '跨厂商' : shape === 'converged' ? '收敛' : '交卷',
          stampEn: crossPicked ? 'JUDGE' : 'DONE',
          tone: crossPicked ? 'purple' : 'gold',
          ...(shape === 'converged' ? { said: true } : {}),
        },
      }
    }

    case 'arena-adopt': {
      if (view.arena === null || typeof meta.candidateId !== 'string' || meta.adopted === false) return view
      if (typeof meta.runId === 'string' && view.arena.runId !== undefined && meta.runId !== view.arena.runId) {
        return view
      }
      const evalResult = evaluateArenaMatrix(
        view.arena.candidates,
        view.arena.criteria,
        view.arena.recommendedBase,
        view.arena.shape,
        meta.candidateId,
      )
      return {
        ...view,
        arena: {
          ...view.arena,
          phase: 'graft',
          parentChosenBase: meta.candidateId,
          baseDisagreement: evalResult.baseDisagreement,
        },
      }
    }

    case 'interrogate': {
      const verified = Array.isArray(meta.verified) ? (meta.verified as VerifiedFinding[]) : []
      const droppedCount = typeof meta.droppedCount === 'number' ? meta.droppedCount : 0
      const discards = Array.isArray(meta.discards) ? (meta.discards as ReviewerDiscardSummary[]) : []
      return {
        ...view,
        interrogate: {
          task: String(meta.task ?? ''),
          verified,
          droppedCount,
          discards,
          queuedCount: typeof meta.queuedCount === 'number' ? meta.queuedCount : 0,
        },
        moment: {
          seq,
          skill: 'interrogate',
          textZh: verified.length > 0 ? `${verified.length} 条复跑成立，${droppedCount} 条丢弃` : `0 条成立，${droppedCount} 条丢弃`,
          textEn: `${verified.length} verified, ${droppedCount} discarded`,
          stampZh: verified.length > 0 ? '成立' : '丢弃',
          stampEn: verified.length > 0 ? 'PROVEN' : 'CLEAN',
          tone: verified.length > 0 ? 'red' : 'mute',
        },
      }
    }

    case 'swarm': {
      const slices = Array.isArray(meta.slices) ? (meta.slices as SwarmSliceView[]) : []
      const gaps = slices.filter((s) => s.outcome === 'gap').length
      const blocked = slices.filter((s) => s.outcome === 'BLOCKED').length
      const issues = slices.filter((s) => s.outcome === 'ISSUES').length
      const retried = slices.filter((s) => s.outcome === 'redispatched' || (s.retries ?? 0) > 0).length
      const stampInfo: { zh: string; en: string; tone: StampTone; said?: boolean } =
        gaps > 0
          ? { zh: '缺口', en: 'GAP', tone: 'red' }
          : blocked > 0
            ? { zh: '受阻', en: 'BLOCKED', tone: 'red', said: true }
            : issues > 0
              ? { zh: '有问题', en: 'ISSUES', tone: 'gold', said: true }
              : retried > 0
                ? { zh: '重派', en: 'RETRY', tone: 'purple' }
                : { zh: 'PASS' as SwarmStatus, en: 'PASS', tone: 'green', said: true }
      return {
        ...view,
        swarm: { task: String(meta.task ?? ''), slices },
        moment: {
          seq,
          skill: 'swarm',
          textZh:
            gaps > 0
              ? `${gaps} 个切片缺证据，记为缺口`
              : retried > 0
                ? `${retried} 个切片经重派后补齐证据`
                : `${slices.length} 个切片已回报`,
          textEn:
            gaps > 0
              ? `${gaps} slice gap(s)`
              : retried > 0
                ? `${retried} slice(s) retried and settled`
                : `${slices.length} slice(s) reported`,
          stampZh: stampInfo.zh,
          stampEn: stampInfo.en,
          tone: stampInfo.tone,
          ...(stampInfo.said ? { said: true } : {}),
        },
      }
    }

    case 'bench-freeze': {
      const direction: Direction = meta.direction === 'higher' ? 'higher' : 'lower'
      const baseline = Number(meta.baseline ?? 0)
      const targetRelativeGain = Number(meta.targetRelativeGain ?? 0.2)
      const targetValue = computeTargetValue(baseline, direction, targetRelativeGain)
      return {
        ...view,
        bench: {
          metricName: String(meta.metricName ?? 'Benchmark'),
          direction,
          minSamples: Number(meta.minSamples ?? 5),
          baseline,
          targetValue: Math.round(targetValue * 100) / 100,
          targetRelativeGain,
          minAttempts: Number(meta.minAttempts ?? 5),
          frozen: true,
          driftedFiles: [],
          ...(typeof meta.gateCommand === 'string' ? { gateCommand: meta.gateCommand } : {}),
          ...(isRecord(meta.checklist) ? { checklist: meta.checklist as unknown as BenchChecklistView } : {}),
          attempts: [],
          plateau: false,
          met: false,
        },
        moment: {
          seq,
          skill: 'hillclimb',
          textZh: `基线 ${baseline} 已采样并冻结`,
          textEn: `Baseline ${baseline} frozen`,
          stampZh: '已冻结',
          stampEn: 'FROZEN',
          tone: 'mute',
        },
      }
    }

    case 'bench-attempt': {
      if (view.bench === null) return view
      if (Array.isArray(meta.driftedFiles) && meta.driftedFiles.length > 0) {
        return {
          ...view,
          bench: {
            ...view.bench,
            frozen: false,
            met: false,
            driftedFiles: meta.driftedFiles as string[],
          },
          moment: {
            seq,
            skill: 'hillclimb',
            textZh: '冻结后的测量脚本哈希变了，这一轮作废',
            textEn: 'Frozen benchmark file hash changed; attempt voided',
            stampZh: '作废',
            stampEn: 'DRIFT',
            tone: 'red',
          },
        }
      }
      const attempt = meta.attempt as BenchAttemptView | undefined
      if (!isRecord(attempt)) return view
      const attempts = [...view.bench.attempts, attempt]
      const currentBest = attempts.reduce(
        (val, item) => (item.kept ? item.after : val),
        view.bench.baseline,
      )
      const last3 = attempts.slice(-3)
      const plateau = last3.length === 3 && last3.every((a) => !a.kept)
      const met =
        view.bench.driftedFiles.length === 0 &&
        predicateMet(view.bench.baseline, currentBest, view.bench.direction, attempts.length, {
          targetRelativeGain: view.bench.targetRelativeGain,
          minAttempts: view.bench.minAttempts,
        })
      return {
        ...view,
        bench: { ...view.bench, attempts, plateau, met },
        moment: {
          seq,
          skill: 'hillclimb',
          textZh: met
            ? '目标和最少尝试次数都满足了'
            : attempt.kept
              ? '增益超过噪声，门禁为绿，已保留提交'
              : `已回滚：${attempt.revertReason ?? '未达标'}`,
          textEn: met ? 'Target and attempt floor met' : attempt.kept ? 'Gain past noise; kept' : `Reverted (${attempt.revertReason ?? 'noise'})`,
          stampZh: met ? '达标' : attempt.kept ? '保留' : '回滚',
          stampEn: met ? 'MET' : attempt.kept ? 'KEPT' : 'REVERT',
          tone: met || attempt.kept ? 'gold' : attempt.revertReason === 'work-changed' ? 'red' : 'mute',
        },
      }
    }

    case 'sicko': {
      const report = meta.report as SickoReport | undefined
      if (!isRecord(report)) return view
      return {
        ...view,
        sicko: report,
        moment: {
          seq,
          skill: 'comment-sicko',
          textZh: 'Yes... Ha ha ha... Yes!',
          textEn: 'Yes... Ha ha ha... Yes!',
          stampZh: `删 ${report.deleted}`,
          stampEn: `KILL ${report.mustKill.length}`,
          tone: report.mustKill.length > 0 ? 'red' : 'green',
          said: true,
        },
      }
    }

    case 'ketchup': {
      const items = Array.isArray(meta.items)
        ? (meta.items.filter((x): x is KetchupItemView => isRecord(x) && typeof x.question === 'string') as KetchupItemView[])
        : []
      if (items.length === 0) return view
      const existingIds = new Set(view.ketchup.map((i) => i.id))
      const fresh = items.filter((i) => !existingIds.has(i.id))
      const merged = [...view.ketchup, ...fresh]
      const pending = merged.filter((item) => item.decided === undefined).length
      return {
        ...view,
        ketchup: merged,
        pendingKetchupCount: pending,
        moment: {
          seq,
          skill: 'ketchup',
          textZh: `有 ${pending} 件事要你拍板`,
          textEn: `${pending} decision(s) waiting for you`,
          stampZh: '等你',
          stampEn: 'WAIT',
          tone: 'red',
          said: true,
        },
      }
    }

    case 'autopilot': {
      const prev = view.autopilot ?? { active: false, replacements: [], stack: [] }
      const addedReplacements = Array.isArray(meta.replacements)
        ? (meta.replacements.filter(isRecord) as unknown as AutopilotView['replacements'])
        : isRecord(meta.replacement)
          ? [meta.replacement as unknown as AutopilotView['replacements'][number]]
          : []
      const next: AutopilotView = {
        ...prev,
        ...(typeof meta.mode === 'string' ? { mode: meta.mode as 'drive' | 'threads-only' | 'check' } : {}),
        active: typeof meta.active === 'boolean' ? meta.active : prev.active,
        ...(typeof meta.scheduleId === 'string' ? { scheduleId: meta.scheduleId } : {}),
        ...(typeof meta.goalId === 'string' ? { goalId: meta.goalId } : {}),
        ...(typeof meta.waitingApproval === 'boolean' ? { waitingApproval: meta.waitingApproval } : {}),
        ...(typeof meta.checkpointSaved === 'boolean' ? { checkpointSaved: meta.checkpointSaved } : {}),
        ...(typeof meta.resumeHint === 'string' ? { resumeHint: meta.resumeHint } : {}),
        replacements: addedReplacements.length > 0 ? [...prev.replacements, ...addedReplacements] : prev.replacements,
        stack: Array.isArray(meta.stack) ? (meta.stack as PrStackItem[]) : prev.stack,
      }
      return {
        ...view,
        autopilot: next,
        moment:
          addedReplacements.length > 0
            ? {
                seq,
                skill: 'autopilot',
                textZh: `卡住的子代理已替换为新实例（${addedReplacements.length}）`,
                textEn: `Replaced ${addedReplacements.length} stalled worker subagent(s)`,
                stampZh: '已替换',
                stampEn: 'SWAP',
                tone: 'purple',
              }
            : view.moment,
      }
    }

    default:
      return view
  }
}
