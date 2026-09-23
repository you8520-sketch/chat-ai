import cron, { type ScheduledTask } from "node-cron";
import { processPayoutQueue } from "@/lib/payoutQueue";
import {
  PAYOUT_CRON_EXPRESSION,
  PAYOUT_TIMEZONE,
} from "@/lib/payoutSchedule";
import { getDb } from "@/lib/db";
import { SCHEDULER_RECOVERY_POLL_MS } from "@/lib/schedulerDefinitions";
import {
  resolveLatestDueSchedulerSlot,
  resolveSchedulerSlot,
  runDurableScheduledJob,
  shouldAttemptBootRecovery,
  shouldAttemptRuntimeRecovery,
} from "@/lib/schedulerRunRegistry";
import type { SchedulerTriggerKind } from "@/lib/schedulerRunShared";

export { PAYOUT_CRON_EXPRESSION, PAYOUT_TIMEZONE };

let scheduledTask: ScheduledTask | null = null;
let recoveryInterval: ReturnType<typeof setInterval> | null = null;

async function runPayoutSlot(
  triggerKind: SchedulerTriggerKind,
  slotKeyOverride?: string
) {
  const db = getDb();
  const slot = resolveSchedulerSlot("payout_monthly");
  const slotKey = slotKeyOverride ?? slot.slotKey;
  const started = Date.now();
  const run = await runDurableScheduledJob(db, {
    jobName: "payout_monthly",
    slotKey,
    triggerKind,
    execute: async () => {
      console.log("[payout-scheduler] 월간 일괄 지급 배치 시작");
      return processPayoutQueue();
    },
    summarize: (result) => result,
  });

  if (run.status === "completed") {
    console.log(
      `[payout-scheduler] 배치 종료 (${Date.now() - started}ms)`,
      JSON.stringify(run.value)
    );
    return run.value;
  }

  if (run.status === "failed") {
    console.error("[payout-scheduler] 배치 치명적 오류:", run.error);
    return null;
  }

  console.log("[payout-scheduler] durable slot skipped", {
    slotKey,
    outcome: run.claim.outcome,
    status: run.claim.row.status,
    attemptCount: run.claim.row.attempt_count,
  });
  return null;
}

function attemptPayoutRuntimeRecovery(): void {
  const db = getDb();
  if (!shouldAttemptRuntimeRecovery(db, "payout_monthly")) return;
  const recoverySlot = resolveLatestDueSchedulerSlot("payout_monthly");
  console.log("[payout-scheduler] runtime recovery due", {
    slotKey: recoverySlot.slotKey,
  });
  void runPayoutSlot("runtime_recovery", recoverySlot.slotKey);
}

export function startPayoutScheduler() {
  if (scheduledTask) return scheduledTask;

  scheduledTask = cron.schedule(
    PAYOUT_CRON_EXPRESSION,
    () => {
      void runPayoutSlot("cron");
    },
    { timezone: PAYOUT_TIMEZONE }
  );

  console.log(
    `[payout-scheduler] 등록됨 — cron "${PAYOUT_CRON_EXPRESSION}" (${PAYOUT_TIMEZONE})`
  );

  const db = getDb();
  if (shouldAttemptBootRecovery(db, "payout_monthly")) {
    const recoverySlot = resolveLatestDueSchedulerSlot("payout_monthly");
    console.log("[payout-scheduler] missing/recoverable due slot detected → boot recovery", {
      slotKey: recoverySlot.slotKey,
    });
    void runPayoutSlot("boot_recovery", recoverySlot.slotKey);
  } else if (process.env.PAYOUT_RUN_ON_BOOT === "1") {
    console.log("[payout-scheduler] PAYOUT_RUN_ON_BOOT=1 → 현재 월 슬롯 수동 실행");
    void runPayoutSlot("manual");
  }

  if (!recoveryInterval) {
    recoveryInterval = setInterval(
      attemptPayoutRuntimeRecovery,
      SCHEDULER_RECOVERY_POLL_MS
    );
    recoveryInterval.unref?.();
  }

  return scheduledTask;
}

export function stopPayoutScheduler() {
  scheduledTask?.stop();
  scheduledTask = null;
  if (recoveryInterval) {
    clearInterval(recoveryInterval);
    recoveryInterval = null;
  }
}

/** 테스트·수동 실행용 — 현재 월 durable slot을 공유한다. */
export async function triggerPayoutBatchNow() {
  return runPayoutSlot("manual");
}
