import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { DEFAULT_TRPG_DICE_RULES, LEGACY_DEFAULT_TRPG_DICE_RULES } from "./types";
import { diceRulesSemanticallyEqual, parseTrpgDiceRules } from "./diceRules";
import { migrateLegacyDefaultDiceRules } from "./diceRulesMigration";
import { ensureTrpgTables } from "./schema";

function seedScenario(db: Database.Database, campaignId: number, rules: unknown): void {
  db.prepare(
    `INSERT INTO trpg_campaigns (id, host_user_id, title) VALUES (?,?,?)`
  ).run(campaignId, 1, `c${campaignId}`);
  db.prepare(
    `INSERT INTO trpg_scenarios (campaign_id, stat_definitions_json, point_pool, dice_rules_json, widget_template_json)
     VALUES (?,?,?,?,?)`
  ).run(campaignId, "[]", 45, JSON.stringify(rules), "{}");
}

describe("TRPG dice rules compatibility migration", () => {
  it("LEGACY_DEFAULT → V2, V2 unchanged, CUSTOM unchanged, second run idempotent", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    db.prepare(`DELETE FROM trpg_scenarios`).run();
    db.prepare(`DELETE FROM trpg_campaigns`).run();

    seedScenario(db, 1, { ...LEGACY_DEFAULT_TRPG_DICE_RULES });
    seedScenario(db, 2, { dc: 12, partialWindow: 1, die: 20, nat20: "critical", nat1: "critical", greatSuccessMargin: 10, severeFailureMargin: 10 });
    seedScenario(db, 3, { ...DEFAULT_TRPG_DICE_RULES });
    seedScenario(db, 4, { ...DEFAULT_TRPG_DICE_RULES, dc: 14, partialWindow: 2 });

    const first = migrateLegacyDefaultDiceRules(db);
    assert.equal(first.migrated, 2);
    assert.equal(first.preserved, 2);

    const load = (id: number) =>
      parseTrpgDiceRules(
        JSON.parse(
          (db.prepare(`SELECT dice_rules_json FROM trpg_scenarios WHERE campaign_id=?`).get(id) as { dice_rules_json: string })
            .dice_rules_json
        )
      );

    assert.ok(diceRulesSemanticallyEqual(load(1)!, DEFAULT_TRPG_DICE_RULES));
    assert.ok(diceRulesSemanticallyEqual(load(2)!, DEFAULT_TRPG_DICE_RULES));
    assert.ok(diceRulesSemanticallyEqual(load(3)!, DEFAULT_TRPG_DICE_RULES));
    assert.equal(load(4)?.dc, 14);
    assert.equal(load(4)?.partialWindow, 2);

    const second = migrateLegacyDefaultDiceRules(db);
    assert.equal(second.migrated, 0);
    assert.equal(second.preserved, 4);
    db.close();
  });

  it("ENSURE_TABLES_MIGRATES_LEGACY_DICE even when creator-earnings schema is current", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    const earningsSql =
      (
        db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='trpg_creator_earnings'`).get() as
          | { sql: string }
          | undefined
      )?.sql ?? "";
    assert.match(earningsSql, /UNIQUE\(round_id, consumer_user_id, creator_id, role, character_id\)/);

    db.prepare(`DELETE FROM trpg_scenarios`).run();
    db.prepare(`DELETE FROM trpg_campaigns`).run();
    seedScenario(db, 7, { ...LEGACY_DEFAULT_TRPG_DICE_RULES });

    ensureTrpgTables(db);
    const loaded = parseTrpgDiceRules(
      JSON.parse(
        (
          db.prepare(`SELECT dice_rules_json FROM trpg_scenarios WHERE campaign_id=?`).get(7) as {
            dice_rules_json: string;
          }
        ).dice_rules_json
      )
    );
    assert.equal(loaded?.dc, 11);
    assert.equal(loaded?.partialWindow, 3);
    assert.ok(diceRulesSemanticallyEqual(loaded!, DEFAULT_TRPG_DICE_RULES));
    db.close();
  });
});
