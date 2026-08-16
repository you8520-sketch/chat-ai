import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
import {
  GEMINI37_FLASH_LENGTH_OWNER_BLOCK,
  GEMINI37_FLASH_LENGTH_OWNER_TITLE,
  REJECTED_GEMINI37_FLASH_LENGTH_B_SENTENCE,
  auditGemini37LengthOwners,
  resolveGemini37FlashLengthAdapterSection,
  shouldSuppressGenericUserTailLengthOwner,
} from "@/lib/gemini37FlashLengthAdapter";

describe("gemini37FlashLengthAdapter", () => {
  it("returns the exact SYSTEM length block for Gemini 3.7 Flash only", () => {
    assert.equal(
      resolveGemini37FlashLengthAdapterSection(
        CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL
      ),
      GEMINI37_FLASH_LENGTH_OWNER_BLOCK
    );
    assert.match(
      GEMINI37_FLASH_LENGTH_OWNER_BLOCK,
      /^\[RESPONSE LENGTH — GEMINI 3\.7 FLASH\]\n\n/
    );
    assert.match(
      GEMINI37_FLASH_LENGTH_OWNER_BLOCK,
      /약 4,000~5,500자 분량의 장편 RP 응답으로 작성한다/
    );
  });

  it("does not inject for Gemini 3.1 or other models", () => {
    assert.equal(
      resolveGemini37FlashLengthAdapterSection(
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
      ),
      null
    );
    assert.equal(
      resolveGemini37FlashLengthAdapterSection("anthropic/claude-opus-5"),
      null
    );
    assert.equal(resolveGemini37FlashLengthAdapterSection(""), null);
    assert.equal(
      shouldSuppressGenericUserTailLengthOwner(
        CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL
      ),
      false
    );
    assert.equal(
      shouldSuppressGenericUserTailLengthOwner(
        CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL
      ),
      true
    );
  });

  it("does not reuse rejected B sentence or C terminal placement", () => {
    assert.doesNotMatch(
      GEMINI37_FLASH_LENGTH_OWNER_BLOCK,
      /약 3,200~4,000자 분량으로 완성한다/
    );
    assert.equal(
      GEMINI37_FLASH_LENGTH_OWNER_BLOCK.includes(
        REJECTED_GEMINI37_FLASH_LENGTH_B_SENTENCE
      ),
      false
    );
    assert.doesNotMatch(
      GEMINI37_FLASH_LENGTH_OWNER_BLOCK,
      /agency|서술\s*80|대사 비율|world-motion/i
    );
  });

  it("counts a single SYSTEM owner and no user-tail duplicate", () => {
    const audit = auditGemini37LengthOwners({
      system: `rules\n\n${GEMINI37_FLASH_LENGTH_OWNER_BLOCK}\n\nmore`,
      lastUser: `나는 렌이라고…\n\n레이아웃: 지문과 "…" 대사 사이 빈 줄`,
    });
    assert.equal(audit.GEMINI37_LENGTH_OWNER_COUNT, 1);
    assert.equal(audit.systemOwnerCount, 1);
    assert.equal(audit.userOwnerCount, 0);
    assert.equal(audit.genericUserTailCount, 0);
    assert.equal(audit.rejectedBCount, 0);
    assert.equal(audit.location, "system");
    assert.equal(
      GEMINI37_FLASH_LENGTH_OWNER_TITLE === USER_TAIL_LENGTH_OWNER_SENTENCE,
      false
    );
  });
});
