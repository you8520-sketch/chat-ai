import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
} from "@/lib/chatModels";
import { LIKE_SPECIFIC_V1_PHRASES, MUSE_FINGERPRINT_FORBIDDEN_LABELS } from "./museSourceStyleFingerprint";
import {
  MUSE_ADULT_FICTION_FRAME,
  MUSE_ADULT_FICTION_FRAME_HEADER,
  resolveMuseAdultFictionFrame,
} from "./museAdultFictionFrame";
import {
  MUSE_SOURCE_CONTINUITY_STYLE_MIRROR,
  appendSourceSpecificMuseAdapterToUserTurn,
} from "./adultHandoffSourceRouting";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "./responseLength";
import { detectActualNonConsent } from "./adultSceneRouting";

describe("museAdultFictionFrame", () => {
  it("attaches only for Muse + NSFW", () => {
    assert.ok(
      resolveMuseAdultFictionFrame({
        adultTargetModelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
        nsfw: true,
      })
    );
    assert.equal(
      resolveMuseAdultFictionFrame({
        adultTargetModelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
        nsfw: false,
      }),
      null
    );
    assert.equal(
      resolveMuseAdultFictionFrame({
        adultTargetModelId: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
        nsfw: true,
      }),
      null
    );
    assert.equal(
      resolveMuseAdultFictionFrame({
        adultTargetModelId: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        nsfw: true,
      }),
      null
    );
  });

  it("contains no Like-specific phrases or personality labels", () => {
    for (const phrase of LIKE_SPECIFIC_V1_PHRASES) {
      assert.equal(MUSE_ADULT_FICTION_FRAME.includes(phrase), false);
    }
    for (const label of MUSE_FINGERPRINT_FORBIDDEN_LABELS) {
      assert.equal(MUSE_ADULT_FICTION_FRAME.includes(label), false);
    }
  });

  it("places the frame once before Mirror and keeps terminal last", () => {
    const once = appendSourceSpecificMuseAdapterToUserTurn(
      "이대로 더 해도 돼.",
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
      USER_TAIL_LENGTH_OWNER_SENTENCE,
      undefined,
      true
    );
    const twice = appendSourceSpecificMuseAdapterToUserTurn(
      once,
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
      USER_TAIL_LENGTH_OWNER_SENTENCE,
      undefined,
      true
    );
    assert.equal(once.split(MUSE_ADULT_FICTION_FRAME_HEADER).length - 1, 1);
    assert.equal(twice, once);
    assert.ok(
      once.indexOf(MUSE_ADULT_FICTION_FRAME_HEADER) <
        once.indexOf(MUSE_SOURCE_CONTINUITY_STYLE_MIRROR)
    );
    assert.ok(once.trimEnd().endsWith(USER_TAIL_LENGTH_OWNER_SENTENCE));
  });

  it("does not leak onto Qwen or DeepSeek", () => {
    const qwen = appendSourceSpecificMuseAdapterToUserTurn(
      "이대로 더 해도 돼.",
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      USER_TAIL_LENGTH_OWNER_SENTENCE,
      undefined,
      true
    );
    const deepseek = appendSourceSpecificMuseAdapterToUserTurn(
      "이대로 더 해도 돼.",
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      USER_TAIL_LENGTH_OWNER_SENTENCE,
      undefined,
      true
    );
    assert.equal(qwen.includes(MUSE_ADULT_FICTION_FRAME_HEADER), false);
    assert.equal(deepseek.includes(MUSE_ADULT_FICTION_FRAME_HEADER), false);
  });

  it("does not disable the app actual-nonconsent detector", () => {
    assert.equal(
      detectActualNonConsent("실제 비동의로 성폭력을 진행한다."),
      true
    );
    assert.equal(
      detectActualNonConsent(
        "OOC: 사전 동의, 세이프워드 레드. CNC 강압 역할극으로 진행한다."
      ),
      false
    );
  });
});
