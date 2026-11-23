/**
 * Browser client entry (`@qybaihe/dsh-pstack/client`), bundled by
 * `scripts/build-client.mjs` into `lib/client.js` using DSH's
 * `window.__ModuleLoader__.load({ id, factory(require) })` format.
 *
 * Mounts all UI surfaces planned in `docs/03-ui.md` against DSH's exact slot,
 * standard-prop (`sessionId`, `inputActions`, `useProjection`, `useSessions`),
 * and theme (`body` / `body[data-ds-dark-theme]`) contracts without importing
 * `@deepseek-ai/dsh-client-ui-primitives` or covering any host built-in card.
 */

import * as React from 'react'
import { EMPTY_PSTACK_VIEW } from '../../src/core/projection.ts'
import type { PstackSummaryView } from '../../src/core/projection.ts'
import {
  ArenaToolCard,
  AttemptToolCard,
  BenchFreezeToolCard,
  HeroPlaybookPicker,
  InterrogateToolCard,
  KetchupToolCard,
  PlaybookDock,
  PotetoModeBadge,
  PstackHeaderButton,
  SessionRowHover,
  SessionRowTrailing,
  SickoToolCard,
  SwarmToolCard,
  selectRightPaneSubtab,
} from './cards.tsx'
import type { KetchupDecisionResult } from './cards.tsx'
import { BundleActivationCard, GuardRowConfigPage, PanelRowConfigPage } from './config-pages.tsx'
import type { ConfigFormProp } from './config-pages.tsx'
import { PSTACK_DICT, PSTACK_NS, createBoundTranslate } from './i18n.ts'
import type { PstackTranslate } from './i18n.ts'
import { Potato, readPstackSummaryView, readPstackView, summaryFromFullView } from './primitives.tsx'
import type { DshInputActions, RightPaneSubtab } from './primitives.tsx'
import { PstackSidebarPane } from './right-pane.tsx'
import type { PstackRpcCaller } from './right-pane.tsx'
import { PSTACK_CSS } from './styles.ts'

const PACKAGE_ID = '@qybaihe/dsh-pstack'
const TAB_KIND = 'pstack'

interface SidebarRightControllerLike {
  openTab?(kind: string, options?: unknown): void
  openTabIn?(sessionId: string, kind: string, options?: unknown): void
  openResource?(address: string, options?: unknown): void
  openResourceIn?(sessionId: string, address: string, options?: unknown): void
  active?(): { kind?: string } | undefined
  isExpanded?(): boolean
  toggleExpanded?(): void
}

interface SidebarRightTabsLike {
  register(def: {
    id: string
    kind: string
    keepMounted?: boolean
    title: (address?: string) => string
    guide?: readonly {
      id: string
      order: number
      title: () => string
      description?: () => string
      icon?: React.ComponentType<any>
    }[]
  }): () => void
}

interface SessionsClientServiceLike {
  scope?(sessionId: string):
    | {
        conversation?: {
          send?(prompt: string): Promise<unknown>
        }
      }
    | undefined
}

interface UiWorkspaceLike {
  openSession?(sessionId: string): void
}

interface ClientContext {
  effect(fn: () => (() => void) | void, label?: string): void
  get<T = unknown>(name: string): T | undefined
  inject?(services: readonly string[], callback: (inner: ClientContext) => void): unknown
  locale: {
    register(ns: string, dict: Record<string, Record<string, string>>): () => void
    bind?(ns: string): (key: string, vars?: Record<string, string | number>) => string
  }
  slots: {
    inject(slotName: string, fn: () => unknown): () => void
    register(options: Record<string, unknown>, component: React.ComponentType<any>): () => void
  }
}

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  // 1. Bilingual dictionary & host-theme-adaptive stylesheet
  ctx.effect(() => ctx.locale.register(PSTACK_NS, PSTACK_DICT), 'pstack: dictionaries')
  const boundT = createBoundTranslate(ctx.locale.bind?.(PSTACK_NS))

  ctx.effect(() => {
    if (typeof document === 'undefined' || !document.head) return undefined
    document.head.querySelectorAll?.('style[data-dsh-pstack]').forEach((el) => el.remove())
    const style = document.createElement('style')
    style.setAttribute('data-dsh-pstack', '')
    style.textContent = PSTACK_CSS
    document.head.appendChild(style)
    return () => style.remove()
  }, 'pstack: styles')

  const openRightTab = (subtab: RightPaneSubtab, sessionId?: string) => {
    selectRightPaneSubtab(subtab)
    const sidebarRight = ctx.get<SidebarRightControllerLike>('sidebarRight')
    if (sidebarRight === undefined) return
    try {
      if (sessionId && typeof sidebarRight.openTabIn === 'function') {
        sidebarRight.openTabIn(sessionId, TAB_KIND)
        return
      }
      sidebarRight.openTab?.(TAB_KIND)
    } catch {
      try {
        sidebarRight.openTab?.(TAB_KIND)
      } catch {
        // Ignore if no rightbar surface is adopted yet.
      }
    }
  }

  const toggleRightTab = (subtab: RightPaneSubtab, sessionId?: string) => {
    const sidebarRight = ctx.get<SidebarRightControllerLike>('sidebarRight')
    try {
      if (
        sidebarRight?.isExpanded?.() === true &&
        sidebarRight.active?.()?.kind === TAB_KIND &&
        typeof sidebarRight.toggleExpanded === 'function'
      ) {
        sidebarRight.toggleExpanded()
        return
      }
    } catch {
      // Fall through to open.
    }
    openRightTab(subtab, sessionId)
  }

  const sendSessionPrompt = async (sessionId: string | undefined, text: string): Promise<boolean> => {
    if (sessionId) {
      const sessions = ctx.get<SessionsClientServiceLike>('sessions')
      const scopedSend = sessions?.scope?.(sessionId)?.conversation?.send
      if (typeof scopedSend === 'function') {
        try {
          await scopedSend(text)
          return true
        } catch {
          // Fall through to root fallback.
        }
      }
    }
    const conv = ctx.get<{ send?: (prompt: string) => Promise<unknown> }>('conversation')
    if (typeof conv?.send === 'function') {
      try {
        await conv.send(text)
        return true
      } catch {
        return false
      }
    }
    return false
  }

  const openSession = (targetSessionId: string) => {
    if (!targetSessionId) return
    try {
      ctx.get<UiWorkspaceLike>('uiWorkspace')?.openSession?.(targetSessionId)
    } catch {
      // Ignore if workspace switcher is unavailable.
    }
  }

  const callHostRpc = async <T = unknown,>(endpoint: string, payload: unknown = {}): Promise<T | undefined> => {
    if (typeof fetch === 'function') {
      try {
        const res = await fetch('api/pstack.rpc', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint, payload }),
        })
        if (!res.ok) return undefined
        const data = (await res.json()) as { ok?: boolean; value?: T }
        return data.ok ? data.value : undefined
      } catch {
        return undefined
      }
    }
    const connection = ctx.get<{
      rpc?: {
        call: (channel: string, method: string, body: unknown) => Promise<{ ok: boolean; value?: T }>
      }
    }>('connection')
    if (!connection?.rpc) return undefined
    try {
      const res = await connection.rpc.call('/pstack', endpoint, payload)
      return res.ok ? res.value : undefined
    } catch {
      return undefined
    }
  }

  const makeRpcCaller = (sessionId?: string): PstackRpcCaller => ({
    call: callHostRpc,
    async sendPrompt(text: string): Promise<void> {
      await sendSessionPrompt(sessionId, text)
    },
    openSession,
  })

  const decideKetchupItem = async (req: {
    readonly sessionId: string | undefined
    readonly itemId: string
    readonly label: string
    readonly prompt: string
  }): Promise<KetchupDecisionResult> => {
    const taggedPrompt = `[ketchup:${req.itemId}] ${req.prompt}`
    if (req.sessionId) {
      const res = await callHostRpc<{ accepted?: boolean; deliveredOnHost?: boolean; reason?: string }>(
        'decideKetchup',
        req,
      )
      if (res?.accepted === true) {
        if (!res.deliveredOnHost) {
          await sendSessionPrompt(req.sessionId, taggedPrompt)
        }
        return { ok: true }
      }
    }
    const sent = await sendSessionPrompt(req.sessionId, taggedPrompt)
    return sent ? { ok: true } : { ok: false }
  }

  // 2. Composer Dock, Left Chip, Session Header Utility, and Hero Playbook Picker
  ctx.slots.inject('conversation.input.dock', () =>
    ctx.slots.register(
      { name: 'conversation.input.dock', id: 'pstack-dock', order: 15, locale: PSTACK_NS },
      (props: { sessionId?: string; useProjection?: (key: string) => unknown }) => (
        <PlaybookDock
          sessionId={props.sessionId}
          useProjection={props.useProjection}
          openRightTab={(sub) => openRightTab(sub, props.sessionId)}
        />
      ),
    ),
  )

  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register(
      { name: 'conversation.input.left', id: 'pstack-mode', order: 15, locale: PSTACK_NS },
      (props: { sessionId?: string; useProjection?: (key: string) => unknown }) => (
        <PotetoModeBadge
          sessionId={props.sessionId}
          useProjection={props.useProjection}
          openRightTab={(sub) => openRightTab(sub, props.sessionId)}
        />
      ),
    ),
  )

  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register(
      { name: 'conversation.session.header.utilities', id: 'pstack-header', order: 25, locale: PSTACK_NS },
      (props: { sessionId?: string; useProjection?: (key: string) => unknown }) => (
        <PstackHeaderButton
          sessionId={props.sessionId}
          useProjection={props.useProjection}
          toggleRightTab={(sub) => toggleRightTab(sub, props.sessionId)}
        />
      ),
    ),
  )

  ctx.slots.inject('conversation.hero.options', () =>
    ctx.slots.register(
      { name: 'conversation.hero.options', id: 'pstack-hero', order: 30, locale: PSTACK_NS },
      (props: { sessionId?: string; inputActions?: DshInputActions }) => (
        <HeroPlaybookPicker
          sessionId={props.sessionId}
          inputActions={props.inputActions}
          sendPrompt={async (text) => {
            await sendSessionPrompt(props.sessionId, text)
          }}
          openRightTab={(sub) => openRightTab(sub, props.sessionId)}
        />
      ),
    ),
  )

  // 3. Right Sidebar Tab (`sidebarRightTabs` via reactive `ctx.inject`, plus pane body & title)
  const registerRightTabType = (ownerCtx: ClientContext, tabs: SidebarRightTabsLike) => {
    ownerCtx.effect(
      () =>
        tabs.register({
          id: PACKAGE_ID,
          kind: TAB_KIND,
          keepMounted: true,
          title: () => boundT('tab.title'),
          guide: [
            {
              id: 'pstack-guide',
              order: 35,
              title: () => boundT('guide.title'),
              description: () => boundT('guide.desc'),
              icon: () => <Potato size="sm" crowned />,
            },
          ],
        }),
      'pstack: right sidebar tab type',
    )
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['sidebarRightTabs'], (inner) => {
      const tabs = inner.get<SidebarRightTabsLike>('sidebarRightTabs')
      if (tabs !== undefined) registerRightTabType(inner, tabs)
    })
  } else {
    const tabs = ctx.get<SidebarRightTabsLike>('sidebarRightTabs')
    if (tabs !== undefined) registerRightTabType(ctx, tabs)
  }

  ctx.slots.inject('sidebar.right.pane.tab', () =>
    ctx.slots.register(
      { name: 'sidebar.right.pane.tab', key: PACKAGE_ID, locale: PSTACK_NS },
      (props: {
        sessionId?: string
        inputActions?: DshInputActions
        useProjection?: (key: string) => unknown
        useSession?: (selector?: (s: { id?: string }) => unknown) => unknown
        t?: (key: string, vars?: Record<string, string | number>) => string
      }) => {
        const view = readPstackView(props.useProjection?.('pstack')) ?? EMPTY_PSTACK_VIEW
        let sessionId: string | undefined = typeof props.sessionId === 'string' ? props.sessionId : undefined
        if (sessionId === undefined && typeof props.useSession === 'function') {
          try {
            const snap = props.useSession((s) => s?.id)
            if (typeof snap === 'string') sessionId = snap
            else if (typeof snap === 'object' && snap !== null && typeof (snap as { id?: unknown }).id === 'string') {
              sessionId = (snap as { id: string }).id
            }
          } catch {
            sessionId = undefined
          }
        }
        const openFile = (filePath: string, line?: number) => {
          const sidebarRight = ctx.get<SidebarRightControllerLike>('sidebarRight')
          const clean = filePath.replace(/^\.\//, '')
          if (!sessionId || !sidebarRight || clean === '' || clean.startsWith('/') || clean.split('/').includes('..')) {
            return
          }
          try {
            const encoded = clean.split('/').map(encodeURIComponent).join('/')
            const addr = `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${encoded}`
            const opts = line ? { params: { line } } : undefined
            if (typeof sidebarRight.openResourceIn === 'function') {
              sidebarRight.openResourceIn(sessionId, addr, opts)
            } else {
              sidebarRight.openResource?.(addr, opts)
            }
          } catch {
            // Ignore if file viewer is not mounted.
          }
        }
        const slotT: PstackTranslate = props.t ? createBoundTranslate(props.t) : boundT
        return (
          <PstackSidebarPane
            view={view}
            sessionId={sessionId}
            inputActions={props.inputActions}
            rpc={{ ...makeRpcCaller(sessionId), openFile }}
            t={slotT}
          />
        )
      },
    ),
  )

  ctx.slots.inject('sidebar.right.pane.tab.title', () =>
    ctx.slots.register(
      { name: 'sidebar.right.pane.tab.title', key: PACKAGE_ID, locale: PSTACK_NS },
      (props: { useProjection?: (key: string) => unknown }) => {
        const view = readPstackView(props.useProjection?.('pstack'))
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Potato
              size="sm"
              crowned={view?.mode === 'on'}
              golden={view?.playbook?.completed === true}
              ketchup={(view?.pendingKetchupCount ?? 0) + (view?.guard.pendingApprovals ?? 0) > 0}
            />
            <span>pstack</span>
          </span>
        )
      },
    ),
  )

  // 4. Session list row trailing & hover (`pstackSummary` first, fallback to `pstack`)
  type SessionListLike = {
    byId?: Record<string, { projectionValues?: Record<string, unknown> }>
    projectionsBySession?: Record<string, { values?: Record<string, unknown> }>
    items?: readonly { id: string; projectionValues?: Record<string, unknown> }[]
    sessions?: readonly { id: string; projectionValues?: Record<string, unknown> }[]
  }

  const decodeSummaryBucket = (bucket: Record<string, unknown> | undefined): PstackSummaryView | undefined => {
    if (bucket === undefined) return undefined
    return readPstackSummaryView(bucket.pstackSummary) ?? summaryFromFullView(readPstackView(bucket.pstack))
  }

  const selectRowSummary = (props: {
    sessionId?: string
    useSessions?: <R>(selector: (state: SessionListLike) => R) => R
  }): PstackSummaryView | undefined => {
    const sid = props.sessionId
    if (!sid || typeof props.useSessions !== 'function') return undefined
    try {
      return props.useSessions((state) => {
        const fromById = decodeSummaryBucket(state?.byId?.[sid]?.projectionValues)
        if (fromById !== undefined) return fromById
        const fromProjections = decodeSummaryBucket(state?.projectionsBySession?.[sid]?.values)
        if (fromProjections !== undefined) return fromProjections
        const list = state?.items ?? state?.sessions ?? []
        const found = list.find((row) => row.id === sid)
        return decodeSummaryBucket(found?.projectionValues)
      })
    } catch {
      return undefined
    }
  }

  ctx.slots.inject('sidebar.session.row.trailing', () =>
    ctx.slots.register(
      { name: 'sidebar.session.row.trailing', id: 'pstack-row-trail', order: 25, locale: PSTACK_NS },
      (props: Record<string, unknown>) => <SessionRowTrailing summary={selectRowSummary(props as never)} />,
    ),
  )

  ctx.slots.inject('sidebar.session.row.hover', () =>
    ctx.slots.register(
      { name: 'sidebar.session.row.hover', id: 'pstack-row-hover', order: 25, locale: PSTACK_NS },
      (props: Record<string, unknown>) => <SessionRowHover summary={selectRowSummary(props as never)} />,
    ),
  )

  // 5. Keyed custom tool cards (`tool.call.toolview`) — built-in `bash` card stays untouched
  const registerToolCard = (toolName: string, Comp: React.ComponentType<any>) => {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({ name: 'tool.call.toolview', key: toolName, locale: PSTACK_NS }, Comp),
    )
  }

  registerToolCard('pstack_arena', (p: Record<string, unknown>) => (
    <ArenaToolCard {...p} openRightTab={(sub) => openRightTab(sub, p.sessionId as string | undefined)} />
  ))
  registerToolCard('pstack_interrogate', (p: Record<string, unknown>) => (
    <InterrogateToolCard {...p} openRightTab={(sub) => openRightTab(sub, p.sessionId as string | undefined)} />
  ))
  registerToolCard('pstack_swarm', (p: Record<string, unknown>) => (
    <SwarmToolCard {...p} openRightTab={(sub) => openRightTab(sub, p.sessionId as string | undefined)} />
  ))
  registerToolCard('pstack_no_comments', (p: Record<string, unknown>) => <SickoToolCard {...p} />)
  registerToolCard('pstack_bench', (p: Record<string, unknown>) => (
    <BenchFreezeToolCard {...p} openRightTab={(sub) => openRightTab(sub, p.sessionId as string | undefined)} />
  ))
  registerToolCard('pstack_attempt', (p: Record<string, unknown>) => (
    <AttemptToolCard {...p} openRightTab={(sub) => openRightTab(sub, p.sessionId as string | undefined)} />
  ))
  registerToolCard('pstack_ketchup', (p: Record<string, unknown>) => (
    <KetchupToolCard
      {...p}
      sessionId={typeof p.sessionId === 'string' ? p.sessionId : undefined}
      useProjection={typeof p.useProjection === 'function' ? (p.useProjection as (key: string) => unknown) : undefined}
      decideItem={decideKetchupItem}
    />
  ))

  // 6. Plugins page row configuration & bundle activation welcome
  ctx.slots.inject('plugins.row.config', () =>
    ctx.slots.register(
      { name: 'plugins.row.config', key: `${PACKAGE_ID}#pstack-guard`, locale: PSTACK_NS },
      (props: { view: 'summary' | 'page'; form?: ConfigFormProp }) => (
        <GuardRowConfigPage view={props.view} form={props.form} rpc={makeRpcCaller()} />
      ),
    ),
  )

  ctx.slots.inject('plugins.row.config', () =>
    ctx.slots.register(
      { name: 'plugins.row.config', key: `${PACKAGE_ID}#pstack-panel`, locale: PSTACK_NS },
      (props: { view: 'summary' | 'page'; form?: ConfigFormProp }) => (
        <PanelRowConfigPage view={props.view} form={props.form} rpc={makeRpcCaller()} />
      ),
    ),
  )

  ctx.slots.inject('plugins.bundle.activation', () =>
    ctx.slots.register(
      { name: 'plugins.bundle.activation', key: PACKAGE_ID, locale: PSTACK_NS },
      (props: { onDismiss?: () => void; onOpenDetails?: () => void }) => (
        <BundleActivationCard onDismiss={props.onDismiss} onOpenDetails={props.onOpenDetails} />
      ),
    ),
  )
}
