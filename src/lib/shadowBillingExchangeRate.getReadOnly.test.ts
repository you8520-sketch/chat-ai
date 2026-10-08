import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, it } from "node:test";
import {
  countShadowBillingFxDailySnapshots,
  ensureShadowBillingFxTables,
} from "@/lib/shadowBillingFxPersistence";
import { applyOverseasCardFee } from "@/lib/billingFxPolicy";
import {
  resolvePublishedEstimateFx,
  reusePublishedFxSnapshotForRequest,
  _clearShadowBillingFxMemoryForTest,
  _insertShadowBillingFxDailyRowForTest,
  _setShadowBillingFxKstNowForTest,
  _setShadowBillingFxTestDb,
} from "@/lib/shadowBillingExchangeRate";

describe("GET/SSR published FX is read-only", () => {
  let db: Database.Database;

  afterEach(() => {
    _setShadowBillingFxTestDb(null);
    _clearShadowBillingFxMemoryForTest();
    db?.close();
  });

  function setupEmptyToday() {
    db = new Database(":memory:");
    ensureShadowBillingFxTables(db);
    _setShadowBillingFxTestDb(db);
    _clearShadowBillingFxMemoryForTest();
    _setShadowBillingFxKstNowForTest(Date.parse("2026-10-08T01:00:00.000Z"));
  }

  it("today has no row → GET/read-only does not INSERT and returns no locked FX", () => {
    setupEmptyToday();
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 0);
    const peek = resolvePublishedEstimateFx({ lockDailyFx: false });
    assert.equal(peek, null);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 0);
  });

  it("repeated GET/read-only still does not INSERT", () => {
    setupEmptyToday();
    resolvePublishedEstimateFx({ lockDailyFx: false });
    resolvePublishedEstimateFx({ lockDailyFx: false });
    resolvePublishedEstimateFx({ lockDailyFx: false });
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 0);
  });

  it("existing today lock is used exactly by read-only picker", () => {
    setupEmptyToday();
    _insertShadowBillingFxDailyRowForTest({
      dateKey: "2026-10-08",
      baseUsdKrw: 1530,
      source: "api_daily",
    });
    const snap = resolvePublishedEstimateFx({ lockDailyFx: false });
    assert.ok(snap);
    assert.equal(snap.locked, true);
    assert.equal(snap.usdToKrw, 1530);
    assert.equal(snap.effectiveKrwPerUsd, applyOverseasCardFee(1530));
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 1);
  });

  it("non-GET lock is shared by later admission/settlement and GET peek", () => {
    setupEmptyToday();
    const locked = resolvePublishedEstimateFx({ lockDailyFx: true });
    const again = resolvePublishedEstimateFx({ lockDailyFx: true });
    const getPeek = resolvePublishedEstimateFx({ lockDailyFx: false });
    assert.ok(locked);
    assert.ok(getPeek);
    assert.equal(locked.locked, true);
    assert.equal(again.effectiveKrwPerUsd, locked.effectiveKrwPerUsd);
    assert.equal(getPeek.effectiveKrwPerUsd, locked.effectiveKrwPerUsd);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 1);
  });

  it("chat GET page opts out of FX lock; POST picker/admission may lock", () => {
    const page = readFileSync(path.join(process.cwd(), "src/app/chat/[id]/page.tsx"), "utf8");
    const pickerRoute = readFileSync(
      path.join(process.cwd(), "src/app/api/chat/next-turn-estimates/route.ts"),
      "utf8"
    );
    const service = readFileSync(
      path.join(process.cwd(), "src/services/mainRpNextTurnEstimate.ts"),
      "utf8"
    );
    assert.match(page, /lockDailyFx:\s*false/);
    assert.doesNotMatch(page, /resolveShadowBillingExchangeRateSnapshot/);
    assert.match(pickerRoute, /lockDailyFx:\s*true/);
    assert.match(service, /resolvePublishedEstimateFx/);
    assert.match(service, /opts\.lockDailyFx === true/);
    assert.match(service, /if \(!fx\?\.locked\) return \{\}/);
    const chatRoute = readFileSync(path.join(process.cwd(), "src/app/api/chat/route.ts"), "utf8");
    assert.match(chatRoute, /requestPublishedFx = resolvePublishedEstimateFx\(\{ lockDailyFx: true \}\)/);
    assert.match(chatRoute, /reusePublishedFxSnapshotForRequest\(requestPublishedFx\)/);
    assert.match(chatRoute, /alreadyCompletedTurn/);
    assert.match(chatRoute, /settleChatTurnBillingExactlyOnce/);
    const client = readFileSync(path.join(process.cwd(), "src/app/chat/[id]/ChatClient.tsx"), "utf8");
    assert.match(client, /method:\s*"POST"/);
    assert.match(client, /\/api\/chat\/next-turn-estimates/);
  });

  it("previous-day lock is not a confirmed GET estimate for unlocked today", () => {
    setupEmptyToday();
    _insertShadowBillingFxDailyRowForTest({
      dateKey: "2026-10-07",
      baseUsdKrw: 1400,
      source: "api_daily",
    });
    const peek = resolvePublishedEstimateFx({ lockDailyFx: false });
    assert.equal(peek, null);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 0);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-07"), 1);
  });

  it("KST midnight rolls dateKey; GET still does not INSERT or confirm the new day", () => {
    setupEmptyToday();
    _insertShadowBillingFxDailyRowForTest({
      dateKey: "2026-10-08",
      baseUsdKrw: 1530,
      source: "api_daily",
    });
    _setShadowBillingFxKstNowForTest(Date.parse("2026-10-08T14:59:00.000Z"));
    const beforeMidnight = resolvePublishedEstimateFx({ lockDailyFx: false });
    assert.ok(beforeMidnight);
    assert.equal(beforeMidnight.dateKey, "2026-10-08");
    assert.equal(beforeMidnight.locked, true);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 1);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-09"), 0);

    _setShadowBillingFxKstNowForTest(Date.parse("2026-10-08T15:00:00.000Z"));
    const afterMidnight = resolvePublishedEstimateFx({ lockDailyFx: false });
    assert.equal(afterMidnight, null);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 1);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-09"), 0);
  });

  it("same request reuses the admission-locked FX after KST midnight", () => {
    setupEmptyToday();
    _setShadowBillingFxKstNowForTest(Date.parse("2026-10-08T14:59:00.000Z"));
    const admission = resolvePublishedEstimateFx({ lockDailyFx: true });
    assert.ok(admission);
    assert.equal(admission.dateKey, "2026-10-08");
    assert.equal(admission.locked, true);
    assert.ok(admission.usdToKrw > 0);

    _setShadowBillingFxKstNowForTest(Date.parse("2026-10-08T15:01:00.000Z"));
    const reused = reusePublishedFxSnapshotForRequest(admission);
    assert.ok(reused);
    assert.equal(reused.dateKey, "2026-10-08");
    assert.equal(reused.usdToKrw, admission.usdToKrw);
    assert.equal(reused.effectiveKrwPerUsd, admission.effectiveKrwPerUsd);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-09"), 0);

    const nextRequest = resolvePublishedEstimateFx({ lockDailyFx: true });
    assert.ok(nextRequest);
    assert.equal(nextRequest.dateKey, "2026-10-09");
    assert.notEqual(nextRequest.dateKey, reused.dateKey);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 1);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-09"), 1);
  });

  it("unlocked or missing snapshots are not reused as a request FX", () => {
    setupEmptyToday();
    assert.equal(reusePublishedFxSnapshotForRequest(null), null);
    assert.equal(reusePublishedFxSnapshotForRequest(undefined), null);
    assert.equal(
      reusePublishedFxSnapshotForRequest({
        mode: "daily_kst",
        dateKey: "2026-10-08",
        usdToKrw: 1500,
        effectiveKrwPerUsd: applyOverseasCardFee(1500),
        source: "emergency_fallback",
        overseasFeeRate: 0.02,
        locked: false,
      }),
      null
    );
  });
});
