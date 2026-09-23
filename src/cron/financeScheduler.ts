import cron, { type ScheduledTask } from "node-cron";
import { saveDailyFinanceSnapshot, currentKstMonthKey, monthRangeSql } from "@/lib/adminFinance";
import { getDb } from "@/lib/db";
import { runModelPricingTracker } from "@/lib/modelPricingTracker";
import { reconcileCheaperInferenceUsage } from "@/lib/providerCostReconciliation";
import {
  SCHEDULER_TIMEZONE,
  schedulerCronExpression,
} from "@/lib/schedulerDefinitions";
import {
  resolveSchedulerSlot,
  runDurableScheduledJob,
  shouldAttemptBootRecovery,
  type SchedulerTriggerKind,
} from "@/lib/schedulerRunRegistry";

export const FINANCE_DAILY_CRON = schedulerCronExpression("finance_daily");
export const FINANCE_TIMEZONE = SCHEDULER_TIMEZONE;

let scheduledTask: ScheduledTask | null = null;

async function executeFinanceSnapshot() {
  try {
    const range = monthRangeSql(currentKstMonthKey());
    const recon = await reconcileCheaperInferenceUsage({
      windowStart: range.start,
      windowEnd: range.end,
    });
    console.log("[finance-scheduler] provider reconciliation", {
      status: recon.status,
      providerRequests: recon.providerRequests,
      deltaMicroUsd: recon.dailyDeltaMicroUsd,
      unreconciledMicroUsd: recon.unreconciledProviderMicroUsd,
    });
  } catch (reconError) {
    console.error("[finance-scheduler] provider reconciliation failed:", reconError);
  }

  const summary = saveDailyFinanceSnapshot();
  console.log("[finance-scheduler] daily snapshot saved", {
    month: summary.monthKey,
    netProfitKrw: summary.netProfitKrw,
    aiActualKrw: summary.aiCost.totalActualKrw,
  });

  if (process.env.DISABLE_MODEL_PRICING_TRACKER !== "1") {
    try {
      const pricingResult = await runModelPricingTracker({ db: getDb() });
      console.log("[finance-scheduler] model pricing tracker", {
        phase: pricingResult.phase,
        status: pricingResult.status,
        runDateKey: pricingResult.runDateKey,
        snapshotCount: pricingResult.snapshotCount,
        eventCount: pricingResult.eventCount,
        marginFloorBreaches: pricingResult.marginFloorBreaches,
      });
    } catch (pricingError) {
      console.error("[finance-scheduler] model pricing tracker failed:", pricingError);
    }
  }

  return summary;
}

async function runFinanceSlot(triggerKind: SchedulerTriggerKind) {
  const db = getDb();
  const slot = resolveSchedulerSlot("finance_daily");
  const run = await runDurableScheduledJob(db, {
    jobName: "finance_daily",
    slotKey: slot.slotKey,
    triggerKind,
    execute: executeFinanceSnapshot,
    summarize: (summary) => ({
      monthKey: summary.monthKey,
      netProfitKrw: summary.netProfitKrw,
      aiActualKrw: summary.aiCost.totalActualKrw,
    }),
  });

  if (run.status === "completed") return run.value;
  if (run.status === "failed") {
    console.error("[finance-scheduler] daily snapshot failed:", run.error);
    return null;
  }

  console.log("[finance-scheduler] durable slot skipped", {
    slotKey: slot.slotKey,
    outcome: run.claim.outcome,
    status: run.claim.row.status,
    attemptCount: run.claim.row.attempt_count,
  });
  return null;
}

/** Manual/test entry shares the same durable current-slot owner as cron. */
export async function runFinanceSnapshotNow() {
  return runFinanceSlot("manual");
}

export function startFinanceScheduler() {
  if (scheduledTask) return scheduledTask;
  scheduledTask = cron.schedule(
    FINANCE_DAILY_CRON,
    () => void runFinanceSlot("cron"),
    { timezone: FINANCE_TIMEZONE }
  );
  console.log(
    `[finance-scheduler] registered — cron "${FINANCE_DAILY_CRON}" (${FINANCE_TIMEZONE})`
  );

  const db = getDb();
  if (shouldAttemptBootRecovery(db, "finance_daily")) {
    console.log("[finance-scheduler] missing current slot detected → boot recovery");
    void runFinanceSlot("boot_recovery");
  } else if (process.env.FINANCE_RUN_ON_BOOT === "1") {
    void runFinanceSlot("manual");
  }

  return scheduledTask;
}

export function stopFinanceScheduler() {
  scheduledTask?.stop();
  scheduledTask = null;
}
