import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, it } from "node:test";
import { CHEAPER_INFERENCE_GPT_61_SOL_MODEL } from "@/lib/chatModels";
import { resolveMainRpProviderAdmissionRequiredPoints } from "@/lib/mainRpProviderAdmission";
import {
  computeMainRpNextTurnEstimates,
  nextTurnEstimateDisplayMap,
} from "@/lib/mainRpNextTurnEstimate";
import { formatPickerEstimateSuffix } from "@/lib/modelPickerEstimate";
import { computePublishedStandardPreviewDisplayPoints } from "@/lib/publishedUserCharge";
import {
  countShadowBillingFxDailySnapshots,
  ensureShadowBillingFxTables,
} from "@/lib/shadowBillingFxPersistence";
import {
  resolvePublishedEstimateFx,
  reusePublishedFxSnapshotForRequest,
  _clearShadowBillingFxMemoryForTest,
  _insertShadowBillingFxDailyRowForTest,
  _setShadowBillingFxKstNowForTest,
  _setShadowBillingFxTestDb,
} from "@/lib/shadowBillingExchangeRate";

const SOL = CHEAPER_INFERENCE_GPT_61_SOL_MODEL;
const PICKER_IN = 19_015;
const PICKER_OUT = 2_726;
const ACTUAL_IN = 17_104;
const ACTUAL_OUT = 2_726;

function solDisplay(fx: number, promptTokens = PICKER_IN): number | null {
  return computePublishedStandardPreviewDisplayPoints({
    modelId: SOL,
    promptTokens,
    outputTokens: PICKER_OUT,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    effectiveKrwPerUsd: fx,
  });
}

describe("published FX lifecycle: GET hide → POST lock → request reuse", () => {
  let db: Database.Database;

  afterEach(() => {
    _setShadowBillingFxTestDb(null);
    _clearShadowBillingFxMemoryForTest();
    db?.close();
  });

  function setupEmptyToday(nowIso = "2026-10-08T01:00:00.000Z") {
    db = new Database(":memory:");
    ensureShadowBillingFxTables(db);
    _setShadowBillingFxTestDb(db);
    _clearShadowBillingFxMemoryForTest();
    _setShadowBillingFxKstNowForTest(Date.parse(nowIso));
  }

  it("1-2 unlocked today: GET has no INSERT and no confirmed picker points", () => {
    setupEmptyToday();
    const peek = resolvePublishedEstimateFx({ lockDailyFx: false });
    assert.equal(peek, null);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 0);
    const estimates = peek?.locked
      ? computeMainRpNextTurnEstimates({
          promptTokensByModel: { [SOL]: PICKER_IN },
          effectiveKrwPerUsd: peek.effectiveKrwPerUsd,
        })
      : {};
    const display = nextTurnEstimateDisplayMap(estimates);
    assert.deepEqual(display, {});
    assert.equal(formatPickerEstimateSuffix(display[SOL]), "");
  });

  it("3-4 POST picker lock then GET/POST share the same FX and estimate", () => {
    setupEmptyToday();
    assert.equal(resolvePublishedEstimateFx({ lockDailyFx: false }), null);
    const postLock = resolvePublishedEstimateFx({ lockDailyFx: true });
    assert.ok(postLock?.locked);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 1);
    const laterGet = resolvePublishedEstimateFx({ lockDailyFx: false });
    const laterPost = resolvePublishedEstimateFx({ lockDailyFx: true });
    assert.ok(laterGet);
    assert.ok(laterPost);
    assert.equal(laterGet.effectiveKrwPerUsd, postLock.effectiveKrwPerUsd);
    assert.equal(laterPost.effectiveKrwPerUsd, postLock.effectiveKrwPerUsd);
    assert.equal(solDisplay(laterGet.effectiveKrwPerUsd), solDisplay(postLock.effectiveKrwPerUsd));
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 1);
  });

  it("5-6 23:59 admission reuses first lock at 00:01; a new request locks the new day", () => {
    setupEmptyToday("2026-10-08T14:59:00.000Z");
    const admission = resolvePublishedEstimateFx({ lockDailyFx: true });
    assert.ok(admission);
    const admittedPoints = solDisplay(admission.effectiveKrwPerUsd, ACTUAL_IN);
    _setShadowBillingFxKstNowForTest(Date.parse("2026-10-08T15:01:00.000Z"));
    const settlement = reusePublishedFxSnapshotForRequest(admission);
    assert.ok(settlement);
    assert.equal(settlement.dateKey, "2026-10-08");
    assert.equal(solDisplay(settlement.effectiveKrwPerUsd, ACTUAL_IN), admittedPoints);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-09"), 0);

    const nextAdmission = resolvePublishedEstimateFx({ lockDailyFx: true });
    assert.ok(nextAdmission);
    assert.equal(nextAdmission.dateKey, "2026-10-09");
    assert.notEqual(nextAdmission.dateKey, settlement.dateKey);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 1);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-09"), 1);
  });

  it("7 concurrent same-day locks stay one snapshot", () => {
    setupEmptyToday();
    const a = resolvePublishedEstimateFx({ lockDailyFx: true });
    const b = resolvePublishedEstimateFx({ lockDailyFx: true });
    assert.ok(a);
    assert.ok(b);
    assert.equal(a.dateKey, b.dateKey);
    assert.equal(a.usdToKrw, b.usdToKrw);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 1);
  });

  it("8-9 cache-neutral user P, ×3 admission, and 80P floor stay on locked Standard FX", () => {
    setupEmptyToday();
    _insertShadowBillingFxDailyRowForTest({
      dateKey: "2026-10-08",
      baseUsdKrw: 1530,
      source: "api_daily",
    });
    const fx = resolvePublishedEstimateFx({ lockDailyFx: false });
    assert.ok(fx);
    const miss = solDisplay(fx.effectiveKrwPerUsd, ACTUAL_IN);
    const hit = computePublishedStandardPreviewDisplayPoints({
      modelId: SOL,
      promptTokens: ACTUAL_IN,
      outputTokens: ACTUAL_OUT,
      cacheReadTokens: 8_000,
      cacheWriteTokens: 0,
      effectiveKrwPerUsd: fx.effectiveKrwPerUsd,
    });
    const write = computePublishedStandardPreviewDisplayPoints({
      modelId: SOL,
      promptTokens: ACTUAL_IN,
      outputTokens: ACTUAL_OUT,
      cacheReadTokens: 0,
      cacheWriteTokens: 8_000,
      effectiveKrwPerUsd: fx.effectiveKrwPerUsd,
    });
    assert.equal(miss, 174);
    assert.equal(hit, 174);
    assert.equal(write, 174);
    const picker = solDisplay(fx.effectiveKrwPerUsd, PICKER_IN);
    assert.equal(picker, 185);
    assert.equal(resolveMainRpProviderAdmissionRequiredPoints(picker!), Math.max(80, 185 * 3));
    assert.equal(resolveMainRpProviderAdmissionRequiredPoints(20), 80);
  });

  it("completed replay skips a second FX lock; recovery stays request-scoped", () => {
    const route = readFileSync(path.join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
    const admitAt = route.indexOf("if (!alreadyCompletedTurn)");
    const lockAt = route.indexOf(
      "requestPublishedFx = resolvePublishedEstimateFx({ lockDailyFx: true })"
    );
    const replayAt = route.indexOf("alreadyCompleted: true");
    const settleAt = route.lastIndexOf("settleChatTurnBillingExactlyOnce(db,");
    assert.ok(admitAt > 0);
    assert.ok(lockAt > admitAt);
    assert.ok(replayAt > lockAt);
    assert.ok(settleAt > replayAt);
    assert.match(route, /reusePublishedFxSnapshotForRequest\(requestPublishedFx\)/);
    assert.doesNotMatch(route, /CREATE TABLE/);
    assert.doesNotMatch(route, /ALTER TABLE/);
  });
});
