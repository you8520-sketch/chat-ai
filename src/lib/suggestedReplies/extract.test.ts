import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSuggestedRepliesExtractUserBlockForTest,
  extractSuggestedRepliesFromTurn,
  suggestedRepliesExtractSystemForTest,
  type SuggestedRepliesExtractCaller,
} from "./extract";
import { SUGGESTED_REPLIES_DECISION_QUALITY_LOG_PREFIX } from "./decisionQualityTelemetry";
import { SUGGESTED_REPLY_MAX_CHARS, SUGGESTED_REPLY_MIN_CHARS } from "./types";

describe("suggested replies extract prompt", () => {
  it("asks Flash for three distinct scene directions", () => {
    const system = suggestedRepliesExtractSystemForTest();
    assert.match(system, /Exactly 3 objects/);
    assert.match(system, new RegExp(`${SUGGESTED_REPLY_MIN_CHARS}–${SUGGESTED_REPLY_MAX_CHARS}`));
    assert.match(system, /kind": "natural"/);
    assert.match(system, /kind": "twist"/);
    assert.match(system, /kind": "banter"/);
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


  it("emits metadata-only decision quality telemetry on the standalone production path", async () => {
    const raw = JSON.stringify({
      items: [
        { kind: "natural", text: ("정석 반응 " + "가".repeat(80)).slice(0, 80) },
        { kind: "twist", text: ("한 수 반응 " + "가".repeat(80)).slice(0, 80) },
        { kind: "banter", text: ("드립 반응 " + "가".repeat(80)).slice(0, 80) },
      ],
    });
    const caller: SuggestedRepliesExtractCaller = async () => ({
      text: raw,
      usage: { inputTokens: 10, outputTokens: 10, estimated: true },
    });
    const original = console.info;
    const lines: string[] = [];
    console.info = (...args: unknown[]) => {
      const line = args.map(String).join(" ");
      if (line.startsWith(SUGGESTED_REPLIES_DECISION_QUALITY_LOG_PREFIX)) lines.push(line);
    };
    try {
      const replies = await extractSuggestedRepliesFromTurn(
        {
          charName: "유나",
          personaName: "렌",
          userMessage: "계속해.",
          assistantProse: "유나가 고개를 든다.",
        },
        caller
      );
      assert.equal(replies.length, 3);
    } finally {
      console.info = original;
    }

    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /"source":"standalone-extract"/);
    assert.match(lines[0]!, /"contractValid":true/);
    assert.equal(lines[0]!.includes("정석 반응"), false);
    assert.equal(lines[0]!.includes(raw), false);
  });

  it("treats an empty user message as the opening greeting turn", () => {
    const system = suggestedRepliesExtractSystemForTest();
    assert.match(system, /opening greeting/i);
    const block = buildSuggestedRepliesExtractUserBlockForTest({
      charName: "유나",
      personaName: "렌",
      userMessage: "",
      assistantProse: "…오빠, 어디 갔다 왔어?",
    });
    assert.match(block, /OPENING GREETING/);
    assert.match(block, /오빠, 어디 갔다 왔어/);
    assert.doesNotMatch(block, /\[USER MESSAGE\]/);
  });
});
