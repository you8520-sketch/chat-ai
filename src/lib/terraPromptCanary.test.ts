import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import { CHEAPER_INFERENCE_GPT_56_TERRA_MODEL } from "@/lib/chatModels";
import { buildSceneDirective, renderSceneDirectiveForPrompt } from "@/lib/sceneDirective";
import {
  applyTerraPromptCanaryToHistory,
  applyTerraPromptCanaryToSceneDirectiveBlock,
  DIALOGUE_LAYOUT_OWNER_KO_CANARY,
  DIALOGUE_LAYOUT_OWNER_KO_PRODUCTION,
  isLikeSupportStaffGreeting,
  lockSceneDirectiveToRelationshipAxis,
  parseTerraPromptCanaryVariant,
  resolveCanaryGreeting,
  resolveCanarySceneProgressionAxis,
  resolveTerraPromptCanary,
  resolveTerraPromptCanaryTemperature,
  shouldRelocateSceneDirectiveToUserTurn,
  TERRA_PROMPT_CANARY_ENV,
  TERRA_PROMPT_CANARY_GREETING_NEUTRAL,
  V1_SCENE_PROGRESS_SENTENCE_PRODUCTION,
  V1_SCENE_PROGRESS_SENTENCE_RELATIONSHIP_AXIS,
} from "@/lib/terraPromptCanary";
import { buildWebnovelOutputLayoutRecencyBlock } from "@/lib/webnovelOutputFormat";

const ENV_KEYS = Object.values(TERRA_PROMPT_CANARY_ENV);

describe("terraPromptCanary", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("defaults OFF — resolve returns null without env", () => {
    assert.equal(
      resolveTerraPromptCanary({
        userId: 25,
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "character",
      }),
      null
    );
  });

  it("requires enabled + allowlist + terra + single_primary", () => {
    process.env[TERRA_PROMPT_CANARY_ENV.ENABLED] = "true";
    process.env[TERRA_PROMPT_CANARY_ENV.USER_IDS] = "25";
    process.env[TERRA_PROMPT_CANARY_ENV.VARIANT] = "baseline";

    assert.equal(
      resolveTerraPromptCanary({
        userId: 25,
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "character",
      })?.variant,
      "baseline"
    );

    assert.equal(
      resolveTerraPromptCanary({
        userId: 99,
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "character",
      }),
      null
    );

    assert.equal(
      resolveTerraPromptCanary({
        userId: 25,
        modelId: "deepseek-v4-pro",
        contentKind: "character",
      }),
      null
    );

    assert.equal(
      resolveTerraPromptCanary({
        userId: 25,
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "simulation",
      }),
      null
    );
  });

  it("parseTerraPromptCanaryVariant falls back to baseline", () => {
    assert.equal(parseTerraPromptCanaryVariant(undefined), "baseline");
    assert.equal(parseTerraPromptCanaryVariant("nope"), "baseline");
    assert.equal(parseTerraPromptCanaryVariant("greeting_neutral"), "greeting_neutral");
    assert.equal(
      parseTerraPromptCanaryVariant("greeting_neutral_relationship_axis"),
      "greeting_neutral_relationship_axis"
    );
  });

  it("baseline / inactive leave scene + layout + greeting unchanged", () => {
    process.env[TERRA_PROMPT_CANARY_ENV.ENABLED] = "true";
    process.env[TERRA_PROMPT_CANARY_ENV.USER_IDS] = "25";
    process.env[TERRA_PROMPT_CANARY_ENV.VARIANT] = "baseline";
    const canary = resolveTerraPromptCanary({
      userId: 25,
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      contentKind: "character",
    });
    assert.ok(canary);

    const staffGreeting =
      '데스크 앞에 기대 선 그는 새로 발령받은 지원국 직원과 한창 실없는 농담을 주고받는 중이었다.\n\n“아니, 억울하다니까? 난 분명 보고서만 제출하면 끝인 줄 알았거든.';
    assert.equal(isLikeSupportStaffGreeting(staffGreeting), true);
    assert.equal(
      resolveCanaryGreeting({ canary, characterId: 18, greeting: staffGreeting }),
      staffGreeting
    );

    const history = [{ role: "assistant" as const, content: staffGreeting }];
    assert.equal(
      applyTerraPromptCanaryToHistory({
        history,
        canary,
        characterId: 18,
        productionGreeting: staffGreeting,
      }),
      history
    );

    const scene = renderSceneDirectiveForPrompt(
      buildSceneDirective({
        mode: "interactive",
        recentMessages: [],
        currentUserMessage: "나는 렌이라고 부르면 돼",
      })
    );
    assert.ok(scene.includes(V1_SCENE_PROGRESS_SENTENCE_PRODUCTION));
    assert.equal(
      applyTerraPromptCanaryToSceneDirectiveBlock({
        block: scene,
        canary,
        completedTurns: 0,
      }),
      scene
    );

    const layout = buildWebnovelOutputLayoutRecencyBlock();
    assert.equal(buildWebnovelOutputLayoutRecencyBlock({ dialogueIntentUnit: false }), layout);
    assert.match(layout, new RegExp(DIALOGUE_LAYOUT_OWNER_KO_PRODUCTION));
  });

  it("greeting_neutral replaces Like staff greeting only", () => {
    process.env[TERRA_PROMPT_CANARY_ENV.ENABLED] = "true";
    process.env[TERRA_PROMPT_CANARY_ENV.USER_IDS] = "25";
    process.env[TERRA_PROMPT_CANARY_ENV.VARIANT] = "greeting_neutral";
    const canary = resolveTerraPromptCanary({
      userId: 25,
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      contentKind: "character",
    });
    assert.ok(canary);

    const staffGreeting =
      '데스크 앞에 기대 선 그는 새로 발령받은 지원국 직원과 한창 실없는 농담을 주고받는 중이었다.\n\n“아니, 억울하다니까? 난 분명 보고서만 제출하면 끝인 줄 알았거든.';
    const otherGreeting = "밥 먹자~! 다들 식탁으로 모여!";

    assert.equal(
      resolveCanaryGreeting({ canary, characterId: 18, greeting: staffGreeting }),
      TERRA_PROMPT_CANARY_GREETING_NEUTRAL
    );
    assert.equal(
      resolveCanaryGreeting({ canary, characterId: 7, greeting: otherGreeting }),
      otherGreeting
    );
    assert.ok(!TERRA_PROMPT_CANARY_GREETING_NEUTRAL.includes("보고서만 제출"));
    assert.ok(!TERRA_PROMPT_CANARY_GREETING_NEUTRAL.includes("직원이 웃음을"));
    assert.ok(TERRA_PROMPT_CANARY_GREETING_NEUTRAL.includes("이름이 뭐였더라?"));
  });

  it("greeting_neutral_relationship_axis locks relationship progression", () => {
    process.env[TERRA_PROMPT_CANARY_ENV.ENABLED] = "true";
    process.env[TERRA_PROMPT_CANARY_ENV.USER_IDS] = "25";
    process.env[TERRA_PROMPT_CANARY_ENV.VARIANT] =
      "greeting_neutral_relationship_axis";
    const canary = resolveTerraPromptCanary({
      userId: 25,
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      contentKind: "character",
    });
    assert.ok(canary);

    const axis = resolveCanarySceneProgressionAxis({
      canary,
      completedTurns: 0,
      contentKind: "character",
      userMessage: "나는 렌이라고 부르면 돼....나는 본기억이 안나는데....나 알아?(갸웃)",
      recentMessages: [],
    });
    assert.equal(axis, "relationship");
    assert.equal(shouldRelocateSceneDirectiveToUserTurn(canary, axis), true);

    const built = buildSceneDirective({
      mode: "interactive",
      recentMessages: [],
      currentUserMessage: "같이갈래?",
      contentKind: "character",
      primaryCharacterName: "라이크",
    });
    const locked = lockSceneDirectiveToRelationshipAxis(built);
    assert.deepEqual(locked.progressionTypes, ["relationship"]);

    const rendered = renderSceneDirectiveForPrompt(locked);
    assert.ok(rendered.includes(V1_SCENE_PROGRESS_SENTENCE_PRODUCTION));
    assert.ok(rendered.includes("전개 방향: 관계 변화"));

    const canaryBlock = applyTerraPromptCanaryToSceneDirectiveBlock({
      block: rendered,
      canary,
      completedTurns: 1,
      progressionAxis: axis,
    });
    assert.ok(canaryBlock.includes(V1_SCENE_PROGRESS_SENTENCE_RELATIONSHIP_AXIS));
    assert.ok(!canaryBlock.includes(V1_SCENE_PROGRESS_SENTENCE_PRODUCTION));
    assert.equal(
      (canaryBlock.match(/\[PRIVATE SCENE ENGINE RULE\]/g) ?? []).length,
      1
    );
  });

  it("relationship axis declines combat / procedure / active external history", () => {
    process.env[TERRA_PROMPT_CANARY_ENV.ENABLED] = "true";
    process.env[TERRA_PROMPT_CANARY_ENV.USER_IDS] = "25";
    process.env[TERRA_PROMPT_CANARY_ENV.VARIANT] =
      "greeting_neutral_relationship_axis";
    const canary = resolveTerraPromptCanary({
      userId: 25,
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      contentKind: "character",
    });
    assert.ok(canary);

    assert.equal(
      resolveCanarySceneProgressionAxis({
        canary,
        completedTurns: 0,
        contentKind: "character",
        userMessage: "적이 추격해와! 도망쳐!",
        recentMessages: [],
      }),
      null
    );

    assert.equal(
      resolveCanarySceneProgressionAxis({
        canary,
        completedTurns: 0,
        contentKind: "character",
        userMessage: "직원님 등록 좀 해주세요",
        recentMessages: [],
      }),
      null
    );

    assert.equal(
      resolveCanarySceneProgressionAxis({
        canary,
        completedTurns: 1,
        contentKind: "character",
        userMessage: "같이갈래?",
        recentMessages: [
          {
            role: "assistant",
            content:
              "직원이 말했다. “임시 등록과 신원 대조를 진행하겠습니다. 확인실로 안내드릴게요.”",
          },
        ],
      }),
      null
    );
  });

  it("temperature override is canary-only and optional", () => {
    process.env[TERRA_PROMPT_CANARY_ENV.ENABLED] = "true";
    process.env[TERRA_PROMPT_CANARY_ENV.USER_IDS] = "25";
    process.env[TERRA_PROMPT_CANARY_ENV.VARIANT] =
      "greeting_neutral_relationship_axis";
    const canary = resolveTerraPromptCanary({
      userId: 25,
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      contentKind: "character",
    });
    assert.ok(canary);
    assert.equal(resolveTerraPromptCanaryTemperature(canary), null);
    process.env[TERRA_PROMPT_CANARY_ENV.TEMPERATURE] = "0.4";
    assert.equal(resolveTerraPromptCanaryTemperature(canary), 0.4);
    process.env[TERRA_PROMPT_CANARY_ENV.TEMPERATURE] = "0.7";
    assert.equal(resolveTerraPromptCanaryTemperature(canary), 0.7);
    assert.equal(resolveTerraPromptCanaryTemperature(null), null);
  });

  it("dialogue_intent_unit swaps layout owner strings only", () => {
    const production = buildWebnovelOutputLayoutRecencyBlock();
    const canaryLayout = buildWebnovelOutputLayoutRecencyBlock({
      dialogueIntentUnit: true,
    });
    assert.notEqual(production, canaryLayout);
    assert.match(production, new RegExp(DIALOGUE_LAYOUT_OWNER_KO_PRODUCTION));
    assert.doesNotMatch(production, /발화 의도 단위/);
    assert.ok(canaryLayout.includes(DIALOGUE_LAYOUT_OWNER_KO_CANARY));
    assert.ok(!canaryLayout.includes(DIALOGUE_LAYOUT_OWNER_KO_PRODUCTION));
    assert.doesNotMatch(canaryLayout, /대사 블록 수/);
    assert.doesNotMatch(canaryLayout, /서술 80%/);
  });
});
