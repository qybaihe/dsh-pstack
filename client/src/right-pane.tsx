/**
 * Right Sidebar `pstack` tab (`sidebar.right.pane.tab` + `sidebarRightTabs`):
 * four sub-pages — Playbook, Panel (Arena · Interrogate · Swarm),
 * Bench (Hillclimb), and Ledger (Show Me Your Work & Autopilot).
 */

import * as React from 'react'
import {
  HERO_FEATURED_PLAYBOOKS,
  PLAYBOOK_TITLES,
  PRINCIPLE_CATALOG,
  resolvePlaybookSlug,
} from '../../src/core/catalog.ts'
import { DECISION_HEADER, formatRow } from '../../src/core/decision-log.ts'
import type { RevertReason } from '../../src/core/experiment.ts'
import { contiguousLandablePrefix } from '../../src/core/panel-rules.ts'
import type { BenchView, PstackView } from '../../src/core/projection.ts'
import type { TddState } from '../../src/core/tdd-gate.ts'
import { formatSignedPct } from './cards.tsx'
import { fallbackT, isChineseLocale } from './i18n.ts'
import type { PstackTranslate } from './i18n.ts'
import {
  Potato,
  PrincipleEyes,
  Stamp,
  applyComposerDraft,
  usePreviewPlaybook,
  useRightPaneSubtab,
} from './primitives.tsx'
import type { DshInputActions, RightPaneSubtab } from './primitives.tsx'

export interface PstackRpcCaller {
  call<T = unknown>(endpoint: string, payload?: unknown): Promise<T | undefined>
  sendPrompt(text: string): Promise<void>
  openFile?(path: string, line?: number): void
  openSession?(sessionId: string): void
}

const REVERT_LABELS_ZH: Readonly<Record<RevertReason | 'harness-drift', string>> = {
  'too-few-samples': '样本不足',
  'harness-errors': '基准报错',
  'work-changed': '工作量变了',
  'gate-red': '门禁变红',
  regressed: '变差',
  'within-noise': '在噪声内',
  'harness-drift': '基准被动过',
}

const REVERT_LABELS_EN: Readonly<Record<RevertReason | 'harness-drift', string>> = {
  'too-few-samples': 'too few samples',
  'harness-errors': 'harness errors',
  'work-changed': 'work changed',
  'gate-red': 'gate red',
  regressed: 'regressed',
  'within-noise': 'within noise',
  'harness-drift': 'harness drift',
}

function PlaybookPane({
  view,
  sessionId,
  inputActions,
  rpc,
  t,
}: {
  readonly view: PstackView
  readonly sessionId: string | undefined
  readonly inputActions?: DshInputActions | undefined
  readonly rpc: PstackRpcCaller
  readonly t: PstackTranslate
}): React.JSX.Element {
  const pb = view.playbook
  const zh = isChineseLocale()
  const [previewSlug, setPreviewSlug] = usePreviewPlaybook(sessionId)
  const [showAllPlaybooks, setShowAllPlaybooks] = React.useState(false)
  const previewPb =
    pb === null && previewSlug !== null
      ? HERO_FEATURED_PLAYBOOKS.find((item) => item.slug === previewSlug)
      : undefined
  const customPreviewTitle =
    pb === null && previewSlug !== null && previewPb === undefined
      ? PLAYBOOK_TITLES.find((title) => resolvePlaybookSlug(title) === previewSlug)
      : undefined

  const readSkills = new Set(view.readSkills)
  const [busyTdd, setBusyTdd] = React.useState(false)
  const [localTdd, setLocalTdd] = React.useState<TddState | null>(null)
  const [tddError, setTddError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setLocalTdd(null)
    setTddError(null)
    if (!sessionId) return
    let cancelled = false
    void rpc.call<{ ok?: boolean; tdd?: TddState }>('tdd', { sessionId, action: 'status' }).then((res) => {
      if (!cancelled && res?.ok !== false && res?.tdd) setLocalTdd(res.tdd)
    })
    return () => {
      cancelled = true
    }
  }, [view.tdd.phase, sessionId])

  const effectiveTdd = localTdd ?? view.tdd
  const tddMeta =
    effectiveTdd.phase === 'off'
      ? { stamp: t('tdd.stamp.off'), tone: 'mute' as const, why: t('tdd.why.off') }
      : effectiveTdd.phase === 'red-pending'
        ? { stamp: t('tdd.stamp.pending'), tone: 'red' as const, why: t('tdd.why.pending') }
        : effectiveTdd.phase === 'red-observed'
          ? { stamp: t('tdd.stamp.red'), tone: 'red' as const, why: `${effectiveTdd.red.command} (exit ${effectiveTdd.red.exitCode})` }
          : { stamp: t('tdd.stamp.green'), tone: 'green' as const, why: `${effectiveTdd.green.command} (exit 0)` }

  const toggleTdd = async () => {
    if (!sessionId) {
      setTddError(zh ? '请先发送首条消息创建会话，再切换 TDD 门禁。' : 'Start a session first to arm TDD.')
      return
    }
    setBusyTdd(true)
    setTddError(null)
    try {
      const next = effectiveTdd.phase === 'off' ? 'on' : 'off'
      const res = await rpc.call<{ ok?: boolean; tdd?: TddState }>('tdd', { sessionId, action: next })
      if (res?.ok !== false && res?.tdd) {
        setLocalTdd(res.tdd)
      } else {
        setTddError(
          zh ? 'TDD 状态切换未生效（宿主会话不可用），请重试或直接输入 /tdd on。' : 'Could not update TDD on host; try /tdd on.',
        )
      }
    } finally {
      setBusyTdd(false)
    }
  }

  const pickPlaybook = (slug: string, title: string) => {
    setPreviewSlug(slug)
    const draft = `/poteto-mode ${title}: `
    if (!applyComposerDraft(inputActions, draft)) {
      void rpc.sendPrompt(draft)
    }
  }

  const flaggedTitles = view.flaggedPrinciples
    .map((name) => PRINCIPLE_CATALOG.find((p) => p.name === name)?.title ?? name)
    .join(zh ? '、' : ', ')

  const displaySteps = pb
    ? pb.steps
    : previewPb
      ? (zh ? previewPb.previewStepsZh : previewPb.previewSteps).map((label, i) => ({
          index: i + 1,
          label,
          text: label,
          status: 'pending' as const,
          routes: [] as readonly string[],
        }))
      : []

  const previewTitle = previewPb?.title ?? customPreviewTitle
  const featuredSlugs = new Set(HERO_FEATURED_PLAYBOOKS.map((item) => item.slug))
  const extraPlaybooks = PLAYBOOK_TITLES.filter((title) => !featuredSlugs.has(resolvePlaybookSlug(title)))

  return (
    <div>
      <div className="pstack-hero-head">
        <Potato
          size="lg"
          crowned={view.mode === 'on' || previewTitle !== undefined}
          golden={pb?.completed === true}
          ketchup={view.pendingKetchupCount > 0}
        />
        <div>
          <h2>{pb ? pb.title : previewTitle ?? t('pb.empty.title')}</h2>
          <p>
            {pb
              ? pb.stance
              : previewPb
                ? zh
                  ? previewPb.stanceZh
                  : previewPb.stanceEn
                : customPreviewTitle
                  ? zh
                    ? `已选择 ${customPreviewTitle} 剧本，描述你的任务后按回车启动。`
                    : `Selected ${customPreviewTitle} playbook; describe your task and press Enter.`
                  : t('pb.empty.desc')}
          </p>
        </div>
      </div>

      {pb === null ? (
        <div className="pstack-quick-chips">
          {HERO_FEATURED_PLAYBOOKS.map((item) => {
            const active = previewSlug === item.slug
            return (
              <button
                key={item.slug}
                type="button"
                className={`pstack-hero-pill${active ? ' active' : ''}`}
                aria-pressed={active}
                title={zh ? item.hintZh : item.hintEn}
                onClick={() => pickPlaybook(item.slug, item.title)}
              >
                <Potato size="sm" crowned={active} />
                <b>{item.title}</b>
              </button>
            )
          })}
          {showAllPlaybooks
            ? extraPlaybooks.map((title) => {
                const slug = resolvePlaybookSlug(title)
                const active = previewSlug === slug
                return (
                  <button
                    key={slug}
                    type="button"
                    className={`pstack-hero-pill${active ? ' active' : ''}`}
                    aria-pressed={active}
                    onClick={() => pickPlaybook(slug, title)}
                  >
                    <Potato size="sm" crowned={active} />
                    <b>{title}</b>
                  </button>
                )
              })
            : null}
          <button
            type="button"
            className="pstack-hero-pill"
            aria-expanded={showAllPlaybooks}
            onClick={() => setShowAllPlaybooks((prev) => !prev)}
          >
            <span>{showAllPlaybooks ? t('pb.all.hide') : t('pb.all.show')}</span>
          </button>
        </div>
      ) : null}

      {previewTitle && pb === null ? (
        <div
          className="pstack-note gold"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}
        >
          <span>
            {zh
              ? `已在输入框填入 /poteto-mode ${previewTitle}: 补全具体任务后按回车启动。`
              : `Drafted /poteto-mode ${previewTitle}: describe your task and press Enter to begin.`}
          </span>
          <button
            type="button"
            className="pstack-btn"
            onClick={() => pickPlaybook(previewSlug ?? resolvePlaybookSlug(previewTitle), previewTitle)}
          >
            {zh ? '重新填入' : 'Refill'}
          </button>
        </div>
      ) : null}

      {pb?.goal ? (
        <p className="pstack-goal-box">
          <span style={{ color: 'var(--p-text-tertiary)', marginRight: 8 }}>{t('pb.goal')}</span>
          {pb.goal}
        </p>
      ) : null}

      {displaySteps.length > 0 ? (
        <ol className="pstack-steplist">
          {displaySteps.map((step) => {
            const cls = step.status === 'completed' ? 'done' : step.status === 'in_progress' ? 'now' : 'todo'
            const firstRoute = step.routes[0]
            return (
              <li key={step.index} className={cls}>
                <span className="fry" />
                <span title={step.text}>{step.label}</span>
                {firstRoute ? (
                  <span className={`pstack-skillref${readSkills.has(firstRoute) ? ' read' : ''}`}>
                    {firstRoute.replace(/^principle-/, '')}
                  </span>
                ) : (
                  <span />
                )}
              </li>
            )
          })}
        </ol>
      ) : null}

      <div className="pstack-sub">
        {t('pb.principles')}
        <span>{t('pb.principles.count', { read: view.readPrinciples.length })}</span>
      </div>
      <PrincipleEyes readPrinciples={view.readPrinciples} flaggedPrinciples={view.flaggedPrinciples} />

      {view.flaggedPrinciples.length > 0 ? (
        <div className="pstack-note">{t('pb.unread.note', { names: flaggedTitles })}</div>
      ) : null}

      {view.premiseWarning ? (
        <div className="pstack-note gold">{t('pb.premise.note', { cmd: view.premiseWarning.command })}</div>
      ) : null}

      <div className="pstack-sub">{t('pb.gates')}</div>
      <div className="pstack-gates">
        <span>TDD</span>
        <Stamp text={tddMeta.stamp} tone={tddMeta.tone} />
        <span style={{ color: 'var(--p-text-secondary)' }}>{tddMeta.why}</span>
        <button type="button" className="pstack-btn" disabled={busyTdd || !sessionId} onClick={() => void toggleTdd()}>
          {effectiveTdd.phase === 'off' ? t('tdd.btn.on') : t('tdd.btn.off')}
        </button>

        <span>{t('pb.gate.cmd')}</span>
        <Stamp text={t('dock.blocks', { count: view.guard.blocks })} tone={view.guard.blocks > 0 ? 'red' : 'mute'} />
        <span style={{ color: 'var(--p-text-secondary)' }}>
          {view.guard.lastBlockedCommand ? <code>{view.guard.lastBlockedCommand}</code> : 'git add <files>'}
        </span>
        <span />

        <span>{t('pb.gate.push')}</span>
        <Stamp
          text={view.guard.forbidForcePush ? t('pb.gate.forbid') : t('pb.gate.ask')}
          tone={view.guard.forbidForcePush ? 'red' : 'mute'}
        />
        <span style={{ color: 'var(--p-text-secondary)' }}>{t('pb.gate.push.note')}</span>
        <span />
      </div>

      {tddError ? (
        <p role="alert" style={{ color: 'var(--p-ketchup)', fontSize: 12, marginTop: 8 }}>
          {tddError}
        </p>
      ) : null}

      <p style={{ color: 'var(--p-text-tertiary)', marginTop: 18, fontSize: 12 }}>{t('pb.legend')}</p>
    </div>
  )
}

function PanelPane({
  view,
  sessionId,
  rpc,
  t,
}: {
  readonly view: PstackView
  readonly sessionId: string | undefined
  readonly rpc: PstackRpcCaller
  readonly t: PstackTranslate
}): React.JSX.Element {
  const [diffModal, setDiffModal] = React.useState<{ title: string; diff: string; isError?: boolean } | null>(null)
  const [adoptState, setAdoptState] = React.useState<{ ok: boolean; message: string } | null>(null)
  const zh = isChineseLocale()

  if (!view.arena && !view.interrogate && !view.swarm) {
    return <p style={{ color: 'var(--p-text-secondary)' }}>{t('panel.empty')}</p>
  }

  const arena = view.arena
  const baseId = arena?.parentChosenBase ?? arena?.recommendedBase

  const openDiff = async (candId: string) => {
    const res = await rpc.call<{ ok?: boolean; candidateId?: string; diff?: string; reason?: string }>(
      'candidateDiff',
      { sessionId, candidateId: candId, ...(arena?.runId ? { runId: arena.runId } : {}) },
    )
    if (!res || res.ok === false) {
      setDiffModal({
        title: `Candidate ${candId} diff`,
        diff:
          res?.reason ??
          (zh
            ? '候选 worktree 已清理或当前会话不可用。'
            : 'Candidate worktree is no longer available on the host.'),
        isError: true,
      })
      return
    }
    setDiffModal({
      title: `Candidate ${candId} diff`,
      diff: res.diff && res.diff.trim() !== '' ? res.diff : zh ? '（与基线相比无差异）' : '(No diff against baseline)',
    })
  }

  const openSwarmSha = async (sha: string) => {
    const res = await rpc.call<{ ok?: boolean; diff?: string }>('commitDiff', { sessionId, sha })
    setDiffModal({
      title: `Commit ${sha}`,
      diff:
        res?.ok && res.diff
          ? res.diff
          : zh
            ? `无法读取提交 ${sha} 的补丁。`
            : `Could not load patch for ${sha}.`,
      isError: !res?.ok,
    })
  }

  const adoptBase = async (candId: string) => {
    const res = await rpc.call<{ adopted?: boolean; message?: string }>('adoptCandidate', {
      sessionId,
      candidateId: candId,
      ...(arena?.runId ? { runId: arena.runId } : {}),
    })
    if (res?.adopted === true) {
      setAdoptState({ ok: true, message: res.message ?? `Adopted ${candId}` })
    } else {
      setAdoptState({
        ok: false,
        message:
          res?.message ??
          (zh
            ? `未能应用候选 ${candId}（请确认主工作区干净且候选仍在有效期内）。`
            : `Failed to adopt candidate ${candId}; check for local uncommitted changes.`),
      })
    }
  }

  const cellHighlight = (candId: string): string => {
    if (candId === baseId) return ' base'
    if (arena?.baseDisagreement && candId === arena.recommendedBase) return ' judge-rec'
    return ''
  }

  return (
    <div>
      {arena ? (
        <div>
          <div className="pstack-hero-head">
            <div>
              <h2>Arena</h2>
              <p>{arena.task}</p>
            </div>
          </div>

          <div className="pstack-table-wrap" style={{ marginTop: 12 }}>
            <table className="pstack-table pstack-matrix">
              <thead>
                <tr>
                  <th />
                  {arena.candidates.map((c) => (
                    <th key={c.id} className={`cand c${cellHighlight(c.id)}`}>
                      {c.sessionId && rpc.openSession ? (
                        <button
                          type="button"
                          className="pstack-btn"
                          style={{ padding: '1px 6px' }}
                          title={zh ? '打开候选子会话' : 'Open candidate session'}
                          onClick={() => rpc.openSession?.(c.sessionId!)}
                        >
                          <b>{c.id}</b>
                        </button>
                      ) : (
                        <b>{c.id}</b>
                      )}
                      <span>{c.model}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {arena.criteria.map((row) => (
                  <tr key={row.criterion}>
                    <td>{row.criterion}</td>
                    {arena.candidates.map((c) => {
                      const score = row.scores[c.id]
                      return (
                        <td key={c.id} className={`c${cellHighlight(c.id)}`}>
                          {typeof score === 'number' ? score : <span style={{ color: 'var(--p-text-tertiary)' }}>–</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                <tr className="sum">
                  <td style={{ color: 'var(--p-text-secondary)', font: '400 12.5px var(--dsw-font-family, sans-serif)' }}>
                    {t('panel.total')}
                  </td>
                  {arena.candidates.map((c) => {
                    const total = arena.totals[c.id]
                    return (
                      <td key={c.id} className={`c${cellHighlight(c.id)}`}>
                        {typeof total === 'number' ? total : <span style={{ color: 'var(--p-text-tertiary)' }}>–</span>}
                      </td>
                    )
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          {arena.judge ? (
            <div className="pstack-note calm">
              {arena.judge.status === 'picked' ? (
                <>
                  <Stamp text={t('panel.cross')} tone="purple" />{' '}
                  {t('panel.judge.picked', {
                    vendor: arena.judge.vendor ?? 'external',
                    model: arena.judge.model ?? '',
                    vs: arena.judge.parentVendor ? ` (${zh ? '主代理是 ' : 'parent: '}${arena.judge.parentVendor})` : '',
                  })}{' '}
                  {arena.judge.rationale ?? ''}
                </>
              ) : arena.judge.status === 'skipped-unknown-parent' ? (
                t('panel.judge.unknown', { model: arena.judge.model ?? '' })
              ) : (
                t('panel.judge.skipped')
              )}
            </div>
          ) : null}

          {arena.shape === 'converged' ? <div className="pstack-note gold">{t('panel.converged')}</div> : null}
          {arena.shape === 'diverged' ? <div className="pstack-note">{t('panel.diverged')}</div> : null}
          {arena.baseDisagreement ? (
            <div className="pstack-note gold">
              {t('panel.disagree', {
                parent: arena.parentChosenBase ?? '?',
                judge: arena.recommendedBase ?? '?',
              })}
            </div>
          ) : null}

          <div className="pstack-acts">
            {arena.candidates
              .filter((c) => c.status === 'submitted')
              .map((c) => (
                <button key={`diff-${c.id}`} type="button" className="pstack-btn" onClick={() => void openDiff(c.id)}>
                  {t('panel.diff', { id: c.id })}
                </button>
              ))}
            {baseId ? (
              <button type="button" className="pstack-btn primary" onClick={() => void adoptBase(baseId)}>
                {t('panel.adopt', { id: baseId })}
              </button>
            ) : null}
          </div>

          {adoptState ? (
            <p
              role={adoptState.ok ? 'status' : 'alert'}
              style={{ fontSize: 12, color: adoptState.ok ? 'var(--p-chive)' : 'var(--p-ketchup)', marginTop: 6 }}
            >
              {adoptState.message}
            </p>
          ) : null}

          {arena.queuedCount > 0 ? (
            <p style={{ color: 'var(--p-text-secondary)', fontSize: 12 }}>{t('panel.queue', { count: arena.queuedCount })}</p>
          ) : null}
        </div>
      ) : null}

      {view.interrogate ? (
        <div style={{ marginTop: arena ? 22 : 0 }}>
          <div className="pstack-sub">
            Interrogate
            <span>
              {t('interrogate.count', {
                verified: view.interrogate.verified.length,
                dropped: view.interrogate.droppedCount,
              })}
            </span>
          </div>
          {view.interrogate.verified.length === 0 ? (
            <p style={{ color: 'var(--p-text-secondary)', fontFamily: 'var(--p-code-font)', fontSize: 12 }}>
              {t('interrogate.empty')}
            </p>
          ) : (
            view.interrogate.verified.map((f, idx) => (
              <div key={idx} className="pstack-finding">
                <div className="pstack-finding-top">
                  <b>{f.title}</b>
                  <span style={{ color: 'var(--p-text-tertiary)', fontSize: 11.5 }}>{f.reviewers.join(', ')}</span>
                  <Stamp text={zh ? '成立' : 'PROVEN'} tone="red" />
                </div>
                <pre className="pstack-pre">{`$ ${f.command}\n${f.output}`}</pre>
              </div>
            ))
          )}
          {view.interrogate.droppedCount > 0 ? (
            <div className="pstack-finding">
              <div className="pstack-finding-top">
                <span style={{ color: 'var(--p-text-secondary)', flex: 1 }}>
                  {view.interrogate.discards
                    .map((d) => {
                      const invalidCount = d.invalidCommand ?? 0
                      return zh
                        ? `${d.reviewerId}: 复跑通过 ${d.commandPassed} 条，缺命令 ${d.missingCommand} 条${invalidCount > 0 ? `，无效命令 ${invalidCount} 条` : ''}`
                        : `${d.reviewerId}: ${d.commandPassed} passed, ${d.missingCommand} missing${invalidCount > 0 ? `, ${invalidCount} invalid` : ''}`
                    })
                    .join(' · ')}
                </span>
                <Stamp text={`${zh ? '丢弃' : 'DROP'} ${view.interrogate.droppedCount}`} tone="mute" />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {view.swarm ? (
        <div style={{ marginTop: 22 }}>
          <div className="pstack-sub">
            Swarm
            <span>{view.swarm.task}</span>
          </div>
          <div className="pstack-table-wrap">
            <table className="pstack-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{zh ? '切片' : 'Slice'}</th>
                  <th>{zh ? '证据' : 'Evidence'}</th>
                  <th className="r">{zh ? '状态' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {view.swarm.slices.map((s) => {
                  const stampCfg =
                    s.outcome === 'PASS'
                      ? { text: 'PASS', tone: 'green' as const, said: true }
                      : s.outcome === 'ISSUES'
                        ? { text: 'ISSUES', tone: 'gold' as const, said: true }
                        : s.outcome === 'BLOCKED'
                          ? { text: 'BLOCKED', tone: 'red' as const, said: true }
                          : s.outcome === 'redispatched'
                            ? { text: zh ? '重派' : 'RETRY', tone: 'purple' as const, said: false }
                            : { text: zh ? '缺口' : 'GAP', tone: 'red' as const, said: false }
                  const isHexSha = Boolean(s.sha && /^[0-9a-f]{7,40}$/i.test(s.sha))
                  return (
                    <tr key={s.index}>
                      <td style={{ color: 'var(--p-text-tertiary)' }}>{s.index}</td>
                      <td>
                        {s.label}
                        {s.approach ? <div style={{ color: 'var(--p-text-secondary)', fontSize: 11.5 }}>{s.approach}</div> : null}
                      </td>
                      <td>
                        {s.sha ? (
                          isHexSha ? (
                            <button
                              type="button"
                              className="pstack-btn"
                              style={{ padding: '1px 6px', fontFamily: 'var(--p-code-font)', fontSize: 11.5 }}
                              onClick={() => void openSwarmSha(s.sha!)}
                            >
                              {s.sha}
                            </button>
                          ) : (
                            <code>{s.sha}</code>
                          )
                        ) : (
                          <span style={{ color: 'var(--p-text-tertiary)' }}>–</span>
                        )}
                      </td>
                      <td className="r">
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                          {(s.retries ?? 0) > 0 && s.outcome !== 'redispatched' ? (
                            <Stamp text={zh ? '重派过' : 'RETRIED'} tone="purple" />
                          ) : null}
                          <Stamp text={stampCfg.text} tone={stampCfg.tone} said={stampCfg.said} />
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {diffModal ? (
        <div className="pstack-finding" style={{ marginTop: 12 }}>
          <div className="pstack-finding-top">
            <b>{diffModal.title}</b>
            <button type="button" className="pstack-btn" onClick={() => setDiffModal(null)}>
              ×
            </button>
          </div>
          <pre className="pstack-pre" style={diffModal.isError ? { color: 'var(--p-ketchup)' } : undefined}>
            {diffModal.diff}
          </pre>
        </div>
      ) : null}
    </div>
  )
}

export function BenchChart({ bench, zh }: { readonly bench: BenchView; readonly zh: boolean }): React.JSX.Element {
  const W = 416
  const H = 196
  const L = 42
  const R = 14
  const T = 16
  const B = 24
  const allValues = [
    bench.baseline,
    bench.targetValue,
    ...bench.attempts.flatMap((a) => [a.after - a.noise, a.after + a.noise]),
  ].filter(Number.isFinite)
  const rawMin = allValues.length > 0 ? Math.min(...allValues) : 0
  const rawMax = allValues.length > 0 ? Math.max(...allValues) : 1
  const pad = Math.max(Math.abs(rawMax - rawMin) * 0.15, Math.abs(bench.baseline) * 0.05, 1)
  const lo = rawMin < 0 ? Math.floor(rawMin - pad) : Math.max(0, Math.floor(rawMin - pad))
  const hi = Math.max(lo + 1, Math.ceil(rawMax + pad))
  const span = Math.max(1, hi - lo)

  const slots = Math.max(bench.attempts.length, 6)
  const x = (i: number) => L + (i * (W - L - R)) / slots
  const y = (val: number) => T + ((hi - val) * (H - T - B)) / span

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round((lo + f * span) * 10) / 10)
  let level = bench.baseline
  let stepPath = `M ${x(0)} ${y(bench.baseline)}`
  if (bench.attempts.length === 0) {
    stepPath += ` H ${x(1)}`
  } else {
    bench.attempts.forEach((a, i) => {
      if (a.kept) level = a.after
      stepPath += ` H ${x(i + 1)} V ${y(level)}`
    })
  }

  const clampedTargetY = Math.min(H - B, Math.max(T, y(bench.targetValue)))
  const targetBandTop = bench.direction === 'lower' ? clampedTargetY : T
  const targetBandHeight =
    bench.direction === 'lower' ? Math.max(0, H - B - clampedTargetY) : Math.max(0, clampedTargetY - T)

  const best = bench.attempts.reduce((val, a) => (a.kept ? a.after : val), bench.baseline)
  const ariaLabel = zh
    ? `${bench.metricName} 实验折线图：基线 ${bench.baseline}，当前最佳 ${best}，共 ${bench.attempts.length} 次尝试`
    : `${bench.metricName} benchmark chart: baseline ${bench.baseline}, current best ${best}, ${bench.attempts.length} attempts`

  return (
    <svg className="pstack-chart" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={ariaLabel} style={{ marginTop: 10 }}>
      <defs>
        <clipPath id="pstack-bench-clip">
          <rect x={L - 2} y={T - 6} width={W - L - R + 4} height={H - T - B + 12} />
        </clipPath>
      </defs>
      {ticks.map((tk, idx) => (
        <g key={`${idx}-${tk}`}>
          <line x1={L} x2={W - R} y1={y(tk)} y2={y(tk)} stroke="var(--p-border-l1)" />
          <text x={L - 6} y={y(tk) + 3} textAnchor="end">
            {tk}
          </text>
        </g>
      ))}
      <g clipPath="url(#pstack-bench-clip)">
        <rect x={L} y={targetBandTop} width={W - L - R} height={targetBandHeight} fill="var(--p-gold-wash)" />
        <line
          x1={L}
          x2={W - R}
          y1={y(bench.baseline)}
          y2={y(bench.baseline)}
          stroke="var(--p-border-l3)"
          strokeDasharray="2 3"
        />
        <path d={stepPath} fill="none" stroke="var(--p-gold-edge)" strokeWidth="2" />
        {bench.attempts.map((a, i) => {
          const cx = x(i + 1)
          const cy = y(a.after)
          return (
            <g key={a.index}>
              <line
                x1={cx}
                x2={cx}
                y1={y(a.after + a.noise)}
                y2={y(a.after - a.noise)}
                stroke="var(--p-text-secondary)"
              />
              {a.kept ? (
                <circle cx={cx} cy={cy} r="4.5" fill="var(--p-gold)" stroke="var(--p-gold-edge)" strokeWidth="1.5" />
              ) : (
                <circle cx={cx} cy={cy} r="4" fill="var(--p-bg-base)" stroke="var(--p-text-secondary)" strokeWidth="1.5" />
              )}
            </g>
          )
        })}
      </g>
      <text x={W - R} y={Math.min(H - B - 2, Math.max(T + 10, clampedTargetY + (bench.direction === 'lower' ? 12 : -4)))} textAnchor="end">
        {zh ? `目标 ${bench.targetValue}` : `target ${bench.targetValue}`}
      </text>
      <text x={W - R} y={Math.min(H - B - 2, Math.max(T + 10, y(bench.baseline) - 5))} textAnchor="end">
        {zh ? `基线 ${bench.baseline}` : `baseline ${bench.baseline}`}
      </text>
      {bench.attempts.map((a, i) => (
        <text key={`lbl-${a.index}`} x={x(i + 1)} y={H - 6} textAnchor="middle">
          {a.index}
        </text>
      ))}
    </svg>
  )
}

function selfCheckStampTone(flag: boolean | undefined): 'gold' | 'red' | 'mute' {
  if (flag === true) return 'gold'
  if (flag === false) return 'red'
  return 'mute'
}

function BenchPane({ view, t }: { readonly view: PstackView; readonly t: PstackTranslate }): React.JSX.Element {
  const bench = view.bench
  const zh = isChineseLocale()
  if (!bench) {
    return <p style={{ color: 'var(--p-text-secondary)' }}>{t('bench.empty')}</p>
  }

  const best = bench.attempts.reduce((val, a) => (a.kept ? a.after : val), bench.baseline)
  const vsBaselinePct = formatSignedPct(bench.baseline, best)
  const keptCount = bench.attempts.filter((a) => a.kept).length
  const drifted = bench.driftedFiles.length > 0
  const reasonMap = zh ? REVERT_LABELS_ZH : REVERT_LABELS_EN

  return (
    <div>
      <div className="pstack-hero-head">
        <div>
          <h2>{bench.metricName}</h2>
          <p>
            {zh
              ? `${bench.direction === 'lower' ? '越低越好' : '越高越好'}，每次取 ${bench.minSamples} 个样本的中位数`
              : `${bench.direction === 'lower' ? 'Lower is better' : 'Higher is better'}, median of ${bench.minSamples} samples`}
          </p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <Stamp text={drifted ? t('bench.drifted') : t('bench.frozen')} tone={drifted ? 'red' : 'mute'} />
        </div>
      </div>

      {bench.checklist ? (
        <div className="pstack-checklist">
          <Stamp text={zh ? '0 报错' : '0 ERR'} tone={bench.checklist.zeroErrors ? 'green' : 'red'} />
          <Stamp text={zh ? '样本够' : 'N OK'} tone={bench.checklist.enoughSamples ? 'green' : 'red'} />
          <Stamp text={zh ? '计工作量' : 'WORK'} tone={bench.checklist.workCounted ? 'green' : 'mute'} />
          <Stamp
            text={`${zh ? '代表负载' : 'REAL'}${bench.checklist.representative === undefined ? '?' : ''}`}
            tone={selfCheckStampTone(bench.checklist.representative)}
            said
          />
          <Stamp
            text={`${zh ? '稳态' : 'WARM'}${bench.checklist.steadyState === undefined ? '?' : ''}`}
            tone={selfCheckStampTone(bench.checklist.steadyState)}
            said
          />
          <Stamp
            text={`${zh ? '低噪' : 'QUIET'}${bench.checklist.isolatedNoise === undefined ? '?' : ''}`}
            tone={selfCheckStampTone(bench.checklist.isolatedNoise)}
            said
          />
          <Stamp text={zh ? '有门禁' : 'GATE'} tone={bench.checklist.gateNamed ? 'gold' : 'mute'} said />
        </div>
      ) : null}

      <BenchChart bench={bench} zh={zh} />

      <div className="pstack-bigstats">
        <div>
          <span style={{ color: 'var(--p-text-secondary)', fontSize: 12 }}>{t('bench.gain')}</span>
          <b>
            {vsBaselinePct ?? (best === bench.baseline ? '0' : `${best - bench.baseline > 0 ? '+' : '−'}${Math.abs(best - bench.baseline)}`)}{' '}
            <small>
              {zh ? '目标 ' : 'goal '}
              {bench.direction === 'lower' ? '−' : '+'}
              {Math.round(bench.targetRelativeGain * 100)}%
            </small>
          </b>
        </div>
        <div>
          <span style={{ color: 'var(--p-text-secondary)', fontSize: 12 }}>{t('bench.tries')}</span>
          <b>
            {bench.attempts.length} <small>{zh ? `至少 ${bench.minAttempts}` : `min ${bench.minAttempts}`}</small>
          </b>
        </div>
        <div>
          <span style={{ color: 'var(--p-text-secondary)', fontSize: 12 }}>{t('bench.kept')}</span>
          <b>
            {keptCount} <small>{zh ? '保留' : 'kept'}</small> {bench.attempts.length - keptCount}{' '}
            <small>{zh ? '回滚' : 'rev'}</small>
          </b>
        </div>
      </div>

      {bench.plateau ? <div className="pstack-note gold">{t('bench.plateau')}</div> : null}
      {bench.met ? (
        <div className="pstack-note calm">
          <Stamp text={zh ? '达标' : 'MET'} tone="gold" /> {t('bench.met')}
        </div>
      ) : null}

      {bench.attempts.length > 0 ? (
        <div className="pstack-table-wrap" style={{ marginTop: 14 }}>
          <table className="pstack-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{zh ? '假设' : 'Hypothesis'}</th>
                <th className="r">{zh ? '前' : 'Before'}</th>
                <th className="r">{zh ? '后' : 'After'}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...bench.attempts].reverse().map((a) => {
                const signed = formatSignedPct(a.before, a.after)
                return (
                  <tr key={a.index}>
                    <td style={{ color: 'var(--p-text-tertiary)' }}>{a.index}</td>
                    <td>{a.hypothesis}</td>
                    <td className="r">{a.before}</td>
                    <td className="r">{a.after}</td>
                    <td>
                      {a.kept ? (
                        <Stamp text={`${zh ? '保留' : 'KEPT'}${signed ? ` ${signed}` : ''}`} tone="gold" />
                      ) : (
                        <>
                          <Stamp
                            text={zh ? '回滚' : 'REV'}
                            tone={a.revertReason === 'work-changed' || a.revertReason === 'harness-drift' ? 'red' : 'mute'}
                          />{' '}
                          <span style={{ color: 'var(--p-text-secondary)', fontSize: 11.5 }}>
                            {a.revertReason ? reasonMap[a.revertReason] : ''}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function LedgerPane({
  view,
  sessionId,
  rpc,
  t,
}: {
  readonly view: PstackView
  readonly sessionId: string | undefined
  readonly rpc: PstackRpcCaller
  readonly t: PstackTranslate
}): React.JSX.Element {
  const zh = isChineseLocale()
  const [commitPreview, setCommitPreview] = React.useState<{ sha: string; diff: string; isError: boolean } | null>(null)

  const exportTsv = async () => {
    const remote = await rpc.call<{ available?: boolean; tsv?: string }>('exportLedger', { sessionId })
    const content =
      remote?.available === true && typeof remote.tsv === 'string' && remote.tsv.length > 0
        ? remote.tsv
        : DECISION_HEADER + view.ledger.rows.map((r) => formatRow(r)).join('')
    if (typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function' || typeof document === 'undefined') {
      return
    }
    const blob = new Blob([content], { type: 'text/tab-separated-values;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `decisions-${sessionId ?? 'session'}.tsv`
    document.body?.appendChild?.(link)
    link.click?.()
    link.remove?.()
    URL.revokeObjectURL(url)
  }

  const openCommit = async (sha: string) => {
    const res = await rpc.call<{ ok?: boolean; diff?: string }>('commitDiff', { sessionId, sha })
    setCommitPreview({
      sha,
      diff:
        res?.ok && res.diff
          ? res.diff
          : zh
            ? `无法读取提交 ${sha} 的详情。`
            : `Could not load git show for ${sha}.`,
      isError: !res?.ok,
    })
  }

  const renderEvidence = (ev: string) => {
    const trimmed = ev.trim()
    if (trimmed === '') return <Stamp text={zh ? '缺' : 'LACKS'} tone="red" />

    const subagentMatch = /^(?:subagent|session):([A-Za-z0-9_.:-]+)$/i.exec(trimmed)
    if (subagentMatch && rpc.openSession) {
      const targetId = subagentMatch[1] as string
      return (
        <button
          type="button"
          className="pstack-btn"
          style={{ padding: '1px 6px', fontFamily: 'var(--p-code-font)', fontSize: 11.5 }}
          onClick={() => rpc.openSession?.(targetId)}
        >
          {trimmed}
        </button>
      )
    }

    const shaMatch = /^(?:commit\s+)?([0-9a-f]{7,40})$/i.exec(trimmed)
    if (shaMatch && sessionId) {
      const sha = shaMatch[1] as string
      return (
        <button
          type="button"
          className="pstack-btn"
          style={{ padding: '1px 6px', fontFamily: 'var(--p-code-font)', fontSize: 11.5 }}
          onClick={() => void openCommit(sha)}
        >
          {trimmed}
        </button>
      )
    }

    const fileMatch = /^([A-Za-z0-9_./@+-]+\.[A-Za-z0-9]+)(?::(\d+))?$/.exec(trimmed)
    if (fileMatch && rpc.openFile) {
      const filePath = fileMatch[1] as string
      const segments = filePath.split('/')
      if (!filePath.startsWith('/') && !segments.includes('..')) {
        const line = fileMatch[2] ? Number.parseInt(fileMatch[2], 10) : undefined
        return (
          <button
            type="button"
            className="pstack-btn"
            style={{ padding: '1px 6px', fontFamily: 'var(--p-code-font)', fontSize: 11.5 }}
            onClick={() => rpc.openFile?.(filePath, line)}
          >
            {trimmed}
          </button>
        )
      }
    }

    return <code>{trimmed}</code>
  }

  const stackSplit = view.autopilot ? contiguousLandablePrefix(view.autopilot.stack) : null

  return (
    <div>
      <div className="pstack-hero-head">
        <div>
          <h2>{t('ledger.title')}</h2>
          <p>{t('ledger.desc')}</p>
        </div>
        {view.ledger.rows.length > 0 ? (
          <button type="button" className="pstack-btn" style={{ marginLeft: 'auto' }} onClick={() => void exportTsv()}>
            {t('ledger.export')}
          </button>
        ) : null}
      </div>

      {view.ledger.rows.length === 0 ? (
        <p style={{ color: 'var(--p-text-secondary)', marginTop: 14 }}>{t('ledger.empty')}</p>
      ) : (
        <div className="pstack-table-wrap" style={{ marginTop: 12 }}>
          <table className="pstack-table">
            <thead>
              <tr>
                <th>{zh ? '阶段' : 'Phase'}</th>
                <th>{zh ? '决定' : 'Decision'}</th>
                <th>{zh ? '证据' : 'Evidence'}</th>
                <th>{zh ? '结果' : 'Result'}</th>
              </tr>
            </thead>
            <tbody>
              {view.ledger.rows.map((row, idx) => (
                <tr
                  key={idx}
                  style={row.runStart ? { borderTop: '2px solid var(--p-gold-edge)' } : undefined}
                >
                  <td style={{ color: 'var(--p-text-secondary)' }}>{row.phase}</td>
                  <td>
                    {row.decision}
                    {row.why ? <div style={{ color: 'var(--p-text-secondary)', fontSize: 11.5 }}>{row.why}</div> : null}
                  </td>
                  <td>{row.phase === 'start' && row.evidence === '' ? '–' : renderEvidence(row.evidence)}</td>
                  <td>{row.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {commitPreview ? (
        <div className="pstack-finding" style={{ marginTop: 10 }}>
          <div className="pstack-finding-top">
            <b>Commit {commitPreview.sha}</b>
            <button type="button" className="pstack-btn" onClick={() => setCommitPreview(null)}>
              ×
            </button>
          </div>
          <pre className="pstack-pre" style={commitPreview.isError ? { color: 'var(--p-ketchup)' } : undefined}>
            {commitPreview.diff}
          </pre>
        </div>
      ) : null}

      {view.ledger.attention ? (
        <>
          <div className="pstack-sub">
            Attention
            <span>
              {zh
                ? `由 ${view.ledger.attention.reviewerVendor} 的 ${view.ledger.attention.reviewerModel} 复核`
                : `Reviewed by ${view.ledger.attention.reviewerVendor}/${view.ledger.attention.reviewerModel}`}
            </span>
          </div>
          <div className="pstack-note calm">{view.ledger.attention.note}</div>
        </>
      ) : null}

      {view.ledger.missingEvidenceIndices.length > 0 ? (
        <div className="pstack-note">
          {t('ledger.missing', { rows: view.ledger.missingEvidenceIndices.join(', ') })}
        </div>
      ) : null}

      {view.autopilot ? (
        <div style={{ marginTop: 22 }}>
          <div className="pstack-sub">
            Autopilot
            <span>{view.autopilot.mode ? `mode: ${view.autopilot.mode}` : ''}</span>
          </div>
          {stackSplit && view.autopilot.stack.length > 0 ? (
            <div className="pstack-table-wrap">
              <table className="pstack-table">
                <tbody>
                  {stackSplit.landable.map((pr) => (
                    <tr key={pr.number} style={{ background: 'var(--p-gold-wash)' }}>
                      <td>#{pr.number}</td>
                      <td>{pr.title}</td>
                      <td className="r">
                        <Stamp text={zh ? '可落地' : 'LAND'} tone="gold" />
                      </td>
                    </tr>
                  ))}
                  {stackSplit.waiting.map((pr) => (
                    <tr key={pr.number}>
                      <td>#{pr.number}</td>
                      <td>{pr.title}</td>
                      <td className="r">
                        <Stamp text={pr.status} tone="mute" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {view.autopilot.replacements.map((rep, i) => (
            <div key={i} className="pstack-note calm">
              <Stamp text={zh ? '已替换' : 'SWAP'} tone="purple" /> {rep.target}: {rep.oldSessionId ?? '?'} →{' '}
              {rep.newSessionId ?? 'fresh'} ({rep.reason})
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function PstackSidebarPane({
  view,
  sessionId,
  inputActions,
  rpc,
  t = fallbackT,
}: {
  readonly view: PstackView
  readonly sessionId: string | undefined
  readonly inputActions?: DshInputActions | undefined
  readonly rpc: PstackRpcCaller
  readonly t?: PstackTranslate | undefined
}): React.JSX.Element {
  const [tab, setTab] = useRightPaneSubtab()

  const tabs: { id: RightPaneSubtab; label: string; dot?: 'gold' | 'red' | 'purple' }[] = [
    { id: 'playbook', label: t('seg.playbook'), ...(view.flaggedPrinciples.length > 0 ? { dot: 'red' as const } : {}) },
    { id: 'panel', label: t('seg.panel'), ...(view.arena || view.interrogate || view.swarm ? { dot: 'purple' as const } : {}) },
    { id: 'bench', label: t('seg.bench'), ...(view.bench ? { dot: 'gold' as const } : {}) },
    { id: 'ledger', label: t('seg.ledger'), ...(view.ledger.missingEvidenceIndices.length > 0 ? { dot: 'red' as const } : {}) },
  ]

  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIdx: number) => {
    let nextIdx: number | undefined
    if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % tabs.length
    else if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') nextIdx = 0
    else if (e.key === 'End') nextIdx = tabs.length - 1
    if (nextIdx === undefined) return
    e.preventDefault()
    const target = tabs[nextIdx]
    if (!target) return
    setTab(target.id)
    if (typeof document !== 'undefined') {
      document.getElementById?.(`pstack-tab-${target.id}`)?.focus?.()
    }
  }

  return (
    <div className="pstack-pane-root">
      <div className="pstack-seg" role="tablist">
        {tabs.map((item, idx) => (
          <button
            key={item.id}
            id={`pstack-tab-${item.id}`}
            type="button"
            role="tab"
            tabIndex={tab === item.id ? 0 : -1}
            aria-selected={tab === item.id}
            aria-controls={`pstack-tabpanel-${item.id}`}
            onClick={() => setTab(item.id)}
            onKeyDown={(e) => onTabKeyDown(e, idx)}
          >
            {item.label}
            {item.dot ? <span className={`pstack-lamp ${item.dot}`} /> : null}
          </button>
        ))}
      </div>
      <div
        className="pstack-pane-scroll"
        role="tabpanel"
        id={`pstack-tabpanel-${tab}`}
        aria-labelledby={`pstack-tab-${tab}`}
      >
        {tab === 'playbook' ? (
          <PlaybookPane
            view={view}
            sessionId={sessionId}
            {...(inputActions ? { inputActions } : {})}
            rpc={rpc}
            t={t}
          />
        ) : null}
        {tab === 'panel' ? <PanelPane view={view} sessionId={sessionId} rpc={rpc} t={t} /> : null}
        {tab === 'bench' ? <BenchPane view={view} t={t} /> : null}
        {tab === 'ledger' ? <LedgerPane view={view} sessionId={sessionId} rpc={rpc} t={t} /> : null}
      </div>
    </div>
  )
}
