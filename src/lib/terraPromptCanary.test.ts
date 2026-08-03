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
  parseTerraPromptCanaryVariant,
  resolveCanaryGreeting,
  resolveTerraPromptCanary,
  TERRA_PROMPT_CANARY_ENV,
  TERRA_PROMPT_CANARY_GREETING_NEUTRAL,
  V1_SCENE_PROGRESS_SENTENCE_CANARY,
  V1_SCENE_PROGRESS_SENTENCE_PRODUCTION,
} from "@/lib/terraPromptCanary";
// resolveCanaryGreeting / TERRA_PROMPT_CANARY_GREETING_NEUTRAL already imported
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

    assert.equal(
      resolveTerraPromptCanary({
        userId: null,
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "character",
      }),
      null
    );
  });

  it("parseTerraPromptCanaryVariant falls back to baseline", () => {
    assert.equal(parseTerraPromptCanaryVariant(undefined), "baseline");
    assert.equal(parseTerraPromptCanaryVariant("nope"), "baseline");
    assert.equal(parseTerraPromptCanaryVariant("greeting_neutral"), "greeting_neutral");
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

    const history = [
      { role: "assistant" as const, content: staffGreeting },
      { role: "user" as const, content: "나는 렌" },
    ];
    const next = applyTerraPromptCanaryToHistory({
      history,
      canary,
      characterId: 18,
      productionGreeting: staffGreeting,
    });
    assert.equal(next[0]?.content, TERRA_PROMPT_CANARY_GREETING_NEUTRAL);
    assert.equal(next[1]?.content, "나는 렌");
  });

  it("scene_relation_priority replaces V1 progress sentence on early turns only", () => {
    process.env[TERRA_PROMPT_CANARY_ENV.ENABLED] = "true";
    process.env[TERRA_PROMPT_CANARY_ENV.USER_IDS] = "25";
    process.env[TERRA_PROMPT_CANARY_ENV.VARIANT] = "scene_relation_priority";
    const canary = resolveTerraPromptCanary({
      userId: 25,
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      contentKind: "character",
    });
    assert.ok(canary);

    const scene = renderSceneDirectiveForPrompt(
      buildSceneDirective({
        mode: "interactive",
        recentMessages: [],
        currentUserMessage: "같이갈래?",
      })
    );
    assert.ok(scene.includes(V1_SCENE_PROGRESS_SENTENCE_PRODUCTION));

    const early = applyTerraPromptCanaryToSceneDirectiveBlock({
      block: scene,
      canary,
      completedTurns: 0,
    });
    assert.ok(early.includes(V1_SCENE_PROGRESS_SENTENCE_CANARY));
    assert.ok(!early.includes(V1_SCENE_PROGRESS_SENTENCE_PRODUCTION));
    assert.equal(
      (early.match(/\[PRIVATE SCENE ENGINE RULE\]/g) ?? []).length,
      1
    );

    const late = applyTerraPromptCanaryToSceneDirectiveBlock({
      block: scene,
      canary,
      completedTurns: 5,
    });
    assert.equal(late, scene);
  });

  it("greeting_neutral_scene_relation_priority applies greeting + scene only", () => {
    process.env[TERRA_PROMPT_CANARY_ENV.ENABLED] = "true";
    process.env[TERRA_PROMPT_CANARY_ENV.USER_IDS] = "25";
    process.env[TERRA_PROMPT_CANARY_ENV.VARIANT] =
      "greeting_neutral_scene_relation_priority";
    const canary = resolveTerraPromptCanary({
      userId: 25,
      modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      contentKind: "character",
    });
    assert.ok(canary);
    const staffGreeting =
      '데스크 앞에 기대 선 그는 새로 발령받은 지원국 직원과 한창 실없는 농담을 주고받는 중이었다.\n\n“아니, 억울하다니까? 난 분명 보고서만 제출하면 끝인 줄 알았거든.';
    assert.equal(
      resolveCanaryGreeting({ canary, characterId: 18, greeting: staffGreeting }),
      TERRA_PROMPT_CANARY_GREETING_NEUTRAL
    );
    const scene = renderSceneDirectiveForPrompt(
      buildSceneDirective({
        mode: "interactive",
        recentMessages: [],
        currentUserMessage: "같이갈래?",
      })
    );
    const early = applyTerraPromptCanaryToSceneDirectiveBlock({
      block: scene,
      canary,
      completedTurns: 1,
    });
    assert.ok(early.includes(V1_SCENE_PROGRESS_SENTENCE_CANARY));
    assert.ok(!early.includes(V1_SCENE_PROGRESS_SENTENCE_PRODUCTION));
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
