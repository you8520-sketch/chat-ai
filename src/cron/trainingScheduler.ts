import cron, { type ScheduledTask } from "node-cron";
import { runDailyTrainingAnalysis } from "@/lib/training/dailyAnalysis";
import { runWeeklyTrainingExport } from "@/lib/training/weeklyExport";

let dailyTask: ScheduledTask | null = null;
let weeklyTask: ScheduledTask | null = null;
let dailyRunning = false;
let weeklyRunning = false;

/** 매일 04:00 (Asia/Seoul) RP 품질 태깅 배치 */
export const TRAINING_DAILY_CRON = "0 4 * * *";
/** 매주 일요일 05:00 (Asia/Seoul) 학습 데이터셋 export */
export const TRAINING_WEEKLY_CRON = "0 5 * * 0";
export const TRAINING_TIMEZONE = "Asia/Seoul";

async function runDailyJob() {
  if (dailyRunning) {
    console.warn("[training-scheduler] daily batch still running — skip");
    return;
  }
  dailyRunning = true;
  const started = Date.now();
  try {
    console.log("[training-scheduler] daily tag analysis starting");
    const result = await runDailyTrainingAnalysis();
    console.log(
      `[training-scheduler] daily batch done (${Date.now() - started}ms)`,
      JSON.stringify(result)
    );
  } catch (e) {
    console.error("[training-scheduler] daily batch failed:", e);
  } finally {
    dailyRunning = false;
  }
}

function runWeeklyJob() {
  if (weeklyRunning) {
    console.warn("[training-scheduler] weekly export still running — skip");
    return;
  }
  weeklyRunning = true;
  const started = Date.now();
  try {
    console.log("[training-scheduler] weekly dataset export starting");
    const result = runWeeklyTrainingExport();
    console.log(
      `[training-scheduler] weekly export done (${Date.now() - started}ms)`,
      JSON.stringify(result)
    );
  } catch (e) {
    console.error("[training-scheduler] weekly export failed:", e);
  } finally {
    weeklyRunning = false;
  }
}

export function startTrainingScheduler() {
  if (!dailyTask) {
    dailyTask = cron.schedule(
      TRAINING_DAILY_CRON,
      () => {
        void runDailyJob();
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
        runWeeklyJob();
      },
      { timezone: TRAINING_TIMEZONE }
    );
    console.log(
      `[training-scheduler] weekly job registered — cron "${TRAINING_WEEKLY_CRON}" (${TRAINING_TIMEZONE})`
    );
  }

  if (process.env.TRAINING_RUN_ON_BOOT === "1") {
    console.log("[training-scheduler] TRAINING_RUN_ON_BOOT=1 → daily analysis now");
    void runDailyJob();
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
  return runDailyJob();
}

export function triggerWeeklyExportNow() {
  return runWeeklyJob();
}
