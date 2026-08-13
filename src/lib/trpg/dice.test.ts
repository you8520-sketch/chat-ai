import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSuccessTier, resolveTrpgRoll, rollServerD20, successLabelKo } from "./dice";
import { DEFAULT_TRPG_DICE_RULES } from "./types";

describe("TRPG d20 engine", () => {
  it("rolls integers 1–20", () => {
    for (let i = 0; i < 40; i++) {
      const n = rollServerD20();
      assert.ok(Number.isInteger(n) && n >= 1 && n <= 20);
    }
  });

  it("treats a natural 1 as critical failure by default", () => {
    assert.equal(resolveSuccessTier(1, 30, DEFAULT_TRPG_DICE_RULES), "CRITICAL_FAILURE");
    assert.equal(successLabelKo("CRITICAL_FAILURE"), "치명적 실패");
  });

  it("treats a natural 20 as critical success by default", () => {
    assert.equal(resolveSuccessTier(20, 1, DEFAULT_TRPG_DICE_RULES), "CRITICAL_SUCCESS");
  });

  it("maps numeric totals onto success and failure", () => {
    assert.equal(resolveSuccessTier(10, 2, { ...DEFAULT_TRPG_DICE_RULES, dc: 12 }), "SEVERE_FAILURE");
    assert.equal(resolveSuccessTier(10, 8, { ...DEFAULT_TRPG_DICE_RULES, dc: 12 }), "FAILURE");
    assert.equal(resolveSuccessTier(10, 11, { ...DEFAULT_TRPG_DICE_RULES, dc: 12 }), "PARTIAL_SUCCESS");
    assert.equal(resolveSuccessTier(10, 12, { ...DEFAULT_TRPG_DICE_RULES, dc: 12 }), "SUCCESS");
    assert.equal(resolveSuccessTier(10, 22, { ...DEFAULT_TRPG_DICE_RULES, dc: 12 }), "GREAT_SUCCESS");
  });

  it("adds modifiers after the server face value", () => {
    const roll = resolveTrpgRoll({
      d20: 10,
      statModifier: 2,
      supportModifier: 1,
      dc: 12,
    });
    assert.equal(roll.finalScore, 13);
    assert.equal(roll.tier, "SUCCESS");
    assert.equal(roll.success, true);
  });
});
