import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeCommentTextForModeration } from "@/lib/commentTextNormalize";

describe("normalizeCommentTextForModeration", () => {
  it("normalizes spaced and punctuated profanity variants", () => {
    const samples = ["시.발", "시 발", "ㅅ1발", "ㅅ|발"];
    for (const sample of samples) {
      assert.equal(normalizeCommentTextForModeration(sample), "시발", sample);
    }
  });

  it("lowercases and removes special characters", () => {
    assert.equal(normalizeCommentTextForModeration("AI충!!!"), "ai충");
  });
});
