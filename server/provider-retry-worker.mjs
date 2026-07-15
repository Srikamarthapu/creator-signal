const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function retryDelaySeconds(attemptCount, baseSeconds = 5, maximumSeconds = 300) {
  const attempt = Math.max(1, Number(attemptCount || 1));
  return Math.min(maximumSeconds, Math.max(1, baseSeconds) * (2 ** (attempt - 1)));
}

function messageId(message) {
  return Number(message?.message_id ?? message?.msg_id ?? 0);
}

function retryId(message) {
  const value = String(message?.message?.retry_id || "");
  return UUID_PATTERN.test(value) ? value : "";
}

export function createProviderRetryWorker({
  readMessages,
  claimRetry,
  runRetry,
  completeRetry,
  failRetry,
  archiveMessage,
  onError = () => {},
  intervalMs = 1500,
  visibilitySeconds = 180,
  batchSize = 2,
  retryBaseSeconds = 5,
  retryMaximumSeconds = 300
}) {
  let timer = null;
  let running = false;

  const runOnce = async () => {
    if (running) return { skipped: true, processed: 0 };
    running = true;
    let processed = 0;
    try {
      const messages = await readMessages({ visibilitySeconds, quantity: batchSize });
      for (const message of messages || []) {
        const queueMessageId = messageId(message);
        const queuedRetryId = retryId(message);
        if (!queueMessageId) continue;
        if (!queuedRetryId) {
          await archiveMessage(queueMessageId);
          processed += 1;
          continue;
        }

        const retry = await claimRetry({ retryId: queuedRetryId, leaseSeconds: visibilitySeconds });
        if (!retry) {
          await archiveMessage(queueMessageId);
          processed += 1;
          continue;
        }

        try {
          const resultSummary = await runRetry(retry);
          await completeRetry({ retryId: retry.id, resultSummary });
          await archiveMessage(queueMessageId);
        } catch (error) {
          const canRetry = Number(retry.attempt_count || 0) < Number(retry.max_attempts || 1);
          const delaySeconds = retryDelaySeconds(retry.attempt_count, retryBaseSeconds, retryMaximumSeconds);
          await failRetry({
            retryId: retry.id,
            errorCategory: "provider_unavailable",
            errorSummary: error instanceof Error ? error.message : "Provider retry failed.",
            requeue: canRetry,
            delaySeconds
          });
          await archiveMessage(queueMessageId);
        }
        processed += 1;
      }
      return { skipped: false, processed };
    } catch (error) {
      onError(error);
      return { skipped: false, processed, error };
    } finally {
      running = false;
    }
  };

  return {
    runOnce,
    start() {
      if (timer) return;
      timer = setInterval(() => void runOnce(), Math.max(250, intervalMs));
      timer.unref?.();
      void runOnce();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
