import cron, { type ScheduledTask } from "node-cron";
import { runDailyTrainingAnalysis } from "@/lib/training/dailyAnalysis";
import { runWeeklyTrainingExport } from "@/lib/training/weeklyExport";
import {
  SCHEDULER_TIMEZONE,
  schedulerCronExpression,
} from "@/lib/schedulerDefinitions";
import { getDb } from "@/lib/db";
import {
  resolveSchedulerSlot,
  runDurableScheduledJob,
  shouldAttemptBootRecovery,
} from "@/lib/schedulerRunRegistry";
import type { SchedulerTriggerKind } from "@/lib/schedulerRunShared";

let dailyTask: ScheduledTask | null = null;
let weeklyTask: ScheduledTask | null = null;

/** Canonical schedule owner lives in schedulerDefinitions.ts. */
export const TRAINING_DAILY_CRON = schedulerCronExpression("training_daily");
export const TRAINING_WEEKLY_CRON = schedulerCronExpression("training_weekly");
export const TRAINING_TIMEZONE = SCHEDULER_TIMEZONE;

async function runDailySlot(triggerKind: SchedulerTriggerKind) {
  const db = getDb();
  const slot = resolveSchedulerSlot("training_daily");
  const started = Date.now();
  const run = await runDurableScheduledJob(db, {
    jobName: "training_daily",
    slotKey: slot.slotKey,
    triggerKind,
    execute: async () => {
      console.log("[training-scheduler] daily tag analysis starting");
      return runDailyTrainingAnalysis();
    },
    summarize: (result) => result,
  });

  if (run.status === "completed") {
    console.log(
      `[training-scheduler] daily batch done (${Date.now() - started}ms)`,
      JSON.stringify(run.value)
    );
    return run.value;
  }
  if (run.status === "failed") {
    console.error("[training-scheduler] daily batch failed:", run.error);
    return null;
  }

  console.log("[training-scheduler] daily durable slot skipped", {
    slotKey: slot.slotKey,
    outcome: run.claim.outcome,
    status: run.claim.row.status,
    attemptCount: run.claim.row.attempt_count,
  });
  return null;
}

async function runWeeklySlot(triggerKind: SchedulerTriggerKind) {
  const db = getDb();
  const slot = resolveSchedulerSlot("training_weekly");
  const started = Date.now();
  const run = await runDurableScheduledJob(db, {
    jobName: "training_weekly",
    slotKey: slot.slotKey,
    triggerKind,
    execute: () => {
      console.log("[training-scheduler] weekly dataset export starting");
      return runWeeklyTrainingExport();
    },
    summarize: (result) => result,
  });

  if (run.status === "completed") {
    console.log(
      `[training-scheduler] weekly export done (${Date.now() - started}ms)`,
      JSON.stringify(run.value)
    );
    return run.value;
  }
  if (run.status === "failed") {
    console.error("[training-scheduler] weekly export failed:", run.error);
    return null;
  }

  console.log("[training-scheduler] weekly durable slot skipped", {
    slotKey: slot.slotKey,
    outcome: run.claim.outcome,
    status: run.claim.row.status,
    attemptCount: run.claim.row.attempt_count,
  });
  return null;
}

export function startTrainingScheduler() {
  if (!dailyTask) {
    dailyTask = cron.schedule(
      TRAINING_DAILY_CRON,
      () => {
        void runDailySlot("cron");
      },
      { timezone: TRAINING_TIMEZONE }
    );
    console.log(
      `[training-scheduler] daily job registered — cron "${TRAINING_DAILY_CRON}" (${TRAINING_TIMEZONE})`
    );
  }

  if (!weeklyTask) {
    weeklyTask = cron.schedule(
      TRAINING_WEEKLY_CRON,
      () => {
        void runWeeklySlot("cron");
      },
      { timezone: TRAINING_TIMEZONE }
    );
    console.log(
      `[training-scheduler] weekly job registered — cron "${TRAINING_WEEKLY_CRON}" (${TRAINING_TIMEZONE})`
    );
  }

  const db = getDb();
  if (shouldAttemptBootRecovery(db, "training_daily")) {
    console.log("[training-scheduler] missing daily slot detected → boot recovery");
    void runDailySlot("boot_recovery");
  }
  if (shouldAttemptBootRecovery(db, "training_weekly")) {
    console.log("[training-scheduler] missing weekly slot detected → boot recovery");
    void runWeeklySlot("boot_recovery");
  }

  if (process.env.TRAINING_RUN_ON_BOOT === "1") {
    console.log("[training-scheduler] TRAINING_RUN_ON_BOOT=1 → current daily slot manual run");
    void runDailySlot("manual");
  }

  return { dailyTask, weeklyTask };
}

export function stopTrainingScheduler() {
  dailyTask?.stop();
  weeklyTask?.stop();
  dailyTask = null;
  weeklyTask = null;
}

export async function triggerDailyAnalysisNow() {
  return runDailySlot("manual");
}

export async function triggerWeeklyExportNow() {
  return runWeeklySlot("manual");
}
