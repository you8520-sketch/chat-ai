import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPENROUTER_GEMINI_31_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
} from "@/lib/chatModels";
import {
  appendGemini31UserAgencySupplement,
  GEMINI31_USER_AGENCY_AMBIGUOUS_INTENT_SENTENCE,
  GEMINI31_USER_AGENCY_BODY_FACT_SENTENCE,
  GEMINI31_USER_AGENCY_SUPPLEMENT,
  GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE,
  resolveGemini31UserAgencySupplement,
  shouldInjectGemini31UserAgencySupplement,
} from "@/lib/gemini31UserAgencyAdapter";
import {
  buildCompactNoGodmoddingStandardBlock,
  COLLABORATIVE_INTERACTIVE_OWNER_BLOCK,
} from "@/lib/noGodmodding";

describe("gemini31UserAgencyAdapter", () => {
  it("gates on Gemini 3.1 Pro + standard interactive only", () => {
    assert.equal(
      shouldInjectGemini31UserAgencySupplement({
        modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
        godmoddingMode: "standard",
      }),
      true
    );
    assert.equal(
      shouldInjectGemini31UserAgencySupplement({
        modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
        godmoddingMode: "standard",
      }),
      true
    );
    assert.equal(
      shouldInjectGemini31UserAgencySupplement({
        modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
        godmoddingMode: "autoContinue",
      }),
      false
    );
    assert.equal(
      shouldInjectGemini31UserAgencySupplement({
        modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
        godmoddingMode: "coNarration",
      }),
      false
    );
    assert.equal(
      shouldInjectGemini31UserAgencySupplement({
        modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
        godmoddingMode: "standard",
        contentKind: "simulation",
      }),
      false
    );
    assert.equal(
      shouldInjectGemini31UserAgencySupplement({
        modelId: "google/gemini-3.6-flash-preview",
        godmoddingMode: "standard",
      }),
      false
    );
    assert.equal(
      shouldInjectGemini31UserAgencySupplement({
        modelId: "anthropic/claude-opus-4.6",
        godmoddingMode: "standard",
      }),
      false
    );
  });

  it("exposes exactly the two required Korean sentences", () => {
    const text = resolveGemini31UserAgencySupplement({
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      godmoddingMode: "standard",
    });
    assert.equal(text, GEMINI31_USER_AGENCY_SUPPLEMENT);
    assert.ok(text?.includes(GEMINI31_USER_AGENCY_BODY_FACT_SENTENCE));
    assert.ok(text?.includes(GEMINI31_USER_AGENCY_AMBIGUOUS_INTENT_SENTENCE));
    // Soft boundary — must not harden into absolute bans.
    assert.doesNotMatch(text ?? "", /절대로/);
    assert.doesNotMatch(text ?? "", /무조건/);
    assert.doesNotMatch(text ?? "", /항상 사용자에게 질문/);
  });

  it("appends after shared collaborative owner without mutating the shared constant", () => {
    const shared = buildCompactNoGodmoddingStandardBlock();
    const withSupplement = appendGemini31UserAgencySupplement(shared, {
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      godmoddingMode: "standard",
    });
    assert.ok(withSupplement.startsWith(COLLABORATIVE_INTERACTIVE_OWNER_BLOCK));
    assert.ok(withSupplement.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE));
    assert.ok(withSupplement.includes(GEMINI31_USER_AGENCY_BODY_FACT_SENTENCE));
    assert.equal(
      appendGemini31UserAgencySupplement(shared, {
        modelId: "openai/gpt-5.6",
        godmoddingMode: "standard",
      }),
      shared
    );
    // Shared constant unchanged for other models / imports.
    assert.equal(
      COLLABORATIVE_INTERACTIVE_OWNER_BLOCK.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE),
      false
    );
  });

  it("is idempotent when title already present", () => {
    const once = appendGemini31UserAgencySupplement(
      buildCompactNoGodmoddingStandardBlock(),
      {
        modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
        godmoddingMode: "standard",
      }
    );
    const twice = appendGemini31UserAgencySupplement(once, {
      modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
      godmoddingMode: "standard",
    });
    assert.equal(twice, once);
    assert.equal(
      twice.split(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE).length - 1,
      1
    );
  });
});
