/**
 * In-chat tool cards (`tool.call.toolview`), Composer Dock (`conversation.input.dock`),
 * Composer Left Badge (`conversation.input.left`), Hero Playbook Picker (`conversation.hero.options`),
 * and Session Row Trailing/Hover (`sidebar.session.row.trailing` & `sidebar.session.row.hover`).
 */

import * as React from 'react'
import { HERO_FEATURED_PLAYBOOKS } from '../../src/core/catalog.ts'
import type { ArenaCandidate, SickoReport } from '../../src/core/panel-rules.ts'
import { EMPTY_PSTACK_VIEW } from '../../src/core/projection.ts'
import type {
  BenchAttemptView,
  KetchupItemView,
  KetchupOptionView,
  MomentEvent,
  PstackSummaryView,
  PstackView,
} from '../../src/core/projection.ts'
import { fallbackT, isChineseLocale } from './i18n.ts'
import {
  Fries,
  Potato,
  Stamp,
  applyComposerDraft,
  hasActivePstackSignal,
  readPstackView,
  selectRightPaneSubtab,
  usePreviewPlaybook,
} from './primitives.tsx'
import type { DshInputActions, RightPaneSubtab } from './primitives.tsx'

export function formatSignedPct(before: number, after: number): string | null {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) return null
  const pct = Math.round(((after - before) / Math.abs(before)) * 100)
  return pct > 0 ? `+${pct}%` : pct < 0 ? `−${Math.abs(pct)}%` : '0%'
}

function readPartialArgs(rawArgs: unknown): Record<string, unknown> {
  if (typeof rawArgs === 'string') {
    try {
      const parsed = JSON.parse(rawArgs) as unknown
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  if (typeof rawArgs !== 'object' || rawArgs === null || Array.isArray(rawArgs)) return {}
  const maybePartial = rawArgs as {
    keys?: () => readonly string[]
    text?: (key: string) => string | undefined
    value?: (key: string) => unknown
  }
  if (
    typeof maybePartial.keys === 'function' &&
    typeof maybePartial.text === 'function' &&
    typeof maybePartial.value === 'function'
  ) {
    const out: Record<string, unknown> = {}
    for (const k of maybePartial.keys()) {
      const val = maybePartial.value(k)
      out[k] = val !== undefined ? val : maybePartial.text(k)
    }
    return out
  }
  return rawArgs as Record<string, unknown>
}

function parseToolMeta(props: Record<string, unknown>): {
  phase: 'preparing' | 'start' | 'result'
  args: Record<string, unknown>
  meta: Record<string, unknown> | undefined
  isError: boolean
  errorText: string
  text: string
} {
  const rawPhase = typeof props.phase === 'string' ? props.phase : 'result'
  const phase: 'preparing' | 'start' | 'result' =
    rawPhase === 'preparing' || rawPhase === 'start' ? rawPhase : 'result'
  const block = (typeof props.block === 'object' && props.block !== null ? props.block : {}) as Record<string, unknown>
  const args = readPartialArgs(block.args ?? block.arguments ?? props.arguments)
  const result = (typeof block.result === 'object' && block.result !== null ? block.result : block) as Record<string, unknown>
  const meta =
    typeof result.meta === 'object' && result.meta !== null && !Array.isArray(result.meta)
      ? (result.meta as Record<string, unknown>)
      : typeof block.meta === 'object' && block.meta !== null && !Array.isArray(block.meta)
        ? (block.meta as Record<string, unknown>)
        : undefined
  const errObj =
    typeof result.error === 'object' && result.error !== null
      ? (result.error as Record<string, unknown>)
      : typeof block.error === 'object' && block.error !== null
        ? (block.error as Record<string, unknown>)
        : undefined
  const isError = Boolean(result.isError) || Boolean(block.isError) || errObj !== undefined
  const content = result.content ?? block.content
  const text = Array.isArray(content)
    ? content
        .map((c) =>
          typeof c === 'object' && c !== null && typeof (c as { text?: unknown }).text === 'string'
            ? (c as { text: string }).text
            : '',
        )
        .filter(Boolean)
        .join('\n')
    : ''
  const errorText =
    typeof errObj?.message === 'string'
      ? errObj.message
      : typeof result.error === 'string'
        ? result.error
        : typeof block.error === 'string'
          ? block.error
          : text
  return { phase, args, meta, isError, errorText, text }
}

function ToolErrorSummary({ errorText, zh }: { readonly errorText: string; readonly zh: boolean }): React.JSX.Element {
  return (
    <p style={{ margin: 0, color: 'var(--p-ketchup)', fontSize: 12.5 }}>
      {errorText.trim() !== ''
        ? errorText
        : zh
          ? '工具调用未完成（已取消或报错）。'
          : 'Tool execution failed or was cancelled.'}
    </p>
  )
}

const ARENA_STAGE_LABELS_ZH = ['定题', '扇出', '交叉评审', '选底', '嫁接', '验证'] as const
const ARENA_STAGE_LABELS_EN = ['Frame', 'Fan-out', 'Judge', 'Pick', 'Graft', 'Verify'] as const

export function ArenaToolCard(
  props: Record<string, unknown> & { readonly openRightTab: (sub: RightPaneSubtab) => void },
): React.JSX.Element {
  const { phase, args, meta, isError, errorText } = parseToolMeta(props)
  const zh = isChineseLocale()
  const task = String(meta?.task ?? args.task ?? '')
  const candidates = Array.isArray(meta?.candidates)
    ? (meta.candidates.filter((c) => typeof c === 'object' && c !== null) as ArenaCandidate[])
    : []
  const recommendedBase = typeof meta?.recommendedBase === 'string' ? meta.recommendedBase : undefined
  const shape = typeof meta?.shape === 'string' ? meta.shape : undefined
  const [expanded, setExpanded] = React.useState(false)

  if (phase === 'result' && isError) {
    return (
      <section className="pstack-card error">
        <div className="pstack-card-head">
          <h3>Arena</h3>
          <span className="pstack-card-task">{task}</span>
          <Stamp text={zh ? '失败' : 'ERROR'} tone="red" />
        </div>
        <ToolErrorSummary errorText={errorText} zh={zh} />
      </section>
    )
  }

  // Settled Arena card collapses to a clean summary row with optional detail expansion (`docs/03-ui.md` §3)
  if (phase === 'result' && !expanded && candidates.length > 0) {
    const submitted = candidates.filter((c) => c.status === 'submitted').length
    return (
      <section className="pstack-card" style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <b style={{ fontFamily: 'var(--p-display)' }}>Arena</b>
          <span className="pstack-card-task">{task}</span>
          <Stamp
            text={
              recommendedBase
                ? `${zh ? '推荐底' : 'BASE'} ${recommendedBase}`
                : `${submitted}/${candidates.length} ${zh ? '交卷' : 'DONE'}`
            }
            tone={shape === 'diverged' ? 'red' : recommendedBase ? 'gold' : 'green'}
          />
          <button type="button" className="pstack-btn" onClick={() => setExpanded(true)}>
            {zh ? '展开席位' : 'Details'}
          </button>
          <button type="button" className="pstack-btn primary" onClick={() => props.openRightTab('panel')}>
            {zh ? '看评分' : 'Open matrix'}
          </button>
        </div>
      </section>
    )
  }

  const stageIdx = phase === 'result' ? 3 : phase === 'preparing' ? 0 : 1
  const stages = zh ? ARENA_STAGE_LABELS_ZH : ARENA_STAGE_LABELS_EN

  return (
    <section className="pstack-card">
      <div className="pstack-card-head">
        <h3>Arena</h3>
        <span className="pstack-card-task">{task}</span>
        {phase === 'result' ? (
          <button type="button" className="pstack-btn" onClick={() => setExpanded(false)}>
            {zh ? '收起' : 'Collapse'}
          </button>
        ) : null}
      </div>
      <div className="pstack-phases">
        {stages.map((label, idx) => (
          <span key={label} className={idx < stageIdx ? 'done' : idx === stageIdx ? 'now' : ''}>
            {label}
          </span>
        ))}
      </div>
      {candidates.length > 0 ? (
        <div className="pstack-seats">
          {candidates.map((c) => {
            const secs = c.durationMs ? `${Math.max(1, Math.round(c.durationMs / 1000))}s` : ''
            return (
              <div key={c.id} className="pstack-seat">
                <b>{c.model}</b>
                <span className="vendor">
                  <span className={`pstack-lamp ${c.status === 'submitted' ? 'gold' : ''}`} />
                  {c.vendor}
                  {c.effort ? `, ${c.effort}` : ''}
                </span>
                <br />
                {c.status === 'submitted' ? (
                  <Stamp text={`${zh ? '交卷' : 'DONE'}${secs ? ` ${secs}` : ''}`} tone="green" />
                ) : (
                  <Stamp text={zh ? '无输出' : 'EMPTY'} tone="mute" />
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <p style={{ color: 'var(--p-text-secondary)', margin: 0 }}>
          {phase === 'preparing'
            ? zh
              ? '正在读取题目与候选席位…'
              : 'Preparing Arena framing & candidate seats…'
            : zh
              ? '正在独立 worktree 中并发运行候选模型…'
              : 'Running Arena candidates in isolated worktrees…'}
        </p>
      )}
      <div className="pstack-acts">
        <button type="button" className="pstack-btn" onClick={() => props.openRightTab('panel')}>
          {zh ? '看评分' : 'Open matrix'}
        </button>
      </div>
    </section>
  )
}

export function InterrogateToolCard(
  props: Record<string, unknown> & { readonly openRightTab: (sub: RightPaneSubtab) => void },
): React.JSX.Element {
  const { phase, args, meta, isError, errorText } = parseToolMeta(props)
  const zh = isChineseLocale()
  const task = String(meta?.task ?? args.task ?? '')
  const verified = Array.isArray(meta?.verified)
    ? (meta.verified.filter((v) => typeof v === 'object' && v !== null) as { title: string }[])
    : []
  const dropped = typeof meta?.droppedCount === 'number' ? meta.droppedCount : 0

  return (
    <section className={`pstack-card${phase === 'result' && isError ? ' error' : ''}`}>
      <div className="pstack-card-head">
        <h3>Interrogate</h3>
        <span className="pstack-card-task">{task}</span>
        {phase === 'result' ? (
          isError ? (
            <Stamp text={zh ? '失败' : 'ERROR'} tone="red" />
          ) : (
            <Stamp
              text={verified.length > 0 ? `${zh ? '成立' : 'PROVEN'} ${verified.length}` : zh ? '0 成立' : 'CLEAN'}
              tone={verified.length > 0 ? 'red' : 'mute'}
            />
          )
        ) : null}
      </div>
      {phase === 'result' ? (
        isError ? (
          <ToolErrorSummary errorText={errorText} zh={zh} />
        ) : (
          <p style={{ margin: 0, color: 'var(--p-text-secondary)' }}>
            {verified.length === 0
              ? `no verified findings (${dropped} discarded)`
              : zh
                ? `${verified.length} 条结论经独立复跑失败确认成立，已丢弃 ${dropped} 条未证实结论。`
                : `${verified.length} finding(s) proven by command failure; ${dropped} unverified claim(s) discarded.`}
          </p>
        )
      ) : (
        <p style={{ margin: 0, color: 'var(--p-text-secondary)' }}>
          {zh ? '评审员正在取证并由插件复跑验证命令…' : 'Running adversarial review & command verification…'}
        </p>
      )}
      <div className="pstack-acts">
        <button type="button" className="pstack-btn" onClick={() => props.openRightTab('panel')}>
          {zh ? '看结论' : 'Inspect findings'}
        </button>
      </div>
    </section>
  )
}

export function SwarmToolCard(
  props: Record<string, unknown> & { readonly openRightTab: (sub: RightPaneSubtab) => void },
): React.JSX.Element {
  const { phase, args, meta, isError, errorText } = parseToolMeta(props)
  const zh = isChineseLocale()
  const task = String(meta?.task ?? args.task ?? '')
  const passed = typeof meta?.passedCount === 'number' ? meta.passedCount : 0
  const gaps = typeof meta?.gapCount === 'number' ? meta.gapCount : 0
  const slices = Array.isArray(meta?.slices)
    ? meta.slices.length
    : Array.isArray(args.slices)
      ? args.slices.filter((s) => s !== null && s !== undefined).length
      : 0

  return (
    <section className={`pstack-card${phase === 'result' && isError ? ' error' : ''}`}>
      <div className="pstack-card-head">
        <h3>Swarm</h3>
        <span className="pstack-card-task">{task}</span>
        {phase === 'result' ? (
          isError ? (
            <Stamp text={zh ? '失败' : 'ERROR'} tone="red" />
          ) : (
            <Stamp
              text={gaps > 0 ? `${zh ? '缺口' : 'GAP'} ${gaps}` : `PASS ${passed}/${slices}`}
              tone={gaps > 0 ? 'red' : 'green'}
            />
          )
        ) : null}
      </div>
      {phase === 'result' && isError ? (
        <ToolErrorSummary errorText={errorText} zh={zh} />
      ) : phase !== 'result' ? (
        <p style={{ margin: 0, color: 'var(--p-text-secondary)' }}>
          {zh
            ? `正在并行派发 ${slices > 0 ? `${slices} 个` : ''}工作切片并校验 SHA 证据…`
            : `Dispatching ${slices > 0 ? `${slices} ` : ''}Swarm worker slice(s) & verifying commit pointers…`}
        </p>
      ) : null}
      <div className="pstack-acts">
        <button type="button" className="pstack-btn" onClick={() => props.openRightTab('panel')}>
          {zh ? '看切片表' : 'Open slices'}
        </button>
      </div>
    </section>
  )
}

export function SickoToolCard(props: Record<string, unknown>): React.JSX.Element {
  const { phase, meta, isError, errorText } = parseToolMeta(props)
  const zh = isChineseLocale()
  const report = (typeof meta?.report === 'object' && meta.report !== null ? meta.report : undefined) as
    | SickoReport
    | undefined

  return (
    <section className={`pstack-card ${phase === 'result' && isError ? 'error' : 'peel'}`}>
      <div className="pstack-card-head">
        <h3>Comment Sicko</h3>
        {phase === 'result' && isError ? (
          <Stamp text={zh ? '失败' : 'ERROR'} tone="red" />
        ) : report && report.mustKill.length > 0 ? (
          <Stamp text={`MUST KILL ${report.mustKill.length}`} tone="red" said />
        ) : null}
      </div>
      <div className="pstack-sicko-quote">“Yes... Ha ha ha... Yes!”</div>
      {phase === 'result' && isError ? (
        <ToolErrorSummary errorText={errorText} zh={zh} />
      ) : phase === 'result' && report ? (
        <>
          <div className="pstack-tally">
            <div>
              <b>{report.deleted}</b>
              <span style={{ color: 'var(--p-text-secondary)', fontSize: 12 }}>
                {zh ? '条注释删掉' : 'comments killed'}
              </span>
            </div>
            <div>
              <b>{report.mustKill.length}</b>
              <span style={{ color: 'var(--p-text-secondary)', fontSize: 12 }}>
                {zh ? '处要改代码' : 'MUST KILL'}
              </span>
            </div>
            <div>
              <b>{report.review.length}</b>
              <span style={{ color: 'var(--p-text-secondary)', fontSize: 12 }}>
                {zh ? '条留待你看' : 'for REVIEW'}
              </span>
            </div>
          </div>
          {report.mustKill.length > 0 ? (
            <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
              {report.mustKill.map((item, i) => (
                <li key={`mk-${i}`}>
                  <code>{item.symbol}</code> — {item.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {report.review.length > 0 ? (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--p-text-secondary)' }}>
              {report.review.map((item, i) => (
                <li key={`rv-${i}`}>
                  <code>{item.claimedRule}</code>: {item.quote}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  )
}

export function BenchFreezeToolCard(
  props: Record<string, unknown> & { readonly openRightTab: (sub: RightPaneSubtab) => void },
): React.JSX.Element {
  const { phase, args, meta, isError, errorText } = parseToolMeta(props)
  const zh = isChineseLocale()
  const metricName = String(meta?.metricName ?? args.metricName ?? 'Benchmark')
  const baseline = typeof meta?.baseline === 'number' ? meta.baseline : undefined
  const noise = typeof meta?.mad === 'number' ? meta.mad : typeof meta?.noise === 'number' ? meta.noise : undefined
  const direction = (meta?.direction ?? args.direction) === 'higher' ? 'higher' : 'lower'

  return (
    <section className={`pstack-card${phase === 'result' && isError ? ' error' : ''}`} style={{ padding: '10px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontFamily: 'var(--p-display)' }}>Hillclimb</b>
        <span className="pstack-card-task">{metricName}</span>
        {phase === 'result' ? (
          isError ? (
            <Stamp text={zh ? '失败' : 'ERROR'} tone="red" />
          ) : (
            <>
              {baseline !== undefined ? (
                <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--p-text-secondary)' }}>
                  {zh ? '基线 ' : 'base '}
                  {baseline}
                  {noise !== undefined && noise > 0 ? ` ±${Math.round(noise * 100) / 100}` : ''} (
                  {direction === 'lower' ? (zh ? '越低越好' : 'lower') : zh ? '越高越好' : 'higher'})
                </span>
              ) : null}
              <Stamp text={zh ? '基准已冻结' : 'FROZEN'} tone="gold" />
            </>
          )
        ) : (
          <span style={{ color: 'var(--p-text-secondary)', fontSize: 12 }}>
            {zh ? '正在采样基线并冻结测试脚本…' : 'Sampling baseline & freezing harness…'}
          </span>
        )}
        <button type="button" className="pstack-btn" onClick={() => props.openRightTab('bench')}>
          {zh ? '看折线' : 'Chart'}
        </button>
      </div>
      {phase === 'result' && isError ? <ToolErrorSummary errorText={errorText} zh={zh} /> : null}
    </section>
  )
}

export function AttemptToolCard(
  props: Record<string, unknown> & { readonly openRightTab: (sub: RightPaneSubtab) => void },
): React.JSX.Element {
  const { phase, args, meta, isError, errorText } = parseToolMeta(props)
  const zh = isChineseLocale()
  const attempt = (typeof meta?.attempt === 'object' && meta.attempt !== null ? meta.attempt : undefined) as
    | BenchAttemptView
    | undefined
  const drifted =
    meta?.verdict === 'voided' || (Array.isArray(meta?.driftedFiles) && meta.driftedFiles.length > 0)
  const hypothesis = attempt?.hypothesis ?? String(args.hypothesis ?? '')
  const signedChange = attempt ? formatSignedPct(attempt.before, attempt.after) : null

  return (
    <section
      className={`pstack-card${phase === 'result' && (isError || drifted) ? ' error' : ''}`}
      style={{ padding: '10px 14px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontFamily: 'var(--p-display)' }}>Hillclimb</b>
        <span className="pstack-card-task">{hypothesis}</span>
        {phase === 'result' ? (
          isError ? (
            <Stamp text={zh ? '失败' : 'ERROR'} tone="red" />
          ) : drifted ? (
            <Stamp text={zh ? '作废' : 'DRIFT'} tone="red" />
          ) : attempt ? (
            <>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--p-text-secondary)' }}>
                {attempt.before} → {attempt.after}
              </span>
              <Stamp
                text={
                  attempt.kept
                    ? `${zh ? '保留' : 'KEPT'}${signedChange ? ` ${signedChange}` : ''}`
                    : zh
                      ? '回滚'
                      : 'REVERT'
                }
                tone={attempt.kept ? 'gold' : 'mute'}
              />
            </>
          ) : null
        ) : (
          <span style={{ color: 'var(--p-text-secondary)', fontSize: 12 }}>
            {zh ? '正在采样与门禁校验…' : 'Sampling & running gate…'}
          </span>
        )}
        <button type="button" className="pstack-btn" onClick={() => props.openRightTab('bench')}>
          {zh ? '看折线' : 'Chart'}
        </button>
      </div>
      {phase === 'result' && isError ? <ToolErrorSummary errorText={errorText} zh={zh} /> : null}
    </section>
  )
}

function normalizeKetchupItems(raw: unknown): KetchupItemView[] {
  if (!Array.isArray(raw)) return []
  const items: KetchupItemView[] = []
  raw.forEach((entry, idx) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return
    const rec = entry as Record<string, unknown>
    const rawOptions = Array.isArray(rec.options) ? rec.options : []
    const options: KetchupOptionView[] = rawOptions
      .filter((o): o is Record<string, unknown> => typeof o === 'object' && o !== null && !Array.isArray(o))
      .map((o) => ({
        label: typeof o.label === 'string' ? o.label : 'Choose',
        prompt: typeof o.prompt === 'string' ? o.prompt : typeof o.label === 'string' ? o.label : '',
        ...(typeof o.cost === 'string' ? { cost: o.cost } : {}),
        ...(typeof o.primary === 'boolean' ? { primary: o.primary } : {}),
      }))
    items.push({
      id: typeof rec.id === 'string' && rec.id !== '' ? rec.id : `ketchup-${idx + 1}`,
      question: typeof rec.question === 'string' ? rec.question : '',
      recommendation: typeof rec.recommendation === 'string' ? rec.recommendation : '',
      ...(typeof rec.change === 'string' ? { change: rec.change } : {}),
      ...(typeof rec.evidence === 'string' ? { evidence: rec.evidence } : {}),
      ...(typeof rec.risk === 'string' ? { risk: rec.risk } : {}),
      options,
      ...(typeof rec.decided === 'string' ? { decided: rec.decided } : {}),
    })
  })
  return items
}

export interface KetchupDecisionResult {
  readonly ok: boolean
  readonly error?: string | undefined
}

export function KetchupToolCard(
  props: Record<string, unknown> & {
    readonly sessionId?: string | undefined
    readonly useProjection?: ((key: string) => unknown) | undefined
    readonly decideItem: (req: {
      readonly sessionId: string | undefined
      readonly itemId: string
      readonly label: string
      readonly prompt: string
    }) => Promise<KetchupDecisionResult>
  },
): React.JSX.Element {
  const { phase, args, meta, isError, errorText } = parseToolMeta(props)
  const zh = isChineseLocale()
  const liveView = readPstackView(props.useProjection?.('pstack'))
  const items = normalizeKetchupItems(Array.isArray(meta?.items) ? meta.items : args.items)
  const [chosen, setChosen] = React.useState<Record<string, string>>({})
  const [submitErr, setSubmitErr] = React.useState<string | null>(null)
  const inFlightRef = React.useRef<Set<string>>(new Set())

  if (phase === 'result' && isError) {
    return (
      <section className="pstack-card error">
        <div className="pstack-card-head">
          <h3>Ketchup</h3>
          <Stamp text={zh ? '失败' : 'ERROR'} tone="red" />
        </div>
        <ToolErrorSummary errorText={errorText} zh={zh} />
      </section>
    )
  }

  const resolvedChoice = (item: KetchupItemView, idx: number): string | undefined => {
    const key = item.id || `ketchup-${idx + 1}`
    const fromProjection = liveView?.ketchup.find((k) => k.id === key)?.decided
    return fromProjection ?? item.decided ?? chosen[key]
  }

  const choose = async (itemId: string, label: string, prompt: string) => {
    if (phase !== 'result' || inFlightRef.current.has(itemId)) return
    inFlightRef.current.add(itemId)
    setSubmitErr(null)
    setChosen((prev) => ({ ...prev, [itemId]: label }))
    try {
      const res = await props.decideItem({ sessionId: props.sessionId, itemId, label, prompt })
      if (!res.ok) {
        setChosen((prev) => {
          const copy = { ...prev }
          delete copy[itemId]
          return copy
        })
        setSubmitErr(
          res.error ??
            (zh ? '发送拍板指令失败，请确认当前会话在线。' : 'Could not deliver decision; verify session is active.'),
        )
      }
    } finally {
      inFlightRef.current.delete(itemId)
    }
  }

  const pendingCount = items.filter((it, idx) => resolvedChoice(it, idx) === undefined).length

  return (
    <section className="pstack-card ketchup">
      <div className="pstack-card-head">
        <h3>
          {phase !== 'result'
            ? zh
              ? '正在整理需要你拍板的事项…'
              : 'Preparing operator decision card…'
            : pendingCount > 0
              ? fallbackT('ketchup.head', { count: pendingCount })
              : items.length > 0
                ? zh
                  ? '待决事项已全部拍板'
                  : 'All decisions answered'
                : 'Ketchup'}
        </h3>
      </div>
      {submitErr ? (
        <p role="alert" style={{ color: 'var(--p-ketchup)', fontSize: 12, margin: '0 0 8px' }}>
          {submitErr}
        </p>
      ) : null}
      {items.map((item, idx) => {
        const key = item.id || `ketchup-${idx + 1}`
        const picked = resolvedChoice(item, idx)
        return (
          <div key={key} className="pstack-call">
            <h4>{item.question}</h4>
            <div className="pstack-call-pick">{item.recommendation}</div>
            <dl className="pstack-facts">
              {item.change ? (
                <>
                  <dt>{zh ? '变化' : 'Change'}</dt>
                  <dd>{item.change}</dd>
                </>
              ) : null}
              {item.evidence ? (
                <>
                  <dt>{zh ? '证据' : 'Proof'}</dt>
                  <dd>{item.evidence}</dd>
                </>
              ) : null}
              {item.risk ? (
                <>
                  <dt>{zh ? '风险' : 'Risk'}</dt>
                  <dd>{item.risk}</dd>
                </>
              ) : null}
            </dl>
            {picked ? (
              <div style={{ marginTop: 8 }}>
                <Stamp text={fallbackT('ketchup.decided', { choice: picked })} tone="green" />
              </div>
            ) : (
              <div className="pstack-acts">
                {item.options.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    disabled={phase !== 'result'}
                    className={`pstack-btn${opt.primary ? ' primary' : ''}`}
                    title={opt.cost}
                    onClick={() => void choose(key, opt.label, opt.prompt)}
                  >
                    <span>{opt.label}</span>
                    {opt.cost ? <small style={{ opacity: 0.78 }}>· {opt.cost}</small> : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}

export function PlaybookDock(props: {
  readonly sessionId?: string | undefined
  readonly useProjection?: ((key: string) => unknown) | undefined
  readonly openRightTab: (sub: RightPaneSubtab) => void
}): React.JSX.Element | null {
  const view: PstackView = readPstackView(props.useProjection?.('pstack')) ?? EMPTY_PSTACK_VIEW
  const [previewSlug] = usePreviewPlaybook(props.sessionId)
  const zh = isChineseLocale()

  // Seed seen watermark per sessionId so mounting onto an existing session never replays stale toasts
  const seenRef = React.useRef<{ sessionId: string | undefined; seq: number | undefined }>({
    sessionId: props.sessionId,
    seq: view.moment?.seq ?? 0,
  })
  const [liveMoment, setLiveMoment] = React.useState<MomentEvent | null>(null)
  const [flash, setFlash] = React.useState(false)

  React.useEffect(() => {
    const seq = view.moment?.seq ?? 0
    if (seenRef.current.sessionId !== props.sessionId) {
      seenRef.current = { sessionId: props.sessionId, seq }
      setLiveMoment(null)
      setFlash(false)
      return undefined
    }
    const prev = seenRef.current.seq
    seenRef.current = { sessionId: props.sessionId, seq }
    if (prev === undefined || seq <= prev || view.moment === null) return undefined
    setLiveMoment(view.moment)
    setFlash(true)
    const flashTimer = setTimeout(() => setFlash(false), 920)
    const hideTimer = setTimeout(() => setLiveMoment(null), 5000)
    return () => {
      clearTimeout(flashTimer)
      clearTimeout(hideTimer)
    }
  }, [props.sessionId, view.moment?.seq])

  const previewPb =
    view.playbook === null && previewSlug !== null
      ? HERO_FEATURED_PLAYBOOKS.find((item) => item.slug === previewSlug)
      : undefined

  if (!hasActivePstackSignal(view) && previewPb === undefined) return null

  const pb = view.playbook
  const displaySteps =
    pb !== null
      ? pb.steps
      : previewPb !== undefined
        ? (zh ? previewPb.previewStepsZh : previewPb.previewSteps).map((label, i) => ({
            index: i + 1,
            label,
            text: label,
            status: 'pending' as const,
            routes: [] as readonly string[],
          }))
        : []
  const activeStep = pb?.steps.find((s) => s.index === pb.currentStep) ?? pb?.steps[0]
  const whereText = pb
    ? pb.completed
      ? fallbackT('dock.done')
      : pb.steps.length > 0
        ? `${pb.currentStep}/${pb.steps.length} ${activeStep?.label ?? ''}`.trim()
        : pb.title
    : previewPb !== undefined
      ? zh
        ? '已就绪 · 补全任务后回车开始'
        : 'Ready · describe task & press Enter'
      : 'poteto-mode'

  const tddInfo =
    view.tdd.phase === 'off'
      ? { lamp: '', label: fallbackT('tdd.off') }
      : view.tdd.phase === 'red-pending'
        ? { lamp: 'red', label: fallbackT('tdd.pending') }
        : view.tdd.phase === 'red-observed'
          ? { lamp: 'red', label: fallbackT('tdd.red') }
          : { lamp: 'green', label: fallbackT('tdd.green') }

  const waitingTotal = view.pendingKetchupCount + (view.guard.pendingApprovals ?? 0)

  return (
    <div className="pstack-dock-wrap">
      {liveMoment ? (
        <div className="pstack-moment" role="status">
          <span className="skill">{liveMoment.skill}</span>
          <span className="text">{zh ? liveMoment.textZh : liveMoment.textEn}</span>
          <Stamp
            key={liveMoment.seq}
            text={zh ? liveMoment.stampZh : liveMoment.stampEn}
            tone={liveMoment.tone}
            said={liveMoment.said === true}
            land
          />
        </div>
      ) : null}

      <button
        type="button"
        className={`pstack-dock${flash ? ' pstack-flash' : ''}`}
        title={pb?.stance ?? (previewPb ? (zh ? previewPb.stanceZh : previewPb.stanceEn) : 'Open pstack panel')}
        onClick={() => props.openRightTab('playbook')}
      >
        <Potato
          crowned={view.mode === 'on' || previewPb !== undefined}
          golden={pb?.completed === true}
          ketchup={waitingTotal > 0}
        />
        <span className="pstack-dock-pb">{pb?.title ?? previewPb?.title ?? 'poteto-mode'}</span>
        {displaySteps.length > 0 ? <Fries steps={displaySteps} /> : <span style={{ flex: 1 }} />}
        <span className="pstack-dock-where">{whereText}</span>
        {view.tdd.phase !== 'off' ? (
          <span className="pstack-tag">
            <span className={`pstack-lamp ${tddInfo.lamp}`} />
            {tddInfo.label}
          </span>
        ) : null}
        {view.guard.blocks > 0 ? (
          <span className="pstack-tag">{fallbackT('dock.blocks', { count: view.guard.blocks })}</span>
        ) : null}
        {waitingTotal > 0 ? <span className="pstack-ketchup-badge">{waitingTotal}</span> : null}
      </button>
    </div>
  )
}

export function PotetoModeBadge(props: {
  readonly sessionId?: string | undefined
  readonly useProjection?: ((key: string) => unknown) | undefined
  readonly openRightTab: (sub: RightPaneSubtab) => void
}): React.JSX.Element {
  const view = readPstackView(props.useProjection?.('pstack'))
  const [previewSlug] = usePreviewPlaybook(props.sessionId)
  const zh = isChineseLocale()
  const active = view?.mode === 'on' || previewSlug !== null

  return (
    <button
      type="button"
      className={`pstack-mode-chip${active ? ' active' : ''}`}
      onClick={() => props.openRightTab('playbook')}
      title={
        active
          ? zh
            ? 'poteto-mode 已激活 — 点击打开 pstack 右侧面板'
            : 'poteto-mode active — click to open pstack panel'
          : zh
            ? '打开 pstack 面板（Playbook · 面板 · 实验 · 记录）'
            : 'Open pstack panel (Playbook · Panel · Bench · Ledger)'
      }
    >
      <Potato
        size="sm"
        crowned={active}
        golden={view?.playbook?.completed === true}
        ketchup={(view?.pendingKetchupCount ?? 0) + (view?.guard.pendingApprovals ?? 0) > 0}
      />
      <span>{active ? 'poteto-mode' : 'pstack'}</span>
    </button>
  )
}

export function PstackHeaderButton(props: {
  readonly sessionId?: string | undefined
  readonly useProjection?: ((key: string) => unknown) | undefined
  readonly toggleRightTab: (sub: RightPaneSubtab) => void
}): React.JSX.Element {
  const view = readPstackView(props.useProjection?.('pstack'))
  const [previewSlug] = usePreviewPlaybook(props.sessionId)
  const zh = isChineseLocale()
  const active = hasActivePstackSignal(view) || previewSlug !== null
  const waitingTotal = (view?.pendingKetchupCount ?? 0) + (view?.guard.pendingApprovals ?? 0)

  return (
    <button
      type="button"
      className={`pstack-header-btn${active ? ' active' : ''}`}
      onClick={() => props.toggleRightTab('playbook')}
      title={zh ? '打开 / 切换 pstack 面板' : 'Open / toggle pstack right sidebar'}
    >
      <Potato
        size="sm"
        crowned={view?.mode === 'on' || previewSlug !== null}
        golden={view?.playbook?.completed === true}
        ketchup={waitingTotal > 0}
      />
      <span>pstack</span>
      {waitingTotal > 0 ? <span className="pstack-ketchup-badge">{waitingTotal}</span> : null}
    </button>
  )
}

export function HeroPlaybookPicker(props: {
  readonly sessionId?: string | undefined
  readonly inputActions?: DshInputActions | undefined
  readonly sendPrompt: (text: string) => Promise<void>
  readonly openRightTab: (sub: RightPaneSubtab) => void
}): React.JSX.Element {
  const zh = isChineseLocale()
  const [previewSlug, setPreviewSlug] = usePreviewPlaybook(props.sessionId)

  const pick = (slug: string, title: string) => {
    setPreviewSlug(slug)
    const draft = `/poteto-mode ${title}: `
    if (!applyComposerDraft(props.inputActions, draft)) {
      void props.sendPrompt(draft)
    }
    props.openRightTab('playbook')
  }

  // Keep the narrow hero toolbar compact (2 primary pills + More) so it never clips even with both sidebars open
  const primary = HERO_FEATURED_PLAYBOOKS.slice(0, 2)
  const extraSelected = HERO_FEATURED_PLAYBOOKS.slice(2).find((pb) => pb.slug === previewSlug)
  const visible = extraSelected ? [primary[0]!, extraSelected] : primary

  return (
    <div className="pstack-hero">
      {visible.map((pb) => {
        const selected = previewSlug === pb.slug
        return (
          <button
            key={pb.slug}
            type="button"
            className={`pstack-hero-pill${selected ? ' active' : ''}`}
            aria-pressed={selected}
            title={zh ? `${pb.hintZh}（点击填入指令并打开 pstack 面板）` : `${pb.hintEn} (fills prompt & opens pstack panel)`}
            onClick={() => pick(pb.slug, pb.title)}
          >
            <Potato size="sm" crowned={selected} />
            <b>{pb.title}</b>
          </button>
        )
      })}
      <button
        type="button"
        className="pstack-hero-pill"
        title={zh ? '打开 pstack 右侧面板查看全部 22 个 Playbook 与门禁' : 'Open pstack right panel for all 22 playbooks & gates'}
        onClick={() => props.openRightTab('playbook')}
      >
        <span>{zh ? '更多' : 'More'}</span>
      </button>
    </div>
  )
}

export function SessionRowTrailing({
  summary,
}: {
  readonly summary: PstackSummaryView | undefined
}): React.JSX.Element | null {
  if (!summary || !summary.active) return null

  if (summary.pendingCount > 0) {
    return (
      <span className="pstack-row-trail">
        <span className="pstack-ketchup-badge">{summary.pendingCount}</span>
        <span>{fallbackT('row.waiting')}</span>
      </span>
    )
  }

  if (summary.autopilotActive) {
    return (
      <span className="pstack-row-trail">
        <span className="pstack-lamp gold" />
        <span>{summary.autopilotMode ?? fallbackT('row.autopilot')}</span>
      </span>
    )
  }

  if (summary.checkpointSaved) {
    return (
      <span className="pstack-row-trail">
        <span className="pstack-lamp purple" />
        <span>{fallbackT('row.paused')}</span>
      </span>
    )
  }

  if (summary.completed) {
    return (
      <span className="pstack-row-trail">
        <Potato size="sm" crowned={summary.mode === 'on'} golden />
        <span>{fallbackT('row.done')}</span>
      </span>
    )
  }

  if (summary.totalSteps > 0) {
    return (
      <span className="pstack-row-trail">
        <Potato size="sm" crowned={summary.mode === 'on'} />
        <span>
          {summary.currentStep}/{summary.totalSteps}
        </span>
      </span>
    )
  }

  if (summary.mode === 'on') {
    return (
      <span className="pstack-row-trail">
        <Potato size="sm" crowned />
      </span>
    )
  }

  return null
}

export function SessionRowHover({
  summary,
}: {
  readonly summary: PstackSummaryView | undefined
}): React.JSX.Element | null {
  if (!summary || !summary.active) return null
  return (
    <div className="pstack-row-hover">
      {summary.playbookTitle ? (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Potato
            size="sm"
            crowned={summary.mode === 'on'}
            golden={summary.completed}
            ketchup={summary.pendingCount > 0}
          />
          <b style={{ color: 'var(--p-text-primary)' }}>{summary.playbookTitle}</b>
          {summary.totalSteps > 0 ? (
            <span>
              · {summary.currentStep}/{summary.totalSteps}
              {summary.activeStepLabel ? ` ${summary.activeStepLabel}` : ''}
            </span>
          ) : null}
        </div>
      ) : null}
      {summary.pendingCount > 0 ? (
        <div style={{ color: 'var(--p-ketchup)' }}>
          {fallbackT('ketchup.head', { count: summary.pendingCount })}
        </div>
      ) : null}
    </div>
  )
}

export { selectRightPaneSubtab }
