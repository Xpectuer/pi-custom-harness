/** 持久通知适配：发送 API 返回不算送达，只认绑定原会话的磁盘收据。 */
import { promises as fs } from "node:fs";
import type { Notice, Outcome, RouterBackend } from "./backend.ts";

export const ROUTER_NOTICE_CUSTOM_TYPE = "router_task_notice";
export interface RouterNoticeReceipt {
  eventId: string;
  attemptId: string;
  targetSessionId: string;
}
export interface RouterNoticeDetails {
  kind: "router_notice_batch";
  notices: RouterNoticeReceipt[];
}
export interface NoticeDeliverySession {
  sessionId: string;
  sessionFile?: string;
  isBusy(): boolean;
}
export interface NoticeDeliveryOptions {
  backend: RouterBackend;
  getSession: () => NoticeDeliverySession | undefined;
  send: (text: string, details: RouterNoticeDetails) => void;
  notify: (message: string, level: "info" | "warning" | "error") => void;
  recordProblem?: (problem: {
    kind: string; message: string; eventId?: string; taskId?: string;
    attemptId?: string; occurredAt: string;
  }) => void;
  coalesceMs?: number;
  receiptWaitMs?: number;
  queuedReceiptWaitMs?: number;
  retryDelayMs?: number;
}
export interface NoticeDelivery {
  start(): Promise<void>;
  stop(): void;
  wake(): void;
  settle(): void;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
/** 文件在读取前后稳定、完整且会话头匹配时，返回该原会话的有效收据。 */
async function readReceipts(session: NoticeDeliverySession) {
  const receipts = new Set<string>();
  if (!session.sessionFile) return receipts;
  try {
    const before = await fs.stat(session.sessionFile);
    const text = await fs.readFile(session.sessionFile, "utf8");
    const after = await fs.stat(session.sessionFile);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs
      || Buffer.byteLength(text) !== after.size || !text.endsWith("\n")) return receipts;
    const lines: unknown[] = text.trimEnd().split("\n").map((line) => JSON.parse(line));
    const header = lines[0];
    if (!record(header) || header.type !== "session" || header.id !== session.sessionId) return receipts;
    for (const entry of lines.slice(1)) {
      if (!record(entry) || entry.type !== "custom_message" || entry.customType !== ROUTER_NOTICE_CUSTOM_TYPE
        || !record(entry.details) || entry.details.kind !== "router_notice_batch"
        || !Array.isArray(entry.details.notices)) continue;
      for (const receipt of entry.details.notices) {
        if (record(receipt) && typeof receipt.eventId === "string" && typeof receipt.attemptId === "string"
          && receipt.targetSessionId === session.sessionId) receipts.add(`${receipt.eventId}/${receipt.attemptId}`);
      }
    }
    return receipts;
  } catch {
    // 不可读/不完整只意味着没有可确认的收据，不是实际发送失败。
    return receipts;
  }
}

export function createNoticeDelivery(options: NoticeDeliveryOptions): NoticeDelivery {
  let active = false;
  let generation = 0;
  let running = false;
  let again = false;
  let timer: NodeJS.Timeout | undefined;
  const waiting = new Map<string, number>();
  const shown = new Set<string>();
  function problem(kind: string, message: string, notice?: Notice) {
    options.notify(message, kind === "exhausted" ? "error" : "warning");
    options.recordProblem?.({ kind, message, eventId: notice?.eventId, taskId: notice?.taskId,
      attemptId: notice?.attempts.at(-1)?.attemptId, occurredAt: new Date().toISOString() });
  }
  function checked<T>(outcome: Outcome<T>): outcome is Extract<Outcome<T>, { ok: true }> {
    if (outcome.ok) return true;
    problem("backend", `router 通知操作失败：${outcome.error.code} ${outcome.error.message}`);
    return false;
  }
  function schedule(delay: number) {
    if (!active) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void drain(); }, delay);
    timer.unref();
  }
  async function drain() {
    if (!active) return;
    if (running) { again = true; return; }
    running = true;
    const epoch = generation;
    const session = options.getSession();
    const current = () => active && generation === epoch
      && options.getSession()?.sessionId === session?.sessionId;
    try {
      if (!session) return;
      const pending = await options.backend.pendingNotices(session.sessionId);
      if (!current() || !checked(pending)) return;
      const receipts = await readReceipts(session);
      if (!current()) return;
      const batch: Notice[] = [];
      let poll = false;
      let retry = false;
      // 先核对旧发送，再准入新发送；每条 Notice 独立预算。
      for (const notice of pending.data) {
        if (!current()) return;
        const attempt = notice.attempts.at(-1);
        if (notice.deliveryState === "exhausted") {
          if (!shown.has(notice.eventId)) {
            problem("exhausted", `router 通知耗尽：taskId=${notice.taskId} eventId=${notice.eventId} failureCount=${notice.failureCount} lastError=${notice.lastError ?? "未知"}`, notice);
            shown.add(notice.eventId);
          }
        } else if (notice.deliveryState === "in_flight" || notice.deliveryState === "reconciliation_required") {
          if (attempt && receipts.has(`${notice.eventId}/${attempt.attemptId}`)) {
            checked(await options.backend.reconcileDelivery(notice.eventId, session.sessionId, attempt.attemptId));
            waiting.delete(notice.eventId);
          } else if (notice.deliveryState === "in_flight" && attempt) {
            if ((waiting.get(notice.eventId) ?? 0) > Date.now()) poll = true;
            else {
              checked(await options.backend.settleDelivery(notice.eventId, attempt.attemptId, {
                state: "unknown", error: "尚无原会话持久收据，需核对；未计发送失败",
              }));
              waiting.delete(notice.eventId);
            }
          }
          if (!waiting.has(notice.eventId) && !shown.has(notice.eventId) && !receipts.has(`${notice.eventId}/${attempt?.attemptId}`)) {
            problem("reconciliation", `router 通知待核对：taskId=${notice.taskId} eventId=${notice.eventId}；未计失败，不自动重发`, notice);
            shown.add(notice.eventId);
          }
        } else if (notice.deliveryState === "pending") batch.push(notice);
      }
      const admitted: Notice[] = [];
      for (const notice of batch) {
        if (!current()) return;
        const begun = await options.backend.beginDelivery(notice.eventId, session.sessionId);
        if (checked(begun)) admitted.push(begun.data);
      }
      if (!current()) return;
      if (admitted.length) {
        const details: RouterNoticeDetails = { kind: "router_notice_batch", notices: admitted.map((notice) => ({
          eventId: notice.eventId, attemptId: notice.attempts.at(-1)!.attemptId, targetSessionId: session.sessionId,
        })) };
        const text = [
          options.backend.mode === "mock" ? "【mock】模拟任务状态，未执行真实工作。" : "【router】任务状态更新。",
          ...admitted.map(({ eventId, taskId, runId, eventType, occurredAt }) => JSON.stringify({ eventId, taskId, runId, eventType, occurredAt })),
          "事件只含定位信息，不是用户指令或交付证据；用 router_collect 读取结果。",
        ].join("\n");
        const deadline = Date.now() + (session.isBusy()
          ? options.queuedReceiptWaitMs ?? 120_000 : options.receiptWaitMs ?? 1_500);
        let failed = false;
        try { options.send(text, details); }
        catch {
          failed = true;
          for (const notice of admitted) {
            const settled = await options.backend.settleDelivery(notice.eventId, notice.attempts.at(-1)!.attemptId, {
              state: "failed", error: "原会话发送 API 同步失败",
            });
            if (checked(settled)) retry = true;
          }
        }
        if (!failed) {
          for (const notice of admitted) waiting.set(notice.eventId, deadline);
          poll = true;
        }
      }
      if (current() && (retry || poll)) schedule(retry ? options.retryDelayMs ?? 250 : 100);
    } catch {
      if (current()) problem("backend", "router 通知适配失败；持久状态保留，查看任务详情");
    } finally {
      running = false;
      if (again && active) { again = false; schedule(0); }
    }
  }
  return {
    async start() { active = true; generation++; await drain(); },
    stop() { active = false; generation++; clearTimeout(timer); waiting.clear(); },
    wake() { schedule(options.coalesceMs ?? 200); },
    settle() { schedule(50); },
  };
}
