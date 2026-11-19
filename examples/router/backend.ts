/** 模型只能使用协调契约；会话、授权、数据目录由可信接入层绑定。 */
export type BackendMode = "mock" | "backend";
export const TASK_STATUSES = [
  "active", "waiting_user", "waiting_external", "blocked", "cancel_requested",
  "cancelled", "completed", "failed",
] as const;
export type TaskStatus = typeof TASK_STATUSES[number];
export type RouterErrorCode = "INVALID_ARGUMENT" | "NOT_FOUND" | "BACKEND_ERROR"
  | "IDEMPOTENCY_CONFLICT" | "PERMISSION_DENIED" | "AUTHORIZATION_EXPIRED"
  | "AUTHORIZATION_REVOKED";
export type Acceptance = "pending" | "accepted" | "rejected";
export interface ContextRef { referenceId: string; sourceVersion: string }
export interface ContextSource extends ContextRef {
  sourceType: "user" | "web" | "model_summary";
  sourceLocator: string;
  sessionId: string;
  text: string;
  access: "allowed" | "denied";
}
export interface TaskSummary {
  taskId: string;
  goal: string;
  goalVersion: number;
  ownerSessionId: string;
  status: TaskStatus;
  acceptance: Acceptance;
  createdAt: string;
  updatedAt: string;
  waitReason?: string;
  nextCheckAt?: string;
}
export interface Run {
  runId: string;
  taskId: string;
  goalVersion: number;
  executorId: string;
  status: "queued" | "running" | "completed" | "failed" | "interrupted" | "cancelled";
  startedAt: string;
  endedAt?: string;
  checkpoint?: string;
  error?: string;
}
export interface Authorization {
  version: number;
  readScopes: string[];
  writeRoots: string[];
  sendScopes: string[];
  expiresAt: string;
  approval: "approved" | "required";
  revokedAt?: string;
}
export interface InputReceipt {
  inputId: string;
  status: "received" | "applied" | "rejected";
  goalVersion: number;
  message: string;
  receivedAt: string;
  runId?: string;
  reason?: string;
}
export interface Action {
  actionId: string;
  taskId: string;
  runId: string;
  goalVersion: number;
  authorizationVersion: number;
  target: string;
  check: "allowed" | RouterErrorCode;
  effectState: "not_started" | "confirmed" | "unknown";
  error?: string;
}
export interface ReleaseEvidence {
  id: number;
  tag_name: string;
  published_at: string;
  html_url: string;
  fetchedAt: string;
  source: string;
  authorizationVersion: number;
}
export interface Delivery {
  runId: string;
  goalVersion: number;
  stale: boolean;
  summary: string;
  artifacts: string[];
  evidence: ReleaseEvidence[];
  unfinished: string[];
  blockers: string[];
  acceptance: Acceptance;
}
export interface TaskDelivery {
  taskId: string;
  taskStatus: TaskStatus;
  acceptance: Acceptance;
  delivery: Delivery | null;
  history: Delivery[];
  pending: string | null;
}
export interface TaskEvent {
  eventId: string;
  taskId: string;
  runId?: string;
  eventType: string;
  occurredAt: string;
  targetSessionId: string;
}
export interface Notice extends TaskEvent {
  deliveryState: "pending" | "in_flight" | "delivered" | "exhausted" | "reconciliation_required";
  failureCount: number;
  lastError?: string;
  attempts: {
    attemptId: string;
    state: "in_flight" | "delivered" | "failed" | "unknown";
    error?: string;
  }[];
}
export interface TaskDetail extends TaskSummary {
  runs: Run[];
  inputs: InputReceipt[];
  authorization: Authorization;
  contexts: ContextSource[];
  deliveries: Pick<Delivery, "runId" | "goalVersion" | "stale" | "acceptance">[];
  actions: Action[];
  notices: Notice[];
  cancellation: { stopState: "none" | "stop_requested" | "stopped" | "effects_unknown" };
  baseline: { releaseIds: number[]; establishedAt: string } | null;
  executor: { isolation: "host" | "simulated"; profile: "github-release-read"; env: Record<string, string> };
}
export interface DispatchInput { requestId: string; task: string; contextRefs?: ContextRef[] }
export interface ListInput {
  statuses?: TaskStatus[];
  updatedFrom?: string;
  updatedTo?: string;
  cursor?: string;
  limit?: number;
}
export interface CancelReceipt {
  accepted: boolean;
  stopState: "stop_requested" | "stopped" | "effects_unknown";
  effects: Action[];
}
export interface OutcomeError { code: RouterErrorCode; message: string }
export type Outcome<T> =
  | { ok: true; mode: BackendMode; data: T }
  | { ok: false; mode: BackendMode; error: OutcomeError };
export interface RouterBackend {
  readonly mode: BackendMode;
  dispatch(input: DispatchInput): Promise<Outcome<TaskSummary>>;
  list(input?: ListInput): Promise<Outcome<{ items: TaskSummary[]; nextCursor: string | null }>>;
  inspect(taskId: string): Promise<Outcome<TaskDetail>>;
  collect(taskId: string): Promise<Outcome<TaskDelivery>>;
  queryContext(query: string, sessionId?: string): Promise<Outcome<{ items: ContextSource[]; capability: "substring" }>>;
  cancel(taskId: string): Promise<Outcome<CancelReceipt>>;
  sendInput(taskId: string, message: string): Promise<Outcome<InputReceipt>>;
  subscribe(listener: (event: TaskEvent) => void): () => void;
  /** 仅可信会话适配层调用，不注册为模型工具。 */
  bindSession(sessionId: string): void;
  pendingNotices(sessionId: string): Promise<Outcome<Notice[]>>;
  beginDelivery(eventId: string, sessionId: string): Promise<Outcome<Notice>>;
  settleDelivery(eventId: string, attemptId: string, result: {
    state: "delivered" | "failed" | "unknown"; error?: string;
  }): Promise<Outcome<Notice>>;
  reconcileDelivery(eventId: string, sessionId: string, attemptId: string): Promise<Outcome<Notice>>;
  registerContextSource(source: ContextSource): void;
  close(): void;
}
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
export function ok<T>(mode: BackendMode, data: T): Outcome<T> {
  return { ok: true, mode, data };
}
export function fail<T>(mode: BackendMode, code: RouterErrorCode, message: string): Outcome<T> {
  return { ok: false, mode, error: { code, message } };
}
