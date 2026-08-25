import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { DEFAULT_TRPG_DICE_RULES, LEGACY_DEFAULT_TRPG_DICE_RULES } from "./types";
import { diceRulesSemanticallyEqual, parseTrpgDiceRules } from "./diceRules";
import { migrateLegacyDefaultDiceRules } from "./diceRulesMigration";
import { ensureTrpgTables } from "./schema";
import { loadScenario } from "./store";

function seedScenario(db: Database.Database, campaignId: number, rules: unknown): void {
  db.prepare(`INSERT INTO trpg_campaigns (id, host_user_id, title) VALUES (?,?,?)`).run(
    campaignId,
    1,
    `c${campaignId}`
  );
  db.prepare(
    `INSERT INTO trpg_scenarios (campaign_id, stat_definitions_json, point_pool, dice_rules_json, widget_template_json)
     VALUES (?,?,?,?,?)`
  ).run(campaignId, "[]", 45, JSON.stringify(rules), "{}");
}

describe("TRPG dice rules parsing", () => {
  it("CUSTOM_PARTIAL_WINDOW_ZERO_PERSISTED and CUSTOM_PARTIAL_WINDOW_ZERO_LOADED", () => {
    const custom = { ...DEFAULT_TRPG_DICE_RULES, partialWindow: 0, dc: 13 };
    const parsed = parseTrpgDiceRules(custom);
    assert.equal(parsed?.partialWindow, 0);
    assert.equal(parsed?.dc, 13);

    const db = new Database(":memory:");
    ensureTrpgTables(db);
    db.prepare(`DELETE FROM trpg_scenarios`).run();
    db.prepare(`DELETE FROM trpg_campaigns`).run();
    seedScenario(db, 9, custom);
    const loaded = loadScenario(db, 9);
    assert.equal(loaded.diceRules.partialWindow, 0);
    assert.equal(loaded.diceRules.dc, 13);
    db.close();
  });

  it("CUSTOM_RULE_UNCHANGED_AFTER_MIGRATION when partialWindow=0", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    db.prepare(`DELETE FROM trpg_scenarios`).run();
    db.prepare(`DELETE FROM trpg_campaigns`).run();
    const custom = { ...DEFAULT_TRPG_DICE_RULES, partialWindow: 0, dc: 13 };
    seedScenario(db, 1, custom);
    const result = migrateLegacyDefaultDiceRules(db);
    assert.equal(result.migrated, 0);
    assert.equal(result.preserved, 1);
    const loaded = loadScenario(db, 1);
    assert.equal(loaded.diceRules.partialWindow, 0);
    assert.equal(loaded.diceRules.dc, 13);
    assert.ok(!diceRulesSemanticallyEqual(loaded.diceRules, LEGACY_DEFAULT_TRPG_DICE_RULES));
    db.close();
  });
});
