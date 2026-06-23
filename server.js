/**
 * Next.js 커스텀 서버 + 크리에이터 출금 정산 큐 스케줄러
 *
 * PENDING 출금은 신청 즉시 입금하지 않고 DB 큐에 보관되며,
 * 매월 15일 03:00(Asia/Seoul)에 payoutScheduler가 일괄 처리합니다.
 *
 * 환경 변수:
 * - DISABLE_PAYOUT_SCHEDULER=1  스케줄러 비활성화
 * - PAYOUT_RUN_ON_BOOT=1        서버 기동 시 큐 1회 즉시 실행 (개발용)
 * - PAYOUT_FORCE_FAIL=1         지급대행 시뮬레이션 전체 실패
 * - ENABLE_TRAINING_PIPELINE=1  RP 학습 파이프라인 스케줄러 활성화
 * - TRAINING_RUN_ON_BOOT=1      기동 시 daily analysis 1회 (개발용)
 */
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");

const dev = process.env.NODE_ENV !== "production";
// 개발 모드에서는 출금 스케줄러 기본 비활성화 (ENABLE_PAYOUT_SCHEDULER=1 로 재활성화)
if (dev && process.env.ENABLE_PAYOUT_SCHEDULER !== "1") {
  process.env.DISABLE_PAYOUT_SCHEDULER = "1";
}
if (dev && process.env.ENABLE_TRAINING_PIPELINE !== "1") {
  process.env.DISABLE_TRAINING_PIPELINE = "1";
}
const hostname = process.env.HOSTNAME || (dev ? "localhost" : "0.0.0.0");
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(async () => {
  if (process.env.DISABLE_PAYOUT_SCHEDULER !== "1") {
    try {
      const { startPayoutScheduler } = await import("./src/cron/payoutScheduler.ts");
      startPayoutScheduler();
    } catch (err) {
      console.error("[server] payout scheduler 시작 실패:", err);
    }
  } else {
    console.log("[server] payout scheduler disabled (DISABLE_PAYOUT_SCHEDULER=1)");
  }

  if (process.env.DISABLE_TRAINING_PIPELINE !== "1" && process.env.ENABLE_TRAINING_PIPELINE === "1") {
    try {
      const { startTrainingScheduler } = await import("./src/cron/trainingScheduler.ts");
      startTrainingScheduler();
    } catch (err) {
      console.error("[server] training scheduler 시작 실패:", err);
    }
  } else {
    console.log("[server] training pipeline disabled (set ENABLE_TRAINING_PIPELINE=1 to enable)");
  }

  try {
    const exchangeRateMod = await import("./src/lib/exchangeRate.ts");
    const warm =
      exchangeRateMod.warmExchangeRateCache ??
      exchangeRateMod.default?.warmExchangeRateCache;
    if (typeof warm === "function") {
      warm();
    } else {
      console.warn("[server] exchange rate warm-up skipped: export missing");
    }
  } catch (err) {
    console.warn("[server] exchange rate warm-up skipped:", err);
  }

  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(port, hostname, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://${hostname}:${port}${dev ? " (dev)" : ""}`);
  });
});
