import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyTrpgActionInputDensity,
  classifyTrpgRoundDensity,
  computeTrpgGmNarrationBudget,
  countTrpgNarrationChars,
  TRPG_GM_BRIEF_MAX_CHARS,
  TRPG_GM_BUDGET_MIN_EXTRA_CAP,
  TRPG_GM_BUDGET_MIN_PER_EXTRA,
  TRPG_GM_BUDGET_TARGET_EXTRA_CAP,
  TRPG_GM_BUDGET_TARGET_PER_EXTRA,
  TRPG_GM_MIXED_MIN_CHARS,
  TRPG_GM_MIXED_TARGET_MAX_CHARS,
  TRPG_GM_MIXED_TARGET_MIN_CHARS,
  TRPG_GM_RICH_BUDGET_MIN_CHARS,
  TRPG_GM_RICH_MIN_CHARS,
  TRPG_GM_RICH_TARGET_MAX_CHARS,
  TRPG_GM_RICH_TARGET_MIN_CHARS,
  TRPG_GM_SPARSE_MIN_CHARS,
  TRPG_GM_SPARSE_TARGET_MAX_CHARS,
  TRPG_GM_SPARSE_TARGET_MIN_CHARS,
} from "./gmNarrationBudget";

function padTo(min: number, seed: string): string {
  let out = seed.trim();
  while (countTrpgNarrationChars(out) < min) out += " 먼지가 인다.";
  return out;
}

const SHORT_A = "문을 연다.";
const SHORT_B = "뒤를 살핀다.";
const SHORT_C = "숨는다.";
const SHORT_D = "총을 던진다.";
const RICH_A = padTo(TRPG_GM_RICH_MIN_CHARS, "그는 검을 역수로 고쳐 쥐고 측면으로 파고들었다.");
const RICH_B = padTo(TRPG_GM_RICH_MIN_CHARS, "그녀는 방패를 들어 동료의 옆을 막으며 앞으로 밀었다.");

describe("TRPG GM narration budget", () => {
  it("pins brief/rich thresholds", () => {
    assert.equal(TRPG_GM_BRIEF_MAX_CHARS, 160);
    assert.equal(TRPG_GM_RICH_MIN_CHARS, 350);
    assert.equal(classifyTrpgActionInputDensity("가".repeat(160)), "BRIEF");
    assert.equal(classifyTrpgActionInputDensity("가".repeat(161)), "MID");
    assert.equal(classifyTrpgActionInputDensity("가".repeat(349)), "MID");
    assert.equal(classifyTrpgActionInputDensity("가".repeat(350)), "RICH");
  });

  it("A: two short actions are SPARSE 2800 / 3600–4600", () => {
    assert.equal(classifyTrpgActionInputDensity(SHORT_A), "BRIEF");
    assert.equal(classifyTrpgActionInputDensity(SHORT_B), "BRIEF");
    assert.equal(classifyTrpgRoundDensity([SHORT_A, SHORT_B]), "SPARSE");
    assert.deepEqual(computeTrpgGmNarrationBudget([SHORT_A, SHORT_B]), {
      density: "SPARSE",
      minChars: TRPG_GM_SPARSE_MIN_CHARS,
      targetMinChars: TRPG_GM_SPARSE_TARGET_MIN_CHARS,
      targetMaxChars: TRPG_GM_SPARSE_TARGET_MAX_CHARS,
    });
    assert.equal(TRPG_GM_SPARSE_MIN_CHARS, 2800);
    assert.equal(TRPG_GM_SPARSE_TARGET_MIN_CHARS, 3600);
    assert.equal(TRPG_GM_SPARSE_TARGET_MAX_CHARS, 4600);
  });

  it("B: one short + one rich is MIXED 2400 / 3000–4000", () => {
    assert.equal(classifyTrpgRoundDensity([SHORT_C, RICH_A]), "MIXED");
    assert.deepEqual(computeTrpgGmNarrationBudget([SHORT_C, RICH_A]), {
      density: "MIXED",
      minChars: TRPG_GM_MIXED_MIN_CHARS,
      targetMinChars: TRPG_GM_MIXED_TARGET_MIN_CHARS,
      targetMaxChars: TRPG_GM_MIXED_TARGET_MAX_CHARS,
    });
    assert.equal(TRPG_GM_MIXED_MIN_CHARS, 2400);
    assert.equal(TRPG_GM_MIXED_TARGET_MIN_CHARS, 3000);
    assert.equal(TRPG_GM_MIXED_TARGET_MAX_CHARS, 4000);
  });

  it("C: two rich actions are RICH 2000 / 2500–3500", () => {
    assert.ok(countTrpgNarrationChars(RICH_A) >= 350);
    assert.ok(countTrpgNarrationChars(RICH_B) >= 350);
    assert.equal(classifyTrpgRoundDensity([RICH_A, RICH_B]), "RICH");
    assert.deepEqual(computeTrpgGmNarrationBudget([RICH_A, RICH_B]), {
      density: "RICH",
      minChars: TRPG_GM_RICH_BUDGET_MIN_CHARS,
      targetMinChars: TRPG_GM_RICH_TARGET_MIN_CHARS,
      targetMaxChars: TRPG_GM_RICH_TARGET_MAX_CHARS,
    });
    assert.equal(TRPG_GM_RICH_BUDGET_MIN_CHARS, 2000);
    assert.equal(TRPG_GM_RICH_TARGET_MIN_CHARS, 2500);
    assert.equal(TRPG_GM_RICH_TARGET_MAX_CHARS, 3500);
  });

  it("D: four short actions add the participant-count adjustment", () => {
    const bodies = [SHORT_A, SHORT_B, SHORT_C, SHORT_D];
    assert.equal(classifyTrpgRoundDensity(bodies), "SPARSE");
    assert.deepEqual(computeTrpgGmNarrationBudget(bodies), {
      density: "SPARSE",
      minChars: 3200,
      targetMinChars: 4200,
      targetMaxChars: 5200,
    });
    assert.equal(TRPG_GM_BUDGET_MIN_PER_EXTRA, 200);
    assert.equal(TRPG_GM_BUDGET_TARGET_PER_EXTRA, 300);
    assert.equal(TRPG_GM_BUDGET_MIN_EXTRA_CAP, 400);
    assert.equal(TRPG_GM_BUDGET_TARGET_EXTRA_CAP, 600);
  });
});
