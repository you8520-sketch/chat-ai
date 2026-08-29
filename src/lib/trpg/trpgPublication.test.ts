import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  effectiveEndingConditionsForGm,
  hasLegacyAdvancedPlanFields,
  hasPlayableScenarioPlan,
  serializeTrpgScenarioPlanForGm,
  emptyTrpgScenarioPlan,
} from "./scenarioPlan";
import { evaluateScenarioReadiness } from "./scenarioReadiness";
import { normalizeScenarioTemplateInput } from "./scenarioTypes";
import {
  isLegacyPublicTrpgWorld,
  mergeGmPrivateNotes,
  TRPG_DEFAULT_ENDING_GUIDANCE,
  validateScenarioPublicIntro,
  validateWorldTrpgPublicationTransition,
  WORLD_TRPG_PUBLIC_INTRO_REQUIRED,
  SCENARIO_PUBLIC_INTRO_REQUIRED,
} from "./trpgPublication";

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

  it("PUBLIC_SCENARIO_REQUIRES_PUBLIC_INTRO and PRIVATE_SCENARIO_PUBLIC_INTRO_OPTIONAL", () => {
    assert.throws(
      () => validateScenarioPublicIntro({ visibility: "public", summary: "" }),
      (error: Error) => error.message === SCENARIO_PUBLIC_INTRO_REQUIRED
    );
    assert.doesNotThrow(() => validateScenarioPublicIntro({ visibility: "private", summary: "" }));
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

  it("NO_FAKE_AUTHORED_ENDING_DATA_PERSISTED: runtime fallback is not written into plan JSON", () => {
    const plan = {
      ...emptyTrpgScenarioPlan(),
      startingSituation: "시작",
      goal: "목표",
      endingConditions: [],
    };
    assert.deepEqual(plan.endingConditions, []);
    assert.deepEqual(effectiveEndingConditionsForGm(plan), [TRPG_DEFAULT_ENDING_GUIDANCE]);
    const serialized = serializeTrpgScenarioPlanForGm(plan);
    assert.match(serialized, /종료 조건:/);
    assert.match(serialized, /자연스럽게 결말/);
    assert.doesNotMatch(serialized, /GM만 아는 비밀:/);
  });

  it("GM_PRIVATE_NOTE_INJECTION_COUNT_EQUALS_ONE via merge helper", () => {
    assert.equal(
      mergeGmPrivateNotes("숨김 A", "숨김 A", "숨김 B"),
      "숨김 A\n\n숨김 B"
    );
    const engineCreate = fs.readFileSync("src/lib/trpg/engineCreate.ts", "utf8");
    assert.match(engineCreate, /mergeGmPrivateNotes\(template\.secretContent, template\.scenarioPlan\?\.secret\)/);
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
    const plan = {
      ...emptyTrpgScenarioPlan(),
      startingSituation: "문 앞",
      goal: "탈출",
    };
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
