import cron, { type ScheduledTask } from "node-cron";
import { saveDailyFinanceSnapshot } from "@/lib/adminFinance";

export const FINANCE_DAILY_CRON = "0 12 * * *";
export const FINANCE_TIMEZONE = "Asia/Seoul";

let scheduledTask: ScheduledTask | null = null;
let running = false;

export function runFinanceSnapshotNow() {
  if (running) return null;
  running = true;
  try {
    const summary = saveDailyFinanceSnapshot();
    console.log("[finance-scheduler] daily snapshot saved", {
      month: summary.monthKey,
      netProfitKrw: summary.netProfitKrw,
      deepSeekV4FlashCostKrw: summary.deepSeekV4Flash.costWithTaxKrw,
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
  scheduledTask = cron.schedule(FINANCE_DAILY_CRON, runFinanceSnapshotNow, {
    timezone: FINANCE_TIMEZONE,
  });
  console.log(
    `[finance-scheduler] registered — cron "${FINANCE_DAILY_CRON}" (${FINANCE_TIMEZONE})`
  );
  if (process.env.FINANCE_RUN_ON_BOOT === "1") runFinanceSnapshotNow();
  return scheduledTask;
}

export function stopFinanceScheduler() {
  scheduledTask?.stop();
  scheduledTask = null;
}
