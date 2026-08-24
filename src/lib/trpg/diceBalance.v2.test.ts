import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exhaustiveD20Buckets, resolveSuccessTier, resolveTrpgRoll } from "./dice";
import { DEFAULT_TRPG_DICE_RULES, LEGACY_DEFAULT_TRPG_DICE_RULES } from "./types";

function rate(count: number): number {
  return count / 20;
}

function partyTwoPlusFailureRate(pFail: readonly number[]): number {
  const n = pFail.length;
  let p0 = 1;
  for (const p of pFail) p0 *= 1 - p;
  let p1 = 0;
  for (let i = 0; i < n; i += 1) {
    let term = pFail[i]!;
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      term *= 1 - pFail[j]!;
    }
    p1 += term;
  }
  return 1 - p0 - p1;
}

describe("TRPG STANDARD V2 dice balance", () => {
  it("DEFAULT_DC=11 DEFAULT_PARTIAL_WINDOW=3", () => {
    assert.equal(DEFAULT_TRPG_DICE_RULES.dc, 11);
    assert.equal(DEFAULT_TRPG_DICE_RULES.partialWindow, 3);
    assert.equal(DEFAULT_TRPG_DICE_RULES.severeFailureMargin, 10);
    assert.equal(DEFAULT_TRPG_DICE_RULES.greatSuccessMargin, 10);
    assert.equal(DEFAULT_TRPG_DICE_RULES.nat1, "critical");
    assert.equal(DEFAULT_TRPG_DICE_RULES.nat20, "critical");
  });

  it("MOD_0 / MOD_2 / MOD_5 exhaustive 20-face rates", () => {
    const mod0 = exhaustiveD20Buckets({ modifier: 0 });
    const mod2 = exhaustiveD20Buckets({ modifier: 2 });
    const mod5 = exhaustiveD20Buckets({ modifier: 5 });
    assert.equal(rate(mod0.FULL_FAILURE), 0.35);
    assert.equal(rate(mod0.PARTIAL), 0.15);
    assert.equal(rate(mod0.SUCCESS_OR_BETTER), 0.5);
    assert.equal(rate(mod2.FULL_FAILURE), 0.25);
    assert.equal(rate(mod2.PARTIAL), 0.15);
    assert.equal(rate(mod2.SUCCESS_OR_BETTER), 0.6);
    assert.equal(rate(mod5.FULL_FAILURE), 0.1);
    assert.equal(rate(mod5.PARTIAL), 0.15);
    assert.equal(rate(mod5.SUCCESS_OR_BETTER), 0.75);
  });

  it("representative +0/+2/+2 party expected failures and two-plus rate", () => {
    const p0 = exhaustiveD20Buckets({ modifier: 0 }).FULL_FAILURE / 20;
    const p2 = exhaustiveD20Buckets({ modifier: 2 }).FULL_FAILURE / 20;
    const expected = p0 + p2 + p2;
    assert.equal(expected, 0.85);
    assert.ok(Math.abs(partyTwoPlusFailureRate([p0, p2, p2]) - 0.19375) < 1e-12);
  });

  it("legacy baseline remains 1.30 expected failures at dc12/window1", () => {
    const p0 = exhaustiveD20Buckets({ modifier: 0, rules: LEGACY_DEFAULT_TRPG_DICE_RULES }).FULL_FAILURE / 20;
    const p2 = exhaustiveD20Buckets({ modifier: 2, rules: LEGACY_DEFAULT_TRPG_DICE_RULES }).FULL_FAILURE / 20;
    assert.equal(p0 + p2 + p2, 1.3);
  });

  it("nat1/nat20 stay critical under V2", () => {
    assert.equal(resolveSuccessTier(1, 30, DEFAULT_TRPG_DICE_RULES), "CRITICAL_FAILURE");
    assert.equal(resolveSuccessTier(20, 1, DEFAULT_TRPG_DICE_RULES), "CRITICAL_SUCCESS");
    assert.equal(resolveTrpgRoll({ d20: 8, statModifier: 0 }).tier, "PARTIAL_SUCCESS");
    assert.equal(resolveTrpgRoll({ d20: 11, statModifier: 0 }).tier, "SUCCESS");
  });
});
