/**
 * The tdd skill's ordering rule as a state machine: production code opens only
 * after a test run has been seen to fail.
 *
 * Source: skills/tdd/SKILL.md steps 3 to 6 ("Write the failing test first",
 * "Run the new test before fixing", "Rerun the regression test").
 *
 * The gate enforces the order of events. Whether the test failed for the
 * intended reason stays a judgment the agent owns.
 */

import { safeRegExp, simpleCommands, unwrapCommandWords } from './shell-policy.ts'

export interface TestRun {
  readonly command: string
  readonly exitCode: number
  readonly at: string
}

export type TddState =
  | { readonly phase: 'off' }
  | { readonly phase: 'red-pending' }
  | { readonly phase: 'red-observed'; readonly red: TestRun }
  | { readonly phase: 'green'; readonly red: TestRun; readonly green: TestRun }

export type TddEvent =
  | { readonly type: 'arm' }
  | { readonly type: 'disarm' }
  | { readonly type: 'test-run'; readonly run: TestRun }

export const TDD_OFF: TddState = { phase: 'off' }

export function reduceTdd(state: TddState, event: TddEvent): TddState {
  if (event.type === 'arm') return { phase: 'red-pending' }
  if (event.type === 'disarm') return TDD_OFF
  const failed = event.run.exitCode !== 0
  switch (state.phase) {
    case 'off':
      return state
    case 'red-pending':
      return failed ? { phase: 'red-observed', red: event.run } : state
    case 'red-observed':
      return failed ? state : { phase: 'green', red: state.red, green: event.run }
    case 'green':
      return failed ? { phase: 'red-observed', red: state.red } : { ...state, green: event.run }
  }
}

export interface TddOptions {
  /** Regex sources. A path that matches one is a test or a test fixture. */
  readonly testPaths: readonly string[]
  /** Regex sources. A path that matches one is never production code. */
  readonly alwaysWritable: readonly string[]
  /** Regex sources. A shell command that matches one is a test run. */
  readonly testCommands: readonly string[]
}

export const DEFAULT_TDD_OPTIONS: TddOptions = {
  testPaths: [
    '(^|/)(tests?|__tests__|spec|specs|e2e|testdata|fixtures|__fixtures__|__mocks__)/',
    '\\.(test|spec)\\.[cm]?[jt]sx?$',
    '_test\\.(go|py|rb|exs|dart)$',
    '(^|/)test_[^/]+\\.py$',
    '_spec\\.rb$',
    'Tests?\\.(java|kt|cs|swift|scala)$',
  ],
  alwaysWritable: ['\\.(md|mdx|txt)$', '(^|/)\\.audit/', '(^|/)decisions?\\.tsv$'],
  testCommands: [
    '^(npx |pnpx |bunx )?(npm|pnpm|yarn|bun)( run)? test\\b',
    '^(npx |pnpx |bunx |uv run |poetry run |bundle exec )?(vitest|jest|mocha|ava|rspec|phpunit|pytest|tox)\\b',
    '^(npx |pnpx |bunx )?playwright test\\b',
    '^(npx |pnpx |bunx )?cypress run\\b',
    '^node\\b.* --test\\b',
    '^python3? -m (pytest|unittest)\\b',
    '^(go|cargo|deno|bun|dotnet|swift|mix|flutter|dart) test\\b',
    '^cargo nextest\\b',
    '^(\\.\\/)?(mvn|mvnw|gradle|gradlew)\\b.*\\btest\\b',
    '^xcodebuild\\b.*\\btest\\b',
    '^make (test|check)\\b',
  ],
}

const NON_TEST_EXECUTABLES = new Set(['echo', 'printf', 'cat', 'grep', 'rg', 'git', 'true', 'false', 'ls', 'pwd', 'rm', 'cp', 'mv'])

/**
 * Canonicalize a file path using POSIX segments so `tests/../src/a.ts` resolves
 * to `src/a.ts` and `../outside.ts` is flagged as escaping the workspace root.
 */
export function normalizePathForGate(rawPath: string): { readonly normalized: string; readonly escapesRoot: boolean } {
  const slash = rawPath.trim().replaceAll('\\', '/')
  const isAbs = slash.startsWith('/')
  const parts = slash.split('/')
  const stack: string[] = []
  let escapesRoot = false

  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (stack.length > 0) {
        stack.pop()
      } else if (!isAbs) {
        escapesRoot = true
      }
      continue
    }
    stack.push(part)
  }

  return {
    normalized: (isAbs ? '/' : '') + stack.join('/'),
    escapesRoot,
  }
}

const matches = (sources: readonly string[], value: string): boolean => {
  const bounded = value.length > 4096 ? value.slice(0, 4096) : value
  return sources.some((source) => safeRegExp(source)?.test(bounded) === true)
}

export const isTestPath = (path: string, options: TddOptions = DEFAULT_TDD_OPTIONS): boolean => {
  const { normalized, escapesRoot } = normalizePathForGate(path)
  if (escapesRoot || normalized === '') return false
  return matches(options.testPaths, normalized)
}

export const isTestCommand = (command: string, options: TddOptions = DEFAULT_TDD_OPTIONS): boolean => {
  const cmds = simpleCommands(command)
  if (cmds.length === 0) return false
  return cmds.some((rawWords) => {
    const words = unwrapCommandWords(rawWords)
    const head = words[0]
    if (head === undefined || NON_TEST_EXECUTABLES.has(head)) return false
    if (head === 'cd') return false
    const simple = words.join(' ')
    return matches(options.testCommands, simple)
  })
}

export type WriteDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly reason: string; readonly instead: string }

/** Decide a file write. Only `red-pending` closes production code. */
export function decideWrite(state: TddState, path: string, options: TddOptions = DEFAULT_TDD_OPTIONS): WriteDecision {
  if (state.phase !== 'red-pending') return { kind: 'allow' }
  const { normalized, escapesRoot } = normalizePathForGate(path)
  if (!escapesRoot && normalized !== '' && (matches(options.testPaths, normalized) || matches(options.alwaysWritable, normalized))) {
    return { kind: 'allow' }
  }
  return {
    kind: 'deny',
    reason: `The TDD gate is waiting for a failing test run, and ${normalized || path} is production code.`,
    instead:
      'Write the smallest test that would have caught the bug, run it, and confirm it fails. Production code opens after that run. If no cheap test path exists, ask the user to turn the gate off with /tdd off.',
  }
}
