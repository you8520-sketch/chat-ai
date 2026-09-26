/**
 * Safe feasibility proof: model pricing tracker claim/reclaim idempotency (local only).
 *
 * Scope: claimTrackerRun + finishTrackerRun only.
 * Does NOT prove finance/payout/training scheduler idempotency.
 * Does NOT start server.js or touch production DATA_DIR.
 *
 * Usage: npx tsx scripts/audit/model-pricing-tracker-claim-reclaim-idempotency-proof.ts
 */
import Database from "better-sqlite3";
import { claimTrackerRun, finishTrackerRun } from "@/lib/modelPricingTrackerPersistence";
import { ensureModelPricingTrackingSchema } from "@/lib/modelPricingTrackingSchema";

function main() {
  const db = new Database(":memory:");
  ensureModelPricingTrackingSchema(db);

  const runDateKey = "2099-01-01";
  const startedAt = "2099-01-01T03:00:00.000Z";

  const first = claimTrackerRun(db, { runDateKey, phase: "proof", startedAt });
  if (first.outcome !== "CLAIMED") {
    throw new Error(`expected first claim CLAIMED, got ${first.outcome}`);
  }

  finishTrackerRun(db, {
    attemptId: first.attemptId,
    status: "completed",
    finishedAt: "2099-01-01T03:01:00.000Z",
  });

  const second = claimTrackerRun(db, { runDateKey, phase: "proof", startedAt });
  if (second.outcome !== "SKIPPED_DUPLICATE") {
    throw new Error(`expected second claim SKIPPED_DUPLICATE, got ${second.outcome}`);
  }

  const failed = claimTrackerRun(db, {
    runDateKey: "2099-01-02",
    phase: "proof",
    startedAt,
  });
  if (failed.outcome !== "CLAIMED") {
    throw new Error(`expected failed-day claim CLAIMED, got ${failed.outcome}`);
  }
  finishTrackerRun(db, {
    attemptId: failed.attemptId,
    status: "failed",
    finishedAt: "2099-01-01T03:02:00.000Z",
    errorSummary: "proof failure",
  });

  const retry = claimTrackerRun(db, {
    runDateKey: "2099-01-02",
    phase: "proof-retry",
    startedAt: "2099-01-01T03:03:00.000Z",
  });
  if (retry.outcome !== "CLAIMED" || !retry.reclaimed) {
    throw new Error(`expected failed-day retry CLAIMED+reclaimed, got ${JSON.stringify(retry)}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        proof: "model-pricing-tracker-claim-reclaim-idempotency",
        results: {
          completedDayDuplicate: second.outcome,
          failedDayReclaim: retry.outcome,
          reclaimed: retry.reclaimed,
        },
      },
      null,
      2
    )
  );
}

main();
