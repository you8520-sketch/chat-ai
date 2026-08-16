import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import {
  GEMINI37_FLASH_LENGTH_SENTENCE,
  appendGemini37FlashLengthToUserTurn,
  resolveGemini37FlashLengthAdapterSection,
} from "@/lib/gemini37FlashLengthAdapter";

describe("gemini37FlashLengthAdapter — terminal placement", () => {
  it("keeps the length sentence byte-identical", () => {
    assert.equal(
      GEMINI37_FLASH_LENGTH_SENTENCE,
      "현재 장면을 충분히 전개하여 한국어 공백 포함 약 3,200~4,000자 분량으로 완성한다. 짧게 마무리하거나 요약하지 않는다."
    );
    assert.doesNotMatch(
      GEMINI37_FLASH_LENGTH_SENTENCE,
      /agency|서술\s*80|대사|world-motion|반복/i
    );
  });

  it("does not return a system/model-specific section for any model", () => {
    assert.equal(
      resolveGemini37FlashLengthAdapterSection(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL),
      null
    );
    assert.equal(
      resolveGemini37FlashLengthAdapterSection(
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
      ),
      null
    );
    assert.equal(resolveGemini37FlashLengthAdapterSection("anthropic/claude-opus-5"), null);
  });

  it("appends the sentence once at the user-turn terminal for Gemini 3.7 Flash", () => {
    const body = `나는 렌이라고… 본 기억이 안 나는데… 나 알아?\n\n${USER_TAIL_LENGTH_OWNER_SENTENCE}`;
    const out = appendGemini37FlashLengthToUserTurn(
      body,
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL
    );
    assert.ok(out.endsWith(GEMINI37_FLASH_LENGTH_SENTENCE));
    assert.ok(out.includes(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.equal(out.split(GEMINI37_FLASH_LENGTH_SENTENCE).length - 1, 1);
    assert.ok(out.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE) < out.indexOf(GEMINI37_FLASH_LENGTH_SENTENCE));
  });

  it("does not duplicate when the sentence is already present", () => {
    const once = appendGemini37FlashLengthToUserTurn(
      "같이 갈래? *두리번*",
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL
    );
    const twice = appendGemini37FlashLengthToUserTurn(
      once,
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL
    );
    assert.equal(twice, once);
    assert.equal(twice.split(GEMINI37_FLASH_LENGTH_SENTENCE).length - 1, 1);
  });

  it("does not append for Gemini 3.1 or other models", () => {
    const body = "같이 갈래? *두리번*";
    assert.equal(
      appendGemini37FlashLengthToUserTurn(
        body,
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
      ),
      body
    );
    assert.equal(
      appendGemini37FlashLengthToUserTurn(body, "anthropic/claude-opus-5"),
      body
    );
  });

  it("does not edit the common user-tail length owner sentence", () => {
    assert.equal(
      USER_TAIL_LENGTH_OWNER_SENTENCE,
      "이번 응답은 한국어 3,200자 이상을 기본 목표로 하나의 충분히 전개된 장면으로 작성한다. 장면에 필요한 내용이 있으면 더 길게 이어간다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다."
    );
  });
});
