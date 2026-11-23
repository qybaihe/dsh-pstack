/**
 * Narrow TypeScript contracts for DeepSeek Harness host services consumed across
 * pstack's rows, plus the vendored catalog loader, subprocess/shell runners,
 * workspace-cwd resolvers, and ignorable session plugin-record helpers.
 *
 * Verified against DeepSeek Harness Desktop `0.2.2-rc.3` and CLI `0.2.2-rc.5`.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent';
import type { FoldCatalog, FoldEvent } from '../core/projection.ts';
export declare const PSTACK_ROW_IDS: ReadonlySet<string>;
export interface ContentTextBlock {
    readonly type: 'text';
    readonly text: string;
}
export interface DshUserMessage {
    readonly id: string;
    readonly role: 'user';
    readonly content: readonly ContentTextBlock[];
    readonly source: {
        readonly kind: string;
        readonly form?: string;
        readonly summary?: string;
    };
    readonly timestamp?: number;
}
export declare function buildNoticeMessage(text: string, summary?: string): DshUserMessage;
export declare function buildHumanDecisionMessage(text: string): DshUserMessage;
export interface ProjectionUnit<K extends string, S, V = S> {
    readonly key: K;
    readonly stateVersion: number;
    readonly stateSchema: {
        parse(raw: unknown): S;
    };
    init(header: unknown, inheritedEventCount: number): S;
    apply(state: S, event: FoldEvent): S;
    readonly wire?: {
        readonly viewSchema: {
            parse(raw: unknown): V;
        };
        view(state: S): V;
        readonly summary?: boolean;
    };
}
export interface ProjectionHandle<S> {
    stateOf(session: unknown): S;
    dispose(): Promise<void>;
}
export interface SessionProjectionService {
    register<K extends string, S, V = S>(unit: ProjectionUnit<K, S, V>): Promise<ProjectionHandle<S>>;
}
export interface PresetPluginEntry {
    readonly id: string;
    readonly name: string;
    readonly disabled?: unknown;
    readonly group?: boolean;
    readonly isolate?: Record<string, unknown>;
    readonly config?: unknown;
}
export interface PresetDefinition {
    readonly id: string;
    readonly name?: string;
    readonly description?: string;
    readonly order?: number;
    readonly plugins: readonly PresetPluginEntry[];
}
export interface AgentPresetService {
    readonly defaultId: string;
    register(definition: PresetDefinition): Promise<() => Promise<void>>;
    resolve(id?: string): Promise<{
        readonly id: string;
        readonly broken?: string;
    }>;
    readDocument(id: string): Promise<{
        readonly agentPreset: string;
        readonly content: string;
    }>;
    list?(): Promise<readonly {
        readonly id: string;
        readonly broken?: string;
    }[]>;
}
export interface CommandInvocation {
    readonly commandId: string;
    readonly agent: Agent;
    readonly rawInput: string;
    readonly signal: AbortSignal;
}
export type CommandResult = {
    readonly kind: 'success';
    readonly text: string;
} | {
    readonly kind: 'error';
    readonly text: string;
};
export interface CommandsService {
    register(def: {
        readonly name: string;
        readonly description: string;
        readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>;
    }): () => void;
}
export interface DomainKvTable<V> {
    get(key: string): V | undefined;
    entries(): IterableIterator<[string, V]>;
    keys(): IterableIterator<string>;
    readonly size: number;
    put(key: string, value: V): Promise<void>;
    delete(key: string): Promise<boolean>;
}
export interface OpenedDomain<Tables extends Record<string, unknown>> {
    readonly name: string;
    table<N extends keyof Tables & string>(name: N): DomainKvTable<Tables[N]>;
    close(): Promise<void>;
}
export interface StorageDomainService {
    open<Tables extends Record<string, unknown>>(spec: {
        readonly name: string;
        readonly version: number;
        readonly invalidRecords?: 'fail' | 'backup-and-skip';
        readonly tables: {
            readonly [K in keyof Tables]: {
                readonly valueSchema: {
                    parse(raw: unknown): Tables[K];
                };
            };
        };
    }): Promise<OpenedDomain<Tables>>;
}
export interface SubagentResult {
    readonly output: readonly {
        readonly type: string;
        readonly text?: string;
    }[];
    readonly structured?: unknown;
    readonly diagnostic?: string;
    readonly stopReason: string;
}
export interface SubagentActivation {
    readonly childId: string;
    readonly name: string;
    readonly result: Promise<SubagentResult>;
    dispose(): Promise<void>;
}
export interface SubagentDescendantEntry {
    readonly kind?: string;
    readonly sessionId?: string;
    readonly id?: string;
    readonly name?: string;
    readonly status?: string;
    readonly activity?: string | {
        readonly state?: string;
    };
    readonly updatedAt?: number;
}
export interface SubagentService {
    startActivation(spec: {
        readonly provider: string;
        readonly label: string;
        readonly name?: string;
        readonly cwd?: string;
        readonly agentPreset?: string;
        readonly prompt: readonly ContentTextBlock[];
        readonly parent: Agent;
        readonly signal: AbortSignal;
        readonly delivery: 'parent' | 'caller';
        readonly agentOptions?: {
            readonly provider?: string;
            readonly model?: string;
            readonly reasoningEffort?: string;
            readonly maxTokens?: number;
        };
        readonly outputSchema?: Record<string, unknown>;
    }): Promise<SubagentActivation>;
    interrupt(targetSessionId: string, authority: {
        readonly kind: 'user';
    } | {
        readonly kind: 'ancestor';
        readonly agent: Agent;
    }): void;
    listDescendants(rootSessionId: string, signal?: AbortSignal): Promise<readonly SubagentDescendantEntry[]>;
}
export interface LlmModelCatalogItem {
    readonly id: string;
    readonly name?: string;
    readonly reasoningEfforts?: readonly string[];
    readonly reasoning?: {
        readonly supportedEfforts?: readonly string[];
        readonly efforts?: readonly {
            readonly id: string;
        }[];
    };
}
export interface LlmResolvedInfo {
    readonly provider?: string;
    readonly id?: string;
    readonly name?: string;
    readonly reasoning?: {
        readonly supportedEfforts?: readonly string[];
        readonly efforts?: readonly {
            readonly id: string;
        }[];
    };
}
export interface LlmService {
    listProviders(): readonly {
        readonly id: string;
        readonly name: string;
    }[];
    listModels?(provider: string): Promise<readonly LlmModelCatalogItem[]>;
    resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedInfo>;
    resolveModel?(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedInfo>;
}
export declare function extractSupportedEfforts(info: LlmResolvedInfo | LlmModelCatalogItem | undefined): readonly string[];
/** Real DSH `ctx.subprocess` contract (`argv`, `stdio`, `graceMs`, `collected.stdout.readFrom(0)`). */
export interface SubprocessOutputReader {
    readFrom(fromByte: number): {
        readonly text: string;
        readonly nextOffset: number;
        readonly lossy: boolean;
    };
}
export interface SubprocessService {
    spawn(spec: {
        readonly argv: readonly string[];
        readonly cwd: string;
        readonly stdio: {
            readonly stdin: 'ignore' | 'pipe' | {
                readonly data: string;
            };
            readonly stdout: 'pipe' | 'inherit' | {
                readonly maxBytes: number;
            };
            readonly stderr: 'pipe' | 'inherit' | {
                readonly maxBytes: number;
            };
        };
        readonly graceMs: number;
        readonly signal?: AbortSignal;
        readonly env?: Readonly<Record<string, string | undefined>>;
    }): {
        readonly collected?: {
            readonly stdout?: SubprocessOutputReader;
            readonly stderr?: SubprocessOutputReader;
        };
        readonly done: Promise<{
            readonly exitCode: number | null;
            readonly signal: string | null;
            readonly outputs?: {
                readonly stdout?: {
                    readonly text?: string;
                };
                readonly stderr?: {
                    readonly text?: string;
                };
            };
        }>;
        terminate(): void;
        waitForExit?(signal?: AbortSignal): Promise<boolean>;
    };
}
export interface ShellService {
    execute(request: {
        readonly command: string;
        readonly workdir?: string;
        readonly timeoutMs?: number;
        readonly onExpiry?: 'kill' | 'none';
        readonly signal?: AbortSignal;
    }): Promise<{
        readonly result: Promise<{
            readonly exitCode: number | null;
            readonly timedOut?: boolean;
            readonly aborted?: boolean;
            readonly stdout?: {
                readonly text?: string;
            };
            readonly stderr?: {
                readonly text?: string;
            };
            readonly output?: string;
        }>;
    }>;
}
export interface WorkingDirectoryService {
    get(session: unknown): string;
    ensure(agent: Agent, signal?: AbortSignal): Promise<string>;
}
export interface ScheduleService {
    create(request: {
        readonly title: string;
        readonly prompt: string;
        readonly timing: {
            readonly kind: 'every';
            readonly every_seconds: number;
        };
        readonly target: {
            readonly kind: 'session';
            readonly sessionId: string;
        };
    }, actorSessionId?: string, signal?: AbortSignal): Promise<{
        readonly id: string;
        readonly status: string;
    }>;
    delete?(request: {
        readonly id: string;
    }, signal?: AbortSignal): Promise<unknown>;
}
export interface GoalSnapshotLike {
    readonly id: string;
    readonly revision: number;
    readonly objective: string;
    readonly phase: string;
}
export type GoalViewLike = GoalSnapshotLike | {
    readonly goal: GoalSnapshotLike;
};
export declare function unwrapGoalSnapshot(view: GoalViewLike | undefined): GoalSnapshotLike | undefined;
export interface GoalService {
    create(agent: Agent, request: {
        readonly objective: string;
        readonly maxGoalRounds?: number;
    }): GoalViewLike;
    get(agent: Agent): GoalViewLike | undefined;
    pause?(agent: Agent, ref: {
        readonly id: string;
        readonly revision: number;
    }): GoalViewLike;
    resume?(agent: Agent, ref: {
        readonly id: string;
        readonly revision: number;
    }): GoalViewLike;
}
export interface ConfigEditorEntry {
    readonly id?: string;
    readonly options?: {
        readonly id?: string;
        readonly name?: string;
    };
}
export interface ConfigEditorService {
    entries(): readonly ConfigEditorEntry[];
    configuration(): readonly {
        readonly entry: ConfigEditorEntry;
        readonly inherited: Record<string, unknown>;
        readonly override: Record<string, unknown>;
    }[];
    edit(entry: ConfigEditorEntry, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>): Promise<void>;
}
/** Match a pstack row in `configEditor` by `entry.options.id` first (`entry.id` in Cordis is qualified like `include:pstack-guard`). */
export declare function findPstackConfigEntry(editor: ConfigEditorService, rowId: string): ConfigEditorEntry | undefined;
export interface HostConnectionFetchRoute {
    readonly path: string;
    readonly methods: readonly ('GET' | 'HEAD' | 'POST')[];
    readonly requestBody: 'buffered' | 'streaming';
    readonly fetch: (request: Request) => Promise<Response>;
}
export interface HostConnectionService {
    readonly rpc?: {
        handle(channel: string, handler: (endpoint: string, payload: unknown, signal: AbortSignal, peer: unknown) => Promise<{
            readonly ok: true;
            readonly value: unknown;
        } | {
            readonly ok: false;
            readonly error: {
                readonly code: string;
                readonly message: string;
                readonly details: object;
            };
        }>): () => Promise<void>;
    };
    readonly fetch?: {
        register(route: HostConnectionFetchRoute): () => void;
    };
}
export declare function getService<T>(ctx: Context, key: string): T | undefined;
export interface SessionHandleLike {
    readonly id: string;
    readonly header?: {
        readonly cwd?: string;
    };
    readonly meta?: {
        readonly cwd?: string;
    };
    append(type: string, data: unknown): unknown;
    appendRecord?(type: `plugin:${string}`, data: unknown): unknown;
    events?(): readonly FoldEvent[];
    ownEvents?(): readonly FoldEvent[];
}
export declare function sessionOfAgent(agent: Agent | undefined): SessionHandleLike | undefined;
export declare function sessionIdOfAgent(agent: Agent | undefined): string | undefined;
export declare function sessionEventsOfAgent(agent: Agent | undefined): readonly FoldEvent[];
/** Synchronous best-effort workspace directory for guards (prefers `ctx.workingDirectory.get(session)` and `session.header.cwd`). */
export declare function cwdOfAgent(agent: Agent | undefined, ctx?: Context): string;
/** Validated async workspace directory for tool execution (`workingDirectory.ensure(agent, signal)`). */
export declare function resolveAgentCwd(ctx: Context, agent: Agent | undefined, signal?: AbortSignal): Promise<string>;
/** Look up a live Agent or Session by `sessionId` for client RPC mutations; returns `undefined` if unknown so callers fail closed. */
export declare function resolveLiveSessionTarget(ctx: Context, sessionId: string | undefined, signal?: AbortSignal): Promise<{
    readonly sessionId: string;
    readonly agent?: Agent;
    readonly session?: SessionHandleLike;
    readonly cwd: string;
} | undefined>;
/** Ensure `candidatePath` resolves strictly inside `workspaceRoot` (prevents `..` traversal outside workspace). */
export declare function resolveInsideWorkspace(workspaceRoot: string, candidatePath: string): string | undefined;
export interface ProcessRunResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut: boolean;
    readonly spawnFailed: boolean;
}
/**
 * Execute a subprocess using DSH's real `ctx.subprocess.spawn({ argv, cwd, stdio, graceMs, signal })`
 * contract, keeping stdout and stderr separate and draining managed process ranges on timeout/abort.
 */
export declare function execSubprocess(ctx: Context, executable: string, args: readonly string[], cwd: string, options?: {
    readonly timeoutMs?: number;
    readonly maxBytes?: number;
    readonly signal?: AbortSignal;
    readonly env?: Readonly<Record<string, string | undefined>>;
}): Promise<ProcessRunResult>;
/** Execute a shell command via `ctx.shell` when mounted, falling back to `execSubprocess`. */
export declare function execShellCommand(ctx: Context, command: string, cwd: string, options?: {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
}): Promise<ProcessRunResult>;
/**
 * Append an ignorable `plugin:pstack/event` record to a real DSH Session log so
 * UI actions (`tdd` toggle, `adoptCandidate`, `decideKetchup`) and background
 * patrols (`autopilot` replacements) flow through `ctx.sessionProjections`
 * immediately and survive restart/fork/resume without corrupting session logs.
 */
export declare function appendPstackSessionRecord(session: SessionHandleLike | undefined, payload: Record<string, unknown>): Promise<boolean>;
export declare function modelRouteOfAgent(agent: Agent | undefined): ModelSelection | undefined;
export declare function vendorRootPath(): string | undefined;
declare let cachedCatalog: (FoldCatalog & {
    readonly vendorRoot?: string;
    readonly commentSickoBody: string;
    readonly potetoAgentBody: string;
    readonly workerRulesBody: string;
}) | undefined;
export declare function loadVendoredCatalog(): NonNullable<typeof cachedCatalog>;
export {};
