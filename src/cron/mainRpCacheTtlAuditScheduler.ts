import cron, { type ScheduledTask } from "node-cron";

import { getDb } from "@/lib/db";
import { runMainRpCacheTtlMonthlyAudit } from "@/lib/mainRpCacheTtlEconomics";
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

export const MAIN_RP_CACHE_TTL_MONTHLY_CRON = schedulerCronExpression(
  "main_rp_cache_ttl_monthly"
);
export const MAIN_RP_CACHE_TTL_TIMEZONE = SCHEDULER_TIMEZONE;

let scheduledTask: ScheduledTask | null = null;
let recoveryInterval: ReturnType<typeof setInterval> | null = null;

async function runMainRpCacheTtlSlot(
  triggerKind: SchedulerTriggerKind,
  slotKeyOverride?: string
) {
  const db = getDb();
  const slot = resolveSchedulerSlot("main_rp_cache_ttl_monthly");
  const slotKey = slotKeyOverride ?? slot.slotKey;
  const run = await runDurableScheduledJob(db, {
    jobName: "main_rp_cache_ttl_monthly",
    slotKey,
    triggerKind,
    execute: () => runMainRpCacheTtlMonthlyAudit(db),
    summarize: (report) => ({
      yearMonth: report.yearMonth,
      sampleTurnCount: report.sampleTurnCount,
      transitionCount: report.transitionCount,
      recommendation: report.recommendation,
      providerOneHourSupport: report.providerOneHourSupport,
    }),
  });

  if (run.status === "completed") {
    console.log("[main-rp-cache-ttl] monthly audit completed", run.value);
    return run.value;
  }
  if (run.status === "failed") {
    console.error("[main-rp-cache-ttl] monthly audit failed", run.error);
    return null;
  }
  console.log("[main-rp-cache-ttl] durable slot skipped", {
    slotKey,
    outcome: run.claim.outcome,
    status: run.claim.row.status,
  });
  return null;
}

function attemptRuntimeRecovery(): void {
  const db = getDb();
  if (!shouldAttemptRuntimeRecovery(db, "main_rp_cache_ttl_monthly")) return;
  const slot = resolveLatestDueSchedulerSlot("main_rp_cache_ttl_monthly");
  void runMainRpCacheTtlSlot("runtime_recovery", slot.slotKey);
}

export function startMainRpCacheTtlAuditScheduler() {
  if (scheduledTask) return scheduledTask;
  scheduledTask = cron.schedule(
    MAIN_RP_CACHE_TTL_MONTHLY_CRON,
    () => void runMainRpCacheTtlSlot("cron"),
    { timezone: MAIN_RP_CACHE_TTL_TIMEZONE }
  );

  const db = getDb();
  if (shouldAttemptBootRecovery(db, "main_rp_cache_ttl_monthly")) {
    const slot = resolveLatestDueSchedulerSlot("main_rp_cache_ttl_monthly");
    void runMainRpCacheTtlSlot("boot_recovery", slot.slotKey);
  }

  if (!recoveryInterval) {
    recoveryInterval = setInterval(attemptRuntimeRecovery, SCHEDULER_RECOVERY_POLL_MS);
    recoveryInterval.unref?.();
  }
  return scheduledTask;
}

export function stopMainRpCacheTtlAuditScheduler() {
  scheduledTask?.stop();
  scheduledTask = null;
  if (recoveryInterval) {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
  }
}
