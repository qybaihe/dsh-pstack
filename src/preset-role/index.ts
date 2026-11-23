/**
 * Scoped persona and tool-surface discipline mounted inside each of pstack's
 * five Agent Presets (`poteto-agent`, `comment-sicko`, `pstack-adversary`,
 * `pstack-judge`, `pstack-worker`).
 *
 * Read-only roles (`comment-sicko` and `pstack-judge`) enforce a strict
 * capability ALLOWLIST (`read`, `glob`, `grep`, `skill`) through both
 * `ctx.tools.restrict` and a synchronous `ctx.tools.guard`, so neither host
 * write/shell tools nor global `pstack_*` effect tools can execute.
 *
 * @module @qybaihe/dsh-pstack/preset-role
 */

import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { loadVendoredCatalog } from '../host/dsh.ts'

export const name = 'pstack-preset-role'
export const inject = ['systemPrompt', 'tools']

export type PresetRoleId =
  | 'poteto-agent'
  | 'comment-sicko'
  | 'pstack-adversary'
  | 'pstack-judge'
  | 'pstack-worker'

export interface Config {
  role: PresetRoleId
}

export const Config: Schema<Config, Config> = Schema.object({
  role: Schema.union([
    'poteto-agent',
    'comment-sicko',
    'pstack-adversary',
    'pstack-judge',
    'pstack-worker',
  ] as const).required(),
})

export const READ_ONLY_ALLOWED_TOOLS: ReadonlySet<string> = new Set(['read', 'glob', 'grep', 'skill'])

const READ_ONLY_ROLES = new Set<PresetRoleId>(['comment-sicko', 'pstack-judge'])

export function promptForRole(role: PresetRoleId): string {
  const catalog = loadVendoredCatalog()
  const potetoSkillPath =
    catalog.vendorRoot === undefined
      ? 'vendor/pstack/skills/poteto-mode/SKILL.md'
      : join(catalog.vendorRoot, 'skills', 'poteto-mode', 'SKILL.md')
  const workerPath =
    catalog.vendorRoot === undefined
      ? 'vendor/pstack/skills/poteto-mode/worker.md'
      : join(catalog.vendorRoot, 'skills', 'poteto-mode', 'worker.md')

  switch (role) {
    case 'poteto-agent':
      return [
        catalog.potetoAgentBody,
        '',
        `Bundled poteto-mode SKILL.md path: \`${potetoSkillPath}\``,
        `Bundled worker.md path: \`${workerPath}\``,
        '',
        '### Worker rules',
        catalog.workerRulesBody,
      ].join('\n')

    case 'comment-sicko':
      return [
        '# Comment Sicko (Read-Only Preset)',
        catalog.commentSickoBody,
        '',
        'You are running in a strictly read-only preset. Inspect files with `read`, `glob`, and `grep` only, and return your report starting with `Yes... Ha ha ha... Yes!`.',
      ].join('\n')

    case 'pstack-adversary':
      return [
        '# Interrogate Adversarial Reviewer',
        'Your job is to break the proposed change or design with concrete, reproducible evidence.',
        '- Every finding MUST include an exact shell reproduction `command` that exits non-zero when the defect is present.',
        '- Never submit prose-only hunches; the harness independently re-runs every command and discards any claim whose command passes or is omitted.',
        '- Stay strictly inside your assigned worktree.',
        '',
        catalog.workerRulesBody,
      ].join('\n')

    case 'pstack-judge':
      return [
        '# Arena Cross-Vendor Judge (Read-Only Preset)',
        'Score every submitted candidate against each criterion on the rubric (1 to 5), compute totals, recommend a single base candidate (`A`, `B`, `C`...), and state whether candidates converged on the same shape or diverged.',
        'Base your judgment strictly on diffs, test evidence, and rubric criteria — never prose length or style.',
      ].join('\n')

    case 'pstack-worker':
      return [
        '# Swarm Slice Worker',
        'Execute only your assigned slice. Your final report MUST state:',
        '- `status`: `PASS`, `ISSUES`, or `BLOCKED`',
        '- `sha`: the commit SHA (or `file:line` / `none-needed` for pure verification slices) proving the work',
        '- `approach`: one concise sentence naming what changed and how it was verified',
        'Reports missing `status`, `sha`, or `approach` are automatically rejected and re-dispatched by the harness.',
        '',
        catalog.workerRulesBody,
      ].join('\n')
  }
}

export function apply(ctx: Context, config: Config): void {
  ctx.systemPrompt.section({
    name: `pstack:preset:${config.role}`,
    order: 250,
    text: promptForRole(config.role),
    interpolate: false,
  })

  if (READ_ONLY_ROLES.has(config.role)) {
    try {
      const allowedPresent = [...READ_ONLY_ALLOWED_TOOLS].filter((toolName) => {
        try {
          return ctx.tools.get(toolName) !== undefined
        } catch {
          return false
        }
      })
      ctx.effect(() => ctx.tools.restrict({ allow: allowedPresent }))
    } catch {
      // Root-context dry load has no agent scope; the guard below still enforces the exact allowlist.
    }

    ctx.effect(() =>
      ctx.tools.guard((exec) => {
        if (!READ_ONLY_ALLOWED_TOOLS.has(exec.name)) {
          return {
            reason: `🥔 Preset "${config.role}" is strictly read-only and cannot call \`${exec.name}\`. Allowed tools: ${[...READ_ONLY_ALLOWED_TOOLS].join(', ')}.`,
            info: { name: 'PstackReadOnlyPresetError', code: 'PSTACK_READ_ONLY_PRESET' },
          }
        }
        return undefined
      }),
    )
  }
}
