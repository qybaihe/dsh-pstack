import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import { EMPTY_PSTACK_VIEW } from './core/projection.ts'
import type { PstackView } from './core/projection.ts'

interface VNode {
  type: unknown
  props: Record<string, unknown>
}

function renderTree(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(renderTree).join('')
  const vnode = node as VNode
  if (typeof vnode.type === 'function') {
    const out = (vnode.type as (p: Record<string, unknown>) => unknown)(vnode.props ?? {})
    return renderTree(out)
  }
  const children = renderTree(vnode.props?.children)
  if (typeof vnode.type === 'string') {
    const cls = typeof vnode.props?.className === 'string' ? ` class="${vnode.props.className}"` : ''
    return `<${vnode.type}${cls}>${children}</${vnode.type}>`
  }
  return children
}

describe('Client bundle (`lib/client.js`)', () => {
  it('loads via window.__ModuleLoader__.load, registers all 8 UI slot surfaces, and renders all views cleanly', () => {
    const bundlePath = join(import.meta.dirname, '../lib/client.js')
    const code = readFileSync(bundlePath, 'utf8')

    let loadedRegistration: { id: string; factory: (req: (id: string) => unknown) => Record<string, unknown> } | undefined
    const styles: { textContent: string }[] = []

    const fakeReact = {
      Fragment: Symbol.for('react.fragment'),
      createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): VNode {
        return { type, props: { ...(props ?? {}), ...(children.length > 0 ? { children } : {}) } }
      },
      useState<T>(init: T | (() => T)): [T, (next: T) => void] {
        const val = typeof init === 'function' ? (init as () => T)() : init
        return [val, () => {}]
      },
      useEffect() {},
      useRef<T>(init: T) {
        return { current: init }
      },
      useMemo<T>(fn: () => T) {
        return fn()
      },
    }

    const fakeJsxRuntime = {
      Fragment: fakeReact.Fragment,
      jsx(type: unknown, props: Record<string, unknown>): VNode {
        return { type, props }
      },
      jsxs(type: unknown, props: Record<string, unknown>): VNode {
        return { type, props }
      },
    }

    const sandbox = {
      window: {
        __ModuleLoader__: {
          load(reg: typeof loadedRegistration) {
            loadedRegistration = reg
          },
        },
      },
      document: {
        documentElement: { lang: 'zh-CN' },
        head: {
          appendChild(el: { textContent: string }) {
            styles.push(el)
          },
        },
        createElement() {
          return {
            textContent: '',
            setAttribute() {},
            remove() {},
          }
        },
      },
      navigator: { language: 'zh-CN' },
      Blob,
      URL,
      setTimeout,
      clearTimeout,
    }

    vm.runInNewContext(code, sandbox)
    assert.ok(loadedRegistration !== undefined, 'bundle did not call window.__ModuleLoader__.load')
    assert.equal(loadedRegistration.id, '@qybaihe/dsh-pstack')

    const requestedExternals = new Set<string>()
    const pluginExports = loadedRegistration.factory((specifier: string) => {
      requestedExternals.add(specifier)
      if (specifier === 'react') return fakeReact
      if (specifier === 'react/jsx-runtime') return fakeJsxRuntime
      if (specifier === 'react-dom') return { createPortal: (el: unknown) => el }
      throw new Error(`Unexpected external require("${specifier}") in client bundle`)
    })

    assert.equal(typeof pluginExports.apply, 'function')
    assert.deepEqual([...(pluginExports.inject as string[])], ['slots', 'locale'])

    // Mount into a simulated ClientContext and inspect every registered slot & interaction
    const registeredSlots: { options: Record<string, unknown>; component: (props: Record<string, unknown>) => unknown }[] = []
    let registeredRightTab: Record<string, unknown> | undefined
    const openedRightTabs: { sessionId?: string; kind: string }[] = []

    const mockCtx: Record<string, unknown> = {
      effect(fn: () => unknown) {
        fn()
      },
      inject(services: readonly string[], cb: (inner: Record<string, unknown>) => void) {
        if (services.includes('sidebarRightTabs')) cb(mockCtx)
      },
      get(name: string) {
        if (name === 'sidebarRightTabs') {
          return {
            register(def: Record<string, unknown>) {
              registeredRightTab = def
              return () => {}
            },
          }
        }
        if (name === 'sidebarRight') {
          return {
            openTab(kind: string) {
              openedRightTabs.push({ kind })
            },
            openTabIn(sessionId: string, kind: string) {
              openedRightTabs.push({ sessionId, kind })
            },
          }
        }
        return undefined
      },
      locale: {
        register() {
          return () => {}
        },
      },
      slots: {
        inject(_slotName: string, fn: () => unknown) {
          fn()
          return () => {}
        },
        register(options: Record<string, unknown>, component: (props: Record<string, unknown>) => unknown) {
          registeredSlots.push({ options, component })
          return () => {}
        },
      },
    }

    ;(pluginExports.apply as (ctx: unknown) => void)(mockCtx)

    assert.equal(styles.length, 1)
    assert.match(styles[0]!.textContent, /body\[data-ds-dark-theme\]/)
    assert.doesNotMatch(styles[0]!.textContent, /:root\s*\{/)
    assert.match(styles[0]!.textContent, /--p-gold:\s*#F2C230/)
    assert.equal(registeredRightTab?.kind, 'pstack')

    const slotNames = new Set(registeredSlots.map((s) => String(s.options.name)))
    for (const expected of [
      'conversation.input.dock',
      'conversation.input.left',
      'conversation.session.header.utilities',
      'conversation.hero.options',
      'sidebar.right.pane.tab',
      'sidebar.right.pane.tab.title',
      'sidebar.session.row.trailing',
      'sidebar.session.row.hover',
      'tool.call.toolview',
      'plugins.row.config',
      'plugins.bundle.activation',
    ]) {
      assert.ok(slotNames.has(expected), `missing slot registration: ${expected}`)
    }

    // 1. Clicking a Hero Playbook button calls DSH's real `inputActions.setDraft` AND opens the `pstack` right sidebar
    const heroEntry = registeredSlots.find((s) => s.options.name === 'conversation.hero.options')!
    const drafted: string[] = []
    const heroTree = heroEntry.component({
      sessionId: 'sess-hero-1',
      inputActions: {
        setDraft(text: string) {
          drafted.push(text)
        },
      },
    }) as { props?: { children?: unknown[] }; type?: unknown }

    const findFirstButton = (node: unknown): { onClick?: () => void } | undefined => {
      if (node === null || node === undefined || typeof node !== 'object') return undefined
      if (Array.isArray(node)) {
        for (const item of node) {
          const found = findFirstButton(item)
          if (found) return found
        }
        return undefined
      }
      const el = node as { type?: unknown; props?: { children?: unknown; onClick?: () => void } }
      if (typeof el.type === 'function') {
        return findFirstButton((el.type as (p: unknown) => unknown)(el.props ?? {}))
      }
      if (el.type === 'button' && typeof el.props?.onClick === 'function') return el.props
      return findFirstButton(el.props?.children)
    }

    const firstHeroBtn = findFirstButton(heroTree)
    assert.ok(firstHeroBtn !== undefined, 'HeroPlaybookPicker rendered no clickable button')
    firstHeroBtn.onClick?.()
    assert.equal(drafted.length, 1)
    assert.match(drafted[0]!, /^\/poteto-mode Bug fix: /)
    assert.deepEqual(openedRightTabs[0], { sessionId: 'sess-hero-1', kind: 'pstack' })

    // 2. Render rich PstackView across Dock, Right Pane, Session Row (`state.byId`), PartialArguments Tool Card, and Config Page
    const richView: PstackView = {
      ...EMPTY_PSTACK_VIEW,
      mode: 'on',
      playbook: {
        slug: 'bug-fix',
        title: 'Bug fix',
        stance: 'You own this task. Plan, review, verify.',
        goal: 'Stop idle scroll drift.',
        steps: [
          { index: 1, label: 'Reproduce', text: 'Reproduce', routes: [], status: 'completed' },
          { index: 2, label: 'Bisect', text: 'Bisect', routes: ['why'], status: 'in_progress' },
        ],
        currentStep: 2,
        completed: false,
      },
      readPrinciples: ['principle-laziness-protocol'],
      flaggedPrinciples: ['principle-explain-the-number'],
      tdd: { phase: 'red-pending' },
      guard: { blocks: 2, lastBlockedCommand: 'git add -A', asks: 0, forbidForcePush: false },
      pendingKetchupCount: 1,
    }

    const dockEntry = registeredSlots.find((s) => s.options.name === 'conversation.input.dock')!
    const dockHtml = renderTree(dockEntry.component({ sessionId: 'sess-1', useProjection: () => richView }))
    assert.match(dockHtml, /Bug fix/)
    assert.match(dockHtml, /pstack-fries/)

    const paneEntry = registeredSlots.find((s) => s.options.name === 'sidebar.right.pane.tab')!
    const paneHtml = renderTree(paneEntry.component({ sessionId: 'sess-1', useProjection: () => richView }))
    assert.match(paneHtml, /Stop idle scroll drift/)
    assert.match(paneHtml, /Explain the Number/)

    const rowTrailEntry = registeredSlots.find((s) => s.options.name === 'sidebar.session.row.trailing')!
    const rowTrailHtml = renderTree(
      rowTrailEntry.component({
        sessionId: 'sess-1',
        useSessions: (selector: (s: unknown) => unknown) =>
          selector({ byId: { 'sess-1': { id: 'sess-1', projectionValues: { pstack: richView } } } }),
      }),
    )
    assert.match(rowTrailHtml, /pstack-ketchup-badge/)

    const arenaCard = registeredSlots.find((s) => s.options.name === 'tool.call.toolview' && s.options.key === 'pstack_arena')!
    const arenaHtml = renderTree(
      arenaCard.component({
        phase: 'start',
        block: {
          args: {
            keys: () => ['task'],
            text: (k: string) => (k === 'task' ? 'Fix flaky cache' : undefined),
            value: () => undefined,
          },
        },
      }),
    )
    assert.match(arenaHtml, /Fix flaky cache/)

    const guardCfg = registeredSlots.find(
      (s) => s.options.name === 'plugins.row.config' && s.options.key === '@qybaihe/dsh-pstack#pstack-guard',
    )!
    const guardCfgHtml = renderTree(guardCfg.component({ view: 'page', form: { state: { value: { forbidForcePush: true }, revision: 3 } } }))
    assert.match(guardCfgHtml, /拦下/)

    // 3. Hardened UI edge cases: streaming `[null]` ketchup args, errored tool cards, `pstackSummary` row, and negative BenchChart
    const ketchupCard = registeredSlots.find((s) => s.options.name === 'tool.call.toolview' && s.options.key === 'pstack_ketchup')!
    const streamingKetchupHtml = renderTree(
      ketchupCard.component({
        phase: 'preparing',
        block: { args: { items: [null, { question: 'Ship now?', options: [null, { label: 'Ship', prompt: 'Ship it', cost: '~2m' }] }] } },
      }),
    )
    assert.match(streamingKetchupHtml, /Ship now\?/)
    assert.match(streamingKetchupHtml, /~2m/)

    const interrogateCard = registeredSlots.find(
      (s) => s.options.name === 'tool.call.toolview' && s.options.key === 'pstack_interrogate',
    )!
    const erroredInterrogateHtml = renderTree(
      interrogateCard.component({
        phase: 'result',
        block: { isError: true, error: { message: 'Reviewer worktree cancelled' } },
      }),
    )
    assert.match(erroredInterrogateHtml, /失败|ERROR/)
    assert.match(erroredInterrogateHtml, /Reviewer worktree cancelled/)
    assert.doesNotMatch(erroredInterrogateHtml, /CLEAN|0 成立/)

    const summaryRowHtml = renderTree(
      rowTrailEntry.component({
        sessionId: 'sess-done',
        useSessions: (selector: (s: unknown) => unknown) =>
          selector({
            byId: {
              'sess-done': {
                id: 'sess-done',
                projectionValues: {
                  pstackSummary: {
                    v: 1,
                    active: true,
                    mode: 'on',
                    playbookTitle: 'Bug fix',
                    currentStep: 2,
                    totalSteps: 2,
                    completed: true,
                    pendingCount: 0,
                    autopilotActive: false,
                    checkpointSaved: false,
                  },
                },
              },
            },
          }),
      }),
    )
    assert.match(summaryRowHtml, /pstack-potato sm/)
    assert.match(summaryRowHtml, /做完了|done/)

    // Negative-baseline BenchChart renders finite coordinates and aria-label without escaping viewBox
    selectRightPaneSubtabFromHero: {
      const benchCard = registeredSlots.find((s) => s.options.name === 'tool.call.toolview' && s.options.key === 'pstack_bench')!
      const benchCardHtml = renderTree(
        benchCard.component({
          phase: 'result',
          block: { meta: { metricName: 'Log-likelihood', baseline: -100, mad: 2.5, direction: 'higher' } },
        }),
      )
      assert.match(benchCardHtml, /Log-likelihood/)
      assert.match(benchCardHtml, /基准已冻结|FROZEN/)
    }
  })
})
