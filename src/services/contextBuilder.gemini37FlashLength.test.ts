import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
} from "@/lib/chatModels";
import { GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE } from "@/lib/gemini31UserAgencyAdapter";
import { GEMINI37_FLASH_LENGTH_SENTENCE } from "@/lib/gemini37FlashLengthAdapter";
import { USER_TAIL_LENGTH_OWNER_SENTENCE } from "@/lib/responseLength";
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

function lastUserContent(built: ReturnType<typeof buildContext>): string {
  const last = built.history[built.history.length - 1];
  assert.equal(last?.role, "user");
  return last.content;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

describe("buildContext — Gemini 3.7 Flash length terminal placement", () => {
  it("places the sentence once at the last user-turn instruction, not in system", () => {
    const built = buildContext(baseInput(CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL));
    const section = built.meta.trackedSections?.find(
      (s) => s.id === "rule-gemini37-flash-length-adapter"
    );
    assert.equal(section, undefined);
    assert.equal(built.systemPrompt.includes(GEMINI37_FLASH_LENGTH_SENTENCE), false);
    assert.equal(built.systemPrompt.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE), false);

    const lastUser = lastUserContent(built);
    assert.ok(lastUser.includes("나는 렌이라고… 본 기억이 안 나는데… 나 알아?"));
    assert.ok(lastUser.includes(USER_TAIL_LENGTH_OWNER_SENTENCE));
    assert.ok(lastUser.endsWith(GEMINI37_FLASH_LENGTH_SENTENCE));
    assert.equal(countOccurrences(lastUser, GEMINI37_FLASH_LENGTH_SENTENCE), 1);
    assert.ok(
      lastUser.indexOf(USER_TAIL_LENGTH_OWNER_SENTENCE) <
        lastUser.indexOf(GEMINI37_FLASH_LENGTH_SENTENCE)
    );

    const assembled = `${built.systemPrompt}\n${built.history.map((m) => m.content).join("\n")}`;
    assert.equal(countOccurrences(assembled, GEMINI37_FLASH_LENGTH_SENTENCE), 1);
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
    assert.equal(lastUserContent(built).includes(GEMINI37_FLASH_LENGTH_SENTENCE), false);
  });
});
