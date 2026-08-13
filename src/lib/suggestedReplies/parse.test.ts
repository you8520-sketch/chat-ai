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
import { SUGGESTED_REPLY_MAX_CHARS, SUGGESTED_REPLY_MIN_CHARS, suggestedReplyKindMeta } from "./types";

function padReply(seed: string, length: number): string {
  const filler = "가".repeat(Math.max(0, length - seed.length));
  return `${seed}${filler}`.slice(0, length);
}

describe("suggested reply kinds", () => {
  it("labels escalate, soften, and pivot with short Korean hints", () => {
    assert.equal(suggestedReplyKindMeta("escalate").label, "갈등 고조");
    assert.equal(suggestedReplyKindMeta("soften").label, "달래기");
    assert.equal(suggestedReplyKindMeta("pivot").label, "국면 전환");
    assert.match(suggestedReplyKindMeta("escalate").hint, /긴장/);
    assert.match(suggestedReplyKindMeta("soften").hint, /물러서/);
    assert.match(suggestedReplyKindMeta("pivot").hint, /다른 길/);
  });
});

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
  it("keeps exactly three kinds even from a plain string list", () => {
    const replies = [
      padReply("*한 걸음 다가서며* \"지금 그 말, 진심이야?\" ", 80),
      padReply("(목소리를 낮추고) \"그럼 여기서 끝내지 마.\" ", 80),
      padReply("*손목을 붙잡으며* \"도망칠 생각이면 말해.\" ", 80),
    ];
    assert.deepEqual(normalizeSuggestedReplies({ replies }), [
      { kind: "escalate", text: replies[0] },
      { kind: "soften", text: replies[1] },
      { kind: "pivot", text: replies[2] },
    ]);
  });

  it("returns empty when fewer than three survive", () => {
    assert.deepEqual(
      normalizeSuggestedReplies({
        replies: [padReply("*다가서며* \"거짓말이지?\" ", 80), "짧다"],
      }),
      []
    );
  });

  it("reorders typed items onto escalate / soften / pivot", () => {
    const escalate = padReply("*소매를 잡으며* \"그걸 지금 말이라고 해?\" ", 72);
    const soften = padReply("(한숨을 삼키고) \"잠깐만, 나도 좀 쉬자.\" ", 72);
    const pivot = padReply("*창가 쪽으로 몸을 돌리며* \"일단 밖으로 나가.\" ", 72);
    assert.deepEqual(
      normalizeSuggestedReplies({
        items: [
          { kind: "pivot", text: pivot },
          { kind: "escalate", text: escalate },
          { kind: "soften", text: soften },
        ],
      }),
      [
        { kind: "escalate", text: escalate },
        { kind: "soften", text: soften },
        { kind: "pivot", text: pivot },
      ]
    );
  });
});

describe("parseSuggestedRepliesFromModelText", () => {
  it("reads fenced JSON items", () => {
    const escalate = padReply("*소매를 잡으며* \"그걸 지금 말이라고 해?\" ", 72);
    const soften = padReply("(한숨을 삼키고) \"좋아, 일단 앉아.\" ", 72);
    const pivot = padReply("*문을 가리키며* \"여기서 말 말고 나가서 하자.\" ", 72);
    const text = `\`\`\`json\n${JSON.stringify({
      items: [
        { kind: "escalate", text: escalate },
        { kind: "soften", text: soften },
        { kind: "pivot", text: pivot },
      ],
    })}\n\`\`\``;
    assert.deepEqual(parseSuggestedRepliesFromModelText(text), [
      { kind: "escalate", text: escalate },
      { kind: "soften", text: soften },
      { kind: "pivot", text: pivot },
    ]);
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
