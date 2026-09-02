import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeTrpgGmNarrationBudget,
  TRPG_GM_MIXED_MIN_CHARS,
  TRPG_GM_RICH_BUDGET_MIN_CHARS,
  TRPG_GM_SPARSE_MIN_CHARS,
} from "./gmNarrationBudget";
import { buildTrpgGmUserBlock, TRPG_GM_SYSTEM } from "./gmPrompt";
import { TRPG_GM_SYSTEM_CHARS_PRE_CONSOLIDATION } from "./gmPromptConsolidationBaseline";
import { assessGmCompletionIntegrity } from "./gmCompletionIntegrity";

const PROMPT_CHAR_BASELINE_OWNER = "gmPromptConsolidationBaseline.TRPG_GM_SYSTEM_CHARS_PRE_CONSOLIDATION";

function countRegex(hay: string, re: RegExp): number {
  return hay.match(re)?.length ?? 0;
}

function countNegatives(text: string) {
  return {
    do_not: countRegex(text, /\bdo not\b/gi),
    never: countRegex(text, /\bnever\b/gi),
    must_not: countRegex(text, /\bmust not\b/gi),
    cannot: countRegex(text, /\bcannot\b/gi),
    ignore: countRegex(text, /\bignore\b/gi),
  };
}

function mixedThreePartyUser(): string {
  return buildTrpgGmUserBlock({
    worldBrief: "폐역",
    memoryBlock: "[TRPG STRUCTURED STATE]",
    opening: false,
    actions: [
      {
        participantId: 1,
        name: "렌",
        body: "문을 연다.",
        participantKind: "human",
        statKey: "str",
        d20: 14,
        finalScore: 16,
        dc: 12,
        tier: "SUCCESS",
      },
      {
        participantId: 2,
        name: "유나",
        body: "창가를 본다.",
        participantKind: "ai_character",
        statKey: "wis",
        d20: 12,
        finalScore: 13,
        dc: 12,
        tier: "SUCCESS",
      },
      {
        participantId: 3,
        name: "솔",
        body: "뒤를 돌본다.",
        participantKind: "ai_character",
        statKey: "dex",
        d20: 10,
        finalScore: 11,
        dc: 12,
        tier: "FAILURE",
      },
    ],
  });
}

describe("TRPG GM length prompt consolidation gates", () => {
  it("GM_NUMERIC_LENGTH_OWNER_COUNT = 1 (dynamic user block only)", () => {
    assert.doesNotMatch(TRPG_GM_SYSTEM, /2800|3600|4600|2400|3000|4000|2000|2500|3500/);
    assert.equal(countRegex(TRPG_GM_SYSTEM, /\[LENGTH — SCENE RESPONSIVE\]/g), 1);
    const user = mixedThreePartyUser();
    assert.equal(countRegex(user, /\[ROUND NARRATION BUDGET\]/g), 1);
    assert.match(user, /Finish at or above Minimum; TARGET is the normal complete-scene range/);
  });

  it("terminal ROUND EXECUTION block follows actions and mechanics context", () => {
    const user = mixedThreePartyUser();
    const budgetIdx = user.indexOf("[ROUND NARRATION BUDGET]");
    const actionIdx = user.indexOf("[ACTION participantId");
    assert.ok(budgetIdx > actionIdx, "budget must trail submitted actions");
    assert.match(user, /\[ROUND EXECUTION — binding\]/);
    assert.ok(user.trimEnd().endsWith(user.slice(user.lastIndexOf("[ROUND NARRATION BUDGET]"))));
  });

  it("semantic owner duplicates = 0 for agency, anti-replay, forward motion, speech, length", () => {
    const craft = TRPG_GM_SYSTEM.slice(
      TRPG_GM_SYSTEM.indexOf("[GM SCENE CRAFT — ADAPTIVE NARRATION]"),
      TRPG_GM_SYSTEM.indexOf("[LENGTH — SCENE RESPONSIVE]")
    );
    assert.equal(countRegex(craft, /\[ROUND CRAFT\]/g), 1);
    assert.equal(
      countRegex(craft, /\[AUTHORITATIVE HUMAN PC ACTION — canonical for this PC only\]/g),
      1
    );
    assert.equal(countRegex(craft, /\[AUTHORITATIVE AI PC ATTEMPT — actor-only\]/g), 1);
    assert.equal(countRegex(craft, /first new consequence or changed state/gi), 1);
    assert.equal(countRegex(craft, /compact resolution bridge/gi), 1);
    assert.equal(countRegex(craft, /substantial majority of narration on NEW/gi), 1);
    assert.equal(countRegex(craft, /each PC's next meaningful decision remains with that player/gi), 1);
    assert.equal(countRegex(TRPG_GM_SYSTEM, /\[SPEECH FORMAT\]/g), 1);
    assert.equal(countRegex(TRPG_GM_SYSTEM, /never the addressee/gi), 1);
    assert.doesNotMatch(craft, /do not replay, re-quote, closely paraphrase, or re-stage/i);
    assert.doesNotMatch(craft, /never dedicate a separate long paragraph to each actor's performance/i);
    assert.doesNotMatch(craft, /do not choose their next actions, dialogue, allegiance, movement, or decisions/i);
  });

  it("CREATIVE_BEHAVIOR_RULES_POSITIVE_FIRST — ROUND CRAFT leads with numbered positive contract", () => {
    const roundCraft = TRPG_GM_SYSTEM.slice(
      TRPG_GM_SYSTEM.indexOf("[ROUND CRAFT]"),
      TRPG_GM_SYSTEM.indexOf("[LENGTH — SCENE RESPONSIVE]")
    );
    assert.match(roundCraft, /^1\. Start narration at the first new consequence/m);
    assert.match(roundCraft, /6\. Return player control at an immediate meaningful decision point/);
    const neg = countNegatives(roundCraft);
    assert.ok(neg.do_not + neg.never <= 2, `ROUND CRAFT negatives should stay minimal: ${JSON.stringify(neg)}`);
  });

  it("FINAL_STATIC_GM_INSTRUCTION_CHARS <= BEFORE and system shrinks vs pre-consolidation baseline", () => {
    assert.equal(PROMPT_CHAR_BASELINE_OWNER, "gmPromptConsolidationBaseline.TRPG_GM_SYSTEM_CHARS_PRE_CONSOLIDATION");
    assert.equal(TRPG_GM_SYSTEM_CHARS_PRE_CONSOLIDATION, 11_067);
    assert.ok(TRPG_GM_SYSTEM.length <= TRPG_GM_SYSTEM_CHARS_PRE_CONSOLIDATION);
    assert.ok(TRPG_GM_SYSTEM.length < TRPG_GM_SYSTEM_CHARS_PRE_CONSOLIDATION);
  });

  it("CURRENT_LENGTH_ACCEPTANCE_GAP — integrity accepts short healthy narration", () => {
    const shortNar = "짧은 장면.";
    const raw = `<<<NARRATION>>>\n${shortNar}\n<<<DELTA>>>\n{"players":[],"location":"","campaign_finished":false}`;
    const assessment = assessGmCompletionIntegrity(raw, { finishReason: "stop" });
    assert.equal(assessment.ok, true);
    assert.equal(assessment.status, "healthy");
  });

  it("budget constants unchanged for 3-action party", () => {
    const bodies = ["문을 연다.", "창가.", "뒤."];
    const budget = computeTrpgGmNarrationBudget(bodies);
    assert.equal(budget.density, "SPARSE");
    assert.equal(budget.minChars, TRPG_GM_SPARSE_MIN_CHARS + 200);
    assert.equal(budget.minChars, 3000);

    const mixedBudget = computeTrpgGmNarrationBudget(["문을 연다.", "x".repeat(200), "y".repeat(400)]);
    assert.equal(mixedBudget.minChars, TRPG_GM_MIXED_MIN_CHARS + 200);
    assert.equal(mixedBudget.minChars, 2600);

    const richBudget = computeTrpgGmNarrationBudget(["a".repeat(400), "b".repeat(400), "c".repeat(400)]);
    assert.equal(richBudget.minChars, TRPG_GM_RICH_BUDGET_MIN_CHARS + 200);
    assert.equal(richBudget.minChars, 2200);
  });
});
