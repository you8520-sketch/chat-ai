import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL } from "@/lib/chatModels";
import {
  assertScenarioDraftRateLimit,
  buildScenarioDraftUserPrompt,
  computeScenarioDraftBudget,
  mergeScenarioDraft,
  parseScenarioDraftJson,
  previewDraftOverwrite,
  releaseScenarioDraftRateLimit,
  resetScenarioDraftRateLimitForTests,
  TRPG_SCENARIO_DRAFT_MODEL,
} from "./scenarioDraft";
import { completeTrpgAuthoringJson } from "./scenarioDraftCall";
import { emptyTrpgScenarioPlan } from "./scenarioPlan";
import { TRPG_SCENARIO_BUNDLE_LIMIT } from "./scenarioTypes";

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

  it("repairs malformed JSON once, does not retry transport errors, and calls once for valid JSON", async () => {
    let malformedCalls = 0;
    const repairedUsers: string[] = [];
    const result = await completeTrpgAuthoringJson({
      kind: "scenario_draft",
      system: "sys",
      user: "user",
      complete: async ({ user }) => {
        malformedCalls += 1;
        repairedUsers.push(user);
        if (malformedCalls === 1) return { text: "not-json", latencyMs: 1, model: TRPG_SCENARIO_DRAFT_MODEL };
        return { text: JSON.stringify({ title: "고침", startingSituation: "시작", centralConflict: "갈등", goal: "목표", endingConditions: ["끝"] }), latencyMs: 1, model: TRPG_SCENARIO_DRAFT_MODEL };
      },
    });
    assert.equal(malformedCalls, 2);
    assert.equal(result.title, "고침");
    assert.match(repairedUsers[1] ?? "", /INVALID_OUTPUT/);
    assert.match(repairedUsers[1] ?? "", /not-json/);
    assert.match(repairedUsers[1] ?? "", /VALIDATION_ERROR/);

    let transportCalls = 0;
    await assert.rejects(
      () =>
        completeTrpgAuthoringJson({
          kind: "scenario_draft",
          system: "sys",
          user: "user",
          complete: async () => {
            transportCalls += 1;
            throw new Error("ECONNRESET timeout");
          },
        }),
      /ECONNRESET/
    );
    assert.equal(transportCalls, 1);

    let validCalls = 0;
    await completeTrpgAuthoringJson({
      kind: "scenario_draft",
      system: "sys",
      user: "user",
      complete: async () => {
        validCalls += 1;
        return {
          text: JSON.stringify({
            title: "한 번",
            startingSituation: "시작",
            centralConflict: "갈등",
            goal: "목표",
            endingConditions: ["끝"],
          }),
          latencyMs: 1,
          model: TRPG_SCENARIO_DRAFT_MODEL,
        };
      },
    });
    assert.equal(validCalls, 1);

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

  it("treats untouched normal/medium as empty but keeps touched or locked enums", () => {
    const untouched = {
      plan: emptyTrpgScenarioPlan(),
    };
    assert.equal(previewDraftOverwrite({ mode: "fill_empty", existing: untouched }).includes("difficulty"), true);
    assert.equal(previewDraftOverwrite({ mode: "fill_empty", existing: untouched }).includes("playLength"), true);
    const filled = mergeScenarioDraft({ mode: "fill_empty", existing: untouched, generated });
    assert.equal(filled.plan.difficulty, "hard");
    assert.equal(filled.plan.playLength, "long");

    const touched = mergeScenarioDraft({
      mode: "fill_empty",
      existing: { plan: emptyTrpgScenarioPlan(), touchedFields: ["difficulty", "playLength"] },
      generated,
    });
    assert.equal(touched.plan.difficulty, "normal");
    assert.equal(touched.plan.playLength, "medium");

    const locked = mergeScenarioDraft({
      mode: "regenerate_all",
      existing: { plan: { ...emptyTrpgScenarioPlan(), difficulty: "normal", playLength: "medium" } },
      generated,
      lockedFields: ["difficulty", "playLength"],
    });
    assert.equal(locked.plan.difficulty, "normal");
    assert.equal(locked.plan.playLength, "medium");

    const easyGenerated = parseScenarioDraftJson(
      JSON.stringify({
        title: "AI제목",
        summary: "공개 소개",
        startingSituation: "시작",
        centralConflict: "갈등",
        goal: "목표",
        endingConditions: ["끝"],
        difficulty: "easy",
        playLength: "short",
      })
    );
    const authoredEnums = mergeScenarioDraft({
      mode: "fill_empty",
      existing: { plan: { ...emptyTrpgScenarioPlan(), difficulty: "hard", playLength: "long" } },
      generated: easyGenerated,
    });
    assert.equal(authoredEnums.plan.difficulty, "hard");
    assert.equal(authoredEnums.plan.playLength, "long");
  });

  it("puts a remaining bundle budget hint in the draft prompt without changing the save limit", () => {
    const worldContent = "한".repeat(8000);
    const existing = { plan: emptyTrpgScenarioPlan() };
    const budget = computeScenarioDraftBudget({
      worldSummary: "요약",
      worldContent,
      existing,
      mode: "fill_empty",
    });
    assert.equal(budget.limit, TRPG_SCENARIO_BUNDLE_LIMIT);
    assert.equal(TRPG_SCENARIO_BUNDLE_LIMIT, 10000);
    assert.ok(budget.remaining < 2500);
    assert.equal(budget.used + budget.remaining, budget.limit);
    const prompt = buildScenarioDraftUserPrompt({
      worldName: "북부",
      worldSummary: "요약",
      worldContent,
      mode: "fill_empty",
      existing,
    });
    assert.match(prompt, /available_text_budget≈/);
    assert.match(prompt, new RegExp(String(budget.remaining)));
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
