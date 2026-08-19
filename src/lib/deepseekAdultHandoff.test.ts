import assert from "node:assert/strict";
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
  DEEPSEEK_ADULT_HANDOFF_EXPERIMENT_A,
  DEEPSEEK_HANDOFF_SCENE_COMPLETION,
  DEEPSEEK_HANDOFF_SCENE_COMPLETION_HEADER,
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
  const semantic = "[CURRENT USER INPUT]\n\n허리를 더 세게 끌어안는다.";
  const withBlocks = appendDeepSeekAdultHandoffUserBlocks(semantic, opts);
  return `${withBlocks}\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}`;
}

describe("DeepSeek adult-handoff owners", () => {
  it("treats DeepSeek family picker ids as native turns", () => {
    assert.equal(isDeepSeekNativeTurn(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL), true);
    assert.equal(
      isDeepSeekNativeTurn(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_LEGACY_MODEL),
      true
    );
    assert.equal(isDeepSeekNativeTurn("deepseek/deepseek-v4-pro"), true);
    assert.equal(isDeepSeekNativeTurn(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL), false);
    assert.equal(isDeepSeekNativeTurn(CHEAPER_INFERENCE_GPT_56_TERRA_MODEL), false);
  });

  it("DeepSeek direct normal turn is not an adult handoff", () => {
    const decision = decideRoute(
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      NORMAL_TURN
    );
    const target = resolveAdultHandoffTargetModelId({
      sourceModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      existingAdultModelId: config.adultModelId,
      state: {},
    });
    assert.equal(decision.activeRoute, "general");
    assert.equal(
      isDeepSeekAdultHandoff({
        adultHandoffActive: decision.activeRoute === "adult",
        selectedSourceModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        resolvedTargetModelId: target,
      }),
      false
    );
    const blocks = resolveDeepSeekAdultHandoffUserBlocks({
      adultHandoffActive: false,
      selectedSourceModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      resolvedTargetModelId: target,
    });
    const user = placeUserTurn(blocks ?? {});
    assert.equal(countPromptOccurrences(user, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR), 0);
    assert.equal(countPromptOccurrences(user, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 0);
  });

  it("DeepSeek direct adult-capable turn does not internal-handoff or inject blocks", () => {
    const decision = decideRoute(
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      ADULT_TRIGGER
    );
    const target = resolveAdultHandoffModelForSource(
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      config.adultModelId
    );
    assert.equal(decision.activeRoute, "adult");
    assert.equal(target, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    assert.equal(
      isDeepSeekAdultHandoff({
        adultHandoffActive: true,
        selectedSourceModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        resolvedTargetModelId: target,
      }),
      false
    );
    const blocks = resolveDeepSeekAdultHandoffUserBlocks({
      adultHandoffActive: true,
      selectedSourceModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      resolvedTargetModelId: target,
    });
    assert.equal(blocks, null);
    const user = placeUserTurn({});
    assert.equal(countPromptOccurrences(user, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR), 0);
    assert.equal(countPromptOccurrences(user, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 0);
    assert.equal(
      resolveAdultHandoffApplied({
        adultHandoffActive: true,
        userSelectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        actualTargetModelId: target,
      }),
      false
    );
  });

  it("non-DeepSeek normal route does not target DeepSeek or inject blocks", () => {
    for (const source of [
      CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
    ]) {
      const decision = decideRoute(source, NORMAL_TURN);
      assert.equal(decision.activeRoute, "general");
      const blocks = resolveDeepSeekAdultHandoffUserBlocks({
        adultHandoffActive: false,
        selectedSourceModelId: source,
        resolvedTargetModelId: config.adultModelId,
      });
      assert.equal(blocks, null);
    }
  });

  it("Gemini 3.7 adult handoff targets 0813 and gets Experiment A completion only", () => {
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
      applySceneCompletion: true,
    });
    assert.equal(DEEPSEEK_ADULT_HANDOFF_EXPERIMENT_A.applyStyleMirror, false);
    const user = placeUserTurn(blocks ?? {});
    assert.equal(countPromptOccurrences(user, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR), 0);
    assert.equal(countPromptOccurrences(user, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 1);
    assert.ok(
      user.indexOf(DEEPSEEK_HANDOFF_SCENE_COMPLETION) <
        user.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE)
    );
    assert.ok(user.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
  });

  it("Terra adult handoff targets 0813 and gets completion only", () => {
    const target = resolveAdultHandoffModelForSource(
      CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      config.adultModelId
    );
    assert.equal(target, "deepseek-v4-pro-0813");
    const blocks = resolveDeepSeekAdultHandoffUserBlocks({
      adultHandoffActive: true,
      selectedSourceModelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      resolvedTargetModelId: target,
    });
    assert.equal(blocks?.applySceneCompletion, true);
    assert.equal(blocks?.applyStyleMirror, false);
  });

  it("Qwen / Muse / Aion / Opus-Qwen targets do not receive DeepSeek blocks", () => {
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

  it("keeps exact Experiment A completion wording and no personality adjectives", () => {
    assert.ok(
      DEEPSEEK_HANDOFF_SCENE_COMPLETION.startsWith(
        DEEPSEEK_HANDOFF_SCENE_COMPLETION_HEADER
      )
    );
    assert.match(
      DEEPSEEK_HANDOFF_SCENE_COMPLETION,
      /준비·확인·예고만 한 채 응답을 끝내지 않는다/
    );
    assert.match(
      DEEPSEEK_HANDOFF_SCENE_COMPLETION,
      /후일담·다른 장소·다음 시간대로 건너뛰어 완결하지 않는다/
    );
    assert.match(
      DEEPSEEK_HANDOFF_SCENE_COMPLETION,
      /user 캐릭터의 새로운 의미 있는 대사·중요한 결정·관계 결정·새로운 의도를 대신 만들지는 않는다/
    );
    assert.doesNotMatch(DEEPSEEK_HANDOFF_SCENE_COMPLETION, /능글맞|야성적|에로틱|집착/);
    assert.doesNotMatch(
      HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR,
      /능글맞|다정함|야성적|냉정함|집착|수줍음|에로틱|거침/
    );
    assert.ok(
      HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR.startsWith(
        HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR_HEADER
      )
    );
  });

  it("append is idempotent and keeps terminal last when both blocks are on", () => {
    const once = appendDeepSeekAdultHandoffUserBlocks("허리를 끌어안는다.", {
      applyStyleMirror: true,
      applySceneCompletion: true,
    });
    const twice = appendDeepSeekAdultHandoffUserBlocks(once, {
      applyStyleMirror: true,
      applySceneCompletion: true,
    });
    assert.equal(countPromptOccurrences(twice, HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR), 1);
    assert.equal(countPromptOccurrences(twice, DEEPSEEK_HANDOFF_SCENE_COMPLETION), 1);
    assert.ok(
      twice.indexOf(HANDOFF_SOURCE_CONTINUITY_STYLE_MIRROR) <
        twice.indexOf(DEEPSEEK_HANDOFF_SCENE_COMPLETION)
    );
    const withTerminal = `${twice}\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}`;
    assert.ok(withTerminal.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
  });

  it("style owner is last visible canonical assistant RAW, not a model name", () => {
    const last = resolveLastVisibleCanonicalAssistantRaw([
      { role: "assistant", content: "OOC 샘플은 무시한다.", usage: { canonical: false, generationKind: "ooc_scene_render" } },
      {
        role: "assistant",
        content:
          "카스펜은 허리를 감싼 손을 내려다보았다.\n\n<<<STATUS_VALUES>>>\n{\"mood\":\"cold\"}\n<<<END_STATUS>>>",
      },
      { role: "user", content: "더 가까이." },
    ]);
    assert.equal(last, "카스펜은 허리를 감싼 손을 내려다보았다.");
    assert.equal(last?.includes("deepseek"), false);
    assert.equal(last?.includes("claude"), false);
    assert.equal(last?.includes("STATUS_VALUES"), false);
  });

  it("skips internal JSON and keeps prior canonical RAW", () => {
    const last = resolveLastVisibleCanonicalAssistantRaw([
      { role: "assistant", content: "렌의 손을 놓지 않았다." },
      { role: "assistant", content: "{\"route\":\"adult\"}" },
    ]);
    assert.equal(last, "렌의 손을 놓지 않았다.");
  });

  it("billing provenance distinguishes selected / actual / handoffApplied without pricing changes", () => {
    assert.equal(
      resolveAdultHandoffApplied({
        adultHandoffActive: true,
        userSelectedModelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
        actualTargetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      }),
      true
    );
    assert.equal(
      resolveAdultHandoffApplied({
        adultHandoffActive: true,
        userSelectedModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_LEGACY_MODEL,
        actualTargetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      }),
      false
    );
    assert.equal(
      resolveAdultHandoffApplied({
        adultHandoffActive: false,
        userSelectedModelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        actualTargetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      }),
      false
    );
  });

  it("keeps the production DeepSeek true-off adapter fields unchanged", () => {
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
  });
});
