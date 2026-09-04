import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  CREATOR_PRO_RENEWAL_MIN_AVERAGE_SPENT,
  meetsProPromotionCriteria,
  passesProRenewal,
  syncProTierStatus,
} from "./creatorProTier";

describe("pro creator term policy", () => {
  function proTerm(db: Database.Database) {
    const row = db.prepare(
      "SELECT pro_tier_granted_at, pro_tier_valid_until FROM users WHERE id=1"
    ).get() as { pro_tier_granted_at: string | null; pro_tier_valid_until: string | null };
    return {
      pro_tier_granted_at: row.pro_tier_granted_at,
      pro_tier_valid_until: row.pro_tier_valid_until,
    };
  }

  it("requires chats and 2,000,000P monthly spend for initial promotion", () => {
    const qualifying = { publicCharacterCount: 5, totalChats: 100_000, monthlySpentOnChars: 2_000_000 };
    assert.equal(meetsProPromotionCriteria(qualifying), true);
    assert.equal(meetsProPromotionCriteria({ ...qualifying, monthlySpentOnChars: 1_999_999 }), false);
  });

  it("renews when the three-month average is at least 75% of 2,000,000P", () => {
    assert.equal(CREATOR_PRO_RENEWAL_MIN_AVERAGE_SPENT, 1_500_000);
    assert.equal(passesProRenewal({ "2026-01": 1_000_000, "2026-02": 1_500_000, "2026-03": 2_000_000 }), true);
    assert.equal(passesProRenewal({ "2026-01": 1_000_000, "2026-02": 1_499_999, "2026-03": 2_000_000 }), false);
  });

  it("guarantees a promoted tier for three months and then renews it from the term average", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        pro_tier_granted_at TEXT,
        pro_tier_valid_until TEXT
      );
      CREATE TABLE creator_earnings (
        creator_id INTEGER,
        points_spent REAL,
        reversed INTEGER,
        created_at TEXT
      );
      INSERT INTO users (id) VALUES (1);
      INSERT INTO creator_earnings VALUES
        (1, 1500000, 0, '2026-01-25'),
        (1, 1500000, 0, '2026-02-15'),
        (1, 1500000, 0, '2026-03-15');
    `);

    const promotionStats = {
      publicCharacterCount: 5,
      totalChats: 100_000,
      monthlySpentOnChars: 2_000_000,
    };
    assert.equal(syncProTierStatus(db, 1, promotionStats, new Date("2026-01-20T00:00:00Z")), true);
    assert.deepEqual(
      proTerm(db),
      { pro_tier_granted_at: "2026-01-20", pro_tier_valid_until: "2026-04-20" }
    );

    const belowPromotion = { ...promotionStats, monthlySpentOnChars: 0 };
    assert.equal(syncProTierStatus(db, 1, belowPromotion, new Date("2026-04-19T00:00:00Z")), true);
    assert.equal(syncProTierStatus(db, 1, belowPromotion, new Date("2026-04-20T00:00:00Z")), true);
    assert.deepEqual(
      proTerm(db),
      { pro_tier_granted_at: "2026-04-20", pro_tier_valid_until: "2026-07-20" }
    );
    db.close();
  });
});
