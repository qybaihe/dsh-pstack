/**
 * Pure verification and aggregation rules for M2 (arena, interrogate, swarm,
 * comment-sicko) and M4 (autopilot PR stack). None of these touch the harness.
 */

export type ArenaPhase = 'define' | 'fanout' | 'judge' | 'pick' | 'graft' | 'verify'

export const ARENA_PHASES: readonly ArenaPhase[] = ['define', 'fanout', 'judge', 'pick', 'graft', 'verify']

export type CandidateSeatStatus = 'queued' | 'starting' | 'running' | 'submitted' | 'empty'

export interface ArenaCandidate {
  readonly id: string
  readonly model: string
  readonly provider: string
  readonly vendor: string
  readonly effort?: string
  readonly status: CandidateSeatStatus
  readonly durationMs?: number
  readonly worktreePath?: string
  readonly sessionId?: string
  readonly summary?: string
}

export interface ArenaCriterionScore {
  readonly criterion: string
  /** Scores keyed by candidate id (`A`, `B`, `C`...). Absent or null means unscored (`–`). */
  readonly scores: Readonly<Record<string, number | null>>
}

export type ArenaShapeSignal = 'normal' | 'converged' | 'diverged'

export interface ArenaEvaluation {
  readonly totals: Readonly<Record<string, number | null>>
  readonly recommendedBase?: string
  readonly parentChosenBase?: string
  readonly baseDisagreement: boolean
  readonly shape: ArenaShapeSignal
}

export function evaluateArenaMatrix(
  candidates: readonly Pick<ArenaCandidate, 'id' | 'status'>[],
  criteria: readonly ArenaCriterionScore[],
  judgeRecommendedBase?: string,
  shape: ArenaShapeSignal = 'normal',
  parentChosenBase?: string,
): ArenaEvaluation {
  const totals: Record<string, number | null> = {}
  let bestId: string | undefined
  let bestTotal = -Infinity

  for (const candidate of candidates) {
    if (candidate.status !== 'submitted' || criteria.length === 0) {
      totals[candidate.id] = null
      continue
    }
    let sum = 0
    let count = 0
    for (const row of criteria) {
      const val = row.scores[candidate.id]
      if (typeof val === 'number' && Number.isFinite(val)) {
        sum += val
        count += 1
      }
    }
    if (count === 0) {
      totals[candidate.id] = null
    } else {
      totals[candidate.id] = sum
      if (sum > bestTotal) {
        bestTotal = sum
        bestId = candidate.id
      }
    }
  }

  const submittedIds = new Set(candidates.filter((c) => c.status === 'submitted').map((c) => c.id))
  const validJudgeBase =
    judgeRecommendedBase !== undefined && submittedIds.has(judgeRecommendedBase) ? judgeRecommendedBase : undefined
  const recommendedBase = validJudgeBase ?? bestId
  const baseDisagreement =
    recommendedBase !== undefined &&
    parentChosenBase !== undefined &&
    recommendedBase !== parentChosenBase

  return {
    totals,
    ...(recommendedBase === undefined ? {} : { recommendedBase }),
    ...(parentChosenBase === undefined ? {} : { parentChosenBase }),
    baseDisagreement,
    shape,
  }
}

export interface InterrogateClaim {
  readonly reviewerId: string
  readonly title: string
  readonly detail?: string
  readonly command?: string
}

export interface CommandReproOutcome {
  readonly exitCode: number
  readonly output: string
  readonly timedOut?: boolean
  readonly spawnFailed?: boolean
}

export type DiscardReason = 'missing-command' | 'command-passed' | 'invalid-command'

export interface VerifiedFinding {
  readonly title: string
  readonly detail?: string
  readonly command: string
  readonly output: string
  readonly reviewers: readonly string[]
}

export interface ReviewerDiscardSummary {
  readonly reviewerId: string
  readonly missingCommand: number
  readonly commandPassed: number
  readonly invalidCommand?: number
}

export interface InterrogateVerification {
  readonly verified: readonly VerifiedFinding[]
  readonly droppedCount: number
  readonly discards: readonly ReviewerDiscardSummary[]
  readonly summaryText: string
}

/**
 * Interrogate's core rule ("A finding survives only when a run proves it"):
 * claims without a runnable command, claims whose command fails due to a
 * missing executable (126/127) or timeout/spawn error, or claims whose command
 * exits 0 are dropped before reaching the parent context.
 */
export function verifyInterrogateFindings(
  claims: readonly { readonly claim: InterrogateClaim; readonly repro?: CommandReproOutcome }[],
): InterrogateVerification {
  const merged = new Map<string, { title: string; detail?: string; command: string; output: string; reviewers: string[] }>()
  const discardByReviewer = new Map<string, { missingCommand: number; commandPassed: number; invalidCommand: number }>()

  const bumpDiscard = (reviewerId: string, reason: DiscardReason): void => {
    const cur = discardByReviewer.get(reviewerId) ?? { missingCommand: 0, commandPassed: 0, invalidCommand: 0 }
    if (reason === 'missing-command') cur.missingCommand += 1
    else if (reason === 'command-passed') cur.commandPassed += 1
    else cur.invalidCommand += 1
    discardByReviewer.set(reviewerId, cur)
  }

  let droppedCount = 0
  for (const { claim, repro } of claims) {
    const cmd = claim.command?.trim() ?? ''
    if (cmd === '' || repro === undefined) {
      droppedCount += 1
      bumpDiscard(claim.reviewerId, 'missing-command')
      continue
    }
    if (repro.exitCode === 0) {
      droppedCount += 1
      bumpDiscard(claim.reviewerId, 'command-passed')
      continue
    }
    // POSIX 126 (not executable) / 127 (command not found) or timeout/spawn failure is not a defect proof
    if (repro.timedOut === true || repro.spawnFailed === true || repro.exitCode === 126 || repro.exitCode === 127) {
      droppedCount += 1
      bumpDiscard(claim.reviewerId, 'invalid-command')
      continue
    }
    const key = `${claim.title.trim().toLowerCase()}::${cmd}`
    const existing = merged.get(key)
    if (existing !== undefined) {
      if (!existing.reviewers.includes(claim.reviewerId)) existing.reviewers.push(claim.reviewerId)
    } else {
      merged.set(key, {
        title: claim.title.trim(),
        ...(claim.detail === undefined ? {} : { detail: claim.detail }),
        command: cmd,
        output: repro.output,
        reviewers: [claim.reviewerId],
      })
    }
  }

  const verified: VerifiedFinding[] = [...merged.values()]
  const discards: ReviewerDiscardSummary[] = [...discardByReviewer.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([reviewerId, counts]) => ({
      reviewerId,
      missingCommand: counts.missingCommand,
      commandPassed: counts.commandPassed,
      ...(counts.invalidCommand > 0 ? { invalidCommand: counts.invalidCommand } : {}),
    }))

  const summaryText =
    verified.length === 0
      ? 'no verified findings'
      : `${verified.length} verified finding(s), ${droppedCount} unverified claim(s) discarded.`

  return { verified, droppedCount, discards, summaryText }
}

export type SwarmStatus = 'PASS' | 'ISSUES' | 'BLOCKED'

export interface SwarmWorkerOutput {
  readonly status?: string
  readonly sha?: string
  readonly approach?: string
  readonly summary?: string
}

export type SwarmSliceOutcome =
  | {
      readonly valid: true
      readonly status: SwarmStatus
      readonly sha: string
      readonly approach: string
      readonly summary: string
    }
  | {
      readonly valid: false
      readonly action: 'redispatch' | 'gap'
      readonly reason: string
    }

const COMMIT_OR_EVIDENCE = /^(?:[0-9a-f]{7,40}|[^\s:]+\:\d+|none-needed)$/i

/**
 * Swarm's quality bar: a worker report must name `PASS` | `ISSUES` | `BLOCKED`,
 * a commit SHA (or file:line pointer), and what approach it took. Missing
 * evidence triggers one re-dispatch; a second miss becomes an explicit `gap`
 * that never counts as `PASS`.
 */
export function evaluateSwarmSlice(output: SwarmWorkerOutput, attempt: 1 | 2): SwarmSliceOutcome {
  const rawStatus = output.status?.trim().toUpperCase()
  if (rawStatus !== 'PASS' && rawStatus !== 'ISSUES' && rawStatus !== 'BLOCKED') {
    return {
      valid: false,
      action: attempt === 1 ? 'redispatch' : 'gap',
      reason: 'Missing required status (PASS, ISSUES, or BLOCKED).',
    }
  }
  const sha = output.sha?.trim() ?? ''
  const approach = output.approach?.trim() ?? ''
  if (sha === '' || !COMMIT_OR_EVIDENCE.test(sha) || approach === '') {
    return {
      valid: false,
      action: attempt === 1 ? 'redispatch' : 'gap',
      reason: 'Missing commit SHA/evidence pointer or approach summary required by the brief.',
    }
  }
  return {
    valid: true,
    status: rawStatus,
    sha,
    approach,
    summary: output.summary?.trim() || approach,
  }
}

export const SICKO_OPENING = 'Yes... Ha ha ha... Yes!'

export interface SickoReport {
  readonly opening: string
  readonly deleted: number
  readonly mustKill: readonly { readonly symbol: string; readonly reason: string }[]
  readonly review: readonly { readonly quote: string; readonly claimedRule: string }[]
  readonly touchedFiles: readonly string[]
}

export function normalizeSickoReport(raw: Partial<SickoReport>): SickoReport {
  return {
    opening: SICKO_OPENING,
    deleted: Math.max(0, Math.trunc(raw.deleted ?? 0)),
    mustKill: (raw.mustKill ?? [])
      .filter((item): item is { symbol: string; reason: string } => typeof item === 'object' && item !== null)
      .map((item) => ({
        symbol: String(item.symbol ?? '').trim(),
        reason: String(item.reason ?? '').trim(),
      }))
      .filter((item) => item.symbol !== ''),
    review: (raw.review ?? [])
      .filter((item): item is { quote: string; claimedRule: string } => typeof item === 'object' && item !== null)
      .map((item) => ({
        quote: String(item.quote ?? '').trim(),
        claimedRule: String(item.claimedRule ?? '').trim(),
      }))
      .filter((item) => item.quote !== ''),
    touchedFiles: (raw.touchedFiles ?? []).map((f) => String(f ?? '').trim()).filter(Boolean),
  }
}

export interface PrStackItem {
  readonly number: number
  readonly branch: string
  readonly title: string
  readonly status: 'PASS' | 'PENDING' | 'FAIL'
}

/**
 * Autopilot-stack's landing rule (`docs/03-ui.md`): count from the bottom of
 * the stack up to the first PR without `PASS`. Everything below that point is
 * landable; everything at or above waits.
 */
export function contiguousLandablePrefix(stack: readonly PrStackItem[]): {
  readonly landable: readonly PrStackItem[]
  readonly waiting: readonly PrStackItem[]
} {
  let split = 0
  while (split < stack.length && stack[split]?.status === 'PASS') split += 1
  return {
    landable: stack.slice(0, split),
    waiting: stack.slice(split),
  }
}
