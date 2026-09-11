import cron, { type ScheduledTask } from "node-cron";
import { saveDailyFinanceSnapshot, currentKstMonthKey, monthRangeSql } from "@/lib/adminFinance";
import { reconcileCheaperInferenceUsage } from "@/lib/providerCostReconciliation";

export const FINANCE_DAILY_CRON = "0 12 * * *";
export const FINANCE_TIMEZONE = "Asia/Seoul";

let scheduledTask: ScheduledTask | null = null;
let running = false;

/**
 * Provider reconciliation then snapshot. Order matters: the daily snapshot
 * must reflect reconciled provider truth, not a stale pre-sync total.
 * Best-effort — a provider outage must not block the snapshot.
 */
export async function runFinanceSnapshotNow() {
  if (running) return null;
  running = true;
  try {
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
    return summary;
  } catch (error) {
    console.error("[finance-scheduler] daily snapshot failed:", error);
    return null;
  } finally {
    running = false;
  }
}

export function startFinanceScheduler() {
  if (scheduledTask) return scheduledTask;
  scheduledTask = cron.schedule(FINANCE_DAILY_CRON, () => void runFinanceSnapshotNow(), {
    timezone: FINANCE_TIMEZONE,
  });
  console.log(
    `[finance-scheduler] registered — cron "${FINANCE_DAILY_CRON}" (${FINANCE_TIMEZONE})`
  );
  if (process.env.FINANCE_RUN_ON_BOOT === "1") void runFinanceSnapshotNow();
  return scheduledTask;
}

export function stopFinanceScheduler() {
  scheduledTask?.stop();
  scheduledTask = null;
}
