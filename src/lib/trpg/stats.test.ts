import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_TRPG_POINT_POOL,
  DEFAULT_TRPG_STAT_DEFS,
  TRPG_STAT_CATALOG,
  TRPG_STAT_MAX,
  TRPG_STAT_MIN,
  TRPG_STAT_POOL_BONUS,
  defsFromKeys,
  deriveMaxHp,
  evenStats,
  floorStats,
  parseStatKeys,
  pointPoolFor,
  resolveCampaignStatDefs,
  statModifier,
  suggestBotStats,
  validateStatAllocation,
} from "./stats";

describe("TRPG stat allocation", () => {
  it("rejects a pool overflow", () => {
    const values = { str: 10, dex: 10, int: 10, wis: 10, cha: 10, con: 10 };
    const result = validateStatAllocation(DEFAULT_TRPG_STAT_DEFS, values, DEFAULT_TRPG_POINT_POOL);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "over_pool");
  });

  it("accepts the 5-floor spread and leftover bonus", () => {
    const values = { str: 5, dex: 5, int: 5, wis: 5, cha: 5, con: 5 };
    const result = validateStatAllocation(DEFAULT_TRPG_STAT_DEFS, values);
    assert.deepEqual(result, { ok: true, total: 30 });
    assert.equal(DEFAULT_TRPG_POINT_POOL, 6 * TRPG_STAT_MIN + TRPG_STAT_POOL_BONUS);
    assert.equal(deriveMaxHp(5), 25);
    assert.equal(statModifier(5), 0);
    assert.equal(statModifier(9), 2);
    assert.equal(statModifier(15), 5);
  });

  it("lets one stat go to 15 without dumping the others below 5", () => {
    const values = { str: 15, dex: 5, int: 5, wis: 5, cha: 5, con: 5 };
    const result = validateStatAllocation(DEFAULT_TRPG_STAT_DEFS, values);
    assert.deepEqual(result, { ok: true, total: 40 });
  });

  it("rejects out-of-range stats", () => {
    const tooLow = { str: 4, dex: 5, int: 5, wis: 5, cha: 5, con: 5 };
    const tooHigh = { str: 16, dex: 5, int: 5, wis: 5, cha: 5, con: 5 };
    assert.equal(validateStatAllocation(DEFAULT_TRPG_STAT_DEFS, tooLow).ok, false);
    assert.equal(validateStatAllocation(DEFAULT_TRPG_STAT_DEFS, tooHigh).ok, false);
    assert.equal(TRPG_STAT_MIN, 5);
    assert.equal(TRPG_STAT_MAX, 15);
  });

  it("tilts a suggested bot sheet toward the character instead of even fill", () => {
    const even = suggestBotStats("");
    assert.deepEqual(even, evenStats(DEFAULT_TRPG_STAT_DEFS));
    const fighter = suggestBotStats("냉정한 용병 기사. 검과 방패로 싸운다.");
    assert.ok(fighter.str > even.str);
    assert.equal(Object.values(fighter).reduce((a, b) => a + b, 0), DEFAULT_TRPG_POINT_POOL);
    const check = validateStatAllocation(DEFAULT_TRPG_STAT_DEFS, fighter);
    assert.equal(check.ok, true);
  });

  it("keeps an 18-stat public catalog and lets a scenario pick a subset", () => {
    assert.equal(TRPG_STAT_CATALOG.length, 18);
    assert.deepEqual(parseStatKeys(["mag", "str", "nope", "mag"]), ["str", "mag"]);
    const defs = defsFromKeys(["str", "mag"]);
    assert.equal(pointPoolFor(defs), 2 * TRPG_STAT_MIN + TRPG_STAT_POOL_BONUS);
    const floor = floorStats(defs);
    assert.equal(floor.str, 5);
    assert.equal(floor.mag, 5);
    const even = evenStats(defs);
    assert.equal(Object.values(even).reduce((a, b) => a + b, 0), pointPoolFor(defs));
    assert.ok(even.str <= TRPG_STAT_MAX);
    assert.ok(TRPG_STAT_CATALOG.some((row) => row.key === "san"));
    assert.equal(
      TRPG_STAT_CATALOG.some((row) => row.key === "rec"),
      false
    );
  });

  it("refreshes stored campaign defs to the live 5–15 catalog", () => {
    const defs = resolveCampaignStatDefs([
      { key: "str", label: "힘", min: 1, max: 10 },
      { key: "mag", min: 1, max: 10 },
    ]);
    assert.deepEqual(
      defs.map((d) => ({ key: d.key, min: d.min, max: d.max })),
      [
        { key: "str", min: 5, max: 15 },
        { key: "mag", min: 5, max: 15 },
      ]
    );
  });
});
