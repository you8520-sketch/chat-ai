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
const bootStart = Date.now();

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
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function runBackgroundInitialization() {
  try {
    const { warnEpisodicMemoryRecallDisabledInProduction } = await import(
      "./src/lib/episodicMemoryFacts.ts"
    );
    warnEpisodicMemoryRecallDisabledInProduction();
  } catch (e) {
    console.warn(
      "[boot] episodic memory recall warning skipped:",
      e && typeof e === "object" && "message" in e ? e.message : e
    );
  }
  if (process.env.DISABLE_PAYOUT_SCHEDULER !== "1") {
    try {
      const { startPayoutScheduler } = await import("./src/cron/payoutScheduler.ts");
      startPayoutScheduler();
      console.log(
        `[boot-timing] payout init complete (+${Date.now() - bootStart}ms from process start)`
      );
    } catch (err) {
      console.error("[server] payout scheduler 시작 실패:", err);
      console.log(
        `[boot-timing] payout init failed (+${Date.now() - bootStart}ms from process start)`
      );
    }
  } else {
    console.log("[server] payout scheduler disabled (DISABLE_PAYOUT_SCHEDULER=1)");
    console.log(
      `[boot-timing] payout init skipped (+${Date.now() - bootStart}ms from process start)`
    );
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
    console.log(
      `[boot-timing] exchange init complete (+${Date.now() - bootStart}ms from process start)`
    );
  } catch (err) {
    console.warn("[server] exchange rate warm-up skipped:", err);
    console.log(
      `[boot-timing] exchange init failed (+${Date.now() - bootStart}ms from process start)`
    );
  }
}

const prepareStart = Date.now();
app.prepare().then(() => {
  console.log(`[boot-timing] app.prepare() took ${Date.now() - prepareStart}ms`);
  createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  }).listen(port, hostname, (err) => {
    if (err) throw err;
    console.log(
      `[boot-timing] listen at ${Date.now()} (+${Date.now() - bootStart}ms from process start)`
    );
    console.log(`> Ready on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}${dev ? " (dev)" : ""}`);
    void runBackgroundInitialization();
  });
});
