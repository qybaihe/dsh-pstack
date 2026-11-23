/**
 * Bilingual (`zh` and `en`) copy for all pstack UI slots.
 */

export const PSTACK_NS = 'pstack'

export const PSTACK_DICT = {
  zh: {
    'tab.title': 'pstack',
    'guide.title': 'pstack 面板',
    'guide.desc': '查看 Playbook 薯条进度、Arena/Interrogate 面板、Hillclimb 折线和决策记录',
    'seg.playbook': 'Playbook',
    'seg.panel': '面板',
    'seg.bench': '实验',
    'seg.ledger': '记录',
    'dock.done': '全部做完',
    'dock.blocks': '拦下 {count} 次',
    'dock.waiting': '{count} 待决',
    'tdd.off': 'TDD 未开',
    'tdd.pending': '等红灯',
    'tdd.red': '红灯已见',
    'tdd.green': '已转绿',
    'tdd.stamp.off': '未开',
    'tdd.stamp.pending': '等红灯',
    'tdd.stamp.red': '红灯已见',
    'tdd.stamp.green': '已转绿',
    'tdd.why.off': '用 /tdd on 或右侧按钮打开',
    'tdd.why.pending': '生产代码锁着，只能写测试',
    'tdd.why.red': '测试退出码非 0，生产代码已放开',
    'tdd.why.green': '同一条测试命令退出码 0',
    'tdd.btn.on': '开启 TDD',
    'tdd.btn.off': '关闭 TDD',
    'pb.empty.title': '尚未激活 Playbook',
    'pb.empty.desc': '在会话中输入 /poteto-mode 加你的任务，或从新会话页直接选择一个 Playbook。',
    'pb.all.show': '全部 22 个',
    'pb.all.hide': '收起列表',
    'pb.goal': '目标',
    'pb.principles': '原则',
    'pb.principles.count': '本会话读过 {read} 条，共 24 条',
    'pb.gates': '门禁',
    'pb.gate.cmd': '命令',
    'pb.gate.push': '强推',
    'pb.gate.forbid': '严禁强推',
    'pb.gate.ask': '要问你',
    'pb.gate.push.note': '审批策略为 never（danger-full-access）时，需确认的命令会被直接安全拒绝。',
    'pb.legend': '实线章是运行时判的，虚线章是代理自己报的。',
    'pb.unread.note': '上一条回复引用了未读原则（{names}）。运行时已要求代理先读完叶技能或删掉引用。',
    'pb.premise.note': '两个修法败在同一关（{cmd}）。先把它们共同的前提写下来并检验，再写第三个。',
    'panel.empty': '本会话还没有运行 Arena、Interrogate 或 Swarm。',
    'panel.total': '合计',
    'panel.cross': '跨厂商',
    'panel.judge.picked': '裁判是 {vendor} 的 {model}{vs}。',
    'panel.judge.skipped': '跳过了裁判：没有配置来自另一家厂商的模型（不会用同厂商模型顶替）。',
    'panel.judge.unknown': '厂商校验未跑：主代理厂商未知，使用池中首选 {model}。',
    'panel.converged': '候选收敛到了同一个形状。这是强一致，直接采用，不需要嫁接。',
    'panel.diverged': '候选严重分歧：说明题目边界还没定清，建议退回重新定题。',
    'panel.disagree': '主代理选的底（{parent}）与跨厂商裁判推荐（{judge}）不同，请先对照两边理由。',
    'panel.diff': '看 {id} 的 diff',
    'panel.adopt': '以 {id} 为底',
    'panel.open': '看评分',
    'panel.queue': '还有 {count} 个子代理在排队（并发上限 8）。',
    'interrogate.empty': 'no verified findings',
    'interrogate.count': '{verified} 条复跑成立，{dropped} 条丢弃',
    'bench.empty': '本会话还没有冻结 Hillclimb 基准（pstack_bench）。',
    'bench.frozen': '基准已冻结',
    'bench.drifted': '基准被动过',
    'bench.gain': '比基线',
    'bench.tries': '尝试',
    'bench.kept': '保留与回滚',
    'bench.plateau': '连续三次回滚，到平台期了。换一类假设、组合差一点的方案，或者回去重读源码。',
    'bench.met': '目标和最少尝试次数都满足了，可以停。',
    'ledger.title': '决策记录',
    'ledger.desc': '只能追加。写错了就补一行盖过去。',
    'ledger.export': '导出 TSV',
    'ledger.empty': '本会话还没有写入决策记录（pstack_log）。',
    'ledger.missing': '第 {rows} 行没有证据。丢掉一个方案或做关键取舍时必须指向提交、文件行号或子会话。',
    'ketchup.head': '{count} 件事等你决定',
    'ketchup.decided': '已拍板：{choice}',
    'row.waiting': '等你',
    'row.autopilot': '巡检中',
    'row.paused': '已暂停',
    'row.done': '做完了',
    'activation.title': '🥔 pstack 已启用',
    'activation.body': '58 个技能与运行时护栏已就绪。新开一个会话输入 /poteto-mode 即可开始；也可在插件详情里按行开关 TDD 门禁、多模型面板与实验台。',
    'activation.details': '查看配置',
    'activation.dismiss': '知道了',
  },
  en: {
    'tab.title': 'pstack',
    'guide.title': 'pstack Panel',
    'guide.desc': 'Playbook fries progress, Arena/Interrogate matrix, Hillclimb chart, and decision ledger',
    'seg.playbook': 'Playbook',
    'seg.panel': 'Panel',
    'seg.bench': 'Bench',
    'seg.ledger': 'Ledger',
    'dock.done': 'All done',
    'dock.blocks': '{count} blocked',
    'dock.waiting': '{count} waiting',
    'tdd.off': 'TDD off',
    'tdd.pending': 'Await red',
    'tdd.red': 'Red seen',
    'tdd.green': 'Green',
    'tdd.stamp.off': 'OFF',
    'tdd.stamp.pending': 'RED?',
    'tdd.stamp.red': 'RED',
    'tdd.stamp.green': 'GREEN',
    'tdd.why.off': 'Turn on with /tdd on or toggle button',
    'tdd.why.pending': 'Production files locked until a test fails',
    'tdd.why.red': 'Failing test observed; production code unlocked',
    'tdd.why.green': 'Regression test exited 0',
    'tdd.btn.on': 'Arm TDD',
    'tdd.btn.off': 'Disarm TDD',
    'pb.empty.title': 'No active Playbook',
    'pb.empty.desc': 'Type /poteto-mode with your task, or pick a playbook from the new-session hero.',
    'pb.all.show': 'All 22',
    'pb.all.hide': 'Fewer',
    'pb.goal': 'Goal',
    'pb.principles': 'Principles',
    'pb.principles.count': '{read} of 24 read this session',
    'pb.gates': 'Gates',
    'pb.gate.cmd': 'Shell',
    'pb.gate.push': 'Push',
    'pb.gate.forbid': 'DENIED',
    'pb.gate.ask': 'ASK',
    'pb.gate.push.note': 'Under approval policy "never" (danger-full-access), ask-gated commands are safely denied instead of prompting.',
    'pb.legend': 'Solid stamps are runtime verdicts; dashed stamps are agent reports.',
    'pb.unread.note': 'Last reply cited unread principle(s): {names}. Agent was steered to read the leaf SKILL.md or drop the citation.',
    'pb.premise.note': 'Two fixes failed the same gate ({cmd}). Write down and test their shared premise first.',
    'panel.empty': 'No Arena, Interrogate, or Swarm run in this session yet.',
    'panel.total': 'Total',
    'panel.cross': 'CROSS',
    'panel.judge.picked': 'Judge is {vendor}/{model}{vs}.',
    'panel.judge.skipped': 'Skipped judge: no model from another vendor is configured.',
    'panel.judge.unknown': 'Vendor check skipped (parent vendor unknown); using {model}.',
    'panel.converged': 'Candidates converged on the same shape. Pick directly without grafting.',
    'panel.diverged': 'Candidates diverged sharply; tighten the task framing first.',
    'panel.disagree': 'Parent base ({parent}) differs from cross-judge recommendation ({judge}); compare rationales first.',
    'panel.diff': 'View {id} diff',
    'panel.adopt': 'Use {id} as base',
    'panel.open': 'Open matrix',
    'panel.queue': '{count} subagent(s) queued behind concurrency cap (8).',
    'interrogate.empty': 'no verified findings',
    'interrogate.count': '{verified} verified, {dropped} discarded',
    'bench.empty': 'No Hillclimb benchmark frozen in this session yet.',
    'bench.frozen': 'FROZEN',
    'bench.drifted': 'DRIFTED',
    'bench.gain': 'vs Baseline',
    'bench.tries': 'Attempts',
    'bench.kept': 'Kept / Reverted',
    'bench.plateau': 'Three reverts in a row (plateau). Change hypothesis class, combine near-misses, or re-read source.',
    'bench.met': 'Target gain and minimum attempts both met.',
    'ledger.title': 'Decision Ledger',
    'ledger.desc': 'Append-only TSV. Supersede earlier calls by logging a new row.',
    'ledger.export': 'Export TSV',
    'ledger.empty': 'No decision rows logged in this session yet.',
    'ledger.missing': 'Row(s) {rows} lack evidence. Point to a commit SHA, file:line, or subagent session.',
    'ketchup.head': '{count} decision(s) waiting for you',
    'ketchup.decided': 'Decided: {choice}',
    'row.waiting': 'waiting',
    'row.autopilot': 'patrol',
    'row.paused': 'paused',
    'row.done': 'done',
    'activation.title': '🥔 pstack enabled',
    'activation.body': '58 skills and runtime guards are active. Start a session with /poteto-mode, or toggle individual rows on the bundle page.',
    'activation.details': 'Configure',
    'activation.dismiss': 'Got it',
  },
} as const

export type PstackDictKey = keyof typeof PSTACK_DICT.zh
export type PstackTranslate = (key: PstackDictKey, vars?: Record<string, string | number>) => string

/** Detect Chinese locale; non-`zh` browser/document locales default to English. */
export function isChineseLocale(): boolean {
  if (typeof document !== 'undefined' && typeof document.documentElement?.lang === 'string') {
    const htmlLang = document.documentElement.lang.trim().toLowerCase()
    if (htmlLang !== '') return htmlLang.startsWith('zh')
  }
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
    const navLang = navigator.language.trim().toLowerCase()
    if (navLang !== '') return navLang.startsWith('zh')
  }
  return true
}

export function fallbackT(key: PstackDictKey, vars?: Record<string, string | number>): string {
  const dict = isChineseLocale() ? PSTACK_DICT.zh : PSTACK_DICT.en
  let template: string = dict[key] ?? PSTACK_DICT.en[key] ?? key
  if (vars !== undefined) {
    for (const [k, v] of Object.entries(vars)) {
      template = template.replaceAll(`{${k}}`, String(v))
    }
  }
  return template
}

/** Prefer DSH's reactive locale binder when available, falling back safely to `PSTACK_DICT`. */
export function createBoundTranslate(
  bound?: ((key: string, vars?: Record<string, string | number>) => string) | undefined,
): PstackTranslate {
  if (typeof bound !== 'function') return fallbackT
  return (key, vars) => {
    try {
      const out = bound(key, vars)
      if (typeof out === 'string' && out !== '' && out !== key && !out.endsWith(`.${key}`)) {
        return out
      }
    } catch {
      // Fall through to static dictionary.
    }
    return fallbackT(key, vars)
  }
}
