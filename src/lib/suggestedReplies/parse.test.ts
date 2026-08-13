import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeSuggestedReply,
  normalizeSuggestedReplies,
  parseSuggestedRepliesFromModelText,
  parseSuggestedRepliesRecord,
  resolveClientSuggestedReplies,
  suggestedReplyCharCount,
} from "./parse";
import { SUGGESTED_REPLY_MAX_CHARS, SUGGESTED_REPLY_MIN_CHARS } from "./types";

function padReply(seed: string, length: number): string {
  const filler = "가".repeat(Math.max(0, length - seed.length));
  return `${seed}${filler}`.slice(0, length);
}

describe("suggested reply length", () => {
  it("rejects shorter than 50 characters", () => {
    assert.equal(normalizeSuggestedReply("짧다"), null);
    assert.equal(normalizeSuggestedReply(padReply("짧은대사 ", 49)), null);
  });

  it("accepts 50–200 characters and clips longer text", () => {
    const minOk = padReply("*한숨을 쉬며* \"그건 아니야.\" ", SUGGESTED_REPLY_MIN_CHARS);
    const maxOk = padReply("*한숨을 쉬며* \"그건 아니야.\" ", SUGGESTED_REPLY_MAX_CHARS);
    assert.equal(normalizeSuggestedReply(minOk), minOk);
    assert.equal(suggestedReplyCharCount(normalizeSuggestedReply(maxOk) ?? ""), SUGGESTED_REPLY_MAX_CHARS);

    const tooLong = padReply("*다가서며* \"거짓말이지?\" ", 240);
    const clipped = normalizeSuggestedReply(tooLong);
    assert.ok(clipped);
    assert.equal(suggestedReplyCharCount(clipped), SUGGESTED_REPLY_MAX_CHARS);
  });
});

describe("normalizeSuggestedReplies", () => {
  it("keeps exactly three distinct valid replies", () => {
    const replies = [
      padReply("*한 걸음 다가서며* \"지금 그 말, 진심이야?\" ", 80),
      padReply("(목소리를 낮추고) \"그럼 여기서 끝내지 마.\" ", 80),
      padReply("*손목을 붙잡으며* \"도망칠 생각이면 말해.\" ", 80),
    ];
    assert.deepEqual(normalizeSuggestedReplies({ replies }), replies);
  });

  it("returns empty when fewer than three survive", () => {
    assert.deepEqual(
      normalizeSuggestedReplies({
        replies: [padReply("*다가서며* \"거짓말이지?\" ", 80), "짧다"],
      }),
      []
    );
  });
});

describe("parseSuggestedRepliesFromModelText", () => {
  it("reads fenced JSON", () => {
    const a = padReply("*소매를 잡으며* \"그걸 지금 말이라고 해?\" ", 72);
    const b = padReply("(한숨을 삼키고) \"좋아, 그럼 진짜로 해보자.\" ", 72);
    const c = padReply("*눈을 피하지 않고* \"네가 먼저 선을 넘었어.\" ", 72);
    const text = `\`\`\`json\n${JSON.stringify({ replies: [a, b, c] })}\n\`\`\``;
    assert.deepEqual(parseSuggestedRepliesFromModelText(text), [a, b, c]);
  });
});

describe("resolveClientSuggestedReplies", () => {
  it("exposes pending without copying empty replies", () => {
    const fields = resolveClientSuggestedReplies({
      replies: [],
      extractedAt: "2026-01-01T00:00:00.000Z",
      source: "background-deepseek",
      pending: true,
    });
    assert.deepEqual(fields.suggestedReplies, []);
    assert.equal(fields.suggestedRepliesPending, true);
    assert.equal(fields.suggestedRepliesRequested, true);
    assert.equal(fields.suggestedRepliesFailed, false);
  });

  it("returns empty client fields for missing records", () => {
    assert.equal(parseSuggestedRepliesRecord(null), null);
    const fields = resolveClientSuggestedReplies(null);
    assert.equal(fields.suggestedRepliesRequested, false);
    assert.deepEqual(fields.suggestedReplies, []);
  });
});
