import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { mergeScenarioDraft } from "./scenarioDraft";
import {
  emptyTrpgScenarioPlan,
  hasLegacyAdvancedPlanFields,
  type TrpgScenarioPlan,
} from "./scenarioPlan";
import {
  insertScenarioTemplate,
  loadScenarioTemplate,
  rowToScenarioTemplate,
  updateScenarioTemplate,
} from "./scenarioTemplates";
import { ensureTrpgTables } from "./schema";

const EDITOR_SOURCE = fs.readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");

const HUMAN_STORY_FIELDS = [
  "title",
  "summary",
  "startingSituation",
  "goal",
  "secretContent",
] as const;

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function legacyRichPlan(): TrpgScenarioPlan {
  return {
    ...emptyTrpgScenarioPlan(),
    startingSituation: "시작 A",
    goal: "목표 B",
    centralConflict: "갈등 X",
    endingConditions: ["종료 D"],
    majorEvents: ["사건 A", "사건 B"],
    clues: ["단서 C"],
    secret: "옛 GM 비밀",
    climax: "클라이맥스",
  };
}

describe("TRPG human authoring surface", () => {
  it("NEW_SCENARIO_VISIBLE_STORY_FIELD_SET_EXACTLY_MATCHES_BASIC_CONTRACT", () => {
    for (const field of HUMAN_STORY_FIELDS) {
      assert.match(EDITOR_SOURCE, new RegExp(`data-scenario-field="${field}"`));
    }
  });

  it("NO_ADVANCED_DISCLOSURE_IN_NEW_SCENARIO", () => {
    assert.doesNotMatch(EDITOR_SOURCE, /data-scenario-story-details/);
    assert.doesNotMatch(EDITOR_SOURCE, /고급 설정/);
    assert.doesNotMatch(EDITOR_SOURCE, /storyDetailsOpen/);
  });

  for (const [name, pattern] of [
    ["NO_LEGACY_SECRET_FIELD_VISIBLE", /plan\.secret|GM 비공개/],
    ["NO_CENTRAL_CONFLICT_FIELD_VISIBLE", /data-scenario-field="centralConflict"/],
    ["NO_ENDING_CONDITIONS_FIELD_VISIBLE", /data-scenario-field="endingConditions"/],
    ["NO_MAJOR_EVENTS_FIELD_VISIBLE", /data-scenario-field="majorEvents"/],
    ["NO_CLUES_FIELD_VISIBLE", /data-scenario-field="clues"/],
    ["NO_SEPARATE_HUMAN_PLAN_BOSS_FIELD", /핵심 적 \/ 보스|patchPlan\(\{ boss:/],
  ] as const) {
    it(name, () => {
      assert.doesNotMatch(EDITOR_SOURCE, pattern);
    });
  }

  it("HIDDEN_STRUCTURED_PLAN_SURVIVES_BASIC_EDIT", () => {
    const db = memoryDb();
    const plan = legacyRichPlan();
    const id = insertScenarioTemplate(db, 1, {
      title: "테스트",
      content: "",
      scenarioPlan: plan,
    });
    updateScenarioTemplate(db, id, 1, {
      title: "테스트",
      content: "",
      scenarioPlan: { ...plan, goal: "목표 B2" },
    });
    const template = rowToScenarioTemplate(loadScenarioTemplate(db, id)!, { includeSecret: true });
    assert.equal(template.scenarioPlan?.goal, "목표 B2");
    assert.equal(template.scenarioPlan?.centralConflict, "갈등 X");
    assert.deepEqual(template.scenarioPlan?.majorEvents, ["사건 A", "사건 B"]);
    assert.deepEqual(template.scenarioPlan?.clues, ["단서 C"]);
    assert.deepEqual(template.scenarioPlan?.endingConditions, ["종료 D"]);
    db.close();
  });

  it("AI_DRAFT_STRUCTURED_PLAN_SURVIVES_BASIC_EDIT", () => {
    const existingPlan = {
      ...emptyTrpgScenarioPlan(),
      startingSituation: "기존 시작",
      goal: "기존 목표",
    };
    const generatedPlan = {
      ...emptyTrpgScenarioPlan(),
      startingSituation: "AI 시작",
      goal: "AI 목표",
      centralConflict: "AI 갈등",
      majorEvents: ["AI 사건"],
      clues: ["AI 단서"],
      endingConditions: ["AI 종료"],
    };
    const merged = mergeScenarioDraft({
      mode: "fill_empty",
      existing: {
        title: "기존",
        summary: "",
        plan: existingPlan,
      },
      generated: {
        title: "AI 제목",
        summary: "AI 소개",
        startLocation: "",
        startInventory: [],
        npcs: [],
        plan: generatedPlan,
      },
    });
    assert.equal(merged.plan.centralConflict, "AI 갈등");
    assert.deepEqual(merged.plan.majorEvents, ["AI 사건"]);
    const db = memoryDb();
    const id = insertScenarioTemplate(db, 1, {
      title: merged.title,
      summary: merged.summary,
      content: "",
      scenarioPlan: merged.plan,
    });
    updateScenarioTemplate(db, id, 1, {
      title: merged.title,
      summary: merged.summary,
      content: "",
      scenarioPlan: { ...merged.plan, goal: "수정 목표" },
    });
    const after = rowToScenarioTemplate(loadScenarioTemplate(db, id)!, { includeSecret: true });
    assert.equal(after.scenarioPlan?.goal, "수정 목표");
    assert.equal(after.scenarioPlan?.centralConflict, "AI 갈등");
    assert.deepEqual(after.scenarioPlan?.majorEvents, ["AI 사건"]);
    db.close();
  });

  it("LEGACY_PLAN_DATA_NOT_DELETED", () => {
    const plan = legacyRichPlan();
    assert.equal(hasLegacyAdvancedPlanFields(plan), true);
    const db = memoryDb();
    const id = insertScenarioTemplate(db, 1, {
      title: "레거시",
      content: "본문",
      scenarioPlan: plan,
    });
    const stored = rowToScenarioTemplate(loadScenarioTemplate(db, id)!, { includeSecret: true });
    assert.equal(stored.scenarioPlan?.centralConflict, "갈등 X");
    assert.deepEqual(stored.scenarioPlan?.endingConditions, ["종료 D"]);
    db.close();
  });
});
