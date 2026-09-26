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
  resolveSuggestedRepliesPollSnapshot,
  storedRepliesHaveStaleLegacyKinds,
  suggestedReplyCharCount,
} from "./parse";
import {
  SUGGESTED_REPLIES_CAPTION,
  SUGGESTED_REPLY_MAX_CHARS,
  SUGGESTED_REPLY_MIN_CHARS,
  suggestedReplyKindMeta,
} from "./types";

function padReply(seed: string, length: number): string {
  const filler = "가".repeat(Math.max(0, length - seed.length));
  return `${seed}${filler}`.slice(0, length);
}

describe("suggested reply kinds", () => {
  it("describes the actual full RP turn inserted into the composer", () => {
    assert.match(SUGGESTED_REPLIES_CAPTION, /행동과 대사/);
    assert.doesNotMatch(SUGGESTED_REPLIES_CAPTION, /대사만/);
  });

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

  it("fails closed instead of relabeling an explicit duplicate kind", () => {
    const naturalA = padReply("*고개를 들며* \"그 얘기부터 해보자.\" ", 72);
    const naturalB = padReply("*한 걸음 다가서며* \"나도 같은 쪽으로 갈게.\" ", 72);
    const banter = padReply("*웃음을 삼키며* \"이번엔 네가 먼저 말해.\" ", 72);
    assert.deepEqual(
      normalizeSuggestedReplies({
        items: [
          { kind: "natural", text: naturalA },
          { kind: "natural", text: naturalB },
          { kind: "banter", text: banter },
        ],
      }),
      []
    );
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
  it("fails closed when raw model items omit canonical kinds", () => {
    const replies = [
      padReply("*한 걸음 다가서며* \"첫 번째 응답이다.\" ", 72),
      padReply("*고개를 기울이며* \"두 번째 응답이다.\" ", 72),
      padReply("*작게 웃으며* \"세 번째 응답이다.\" ", 72),
    ];
    assert.deepEqual(
      parseSuggestedRepliesFromModelText(
        JSON.stringify({
          items: replies.map((text) => ({ text })),
        })
      ),
      []
    );
  });

  it("fails closed instead of clipping overlong raw model text", () => {
    const natural = padReply("*고개를 들며* \"계속 말해 봐.\" ", 201);
    const twist = padReply("*창가를 보며* \"방향을 바꿔 보자.\" ", 72);
    const banter = padReply("*웃으며* \"그럼 이번엔 네 차례야.\" ", 72);
    assert.deepEqual(
      parseSuggestedRepliesFromModelText(
        JSON.stringify({
          items: [
            { kind: "natural", text: natural },
            { kind: "twist", text: twist },
            { kind: "banter", text: banter },
          ],
        })
      ),
      []
    );
  });

  it("fails closed on wrong raw item count and duplicate raw text", () => {
    const natural = padReply("*고개를 들며* \"계속 말해 봐.\" ", 72);
    const duplicate = padReply("*창가를 보며* \"방향을 바꿔 보자.\" ", 72);

    assert.deepEqual(
      parseSuggestedRepliesFromModelText(
        JSON.stringify({
          items: [
            { kind: "natural", text: natural },
            { kind: "twist", text: duplicate },
          ],
        })
      ),
      []
    );

    assert.deepEqual(
      parseSuggestedRepliesFromModelText(
        JSON.stringify({
          items: [
            { kind: "natural", text: natural },
            { kind: "twist", text: duplicate },
            { kind: "banter", text: duplicate },
          ],
        })
      ),
      []
    );
  });

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

  it("treats a non-pending invalid stored record as terminal failure", () => {
    const fields = resolveClientSuggestedReplies({
      replies: [
        { kind: "natural", text: padReply("*고개를 들며* \"계속 말해 봐.\" ", 72) },
      ],
      extractedAt: "2026-01-01T00:00:00.000Z",
      source: "post-turn-shared",
      pending: false,
      failed: false,
      noRetry: true,
    });
    assert.deepEqual(fields.suggestedReplies, []);
    assert.equal(fields.suggestedRepliesPending, false);
    assert.equal(fields.suggestedRepliesRequested, true);
    assert.equal(fields.suggestedRepliesFailed, true);
    assert.equal(clientNeedsSuggestedRepliesPoll(fields), false);
    assert.equal(clientShouldShowSuggestedRepliesBar(fields), false);
  });

  it("returns empty client fields for missing records", () => {
    assert.equal(parseSuggestedRepliesRecord(null), null);
    const fields = resolveClientSuggestedReplies(null);
    assert.equal(fields.suggestedRepliesRequested, false);
    assert.deepEqual(fields.suggestedReplies, []);
  });
});

describe("read-only suggested-replies poll snapshot", () => {
  const replies = [
    { kind: "natural" as const, text: "a".repeat(60) },
    { kind: "twist" as const, text: "b".repeat(60) },
    { kind: "banter" as const, text: "c".repeat(60) },
  ];

  it("waits only for an explicitly pending snapshot", () => {
    assert.deepEqual(
      resolveSuggestedRepliesPollSnapshot({
        pending: true,
        requested: true,
        failed: false,
        replies: [],
      }),
      { state: "pending", replies: [] }
    );
  });

  it("returns ready canonical replies immediately", () => {
    assert.deepEqual(
      resolveSuggestedRepliesPollSnapshot({
        pending: false,
        requested: true,
        failed: false,
        replies,
      }),
      { state: "ready", replies }
    );
  });

  it("fails immediately for a missing non-pending record", () => {
    assert.deepEqual(
      resolveSuggestedRepliesPollSnapshot({
        pending: false,
        requested: false,
        failed: false,
        replies: [],
      }),
      { state: "failed", replies: [] }
    );
  });

  it("fails immediately for a malformed non-pending snapshot even if failed=false", () => {
    assert.deepEqual(
      resolveSuggestedRepliesPollSnapshot({
        pending: false,
        requested: true,
        failed: false,
        replies: [{ kind: "natural", text: "a".repeat(60) }],
      }),
      { state: "failed", replies: [] }
    );
  });
});

describe("client suggested-replies poll / bar", () => {
  const empty = {
    suggestedReplies: [] as const,
    suggestedRepliesPending: false,
    suggestedRepliesRequested: false,
    suggestedRepliesFailed: false,
  };

  it("does not poll or show for a completely missing record", () => {
    assert.equal(clientNeedsSuggestedRepliesPoll(empty), false);
    assert.equal(clientShouldShowSuggestedRepliesBar(empty), false);
  });

  it("still polls and shows when the generation was explicitly requested", () => {
    const requested = {
      ...empty,
      suggestedRepliesRequested: true,
    };
    assert.equal(clientNeedsSuggestedRepliesPoll(requested), true);
    assert.equal(clientShouldShowSuggestedRepliesBar(requested), true);
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

describe("legacy explicit kinds fail closed", () => {
  it("detects stale escalate/soften/pivot kinds", () => {
    assert.equal(
      storedRepliesHaveStaleLegacyKinds([
        { kind: "escalate", text: padReply("*맞서며* \"그만.\" ", 60) },
        { kind: "soften", text: padReply("*달래며* \"괜찮아.\" ", 60) },
        { kind: "pivot", text: padReply("*돌아서며* \"다른 얘기.\" ", 60) },
      ]),
      true
    );
  });

  it("does not relabel legacy explicit kinds under natural/twist/banter", () => {
    const raw = JSON.stringify({
      replies: [
        { kind: "escalate", text: padReply("*맞서며* \"강하게 맞서는 답변입니다.\" ", 72) },
        { kind: "soften", text: padReply("*달래며* \"달래는 답변입니다.\" ", 72) },
        { kind: "pivot", text: padReply("*돌아서며* \"장면 전환 답변입니다.\" ", 72) },
      ],
      extractedAt: new Date().toISOString(),
      source: "post-turn-shared",
      pending: false,
      failed: false,
    });
    const record = parseSuggestedRepliesRecord(raw);
    assert.equal(record?.failed, true);
    assert.equal("noRetry" in (record ?? {}), false);
    assert.deepEqual(record?.replies, []);

    const client = resolveClientSuggestedReplies(record);
    assert.deepEqual(client.suggestedReplies, []);
    assert.equal(client.suggestedRepliesFailed, true);
    assert.equal(clientNeedsSuggestedRepliesPoll(client), false);
    assert.equal(clientShouldShowSuggestedRepliesBar(client), false);
  });

  it("string-only legacy rows still map by index", () => {
    const replies = [
      padReply("*한 걸음* \"자연스럽게.\" ", 60),
      padReply("*고개를 돌리며* \"각도 전환.\" ", 60),
      padReply("*웃으며* \"드립 한 방.\" ", 60),
    ];
    const record = parseSuggestedRepliesRecord(
      JSON.stringify({
        replies,
        extractedAt: new Date().toISOString(),
        source: "post-turn-shared",
      })
    );
    assert.deepEqual(
      normalizeSuggestedReplies(record?.replies),
      [
        { kind: "natural", text: replies[0] },
        { kind: "twist", text: replies[1] },
        { kind: "banter", text: replies[2] },
      ]
    );
  });
});
