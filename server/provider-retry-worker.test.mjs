import assert from "node:assert/strict";
import test from "node:test";
import { createProviderRetryWorker, retryDelaySeconds } from "./provider-retry-worker.mjs";

const retryId = "123e4567-e89b-42d3-a456-426614174000";

function worker(overrides = {}) {
  return createProviderRetryWorker({
    readMessages: async () => [],
    claimRetry: async () => null,
    runRetry: async () => ({}),
    completeRetry: async () => null,
    failRetry: async () => null,
    archiveMessage: async () => true,
    ...overrides
  });
}

test("retry delays grow exponentially and remain bounded", () => {
  assert.equal(retryDelaySeconds(1, 5, 60), 5);
  assert.equal(retryDelaySeconds(2, 5, 60), 10);
  assert.equal(retryDelaySeconds(5, 5, 60), 60);
});

test("successful provider retries complete before their queue message is archived", async () => {
  const calls = [];
  const retryWorker = worker({
    readMessages: async () => [{ message_id: 7, message: { retry_id: retryId } }],
    claimRetry: async () => {
      calls.push("claim");
      return { id: retryId, attempt_count: 1, max_attempts: 3 };
    },
    runRetry: async () => {
      calls.push("run");
      return { sourceCount: 4 };
    },
    completeRetry: async ({ resultSummary }) => {
      calls.push(`complete:${resultSummary.sourceCount}`);
    },
    archiveMessage: async (messageId) => {
      calls.push(`archive:${messageId}`);
      return true;
    }
  });

  assert.deepEqual(await retryWorker.runOnce(), { skipped: false, processed: 1 });
  assert.deepEqual(calls, ["claim", "run", "complete:4", "archive:7"]);
});

test("failed provider retries are atomically requeued before the consumed message is archived", async () => {
  const calls = [];
  const retryWorker = worker({
    readMessages: async () => [{ message_id: 8, message: { retry_id: retryId } }],
    claimRetry: async () => ({ id: retryId, attempt_count: 1, max_attempts: 3 }),
    runRetry: async () => {
      throw new Error("Temporary provider outage");
    },
    failRetry: async ({ requeue, delaySeconds }) => {
      calls.push(`fail:${requeue}:${delaySeconds}`);
      return { status: "queued" };
    },
    archiveMessage: async (messageId) => {
      calls.push(`archive:${messageId}`);
      return true;
    }
  });

  await retryWorker.runOnce();
  assert.deepEqual(calls, ["fail:true:5", "archive:8"]);
});

test("exhausted provider retries are marked failed without requesting a requeue", async () => {
  const retryWorker = worker({
    readMessages: async () => [{ message_id: 9, message: { retry_id: retryId } }],
    claimRetry: async () => ({ id: retryId, attempt_count: 3, max_attempts: 3 }),
    runRetry: async () => {
      throw new Error("Provider remains unavailable");
    },
    failRetry: async ({ requeue }) => {
      assert.equal(requeue, false);
      return { status: "failed" };
    }
  });

  await retryWorker.runOnce();
});

test("poison and duplicate queue messages are archived without provider execution", async () => {
  const archived = [];
  let runCount = 0;
  const retryWorker = worker({
    readMessages: async () => [
      { message_id: 10, message: { retry_id: "not-a-uuid" } },
      { message_id: 11, message: { retry_id: retryId } }
    ],
    claimRetry: async () => null,
    runRetry: async () => {
      runCount += 1;
    },
    archiveMessage: async (messageId) => {
      archived.push(messageId);
      return true;
    }
  });

  await retryWorker.runOnce();
  assert.deepEqual(archived, [10, 11]);
  assert.equal(runCount, 0);
});
