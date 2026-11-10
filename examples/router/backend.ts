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

/** worker 完成或失败时推送的状态；不包含结果正文。 */
export type WorkEventStatus = Extract<WorkStatus, "completed" | "failed">;

/**
 * worker 状态变化事件。只携带定位信息，结果仍由 collect 读取，
 * 保证通知与结果只有一条事实来源。
 */
export interface WorkEvent {
  /** 后端生成的事件唯一标识；router 用它去重。 */
  eventId: string;
  workId: string;
  status: WorkEventStatus;
  workerId: string;
  sessionId: string;
  /** ISO 8601 时间戳。 */
  occurredAt: string;
}

export type WorkEventListener = (event: WorkEvent) => void;

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
  /**
   * 可选：订阅 worker 状态变化；返回取消订阅函数，重复调用安全。
   * 只推送 running 之后的变化。不支持推送的后端省略此方法，
   * router 仍可通过 list/collect 按需获取状态。
   */
  subscribe?(listener: WorkEventListener): () => void;
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
