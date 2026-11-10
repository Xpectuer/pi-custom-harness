/**
 * Router 后端接口与共享数据类型。
 *
 * 接入方实现 RouterBackend，并在自己的 extension 入口中注入 registerRouter；
 * mock 后端只模拟协调语义，不代表真实 worker 执行或沙盒隔离。
 */

export type BackendMode = "mock" | "backend";

export type WorkStatus = "running" | "completed" | "failed";

export type RouterErrorCode = "INVALID_ARGUMENT" | "NOT_FOUND" | "BACKEND_ERROR";

export interface ContextRecord {
  recordId: string;
  sessionId: string;
  text: string;
}

export interface WorkerDescriptor {
  workerId: string;
  sessionId: string;
  workspace: {
    workspaceId: string;
    isolation: "simulated" | "sandboxed";
  };
  capabilities: {
    profile: "pi-default";
    tools: string[];
    skills: boolean;
  };
}

export interface WorkSummary {
  workId: string;
  task: string;
  workerId: string;
  sessionId: string;
  workspaceId: string;
  status: WorkStatus;
}

export interface WorkDetail extends WorkSummary {
  context: ContextRecord[];
  worker: WorkerDescriptor;
}

export type CollectResult =
  | { status: "completed"; workId: string; result: string }
  | { status: "pending"; workId: string }
  | { status: "failed"; workId: string; error: { message: string } };

export interface DispatchInput {
  task: string;
  context?: ContextRecord[];
}

export interface OutcomeError {
  code: RouterErrorCode;
  message: string;
}

export type Outcome<T> =
  | { ok: true; mode: BackendMode; data: T }
  | { ok: false; mode: BackendMode; error: OutcomeError };

/**
 * 后端实例就是数据可见范围；模型不能传目录、凭证或租户选择参数。
 */
export interface RouterBackend {
  readonly mode: BackendMode;
  dispatch(input: DispatchInput): Promise<Outcome<WorkSummary>>;
  list(): Promise<Outcome<WorkSummary[]>>;
  inspect(workId: string): Promise<Outcome<WorkDetail>>;
  collect(workId: string): Promise<Outcome<CollectResult>>;
  queryContext(query: string, sessionId?: string): Promise<Outcome<ContextRecord[]>>;
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function ok<T>(mode: BackendMode, data: T): Outcome<T> {
  return { ok: true, mode, data };
}

export function fail<T>(
  mode: BackendMode,
  code: RouterErrorCode,
  message: string,
): Outcome<T> {
  return { ok: false, mode, error: { code, message } };
}
