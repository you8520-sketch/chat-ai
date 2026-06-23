import { recomputeMessageScore } from "./scoring";

/**
 * Phase 2+: Replace inline processing with a durable job queue (Redis/BullMQ or SQLite queue).
 * Training tag/export jobs run via src/cron/trainingScheduler.ts and scripts/training-*.ts.
 * Phase 1 runs synchronously in-process to keep infra minimal.
 */
export type FeedbackQueueJob =
  | { type: "score_recompute"; messageId: number }
  | { type: "score_batch"; messageIds: number[] };

const pending: FeedbackQueueJob[] = [];

export function enqueueScoreRecompute(messageId: number): void {
  pending.push({ type: "score_recompute", messageId });
  void processQueue();
}

export function enqueueScoreBatch(messageIds: number[]): void {
  if (messageIds.length === 0) return;
  pending.push({ type: "score_batch", messageIds });
  void processQueue();
}

let processing = false;

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    while (pending.length > 0) {
      const job = pending.shift()!;
      if (job.type === "score_recompute") {
        recomputeMessageScore(job.messageId);
      } else if (job.type === "score_batch") {
        for (const id of job.messageIds) recomputeMessageScore(id);
      }
    }
  } finally {
    processing = false;
  }
}
