/** 本地任务控制面；执行器仅能经准入回调读取固定 GitHub API。 */
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  TASK_STATUSES, fail, isNonEmptyString, ok,
  type Action, type BackendMode, type ContextSource, type Delivery, type ListInput,
  type Notice, type Outcome, type RouterBackend, type RouterErrorCode,
  type TaskDetail, type TaskEvent, type TaskSummary,
} from "./backend.ts";
import { readReleases, RELEASES_URL, validateReleaseEnv, type ReleaseSnapshot } from "./releases.ts";

export interface PersistentOptions {
  dataDir: string;
  ownerScope?: string;
  sessionId?: string;
  env?: Record<string, string>;
  /** 可信接入/验证控制面，不接受模型参数。 */
  now?: () => number;
  reader?: typeof readReleases;
  executorId?: string;
  autoStart?: boolean;
  authorizationExpiresAt?: string;
}
export interface PersistentBackend extends RouterBackend {
  checkNow(taskId?: string): Promise<void>;
  waitForIdle(): Promise<void>;
  revoke(taskId: string): void;
}
interface StoredTask extends Omit<TaskDetail, "notices" | "deliveries"> {
  failures: number;
  deliveries: Delivery[];
}
class BoundaryError extends Error {
  readonly code: RouterErrorCode;
  constructor(code: RouterErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
const terminal: Record<string, true> = { completed: true, cancelled: true, failed: true };
const id = (prefix: string) => `${prefix}-${randomUUID()}`;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const summary = (task: StoredTask): TaskSummary => {
  const { taskId, goal, goalVersion, ownerSessionId, status, acceptance, createdAt, updatedAt, waitReason, nextCheckAt } = task;
  return { taskId, goal, goalVersion, ownerSessionId, status, acceptance, createdAt, updatedAt, waitReason, nextCheckAt };
};
const validDate = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
function allowedURL(target: string): boolean {
  try {
    const url = new URL(target);
    return url.origin === "https://api.github.com" && !url.username && !url.password
      && url.pathname === "/repos/Xpectuer/pi-custom-harness/releases"
      && [...url.searchParams].every(([key, value]) => (key === "page" || key === "per_page") && /^[1-9]\d*$/.test(value));
  } catch { return false; }
}
function supportedGoal(text: string): boolean {
  // 此执行器不解释自然语言中的动作；显式的其他目标或执行要求不能进入读取器。
  const refs = text.match(/(?:https?:\/\/[^\s]+|[\w.-]+\/[\w.-]+)/g) ?? [];
  const otherTarget = refs.some((ref) => !ref.includes("Xpectuer/pi-custom-harness"));
  return !otherTarget && !/\b(?:bash|shell|touch|mkdir|process\.env|token|credential|send|write|delete)\b|写文件|发送|删除|凭证|密钥|另一仓库|其他仓库/i.test(text)
    && /release|发布|监控|继续检查|继续|检查/i.test(text);
}

export function createPersistentBackend(options: PersistentOptions): PersistentBackend {
  if (!isNonEmptyString(options.dataDir)) throw new Error("真实后端缺少可信数据目录");
  validateReleaseEnv(options.env);
  const root = resolve(options.dataDir);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  chmodSync(root, 0o700);
  const owner = new DatabaseSync(join(root, "owner.sqlite"));
  let db: DatabaseSync;
  try {
    chmodSync(join(root, "owner.sqlite"), 0o600);
    owner.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
    db = new DatabaseSync(join(root, "tasks.sqlite"));
    chmodSync(join(root, "tasks.sqlite"), 0o600);
    const versionRow = db.prepare("PRAGMA user_version").get();
    const version = versionRow?.user_version;
    if (version !== 0 && version !== 1) throw new Error("不支持的任务数据库版本");
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks (
        task_id TEXT PRIMARY KEY, owner_scope TEXT NOT NULL, request_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL, status TEXT NOT NULL, updated_at TEXT NOT NULL,
        next_check_at TEXT, data TEXT NOT NULL, UNIQUE(owner_scope, request_id));
      CREATE INDEX IF NOT EXISTS task_listing ON tasks(owner_scope, updated_at, task_id);
      CREATE INDEX IF NOT EXISTS task_filter ON tasks(owner_scope, status, updated_at, task_id);
      CREATE INDEX IF NOT EXISTS task_due ON tasks(owner_scope, next_check_at);
      CREATE TABLE IF NOT EXISTS notices (
        event_id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(task_id),
        target_session TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS notice_pending ON notices(target_session, state);
      CREATE TABLE IF NOT EXISTS contexts (
        owner_scope TEXT NOT NULL, reference_id TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY(owner_scope, reference_id));
      PRAGMA user_version=1;`);
  } catch (error) {
    try { db!?.close(); } finally { owner.close(); }
    if (error instanceof Error && error.message === "不支持的任务数据库版本") throw error;
    throw new Error("任务数据目录被占用或无法打开；不得删除锁库抢占");
  }
  const mode: BackendMode = "backend";
  const scope = options.ownerScope ?? "local";
  const clock = options.now ?? Date.now;
  const iso = () => new Date(clock()).toISOString();
  const reader = options.reader ?? readReleases;
  const env = { ...options.env };
  let session = options.sessionId ?? "";
  let closed = false;
  let storageFailed = false;
  let timer: NodeJS.Timeout | undefined;
  const active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
  const listeners = new Set<(event: TaskEvent) => void>();
  function ensureOpen() {
    if (closed || storageFailed) throw new BoundaryError("BACKEND_ERROR", "任务存储不可用，已停止新动作");
  }
  function transaction<T>(operation: () => T): T {
    ensureOpen();
    db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); db.exec("COMMIT"); return result; }
    catch (error) {
      db.exec("ROLLBACK");
      if (!(error instanceof BoundaryError)) {
        storageFailed = true;
        clearTimeout(timer);
        for (const work of active.values()) work.controller.abort();
      }
      throw error;
    }
  }
  function load(taskId: string): StoredTask {
    ensureOpen();
    if (!isNonEmptyString(taskId)) throw new BoundaryError("INVALID_ARGUMENT", "taskId 必须非空");
    const row = db.prepare("SELECT data FROM tasks WHERE task_id=? AND owner_scope=?").get(taskId, scope) as { data: string } | undefined;
    if (!row) throw new BoundaryError("NOT_FOUND", "未找到任务");
    return JSON.parse(row.data);
  }
  function save(task: StoredTask) {
    task.updatedAt = iso();
    db.prepare("UPDATE tasks SET status=?,updated_at=?,next_check_at=?,data=? WHERE task_id=? AND owner_scope=?")
      .run(task.status, task.updatedAt, task.nextCheckAt ?? null, JSON.stringify(task), task.taskId, scope);
  }
  function notices(taskId: string): Notice[] {
    return (db.prepare("SELECT data FROM notices WHERE task_id=? ORDER BY rowid").all(taskId) as { data: string }[])
      .map((row) => JSON.parse(row.data));
  }
  function saveNotice(notice: Notice) {
    db.prepare("UPDATE notices SET state=?, data=? WHERE event_id=?")
      .run(notice.deliveryState, JSON.stringify(notice), notice.eventId);
  }
  function emit(task: StoredTask, eventType: string, runId?: string) {
    const notice: Notice = { eventId: id("event"), taskId: task.taskId, runId,
      eventType, occurredAt: iso(), targetSessionId: task.ownerSessionId,
      deliveryState: "pending", failureCount: 0, attempts: [] };
    db.prepare("INSERT INTO notices VALUES(?,?,?,?,?)")
      .run(notice.eventId, task.taskId, notice.targetSessionId, notice.deliveryState, JSON.stringify(notice));
    queueMicrotask(() => {
      if (closed || storageFailed) return;
      for (const listener of listeners) {
        try { listener(notice); } catch { /* 订阅只唤醒；持久待投递箱仍是事实来源。 */ }
      }
    });
  }
  async function result<T>(operation: () => T): Promise<Outcome<T>> {
    try { ensureOpen(); return ok(mode, operation()); }
    catch (error) {
      return error instanceof BoundaryError ? fail(mode, error.code, error.message)
        : fail(mode, "BACKEND_ERROR", "后端存储操作失败，未确认成功");
    }
  }
  function authorizationCheck(task: StoredTask, runId: string, target: string, version: number): RouterErrorCode | undefined {
    if (!allowedURL(target) || !task.authorization.readScopes.includes(RELEASES_URL) || task.authorization.approval !== "approved") return "PERMISSION_DENIED";
    if (task.authorization.version !== version || task.authorization.revokedAt || task.status === "cancel_requested" || terminal[task.status]) return "AUTHORIZATION_REVOKED";
    if (Date.parse(task.authorization.expiresAt) <= clock()) return "AUTHORIZATION_EXPIRED";
    const run = task.runs.find((item) => item.runId === runId);
    if (!run || run.goalVersion !== task.goalVersion || run.status !== "running") return "AUTHORIZATION_REVOKED";
  }
  function beforeRequest(taskId: string, runId: string, target: string, version: number): string {
    const admitted = transaction(() => {
      const task = load(taskId);
      const denied = authorizationCheck(task, runId, target, version);
      const action: Action = { actionId: id("action"), taskId, runId,
        goalVersion: task.runs.find((item) => item.runId === runId)!.goalVersion, authorizationVersion: version,
        target, check: denied ?? "allowed", effectState: "not_started" };
      // 核权与动作意图同事务；崩溃后未确认的准入视为未知。
      if (!denied) action.effectState = "unknown";
      task.actions.push(action);
      save(task);
      return { actionId: action.actionId, denied };
    });
    if (admitted.denied) throw new BoundaryError(admitted.denied, "执行边界拒绝该动作");
    return admitted.actionId;
  }
  function afterRequest(taskId: string, actionId: string, state: "confirmed" | "unknown", error?: string) {
    if (closed || storageFailed) return;
    transaction(() => {
      const task = load(taskId);
      const action = task.actions.find((item) => item.actionId === actionId)!;
      action.effectState = state;
      action.error = error;
      save(task);
    });
  }
  function start(taskId: string): Promise<void> {
    const previous = active.get(taskId);
    if (previous) return previous.promise;
    const controller = new AbortController();
    const run = transaction(() => {
      const task = load(taskId);
      if (terminal[task.status] || task.status === "cancel_requested" || task.status === "blocked") return null;
      task.executor.env = { ...env };
      let run = task.runs.find((item) => item.status === "queued" && item.goalVersion === task.goalVersion);
      if (run) {
        run.status = "running";
        run.startedAt = iso();
        run.executorId = options.executorId ?? "github-release-read";
      } else {
        run = { runId: id("run"), taskId, goalVersion: task.goalVersion,
          executorId: options.executorId ?? "github-release-read", status: "running", startedAt: iso() };
        task.runs.push(run);
      }
      for (const input of task.inputs) if (input.status === "applied" && !input.runId) input.runId = run.runId;
      task.status = "active";
      task.nextCheckAt = undefined;
      save(task);
      return run;
    });
    if (!run) return Promise.resolve();
    const authorizationVersion = load(taskId).authorization.version;
    // 延后一微任务，确保活动句柄在任何异步读取开始前存在。
    const promise = Promise.resolve().then(async () => {
      try {
        const snapshot = await reader({ signal: controller.signal, env, timeoutMs: 15_000,
          beforeRequest: (target) => beforeRequest(taskId, run.runId, target, authorizationVersion),
          afterRequest: (actionId, state, error) => afterRequest(taskId, actionId, state, error) });
        if (closed || storageFailed) return;
        transaction(() => finishSnapshot(load(taskId), run.runId, snapshot));
      } catch (error) {
        if (closed || storageFailed) return;
        transaction(() => {
          const task = load(taskId);
          const savedRun = task.runs.find((item) => item.runId === run.runId)!;
          savedRun.endedAt = iso();
          if (task.status === "cancel_requested") {
            savedRun.status = "cancelled";
            task.status = "cancelled";
            task.cancellation.stopState = task.actions.some((action) => action.effectState === "unknown") ? "effects_unknown" : "stopped";
            emit(task, "task_cancelled", run.runId);
          } else if (run.goalVersion !== task.goalVersion) {
            savedRun.status = "interrupted";
            savedRun.error = "目标版本已改变，旧检查中断";
          } else {
            savedRun.status = "failed";
            savedRun.error = error instanceof BoundaryError ? error.message : "发布检查失败；网络、响应或来源不可用";
            task.failures++;
            const requested = error && typeof error === "object" && "retryAfterMs" in error
              && typeof error.retryAfterMs === "number" ? error.retryAfterMs : 0;
            const backoff = Math.min(900_000, 60_000 * 2 ** Math.min(task.failures - 1, 4));
            const unknown = task.actions.some((action) => action.runId === run.runId && action.effectState === "unknown");
            task.status = error instanceof BoundaryError || task.authorization.revokedAt || unknown ? "blocked" : "waiting_external";
            task.waitReason = unknown ? "外部动作结果未知，需查证或用户决定；未自动重复动作" : savedRun.error;
            task.nextCheckAt = task.status === "blocked" ? undefined : new Date(clock() + Math.max(backoff, requested ?? 0)).toISOString();
            emit(task, "run_failed", run.runId);
          }
          save(task);
        });
      }
    }).catch(() => {
      storageFailed = true;
      for (const work of active.values()) work.controller.abort();
    }).finally(() => { active.delete(taskId); arm(); });
    active.set(taskId, { controller, promise });
    return promise;
  }
  function finishSnapshot(task: StoredTask, runId: string, snapshot: ReleaseSnapshot) {
    const run = task.runs.find((item) => item.runId === runId)!;
    run.endedAt = iso();
    run.status = "completed";
    const stale = run.goalVersion !== task.goalVersion || task.status === "cancel_requested";
    const baseline = new Set(task.baseline?.releaseIds ?? []);
    const candidates = task.baseline ? snapshot.releases.filter((release) => !baseline.has(release.id) && !release.draft && !release.prerelease) : [];
    const evidence = candidates.filter((release) => Number.isSafeInteger(release.id) && release.id > 0
      && isNonEmptyString(release.tag_name) && validDate(release.published_at)
      && /^https:\/\/github\.com\/Xpectuer\/pi-custom-harness\/releases\/tag\/[^\s?#]+$/.test(release.html_url))
      .map((release) => ({ id: release.id, tag_name: release.tag_name, published_at: release.published_at!,
        html_url: release.html_url, fetchedAt: snapshot.fetchedAt, source: snapshot.source,
        authorizationVersion: task.actions.find((action) => action.runId === runId)?.authorizationVersion ?? task.authorization.version }));
    if (candidates.length || stale) {
      const delivery: Delivery = { runId, goalVersion: run.goalVersion, stale,
        summary: evidence.length ? `发现 ${evidence.length} 项新正式 Release` : "检查结束，尚无有效正式发布证据",
        artifacts: evidence.map((item) => item.html_url), evidence,
        unfinished: evidence.length ? [] : ["取得基线之外的新正式 Release"],
        blockers: candidates.length !== evidence.length ? ["发布字段或原始链接无效，来源无法验收"] : [],
        acceptance: !stale && evidence.length > 0 && candidates.length === evidence.length ? "accepted" : "rejected" };
      task.deliveries.push(delivery);
      if (!stale) task.acceptance = delivery.acceptance;
      if (delivery.acceptance === "accepted") {
        task.status = "completed";
        task.waitReason = undefined;
        task.nextCheckAt = undefined;
        emit(task, "task_completed", runId);
      }
    }
    if (task.status === "cancel_requested") {
      run.status = "cancelled";
      task.status = "cancelled";
      task.cancellation.stopState = task.actions.some((action) => action.effectState === "unknown") ? "effects_unknown" : "stopped";
      emit(task, "task_cancelled", runId);
    } else if (!stale && task.status !== "completed") {
      if (!task.baseline) task.baseline = { releaseIds: [...new Set(snapshot.releases.map((release) => release.id))], establishedAt: snapshot.fetchedAt };
      task.failures = 0;
      task.status = "waiting_external";
      task.waitReason = candidates.length ? "候选发布未通过验收" : "基线已建立，等待新正式 Release";
      task.nextCheckAt = new Date(clock() + 60_000).toISOString();
      if (task.runs.length === 1) emit(task, "baseline_established", runId);
    }
    save(task);
  }
  function arm() {
    clearTimeout(timer);
    if (closed || storageFailed || options.autoStart === false) return;
    const row = db.prepare("SELECT MIN(next_check_at) AS due FROM tasks WHERE owner_scope=? AND status IN ('active','waiting_external')").get(scope) as { due: string | null };
    if (!row.due) return;
    timer = setTimeout(() => {
      void checkDue().catch(() => { storageFailed = true; });
    }, Math.max(0, Math.min(2_147_483_647, Date.parse(row.due) - clock())));
    timer.unref();
  }
  async function checkDue(forceTaskId?: string) {
    ensureOpen();
    const rows = forceTaskId ? [{ task_id: forceTaskId }] : db.prepare("SELECT task_id FROM tasks WHERE owner_scope=? AND status IN ('active','waiting_external') AND next_check_at<=?").all(scope, iso()) as { task_id: string }[];
    await Promise.all(rows.map((row) => start(row.task_id)));
    arm();
  }
  function getNotice(eventId: string): Notice {
    const row = db.prepare("SELECT n.data FROM notices n JOIN tasks t ON t.task_id=n.task_id WHERE n.event_id=? AND t.owner_scope=?").get(eventId, scope) as { data: string } | undefined;
    if (!row) throw new BoundaryError("NOT_FOUND", "未找到通知");
    return JSON.parse(row.data);
  }
  // 恢复先冻结未知动作；只读GET也不重复未知动作，需明确用户输入后继续检查。
  transaction(() => {
    for (const row of db.prepare("SELECT data FROM tasks WHERE owner_scope=?").all(scope) as { data: string }[]) {
      const task: StoredTask = JSON.parse(row.data);
      for (const run of task.runs) if (run.status === "running" || run.status === "queued") {
        run.status = "interrupted"; run.endedAt = iso(); run.error = "后端进程中断";
      }
      if (!terminal[task.status]) {
        if (task.status === "cancel_requested") {
          task.status = "cancelled";
          task.cancellation.stopState = task.actions.some((action) => action.effectState === "unknown") ? "effects_unknown" : "stopped";
        } else if (task.actions.some((action) => action.effectState === "unknown")) {
          task.status = "blocked"; task.waitReason = "外部动作效果未知，需查证后由用户决定继续"; task.nextCheckAt = undefined;
        } else if (task.status === "active") {
          task.status = "waiting_external"; task.nextCheckAt = iso();
        }
        save(task);
      }
      for (const notice of notices(task.taskId)) if (notice.deliveryState === "in_flight") {
        notice.deliveryState = "reconciliation_required";
        notice.lastError = "发送上下文已中断，核对原会话持久记录后处理";
        saveNotice(notice);
      }
    }
  });
  const backend: PersistentBackend = {
    mode,
    async dispatch(input) {
      const response = await result(() => transaction(() => {
        if (!input || Object.keys(input).some((key) => !["requestId", "task", "contextRefs"].includes(key))
          || !isNonEmptyString(input.requestId) || !isNonEmptyString(input.task) || !session)
          throw new BoundaryError("INVALID_ARGUMENT", "必须绑定会话并提供 requestId、task；不接受权限或正文参数");
        const refs = input.contextRefs ?? [];
        if (!Array.isArray(refs) || refs.some((ref) => !ref || Object.keys(ref).some((key) => !["referenceId", "sourceVersion"].includes(key)) || !isNonEmptyString(ref.referenceId) || !isNonEmptyString(ref.sourceVersion)))
          throw new BoundaryError("INVALID_ARGUMENT", "contextRefs 必须为可信引用标识与版本");
        const normalized = { task: input.task.trim(), refs: [...new Map(refs.map((ref) => [ref.referenceId, { referenceId: ref.referenceId.trim(), sourceVersion: ref.sourceVersion.trim() }])).values()].sort((a, b) => a.referenceId.localeCompare(b.referenceId)) };
        const fingerprint = digest(normalized);
        const existing = db.prepare("SELECT task_id,fingerprint FROM tasks WHERE owner_scope=? AND request_id=?").get(scope, input.requestId.trim()) as { task_id: string; fingerprint: string } | undefined;
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new BoundaryError("IDEMPOTENCY_CONFLICT", "同一 requestId 已用于不同请求");
          return summary(load(existing.task_id));
        }
        const contexts = normalized.refs.map((ref) => {
          const row = db.prepare("SELECT data FROM contexts WHERE owner_scope=? AND reference_id=?").get(scope, ref.referenceId) as { data: string } | undefined;
          const source: ContextSource | undefined = row && JSON.parse(row.data);
          if (!source || source.access !== "allowed" || source.sourceVersion !== ref.sourceVersion)
            throw new BoundaryError("PERMISSION_DENIED", "上下文引用不存在、版本过期或无访问权限");
          return source;
        });
        const supported = supportedGoal(normalized.task);
        const task: StoredTask = { taskId: id("task"), goal: normalized.task, goalVersion: 1,
          ownerSessionId: session, status: supported ? "active" : "blocked", acceptance: "pending", createdAt: iso(), updatedAt: iso(),
          waitReason: supported ? "等待首次完整发布读取" : "只支持本项目正式 Release 监控，未授权其他目标或动作",
          nextCheckAt: supported ? iso() : undefined, runs: [], inputs: [],
          authorization: { version: 1, readScopes: [RELEASES_URL], writeRoots: [], sendScopes: [session],
            expiresAt: options.authorizationExpiresAt ?? new Date(clock() + 365 * 86_400_000).toISOString(), approval: "approved" },
          contexts, deliveries: [], actions: [], cancellation: { stopState: "none" }, baseline: null,
          executor: { isolation: "host", profile: "github-release-read", env: { ...env } }, failures: 0 };
        if (supported) task.runs.push({ runId: id("run"), taskId: task.taskId, goalVersion: 1,
          executorId: options.executorId ?? "github-release-read", status: "queued", startedAt: iso() });
        db.prepare("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?)").run(task.taskId, scope, input.requestId.trim(), fingerprint, task.status, task.updatedAt, task.nextCheckAt ?? null, JSON.stringify(task));
        emit(task, supported ? "task_created" : "task_blocked");
        return summary(task);
      }));
      arm();
      return response;
    },
    async list(input: ListInput = {}) {
      return result(() => {
        if (!input || Object.keys(input).some((key) => !["statuses", "updatedFrom", "updatedTo", "cursor", "limit"].includes(key))) throw new BoundaryError("INVALID_ARGUMENT", "列表参数无效");
        const limit = input.limit ?? 20;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (input.statuses !== undefined && (!Array.isArray(input.statuses) || input.statuses.some((status) => !TASK_STATUSES.includes(status))))
          || (input.updatedFrom !== undefined && !validDate(input.updatedFrom)) || (input.updatedTo !== undefined && !validDate(input.updatedTo))) throw new BoundaryError("INVALID_ARGUMENT", "过滤条件或页大小无效");
        const filter = { statuses: [...new Set(input.statuses ?? [])].sort(), from: input.updatedFrom ? new Date(input.updatedFrom).toISOString() : null, to: input.updatedTo ? new Date(input.updatedTo).toISOString() : null };
        const binding = digest({ scope, ...filter });
        const clauses = ["owner_scope=?"];
        const params: (string | number)[] = [scope];
        if (filter.statuses.length) { clauses.push(`status IN (${filter.statuses.map(() => "?").join(",")})`); params.push(...filter.statuses); }
        if (filter.from) { clauses.push("updated_at>=?"); params.push(filter.from); }
        if (filter.to) { clauses.push("updated_at<?"); params.push(filter.to); }
        if (input.cursor !== undefined) {
          let cursor: { binding: string; time: string; taskId: string };
          try { cursor = JSON.parse(Buffer.from(input.cursor, "base64url").toString()); }
          catch { throw new BoundaryError("INVALID_ARGUMENT", "游标无效"); }
          if (cursor?.binding !== binding || !validDate(cursor.time) || !isNonEmptyString(cursor.taskId)) throw new BoundaryError("INVALID_ARGUMENT", "游标与过滤条件不匹配");
          clauses.push("(updated_at,task_id)>(?,?)"); params.push(cursor.time, cursor.taskId);
        }
        const rows = db.prepare(`SELECT data FROM tasks WHERE ${clauses.join(" AND ")} ORDER BY updated_at,task_id LIMIT ?`).all(...params, limit + 1) as { data: string }[];
        const items = rows.slice(0, limit).map((row) => summary(JSON.parse(row.data)));
        const last = items.at(-1);
        return { items, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ binding, time: last.updatedAt, taskId: last.taskId })).toString("base64url") : null };
      });
    },
    async inspect(taskId) {
      return result(() => {
        const { failures: _failures, deliveries, ...task } = load(taskId);
        return { ...task, notices: notices(taskId), deliveries: deliveries.map(({ runId, goalVersion, stale, acceptance }) => ({ runId, goalVersion, stale, acceptance })) };
      });
    },
    async collect(taskId) {
      return result(() => { const task = load(taskId); return { taskId, taskStatus: task.status, acceptance: task.acceptance,
        delivery: task.deliveries.filter((item) => !item.stale && item.goalVersion === task.goalVersion).at(-1) ?? null,
        history: task.deliveries.filter((item) => item.stale || item.goalVersion !== task.goalVersion),
        pending: task.acceptance === "accepted" ? null : task.waitReason ?? "任务尚未取得有效交付" }; });
    },
    async queryContext(query, sessionId) {
      return result(() => {
        if (!isNonEmptyString(query) || (sessionId !== undefined && !isNonEmptyString(sessionId))) throw new BoundaryError("INVALID_ARGUMENT", "query/sessionId 必须非空");
        const sources = db.prepare("SELECT data FROM contexts WHERE owner_scope=?").all(scope) as { data: string }[];
        return { capability: "substring" as const, items: sources.map((row) => JSON.parse(row.data) as ContextSource).filter((source) => source.access === "allowed" && (!sessionId || source.sessionId === sessionId.trim()) && source.text.toLowerCase().includes(query.trim().toLowerCase())) };
      });
    },
    async sendInput(taskId, message) {
      const response = await result(() => transaction(() => {
        if (!isNonEmptyString(message)) throw new BoundaryError("INVALID_ARGUMENT", "message 必须非空");
        const task = load(taskId);
        const supported = supportedGoal(message);
        const rejected = terminal[task.status] || task.status === "cancel_requested" || !!task.authorization.revokedAt;
        const receipt = { inputId: id("input"), message: message.trim(), receivedAt: iso(), goalVersion: task.goalVersion,
          status: "received" as "received" | "applied" | "rejected", reason: undefined as string | undefined };
        task.inputs.push(receipt);
        if (rejected) { receipt.status = "rejected"; receipt.reason = "任务已结束、取消或授权已撤销"; }
        else {
          for (const run of task.runs) if (run.status === "queued") {
            run.status = "interrupted";
            run.endedAt = iso();
            run.error = "目标版本已改变，未启动旧检查";
          }
          receipt.status = "applied"; receipt.goalVersion = ++task.goalVersion;
          task.goal = message.trim(); task.acceptance = "pending";
          task.authorization.version++;
          for (const delivery of task.deliveries) delivery.stale = true;
          task.status = supported ? "waiting_external" : "blocked";
          task.waitReason = supported ? "已应用输入，等待新检查" : "新目标不在当前授权内，需可信用户批准";
          task.nextCheckAt = supported ? iso() : undefined;
        }
        save(task); emit(task, receipt.status === "applied" ? "input_applied" : "input_rejected");
        return receipt;
      }));
      arm(); return response;
    },
    async cancel(taskId) {
      const response = await result(() => transaction(() => {
        const task = load(taskId);
        if (!terminal[task.status] && task.status !== "cancel_requested") {
          task.status = "cancel_requested"; task.nextCheckAt = undefined;
          task.authorization.version++; task.authorization.revokedAt = iso(); task.cancellation.stopState = "stop_requested";
          save(task); emit(task, "cancel_requested");
        }
        if (task.status === "cancelled") return { accepted: true, stopState: task.cancellation.stopState as "stopped" | "effects_unknown", effects: task.actions };
        return { accepted: !terminal[task.status], stopState: "stop_requested" as const, effects: task.actions };
      }));
      const work = active.get(taskId);
      if (response.ok && response.data.accepted) {
        if (work) work.controller.abort();
        else queueMicrotask(() => {
          if (closed || storageFailed) return;
          transaction(() => {
            const task = load(taskId);
            if (task.status !== "cancel_requested") return;
            task.status = "cancelled";
            for (const run of task.runs) if (run.status === "queued") {
              run.status = "cancelled";
              run.endedAt = iso();
            }
            task.cancellation.stopState = task.actions.some((action) => action.effectState === "unknown") ? "effects_unknown" : "stopped";
            save(task);
            emit(task, "task_cancelled");
          });
        });
      }
      arm(); return response;
    },
    bindSession(sessionId) { if (!isNonEmptyString(sessionId)) throw new Error("会话身份不可为空"); session = sessionId; },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async pendingNotices(sessionId) {
      return result(() => (db.prepare("SELECT n.data FROM notices n JOIN tasks t ON t.task_id=n.task_id WHERE t.owner_scope=? AND n.target_session=? AND n.state!='delivered' ORDER BY n.rowid").all(scope, sessionId) as { data: string }[]).map((row) => JSON.parse(row.data)));
    },
    async beginDelivery(eventId, sessionId) {
      return result(() => transaction(() => {
        const notice = getNotice(eventId);
        if (notice.targetSessionId !== sessionId || session !== sessionId) throw new BoundaryError("PERMISSION_DENIED", "只能向当前绑定原会话投递");
        if (notice.deliveryState !== "pending" || notice.failureCount >= 4) throw new BoundaryError("INVALID_ARGUMENT", "通知不可新建投递尝试");
        notice.attempts.push({ attemptId: id("attempt"), state: "in_flight" }); notice.deliveryState = "in_flight";
        saveNotice(notice); return notice;
      }));
    },
    async settleDelivery(eventId, attemptId, outcome) {
      return result(() => transaction(() => {
        const notice = getNotice(eventId);
        const attempt = notice.attempts.at(-1);
        if (!attempt || attempt.attemptId !== attemptId) throw new BoundaryError("INVALID_ARGUMENT", "投递尝试不匹配");
        if (attempt.state === "delivered" || attempt.state === "failed") return notice;
        attempt.state = outcome.state; attempt.error = outcome.error; notice.lastError = outcome.error;
        if (outcome.state === "failed") { notice.failureCount++; notice.deliveryState = notice.failureCount >= 4 ? "exhausted" : "pending"; }
        else notice.deliveryState = outcome.state === "delivered" ? "delivered" : "reconciliation_required";
        saveNotice(notice); return notice;
      }));
    },
    async reconcileDelivery(eventId, sessionId, attemptId) {
      return result(() => transaction(() => {
        const notice = getNotice(eventId);
        if (notice.targetSessionId !== sessionId) throw new BoundaryError("PERMISSION_DENIED", "收据不属于目标会话");
        const attempt = notice.attempts.find((item) => item.attemptId === attemptId);
        if (!attempt) throw new BoundaryError("INVALID_ARGUMENT", "收据尝试不存在");
        attempt.state = "delivered"; notice.deliveryState = "delivered"; notice.lastError = undefined; saveNotice(notice); return notice;
      }));
    },
    registerContextSource(source) {
      transaction(() => { db.prepare("INSERT INTO contexts VALUES(?,?,?) ON CONFLICT(owner_scope,reference_id) DO UPDATE SET data=excluded.data").run(scope, source.referenceId, JSON.stringify(source)); });
    },
    checkNow: checkDue,
    async waitForIdle() { while (active.size) await Promise.all([...active.values()].map((work) => work.promise)); },
    revoke(taskId) { transaction(() => { const task = load(taskId); task.authorization.version++; task.authorization.revokedAt = iso(); task.status = "blocked"; task.waitReason = "授权已撤销"; task.nextCheckAt = undefined; save(task); emit(task, "authorization_revoked"); }); active.get(taskId)?.controller.abort(); arm(); },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      for (const work of active.values()) work.controller.abort();
      listeners.clear(); db.close(); owner.close();
    },
  };
  arm();
  return backend;
}
