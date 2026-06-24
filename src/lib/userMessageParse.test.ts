import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUserMessageParts, splitPlainUserChunk } from "./userMessageParse";

describe("userMessageParse", () => {
  it("splitPlainUserChunk preserves trailing chars after leading whitespace", () => {
    const parts = splitPlainUserChunk(" 이걸로 만족해");
    assert.equal(parts.map((p) => p.text).join(""), "이걸로 만족해");
  });

  it("parseUserMessageParts preserves dialogue after asterisk action block", () => {
    const text =
      "그렇게 가이딩 받고싶어???  *한숨쉬고 다시한번 꼭 안아주며 가이딩해준다* 이걸로 만족해";
    const joined = parseUserMessageParts(text)
      .map((p) => p.text)
      .join("");
    assert.ok(joined.includes("*한숨쉬고 다시한번 꼭 안아주며 가이딩해준다*"));
    assert.ok(joined.endsWith("만족해"), `expected tail preserved, got: ${joined}`);
    assert.ok(!joined.endsWith("만족"), `should not drop final syllable, got: ${joined}`);
  });
});
