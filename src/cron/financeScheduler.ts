import cron, { type ScheduledTask } from "node-cron";
import { saveDailyFinanceSnapshot, currentKstMonthKey, monthRangeSql } from "@/lib/adminFinance";
import { getDb } from "@/lib/db";
import { runModelPricingTracker } from "@/lib/modelPricingTracker";
import { buildMainRpPricingObservabilityProjection } from "@/lib/mainRpPricingObservability";
import { syncMainRpPricingCandidateRecords } from "@/lib/mainRpPricingProposal";
import { reconcileCheaperInferenceUsage } from "@/lib/providerCostReconciliation";
import {
  SCHEDULER_RECOVERY_POLL_MS,
  SCHEDULER_TIMEZONE,
  schedulerCronExpression,
} from "@/lib/schedulerDefinitions";
import {
  resolveLatestDueSchedulerSlot,
  resolveSchedulerSlot,
  runDurableScheduledJob,
  shouldAttemptBootRecovery,
  shouldAttemptRuntimeRecovery,
} from "@/lib/schedulerRunRegistry";
import type { SchedulerTriggerKind } from "@/lib/schedulerRunShared";

export const FINANCE_DAILY_CRON = schedulerCronExpression("finance_daily");
export const FINANCE_TIMEZONE = SCHEDULER_TIMEZONE;

let scheduledTask: ScheduledTask | null = null;
let recoveryInterval: ReturnType<typeof setInterval> | null = null;

async function executeFinanceSnapshot(slotKey: string) {
  const monthKey = slotKey.slice(0, 7) || currentKstMonthKey();
  try {
    const range = monthRangeSql(monthKey);
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

  const summary = saveDailyFinanceSnapshot(getDb(), slotKey);
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
      if (pricingResult.status !== "failed") {
        const proposalDb = getDb();
        const projection = buildMainRpPricingObservabilityProjection({ db: proposalDb });
        const proposalSync = syncMainRpPricingCandidateRecords(
          proposalDb,
          projection.models,
          projection.generatedAt
        );
        console.log("[finance-scheduler] pricing candidate history", proposalSync);
      }
    } catch (pricingError) {
      console.error("[finance-scheduler] model pricing tracker failed:", pricingError);
    }
  }

  return summary;
}

async function runFinanceSlot(
  triggerKind: SchedulerTriggerKind,
  slotKeyOverride?: string
) {
  const db = getDb();
  const slot = resolveSchedulerSlot("finance_daily");
  const slotKey = slotKeyOverride ?? slot.slotKey;
  const run = await runDurableScheduledJob(db, {
    jobName: "finance_daily",
    slotKey,
    triggerKind,
    execute: () => executeFinanceSnapshot(slotKey),
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
    slotKey,
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

function attemptFinanceRuntimeRecovery(): void {
  const db = getDb();
  if (!shouldAttemptRuntimeRecovery(db, "finance_daily")) return;
  const recoverySlot = resolveLatestDueSchedulerSlot("finance_daily");
  console.log("[finance-scheduler] runtime recovery due", {
    slotKey: recoverySlot.slotKey,
  });
  void runFinanceSlot("runtime_recovery", recoverySlot.slotKey);
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
    const recoverySlot = resolveLatestDueSchedulerSlot("finance_daily");
    console.log("[finance-scheduler] missing/recoverable due slot detected → boot recovery", {
      slotKey: recoverySlot.slotKey,
    });
    void runFinanceSlot("boot_recovery", recoverySlot.slotKey);
  } else if (process.env.FINANCE_RUN_ON_BOOT === "1") {
    void runFinanceSlot("manual");
  }

  if (!recoveryInterval) {
    recoveryInterval = setInterval(
      attemptFinanceRuntimeRecovery,
      SCHEDULER_RECOVERY_POLL_MS
    );
    recoveryInterval.unref?.();
  }

  return scheduledTask;
}

export function stopFinanceScheduler() {
  scheduledTask?.stop();
  scheduledTask = null;
  if (recoveryInterval) {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
  }
}
