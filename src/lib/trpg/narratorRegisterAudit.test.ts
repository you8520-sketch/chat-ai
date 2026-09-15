import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSandboxDirectorSystemPrompt,
  buildScenarioDraftSystemPrompt,
} from "./scenarioDraft";
import { buildTrpgGmUserBlock, TRPG_GM_SYSTEM } from "./gmPrompt";
import { parseTrpgScenarioPlan, serializeTrpgScenarioPlanForGm } from "./scenarioPlan";
import { serializeCampaignDirectorInstructions, serializeDirectorDeltaContract } from "./campaignContext";

const samplePlan = parseTrpgScenarioPlan({
  startingSituation: "폐도시 외곽에 도착했다.",
  centralConflict: "코어와 생존자 세력",
  goal: "원인을 밝힌다",
  secret: "SECRET",
  endingConditions: ["코어를 봉쇄한다"],
  clues: ["통신 기록"],
  endingCandidates: ["봉쇄"],
  gmDirection: "탐험과 긴장을 우선한다.",
})!;

describe("narrator register owner audit", () => {
  it("opening and normal round share TRPG_GM_SYSTEM as the sole narration-style owner", () => {
    const openingUser = buildTrpgGmUserBlock({
      worldBrief: "세계",
      memoryBlock: "[MEMORY]",
      opening: true,
      actions: [],
    });
    const roundUser = buildTrpgGmUserBlock({
      worldBrief: "세계",
      memoryBlock: "[MEMORY]",
      opening: false,
      actions: [
        {
          participantId: 1,
          name: "렌",
          body: "문을 연다.",
          statKey: "str",
          d20: 10,
          finalScore: 12,
          dc: 10,
          tier: "SUCCESS",
        },
      ],
    });
    assert.match(TRPG_GM_SYSTEM, /Korean novelistic narration only/);
    assert.doesNotMatch(openingUser, /Korean novelistic narration only/);
    assert.doesNotMatch(roundUser, /Korean novelistic narration only/);
    assert.doesNotMatch(openingUser, /\[SPEECH FORMAT\]/);
    assert.doesNotMatch(roundUser, /\[SPEECH FORMAT\]/);
  });

  it("no canonical narrator politeness/register rule exists in GM system today", () => {
    const registerTerms = [/했습니다/, /평서체/, /존댓말/, /비존대/, /narrator register/i, /했다\/였다/];
    for (const term of registerTerms) {
      assert.doesNotMatch(TRPG_GM_SYSTEM, term);
    }
  });

  it("Blueprint and scenario plan serializers are content-only (no surface register rules)", () => {
    const blueprintSystem = buildSandboxDirectorSystemPrompt();
    const draftSystem = buildScenarioDraftSystemPrompt();
    const planBlock = serializeTrpgScenarioPlanForGm(samplePlan);
    assert.match(blueprintSystem, /scenario designer, not a novelist/);
    assert.match(draftSystem, /scenario designer, not a novelist/);
    assert.doesNotMatch(blueprintSystem, /Korean novelistic narration/);
    assert.doesNotMatch(planBlock, /했습니다|평서체|존댓말/);
    assert.match(planBlock, /시작 상황:/);
  });

  it("story director blocks govern plot delta, not narration register", () => {
    const storyBlock = serializeCampaignDirectorInstructions(true);
    const deltaBlock = serializeDirectorDeltaContract({ storyPhase: "INTRO", completedRounds: 0 });
    for (const block of [storyBlock, deltaBlock]) {
      assert.doesNotMatch(block, /했습니다|평서체|novelistic|SPEECH FORMAT/);
    }
  });

  it("character dialogue speech owner is GM [SPEECH FORMAT] only", () => {
    assert.match(TRPG_GM_SYSTEM, /\[SPEECH FORMAT\]/);
    assert.match(TRPG_GM_SYSTEM, /이름: "대사"/);
    assert.equal((TRPG_GM_SYSTEM.match(/\[SPEECH FORMAT\]/g) ?? []).length, 1);
  });
});
