import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { OPENROUTER_GEMINI_31_PRO_MODEL } from "@/lib/chatModels";
import {
  GEMINI31_USER_AGENCY_AMBIGUOUS_INTENT_SENTENCE,
  GEMINI31_USER_AGENCY_BODY_FACT_SENTENCE,
  GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE,
} from "@/lib/gemini31UserAgencyAdapter";
import { COLLABORATIVE_INTERACTIVE_OWNER_TITLE } from "@/lib/noGodmodding";
import { buildContext } from "./contextBuilder";

function baseInput(modelId: string) {
  return {
    charName: "태형",
    chunks: [],
    userNickname: "렌",
    shortTermHistory: [{ role: "user" as const, content: "안녕" }],
    currentUserMessage:
      "난 이거 마음에 들어. *녹색의 이쁜 빛을 발하는 피어싱 형태의 귀걸이를 손가락으로 가리키고 태형을 빤히 바라본다*",
    nsfw: false,
    provider: "openrouter" as const,
    modelId,
  };
}

describe("buildContext — Gemini 3.1 user-agency supplement", () => {
  it("appends the two-sentence supplement inside no-godmodding for Gemini 3.1", () => {
    const built = buildContext(baseInput(OPENROUTER_GEMINI_31_PRO_MODEL));
    const section = built.meta.trackedSections?.find((s) => s.id === "no-godmodding");
    assert.ok(section);
    assert.match(section!.text, new RegExp(COLLABORATIVE_INTERACTIVE_OWNER_TITLE.replace(/[[\]]/g, "\\$&")));
    assert.ok(section!.text.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE));
    assert.ok(section!.text.includes(GEMINI31_USER_AGENCY_BODY_FACT_SENTENCE));
    assert.ok(section!.text.includes(GEMINI31_USER_AGENCY_AMBIGUOUS_INTENT_SENTENCE));
  });

  it("does not inject the supplement for non-Gemini-3.1 models", () => {
    const built = buildContext(baseInput("anthropic/claude-opus-4.6"));
    const section = built.meta.trackedSections?.find((s) => s.id === "no-godmodding");
    assert.ok(section);
    assert.match(section!.text, new RegExp(COLLABORATIVE_INTERACTIVE_OWNER_TITLE.replace(/[[\]]/g, "\\$&")));
    assert.equal(section!.text.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE), false);
  });

  it("skips the supplement on auto-continue for Gemini 3.1", () => {
    const built = buildContext({
      ...baseInput(OPENROUTER_GEMINI_31_PRO_MODEL),
      isContinue: true,
    });
    const section = built.meta.trackedSections?.find((s) => s.id === "no-godmodding");
    assert.ok(section);
    assert.equal(section!.text.includes(GEMINI31_USER_AGENCY_SUPPLEMENT_TITLE), false);
  });
});
