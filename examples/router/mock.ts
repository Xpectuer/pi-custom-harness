/**
 * 进程内 mock 后端。
 *
 * 只提供合成工作、worker 描述与上下文查询；不启动 worker、不读取真实 session、
 * 不创建 workspace，也不执行 task 文本。状态仅属于当前实例。
 */

import { randomUUID } from "node:crypto";
import type {
  BackendMode,
  CollectResult,
  ContextRecord,
  Outcome,
  RouterBackend,
  WorkDetail,
  WorkStatus,
  WorkSummary,
  WorkerDescriptor,
} from "./backend.ts";
import { fail, isNonEmptyString, ok } from "./backend.ts";

export interface MockWorkSeed {
  task: string;
  status: WorkStatus;
  context?: ContextRecord[];
  result?: string;
  failureMessage?: string;
}

export interface MockBackendOptions {
  /** 省略时使用默认两项演示工作；传 [] 表示空种子。 */
  works?: MockWorkSeed[];
  contexts?: ContextRecord[];
  /** 默认派活结果的状态，默认 completed。 */
  dispatchStatus?: WorkStatus;
  dispatchResult?: string;
  dispatchFailureMessage?: string;
}

const DEFAULT_COMPLETED_RESULT =
  "模拟结果，未执行真实工作：固定合成应答，任务没有执行。";
const DEFAULT_FAILURE_MESSAGE = "模拟失败，未执行真实工作。";
const CAPABILITY_TOOLS = ["read", "bash", "edit", "write"];

interface MockWork {
  summary: WorkSummary;
  context: ContextRecord[];
  worker: WorkerDescriptor;
  result?: string;
  failureMessage?: string;
}

type Checked<T> = { ok: true; value: T } | { ok: false };

function checkContext(value: unknown): Checked<ContextRecord[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false };
  const records: ContextRecord[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return { ok: false };
    const record = item as Partial<ContextRecord>;
    if (
      !isNonEmptyString(record.recordId) ||
      !isNonEmptyString(record.sessionId) ||
      !isNonEmptyString(record.text)
    ) {
      return { ok: false };
    }
    records.push({
      recordId: record.recordId,
      sessionId: record.sessionId,
      text: record.text,
    });
  }
  return { ok: true, value: records };
}

function cloneSummary(work: WorkSummary): WorkSummary {
  return { ...work };
}

function cloneWorker(worker: WorkerDescriptor): WorkerDescriptor {
  return {
    workerId: worker.workerId,
    sessionId: worker.sessionId,
    workspace: { ...worker.workspace },
    capabilities: { ...worker.capabilities, tools: [...worker.capabilities.tools] },
  };
}

function workerFor(work: WorkSummary): WorkerDescriptor {
  return {
    workerId: work.workerId,
    sessionId: work.sessionId,
    workspace: { workspaceId: work.workspaceId, isolation: "simulated" },
    capabilities: {
      profile: "pi-default",
      tools: [...CAPABILITY_TOOLS],
      skills: true,
    },
  };
}

function defaultWorks(): MockWorkSeed[] {
  return [
    {
      task: "完成一项模拟 worker 任务",
      status: "completed",
      result: DEFAULT_COMPLETED_RESULT,
    },
    {
      task: "保持一项模拟 worker 任务运行中",
      status: "running",
    },
  ];
}

function defaultContexts(): ContextRecord[] {
  return [
    {
      recordId: "mock-ctx-interface",
      sessionId: "mock-session-alpha",
      text: "接口约束：router 只能通过 dispatch、list、inspect、collect、queryContext 协调 workers。",
    },
    {
      recordId: "mock-ctx-isolation",
      sessionId: "mock-session-beta",
      text: "workspace 仅为模拟标识，不构成沙盒隔离证据。",
    },
    {
      recordId: "mock-ctx-handoff",
      sessionId: "mock-session-beta",
      text: "跨 session 复用上下文时保留 recordId 与 sessionId 来源。",
    },
  ];
}

export function createMockBackend(options: MockBackendOptions = {}): RouterBackend {
  const mode: BackendMode = "mock";
  const instanceTag = randomUUID().replace(/-/g, "").slice(0, 8);
  const works = new Map<string, MockWork>();
  const order: string[] = [];
  const contexts = (options.contexts ?? defaultContexts()).map((record) => ({ ...record }));
  let dispatchCounter = 0;

  const addWork = (work: MockWork): void => {
    works.set(work.summary.workId, work);
    order.push(work.summary.workId);
  };

  const seeds = options.works ?? defaultWorks();
  seeds.forEach((seed, index) => {
    const contextCheck = checkContext(seed.context);
    if (!contextCheck.ok) {
      throw new Error(`mock seed #${index + 1} 的 context 必须是 ContextRecord 数组`);
    }
    const fleetLabel = index % 2 === 0 ? "alpha" : "beta";
    const status: WorkStatus = seed.status;
    const workId = `mock-work-${status}-${index === 0 ? "" : `${index + 1}-`}${instanceTag}`;
    const summary: WorkSummary = {
      workId,
      task: seed.task,
      workerId: `mock-worker-${index + 1}`,
      sessionId: `mock-session-${fleetLabel}`,
      workspaceId: `mock-workspace-${index + 1}`,
      status,
    };
    addWork({
      summary,
      context: contextCheck.value.map((record) => ({ ...record })),
      worker: workerFor(summary),
      result:
        seed.result ??
        (status === "completed" ? DEFAULT_COMPLETED_RESULT : undefined),
      failureMessage:
        seed.failureMessage ??
        (status === "failed" ? DEFAULT_FAILURE_MESSAGE : undefined),
    });
  });

  const notFound = <T>(workId: string): Outcome<T> =>
    fail(mode, "NOT_FOUND", `未找到工作：${workId}`);

  const backend: RouterBackend = {
    mode,

    async dispatch(input): Promise<Outcome<WorkSummary>> {
      if (!isNonEmptyString(input?.task)) {
        return fail(mode, "INVALID_ARGUMENT", "task 必须是非空字符串");
      }
      const contextCheck = checkContext(input.context);
      if (!contextCheck.ok) {
        return fail(mode, "INVALID_ARGUMENT", "context 必须是 ContextRecord 数组");
      }

      const task = input.task.trim();
      const status: WorkStatus = options.dispatchStatus ?? "completed";
      const sequence = ++dispatchCounter;
      const summary: WorkSummary = {
        workId: `mock-work-dispatch-${sequence}-${instanceTag}`,
        task,
        workerId: `mock-worker-dispatch-${sequence}`,
        sessionId: `mock-session-dispatch-${sequence}`,
        workspaceId: `mock-workspace-dispatch-${sequence}`,
        status,
      };
      addWork({
        summary,
        context: contextCheck.value,
        worker: workerFor(summary),
        result:
          options.dispatchResult ??
          (status === "completed" ? DEFAULT_COMPLETED_RESULT : undefined),
        failureMessage:
          options.dispatchFailureMessage ??
          (status === "failed" ? DEFAULT_FAILURE_MESSAGE : undefined),
      });
      return ok(mode, cloneSummary(summary));
    },

    async list(): Promise<Outcome<WorkSummary[]>> {
      return ok(
        mode,
        order.map((workId) => cloneSummary(works.get(workId)!.summary)),
      );
    },

    async inspect(workId): Promise<Outcome<WorkDetail>> {
      if (!isNonEmptyString(workId)) {
        return fail(mode, "INVALID_ARGUMENT", "workId 必须是非空字符串");
      }
      const work = works.get(workId.trim());
      if (!work) return notFound<WorkDetail>(workId.trim());
      return ok(mode, {
        ...cloneSummary(work.summary),
        context: work.context.map((record) => ({ ...record })),
        worker: cloneWorker(work.worker),
      });
    },

    async collect(workId): Promise<Outcome<CollectResult>> {
      if (!isNonEmptyString(workId)) {
        return fail(mode, "INVALID_ARGUMENT", "workId 必须是非空字符串");
      }
      const work = works.get(workId.trim());
      if (!work) return notFound<CollectResult>(workId.trim());

      if (work.summary.status === "completed") {
        return ok(mode, {
          status: "completed",
          workId: work.summary.workId,
          result: work.result ?? DEFAULT_COMPLETED_RESULT,
        });
      }
      if (work.summary.status === "running") {
        return ok(mode, { status: "pending", workId: work.summary.workId });
      }
      return ok(mode, {
        status: "failed",
        workId: work.summary.workId,
        error: {
          message: work.failureMessage ?? DEFAULT_FAILURE_MESSAGE,
        },
      });
    },

    async queryContext(query, sessionId): Promise<Outcome<ContextRecord[]>> {
      if (!isNonEmptyString(query)) {
        return fail(mode, "INVALID_ARGUMENT", "query 必须是非空字符串");
      }
      let sessionFilter: string | undefined;
      if (sessionId !== undefined) {
        if (!isNonEmptyString(sessionId)) {
          return fail(mode, "INVALID_ARGUMENT", "sessionId 必须是非空字符串");
        }
        sessionFilter = sessionId.trim();
      }

      const needle = query.trim().toLowerCase();
      return ok(
        mode,
        contexts
          .filter(
            (record) =>
              record.text.trim().toLowerCase().includes(needle) &&
              (sessionFilter === undefined || record.sessionId === sessionFilter),
          )
          .map((record) => ({ ...record })),
      );
    },
  };

  return backend;
}
