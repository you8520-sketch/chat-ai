import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSuggestedRepliesExtractUserBlockForTest,
  suggestedRepliesExtractSystemForTest,
} from "./extract";
import { SUGGESTED_REPLY_MAX_CHARS, SUGGESTED_REPLY_MIN_CHARS } from "./types";

describe("suggested replies extract prompt", () => {
  it("asks Flash for three distinct scene directions", () => {
    const system = suggestedRepliesExtractSystemForTest();
    assert.match(system, /Exactly 3 objects/);
    assert.match(system, new RegExp(`${SUGGESTED_REPLY_MIN_CHARS}–${SUGGESTED_REPLY_MAX_CHARS}`));
    assert.match(system, /kind": "escalate"/);
    assert.match(system, /kind": "soften"/);
    assert.match(system, /kind": "pivot"/);
    assert.match(system, /USER persona/);
  });

  it("includes persona speech examples and this-turn prose", () => {
    const block = buildSuggestedRepliesExtractUserBlockForTest({
      charName: "유나",
      personaName: "렌",
      personaDescription: "냉소적인 반말",
      personaSpeechExamples: "\"흥, 내가 왜.\"",
      userPersona: "이름/호칭: 렌",
      userMessage: "*한숨을 쉬며* \"됐어.\"",
      assistantProse: "유나가 문을 닫으려 한다.",
    });
    assert.match(block, /냉소적인 반말/);
    assert.match(block, /흥, 내가 왜/);
    assert.match(block, /유나가 문을 닫으려 한다/);
  });
});
