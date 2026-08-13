import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_TRPG_POINT_POOL, DEFAULT_TRPG_STAT_DEFS, TRPG_STAT_CATALOG, defsFromKeys, deriveMaxHp, evenStats, parseStatKeys, pointPoolFor, suggestBotStats, validateStatAllocation } from "./stats";

describe("TRPG stat allocation", () => {
  it("rejects a pool overflow", () => {
    const values = { str: 10, dex: 10, int: 10, wis: 10, cha: 10, con: 10 };
    const result = validateStatAllocation(DEFAULT_TRPG_STAT_DEFS, values, DEFAULT_TRPG_POINT_POOL);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "over_pool");
  });

  it("accepts a legal 30-point spread", () => {
    const values = { str: 5, dex: 5, int: 5, wis: 5, cha: 5, con: 5 };
    const result = validateStatAllocation(DEFAULT_TRPG_STAT_DEFS, values);
    assert.deepEqual(result, { ok: true, total: 30 });
    assert.equal(deriveMaxHp(5), 25);
  });

  it("rejects out-of-range stats", () => {
    const values = { str: 0, dex: 5, int: 5, wis: 5, cha: 5, con: 5 };
    const result = validateStatAllocation(DEFAULT_TRPG_STAT_DEFS, values);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "out_of_range");
  });

  it("tilts a suggested bot sheet toward the character instead of even 5s", () => {
    const even = suggestBotStats("");
    assert.deepEqual(even, evenStats(DEFAULT_TRPG_STAT_DEFS));
    const fighter = suggestBotStats("냉정한 용병 기사. 검과 방패로 싸운다.");
    assert.ok(fighter.str > even.str);
    assert.equal(Object.values(fighter).reduce((a, b) => a + b, 0), 30);
    const check = validateStatAllocation(DEFAULT_TRPG_STAT_DEFS, fighter);
    assert.equal(check.ok, true);
  });

  it("keeps a 30-stat catalog and lets a scenario pick a subset", () => {
    assert.equal(TRPG_STAT_CATALOG.length, 30);
    assert.deepEqual(parseStatKeys(["mag", "str", "nope", "mag"]), ["str", "mag"]);
    const defs = defsFromKeys(["str", "mag"]);
    assert.equal(pointPoolFor(defs), 10);
    const even = evenStats(defs);
    assert.equal(even.str, 5);
    assert.equal(even.mag, 5);
    assert.ok(TRPG_STAT_CATALOG.some((row) => row.key === "san"));
    assert.ok(TRPG_STAT_CATALOG.some((row) => row.key === "rec"));
  });
});
