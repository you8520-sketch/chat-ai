import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { createTrpgCampaign, saveTrpgSheet } from "./engineCreate";
import { evenStats, floorStats, DEFAULT_TRPG_STAT_DEFS, pointPoolFor, validateStatAllocation } from "./stats";
import { ensureTrpgTables } from "./schema";
import { loadScenario } from "./store";
import { normalizeScenarioTemplateInput } from "./scenarioTypes";

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

describe("TRPG M1 default PC stats", () => {
  it("WORLD_ONLY_DEFAULT_USES_POINT_POOL", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
    });
    const scenario = loadScenario(db, campaignId);
    const expected = evenStats(DEFAULT_TRPG_STAT_DEFS);
    assert.deepEqual(scenario.defaultPcStats, expected);
    assert.equal(validateStatAllocation(DEFAULT_TRPG_STAT_DEFS, scenario.defaultPcStats ?? {}, pointPoolFor(DEFAULT_TRPG_STAT_DEFS)).ok, true);
    const total = Object.values(scenario.defaultPcStats ?? {}).reduce((sum, n) => sum + n, 0);
    assert.equal(total, pointPoolFor(DEFAULT_TRPG_STAT_DEFS));
    assert.notDeepEqual(scenario.defaultPcStats, floorStats(DEFAULT_TRPG_STAT_DEFS));
    db.close();
  });

  it("TEMPLATE_WITH_NO_EXPLICIT_PC_STATS_USES_BALANCED_DEFAULT", () => {
    const normalized = normalizeScenarioTemplateInput({
      title: "빈 템플릿",
      summary: "요약",
      content: "본문",
    });
    assert.deepEqual(normalized.defaultPcStats, evenStats(DEFAULT_TRPG_STAT_DEFS));
  });

  it("EXPLICIT_TEMPLATE_STATS_PRESERVED", () => {
    const explicit = { str: 9, dex: 7, int: 5, wis: 5, cha: 5, con: 9 };
    const normalized = normalizeScenarioTemplateInput({
      title: "지정 스탯",
      summary: "요약",
      content: "본문",
      defaultPcStats: explicit,
    });
    assert.equal(normalized.defaultPcStats.str, 9);
    assert.equal(normalized.defaultPcStats.dex, 7);
  });

  it("EXPLICIT_PLAYER_STATS_PRESERVED and ACTIVE_SHEET_MUTATED=false", () => {
    const db = memoryDb();
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
    });
    const custom = { str: 11, dex: 7, int: 5, wis: 5, cha: 5, con: 7 };
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: custom });
    const row = db
      .prepare(
        `SELECT st.stat_key, st.value FROM trpg_character_stats st
         JOIN trpg_character_sheets sh ON sh.id = st.sheet_id
         JOIN trpg_participants p ON p.id = sh.participant_id
         WHERE p.user_id=1`
      )
      .all() as Array<{ stat_key: string; value: number }>;
    const stored = Object.fromEntries(row.map((item) => [item.stat_key, item.value]));
    assert.equal(stored.str, 11);
    assert.equal(stored.dex, 7);
    db.close();
  });
});
