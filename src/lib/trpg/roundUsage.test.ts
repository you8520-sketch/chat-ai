import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { computeTrpgRoundPoints } from "./billing";
import { ensureTrpgTables } from "./schema";
import {
  isTrpgRoundUsageEntryBillable,
  loadBillableRoundUsage,
  loadRoundUsageEntries,
  projectBillableRoundUsage,
  tagBotRoundUsage,
  tagGmRoundUsage,
  toModelUsageCalls,
} from "./roundUsage";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function usage(inputTokens: number, outputTokens: number) {
  return {
    modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
    inputTokens,
    outputTokens,
  };
}

describe("roundUsage billable projection", () => {
  it("T2 fixture — failed GM excluded, committed GM included", () => {
    const bot1 = tagBotRoundUsage(usage(1000, 100));
    const bot2 = tagBotRoundUsage(usage(2000, 100));
    const gmFail = tagGmRoundUsage(usage(3000, 300), "gm-a");
    const gmOk = tagGmRoundUsage(usage(4000, 400), "gm-b");
    const actual = [bot1, bot2, gmFail, gmOk];
    const billable = projectBillableRoundUsage(actual, "gm-b");
    assert.equal(actual.length, 4);
    assert.equal(billable.length, 3);
    assert.deepEqual(
      computeTrpgRoundPoints(toModelUsageCalls(billable)),
      computeTrpgRoundPoints(toModelUsageCalls([bot1, bot2, gmOk]))
    );
    assert.notEqual(
      computeTrpgRoundPoints(toModelUsageCalls(actual)),
      computeTrpgRoundPoints(toModelUsageCalls(billable))
    );
  });

  it("T5 — two failed GM generations + one successful bills only success", () => {
    const bot1 = tagBotRoundUsage(usage(1000, 100));
    const bot2 = tagBotRoundUsage(usage(2000, 100));
    const gmA = tagGmRoundUsage(usage(3000, 300), "gm-a");
    const gmB = tagGmRoundUsage(usage(3100, 310), "gm-b");
    const gmC = tagGmRoundUsage(usage(4000, 400), "gm-c");
    const billable = projectBillableRoundUsage([bot1, bot2, gmA, gmB, gmC], "gm-c");
    assert.equal(billable.length, 3);
  });

  it("T6 — stale/failed GM generation id never bills when another generation committed", () => {
    const gmStale = tagGmRoundUsage(usage(5000, 500), "gm-stale");
    const gmCommitted = tagGmRoundUsage(usage(4000, 400), "gm-live");
    assert.equal(isTrpgRoundUsageEntryBillable(gmStale, "gm-live"), false);
    assert.equal(isTrpgRoundUsageEntryBillable(gmCommitted, "gm-live"), true);
  });

  it("legacy GM rows without generation metadata remain billable", () => {
    const legacy = { ...usage(1000, 100), seat: "gm" as const };
    assert.equal(isTrpgRoundUsageEntryBillable(legacy, "any"), true);
  });

  it("loadBillableRoundUsage reads committed generation from DB", () => {
    const db = memoryDb();
    const roundId = Number(
      db
        .prepare(
          `INSERT INTO trpg_rounds (campaign_id, round_number, phase, gm_committed_generation_id, usage_json)
           VALUES (1, 1, 'ROUND_COMPLETE', ?, ?)`
        )
        .run(
          "gm-b",
          JSON.stringify([
            tagBotRoundUsage(usage(1000, 100)),
            tagGmRoundUsage(usage(3000, 300), "gm-a"),
            tagGmRoundUsage(usage(4000, 400), "gm-b"),
          ])
        ).lastInsertRowid
    );
    const billable = loadBillableRoundUsage(db, roundId);
    assert.equal(billable.length, 2);
    assert.equal(billable.some((row) => row.generationId === "gm-a"), false);
    db.close();
  });
});
