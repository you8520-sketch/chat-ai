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

  it("today has no row → GET/read-only does not INSERT", () => {
    setupEmptyToday();
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 0);
    resolvePublishedEstimateFx({ lockDailyFx: false });
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
  });

  it("KST midnight rolls dateKey; GET still does not INSERT the new day", () => {
    setupEmptyToday();
    _insertShadowBillingFxDailyRowForTest({
      dateKey: "2026-10-08",
      baseUsdKrw: 1530,
      source: "api_daily",
    });
    _setShadowBillingFxKstNowForTest(Date.parse("2026-10-08T14:59:00.000Z"));
    const beforeMidnight = resolvePublishedEstimateFx({ lockDailyFx: false });
    assert.equal(beforeMidnight.dateKey, "2026-10-08");
    assert.equal(beforeMidnight.locked, true);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 1);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-09"), 0);

    _setShadowBillingFxKstNowForTest(Date.parse("2026-10-08T15:00:00.000Z"));
    const afterMidnight = resolvePublishedEstimateFx({ lockDailyFx: false });
    assert.equal(afterMidnight.dateKey, "2026-10-09");
    assert.equal(afterMidnight.locked, false);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-08"), 1);
    assert.equal(countShadowBillingFxDailySnapshots(db, "2026-10-09"), 0);
  });
});
