import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { applyCampaignStoryProgress } from "./campaignContext";
import { buildTrpgGmUserBlock } from "./gmPrompt";
import {
  effectiveEndingConditionsForGm,
  hasLegacyAdvancedPlanFields,
  hasPlayableScenarioPlan,
  serializeTrpgScenarioPlanForGm,
  emptyTrpgScenarioPlan,
  type TrpgScenarioPlan,
} from "./scenarioPlan";
import { evaluateScenarioReadiness } from "./scenarioReadiness";
import { normalizeScenarioTemplateInput } from "./scenarioTypes";
import {
  isLegacyPublicTrpgWorld,
  mergeGmPrivateNotes,
  TRPG_DEFAULT_ENDING_GUIDANCE,
  validateScenarioPublicationTransition,
  validateWorldTrpgPublicationTransition,
  WORLD_TRPG_PUBLIC_INTRO_REQUIRED,
  SCENARIO_PUBLIC_INTRO_REQUIRED,
} from "./trpgPublication";

function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = hay.indexOf(needle, pos)) !== -1) {
    count += 1;
    pos += needle.length;
  }
  return count;
}

function basicPlayablePlan(overrides: Partial<TrpgScenarioPlan> = {}): TrpgScenarioPlan {
  return {
    ...emptyTrpgScenarioPlan(),
    startingSituation: "시작",
    goal: "탈출",
    endingConditions: [],
    ...overrides,
  };
}

function buildNewCampaignGmPrompt(opts: {
  secretContent: string;
  planSecret: string;
  plan: TrpgScenarioPlan;
}): string {
  const gmSecret = mergeGmPrivateNotes(opts.secretContent, opts.planSecret);
  const scenarioPlanBlock = serializeTrpgScenarioPlanForGm(opts.plan);
  return buildTrpgGmUserBlock({
    worldBrief: "테스트 세계",
    memoryBlock: "",
    opening: true,
    gmSecret,
    scenarioPlanBlock,
    actions: [],
  });
}

describe("TRPG publication and authoring consolidation", () => {
  it("GENERAL_WORLD_EMPTY_SUMMARY_CAN_SAVE: private world save does not require intro", () => {
    assert.doesNotThrow(() =>
      validateWorldTrpgPublicationTransition({
        previousTrpgEnabled: false,
        nextTrpgEnabled: false,
        summary: "",
      })
    );
  });

  it("NEW_PUBLIC_TRPG_WORLD_EMPTY_INTRO_REJECTED_AT_CANONICAL_PUBLICATION_OWNER", () => {
    assert.throws(
      () =>
        validateWorldTrpgPublicationTransition({
          previousTrpgEnabled: false,
          nextTrpgEnabled: true,
          summary: "",
        }),
      (error: Error) => error.message === WORLD_TRPG_PUBLIC_INTRO_REQUIRED
    );
  });

  it("LEGACY_PUBLIC_EMPTY_INTRO_NOT_AUTO_HIDDEN: already-public worlds may keep empty summary on unrelated edits", () => {
    assert.doesNotThrow(() =>
      validateWorldTrpgPublicationTransition({
        previousTrpgEnabled: true,
        nextTrpgEnabled: true,
        summary: "",
      })
    );
    assert.equal(isLegacyPublicTrpgWorld({ trpg_enabled: 1, summary: "" }), true);
  });

  it("NEW_PRIVATE_SCENARIO_EMPTY_INTRO: private save does not require intro", () => {
    assert.doesNotThrow(() =>
      validateScenarioPublicationTransition({
        previousVisibility: "private",
        nextVisibility: "private",
        summary: "",
      })
    );
    const readiness = evaluateScenarioReadiness({
      title: "테스트",
      content: "",
      summary: "",
      visibility: "private",
      previousVisibility: "private",
      scenarioPlan: basicPlayablePlan(),
    });
    assert.equal(readiness.canSave, true);
  });

  it("NEW_PUBLIC_SCENARIO_EMPTY_INTRO: first public save requires intro", () => {
    assert.throws(
      () =>
        validateScenarioPublicationTransition({
          previousVisibility: "private",
          nextVisibility: "public",
          summary: "",
        }),
      (error: Error) => error.message === SCENARIO_PUBLIC_INTRO_REQUIRED
    );
  });

  it("PRIVATE_TO_PUBLIC_EMPTY_INTRO: transition to public requires intro", () => {
    assert.throws(
      () =>
        validateScenarioPublicationTransition({
          previousVisibility: "private",
          nextVisibility: "public",
          summary: "   ",
        }),
      (error: Error) => error.message === SCENARIO_PUBLIC_INTRO_REQUIRED
    );
    const readiness = evaluateScenarioReadiness({
      title: "테스트",
      content: "",
      summary: "",
      visibility: "public",
      previousVisibility: "private",
      scenarioPlan: basicPlayablePlan(),
    });
    assert.equal(readiness.canSave, false);
    assert.ok(readiness.blockers.some((item) => item.id === "missing_public_intro"));
  });

  it("PUBLIC_SCENARIO_WITH_INTRO: public save passes when intro present", () => {
    assert.doesNotThrow(() =>
      validateScenarioPublicationTransition({
        previousVisibility: "private",
        nextVisibility: "public",
        summary: "플레이어용 소개",
      })
    );
  });

  it("BASIC_AUTHORING_DOES_NOT_REQUIRE_ADVANCED_UI_FIELDS", () => {
    const plan = {
      ...emptyTrpgScenarioPlan(),
      startingSituation: "문 앞",
      goal: "탈출한다",
    };
    assert.equal(hasPlayableScenarioPlan(plan), true);
    const readiness = evaluateScenarioReadiness({
      title: "테스트",
      content: "",
      summary: "",
      visibility: "private",
      scenarioPlan: plan,
    });
    assert.equal(readiness.canSave, true);
    assert.equal(readiness.canPlay, true);
  });

  it("DEFAULT_ENDING_GUIDANCE_IN_PROMPT exactly once for empty endingConditions", () => {
    const plan = basicPlayablePlan();
    assert.deepEqual(plan.endingConditions, []);
    assert.deepEqual(effectiveEndingConditionsForGm(plan), [TRPG_DEFAULT_ENDING_GUIDANCE]);
    const serialized = serializeTrpgScenarioPlanForGm(plan);
    assert.equal(countOccurrences(serialized, TRPG_DEFAULT_ENDING_GUIDANCE), 1);
    assert.match(serialized, /종료 조건:/);
    assert.doesNotMatch(serialized, /GM만 아는 비밀:/);
  });

  it("AUTHORED_ENDING_JSON_UNCHANGED: runtime fallback is not written into plan JSON", () => {
    const plan = basicPlayablePlan();
    serializeTrpgScenarioPlanForGm(plan);
    assert.deepEqual(plan.endingConditions, []);
  });

  it("CAMPAIGN_FINISH_WITH_DEFAULT_GUIDANCE: campaign_finished=true ends without endingConditionId", () => {
    const plan = basicPlayablePlan();
    const ctx = applyCampaignStoryProgress(
      {
        campaignId: 1,
        sourceMode: "scenario",
        worldSnapshot: null,
        scenarioSnapshot: {
          id: 1,
          title: "테스트",
          summary: "",
          content: "",
          secretContent: "",
          startLocation: "",
          startInventory: [],
          plan,
          updatedAt: "",
        },
        directorPlan: plan,
        storyPhase: "CLIMAX",
        activeThreads: [],
        resolvedThreads: [],
        endingStatus: { finished: false },
        directorError: "",
      },
      { campaignFinished: true }
    );
    assert.equal(ctx.endingStatus.finished, true);
    assert.equal(ctx.storyPhase, "FINISHED");
    assert.equal(ctx.endingStatus.endingConditionId, undefined);
    assert.equal(ctx.endingStatus.endingConditionText, undefined);
  });

  it("ENDING_CONTRACT_MISMATCH_FOUND: finish does not require fallback index id", () => {
    const plan = basicPlayablePlan();
    const withoutId = applyCampaignStoryProgress(
      {
        campaignId: 2,
        sourceMode: "scenario",
        worldSnapshot: null,
        scenarioSnapshot: null,
        directorPlan: plan,
        storyPhase: "DEVELOPMENT",
        activeThreads: [],
        resolvedThreads: [],
        endingStatus: { finished: false },
        directorError: "",
      },
      { campaignFinished: true }
    );
    const withWrongId = applyCampaignStoryProgress(withoutId, { endingConditionId: "0" });
    assert.equal(withWrongId.endingStatus.finished, true);
    assert.equal(withWrongId.endingStatus.endingConditionText, undefined);
  });

  it("NEW_CAMPAIGN_SECRET_CONTENT_ONLY: GM note appears exactly once", () => {
    const secret = "SECRET_CONTENT_ONLY_TOKEN";
    const plan = basicPlayablePlan({ secret: "" });
    const prompt = buildNewCampaignGmPrompt({ secretContent: secret, planSecret: "", plan });
    assert.equal(countOccurrences(prompt, secret), 1);
    assert.equal(countOccurrences(prompt, "[GM SECRET"), 1);
    assert.doesNotMatch(serializeTrpgScenarioPlanForGm(plan), new RegExp(secret));
  });

  it("NEW_CAMPAIGN_PLAN_SECRET_ONLY: legacy plan.secret appears exactly once via GM SECRET", () => {
    const secret = "PLAN_SECRET_ONLY_TOKEN";
    const plan = basicPlayablePlan({ secret });
    const prompt = buildNewCampaignGmPrompt({ secretContent: "", planSecret: secret, plan });
    assert.equal(countOccurrences(prompt, secret), 1);
    assert.equal(countOccurrences(prompt, "[GM SECRET"), 1);
    assert.doesNotMatch(serializeTrpgScenarioPlanForGm(plan), /PLAN_SECRET_ONLY_TOKEN/);
  });

  it("NEW_CAMPAIGN_BOTH: merged secrets each appear exactly once without duplication", () => {
    const secretA = "MERGED_SECRET_A";
    const secretB = "MERGED_SECRET_B";
    const plan = basicPlayablePlan({ secret: secretB });
    const prompt = buildNewCampaignGmPrompt({ secretContent: secretA, planSecret: secretB, plan });
    assert.equal(countOccurrences(prompt, secretA), 1);
    assert.equal(countOccurrences(prompt, secretB), 1);
    assert.equal(countOccurrences(prompt, "[GM SECRET"), 1);
    assert.doesNotMatch(serializeTrpgScenarioPlanForGm(plan), new RegExp(secretB));
  });

  it("GM_NOTE_DUPLICATION_COUNT: duplicate merge inputs collapse to one occurrence", () => {
    const secret = "DUPLICATE_SECRET";
    const merged = mergeGmPrivateNotes(secret, secret);
    assert.equal(merged, secret);
    const plan = basicPlayablePlan({ secret });
    const prompt = buildNewCampaignGmPrompt({ secretContent: secret, planSecret: secret, plan });
    assert.equal(countOccurrences(prompt, secret), 1);
  });

  it("PLAYER_PREVIEW_DOES_NOT_EXPOSE_RAW_GM_PLAN_FIELDS", () => {
    const preview = fs.readFileSync("src/app/trpg/TrpgCatalogPreview.tsx", "utf8");
    assert.doesNotMatch(preview, /startingSituation|centralConflict|endingConditions|scenarioPlan/);
    assert.match(preview, /scenario\.summary/);
    assert.match(preview, /scenario\.content/);
  });

  it("NEW_PUBLIC_TRPG_WORLD_INTRO_CARD_PREVIEW_PARITY uses world.summary owner", () => {
    const card = fs.readFileSync("src/app/trpg/TrpgCatalogCard.tsx", "utf8");
    const preview = fs.readFileSync("src/app/trpg/TrpgCatalogPreview.tsx", "utf8");
    assert.match(card, /summary\.trim\(\)/);
    assert.match(preview, /world\.summary/);
  });

  it("normalizeScenarioTemplateInput rejects new public scenario without intro", () => {
    const plan = basicPlayablePlan({ startingSituation: "문 앞", goal: "탈출" });
    assert.throws(
      () =>
        normalizeScenarioTemplateInput({
          title: "테스트",
          content: "",
          summary: "",
          visibility: "public",
          scenarioPlan: plan,
        }),
      /플레이어 공개 소개/
    );
  });

  it("normalizeScenarioTemplateInput allows private scenario without intro", () => {
    const plan = basicPlayablePlan({ startingSituation: "문 앞", goal: "탈출" });
    assert.doesNotThrow(() =>
      normalizeScenarioTemplateInput({
        title: "테스트",
        content: "",
        summary: "",
        visibility: "private",
        scenarioPlan: plan,
      })
    );
  });

  it("LEGACY_ADVANCED_FIELDS_SURVIVE_BASIC_EDIT via hasLegacyAdvancedPlanFields", () => {
    const plan = {
      ...emptyTrpgScenarioPlan(),
      startingSituation: "문 앞",
      goal: "탈출",
      centralConflict: "옛 갈등",
      endingConditions: ["끝"],
    };
    assert.equal(hasLegacyAdvancedPlanFields(plan), true);
    const payload = normalizeScenarioTemplateInput({
      title: "테스트",
      content: "",
      summary: "소개",
      scenarioPlan: plan,
    });
    assert.equal(payload.scenarioPlan?.centralConflict, "옛 갈등");
    assert.deepEqual(payload.scenarioPlan?.endingConditions, ["끝"]);
  });

  it("WORLD_ONLY_CAMPAIGN_START_UNCHANGED: engineCreate still builds world_brief from summary+content", () => {
    const engineCreate = fs.readFileSync("src/lib/trpg/engineCreate.ts", "utf8");
    assert.match(engineCreate, /worldBrief = \[world\.summary, world\.content\]/);
  });
});
