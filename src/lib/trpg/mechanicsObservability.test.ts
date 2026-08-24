import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { auditTrpgMechanicsRollEconomy, logTrpgMechanicsCheckTelemetry } from "./mechanicsObservability";
import Database from "better-sqlite3";
import { ensureTrpgTables } from "./schema";

describe("TRPG M1 mechanics observability", () => {
  it("logs sanitized check fields without prose", () => {
    const rows: unknown[] = [];
    const prev = console.info;
    console.info = ((label: unknown, payload: unknown) => {
      if (label === "[trpg-mechanics-check]") rows.push(payload);
    }) as typeof console.info;
    logTrpgMechanicsCheckTelemetry({
      action_type: "attack",
      check_required: true,
      check_reason: "explicit_resolution",
      stat_key: "str",
      stat_modifier: 2,
      condition_modifier: 0,
      final_score: 14,
      dc: 11,
      tier: "SUCCESS",
    });
    console.info = prev;
    const payload = JSON.stringify(rows[0]);
    assert.match(payload, /"action_type":"attack"/);
    assert.doesNotMatch(payload, /마체테|권태현|prose|body/);
  });

  it("audit helper reports zeroed totals on an empty campaign", () => {
    const db = new Database(":memory:");
    ensureTrpgTables(db);
    db.prepare(`INSERT INTO trpg_campaigns (id, host_user_id, title) VALUES (1,1,'t')`).run();
    const audit = auditTrpgMechanicsRollEconomy(db, 1);
    assert.equal(audit.TOTAL_ACTIONS, 0);
    assert.equal(audit.TOTAL_CHECKS, 0);
    assert.equal(audit.CHECK_RATE, 0);
    db.close();
  });
});
