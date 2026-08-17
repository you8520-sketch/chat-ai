import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL } from "@/lib/chatModels";
import {
  assertScenarioDraftRateLimit,
  mergeScenarioDraft,
  parseScenarioDraftJson,
  previewDraftOverwrite,
  releaseScenarioDraftRateLimit,
  resetScenarioDraftRateLimitForTests,
  TRPG_SCENARIO_DRAFT_MODEL,
} from "./scenarioDraft";
import { completeTrpgAuthoringJson } from "./scenarioDraftCall";
import { emptyTrpgScenarioPlan } from "./scenarioPlan";

const generated = parseScenarioDraftJson(
  JSON.stringify({
    title: "AI제목",
    summary: "공개 소개",
    startingSituation: "시작",
    centralConflict: "갈등",
    goal: "목표",
    secret: "비밀",
    endingConditions: ["끝"],
    majorEvents: ["사건"],
    clues: ["단서"],
    npcs: [{ name: "하린", description: "보급대장", greeting: "", systemPrompt: "", stats: { str: 9 } }],
    forbiddenEvents: [],
    boss: "",
    startLocation: "검문소",
    startInventory: ["손전등", "비상식량"],
    specialRules: [],
    difficulty: "hard",
    climax: "클라이맥스",
    endingCandidates: ["봉쇄"],
    factionChanges: [],
    gmDirection: "탐험",
    playLength: "long",
  })
);

describe("TRPG scenario AI draft", () => {
  it("uses the flash 0731 draft model constant", () => {
    assert.equal(TRPG_SCENARIO_DRAFT_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL);
  });

  it("parses JSON and forces NPC stats to null", () => {
    assert.equal(generated.npcs[0]?.name, "하린");
    assert.equal(generated.npcs[0]?.stats, null);
    assert.equal(generated.plan.difficulty, "hard");
  });

  it("repairs invalid JSON once and then fails", async () => {
    let calls = 0;
    const result = await completeTrpgAuthoringJson({
      kind: "scenario_draft",
      system: "sys",
      user: "user",
      complete: async () => {
        calls += 1;
        if (calls === 1) return { text: "not-json", latencyMs: 1, model: TRPG_SCENARIO_DRAFT_MODEL };
        return { text: JSON.stringify({ title: "고침", startingSituation: "시작", centralConflict: "갈등", goal: "목표", endingConditions: ["끝"] }), latencyMs: 1, model: TRPG_SCENARIO_DRAFT_MODEL };
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.title, "고침");

    await assert.rejects(
      () =>
        completeTrpgAuthoringJson({
          kind: "scenario_draft",
          system: "sys",
          user: "user",
          complete: async () => ({ text: "still-bad", latencyMs: 1, model: TRPG_SCENARIO_DRAFT_MODEL }),
        }),
      /JSON/
    );
  });

  it("keeps authored values in fill_empty and selected regenerate", () => {
    const existing = {
      title: "내 제목",
      summary: "내 요약",
      startLocation: "내 장소",
      startInventory: ["낡은칼"],
      npcs: [],
      plan: {
        ...emptyTrpgScenarioPlan(),
        startingSituation: "내가 쓴 시작",
        centralConflict: "",
        goal: "내가 쓴 목표",
      },
    };
    assert.deepEqual(
      previewDraftOverwrite({ mode: "fill_empty", existing }),
      previewDraftOverwrite({ mode: "fill_empty", existing }).filter((field) => field !== "title")
    );
    const filled = mergeScenarioDraft({ mode: "fill_empty", existing, generated });
    assert.equal(filled.title, "내 제목");
    assert.equal(filled.plan.startingSituation, "내가 쓴 시작");
    assert.equal(filled.plan.centralConflict, "갈등");
    assert.equal(filled.plan.goal, "내가 쓴 목표");

    const selected = mergeScenarioDraft({
      mode: "regenerate_selected",
      existing,
      generated,
      selectedFields: ["climax"],
    });
    assert.equal(selected.plan.startingSituation, "내가 쓴 시작");
    assert.equal(selected.plan.climax, "클라이맥스");

    const locked = mergeScenarioDraft({
      mode: "regenerate_all",
      existing,
      generated,
      lockedFields: ["title", "startingSituation"],
    });
    assert.equal(locked.title, "내 제목");
    assert.equal(locked.plan.startingSituation, "내가 쓴 시작");
    assert.equal(locked.plan.goal, "목표");
  });

  it("blocks overlapping draft requests", () => {
    resetScenarioDraftRateLimitForTests();
    assertScenarioDraftRateLimit(9);
    assert.throws(() => assertScenarioDraftRateLimit(9), /이미 시나리오 초안/);
    releaseScenarioDraftRateLimit(9, false);
    assert.throws(() => assertScenarioDraftRateLimit(9), /잠시 뒤에/);
    resetScenarioDraftRateLimitForTests();
  });
});
