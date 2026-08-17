import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { adaptCheaperInferenceChatBody } from "./cheaperInferenceConfig";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
  OPENROUTER_MUSE_SPARK_12_MODEL,
  isCheaperInferenceMuseSpark12Model,
  selectedAILabel,
} from "./chatModels";
import {
  GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK,
  MUSE_SOURCE_CONTINUITY_STYLE_MIRROR,
  OPUS_QWEN_FRAGMENT_SENTENCE,
  appendSourceSpecificMuseAdapterToUserTurn,
  isAllowedAdultHandoffTargetModel,
  resolveAdultHandoffModelForSource,
  resolveSourceSpecificMuseAdapter,
  resolveSourceSpecificQwenAdapter,
} from "./adultHandoffSourceRouting";
import { appendAdultHandoffPrompt } from "./adultSceneRouting";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "./responseLength";
import { MUSE_SOURCE_STYLE_FINGERPRINT_HEADER } from "./museSourceStyleFingerprint";

const LIKE_SPECIFIC_V1_PHRASES = [
  "미세한 환경음과 거리감",
  "얇은 농담",
  "능글맞음",
  "어색하게 비치는 진심",
  "장난스러운 반응",
] as const;

const V2_HEADER = "[MUSE SOURCE STYLE MIRROR V2]";
const V1_OPUS_HEADER = "[MUSE SOURCE STYLE CONTINUITY — OPUS 5]";
const V1_GEMINI_HEADER = "[MUSE SOURCE STYLE CONTINUITY — GEMINI 3.1]";

describe("Muse Spark 1.2 production continuity candidate", () => {
  it("uses one generic STYLE MIRROR block for Opus and Gemini 3.1", () => {
    const opus = resolveSourceSpecificMuseAdapter(
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL
    );
    const gemini = resolveSourceSpecificMuseAdapter(
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      OPENROUTER_MUSE_SPARK_12_MODEL
    );
    assert.equal(opus, MUSE_SOURCE_CONTINUITY_STYLE_MIRROR);
    assert.equal(gemini, MUSE_SOURCE_CONTINUITY_STYLE_MIRROR);
    assert.equal(opus, gemini);
    assert.equal(
      MUSE_SOURCE_CONTINUITY_STYLE_MIRROR.startsWith(
        "[MUSE SOURCE CONTINUITY — STYLE MIRROR]"
      ),
      true
    );
  });

  it("keeps Like-specific V1 phrases and V2 out of the production adapter", () => {
    for (const phrase of LIKE_SPECIFIC_V1_PHRASES) {
      assert.equal(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR.includes(phrase), false);
    }
    assert.equal(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR.includes(V2_HEADER), false);
    assert.equal(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR.includes(V1_OPUS_HEADER), false);
    assert.equal(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR.includes(V1_GEMINI_HEADER), false);
  });

  it("does not attach Qwen adapters when the target is Muse 1.2", () => {
    assert.equal(
      resolveSourceSpecificQwenAdapter(
        CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL
      ),
      null
    );
    assert.equal(
      resolveSourceSpecificQwenAdapter(
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
        CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL
      ),
      null
    );
    const handoff = appendAdultHandoffPrompt(
      "COMMON SYSTEM",
      {
        previousSceneMode: "explicit",
        sexualContextActive: true,
        sceneReset: false,
      },
      {
        sourceModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        adultTargetModelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
      }
    );
    assert.equal(handoff.includes(OPUS_QWEN_FRAGMENT_SENTENCE), false);
    assert.equal(handoff.includes(GEMINI31_QWEN_STYLE_CONTINUITY_BLOCK), false);
    assert.equal(handoff.includes(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR), false);
  });

  it("injects the Muse block once on the current-user turn before the terminal tail", () => {
    const userBody = "이대로 더 해도 돼.";
    const withMuse = appendSourceSpecificMuseAdapterToUserTurn(
      userBody,
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL
    );
    const once = appendSourceSpecificMuseAdapterToUserTurn(
      withMuse,
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL
    );
    assert.equal(
      once.split(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR).length - 1,
      1
    );
    const withTail = `${once}\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}`;
    assert.ok(withTail.indexOf(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR) < withTail.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(withTail.endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
  });

  it("does not change default Opus/Gemini 3.1 routing away from Qwen", () => {
    assert.equal(
      resolveAdultHandoffModelForSource(
        CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
        "deepseek-v4-pro-0813"
      ),
      CHEAPER_INFERENCE_QWEN_38_MAX_MODEL
    );
    assert.equal(
      resolveAdultHandoffModelForSource(
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
        "deepseek-v4-pro-0813"
      ),
      CHEAPER_INFERENCE_QWEN_38_MAX_MODEL
    );
    assert.equal(isAllowedAdultHandoffTargetModel(CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL), true);
  });

  it("strips all reasoning fields for Muse Spark 1.2", () => {
    const adapted = adaptCheaperInferenceChatBody({
      model: OPENROUTER_MUSE_SPARK_12_MODEL,
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.7,
      reasoning: { effort: "none" },
      include_reasoning: false,
      reasoning_effort: "none",
      thinking: { type: "disabled" },
    });
    assert.equal(adapted.model, CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL);
    assert.equal(adapted.temperature, 0.7);
    assert.equal(Object.prototype.hasOwnProperty.call(adapted, "reasoning"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(adapted, "include_reasoning"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(adapted, "reasoning_effort"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(adapted, "thinking"), false);
    assert.equal(isCheaperInferenceMuseSpark12Model(adapted.model as string), true);
    assert.equal(selectedAILabel(CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL), "Muse Spark 1.2");
  });

  it("places fingerprint once before Generic Mirror and keeps terminal last", () => {
    const lastRaw = Array.from({ length: 12 }, (_, i) => {
      let p = `문단 ${i}. 창밖 공기가 조금 달라졌다. `;
      while (p.length < 180) p += "이어지는 서술 문장이다. ";
      return p;
    }).join("\n\n");
    const once = appendSourceSpecificMuseAdapterToUserTurn(
      "이대로 더 해도 돼.",
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
      USER_TAIL_LENGTH_OWNER_SENTENCE,
      lastRaw
    );
    const twice = appendSourceSpecificMuseAdapterToUserTurn(
      once,
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
      USER_TAIL_LENGTH_OWNER_SENTENCE,
      lastRaw
    );
    assert.equal(once.split(MUSE_SOURCE_STYLE_FINGERPRINT_HEADER).length - 1, 1);
    assert.equal(once.split(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR).length - 1, 1);
    assert.equal(twice, once);
    assert.ok(
      once.indexOf(MUSE_SOURCE_STYLE_FINGERPRINT_HEADER) <
        once.indexOf(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR)
    );
    assert.ok(
      once.indexOf(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR) <
        once.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE)
    );
    assert.ok(once.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
  });

  it("does not leak fingerprint onto Qwen or DeepSeek targets", () => {
    const lastRaw = Array.from({ length: 12 }, (_, i) => {
      let p = `문단 ${i}. 창밖 공기가 조금 달라졌다. `;
      while (p.length < 180) p += "이어지는 서술 문장이다. ";
      return p;
    }).join("\n\n");
    const qwen = appendSourceSpecificMuseAdapterToUserTurn(
      "이대로 더 해도 돼.",
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      USER_TAIL_LENGTH_OWNER_SENTENCE,
      lastRaw
    );
    const deepseek = appendSourceSpecificMuseAdapterToUserTurn(
      "이대로 더 해도 돼.",
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      USER_TAIL_LENGTH_OWNER_SENTENCE,
      lastRaw
    );
    assert.equal(qwen.includes(MUSE_SOURCE_STYLE_FINGERPRINT_HEADER), false);
    assert.equal(deepseek.includes(MUSE_SOURCE_STYLE_FINGERPRINT_HEADER), false);
    assert.equal(qwen.includes(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR), false);
    assert.equal(deepseek.includes(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR), false);
  });
});
