/**
 * Plugin configuration pages (`plugins.row.config` for `pstack-guard` and
 * `pstack-panel`) and activation welcome card (`plugins.bundle.activation`).
 *
 * Runs `src/core`'s pure `classifyShellCommand`, `parseSeatSpec`,
 * `parseVendorOverridesText`, `vendorOf`, `panelVendors`, and `pickCrossJudge`
 * directly in the browser for instant interactive previews!
 */

import * as React from 'react'
import {
  panelVendors,
  parseSeatSpec,
  parseVendorOverridesText,
  pickCrossJudge,
  vendorOf,
} from '../../src/core/model-routing.ts'
import type { Budget, ModelRoute } from '../../src/core/model-routing.ts'
import { DEFAULT_SHELL_POLICY, classifyShellCommand, simpleCommands, unwrapCommandWords } from '../../src/core/shell-policy.ts'
import type { ShellVerdict } from '../../src/core/shell-policy.ts'
import { fallbackT, isChineseLocale } from './i18n.ts'
import { Potato, Stamp } from './primitives.tsx'
import type { PstackRpcCaller } from './right-pane.tsx'

export type SettingsPathOp = { readonly op: 'set'; readonly path: string[]; readonly value: unknown }

export interface ConfigFormProp {
  readonly state?:
    | {
        readonly status?: 'loading' | 'ready' | 'unavailable' | undefined
        readonly value?: Record<string, unknown> | undefined
        readonly current?: Record<string, unknown> | undefined
        readonly revision?: number | undefined
        readonly writable?: boolean | undefined
      }
    | undefined
  readonly mutate?: ((ops: readonly SettingsPathOp[], revision?: number) => Promise<unknown>) | undefined
}

interface DenyRuleEntry {
  readonly pattern: string
  readonly reason: string
  readonly instead: string
}

async function persistRowConfig(
  rowId: string,
  nextConfig: Record<string, unknown>,
  form: ConfigFormProp | undefined,
  rpc: PstackRpcCaller,
): Promise<boolean> {
  if (typeof form?.mutate === 'function') {
    if (form.state?.writable === false) return false
    const ops: SettingsPathOp[] = Object.entries(nextConfig).map(([key, value]) => ({
      op: 'set',
      path: [key],
      value,
    }))
    try {
      const ok = await form.mutate(ops, form.state?.revision)
      return ok !== false
    } catch {
      return false
    }
  }
  const res = await rpc.call<{ saved?: boolean }>('saveConfig', { rowId, config: nextConfig })
  return res?.saved === true
}

function formatDenyRuleLines(raw: unknown): string {
  if (!Array.isArray(raw)) return ''
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && typeof (r as { pattern?: unknown }).pattern === 'string')
    .map((r) => {
      const pat = String(r.pattern).trim()
      const reason = typeof r.reason === 'string' ? r.reason.trim() : ''
      const instead = typeof r.instead === 'string' ? r.instead.trim() : ''
      return reason || instead ? `${pat} | ${reason} | ${instead}` : pat
    })
    .filter(Boolean)
    .join('\n')
}

function parseDenyRuleLines(text: string): DenyRuleEntry[] {
  const out: DenyRuleEntry[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue
    const parts = line.split('|').map((p) => p.trim())
    const pattern = parts[0] ?? ''
    if (pattern === '') continue
    out.push({
      pattern,
      reason: parts[1] || 'Denied by pstack guard rule.',
      instead: parts[2] || 'Use the sanctioned project workflow instead.',
    })
  }
  return out
}

function validateRegexList(patterns: readonly string[]): string | null {
  for (const pat of patterns) {
    if (pat.length > 4096) {
      return `Pattern exceeds 4096 characters: ${pat.slice(0, 48)}…`
    }
    try {
      new RegExp(pat)
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }
  return null
}

function matchesDenyRule(command: string, rules: readonly DenyRuleEntry[]): ShellVerdict | undefined {
  if (rules.length === 0) return undefined
  const cmds = simpleCommands(command)
  for (const rule of rules) {
    let re: RegExp
    try {
      re = new RegExp(rule.pattern)
    } catch {
      continue
    }
    const matched =
      re.test(command) ||
      cmds.some((words: readonly string[]) => {
        const unwrapped = unwrapCommandWords(words).join(' ')
        return unwrapped !== '' && re.test(unwrapped)
      })
    if (matched) {
      return { kind: 'deny', rule: 'deploy', command, reason: rule.reason, instead: rule.instead }
    }
  }
  return undefined
}

export function GuardRowConfigPage({
  view,
  form,
  rpc,
}: {
  readonly view: 'summary' | 'page'
  readonly form?: ConfigFormProp | undefined
  readonly rpc: PstackRpcCaller
}): React.JSX.Element {
  const zh = isChineseLocale()
  const formValue = form?.state?.value ?? form?.state?.current
  const [hydratedConfig, setHydratedConfig] = React.useState<Record<string, unknown> | undefined>(undefined)
  const [dirty, setDirty] = React.useState(false)

  const current = formValue ?? hydratedConfig ?? {}

  const [branchesText, setBranchesText] = React.useState(() =>
    (Array.isArray(current.protectedBranches) ? current.protectedBranches : DEFAULT_SHELL_POLICY.protectedBranches).join(', '),
  )
  const [forbidForcePush, setForbidForcePush] = React.useState(() => Boolean(current.forbidForcePush))
  const [patternsText, setPatternsText] = React.useState(() =>
    (Array.isArray(current.askPatterns) ? current.askPatterns : DEFAULT_SHELL_POLICY.askPatterns).join('\n'),
  )
  const [denyText, setDenyText] = React.useState(() => formatDenyRuleLines(current.denyPatterns))
  const [probeCmd, setProbeCmd] = React.useState('git add -A && git push --force origin main')
  const [saveState, setSaveState] = React.useState<{ ok: boolean; message: string } | null>(null)

  const applyRemoteSnapshot = (cfg: Record<string, unknown>) => {
    if (Array.isArray(cfg.protectedBranches)) setBranchesText(cfg.protectedBranches.join(', '))
    if (typeof cfg.forbidForcePush === 'boolean') setForbidForcePush(cfg.forbidForcePush)
    if (Array.isArray(cfg.askPatterns)) setPatternsText(cfg.askPatterns.join('\n'))
    if (Array.isArray(cfg.denyPatterns)) setDenyText(formatDenyRuleLines(cfg.denyPatterns))
  }

  React.useEffect(() => {
    if (dirty || formValue === undefined) return
    applyRemoteSnapshot(formValue)
  }, [formValue])

  React.useEffect(() => {
    if (view !== 'page' || formValue !== undefined) return
    let cancelled = false
    void rpc.call<{ found?: boolean; config?: Record<string, unknown> }>('getConfig', { rowId: 'pstack-guard' }).then((res) => {
      if (!cancelled && res?.found && res.config && !dirty) {
        setHydratedConfig(res.config)
        applyRemoteSnapshot(res.config)
      }
    })
    return () => {
      cancelled = true
    }
  }, [view, formValue === undefined])

  if (view === 'summary') {
    return (
      <span>
        {zh
          ? '否决 git add -A、commit -a 与草稿 PR；强推与部署先经人工确认'
          : 'Denies git add -A, commit -a, and draft PRs; pauses for force-push and deploys'}
      </span>
    )
  }

  const protectedBranches = branchesText
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const askPatterns = patternsText
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const denyPatterns = parseDenyRuleLines(denyText)

  const regexError =
    validateRegexList(askPatterns) ?? validateRegexList(denyPatterns.map((d) => d.pattern))

  const trimmedProbe = probeCmd.trim()
  const dryVerdict: ShellVerdict | null =
    regexError !== null || trimmedProbe === ''
      ? null
      : (matchesDenyRule(trimmedProbe, denyPatterns) ??
        classifyShellCommand(trimmedProbe, { protectedBranches, forbidForcePush, askPatterns }))

  const save = async () => {
    if (regexError !== null) return
    const nextConfig = {
      shellTools: Array.isArray(current.shellTools) ? current.shellTools : ['bash', 'pwsh'],
      protectedBranches,
      forbidForcePush,
      askPatterns,
      denyPatterns,
    }
    const ok = await persistRowConfig('pstack-guard', nextConfig, form, rpc)
    if (ok) setDirty(false)
    setSaveState({
      ok,
      message: ok
        ? zh
          ? '已保存并热重载护栏配置'
          : 'Saved and hot-reloaded guard rules'
        : zh
          ? '保存失败，请检查配置权限或重试'
          : 'Save failed; check config writability',
    })
  }

  return (
    <div className="pstack-cfg">
      <div className="pstack-cfg-field">
        <label htmlFor="pstack-guard-branches">
          {zh ? '受保护分支（逗号分隔）' : 'Protected branches (comma-separated)'}
        </label>
        <input
          id="pstack-guard-branches"
          className="pstack-input mono"
          value={branchesText}
          onChange={(e) => {
            setDirty(true)
            setBranchesText(e.target.value)
          }}
        />
        <span className="pstack-cfg-hint">
          {zh ? '即使带 --force-with-lease，推向这些共享分支仍会先向你确认。' : 'Leased force-pushes targeting these branches still pause for approval.'}
        </span>
      </div>

      <div className="pstack-cfg-field">
        <label htmlFor="pstack-guard-force" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            id="pstack-guard-force"
            type="checkbox"
            checked={forbidForcePush}
            onChange={(e) => {
              setDirty(true)
              setForbidForcePush(e.target.checked)
            }}
          />
          {zh ? '严禁一切强推（Babysit 模式默认策略）' : 'Forbid all force-pushes outright (Babysit mode)'}
        </label>
      </div>

      <div className="pstack-cfg-field">
        <label htmlFor="pstack-guard-ask">
          {zh ? '需人工确认的发布/部署命令正则（每行一条）' : 'Publish / deploy regex patterns (one per line)'}
        </label>
        <textarea
          id="pstack-guard-ask"
          className="pstack-textarea mono"
          rows={4}
          value={patternsText}
          onChange={(e) => {
            setDirty(true)
            setPatternsText(e.target.value)
          }}
        />
      </div>

      <div className="pstack-cfg-field">
        <label htmlFor="pstack-guard-deny">
          {zh
            ? '直接否决的命令正则（格式：正则 | 原因 | 替代建议，兼容 /correct）'
            : 'Denied command regexes (pattern | reason | instead, shared with /correct)'}
        </label>
        <textarea
          id="pstack-guard-deny"
          className="pstack-textarea mono"
          rows={3}
          placeholder="^deploy-prod\b | Never deploy directly | Run scripts/release.sh"
          value={denyText}
          onChange={(e) => {
            setDirty(true)
            setDenyText(e.target.value)
          }}
        />
        {regexError ? (
          <span role="alert" style={{ color: 'var(--p-ketchup)', fontSize: 12 }}>
            {regexError}
          </span>
        ) : null}
      </div>

      <div className="pstack-dryrun">
        <label htmlFor="pstack-guard-probe" style={{ fontFamily: 'var(--p-display)', fontWeight: 700 }}>
          {zh ? '配置规则试运行（本地预览）' : 'Configured Policy Dry-Run'}
        </label>
        <input
          id="pstack-guard-probe"
          className="pstack-input mono"
          value={probeCmd}
          onChange={(e) => setProbeCmd(e.target.value)}
          placeholder="git push --force origin main"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {regexError !== null ? (
            <>
              <Stamp text={zh ? '正则有误' : 'INVALID'} tone="red" />
              <span style={{ color: 'var(--p-ketchup)' }}>{regexError}</span>
            </>
          ) : dryVerdict === null ? (
            <>
              <Stamp text={zh ? '待输入' : 'IDLE'} tone="mute" />
              <span style={{ color: 'var(--p-text-secondary)' }}>
                {zh ? '输入任意 shell 命令预览拦截结果。' : 'Enter a shell command above to preview verdict.'}
              </span>
            </>
          ) : dryVerdict.kind === 'deny' ? (
            <>
              <Stamp text={zh ? '拦下' : 'DENY'} tone="red" />
              <span>
                {dryVerdict.reason} <code>{dryVerdict.instead}</code>
              </span>
            </>
          ) : dryVerdict.kind === 'ask' ? (
            <>
              <Stamp text={zh ? '要问你' : 'ASK'} tone="gold" />
              <span>{dryVerdict.reason}</span>
            </>
          ) : (
            <>
              <Stamp text={zh ? '放行' : 'ALLOW'} tone="green" />
              <span style={{ color: 'var(--p-text-secondary)' }}>
                {zh ? '该命令会正常进入执行管线。' : 'Command passes configured shell guard.'}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="pstack-acts" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="pstack-btn primary" disabled={regexError !== null} onClick={() => void save()}>
          {zh ? '保存配置' : 'Save Configuration'}
        </button>
        {saveState ? (
          <span
            role={saveState.ok ? 'status' : 'alert'}
            style={{
              color: saveState.ok ? 'var(--p-chive)' : 'var(--p-ketchup)',
              fontSize: 12,
              alignSelf: 'center',
            }}
          >
            {saveState.message}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function PanelRowConfigPage({
  view,
  form,
  rpc,
}: {
  readonly view: 'summary' | 'page'
  readonly form?: ConfigFormProp | undefined
  readonly rpc: PstackRpcCaller
}): React.JSX.Element {
  const zh = isChineseLocale()
  const formValue = form?.state?.value ?? form?.state?.current
  const [hydratedConfig, setHydratedConfig] = React.useState<Record<string, unknown> | undefined>(undefined)
  const [dirty, setDirty] = React.useState(false)

  const current = formValue ?? hydratedConfig ?? {}

  const [budget, setBudget] = React.useState<Budget>(() =>
    current.budget === 'small' || current.budget === 'medium' ? current.budget : 'large',
  )
  const [arenaText, setArenaText] = React.useState(() =>
    (Array.isArray(current.arenaSeats) ? current.arenaSeats : ['inherit-parent', 'inherit-parent']).join('\n'),
  )
  const [interrogateText, setInterrogateText] = React.useState(() =>
    (Array.isArray(current.interrogateSeats) ? current.interrogateSeats : ['inherit-parent', 'inherit-parent']).join('\n'),
  )
  const [swarmSeatText, setSwarmSeatText] = React.useState(() =>
    typeof current.swarmSeat === 'string' && current.swarmSeat.trim() !== '' ? current.swarmSeat : 'inherit-parent',
  )
  const [judgeText, setJudgeText] = React.useState(() =>
    (Array.isArray(current.judgePool) ? current.judgePool : []).join('\n'),
  )
  const [overridesText, setOverridesText] = React.useState(() =>
    Object.entries(
      (typeof current.vendorOverrides === 'object' && current.vendorOverrides !== null
        ? current.vendorOverrides
        : {}) as Record<string, string>,
    )
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  )
  const [catalog, setCatalog] = React.useState<{ provider: string; model: string; vendor?: string }[]>([])
  const [previewParentSpec, setPreviewParentSpec] = React.useState('deepseek/deepseek-v4')
  const [saveState, setSaveState] = React.useState<{ ok: boolean; message: string } | null>(null)

  const applyRemoteSnapshot = (cfg: Record<string, unknown>) => {
    if (cfg.budget === 'small' || cfg.budget === 'medium' || cfg.budget === 'large') setBudget(cfg.budget)
    if (Array.isArray(cfg.arenaSeats)) setArenaText(cfg.arenaSeats.join('\n'))
    if (Array.isArray(cfg.interrogateSeats)) setInterrogateText(cfg.interrogateSeats.join('\n'))
    if (typeof cfg.swarmSeat === 'string' && cfg.swarmSeat.trim() !== '') setSwarmSeatText(cfg.swarmSeat)
    if (Array.isArray(cfg.judgePool)) setJudgeText(cfg.judgePool.join('\n'))
    if (typeof cfg.vendorOverrides === 'object' && cfg.vendorOverrides !== null && !Array.isArray(cfg.vendorOverrides)) {
      setOverridesText(
        Object.entries(cfg.vendorOverrides as Record<string, string>)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n'),
      )
    }
  }

  React.useEffect(() => {
    if (dirty || formValue === undefined) return
    applyRemoteSnapshot(formValue)
  }, [formValue])

  React.useEffect(() => {
    if (view !== 'page') return
    let cancelled = false
    if (formValue === undefined) {
      void rpc.call<{ found?: boolean; config?: Record<string, unknown> }>('getConfig', { rowId: 'pstack-panel' }).then((res) => {
        if (!cancelled && res?.found && res.config && !dirty) {
          setHydratedConfig(res.config)
          applyRemoteSnapshot(res.config)
        }
      })
    }
    void rpc.call<{ models?: { provider: string; model: string; vendor?: string }[] }>('models').then((res) => {
      if (!cancelled && res?.models) {
        setCatalog(res.models)
        if (res.models[0]) {
          setPreviewParentSpec(`${res.models[0].provider}/${res.models[0].model}`)
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [view, formValue === undefined])

  if (view === 'summary') {
    return (
      <span>
        {zh
          ? '配置 Arena / Interrogate / Swarm 席位、推理预算与跨厂商裁判池'
          : 'Configure Arena, Interrogate, Swarm seats, effort budget, and cross-vendor judge pool'}
      </span>
    )
  }

  const { overrides: vendorOverrides, invalidLines } = parseVendorOverridesText(overridesText)
  const arenaSeats = arenaText.split('\n').map((s) => s.trim()).filter(Boolean)
  const interrogateSeats = interrogateText.split('\n').map((s) => s.trim()).filter(Boolean)
  const swarmSeat = swarmSeatText.trim() || 'inherit-parent'
  const judgePool = judgeText.split('\n').map((s) => s.trim()).filter(Boolean)

  const parsedParentSeat = parseSeatSpec(previewParentSpec)
  const previewParentModel: ModelRoute =
    parsedParentSeat === 'inherit-parent'
      ? { provider: 'deepseek', model: 'deepseek-v4' }
      : parsedParentSeat

  const parsedArena = (arenaSeats.length > 0 ? arenaSeats : ['inherit-parent']).map(parseSeatSpec)
  const parsedPool = (judgePool.length > 0 ? judgePool : catalog.map((m) => `${m.provider}/${m.model}`)).map(parseSeatSpec)
  const vendors = panelVendors(parsedArena, previewParentModel, vendorOverrides)
  const judge = pickCrossJudge(parsedPool, previewParentModel, vendorOverrides)

  const save = async () => {
    if (invalidLines.length > 0) return
    const nextConfig = {
      budget,
      maxConcurrency: typeof current.maxConcurrency === 'number' ? current.maxConcurrency : 8,
      arenaSeats: arenaSeats.length > 0 ? arenaSeats : ['inherit-parent', 'inherit-parent'],
      interrogateSeats: interrogateSeats.length > 0 ? interrogateSeats : ['inherit-parent', 'inherit-parent'],
      swarmSeat,
      judgePool,
      vendorOverrides,
    }
    const ok = await persistRowConfig('pstack-panel', nextConfig, form, rpc)
    if (ok) setDirty(false)
    setSaveState({
      ok,
      message: ok
        ? zh
          ? '已保存面板席位配置'
          : 'Saved panel seats configuration'
        : zh
          ? '保存失败，请检查配置权限或重试'
          : 'Save failed; check config writability',
    })
  }

  return (
    <div className="pstack-cfg">
      <div className="pstack-cfg-field">
        <label htmlFor="pstack-panel-budget">{zh ? '推理预算档位 (Budget)' : 'Reasoning effort budget'}</label>
        <select
          id="pstack-panel-budget"
          className="pstack-select"
          value={budget}
          onChange={(e) => {
            setDirty(true)
            setBudget(e.target.value as Budget)
          }}
        >
          <option value="large">large (xhigh / high)</option>
          <option value="medium">medium (−1 step)</option>
          <option value="small">small (−2 steps)</option>
        </select>
      </div>

      <div className="pstack-cfg-field">
        <label htmlFor="pstack-panel-arena">
          {zh ? 'Arena 候选席位（每行 provider/model[@effort] 或 inherit-parent）' : 'Arena seats (one provider/model[@effort] or inherit-parent per line)'}
        </label>
        <textarea
          id="pstack-panel-arena"
          className="pstack-textarea mono"
          rows={3}
          value={arenaText}
          onChange={(e) => {
            setDirty(true)
            setArenaText(e.target.value)
          }}
        />
        {catalog.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {catalog.slice(0, 8).map((m) => {
              const spec = `${m.provider}/${m.model}`
              const v = vendorOf(m, vendorOverrides) ?? 'unknown'
              return (
                <button
                  key={spec}
                  type="button"
                  className="pstack-btn"
                  onClick={() => {
                    setDirty(true)
                    setArenaText((prev) => `${prev.trim()}\n${spec}`.trim())
                  }}
                >
                  + {m.model} <span style={{ color: 'var(--p-text-tertiary)' }}>({v})</span>
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className="pstack-cfg-field">
        <label htmlFor="pstack-panel-interrogate">
          {zh ? 'Interrogate 对抗评审席位（每行一个）' : 'Interrogate reviewer seats (one per line)'}
        </label>
        <textarea
          id="pstack-panel-interrogate"
          className="pstack-textarea mono"
          rows={2}
          value={interrogateText}
          onChange={(e) => {
            setDirty(true)
            setInterrogateText(e.target.value)
          }}
        />
      </div>

      <div className="pstack-cfg-field">
        <label htmlFor="pstack-panel-swarm">
          {zh ? 'Swarm 切片默认席位' : 'Swarm worker seat'}
        </label>
        <input
          id="pstack-panel-swarm"
          className="pstack-input mono"
          value={swarmSeatText}
          onChange={(e) => {
            setDirty(true)
            setSwarmSeatText(e.target.value)
          }}
        />
      </div>

      <div className="pstack-cfg-field">
        <label htmlFor="pstack-panel-judge">
          {zh ? '跨厂商裁判候选池（按优先级每行一个 provider/model）' : 'Cross-vendor judge pool (ordered provider/model)'}
        </label>
        <textarea
          id="pstack-panel-judge"
          className="pstack-textarea mono"
          rows={3}
          value={judgeText}
          onChange={(e) => {
            setDirty(true)
            setJudgeText(e.target.value)
          }}
        />
      </div>

      <div className="pstack-cfg-field">
        <label htmlFor="pstack-panel-overrides">
          {zh ? '手动厂商标注覆盖（provider/model=vendor）' : 'Manual vendor overrides (provider/model=vendor)'}
        </label>
        <textarea
          id="pstack-panel-overrides"
          className="pstack-textarea mono"
          rows={2}
          placeholder="my-gateway/custom-model=anthropic"
          value={overridesText}
          onChange={(e) => {
            setDirty(true)
            setOverridesText(e.target.value)
          }}
        />
        {invalidLines.length > 0 ? (
          <span role="alert" style={{ color: 'var(--p-ketchup)', fontSize: 12 }}>
            {zh
              ? `格式无效（需写 key=vendor）：${invalidLines.join('；')}`
              : `Invalid override line(s) (expected key=vendor): ${invalidLines.join('; ')}`}
          </span>
        ) : null}
      </div>

      <div className="pstack-dryrun">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label htmlFor="pstack-panel-parent-sim" style={{ fontSize: 12, color: 'var(--p-text-secondary)' }}>
            {zh ? '模拟主会话模型：' : 'Simulate parent model:'}
          </label>
          <input
            id="pstack-panel-parent-sim"
            className="pstack-input mono"
            style={{ maxWidth: 260, padding: '4px 8px' }}
            value={previewParentSpec}
            onChange={(e) => setPreviewParentSpec(e.target.value)}
          />
        </div>
        <div>
          <Stamp text={zh ? `${vendors.length} 家厂商` : `${vendors.length} VENDORS`} tone="purple" />{' '}
          <span style={{ marginLeft: 6 }}>
            {zh ? `当前 Arena 包含厂商：${vendors.join('、')}` : `Vendors on Arena: ${vendors.join(', ')}`}
          </span>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--p-text-secondary)' }}>
          {judge.kind === 'picked'
            ? judge.vendorCheck === 'skipped-unknown-parent'
              ? zh
                ? `主会话模型 ${previewParentModel.provider}/${previewParentModel.model} 厂商未知（未配置覆盖），回退使用池首模型 ${judge.judge.provider}/${judge.judge.model}。`
                : `Parent vendor unknown for ${previewParentModel.provider}/${previewParentModel.model}; vendor check skipped, falling back to ${judge.judge.provider}/${judge.judge.model}.`
              : zh
                ? `主会话厂商为 ${vendorOf(previewParentModel, vendorOverrides)}，自动挑出的跨厂商裁判为：${vendorOf(judge.judge, vendorOverrides)} / ${judge.judge.model}。`
                : `Against parent vendor ${vendorOf(previewParentModel, vendorOverrides)}, cross-judge resolves to ${judge.judge.provider}/${judge.judge.model}.`
            : zh
              ? `跨厂商裁判状态：${judge.reason}（不会静默使用同厂商模型）`
              : `Cross-judge status: ${judge.reason} (never silently substitutes same-vendor model)`}
        </div>
      </div>

      <div className="pstack-acts" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="pstack-btn primary" disabled={invalidLines.length > 0} onClick={() => void save()}>
          {zh ? '保存面板配置' : 'Save Panel Configuration'}
        </button>
        {saveState ? (
          <span
            role={saveState.ok ? 'status' : 'alert'}
            style={{
              color: saveState.ok ? 'var(--p-chive)' : 'var(--p-ketchup)',
              fontSize: 12,
              alignSelf: 'center',
            }}
          >
            {saveState.message}
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function BundleActivationCard(props: {
  readonly onDismiss?: (() => void) | undefined
  readonly onOpenDetails?: (() => void) | undefined
}): React.JSX.Element {
  return (
    <div className="pstack-card" style={{ margin: '10px 0' }}>
      <div className="pstack-card-head">
        <Potato crowned size="md" />
        <h3>{fallbackT('activation.title')}</h3>
      </div>
      <p style={{ margin: 0, color: 'var(--p-text-secondary)' }}>{fallbackT('activation.body')}</p>
      <div className="pstack-acts">
        {props.onOpenDetails ? (
          <button type="button" className="pstack-btn" onClick={props.onOpenDetails}>
            {fallbackT('activation.details')}
          </button>
        ) : null}
        {props.onDismiss ? (
          <button type="button" className="pstack-btn primary" onClick={props.onDismiss}>
            {fallbackT('activation.dismiss')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
