import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPersistentBackend } from "../examples/router/persistent.ts";
import { RELEASES_URL } from "../examples/router/releases.ts";

function unwrap(outcome) {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return outcome.data;
}

function release(id, flags = {}) {
  return {
    id,
    tag_name: `v0.0.${id}`,
    published_at: "2026-01-01T00:00:00.000Z",
    html_url: `https://github.com/Xpectuer/pi-custom-harness/releases/tag/v0.0.${id}`,
    draft: false,
    prerelease: false,
    ...flags,
  };
}

test("durable release monitoring deduplicates dispatch and recovers the baseline and completion notice", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "pi-router-test-"));
  const sessionId = "test-session";
  const fetchedAt = "2026-01-02T00:00:00.000Z";
  let replies = [release(1), release(4, { prerelease: true })];
  let reads = 0;
  const options = {
    dataDir, sessionId, autoStart: false, now: () => Date.parse(fetchedAt),
    async reader({ beforeRequest, afterRequest }) {
      const action = beforeRequest(RELEASES_URL);
      reads++;
      afterRequest(action, "confirmed");
      return { releases: replies, fetchedAt, source: RELEASES_URL };
    },
  };
  const input = { requestId: "repeatable-release-monitor", task: "监控本项目新正式 Release" };
  let backend;
  try {
    backend = createPersistentBackend(options);
    const { taskId } = unwrap(await backend.dispatch(input));
    assert.equal(unwrap(await backend.dispatch(input)).taskId, taskId);
    const conflict = await backend.dispatch({ ...input, task: "继续检查本项目正式 Release" });
    assert.equal(conflict.ok, false);
    assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");
    await backend.checkNow(taskId);
    assert.equal(reads, 1);
    assert.equal(unwrap(await backend.inspect(taskId)).status, "waiting_external");
    assert.equal(unwrap(await backend.collect(taskId)).delivery, null);

    backend.close();
    backend = createPersistentBackend(options);
    assert.equal(unwrap(await backend.dispatch(input)).taskId, taskId);
    assert.deepEqual(unwrap(await backend.inspect(taskId)).baseline.releaseIds, [1, 4]);
    replies = [release(1), release(2, { draft: true }), release(3, { prerelease: true }), release(4)];
    await backend.checkNow(taskId);
    assert.equal(unwrap(await backend.inspect(taskId)).status, "waiting_external");
    assert.equal(unwrap(await backend.collect(taskId)).delivery, null);

    replies = [...replies, release(5)];
    await backend.checkNow(taskId);
    assert.equal(reads, 3);
    const collected = unwrap(await backend.collect(taskId));
    assert.equal(collected.taskStatus, "completed");
    assert.equal(collected.acceptance, "accepted");
    assert.deepEqual(collected.delivery.evidence.map(({id}) => id), [5]);
    const events = unwrap(await backend.pendingNotices(sessionId)).filter(({eventType}) => eventType === "task_completed");
    assert.equal(events.length, 1);
    const { eventId } = events[0];
    const notice = unwrap(await backend.beginDelivery(eventId, sessionId));
    const { attemptId } = notice.attempts[0];
    backend.close();
    backend = createPersistentBackend(options);
    const restored = unwrap(await backend.pendingNotices(sessionId)).find((item) => item.eventId === eventId);
    assert.equal(restored.deliveryState, "reconciliation_required");
    assert.equal(restored.failureCount, 0);
    assert.equal((await backend.beginDelivery(eventId, sessionId)).ok, false);
    assert.equal(unwrap(await backend.reconcileDelivery(eventId, sessionId, attemptId)).deliveryState, "delivered");
    assert.equal(unwrap(await backend.pendingNotices(sessionId)).some((item) => item.eventId === eventId), false);
  } finally {
    backend?.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
