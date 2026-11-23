/**
 * Canonical catalog of pstack's 24 principles and 22 playbooks, matching
 * `skills/poteto-mode/SKILL.md` so the runtime and the UI agree on order,
 * grouping, and slugs without touching the harness.
 */

import type { Playbook } from './playbook.ts'
import { playbookSlug } from './playbook.ts'
import type { Principle } from './principles.ts'

export type PrincipleGroupId = 'core' | 'architecture' | 'verification' | 'delegation' | 'meta'

export interface CatalogPrinciple extends Principle {
  readonly group: PrincipleGroupId
}

export const PRINCIPLE_GROUPS: readonly {
  readonly id: PrincipleGroupId
  readonly labelEn: string
  readonly labelZh: string
}[] = [
  { id: 'core', labelEn: 'Core', labelZh: '核心' },
  { id: 'architecture', labelEn: 'Arch', labelZh: '架构' },
  { id: 'verification', labelEn: 'Verify', labelZh: '验证' },
  { id: 'delegation', labelEn: 'Delegate', labelZh: '委派' },
  { id: 'meta', labelEn: 'Meta', labelZh: '元' },
]

/** All 24 leaf principles in the exact order `poteto-mode/SKILL.md` lists them. */
export const PRINCIPLE_CATALOG: readonly CatalogPrinciple[] = [
  // Core (10)
  { name: 'principle-laziness-protocol', title: 'Laziness Protocol', group: 'core' },
  { name: 'principle-foundational-thinking', title: 'Foundational Thinking', group: 'core' },
  { name: 'principle-redesign-from-first-principles', title: 'Redesign from First Principles', group: 'core' },
  { name: 'principle-attack-the-premise', title: 'Attack the Premise', group: 'core' },
  { name: 'principle-subtract-before-you-add', title: 'Subtract Before You Add', group: 'core' },
  { name: 'principle-minimize-reader-load', title: 'Minimize Reader Load', group: 'core' },
  { name: 'principle-outcome-oriented-execution', title: 'Outcome-Oriented Execution', group: 'core' },
  { name: 'principle-experience-first', title: 'Experience First', group: 'core' },
  { name: 'principle-exhaust-the-design-space', title: 'Exhaust the Design Space', group: 'core' },
  { name: 'principle-build-the-lever', title: 'Build the Lever', group: 'core' },
  // Architecture (6)
  { name: 'principle-model-the-domain', title: 'Model the Domain', group: 'architecture' },
  { name: 'principle-boundary-discipline', title: 'Boundary Discipline', group: 'architecture' },
  { name: 'principle-type-system-discipline', title: 'Type System Discipline', group: 'architecture' },
  { name: 'principle-make-operations-idempotent', title: 'Make Operations Idempotent', group: 'architecture' },
  { name: 'principle-migrate-callers-then-delete-legacy-apis', title: 'Migrate Callers Then Delete Legacy APIs', group: 'architecture' },
  { name: 'principle-separate-before-serializing-shared-state', title: 'Separate Before Serializing Shared State', group: 'architecture' },
  // Verification (5)
  { name: 'principle-prove-it-works', title: 'Prove It Works', group: 'verification' },
  { name: 'principle-fix-root-causes', title: 'Fix Root Causes', group: 'verification' },
  { name: 'principle-sequence-verifiable-units', title: 'Sequence Work into Verifiable Units', group: 'verification' },
  { name: 'principle-test-behavior-not-implementation', title: 'Test Behavior, Not Implementation', group: 'verification' },
  { name: 'principle-explain-the-number', title: 'Explain the Number', group: 'verification' },
  // Delegation (2)
  { name: 'principle-guard-the-context-window', title: 'Guard the Context Window', group: 'delegation' },
  { name: 'principle-never-block-on-the-human', title: 'Never Block on the Human', group: 'delegation' },
  // Meta (1)
  { name: 'principle-encode-lessons-in-structure', title: 'Encode Lessons in Structure', group: 'meta' },
]

/** All 22 playbooks in the order `poteto-mode/SKILL.md` lists them. */
export const PLAYBOOK_TITLES: readonly string[] = [
  'Investigation',
  'Bug fix',
  'Perf issue',
  'Hillclimb',
  'Runtime forensics',
  'Trace forensics',
  'Feature',
  'Refactoring',
  'Prototype',
  'Visual parity',
  'Authoring a skill',
  'Eval',
  'Babysit',
  'Shipping',
  'Autonomous run',
  'Autopilot-full',
  'Autopilot-stack',
  'Session pickup',
  'Pause safely',
  'Multi-phase plan',
  'Worktree cleanup',
  'Opening a PR',
]

export interface PlaybookSummary {
  readonly slug: string
  readonly title: string
  readonly stance: string
  readonly stepCount: number
}

export interface HeroPlaybookInfo {
  readonly slug: string
  readonly title: string
  readonly hintZh: string
  readonly hintEn: string
  readonly stanceZh: string
  readonly stanceEn: string
  readonly previewSteps: readonly string[]
  readonly previewStepsZh: readonly string[]
}

export const HERO_FEATURED_PLAYBOOKS: readonly HeroPlaybookInfo[] = [
  {
    slug: 'bug-fix',
    title: 'Bug fix',
    hintZh: '复现 → 定位 → TDD → 验证',
    hintEn: 'Reproduce → bisect → TDD → verify',
    stanceZh: '由你全权负责：先复现、再定位根因、先红后绿、最后实证收尾。',
    stanceEn: 'You own this task. Reproduce first, fix the root cause, verify.',
    previewSteps: [
      'Reproduce the bug yourself on the matching surface',
      'Trace root cause instead of patching symptoms',
      'Design the cleanest minimal fix (architect)',
      'Write a failing regression test first (TDD red)',
      'Implement fix & verify full green suite',
      'Audit comments & report root cause + evidence',
    ],
    previewStepsZh: [
      '在对应运行面上亲手复现问题（不靠猜测）',
      '追查根因而不是打补丁掩盖症状',
      '设计最小且干净的修复方案（architect）',
      '先写失败的回归测试（TDD 红灯）',
      '实现修复并跑通完整测试套件（绿灯）',
      '清理多余注释并给出根因与实证报告',
    ],
  },
  {
    slug: 'feature',
    title: 'Feature',
    hintZh: '设计数据形状 → 实现 → 验证',
    hintEn: 'Shape data → build → verify',
    stanceZh: '先把领域与边界建模清楚，拆成可验证的最小步骤逐个落地。',
    stanceEn: 'Model the domain first, sequence into verifiable units, prove it works.',
    previewSteps: [
      'Explore existing patterns & constraints',
      'Model data shapes & module boundaries',
      'Decompose into small verifiable units',
      'Implement unit by unit with tests',
      'Run full checks & end-to-end verification',
      'Clean up comments & summarize changes',
    ],
    previewStepsZh: [
      '摸清现有代码模式与约束条件',
      '先建模数据结构与模块边界',
      '拆解为最小可独立验证的实施单元',
      '逐单元编写测试并落地实现',
      '运行全量检查与端到端实证',
      '清理多余注释并汇总改动说明',
    ],
  },
  {
    slug: 'hillclimb',
    title: 'Hillclimb',
    hintZh: '冻结基准 → 假设循环 → 越过噪声',
    hintEn: 'Freeze harness → iterate past noise',
    stanceZh: '先冻结基准与门禁文件，每次实验必须过统计噪声且工作量不变才保留。',
    stanceEn: 'Freeze benchmark & gate files; keep only statistically significant gains.',
    previewSteps: [
      'Freeze benchmark & correctness gate files (SHA-256)',
      'Capture baseline median, MAD & work count',
      'Form a single focused performance hypothesis',
      'Run attempt: measure N samples & gate check',
      'Keep path-only commit or revert cleanly',
    ],
    previewStepsZh: [
      '用 SHA-256 冻结基准脚本与正确性门禁文件',
      '采集基线中位数、MAD 噪声带与工作量计数',
      '提出单一明确的性能优化假设',
      '执行多轮采样并运行正确性门禁',
      '越过噪声则按路径提交，否则干净回滚',
    ],
  },
  {
    slug: 'investigation',
    title: 'Investigation',
    hintZh: '只读取证，找到根因再动代码',
    hintEn: 'Read-only root-cause forensics',
    stanceZh: '调查期间锁死写工具：只读取证、验证假设，拿到确凿根因再决定修改。',
    stanceEn: 'Read-only forensics: write tools locked until root cause is proven.',
    previewSteps: [
      'Reproduce symptoms & gather primary logs/traces',
      'Map code paths & form falsifiable hypotheses',
      'Test each hypothesis against live evidence',
      'Report confirmed root cause & proposed fix',
    ],
    previewStepsZh: [
      '复现症状并收集一手日志与调用链证据',
      '梳理代码路径并列出可证伪的假设',
      '逐条对照真实运行证据验证或排除假设',
      '输出确凿根因结论与下一步修复建议',
    ],
  },
  {
    slug: 'refactoring',
    title: 'Refactoring',
    hintZh: '先减后加，行为等价',
    hintEn: 'Subtract first, preserve behavior',
    stanceZh: '先减后加：先用行为测试兜底，迁移所有调用方后删掉旧接口。',
    stanceEn: 'Subtract before adding; lock behavior with tests, migrate callers, delete legacy.',
    previewSteps: [
      'Lock observable behavior with tests',
      'Identify dead code & redundant abstractions',
      'Migrate callers cleanly to target shape',
      'Delete legacy paths & verify green checks',
    ],
    previewStepsZh: [
      '先用行为测试锁住外部可观测结果',
      '识别死代码与多余抽象层（先减后加）',
      '将全部调用方平滑迁移到目标形态',
      '删除旧路径并跑通全量校验',
    ],
  },
  {
    slug: 'babysit',
    title: 'Babysit',
    hintZh: '盯紧 PR，严禁强推与变基',
    hintEn: 'Drive PR checks, never force-push',
    stanceZh: '看护 PR 至绿灯可合入：运行时禁止一切 force-push 与 rebase。',
    stanceEn: 'Drive PR checks & review threads to green; force-push denied by runtime.',
    previewSteps: [
      'Inspect open CI checks & review threads',
      'Reproduce & fix failures with additive commits',
      'Never rebase, retarget, or force-push',
      'Verify CI green & summarize status for operator',
    ],
    previewStepsZh: [
      '巡检当前 PR 的 CI 检查与评审讨论串',
      '复现失败项并以增量提交修复问题',
      '全程严禁 rebase、改目标分支或 force-push',
      '确认全绿后向操作者汇总可合入状态',
    ],
  },
]

export interface LoadedPlaybookCatalog {
  readonly bySlug: ReadonlyMap<string, Playbook>
  readonly knownSkills: ReadonlySet<string>
}

export function playbookSlugFromPath(filePath: string): string | undefined {
  const normalized = filePath.replaceAll('\\', '/')
  const match = /(?:^|\/)playbooks\/([a-z0-9-]+)\.md$/i.exec(normalized)
  return match === null ? undefined : (match[1] as string).toLowerCase()
}

export function skillNameFromPath(filePath: string): string | undefined {
  const normalized = filePath.replaceAll('\\', '/')
  const match = /(?:^|\/)skills\/([a-z0-9-]+)\/SKILL\.md$/i.exec(normalized)
  return match === null ? undefined : (match[1] as string).toLowerCase()
}

export function resolvePlaybookSlug(input: string): string {
  const trimmed = input.trim()
  const byTitle = PLAYBOOK_TITLES.find((title) => title.toLowerCase() === trimmed.toLowerCase())
  return playbookSlug(byTitle ?? trimmed)
}
