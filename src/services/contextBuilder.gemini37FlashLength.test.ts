import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";
import { GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE } from "@/lib/gemini31UserAgencyAdapter";
import { GEMINI37_FLASH_LENGTH_SENTENCE } from "@/lib/gemini37FlashLengthAdapter";
import { buildContext } from "./contextBuilder";

function baseInput(modelId: string) {
  return {
    charName: "조태형",
    chunks: [],
    userNickname: "렌",
    shortTermHistory: [{ role: "assistant" as const, content: "어? 신입이야?" }],
    currentUserMessage: "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
    nsfw: false,
    provider: "cheaperinference" as const,
    modelId,
  };
}

describe("buildContext — Gemini 3.7 Flash length-only adapter", () => {
  it("injects the single length sentence for Gemini 3.7 Flash", () => {
    const built = buildContext(baseInput(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL));
    const section = built.meta.trackedSections?.find(
      (s) => s.id === "rule-gemini37-flash-length-adapter"
    );
    assert.ok(section);
    assert.equal(section!.text, GEMINI37_FLASH_LENGTH_SENTENCE);
    assert.ok(built.systemPrompt.includes(GEMINI37_FLASH_LENGTH_SENTENCE));
    assert.equal(built.systemPrompt.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE), false);
  });

  it("does not inject the sentence for Gemini 3.1", () => {
    const built = buildContext(
      baseInput(CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL)
    );
    const section = built.meta.trackedSections?.find(
      (s) => s.id === "rule-gemini37-flash-length-adapter"
    );
    assert.equal(section, undefined);
    assert.equal(built.systemPrompt.includes(GEMINI37_FLASH_LENGTH_SENTENCE), false);
  });
});
