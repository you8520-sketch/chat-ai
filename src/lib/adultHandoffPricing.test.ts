import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADULT_HANDOFF_USER_DISCOUNT_PERCENT,
  resolveAdultHandoffChargeModelId,
} from "./adultHandoffPricing";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
  CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
} from "./chatModels";

describe("adult handoff pricing owners", () => {
  it("keeps source-model user charge when Muse 1.2 is delivered", () => {
    const opus = resolveAdultHandoffChargeModelId({
      sourceModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      deliveredModelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
      activeRoute: "adult",
    });
    assert.equal(opus.userChargeOwner, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    assert.equal(opus.actualCostOwner, CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL);
    assert.equal(opus.chargeModelId, CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL);
    assert.equal(opus.discountPercent, null);
    assert.equal(ADULT_HANDOFF_USER_DISCOUNT_PERCENT, null);

    const gemini = resolveAdultHandoffChargeModelId({
      sourceModelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      deliveredModelId: "meta/muse-spark-1.2",
      activeRoute: "adult",
    });
    assert.equal(gemini.userChargeOwner, CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL);
    assert.equal(gemini.actualCostOwner, CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL);
    assert.equal(gemini.chargeModelId, CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL);
    assert.notEqual(gemini.chargeModelId, gemini.actualCostOwner);
  });

  it("does not rewrite Qwen or general-route charges", () => {
    const qwen = resolveAdultHandoffChargeModelId({
      sourceModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      deliveredModelId: CHEAPER_INFERENCE_QWEN_38_MAX_MODEL,
      activeRoute: "adult",
    });
    assert.equal(qwen.userChargeOwner, null);
    assert.equal(qwen.actualCostOwner, null);
    assert.equal(qwen.chargeModelId, CHEAPER_INFERENCE_QWEN_38_MAX_MODEL);

    const general = resolveAdultHandoffChargeModelId({
      sourceModelId: CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      deliveredModelId: CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL,
      activeRoute: "general",
    });
    assert.equal(general.userChargeOwner, null);
    assert.equal(general.chargeModelId, CHEAPER_INFERENCE_MUSE_SPARK_12_MODEL);
  });
});
