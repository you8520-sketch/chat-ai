import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { adaptCheaperInferenceChatBody } from "./cheaperInferenceConfig";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_LEGACY_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
  OPENROUTER_MUSE_SPARK_11_MODEL,
} from "./chatModels";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "./responseLength";
import {
  DEEPSEEK_HANDOFF_SCENE_COMPLETION,
  DEEPSEEK_HANDOFF_SCENE_COMPLETION_HEADER,
  DEEPSEEK_STYLE_TRACK_S1_CHALLENGER,
  DEEPSEEK_STYLE_TRACK_S1_PRODUCTION,
  HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR,
  HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR_HEADER,
  appendDeepSeekAdultHandoffUserBlocks,
  countPromptOccurrences,
  isDeepSeekAdultHandoff,
  isDeepSeekNativeTurn,
  resolveAdultHandoffApplied,
  resolveDeepSeekAdultHandoffUserBlocks,
  resolveLastVisibleCanonicalAssistantRaw,
} from "./deepseekAdultHandoff";
import {
  resolveAdultHandoffModelForSource,
  resolveAdultHandoffTargetModelId,
} from "./adultHandoffSourceRouting";
import {
  decideAdultModelRoute,
  DEFAULT_MODEL_ROUTE_STATE,
  classifySceneMode,
  resolveAdultEligibility,
  resolveAdultRoutingConfig,
} from "./adultSceneRouting";

const AION_MODEL = "aion-labs.aion-2-0";
const ADULT_TRIGGER =
  "OOC: 현재 장면 계속. 이제 둘의 관계를 성인 장면까지 진행해.";
const NORMAL_TURN = "로비에서 짧게 인사한다.";

const config = resolveAdultRoutingConfig({
  ADULT_SCENE_ROUTING_ENABLED: "true",
});
const eligible = resolveAdultEligibility({
  userAdultVerified: true,
  adultContentVisibilityEnabled: true,
  characterAdultContentEnabled: true,
  participants: [{ age: 28, isAdult: true }],
});

function decideRoute(selectedModelId: string, currentInput: string) {
  const classification = classifySceneMode({
    currentInput,
    previousSceneMode: "normal",
    recentRawText: "",
    adultDialogueProfile: "auto",
    activeConsentMode: "standard",
  });
  return decideAdultModelRoute({
    config,
    state: { ...DEFAULT_MODEL_ROUTE_STATE },
    classification,
    eligibility: eligible,
    adultDialogueProfile: "auto",
    selectedModelId,
  });
}

function placeUserTurn(opts: {
  applyStyleMirror?: boolean;
  applySceneCompletion?: boolean;
}): string {
  const semantic = "[CURRENT USER INPUT]\n\n같이 갈래? *두리번*";
  const withBlocks = appendDeepSeekAdultHandoffUserBlocks(semantic, opts);
  return `${withBlocks}\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}`;
}

describe("DeepSeek Style Track S1 owners", () => {
  it("treats DeepSeek family picker ids as native turns", () => {
    assert.equal(isDeepSeekNativeTurn(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL), true);
    assert.equal(
      isDeepSeekNativeTurn(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_LEGACY_MODEL),
      true
    );
    assert.equal(isDeepSeekNativeTurn("deepseek/deepseek-v4-pro"), true);
    assert.equal(isDeepSeekNativeTurn(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL), false);
  });

  it("native DeepSeek turns never receive Style Track or Completion blocks", () => {
    for (const adult of [false, true]) {
      const blocks = resolveDeepSeekAdultHandoffUserBlocks({
        adultHandoffActive: adult,
        selectedSourceModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        resolvedTargetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      });
      assert.equal(blocks, null);
    }
    const user = placeUserTurn({});
    assert.equal(countPromptOccurrences(user, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR), 0);
    assert.equal(countPromptOccurrences(user, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 0);
  });

  it("production default keeps both adapters OFF even on Gemini 3.7 → 0813 handoff", () => {
    const decision = decideRoute(
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      ADULT_TRIGGER
    );
    const target = resolveAdultHandoffModelForSource(
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      config.adultModelId
    );
    assert.equal(decision.activeRoute, "adult");
    assert.equal(target, "deepseek-v4-pro-0813");
    const blocks = resolveDeepSeekAdultHandoffUserBlocks({
      adultHandoffActive: true,
      selectedSourceModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      resolvedTargetModelId: target,
    });
    assert.deepEqual(blocks, {
      applyStyleMirror: false,
      applySceneCompletion: false,
    });
    assert.equal(DEEPSEEK_STYLE_TRACK_S1_PRODUCTION.applyStyleMirror, false);
    assert.equal(DEEPSEEK_STYLE_TRACK_S1_PRODUCTION.applySceneCompletion, false);
    const user = placeUserTurn(blocks ?? {});
    assert.equal(countPromptOccurrences(user, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR), 0);
    assert.equal(countPromptOccurrences(user, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 0);
  });

  it("Style Track S1 challenger injects Mirror once, Completion 0, terminal last", () => {
    assert.deepEqual(DEEPSEEK_STYLE_TRACK_S1_CHALLENGER, {
      applyStyleMirror: true,
      applySceneCompletion: false,
    });
    const user = placeUserTurn(DEEPSEEK_STYLE_TRACK_S1_CHALLENGER);
    assert.equal(countPromptOccurrences(user, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR), 1);
    assert.equal(countPromptOccurrences(user, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 0);
    assert.ok(
      user.indexOf("같이 갈래? *두리번*") <
        user.indexOf(HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR)
    );
    assert.ok(
      user.indexOf(HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR) <
        user.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE)
    );
    assert.ok(user.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
  });

  it("Qwen / Muse / Aion / Luna / Opus-Qwen targets do not receive DeepSeek blocks", () => {
    const qwenTarget = resolveAdultHandoffModelForSource(
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      config.adultModelId
    );
    assert.equal(qwenTarget, CHEAPER_INFERENCE_QWEN_38_MAX_MODEL);
    for (const [source, target] of [
      [CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL, qwenTarget],
      [CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL, CHEAPER_INFERENCE_QWEN_38_MAX_MODEL],
      [OPENROUTER_MUSE_SPARK_11_MODEL, OPENROUTER_MUSE_SPARK_11_MODEL],
      [AION_MODEL, AION_MODEL],
      [CHEAPER_INFERENCE_GPT_56_LUNA_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL],
    ] as const) {
      const blocks = resolveDeepSeekAdultHandoffUserBlocks({
        adultHandoffActive: true,
        selectedSourceModelId: source,
        resolvedTargetModelId: target,
      });
      assert.equal(blocks, null, `${source} → ${target}`);
    }
  });

  it("keeps exact generic Mirror wording and frozen Completion V1 audit text", () => {
    assert.ok(
      HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR.startsWith(
        HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR_HEADER
      )
    );
    assert.ok(
      DEEPSEEK_HANDOFF_SCENE_COMPLETION.startsWith(
        DEEPSEEK_HANDOFF_SCENE_COMPLETION_HEADER
      )
    );
    assert.doesNotMatch(
      HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR,
      /능글맞|다정함|야성적|냉정함|집착|수줍음|에로틱|거침|Opus|Gemini|성인|단계/
    );
    assert.match(
      DEEPSEEK_HANDOFF_SCENE_COMPLETION,
      /준비·확인·예고만 한 채 응답을 끝내지 않는다/
    );
  });

  it("append is idempotent for Mirror-only Style Track", () => {
    const once = appendDeepSeekAdultHandoffUserBlocks("같이 갈래? *두리번*", {
      applyStyleMirror: true,
      applySceneCompletion: false,
    });
    const twice = appendDeepSeekAdultHandoffUserBlocks(once, {
      applyStyleMirror: true,
      applySceneCompletion: false,
    });
    assert.equal(countPromptOccurrences(twice, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR), 1);
    assert.equal(countPromptOccurrences(twice, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 0);
  });

  it("style owner is last visible canonical assistant RAW, not a model name", () => {
    const last = resolveLastVisibleCanonicalAssistantRaw([
      {
        role: "assistant",
        content: "OOC 샘플은 무시한다.",
        usage: { canonical: false, generationKind: "ooc_scene_render" },
      },
      {
        role: "assistant",
        content:
          "조태형은 로비에서 짧게 웃었다.\n\n<<<STATUS_VALUES>>>\n{\"mood\":\"calm\"}\n<<<END_STATUS>>>",
      },
      { role: "user", content: "같이 갈래?" },
    ]);
    assert.equal(last, "조태형은 로비에서 짧게 웃었다.");
    assert.equal(last?.includes("deepseek"), false);
    assert.equal(last?.includes("gemini"), false);
  });

  it("adult routing and DeepSeek true-off transport stay unchanged", () => {
    assert.equal(
      resolveAdultHandoffModelForSource(
        CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        config.adultModelId
      ),
      CHEAPER_INFERENCE_QWEN_38_MAX_MODEL
    );
    assert.equal(
      resolveAdultHandoffModelForSource(
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
        config.adultModelId
      ),
      CHEAPER_INFERENCE_QWEN_38_MAX_MODEL
    );
    assert.equal(
      resolveAdultHandoffModelForSource(
        CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        config.adultModelId
      ),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    assert.equal(
      resolveAdultHandoffTargetModelId({
        sourceModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        existingAdultModelId: config.adultModelId,
        state: {},
      }),
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    const body = adaptCheaperInferenceChatBody({
      model: "deepseek-v4-pro",
      messages: [{ role: "user", content: "hello" }],
      reasoning_effort: "high",
      reasoning: { effort: "none" },
      include_reasoning: true,
    });
    assert.equal(body.model, "deepseek-v4-pro-0813");
    assert.deepEqual(body.thinking, { type: "disabled" });
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(body.reasoning, undefined);
    assert.equal(body.include_reasoning, undefined);
    assert.equal(
      resolveAdultHandoffApplied({
        adultHandoffActive: true,
        userSelectedModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        actualTargetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      }),
      true
    );
  });

  it("production chat route does not enable Style Track or Completion adapters", () => {
    const routePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../app/api/chat/route.ts"
    );
    const route = readFileSync(routePath, "utf8");
    assert.equal(route.includes("resolveDeepSeekAdultHandoffUserBlocks"), false);
    assert.equal(route.includes("HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR"), false);
    assert.equal(route.includes("DEEPSEEK_HANDOFF_SCENE_COMPLETION"), false);
    assert.equal(route.includes("deepSeekAdultHandoff"), false);
  });

  it("non-DeepSeek normal route does not inject blocks", () => {
    const decision = decideRoute(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL, NORMAL_TURN);
    assert.equal(decision.activeRoute, "general");
    const blocks = resolveDeepSeekAdultHandoffUserBlocks({
      adultHandoffActive: false,
      selectedSourceModelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      resolvedTargetModelId: config.adultModelId,
    });
    assert.equal(blocks, null);
  });
});
