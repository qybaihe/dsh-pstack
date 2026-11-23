/**
 * Enforces pstack's git and irreversible-action rules on shell tool calls.
 *
 * A rule the agent can satisfy by rewriting its command is a guard denial,
 * which no other plugin can turn back into permission. A rule that needs a
 * person, such as a force push, raises an approval and never overrides
 * another plugin's denial.
 *
 * When `pstack-playbook` or `pstack-autopilot` is active in the same runtime,
 * sessions running `babysit` or `autopilot-stack` upgrade force-push from
 * approval to outright denial, `autopilot-stack` holds `gh pr merge`, and
 * `/correct` rules (`askPatterns`, `denyPatterns`, `protectedBranches`) persist
 * and take effect immediately.
 *
 * @module @qybaihe/dsh-pstack/guard
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PreToolDecision, ToolExecution, ToolGuardDenial } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import {
  DEFAULT_SHELL_POLICY,
  classifyShellCommand,
  safeRegExp,
  simpleCommands,
  unwrapCommandWords,
} from '../core/shell-policy.ts'
import type { ShellPolicyOptions, ShellVerdict } from '../core/shell-policy.ts'
import { registerRpc, runtimeFor } from '../host/state.ts'
import type { PstackRuntime } from '../host/state.ts'

export const name = 'pstack-guard'
export const inject = ['tools']

export interface DenyPatternRule {
  pattern: string
  reason: string
  instead: string
}

export interface Config {
  /** Tools whose `command` argument is a shell command line. */
  shellTools: string[]
  /** A leased force push to one of these branches still asks. */
  protectedBranches: string[]
  /** Deny every force push, as the babysit playbook requires. */
  forbidForcePush: boolean
  /** Regex sources for commands that publish or deploy. A match asks. */
  askPatterns: string[]
  /** Regex deny rules added by configuration or `/correct`. */
  denyPatterns: DenyPatternRule[]
}

export const Config: Schema<Partial<Config>, Config> = Schema.object({
  shellTools: Schema.array(Schema.string()).default(['bash', 'pwsh']),
  protectedBranches: Schema.array(Schema.string()).default([...DEFAULT_SHELL_POLICY.protectedBranches]),
  forbidForcePush: Schema.boolean().default(DEFAULT_SHELL_POLICY.forbidForcePush),
  askPatterns: Schema.array(Schema.string()).default([...DEFAULT_SHELL_POLICY.askPatterns]),
  denyPatterns: Schema.array(
    Schema.object({
      pattern: Schema.string().required(),
      reason: Schema.string().default('Blocked by configured pstack guard rule.'),
      instead: Schema.string().default('Rewrite the command to avoid this pattern.'),
    }),
  ).default([]),
})

type Call = Pick<ToolExecution, 'name' | 'arguments'> & { readonly agent?: Agent | { readonly id?: string } }

/** The shell command line of a call, or undefined when the call is not a shell call. */
export function shellCommandOf(call: Pick<ToolExecution, 'name' | 'arguments'>, shellTools: readonly string[]): string | undefined {
  if (!shellTools.includes(call.name)) return undefined
  const args = call.arguments
  if (typeof args !== 'object' || args === null || !('command' in args)) return undefined
  return typeof args.command === 'string' ? args.command : undefined
}

export function verdictFor(call: Call, config: Config, runtime?: PstackRuntime): ShellVerdict {
  const command = shellCommandOf(call, config.shellTools)
  if (command === undefined) return { kind: 'allow' }

  const sessionPolicy =
    runtime !== undefined && call.agent !== undefined
      ? runtime.policyForAgent(call.agent as Agent)
      : undefined

  const allDenyRules = [
    ...(config.denyPatterns ?? []),
    ...(runtime?.extraGuard.denyPatterns ?? []),
  ]
  if (allDenyRules.length > 0) {
    const compiled = allDenyRules
      .map((entry) => ({ entry, regex: safeRegExp(entry.pattern) }))
      .filter((item): item is { entry: DenyPatternRule; regex: RegExp } => item.regex !== undefined)
    for (const rawWords of simpleCommands(command)) {
      const words = unwrapCommandWords(rawWords)
      const simple = words.join(' ')
      const bounded = simple.length > 4096 ? simple.slice(0, 4096) : simple
      const matched = compiled.find(({ regex }) => regex.test(bounded))
      if (matched !== undefined) {
        return {
          kind: 'deny',
          rule: 'deploy',
          command: simple,
          reason: matched.entry.reason,
          instead: matched.entry.instead,
        }
      }
    }
  }

  // Autopilot-stack holds PR merges at verified state until human release (checks unwrapped words!)
  if (sessionPolicy?.holdPrMerge === true) {
    for (const rawWords of simpleCommands(command)) {
      const words = unwrapCommandWords(rawWords)
      if (words[0] === 'gh' && words[1] === 'pr' && words[2] === 'merge') {
        return {
          kind: 'deny',
          rule: 'deploy',
          command: words.join(' '),
          reason: 'autopilot-stack stops at verified PRs and leaves landing to the operator.',
          instead: 'Use pstack_ketchup to present the verified PR stack for user sign-off.',
        }
      }
    }
  }

  const protectedBranches = runtime === undefined
    ? config.protectedBranches
    : [...new Set([...config.protectedBranches, ...runtime.extraGuard.protectedBranches])]
  const askPatterns = runtime === undefined
    ? config.askPatterns
    : [...new Set([...config.askPatterns, ...runtime.extraGuard.askPatterns])]

  const policy: ShellPolicyOptions = {
    protectedBranches,
    ...(sessionPolicy?.currentBranch ? { currentBranch: sessionPolicy.currentBranch } : {}),
    forbidForcePush: config.forbidForcePush || sessionPolicy?.forbidForcePush === true,
    askPatterns,
  }
  return classifyShellCommand(command, policy)
}

const errorCode = (rule: string): string => `PSTACK_${rule.toUpperCase().replaceAll('-', '_')}`

export function denialFor(call: Call, config: Config, runtime?: PstackRuntime): ToolGuardDenial | undefined {
  const verdict = verdictFor(call, config, runtime)
  if (verdict.kind !== 'deny') return undefined
  const isMergeHold = verdict.reason.startsWith('autopilot-stack stops at verified PRs')
  return {
    reason: `🥔 pstack blocked \`${verdict.command}\`. ${verdict.reason} ${verdict.instead}`,
    info: {
      name: 'PstackGuardError',
      code: isMergeHold ? 'PSTACK_AUTOPILOT_MERGE_HOLD' : errorCode(verdict.rule),
    },
  }
}

export function approvalFor(
  call: Call,
  config: Config,
  runtime?: PstackRuntime,
): Extract<PreToolDecision, { kind: 'ask' }> | undefined {
  const verdict = verdictFor(call, config, runtime)
  if (verdict.kind !== 'ask') return undefined
  return {
    kind: 'ask',
    reason: `pstack ${verdict.rule}: ${verdict.command}`,
    displayReason: {
      en: `🥔 pstack pauses for irreversible actions. ${verdict.reason}`,
      zh: `🥔 pstack 对不可逆操作会先停下来确认：${verdict.command}`,
    },
  }
}

export function apply(ctx: Context, config: Config): void {
  const runtime = runtimeFor(ctx)

  registerRpc(ctx, runtime, 'classifyCommand', async (payload) => {
    const req = payload as {
      command?: unknown
      protectedBranches?: unknown
      askPatterns?: unknown
      denyPatterns?: unknown
      forbidForcePush?: unknown
      sessionId?: unknown
    } | undefined
    const cmd = typeof req?.command === 'string' ? req.command : ''
    const customBranches = Array.isArray(req?.protectedBranches) ? (req.protectedBranches as string[]) : undefined
    const customAsks = Array.isArray(req?.askPatterns) ? (req.askPatterns as string[]) : undefined
    const customDenies = Array.isArray(req?.denyPatterns) ? (req.denyPatterns as DenyPatternRule[]) : undefined
    const customForbid = typeof req?.forbidForcePush === 'boolean' ? req.forbidForcePush : undefined

    const allPatterns = [
      ...(customAsks ?? config.askPatterns),
      ...(customDenies ?? config.denyPatterns ?? []).map((d) => d.pattern),
    ]
    for (const pat of allPatterns) {
      if (safeRegExp(pat) === undefined) {
        return { kind: 'invalid', error: `Invalid regular expression: ${pat}` }
      }
    }

    const effectiveConfig: Config = {
      shellTools: config.shellTools,
      protectedBranches: customBranches ?? config.protectedBranches,
      forbidForcePush: customForbid ?? config.forbidForcePush,
      askPatterns: customAsks ?? config.askPatterns,
      denyPatterns: customDenies ?? config.denyPatterns ?? [],
    }
    const agentStub = typeof req?.sessionId === 'string' && req.sessionId !== '' ? { id: req.sessionId } : undefined
    return verdictFor(
      { name: 'bash', arguments: { command: cmd }, ...(agentStub ? { agent: agentStub } : {}) },
      effectiveConfig,
      runtime,
    )
  })

  ctx.effect(() => ctx.tools.guard((execution) => denialFor(execution as Call, config, runtime)))

  ctx.on('tools/pre-execute', async (execution, next) => {
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    return approvalFor(execution as Call, config, runtime) ?? decision
  })
}
