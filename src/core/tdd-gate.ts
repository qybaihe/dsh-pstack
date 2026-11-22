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
    '\\b(npm|pnpm|yarn|bun)( run)? test\\b',
    '\\b(vitest|jest|mocha|ava|rspec|phpunit|pytest|tox)\\b',
    '\\bplaywright test\\b',
    '\\bcypress run\\b',
    '\\bnode\\b.* --test\\b',
    '\\bpython3? -m (pytest|unittest)\\b',
    '\\b(go|cargo|deno|bun|dotnet|swift|mix|flutter|dart) test\\b',
    '\\bcargo nextest\\b',
    '\\b(mvn|mvnw|gradle|gradlew)\\b.*\\btest\\b',
    '\\bxcodebuild\\b.*\\btest\\b',
    '\\bmake (test|check)\\b',
  ],
}

const matches = (sources: readonly string[], value: string): boolean =>
  sources.some((source) => new RegExp(source).test(value))

export const isTestPath = (path: string, options: TddOptions = DEFAULT_TDD_OPTIONS): boolean =>
  matches(options.testPaths, path)

export const isTestCommand = (command: string, options: TddOptions = DEFAULT_TDD_OPTIONS): boolean =>
  matches(options.testCommands, command)

export type WriteDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'deny'; readonly reason: string; readonly instead: string }

/** Decide a file write. Only `red-pending` closes production code. */
export function decideWrite(state: TddState, path: string, options: TddOptions = DEFAULT_TDD_OPTIONS): WriteDecision {
  if (state.phase !== 'red-pending') return { kind: 'allow' }
  if (isTestPath(path, options) || matches(options.alwaysWritable, path)) return { kind: 'allow' }
  return {
    kind: 'deny',
    reason: `The TDD gate is waiting for a failing test run, and ${path} is production code.`,
    instead:
      'Write the smallest test that would have caught the bug, run it, and confirm it fails. Production code opens after that run. If no cheap test path exists, ask the user to turn the gate off with /tdd off.',
  }
}
