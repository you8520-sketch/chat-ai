import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL } from "@/lib/chatModels";
import {
  assertScenarioDraftRateLimit,
  buildScenarioDraftPromptContext,
  buildScenarioDraftSystemPrompt,
  buildScenarioDraftUserPrompt,
  computeScenarioDraftBudget,
  FULL_SCENARIO_TEXT_REQUIRED,
  makeDraftProvenance,
  mergeScenarioDraft,
  NO_WORLD_AI_DRAFT_ALLOWED,
  PARTIAL_REGEN_SPARSE,
  parseScenarioDraftJson,
  previewDraftOverwrite,
  RECOVERY_PATH_GUIDANCE,
  releaseScenarioDraftRateLimit,
  resetScenarioDraftRateLimitForTests,
  scenarioDraftOutputMaxTokens,
  scenarioDraftPrimaryTimeoutMs,
  STRUCTURED_PLAN_IS_PRIMARY,
  TRPG_SCENARIO_DRAFT_CONTEXT_LIMIT,
  TRPG_SCENARIO_DRAFT_CORE_FIELDS,
  TRPG_SCENARIO_DRAFT_CORE_OUTPUT_TOKENS,
  TRPG_SCENARIO_DRAFT_CORE_TIMEOUT_MS,
  TRPG_SCENARIO_DRAFT_FULL_TIMEOUT_MS,
  TRPG_SCENARIO_DRAFT_FULL_OUTPUT_TOKENS,
  TRPG_SCENARIO_DRAFT_MODEL,
  TRPG_SCENARIO_DRAFT_PRIMARY_TIMEOUT_MS,
  TRPG_SCENARIO_DRAFT_REPAIR_OUTPUT_TOKENS,
  TRPG_SCENARIO_DRAFT_REPAIR_TIMEOUT_MS,
  scenarioDraftRequestedFields,
} from "./scenarioDraft";
import {
  buildAuthoringRepairUser,
  buildTrpgScenarioDraftRequestBody,
  completeTrpgAuthoringJson,
  FORM_PRESERVED_ON_TIMEOUT,
  isTrpgAuthoringTimeoutError,
  REPAIR_IS_REWRITE,
  TrpgAuthoringTruncatedError,
  TRPG_AUTHORING_PROVIDER_RETRY,
  TRPG_SCENARIO_DRAFT_TIMEOUT_MESSAGE,
} from "./scenarioDraftCall";
import { emptyTrpgScenarioPlan, lintTrpgScenarioPlan } from "./scenarioPlan";
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
    const body = buildTrpgScenarioDraftRequestBody({
      system: "system",
      user: "user",
      maxTokens: 1800,
      temperature: 0.3,
    });
    assert.equal(body.model, TRPG_SCENARIO_DRAFT_MODEL);
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.reasoning_effort, "none");
    assert.equal(body.max_tokens, 1800);
    assert.deepEqual(body.response_format, { type: "json_object" });
  });

  it("parses JSON and forces NPC stats to null", () => {
    assert.equal(generated.npcs[0]?.name, "하린");
    assert.equal(generated.npcs[0]?.stats, null);
    assert.equal(generated.plan.difficulty, "hard");
  });

  it("repairs malformed JSON once, does not retry transport errors, and calls once for valid JSON", async () => {
    let malformedCalls = 0;
    const repairedUsers: string[] = [];
    const stages: Array<string | undefined> = [];
    const result = await completeTrpgAuthoringJson({
      kind: "scenario_draft",
      system: "sys",
      user: "user",
      expectedFields: ["title", "goal"],
      primaryMaxTokens: 1200,
      primaryTimeoutMs: 120_000,
      primaryTemperature: 0.3,
      repairMaxTokens: 900,
      repairTimeoutMs: 60_000,
      repairTemperature: 0,
      complete: async ({ user, stage, maxTokens, timeoutMs, temperature }) => {
        malformedCalls += 1;
        repairedUsers.push(user);
        stages.push(stage);
        if (stage === "primary") {
          assert.equal(maxTokens, 1200);
          assert.equal(timeoutMs, 120_000);
          assert.equal(temperature, 0.3);
        } else {
          assert.equal(maxTokens, 900);
          assert.equal(timeoutMs, 60_000);
          assert.equal(temperature, 0);
        }
        if (malformedCalls === 1) return { text: "not-json", latencyMs: 1, model: TRPG_SCENARIO_DRAFT_MODEL };
        return { text: JSON.stringify({ title: "고침", startingSituation: "시작", centralConflict: "갈등", goal: "목표", endingConditions: ["끝"] }), latencyMs: 1, model: TRPG_SCENARIO_DRAFT_MODEL };
      },
    });
    assert.equal(malformedCalls, 2);
    assert.equal(result.title, "고침");
    assert.match(repairedUsers[1] ?? "", /INVALID_OUTPUT/);
    assert.match(repairedUsers[1] ?? "", /not-json/);
    assert.match(repairedUsers[1] ?? "", /VALIDATION_ERROR/);
    assert.match(repairedUsers[1] ?? "", /EXPECTED_FIELDS: title,goal/);
    assert.doesNotMatch(repairedUsers[1] ?? "", /\bsys\b|\buser\b/);
    assert.deepEqual(stages, ["primary", "repair"]);

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

    let truncatedCalls = 0;
    await assert.rejects(
      () =>
        completeTrpgAuthoringJson({
          kind: "scenario_draft",
          system: "sys",
          user: "user",
          complete: async () => {
            truncatedCalls += 1;
            return {
              text: '{"title":"잘린',
              finishReason: "length",
              latencyMs: 1,
              model: TRPG_SCENARIO_DRAFT_MODEL,
            };
          },
        }),
      TrpgAuthoringTruncatedError
    );
    assert.equal(truncatedCalls, 1);

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

  it("clips prompt context deterministically with creator prose ahead of secret and world", () => {
    const context = buildScenarioDraftPromptContext({
      existingContent: "C".repeat(5_000),
      existingSecretContent: "S".repeat(2_000),
      worldSummary: "W".repeat(500),
      worldContent: "L".repeat(5_000),
    });
    assert.ok(context.existingContent.startsWith("C".repeat(100)));
    assert.ok(context.existingSecretContent.startsWith("S".repeat(100)));
    assert.equal(context.worldSummary, "");
    assert.equal(context.worldContent, "");
    assert.ok(
      context.existingContent.length +
        context.existingSecretContent.length +
        context.worldSummary.length +
        context.worldContent.length <=
        TRPG_SCENARIO_DRAFT_CONTEXT_LIMIT
    );
    assert.ok(context.clipped.existingSecretContent > 0);
    assert.equal(context.clipped.worldContent, 5_000);
  });

  it("shows existing content and secret to AI while clipping selected world independently of save budget", () => {
    const content = "창작자 전체 시나리오";
    const secretContent = "창작자 비밀 설정";
    const worldTail = "WORLD_TAIL_MUST_BE_CLIPPED";
    const worldContent = `${"세계".repeat(6_000)}${worldTail}`;
    const existing = { content, secretContent, plan: emptyTrpgScenarioPlan() };
    const budget = computeScenarioDraftBudget({
      worldSummary: "요약",
      worldContent,
      existing,
      mode: "fill_empty",
    });
    assert.equal(budget.remaining, 0);
    const prompt = buildScenarioDraftUserPrompt({
      worldName: "큰 세계",
      worldSummary: "요약",
      worldContent,
      worldSelected: true,
      mode: "fill_empty",
      existing,
    });
    assert.match(prompt, new RegExp(content));
    assert.match(prompt, new RegExp(secretContent));
    assert.doesNotMatch(prompt, new RegExp(worldTail));
    assert.ok(prompt.length < worldContent.length + 5_000);
  });

  it("allows a self-contained no-world prompt and keeps null provenance", () => {
    assert.equal(NO_WORLD_AI_DRAFT_ALLOWED, true);
    const prompt = buildScenarioDraftUserPrompt({
      worldName: "",
      worldSummary: "",
      worldContent: "",
      worldSelected: false,
      mode: "fill_empty",
      existing: { title: "고립된 역", content: "역 안의 생존자들이 구조 신호를 기다린다." },
    });
    assert.match(prompt, /연결된 별도 세계관 없음/);
    assert.match(prompt, /다른 저장 세계관을 참조하지 않는다/);
    assert.match(prompt, /고립된 역/);
    assert.match(prompt, /optional_fields_left_unchanged=.*forbiddenEvents/);
    assert.equal(makeDraftProvenance({ worldId: null }).sourceWorldId, null);
  });

  it("uses sparse operation budgets without turning full drafts into free-form novels", () => {
    assert.equal(PARTIAL_REGEN_SPARSE, true);
    assert.equal(STRUCTURED_PLAN_IS_PRIMARY, true);
    assert.equal(FULL_SCENARIO_TEXT_REQUIRED, false);
    assert.equal(
      scenarioDraftOutputMaxTokens({
        mode: "fill_empty",
        changingFields: previewDraftOverwrite({ mode: "fill_empty", existing: {} }),
      }),
      TRPG_SCENARIO_DRAFT_CORE_OUTPUT_TOKENS
    );
    assert.deepEqual(
      scenarioDraftRequestedFields({
        mode: "fill_empty",
        changingFields: previewDraftOverwrite({ mode: "fill_empty", existing: {} }),
      }),
      TRPG_SCENARIO_DRAFT_CORE_FIELDS
    );
    assert.equal(
      scenarioDraftOutputMaxTokens({ mode: "regenerate_selected", changingFields: ["boss"] }),
      900
    );
    assert.equal(
      scenarioDraftOutputMaxTokens({
        mode: "regenerate_selected",
        changingFields: ["npcs", "majorEvents"],
      }),
      1600
    );
    const prompt = buildScenarioDraftUserPrompt({
      worldName: "",
      worldSummary: "",
      worldContent: "",
      worldSelected: false,
      mode: "regenerate_selected",
      selectedFields: ["boss"],
      existing: { title: "유지", plan: { ...emptyTrpgScenarioPlan(), goal: "기존 목표" } },
    });
    assert.match(prompt, /fill_or_replace_fields=boss/);
    assert.match(prompt, /sparse JSON object/);
  });

  it("uses bounded primary/repair calls and a syntax-only repair prompt", () => {
    assert.equal(TRPG_AUTHORING_PROVIDER_RETRY, 0);
    assert.equal(TRPG_SCENARIO_DRAFT_PRIMARY_TIMEOUT_MS, 120_000);
    assert.equal(
      scenarioDraftPrimaryTimeoutMs({
        mode: "fill_empty",
        changingFields: previewDraftOverwrite({ mode: "fill_empty", existing: {} }),
      }),
      TRPG_SCENARIO_DRAFT_CORE_TIMEOUT_MS
    );
    assert.equal(
      scenarioDraftPrimaryTimeoutMs({
        mode: "regenerate_all",
        changingFields: previewDraftOverwrite({ mode: "regenerate_all", existing: {} }),
      }),
      TRPG_SCENARIO_DRAFT_FULL_TIMEOUT_MS
    );
    assert.equal(
      scenarioDraftPrimaryTimeoutMs({ mode: "regenerate_selected", changingFields: ["boss"] }),
      TRPG_SCENARIO_DRAFT_PRIMARY_TIMEOUT_MS
    );
    assert.ok(TRPG_SCENARIO_DRAFT_REPAIR_TIMEOUT_MS <= TRPG_SCENARIO_DRAFT_PRIMARY_TIMEOUT_MS);
    assert.ok(TRPG_SCENARIO_DRAFT_REPAIR_OUTPUT_TOKENS < TRPG_SCENARIO_DRAFT_FULL_OUTPUT_TOKENS);
    assert.equal(REPAIR_IS_REWRITE, false);
    const repair = buildAuthoringRepairUser('{"boss":', "invalid json", ["boss"]);
    assert.match(repair, /문법과 schema 형식만 정규화/);
    assert.match(repair, /EXPECTED_FIELDS: boss/);
    assert.doesNotMatch(repair, /WORLD_DATA|EXISTING_DRAFT/);
  });

  it("classifies timeout UX without clearing the scenario editor form", () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    assert.equal(isTrpgAuthoringTimeoutError(timeout), true);
    assert.match(TRPG_SCENARIO_DRAFT_TIMEOUT_MESSAGE, /작성 중인 내용은 그대로 보존/);
    assert.equal(FORM_PRESERVED_ON_TIMEOUT, true);
    const editor = readFileSync("src/app/trpg/TrpgScenarioEditor.tsx", "utf8");
    const route = readFileSync("src/app/api/trpg/scenarios/ai-draft/route.ts", "utf8");
    assert.match(editor, /세계관 분석 · 시나리오 구성 중/);
    assert.match(editor, /전체 시나리오 본문 \(선택 · 직접 추가 설정\)/);
    assert.doesNotMatch(editor, /AI 초안은 세계관을 선택한 뒤에/);
    assert.doesNotMatch(editor, /disabled=\{draftBusy \|\| typeof worldId !== "number"\}/);
    assert.match(route, /worldId == null \? null : loadWorldForTrpg/);
    assert.match(route, /code: "SCENARIO_DRAFT_TIMEOUT"/);
    assert.doesNotMatch(route, /세계관을 선택한 뒤 AI 초안을 만들 수 있습니다/);
  });

  it("adds a non-blocking recovery readiness warning without inventing healing magic", () => {
    assert.equal(RECOVERY_PATH_GUIDANCE, true);
    const basePlan = {
      ...emptyTrpgScenarioPlan(),
      startingSituation: "폐허에 도착한다.",
      centralConflict: "자원이 고갈된다.",
      goal: "생존자를 구한다.",
      endingConditions: ["생존자를 구한다."],
      difficulty: "normal" as const,
    };
    const warning = lintTrpgScenarioPlan({ plan: basePlan, startInventory: [] });
    assert.equal(warning.some((issue) => issue.code === "recovery_path_unclear" && issue.level === "warning"), true);
    const supplied = lintTrpgScenarioPlan({ plan: basePlan, startInventory: ["구급키트", "붕대"] });
    assert.equal(supplied.some((issue) => issue.code === "recovery_path_unclear"), false);
    const system = buildScenarioDraftSystemPrompt();
    assert.match(system, /Do not infer healing magic from a priest/);
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
