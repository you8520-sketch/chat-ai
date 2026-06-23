import cron, { type ScheduledTask } from "node-cron";
import { processPayoutQueue } from "@/lib/payoutQueue";

let scheduledTask: ScheduledTask | null = null;
let running = false;

/** 매월 15일 03:00 (Asia/Seoul) 자동 일괄 지급 */
export const PAYOUT_CRON_EXPRESSION = "0 3 15 * *";
export const PAYOUT_TIMEZONE = "Asia/Seoul";

async function runScheduledPayout() {
  if (running) {
    console.warn("[payout-scheduler] 이전 배치가 아직 실행 중 — 스킵");
    return;
  }
  running = true;
  const started = Date.now();
  try {
    console.log("[payout-scheduler] 월간 일괄 지급 배치 시작");
    const result = await processPayoutQueue();
    console.log(
      `[payout-scheduler] 배치 종료 (${Date.now() - started}ms)`,
      JSON.stringify(result)
    );
  } catch (e) {
    console.error("[payout-scheduler] 배치 치명적 오류:", e);
  } finally {
    running = false;
  }
}

export function startPayoutScheduler() {
  if (scheduledTask) return scheduledTask;

  scheduledTask = cron.schedule(
    PAYOUT_CRON_EXPRESSION,
    () => {
      void runScheduledPayout();
    },
    { timezone: PAYOUT_TIMEZONE }
  );

  console.log(
    `[payout-scheduler] 등록됨 — cron "${PAYOUT_CRON_EXPRESSION}" (${PAYOUT_TIMEZONE}, 매월 15일 03:00)`
  );

  if (process.env.PAYOUT_RUN_ON_BOOT === "1") {
    console.log("[payout-scheduler] PAYOUT_RUN_ON_BOOT=1 → 즉시 1회 실행");
    void runScheduledPayout();
  }

  return scheduledTask;
}

export function stopPayoutScheduler() {
  scheduledTask?.stop();
  scheduledTask = null;
}

/** 테스트·수동 실행용 */
export async function triggerPayoutBatchNow() {
  return runScheduledPayout();
}
