import Module from "module";

const originalLoad = (Module as unknown as { _load: typeof Module._load })._load;
(Module as unknown as { _load: typeof Module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { executeLastTurnDeleteTransaction } from "@/lib/chatLastTurnDelete";
import { formatMemoryMetaForPrompt } from "@/lib/chatMemory";
import { snapshotForkRelationshipMeta } from "@/lib/memory/memory-fork-snapshot";
import {
  applyRelationshipDeltaToChat,
  loadChatRelationshipMeta,
  mergeRelationshipMetaAfterRegenerate,
  reprojectRelationshipMetaForVariantSwitchCore,
} from "@/lib/memory/memory-relationship-meta";
import { reconcileDerivedMemoryAfterUserMessageEditCore } from "@/lib/memory/memory-reconcile";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import { getMemorySourceBoundary } from "@/lib/memory/memory-source-boundary";
import { resolveMemorySourceTurnIdentityCore } from "@/lib/memory/memory-turn-loader";
import { normalizeMessageVariants } from "@/lib/messageAlternates";

const CHAT_ID = 883101;
const USER_ID = 883102;
const CHAR_ID = 883103;
const NAMES = { charName: "TestChar", userName: "Tester" };
const KEPT_PROMISE = {
  text: "내일 밤 북문에서 만나기로 했다.",
  deadline: "내일 밤",
};
const PARAPHRASE_PROMISE = {
  text: "비가 그치면 옥상에서 표본을 확인하되 손대지 않는다.",
  deadline: "오늘 저녁",
};
const OTHER_TURN_PROMISE = {
  text: "서재의 청동열쇠를 계속 보관한다.",
};
const LATER_PROMISE = {
  text: "서고의 청동열쇠는 내일까지 그 자리에 둔다.",
  deadline: "내일",
};
const LATER_ITEM = "Tester: 청동열쇠";

function cleanup(): void {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT_ID);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT_ID);
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR_ID);
}

function seed(): void {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER_ID,
    `rel-del-${USER_ID}@test.local`,
    "Tester",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR_ID, "TestChar");
  db.prepare(
    `INSERT INTO chats (id, user_id, character_id, mode, memory_meta)
     VALUES (?,?,?,'safe',?)`
  ).run(CHAT_ID, USER_ID, CHAR_ID, JSON.stringify({ honorifics: [], items: [], thoughts: [], promises: [] }));
  getOrCreateChatMemory(CHAT_ID, USER_ID, CHAR_ID, "free");
}

function insertTurn(opts: {
  userId: number;
  assistantId: number;
  userText: string;
  assistantText: string;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, model, user_message_id, generation_status)
     VALUES (?, ?, 'user', ?, '', NULL, 'completed')`
  ).run(opts.userId, CHAT_ID, opts.userText);
  db.prepare(
    `INSERT INTO messages (id, chat_id, role, content, model, user_message_id, generation_status)
     VALUES (?, ?, 'assistant', ?, 'test', ?, 'completed')`
  ).run(opts.assistantId, CHAT_ID, opts.assistantText, opts.userId);
}

function applyDelta(
  assistantMessageId: number,
  userMessageId: number,
  delta: Parameters<typeof applyRelationshipDeltaToChat>[0]["delta"]
) {
  return applyRelationshipDeltaToChat({
    chatId: CHAT_ID,
    names: NAMES,
    delta,
    sourceUserMessageId: userMessageId,
    boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
    assistantMessageId,
    generationScope: {
      assistantMessageId,
      generationSequence: 0,
      generationRequestId: null,
    },
  });
}

function clearBeforeJson(assistantMessageId: number): void {
  getDb()
    .prepare("UPDATE messages SET memory_relationship_before_json=NULL WHERE id=?")
    .run(assistantMessageId);
}

function stripCommittedDelta(assistantMessageId: number): void {
  const db = getDb();
  const row = db
    .prepare("SELECT alternates FROM messages WHERE id=?")
    .get(assistantMessageId) as { alternates: string | null } | undefined;
  if (!row?.alternates) return;
  const parsed = JSON.parse(row.alternates) as Array<Record<string, unknown>>;
  if (!Array.isArray(parsed)) return;
  for (const variant of parsed) delete variant.relationshipMetaDelta;
  db.prepare("UPDATE messages SET alternates=? WHERE id=?").run(
    JSON.stringify(parsed),
    assistantMessageId
  );
}

function deleteLastTurn(userMessageId: number, assistantMessageId: number) {
  return executeLastTurnDeleteTransaction(getDb(), {
    chatId: CHAT_ID,
    characterId: CHAR_ID,
    userMessageId,
    assistantMessageId,
    revertNumeric: false,
    relationshipMetaNames: NAMES,
  });
}

function promises(): string[] {
  return loadChatRelationshipMeta(CHAT_ID, NAMES).promises.map((row) => row.text);
}

function items(): string[] {
  return loadChatRelationshipMeta(CHAT_ID, NAMES).items;
}

/** Projection writer that does not refresh any assistant variant snapshot. */
function applyUnscopedDelta(
  delta: Parameters<typeof applyRelationshipDeltaToChat>[0]["delta"],
  sourceUserMessageId: number
) {
  return applyRelationshipDeltaToChat({
    chatId: CHAT_ID,
    names: NAMES,
    delta,
    sourceUserMessageId,
    boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
  });
}

function editUserSource(userMessageId: number, nextText: string): void {
  const db = getDb();
  const previousUserText = (
    db.prepare("SELECT content FROM messages WHERE id=?").get(userMessageId) as {
      content: string;
    }
  ).content;
  const identity = resolveMemorySourceTurnIdentityCore(db, CHAT_ID, userMessageId);
  if (!identity) throw new Error("missing memory turn identity");
  db.transaction(() => {
    db.prepare("UPDATE messages SET content=? WHERE id=?").run(nextText, userMessageId);
    reconcileDerivedMemoryAfterUserMessageEditCore(db, {
      chatId: CHAT_ID,
      userId: USER_ID,
      characterId: CHAR_ID,
      tier: "free",
      memoryCapacity: 10_000,
      memoryTurnNumber: identity.memoryTurnNumber,
      sourceUserMessageId: identity.sourceUserMessageId,
      sourceAssistantMessageId: identity.sourceAssistantMessageId,
      previousUserText,
    });
  }).immediate();
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());
beforeEach(() => {
  process.env.MEMORY_FEATURE_ENABLED = "1";
  seed();
});

describe("relationship ledger last-turn delete residue", () => {
  it("A keeps a live-worldline promise when that turn is not deleted", () => {
    insertTurn({
      userId: 1,
      assistantId: 2,
      userText: "북문에서 만나자",
      assistantText: "내일 밤 북문에서 만나기로 했다.",
    });
    const applied = applyDelta(2, 1, { promisesAdd: [KEPT_PROMISE] });
    assert.equal(applied.accepted, true);
    assert.deepEqual(promises(), [KEPT_PROMISE.text]);
    assert.match(formatMemoryMetaForPrompt(applied.meta) ?? "", /내일 밤 북문에서 만나기로 했다/);
  });

  it("B restores the exact before snapshot when last-turn delete has provenance", () => {
    insertTurn({
      userId: 1,
      assistantId: 2,
      userText: "북문에서 만나자",
      assistantText: "내일 밤 북문에서 만나기로 했다.",
    });
    applyDelta(2, 1, { promisesAdd: [KEPT_PROMISE] });
    insertTurn({
      userId: 3,
      assistantId: 4,
      userText: "표본을 보자",
      assistantText: "비가 그치면 옥상에서 표본을 확인하되 손대지 않는다.",
    });
    applyDelta(4, 3, { promisesAdd: [PARAPHRASE_PROMISE] });
    assert.deepEqual(promises(), [KEPT_PROMISE.text, PARAPHRASE_PROMISE.text]);

    deleteLastTurn(3, 4);
    assert.deepEqual(promises(), [KEPT_PROMISE.text]);
  });

  it("C drops a paraphrased leftover from the deleted turn's committed delta when before is missing", () => {
    insertTurn({
      userId: 1,
      assistantId: 2,
      userText: "북문에서 만나자",
      assistantText: "내일 밤 북문에서 만나기로 했다.",
    });
    applyDelta(2, 1, { promisesAdd: [KEPT_PROMISE] });
    insertTurn({
      userId: 3,
      assistantId: 4,
      userText: "잠깐 옥상에 가자",
      assistantText: "비가 그치면 표본을 보러 가자고 했다.",
    });
    applyDelta(4, 3, { promisesAdd: [PARAPHRASE_PROMISE] });
    clearBeforeJson(4);
    assert.equal(
      (
        getDb()
          .prepare("SELECT memory_relationship_before_json AS v FROM messages WHERE id=4")
          .get() as { v: string | null }
      ).v,
      null
    );
    assert.ok(!("비가 그치면 옥상에서 표본을 확인하되 손대지 않는다." === "비가 그치면 표본을 보러 가자고 했다."));

    deleteLastTurn(3, 4);
    assert.deepEqual(promises(), [KEPT_PROMISE.text]);
    assert.equal(promises().includes(PARAPHRASE_PROMISE.text), false);
  });

  it("C2 leaves snapshot-less unknown promises untouched instead of guessing", () => {
    insertTurn({
      userId: 1,
      assistantId: 2,
      userText: "이전 장면",
      assistantText: "이전 어시스턴트",
    });
    insertTurn({
      userId: 3,
      assistantId: 4,
      userText: "잠깐 옥상에 가자",
      assistantText: "비가 그치면 표본을 보러 가자고 했다.",
    });
    getDb()
      .prepare("UPDATE chats SET memory_meta=? WHERE id=?")
      .run(
        JSON.stringify({
          honorifics: [],
          items: [],
          thoughts: [],
          promises: [KEPT_PROMISE, PARAPHRASE_PROMISE],
        }),
        CHAT_ID
      );

    deleteLastTurn(3, 4);
    assert.deepEqual(promises().sort(), [KEPT_PROMISE.text, PARAPHRASE_PROMISE.text].sort());
  });

  it("D keeps a paraphrased promise that still exists on a remaining turn", () => {
    insertTurn({
      userId: 1,
      assistantId: 2,
      userText: "약속도 남겨 둬",
      assistantText: `${PARAPHRASE_PROMISE.text} 그리고 북문 약속도 유효하다.`,
    });
    applyDelta(2, 1, { promisesAdd: [KEPT_PROMISE, PARAPHRASE_PROMISE] });
    insertTurn({
      userId: 3,
      assistantId: 4,
      userText: "다시 확인하자",
      assistantText: "표본 이야기는 이미 앞에서 남겼다.",
    });
    applyDelta(4, 3, { promisesAdd: [] });
    clearBeforeJson(4);

    deleteLastTurn(3, 4);
    assert.deepEqual(promises(), [KEPT_PROMISE.text, PARAPHRASE_PROMISE.text]);
  });

  it("E keeps an earlier-turn promise and a user-edited summary when a later turn is deleted", () => {
    insertTurn({
      userId: 1,
      assistantId: 2,
      userText: "열쇠는 네가 보관해",
      assistantText: OTHER_TURN_PROMISE.text,
    });
    applyDelta(2, 1, { promisesAdd: [OTHER_TURN_PROMISE] });
    getDb()
      .prepare(
        `INSERT INTO chat_turn_summaries
          (chat_id, turn_number, turn_end, summary, summary_kind, user_edited, inactive)
         VALUES (?, 1, 1, ?, 'main_canon', 1, 0)`
      )
      .run(CHAT_ID, "사용자가 고친 1턴 요약. 청동열쇠 보관은 유지한다.");
    insertTurn({
      userId: 3,
      assistantId: 4,
      userText: "옥상에 가자",
      assistantText: "비가 그치면 표본을 보러 가자고 했다.",
    });
    applyDelta(4, 3, { promisesAdd: [PARAPHRASE_PROMISE] });
    clearBeforeJson(4);

    deleteLastTurn(3, 4);
    assert.deepEqual(promises(), [OTHER_TURN_PROMISE.text]);
    const edited = getDb()
      .prepare(
        `SELECT user_edited AS edited, summary FROM chat_turn_summaries WHERE chat_id=?`
      )
      .get(CHAT_ID) as { edited: number; summary: string };
    assert.equal(edited.edited, 1);
    assert.match(edited.summary, /사용자가 고친 1턴 요약/);
  });

  it("F does not reimport leftover promises from generations, regen, variant switch, or fork", async () => {
    insertTurn({
      userId: 1,
      assistantId: 2,
      userText: "북문에서 만나자",
      assistantText: "내일 밤 북문에서 만나기로 했다.",
    });
    applyDelta(2, 1, { promisesAdd: [KEPT_PROMISE] });
    insertTurn({
      userId: 3,
      assistantId: 4,
      userText: "옥상에 가자",
      assistantText: "비가 그치면 표본을 보러 가자고 했다.",
    });
    applyDelta(4, 3, { promisesAdd: [PARAPHRASE_PROMISE] });
    clearBeforeJson(4);

    const db = getDb();
    if (
      db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='message_generations'").get()
    ) {
      db.prepare(
        `INSERT INTO message_generations
          (message_id, chat_id, user_id, character_id, variant_index, user_message_id,
           model, provider, route, writing_style, nsfw, input_tokens, output_tokens,
           prompt_hash, context_json)
         VALUES (4, ?, ?, ?, 0, 3, 'test', 'none', 'safe', 'default', 0, 1, 1, 'x', ?)`
      ).run(
        CHAT_ID,
        USER_ID,
        CHAR_ID,
        JSON.stringify({ leftoverPromise: PARAPHRASE_PROMISE.text, completedTurns: 36 })
      );
    }

    deleteLastTurn(3, 4);
    assert.deepEqual(promises(), [KEPT_PROMISE.text]);

    await mergeRelationshipMetaAfterRegenerate({
      chatId: CHAT_ID,
      names: NAMES,
      userMessage: "북문에서 만나자",
      newAssistantMessage: "내일 밤 북문에서 만나기로 했다.",
      previousAssistantMessage: "내일 밤 북문에서 만나기로 했다.",
      route: "safe",
      sourceUserMessageId: 1,
      boundarySnapshot: getMemorySourceBoundary(CHAT_ID),
      assistantMessageId: 2,
      generationScope: {
        assistantMessageId: 2,
        generationSequence: 0,
        generationRequestId: null,
      },
      sharedInitialAttempted: true,
      sharedInitialParsed: true,
      sharedInitialDelta: {},
    });
    assert.deepEqual(promises(), [KEPT_PROMISE.text]);

    const remaining = normalizeMessageVariants(
      db
        .prepare(
          "SELECT content, model, usage, alternates, active_variant FROM messages WHERE id=2"
        )
        .get() as {
        content: string;
        model: string;
        usage: string | null;
        alternates: string | null;
        active_variant: number | null;
      }
    );
    const after = remaining.variants[remaining.activeVariant]?.relationshipMetaAfter;
    assert.ok(after);
    const switched = reprojectRelationshipMetaForVariantSwitchCore(db, {
      chatId: CHAT_ID,
      activeRelationshipMetaAfter: after,
      selectedRelationshipMetaAfter: after,
    });
    assert.equal(switched, "already_selected");
    assert.deepEqual(promises(), [KEPT_PROMISE.text]);

    insertTurn({
      userId: 5,
      assistantId: 6,
      userText: "또 다른 잔여",
      assistantText: "차수경을 만나러 가자고 했다.",
    });
    applyDelta(6, 5, {
      promisesAdd: [{ text: "모레 접수처에서 차수경을 만난다.", deadline: "모레" }],
    });
    clearBeforeJson(6);
    deleteLastTurn(5, 6);
    assert.deepEqual(promises(), [KEPT_PROMISE.text]);
    deleteLastTurn(1, 2);
    assert.deepEqual(promises(), []);

    const forked = JSON.parse(
      snapshotForkRelationshipMeta({
        parentMemoryMeta: JSON.stringify({
          honorifics: [],
          items: [],
          thoughts: [],
          promises: [KEPT_PROMISE, PARAPHRASE_PROMISE],
        }),
        copiedContents: ["내일 밤 북문에서 만나기로 했다."],
      })
    ) as { promises: Array<{ text: string }> };
    assert.deepEqual(
      forked.promises.map((row) => row.text),
      [KEPT_PROMISE.text]
    );
  });

  it("does not resurrect a promise removed by a canonical user-source edit", () => {
    insertTurn({
      userId: 1,
      assistantId: 2,
      userText: KEPT_PROMISE.text,
      assistantText: "그 말은 들었다.",
    });
    applyDelta(2, 1, { promisesAdd: [KEPT_PROMISE] });
    insertTurn({
      userId: 3,
      assistantId: 4,
      userText: "그냥 걷자",
      assistantText: "말은 더 보태지 않았다.",
    });
    const zero = applyDelta(4, 3, {});
    assert.equal(zero.accepted, true);
    assert.equal(
      (
        getDb()
          .prepare("SELECT memory_relationship_before_json AS v FROM messages WHERE id=4")
          .get() as { v: string | null }
      ).v,
      null
    );

    editUserSource(1, "그 약속은 없던 일로 하자.");
    assert.equal(promises().includes(KEPT_PROMISE.text), false);

    deleteLastTurn(3, 4);
    assert.equal(promises().includes(KEPT_PROMISE.text), false);
  });

  it("keeps a later canonical promise and item when the last turn is deleted", () => {
    insertTurn({
      userId: 1,
      assistantId: 2,
      userText: "북문에서 만나자",
      assistantText: "내일 밤 북문에서 만나기로 했다.",
    });
    applyDelta(2, 1, { promisesAdd: [KEPT_PROMISE] });
    insertTurn({
      userId: 3,
      assistantId: 4,
      userText: "잠깐 옥상에 가자",
      assistantText: "비가 그치면 표본을 보러 가자고 했다.",
    });
    applyDelta(4, 3, { promisesAdd: [PARAPHRASE_PROMISE] });
    const added = applyUnscopedDelta(
      { promisesAdd: [LATER_PROMISE], items: [LATER_ITEM] },
      1
    );
    assert.equal(added.accepted, true);
    assert.equal(promises().includes(LATER_PROMISE.text), true);
    assert.equal(items().includes(LATER_ITEM), true);

    deleteLastTurn(3, 4);
    assert.equal(promises().includes(LATER_PROMISE.text), true);
    assert.equal(items().includes(LATER_ITEM), true);
    assert.equal(promises().includes(KEPT_PROMISE.text), true);
    assert.equal(promises().includes(PARAPHRASE_PROMISE.text), false);
  });

  it("does not attribute a pre-turn ledger change to the deleted zero-delta turn", () => {
    insertTurn({
      userId: 1,
      assistantId: 2,
      userText: "북문에서 만나자",
      assistantText: "내일 밤 북문에서 만나기로 했다.",
    });
    applyDelta(2, 1, { promisesAdd: [KEPT_PROMISE] });
    const added = applyUnscopedDelta(
      { promisesAdd: [LATER_PROMISE], items: [LATER_ITEM] },
      1
    );
    assert.equal(added.accepted, true);
    insertTurn({
      userId: 3,
      assistantId: 4,
      userText: "그냥 걷자",
      assistantText: "말은 더 보태지 않았다.",
    });
    applyDelta(4, 3, {});
    const remaining = normalizeMessageVariants(
      getDb()
        .prepare(
          "SELECT content, model, usage, alternates, active_variant FROM messages WHERE id=2"
        )
        .get() as {
        content: string;
        model: string;
        usage: string | null;
        alternates: string | null;
        active_variant: number | null;
      }
    );
    const after = remaining.variants[remaining.activeVariant]?.relationshipMetaAfter;
    assert.equal(
      after?.promises.some((row) => row.text === LATER_PROMISE.text),
      false
    );
    assert.equal(after?.items.includes(LATER_ITEM), false);

    deleteLastTurn(3, 4);
    assert.equal(promises().includes(LATER_PROMISE.text), true);
    assert.equal(items().includes(LATER_ITEM), true);
    assert.equal(promises().includes(KEPT_PROMISE.text), true);
  });

  it("does not replace the ledger from a surviving after snapshot that has no committed delta", () => {
    insertTurn({
      userId: 1,
      assistantId: 2,
      userText: "북문에서 만나자",
      assistantText: "내일 밤 북문에서 만나기로 했다.",
    });
    applyDelta(2, 1, { promisesAdd: [KEPT_PROMISE] });
    insertTurn({
      userId: 3,
      assistantId: 4,
      userText: "잠깐 옥상에 가자",
      assistantText: "비가 그치면 표본을 보러 가자고 했다.",
    });
    applyDelta(4, 3, { promisesAdd: [PARAPHRASE_PROMISE] });
    clearBeforeJson(4);
    stripCommittedDelta(4);

    deleteLastTurn(3, 4);
    assert.deepEqual(promises().sort(), [KEPT_PROMISE.text, PARAPHRASE_PROMISE.text].sort());
  });
});
