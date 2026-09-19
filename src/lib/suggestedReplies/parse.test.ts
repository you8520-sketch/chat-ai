import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clientNeedsSuggestedRepliesPoll,
  clientShouldShowSuggestedRepliesBar,
  normalizeSuggestedReply,
  normalizeSuggestedReplies,
  parseSuggestedRepliesFromModelText,
  parseSuggestedRepliesRecord,
  resolveClientSuggestedReplies,
  shouldEnsureSuggestedRepliesExtraction,
  suggestedReplyCharCount,
} from "./parse";
import { SUGGESTED_REPLY_MAX_CHARS, SUGGESTED_REPLY_MIN_CHARS, suggestedReplyKindMeta } from "./types";

function padReply(seed: string, length: number): string {
  const filler = "가".repeat(Math.max(0, length - seed.length));
  return `${seed}${filler}`.slice(0, length);
}

describe("suggested reply kinds", () => {
  it("labels natural, twist, and banter with short Korean hints", () => {
    assert.equal(suggestedReplyKindMeta("natural").label, "정석");
    assert.equal(suggestedReplyKindMeta("twist").label, "한 수");
    assert.equal(suggestedReplyKindMeta("banter").label, "드립");
    assert.match(suggestedReplyKindMeta("natural").hint, /자연/);
    assert.match(suggestedReplyKindMeta("twist").hint, /각도/);
    assert.match(suggestedReplyKindMeta("banter").hint, /재치/);
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
      { kind: "natural", text: replies[0] },
      { kind: "twist", text: replies[1] },
      { kind: "banter", text: replies[2] },
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

  it("reorders typed items onto natural / twist / banter", () => {
    const natural = padReply("*소매를 잡으며* \"그걸 지금 말이라고 해?\" ", 72);
    const twist = padReply("(한숨을 삼키고) \"잠깐만, 나도 좀 쉬자.\" ", 72);
    const banter = padReply("*창가 쪽으로 몸을 돌리며* \"일단 밖으로 나가.\" ", 72);
    assert.deepEqual(
      normalizeSuggestedReplies({
        items: [
          { kind: "banter", text: banter },
          { kind: "natural", text: natural },
          { kind: "twist", text: twist },
        ],
      }),
      [
        { kind: "natural", text: natural },
        { kind: "twist", text: twist },
        { kind: "banter", text: banter },
      ]
    );
  });
});

describe("parseSuggestedRepliesFromModelText", () => {
  it("reads fenced JSON items", () => {
    const natural = padReply("*소매를 잡으며* \"그걸 지금 말이라고 해?\" ", 72);
    const twist = padReply("(한숨을 삼키고) \"좋아, 일단 앉아.\" ", 72);
    const banter = padReply("*문을 가리키며* \"여기서 말 말고 나가서 하자.\" ", 72);
    const text = `\`\`\`json\n${JSON.stringify({
      items: [
        { kind: "natural", text: natural },
        { kind: "twist", text: twist },
        { kind: "banter", text: banter },
      ],
    })}\n\`\`\``;
    assert.deepEqual(parseSuggestedRepliesFromModelText(text), [
      { kind: "natural", text: natural },
      { kind: "twist", text: twist },
      { kind: "banter", text: banter },
    ]);
  });
});

describe("resolveClientSuggestedReplies", () => {
  it("exposes pending without copying empty replies", () => {
    const fields = resolveClientSuggestedReplies({
      replies: [],
      extractedAt: "2026-01-01T00:00:00.000Z",
      source: "post-turn-shared",
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

describe("client suggested-replies poll / bar", () => {
  const empty = {
    suggestedReplies: [] as const,
    suggestedRepliesPending: false,
    suggestedRepliesRequested: false,
    suggestedRepliesFailed: false,
  };

  it("polls and shows the bar for missing records on existing chats", () => {
    assert.equal(clientNeedsSuggestedRepliesPoll(empty), true);
    assert.equal(clientShouldShowSuggestedRepliesBar(empty), true);
  });

  it("polls while pending and hides after a hard failure", () => {
    assert.equal(
      clientNeedsSuggestedRepliesPoll({
        ...empty,
        suggestedRepliesRequested: true,
        suggestedRepliesPending: true,
      }),
      true
    );
    assert.equal(
      clientNeedsSuggestedRepliesPoll({
        ...empty,
        suggestedRepliesRequested: true,
        suggestedRepliesFailed: true,
      }),
      false
    );
    assert.equal(
      clientShouldShowSuggestedRepliesBar({
        ...empty,
        suggestedRepliesRequested: true,
        suggestedRepliesFailed: true,
      }),
      false
    );
  });

  it("does not poll when three replies are already present", () => {
    const replies = [
      { kind: "natural" as const, text: "a".repeat(60) },
      { kind: "twist" as const, text: "b".repeat(60) },
      { kind: "banter" as const, text: "c".repeat(60) },
    ];
    const fields = {
      suggestedReplies: replies,
      suggestedRepliesPending: false,
      suggestedRepliesRequested: true,
      suggestedRepliesFailed: false,
    };
    assert.equal(clientNeedsSuggestedRepliesPoll(fields), false);
    assert.equal(clientShouldShowSuggestedRepliesBar(fields), true);
  });
});

describe("shouldEnsureSuggestedRepliesExtraction", () => {
  const extractedAt = "2026-01-01T00:00:00.000Z";

  it("starts extraction when the last assistant has no stored JSON", () => {
    assert.equal(shouldEnsureSuggestedRepliesExtraction(null), true);
  });

  it("does not restart a fresh pending job", () => {
    assert.equal(
      shouldEnsureSuggestedRepliesExtraction(
        {
          replies: [],
          extractedAt: "2026-01-01T00:00:30.000Z",
          source: "post-turn-shared",
          pending: true,
        },
        Date.parse("2026-01-01T00:01:00.000Z")
      ),
      false
    );
  });

  it("restarts a pending job after 90s", () => {
    assert.equal(
      shouldEnsureSuggestedRepliesExtraction(
        {
          replies: [],
          extractedAt,
          source: "post-turn-shared",
          pending: true,
        },
        Date.parse("2026-01-01T00:02:00.000Z")
      ),
      true
    );
  });

  it("retries a failed job after 15s, not immediately", () => {
    const failed = {
      replies: [] as [],
      extractedAt,
      source: "post-turn-shared" as const,
      failed: true,
    };
    assert.equal(
      shouldEnsureSuggestedRepliesExtraction(failed, Date.parse("2026-01-01T00:00:10.000Z")),
      false
    );
    assert.equal(
      shouldEnsureSuggestedRepliesExtraction(failed, Date.parse("2026-01-01T00:00:16.000Z")),
      true
    );
  });

  it("leaves a completed three-reply record alone", () => {
    const replies = [
      { kind: "natural" as const, text: "a".repeat(60) },
      { kind: "twist" as const, text: "b".repeat(60) },
      { kind: "banter" as const, text: "c".repeat(60) },
    ];
    assert.equal(
      shouldEnsureSuggestedRepliesExtraction({
        replies,
        extractedAt,
        source: "post-turn-shared",
        pending: false,
        failed: false,
      }),
      false
    );
  });
});
