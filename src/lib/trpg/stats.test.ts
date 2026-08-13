import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_TRPG_POINT_POOL, DEFAULT_TRPG_STAT_DEFS, deriveMaxHp, validateStatAllocation } from "./stats";

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
});
