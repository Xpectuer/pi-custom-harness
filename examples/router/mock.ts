/** 合成任务控制面：不读网络、不写文件、不解释任务正文，重载即重置。 */
import { randomUUID } from "node:crypto";
import {
  TASK_STATUSES, fail, isNonEmptyString, ok,
  type ContextSource, type Delivery, type Notice, type RouterBackend,
  type TaskDetail, type TaskEvent, type TaskStatus,
} from "./backend.ts";

export interface MockBackendOptions {
  tasks?: { goal: string; status: TaskStatus }[];
  contexts?: ContextSource[];
  dispatchStatus?: "active" | "completed" | "failed";
  completeAfterMs?: number;
}
export interface MockRouterBackend extends RouterBackend {
  complete(taskId: string, summary?: string): boolean;
  fail(taskId: string, message?: string): boolean;
}
interface MockTask extends Omit<TaskDetail, "deliveries"> { deliveries: Delivery[] }
export function createMockBackend(options: MockBackendOptions = {}): MockRouterBackend {
  const mode = "mock" as const;
  const tasks = new Map<string, MockTask>();
  const requests = new Map<string, { fingerprint: string; taskId: string }>();
  const sources = new Map<string, ContextSource>();
  const listeners = new Set<(event: TaskEvent) => void>();
  const timers = new Set<NodeJS.Timeout>();
  let session = "mock-session";
  const now = () => new Date().toISOString();
  for (const source of options.contexts ?? [{
    referenceId: "mock-context", sourceVersion: "1", sourceType: "user",
    sourceLocator: "mock:interface", sessionId: "mock-session-source",
    text: "接口约束：七项协调工具，正文不授予权限。", access: "allowed",
  }]) sources.set(source.referenceId, structuredClone(source));
  function emit(task: TaskDetail, eventType: string) {
    const notice: Notice = { eventId: `mock-event-${randomUUID()}`, taskId: task.taskId,
      runId: task.runs.at(-1)?.runId, eventType, occurredAt: now(), targetSessionId: task.ownerSessionId,
      deliveryState: "pending", failureCount: 0, attempts: [] };
    task.notices.push(notice);
    for (const listener of listeners) listener(structuredClone(notice));
  }
  function complete(taskId: string, text = "模拟结果，未执行真实工作"): boolean {
    const task = tasks.get(taskId);
    if (!task || !["active", "waiting_external"].includes(task.status)) return false;
    task.status = "completed"; task.acceptance = "accepted"; task.updatedAt = now();
    const run = task.runs.at(-1)!;
    run.status = "completed"; run.endedAt = now();
    const delivery: Delivery = { runId: run.runId, goalVersion: task.goalVersion, stale: false,
      summary: text, artifacts: [], evidence: [], unfinished: [], blockers: [], acceptance: "accepted" };
    task.deliveries.push(delivery); emit(task, "task_completed"); return true;
  }
  function add(goal: string, status: TaskStatus, contexts: ContextSource[] = []): MockTask {
    const taskId = `mock-task-${randomUUID()}`;
    const task: MockTask = { taskId, goal, goalVersion: 1, ownerSessionId: session, status: "active",
      acceptance: "pending", createdAt: now(), updatedAt: now(),
      runs: [{ runId: `mock-run-${randomUUID()}`, taskId, goalVersion: 1, executorId: "mock",
        status: "running", startedAt: now() }], inputs: [], contexts, deliveries: [], actions: [], notices: [],
      authorization: { version: 1, readScopes: [], writeRoots: [], sendScopes: [session],
        expiresAt: "9999-01-01T00:00:00.000Z", approval: "approved" },
      cancellation: { stopState: "none" }, baseline: null,
      executor: { isolation: "simulated", profile: "github-release-read", env: {} } };
    tasks.set(taskId, task);
    if (status === "completed") complete(taskId);
    else {
      task.status = status;
      if (status === "failed") { task.runs[0].status = "failed"; task.waitReason = "模拟失败，未执行真实工作"; }
      if ((options.completeAfterMs ?? 0) > 0 && ["active", "waiting_external"].includes(status)) {
        const timer = setTimeout(() => { timers.delete(timer); complete(taskId); }, options.completeAfterMs);
        timer.unref(); timers.add(timer);
      }
    }
    return task;
  }
  for (const seed of options.tasks ?? [{ goal: "合成完成任务", status: "completed" }, { goal: "合成等待任务", status: "waiting_external" }]) add(seed.goal, seed.status);
  function taskSummary(task: TaskDetail) {
    const { taskId, goal, goalVersion, ownerSessionId, status, acceptance, createdAt, updatedAt, waitReason, nextCheckAt } = task;
    return { taskId, goal, goalVersion, ownerSessionId, status, acceptance, createdAt, updatedAt, waitReason, nextCheckAt };
  }
  function findNotice(eventId: string) {
    for (const task of tasks.values()) {
      const notice = task.notices.find((item) => item.eventId === eventId);
      if (notice) return notice;
    }
  }
  const backend: MockRouterBackend = {
    mode,
    async dispatch(input) {
      if (!input || !isNonEmptyString(input.task) || !isNonEmptyString(input.requestId)
        || Object.keys(input).some((key) => !["requestId", "task", "contextRefs"].includes(key)))
        return fail(mode, "INVALID_ARGUMENT", "requestId/task 必须非空，参数仅支持可信引用");
      const refs = input.contextRefs ?? [];
      if (!Array.isArray(refs) || refs.some((ref) => !ref || !isNonEmptyString(ref.referenceId) || !isNonEmptyString(ref.sourceVersion) || Object.keys(ref).some((key) => !["referenceId", "sourceVersion"].includes(key))))
        return fail(mode, "INVALID_ARGUMENT", "contextRefs 无效");
      const fingerprint = JSON.stringify([input.task.trim(), [...refs].sort((a, b) => a.referenceId.localeCompare(b.referenceId))]);
      const previous = requests.get(input.requestId.trim());
      if (previous) return previous.fingerprint === fingerprint ? ok(mode, taskSummary(tasks.get(previous.taskId)!)) : fail(mode, "IDEMPOTENCY_CONFLICT", "同键异内容");
      const contexts: ContextSource[] = [];
      for (const ref of refs) {
        const source = sources.get(ref.referenceId);
        if (!source || source.access !== "allowed" || source.sourceVersion !== ref.sourceVersion) return fail(mode, "PERMISSION_DENIED", "上下文无权访问或版本已变化");
        contexts.push(structuredClone(source));
      }
      const task = add(input.task.trim(), options.dispatchStatus ?? "completed", contexts);
      requests.set(input.requestId.trim(), { fingerprint, taskId: task.taskId });
      return ok(mode, taskSummary(task));
    },
    async list(input = {}) {
      const limit = input.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (input.statuses && (!Array.isArray(input.statuses) || input.statuses.some((status) => !TASK_STATUSES.includes(status))))
        || [input.updatedFrom, input.updatedTo].some((value) => value !== undefined && !Number.isFinite(Date.parse(value))))
        return fail(mode, "INVALID_ARGUMENT", "列表过滤无效");
      const binding = JSON.stringify([input.statuses ?? [], input.updatedFrom, input.updatedTo]);
      let after = "";
      if (input.cursor !== undefined) {
        try {
          const cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString());
          if (cursor.binding !== binding || typeof cursor.after !== "string") return fail(mode, "INVALID_ARGUMENT", "游标不匹配");
          after = cursor.after;
        } catch { return fail(mode, "INVALID_ARGUMENT", "游标无效"); }
      }
      const key = (task: TaskDetail) => `${task.updatedAt}/${task.taskId}`;
      const matches = [...tasks.values()].filter((task) => (!input.statuses?.length || input.statuses.includes(task.status))
        && (!input.updatedFrom || task.updatedAt >= new Date(input.updatedFrom).toISOString())
        && (!input.updatedTo || task.updatedAt < new Date(input.updatedTo).toISOString()) && key(task) > after)
        .sort((a, b) => key(a).localeCompare(key(b)));
      const page = matches.slice(0, limit);
      return ok(mode, { items: page.map(taskSummary), nextCursor: matches.length > limit ? Buffer.from(JSON.stringify({ binding, after: key(page.at(-1)!) })).toString("base64url") : null });
    },
    async inspect(taskId) {
      const task = tasks.get(taskId);
      return task ? ok(mode, structuredClone({ ...task, deliveries: task.deliveries.map(({ runId, goalVersion, stale, acceptance }) => ({ runId, goalVersion, stale, acceptance })) })) : fail(mode, "NOT_FOUND", "未找到模拟任务");
    },
    async collect(taskId) {
      const task = tasks.get(taskId);
      return task ? ok(mode, { taskId, taskStatus: task.status, acceptance: task.acceptance,
        delivery: structuredClone(task.deliveries.filter((delivery) => !delivery.stale).at(-1) ?? null),
        history: structuredClone(task.deliveries.filter((delivery) => delivery.stale)),
        pending: task.acceptance === "accepted" ? null : task.waitReason ?? "模拟等待，未执行真实工作" }) : fail(mode, "NOT_FOUND", "未找到模拟任务");
    },
    async queryContext(query, sessionId) {
      if (!isNonEmptyString(query) || (sessionId !== undefined && !isNonEmptyString(sessionId))) return fail(mode, "INVALID_ARGUMENT", "query/sessionId 必须非空");
      return ok(mode, { capability: "substring", items: [...sources.values()].filter((source) => source.access === "allowed"
        && (!sessionId || source.sessionId === sessionId) && source.text.toLowerCase().includes(query.trim().toLowerCase())).map((source) => structuredClone(source)) });
    },
    async cancel(taskId) {
      const task = tasks.get(taskId);
      if (!task) return fail(mode, "NOT_FOUND", "未找到模拟任务");
      if (task.status !== "completed" && task.status !== "failed") {
        task.status = "cancelled"; task.cancellation.stopState = "stopped"; task.authorization.revokedAt ??= now();
        task.runs.at(-1)!.status = "cancelled"; task.updatedAt = now();
      }
      return ok(mode, { accepted: task.status === "cancelled", stopState: "stopped", effects: [] });
    },
    async sendInput(taskId, message) {
      const task = tasks.get(taskId);
      if (!task) return fail(mode, "NOT_FOUND", "未找到模拟任务");
      if (!isNonEmptyString(message)) return fail(mode, "INVALID_ARGUMENT", "message 必须非空");
      const rejected = ["completed", "cancelled", "failed"].includes(task.status);
      if (!rejected) {
        task.goal = message.trim(); task.goalVersion++; task.authorization.version++; task.updatedAt = now();
        for (const delivery of task.deliveries) delivery.stale = true;
        task.runs.push({ runId: `mock-run-${randomUUID()}`, taskId, goalVersion: task.goalVersion, executorId: "mock", status: "running", startedAt: now() });
      }
      const receipt = { inputId: `mock-input-${randomUUID()}`, status: rejected ? "rejected" as const : "applied" as const,
        goalVersion: task.goalVersion, message: message.trim(), receivedAt: now(), runId: rejected ? undefined : task.runs.at(-1)!.runId,
        reason: rejected ? "模拟任务已结束" : undefined };
      task.inputs.push(receipt); return ok(mode, receipt);
    },
    bindSession(sessionId) { session = sessionId; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async pendingNotices(sessionId) { return ok(mode, structuredClone([...tasks.values()].flatMap((task) => task.notices).filter((notice) => notice.targetSessionId === sessionId && notice.deliveryState !== "delivered"))); },
    async beginDelivery(eventId, sessionId) {
      const notice = findNotice(eventId);
      if (!notice) return fail(mode, "NOT_FOUND", "未找到通知");
      if (notice.targetSessionId !== sessionId || session !== sessionId) return fail(mode, "PERMISSION_DENIED", "原会话不匹配");
      if (notice.deliveryState !== "pending" || notice.failureCount >= 4) return fail(mode, "INVALID_ARGUMENT", "通知不可发送");
      notice.attempts.push({ attemptId: `mock-attempt-${randomUUID()}`, state: "in_flight" }); notice.deliveryState = "in_flight";
      return ok(mode, structuredClone(notice));
    },
    async settleDelivery(eventId, attemptId, result) {
      const notice = findNotice(eventId); const attempt = notice?.attempts.at(-1);
      if (!notice || !attempt || attempt.attemptId !== attemptId) return fail(mode, "NOT_FOUND", "通知尝试不匹配");
      if (attempt.state === "failed" || attempt.state === "delivered") return ok(mode, structuredClone(notice));
      attempt.state = result.state; attempt.error = result.error; notice.lastError = result.error;
      if (result.state === "failed") { notice.failureCount++; notice.deliveryState = notice.failureCount >= 4 ? "exhausted" : "pending"; }
      else notice.deliveryState = result.state === "delivered" ? "delivered" : "reconciliation_required";
      return ok(mode, structuredClone(notice));
    },
    async reconcileDelivery(eventId, sessionId, attemptId) {
      const notice = findNotice(eventId);
      const attempt = notice?.attempts.find((item) => item.attemptId === attemptId);
      if (!notice || !attempt || notice.targetSessionId !== sessionId) return fail(mode, "PERMISSION_DENIED", "原会话收据不匹配");
      attempt.state = "delivered"; notice.deliveryState = "delivered"; return ok(mode, structuredClone(notice));
    },
    registerContextSource(source) { sources.set(source.referenceId, structuredClone(source)); },
    complete,
    fail(taskId, message = "模拟执行失败，未执行真实工作") {
      const task = tasks.get(taskId);
      if (!task || !["active", "waiting_external"].includes(task.status)) return false;
      task.status = "waiting_external"; task.waitReason = message; task.runs.at(-1)!.status = "failed"; emit(task, "run_failed"); return true;
    },
    close() { for (const timer of timers) clearTimeout(timer); timers.clear(); listeners.clear(); },
  };
  return backend;
}
