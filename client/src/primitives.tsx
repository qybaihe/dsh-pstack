/**
 * Core visual primitives from `docs/03-ui.md`:
 * - `<Potato>`: object (never a mascot) whose skin, crown, and ketchup dab encode state.
 * - `<Fries>`: step sticks slightly tilted, raw -> half-fried -> golden.
 * - `<Eyes>`: 24 leaf principles grouped into Core, Architecture, Verification, Delegation, Meta.
 * - `<Stamp>`: tilted verdict badge (solid = runtime, dashed = agent-reported).
 * - Session-scoped preview store & right-pane subtab navigation store.
 */

import * as React from 'react'
import { PRINCIPLE_CATALOG, PRINCIPLE_GROUPS } from '../../src/core/catalog.ts'
import { summarizePstackView } from '../../src/core/projection.ts'
import type { PlaybookStepView, PstackSummaryView, PstackView, StampTone } from '../../src/core/projection.ts'
import { isChineseLocale } from './i18n.ts'

export type RightPaneSubtab = 'playbook' | 'panel' | 'bench' | 'ledger'

/** Exact public `InputActions` contract passed by `@deepseek-ai/dsh-client-ui-conversation` to every session-scoped slot. */
export interface DshInputActions {
  setDraft?(text: string): void
  submit?(): void
  captureInsertion?(): unknown
  insertText?(text: string, span?: unknown): boolean
  persistDraft?(): void
  /** Legacy test alias */
  setText?(text: string): void
}

function focusComposerEditor(): void {
  if (typeof document === 'undefined') return
  try {
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"], [contenteditable="true"]')
    if (!editor) return
    editor.focus()
    const sel = typeof window !== 'undefined' ? window.getSelection() : null
    if (sel) {
      const range = document.createRange()
      range.selectNodeContents(editor)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    }
  } catch {
    // Ignore DOM selection errors in headless test environments.
  }
}

/** Write text into the session composer via DSH's real `inputActions.setDraft` and optionally submit immediately. */
export function applyComposerDraft(
  inputActions: DshInputActions | undefined,
  text: string,
  options?: { readonly submit?: boolean },
): boolean {
  if (inputActions === undefined) return false
  let applied = false
  if (typeof inputActions.setDraft === 'function') {
    inputActions.setDraft(text)
    applied = true
  } else if (typeof inputActions.setText === 'function') {
    inputActions.setText(text)
    applied = true
  } else if (typeof inputActions.insertText === 'function') {
    const span = typeof inputActions.captureInsertion === 'function' ? inputActions.captureInsertion() : undefined
    applied = inputActions.insertText(text, span) !== false
  }
  if (!applied) return false
  if (options?.submit === true && typeof inputActions.submit === 'function') {
    inputActions.submit()
  } else {
    setTimeout(focusComposerEditor, 0)
  }
  return true
}

let desiredSubtab: RightPaneSubtab = 'playbook'
const subtabListeners = new Set<() => void>()

export function selectRightPaneSubtab(tab: RightPaneSubtab): void {
  desiredSubtab = tab
  for (const fn of subtabListeners) fn()
}

export function useRightPaneSubtab(): [RightPaneSubtab, (tab: RightPaneSubtab) => void] {
  const [tab, setTab] = React.useState<RightPaneSubtab>(desiredSubtab)
  React.useEffect(() => {
    const sync = () => setTab(desiredSubtab)
    subtabListeners.add(sync)
    return () => {
      subtabListeners.delete(sync)
    }
  }, [])
  return [
    tab,
    (next: RightPaneSubtab) => {
      selectRightPaneSubtab(next)
    },
  ]
}

const DRAFT_PREVIEW_KEY = '__draft__'
const previewPlaybookBySession = new Map<string, string | null>()
const previewListeners = new Set<() => void>()

function previewKey(sessionId?: string | undefined): string {
  return sessionId && sessionId !== '' ? sessionId : DRAFT_PREVIEW_KEY
}

export function selectPreviewPlaybook(slug: string | null, sessionId?: string | undefined): void {
  previewPlaybookBySession.set(previewKey(sessionId), slug)
  for (const fn of previewListeners) fn()
}

export function usePreviewPlaybook(
  sessionId?: string | undefined,
): [string | null, (slug: string | null) => void] {
  const key = previewKey(sessionId)
  const [slug, setSlug] = React.useState<string | null>(() => previewPlaybookBySession.get(key) ?? null)
  React.useEffect(() => {
    setSlug(previewPlaybookBySession.get(key) ?? null)
    const sync = () => setSlug(previewPlaybookBySession.get(key) ?? null)
    previewListeners.add(sync)
    return () => {
      previewListeners.delete(sync)
    }
  }, [key])
  return [slug, (next: string | null) => selectPreviewPlaybook(next, sessionId)]
}

export interface PotatoProps {
  readonly crowned?: boolean | undefined
  readonly golden?: boolean | undefined
  readonly ketchup?: boolean | undefined
  readonly size?: 'sm' | 'md' | 'lg' | undefined
}

export function Potato({ crowned = false, golden = false, ketchup = false, size = 'md' }: PotatoProps): React.JSX.Element {
  const cls = size === 'sm' ? 'pstack-potato sm' : size === 'lg' ? 'pstack-potato lg' : 'pstack-potato'
  const skin = golden ? 'var(--p-gold)' : 'var(--p-skin)'
  const ink = golden ? 'var(--p-gold-edge)' : 'var(--p-russet)'
  return (
    <svg className={cls} viewBox="0 0 32 34" aria-hidden="true">
      {crowned ? (
        <path
          d="M7.5 14.5 6.6 5.2 9.8 8l2.7-4.8L15.2 8l3.2-2.8-.9 9.3z"
          transform="rotate(-9 12.5 12)"
          fill="var(--p-gold)"
          stroke="var(--p-gold-edge)"
          strokeWidth="1.2"
          strokeLinejoin="round"
        />
      ) : null}
      <path
        d="M5 17.4c1-3.6 4.2-6.3 7.6-6.2 2.2.1 3.4 1.7 5.6 1.8 1.8.1 3-.8 5-.5 3.9.6 6.4 4.5 6 8.9-.5 5.4-5.6 9-11.4 9.4-5.4.4-10.9-1.7-12.7-6.2-1-2.4-.8-4.9-.1-7.2z"
        fill={skin}
        stroke={ink}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <g fill="none" stroke={ink} strokeWidth="1.3" strokeLinecap="round">
        <path d="M8.6 20.8q1.2-1.1 2.5-.2" />
        <path d="M16.3 16.2q1.1 1.1 2.4.3" />
        <path d="M13.3 25.9q1.3-.9 2.6.1" />
      </g>
      <circle cx="23.4" cy="18.8" r=".8" fill={ink} />
      {ketchup ? (
        <path
          d="M22.2 23.6c1.6-2.2 5.2-2 6.6.4 1.5 2.6-.2 6-3.2 6.2-3 .2-5.2-3.6-3.4-6.6z"
          fill="var(--p-ketchup)"
        />
      ) : null}
    </svg>
  )
}

export function Fries({ steps }: { readonly steps: readonly PlaybookStepView[] }): React.JSX.Element | null {
  if (steps.length === 0) return null
  return (
    <span className="pstack-fries" aria-hidden="true">
      {steps.map((step) => {
        const cls = step.status === 'completed' ? 'done' : step.status === 'in_progress' ? 'now' : ''
        return <i key={step.index} className={cls} title={`${step.index}. ${step.label}`} />
      })}
    </span>
  )
}

export interface StampProps {
  readonly text: string
  readonly tone?: StampTone | undefined
  readonly said?: boolean | undefined
  readonly land?: boolean | undefined
  readonly title?: string | undefined
}

export function Stamp({ text, tone = 'mute', said = false, land = false, title }: StampProps): React.JSX.Element {
  const classes = ['pstack-stamp', tone, said ? 'said' : '', land ? 'land' : ''].filter(Boolean).join(' ')
  const zh = isChineseLocale()
  const defaultTitle = said
    ? zh
      ? '代理自报（虚线章）'
      : 'Reported by agent (dashed)'
    : zh
      ? '运行时实证（实线章）'
      : 'Verified by runtime (solid)'
  return (
    <span className={classes} title={title ?? defaultTitle}>
      {text}
    </span>
  )
}

export function PrincipleEyes({
  readPrinciples,
  flaggedPrinciples,
}: {
  readonly readPrinciples: readonly string[]
  readonly flaggedPrinciples: readonly string[]
}): React.JSX.Element {
  const readSet = new Set(readPrinciples)
  const flagSet = new Set(flaggedPrinciples)
  const zh = isChineseLocale()

  return (
    <div>
      {PRINCIPLE_GROUPS.map((group) => {
        const items = PRINCIPLE_CATALOG.filter((p) => p.group === group.id)
        return (
          <div key={group.id} className="pstack-prow">
            <span style={{ color: 'var(--p-text-secondary)' }}>{zh ? group.labelZh : group.labelEn}</span>
            <span className="pstack-eyes">
              {items.map((p) => {
                const cls = flagSet.has(p.name) ? 'flag' : readSet.has(p.name) ? 'read' : ''
                return <i key={p.name} className={cls} title={`${p.title} (${p.name})`} />
              })}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function readPstackView(raw: unknown): PstackView | undefined {
  if (typeof raw !== 'object' || raw === null || (raw as { v?: unknown }).v !== 1) return undefined
  if ((raw as { mode?: unknown }).mode !== 'off' && (raw as { mode?: unknown }).mode !== 'on') return undefined
  return raw as PstackView
}

export function readPstackSummaryView(raw: unknown): PstackSummaryView | undefined {
  if (typeof raw !== 'object' || raw === null || (raw as { v?: unknown }).v !== 1) return undefined
  if (typeof (raw as { active?: unknown }).active !== 'boolean') return undefined
  return raw as PstackSummaryView
}

export function summaryFromFullView(view: PstackView | undefined): PstackSummaryView | undefined {
  return view === undefined ? undefined : summarizePstackView(view)
}

export function hasActivePstackSignal(view: PstackView | undefined): boolean {
  if (view === undefined) return false
  return (
    view.mode === 'on' ||
    view.playbook !== null ||
    view.tdd.phase !== 'off' ||
    view.guard.blocks > 0 ||
    view.pendingKetchupCount > 0 ||
    (view.guard.pendingApprovals ?? 0) > 0 ||
    view.arena !== null ||
    view.interrogate !== null ||
    view.swarm !== null ||
    view.bench !== null ||
    view.ledger.rows.length > 0 ||
    view.sicko !== null ||
    view.autopilot !== null
  )
}
