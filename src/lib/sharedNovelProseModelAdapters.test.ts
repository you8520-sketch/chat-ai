import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
} from "@/lib/chatModels";
import {
  DEEPSEEK_LENGTH_ARM_B_SENTENCE,
  DEEPSEEK_LENGTH_ARM_C_SENTENCE,
  DEEPSEEK_LENGTH_SAFETY_SENTENCE,
  resolveDeepSeekLengthAdapterSection,
  resolveLunaAdapterSection,
  resolveTerraTerminalLengthOwnerContract,
  SNPV2_DEEPSEEK_LENGTH_ARM_ENV,
  TERRA_TERMINAL_LENGTH_OWNER_CONTRACT,
} from "@/lib/sharedNovelProseModelAdapters";

describe("sharedNovelProseModelAdapters", () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV];
    delete process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV];
  });

  afterEach(() => {
    if (prev === undefined) delete process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV];
    else process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV] = prev;
  });

  it("default / Arm A → null", () => {
    assert.equal(
      resolveDeepSeekLengthAdapterSection(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      null
    );
    process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV] = "A";
    assert.equal(
      resolveDeepSeekLengthAdapterSection(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
      null
    );
  });

  it("Arm B/C only for CheaperInference DeepSeek", () => {
    process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV] = "B";
    const b = resolveDeepSeekLengthAdapterSection(
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    assert.ok(b?.includes(DEEPSEEK_LENGTH_ARM_B_SENTENCE));
    assert.ok(b?.includes(DEEPSEEK_LENGTH_SAFETY_SENTENCE));
    assert.equal(resolveDeepSeekLengthAdapterSection(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL), null);

    process.env[SNPV2_DEEPSEEK_LENGTH_ARM_ENV] = "C";
    const c = resolveDeepSeekLengthAdapterSection(
      CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    );
    assert.ok(c?.includes(DEEPSEEK_LENGTH_ARM_C_SENTENCE));
    assert.ok(c?.includes(DEEPSEEK_LENGTH_SAFETY_SENTENCE));
    assert.ok(!c?.includes(DEEPSEEK_LENGTH_ARM_B_SENTENCE));
  });

  it("Arm C uses exact production strong phrase", () => {
    assert.equal(DEEPSEEK_LENGTH_ARM_C_SENTENCE, "단일 응답 최대 전개·미달 조기 종료 금지.");
  });

  it("Terra registry: single_primary only; Luna adapter remains null", () => {
    assert.equal(
      resolveTerraTerminalLengthOwnerContract({
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "character",
      }),
      TERRA_TERMINAL_LENGTH_OWNER_CONTRACT
    );
    assert.equal(
      resolveTerraTerminalLengthOwnerContract({
        modelId: CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
        contentKind: "simulation",
      }),
      null
    );
    assert.equal(
      resolveTerraTerminalLengthOwnerContract({
        modelId: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
        contentKind: "character",
      }),
      null
    );
    assert.equal(resolveLunaAdapterSection(), null);
  });
});
