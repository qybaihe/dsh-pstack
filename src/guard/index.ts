/**
 * Enforces pstack's git and irreversible-action rules on shell tool calls.
 *
 * A rule the agent can satisfy by rewriting its command is a guard denial,
 * which no other plugin can turn back into permission. A rule that needs a
 * person, such as a force push, raises an approval and never overrides
 * another plugin's denial.
 *
 * @module @qybaihe/dsh-pstack/guard
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution, ToolGuardDenial } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_SHELL_POLICY, classifyShellCommand } from '../core/shell-policy.ts'
import type { ShellPolicyOptions, ShellVerdict } from '../core/shell-policy.ts'

export const name = 'pstack-guard'
export const inject = ['tools']

export interface Config {
  /** Tools whose `command` argument is a shell command line. */
  shellTools: string[]
  /** A leased force push to one of these branches still asks. */
  protectedBranches: string[]
  /** Deny every force push, as the babysit playbook requires. */
  forbidForcePush: boolean
  /** Regex sources for commands that publish or deploy. A match asks. */
  askPatterns: string[]
}

export const Config: Schema<Partial<Config>, Config> = Schema.object({
  shellTools: Schema.array(Schema.string()).default(['bash', 'pwsh']),
  protectedBranches: Schema.array(Schema.string()).default([...DEFAULT_SHELL_POLICY.protectedBranches]),
  forbidForcePush: Schema.boolean().default(DEFAULT_SHELL_POLICY.forbidForcePush),
  askPatterns: Schema.array(Schema.string()).default([...DEFAULT_SHELL_POLICY.askPatterns]),
})

type Call = Pick<ToolExecution, 'name' | 'arguments'>

/** The shell command line of a call, or undefined when the call is not a shell call. */
export function shellCommandOf(call: Call, shellTools: readonly string[]): string | undefined {
  if (!shellTools.includes(call.name)) return undefined
  const args = call.arguments
  if (typeof args !== 'object' || args === null || !('command' in args)) return undefined
  return typeof args.command === 'string' ? args.command : undefined
}

export function verdictFor(call: Call, config: Config): ShellVerdict {
  const command = shellCommandOf(call, config.shellTools)
  if (command === undefined) return { kind: 'allow' }
  const policy: ShellPolicyOptions = {
    protectedBranches: config.protectedBranches,
    forbidForcePush: config.forbidForcePush,
    askPatterns: config.askPatterns,
  }
  return classifyShellCommand(command, policy)
}

const errorCode = (rule: string): string => `PSTACK_${rule.toUpperCase().replaceAll('-', '_')}`

export function denialFor(call: Call, config: Config): ToolGuardDenial | undefined {
  const verdict = verdictFor(call, config)
  if (verdict.kind !== 'deny') return undefined
  return {
    reason: `pstack blocked \`${verdict.command}\`. ${verdict.reason} ${verdict.instead}`,
    info: { name: 'PstackGuardError', code: errorCode(verdict.rule) },
  }
}

export function approvalFor(call: Call, config: Config): Extract<PreToolDecision, { kind: 'ask' }> | undefined {
  const verdict = verdictFor(call, config)
  if (verdict.kind !== 'ask') return undefined
  return {
    kind: 'ask',
    reason: `pstack ${verdict.rule}: ${verdict.command}`,
    displayReason: {
      en: `pstack pauses for irreversible actions. ${verdict.reason}`,
      zh: `pstack 对不可逆操作会先停下来确认：${verdict.command}`,
    },
  }
}

export function apply(ctx: Context, config: Config): void {
  // Fail at load, not on the first shell call, when a pattern is not a regex.
  for (const source of config.askPatterns) new RegExp(source)

  ctx.effect(() => ctx.tools.guard((execution) => denialFor(execution, config)))

  ctx.on('tools/pre-execute', async (execution, next) => {
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    return approvalFor(execution, config) ?? decision
  })
}
