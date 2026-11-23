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
    readonly command: string;
    readonly exitCode: number;
    readonly at: string;
}
export type TddState = {
    readonly phase: 'off';
} | {
    readonly phase: 'red-pending';
} | {
    readonly phase: 'red-observed';
    readonly red: TestRun;
} | {
    readonly phase: 'green';
    readonly red: TestRun;
    readonly green: TestRun;
};
export type TddEvent = {
    readonly type: 'arm';
} | {
    readonly type: 'disarm';
} | {
    readonly type: 'test-run';
    readonly run: TestRun;
};
export declare const TDD_OFF: TddState;
export declare function reduceTdd(state: TddState, event: TddEvent): TddState;
export interface TddOptions {
    /** Regex sources. A path that matches one is a test or a test fixture. */
    readonly testPaths: readonly string[];
    /** Regex sources. A path that matches one is never production code. */
    readonly alwaysWritable: readonly string[];
    /** Regex sources. A shell command that matches one is a test run. */
    readonly testCommands: readonly string[];
}
export declare const DEFAULT_TDD_OPTIONS: TddOptions;
/**
 * Canonicalize a file path using POSIX segments so `tests/../src/a.ts` resolves
 * to `src/a.ts` and `../outside.ts` is flagged as escaping the workspace root.
 */
export declare function normalizePathForGate(rawPath: string): {
    readonly normalized: string;
    readonly escapesRoot: boolean;
};
export declare const isTestPath: (path: string, options?: TddOptions) => boolean;
export declare const isTestCommand: (command: string, options?: TddOptions) => boolean;
export type WriteDecision = {
    readonly kind: 'allow';
} | {
    readonly kind: 'deny';
    readonly reason: string;
    readonly instead: string;
};
/** Decide a file write. Only `red-pending` closes production code. */
export declare function decideWrite(state: TddState, path: string, options?: TddOptions): WriteDecision;
