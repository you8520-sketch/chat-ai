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
import {
  applyRelationshipDeltaToChat,
  loadChatRelationshipMeta,
} from "@/lib/memory/memory-relationship-meta";
import {
  loadRelationshipLedgerEventsCore,
  selectPromiseHistoryForPrompt,
} from "@/lib/memory/memory-relationship-timeline";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import { getMemorySourceBoundary } from "@/lib/memory/memory-source-boundary";

const CHAT_ID = 884101;
const OTHER_CHAT_ID = 884104;
const USER_ID = 884102;
const CHAR_ID = 884103;
const NAMES = { charName: "TestChar", userName: "Tester" };
const PROMISE = { text: "금요일 저녁 한강에서 같이 야경을 보기로 했다.", deadline: "금요일" };
const CREATE_TURN = 10;
const CANCEL_TURN = 20;
const RECALL_TURN = 80;

const userIdOf = (turn: number) => 10_000 + turn * 2;
const assistantIdOf = (turn: number) => 10_001 + turn * 2;

function cleanup(): void {
  const db = getDb();
  for (const chatId of [CHAT_ID, OTHER_CHAT_ID]) {
    db.prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
    db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(chatId);
    db.prepare("DELETE FROM chats WHERE id=?").run(chatId);
  }
  db.prepare("DELETE FROM users WHERE id=?").run(USER_ID);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR_ID);
}

function seedChat(chatId: number): void {
  getDb()
    .prepare(
      `INSERT INTO chats (id, user_id, character_id, mode, memory_meta)
       VALUES (?,?,?,'safe',?)`
    )
    .run(
      chatId,
      USER_ID,
      CHAR_ID,
      JSON.stringify({ honorifics: [], items: [], thoughts: [], promises: [] })
    );
  getOrCreateChatMemory(chatId, USER_ID, CHAR_ID, "free");
}

function seedTurns(chatId: number, through: number, idOffset = 0): void {
  const db = getDb();
  for (let turn = 1; turn <= through; turn += 1) {
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, model, user_message_id, generation_status)
       VALUES (?, ?, 'user', ?, '', NULL, 'completed')`
    ).run(userIdOf(turn) + idOffset, chatId, `user turn ${turn}`);
    db.prepare(
      `INSERT INTO messages (id, chat_id, role, content, model, user_message_id, generation_status)
       VALUES (?, ?, 'assistant', ?, 'test', ?, 'completed')`
    ).run(assistantIdOf(turn) + idOffset, chatId, `assistant turn ${turn}`, userIdOf(turn) + idOffset);
  }
}

function applyAtTurn(
  turn: number,
  delta: Parameters<typeof applyRelationshipDeltaToChat>[0]["delta"],
  chatId = CHAT_ID,
  idOffset = 0
) {
  const assistantMessageId = assistantIdOf(turn) + idOffset;
  return applyRelationshipDeltaToChat({
    chatId,
    names: NAMES,
    delta,
    sourceUserMessageId: userIdOf(turn) + idOffset,
    boundarySnapshot: getMemorySourceBoundary(chatId),
    assistantMessageId,
    generationScope: { assistantMessageId, generationSequence: 0, generationRequestId: null },
  });
}

function events(opts?: { beforeAssistantMessageId?: number | null }) {
  return loadRelationshipLedgerEventsCore(getDb(), CHAT_ID, NAMES, opts);
}

function currentPromises(): string[] {
  return loadChatRelationshipMeta(CHAT_ID, NAMES).promises.map((p) => p.text);
}

function deleteLastTurn() {
  const db = getDb();
  const last = db
    .prepare(
      `SELECT id, user_message_id FROM messages
       WHERE chat_id=? AND role='assistant' ORDER BY id DESC LIMIT 1`
    )
    .get(CHAT_ID) as { id: number; user_message_id: number };
  return executeLastTurnDeleteTransaction(db, {
    chatId: CHAT_ID,
    characterId: CHAR_ID,
    userMessageId: last.user_message_id,
    assistantMessageId: last.id,
    revertNumeric: false,
    relationshipMetaNames: NAMES,
  });
}

describe("relationship ledger timeline (promise create -> cancel -> recall)", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());
  beforeEach(() => {
    cleanup();
    getDb()
      .prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`)
      .run(USER_ID, `timeline-${USER_ID}@test.local`, "Tester", "x");
    getDb().prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR_ID, "TestChar");
    seedChat(CHAT_ID);
    seedTurns(CHAT_ID, RECALL_TURN);
    applyAtTurn(CREATE_TURN, { promisesAdd: [PROMISE] });
    applyAtTurn(CANCEL_TURN, { promisesRemove: [PROMISE.text] });
  });

  it("keeps both events with source turns while the ledger holds no active promise", () => {
    assert.deepEqual(currentPromises(), []);
    const promiseEvents = events().filter((e) => e.category === "promise");
    assert.deepEqual(
      promiseEvents.map((e) => [e.change, e.turn, e.validity, e.assistantMessageId]),
      [
        ["created", CREATE_TURN, "superseded", assistantIdOf(CREATE_TURN)],
        ["released", CANCEL_TURN, "ended", assistantIdOf(CANCEL_TURN)],
      ]
    );
    assert.equal(promiseEvents[0]!.userMessageId, userIdOf(CREATE_TURN));
  });

  it("T80 recall injects the past promise as ended, not as an active promise", () => {
    const lines = selectPromiseHistoryForPrompt(events(), "예전에 야경 보기로 한 거 기억나?");
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /야경/);
    assert.match(lines[0]!, new RegExp(`제${CREATE_TURN}턴 약속 → 제${CANCEL_TURN}턴 해제`));

    // Before: the ledger alone has nothing to say about the cancelled promise.
    assert.equal(formatMemoryMetaForPrompt(loadChatRelationshipMeta(CHAT_ID, NAMES)), null);

    const wire = formatMemoryMetaForPrompt(loadChatRelationshipMeta(CHAT_ID, NAMES), {
      endedPromises: lines,
    });
    assert.ok(wire);
    assert.match(wire!, /지난 약속\(현재 유효하지 않음\)/);
    assert.doesNotMatch(wire!, /(^|\n)약속: /);
  });

  it("injects nothing on turns that do not recall the promise", () => {
    assert.deepEqual(selectPromiseHistoryForPrompt(events(), "오늘 날씨가 정말 좋네요."), []);
    assert.equal(
      formatMemoryMetaForPrompt(loadChatRelationshipMeta(CHAT_ID, NAMES), { endedPromises: [] }),
      null
    );
  });

  it("an explicit promise cue recalls ended promises without shared words", () => {
    const lines = selectPromiseHistoryForPrompt(events(), "우리 그때 무슨 약속 했었지?");
    assert.equal(lines.length, 1);
  });

  it("does not inject ended promises when the user proposes a new one", () => {
    assert.deepEqual(
      selectPromiseHistoryForPrompt(events(), "오늘 새로운 약속을 정하자."),
      []
    );
  });

  it("still recalls an ended promise when the user asks what happened to it", () => {
    const specific = selectPromiseHistoryForPrompt(events(), "예전에 한강 약속 어떻게 됐지?");
    assert.equal(specific.length, 1);
    assert.match(specific[0]!, /한강|야경/);
    const generic = selectPromiseHistoryForPrompt(events(), "그때 무슨 약속 했었지?");
    assert.equal(generic.length, 1);
  });

  it("a re-added promise is active again and leaves no ended-history line", () => {
    applyAtTurn(30, { promisesAdd: [PROMISE] });
    assert.deepEqual(currentPromises(), [PROMISE.text]);
    const last = events().filter((e) => e.category === "promise").at(-1)!;
    assert.equal(last.change, "created");
    assert.equal(last.validity, "active");
    assert.deepEqual(selectPromiseHistoryForPrompt(events(), "야경 약속 기억해?"), []);
  });

  it("regeneration of the cancel turn does not recall its own cancellation", () => {
    const visible = events({ beforeAssistantMessageId: assistantIdOf(CANCEL_TURN) });
    assert.deepEqual(
      visible.filter((e) => e.category === "promise").map((e) => [e.change, e.validity]),
      [["created", "absent"]]
    );
    assert.deepEqual(selectPromiseHistoryForPrompt(visible, "야경 약속 기억해?"), []);
  });

  it("deleting the last turn drops its event and keeps the older history", () => {
    applyAtTurn(RECALL_TURN, { promisesAdd: [PROMISE] });
    assert.deepEqual(currentPromises(), [PROMISE.text]);
    deleteLastTurn();
    assert.deepEqual(currentPromises(), []);
    assert.deepEqual(
      events()
        .filter((e) => e.category === "promise")
        .map((e) => [e.change, e.turn]),
      [
        ["created", CREATE_TURN],
        ["released", CANCEL_TURN],
      ]
    );
  });

  it("deleting a cancel turn restores the promise as active and removes the cancel event", () => {
    const fresh = { text: "토요일 정오에 도서관 앞에서 책을 돌려주기로 했다." };
    applyAtTurn(RECALL_TURN - 1, { promisesAdd: [fresh] });
    applyAtTurn(RECALL_TURN, { promisesRemove: [fresh.text] });
    assert.ok(!currentPromises().includes(fresh.text));
    deleteLastTurn();
    assert.ok(currentPromises().includes(fresh.text));
    const freshEvents = events().filter((e) => e.key === fresh.text);
    assert.deepEqual(
      freshEvents.map((e) => [e.change, e.turn, e.validity]),
      [["created", RECALL_TURN - 1, "active"]]
    );
    assert.deepEqual(selectPromiseHistoryForPrompt(events(), "책 돌려주기로 한 거 기억나?").filter((l) => l.includes("도서관")), []);
  });

  it("follows the active variant: a variant without the cancel hides the cancel event", () => {
    const db = getDb();
    const id = assistantIdOf(CANCEL_TURN);
    const row = db.prepare("SELECT alternates FROM messages WHERE id=?").get(id) as {
      alternates: string;
    };
    const [cancelVariant] = JSON.parse(row.alternates) as Record<string, unknown>[];
    const plainVariant = { ...cancelVariant };
    delete plainVariant.relationshipMetaChange;
    delete plainVariant.relationshipMetaAfter;
    db.prepare("UPDATE messages SET alternates=?, active_variant=1 WHERE id=?").run(
      JSON.stringify([cancelVariant, { ...plainVariant, content: "다른 응답" }]),
      id
    );
    assert.deepEqual(
      events()
        .filter((e) => e.category === "promise")
        .map((e) => e.change),
      ["created"]
    );
    db.prepare("UPDATE messages SET active_variant=0 WHERE id=?").run(id);
    assert.deepEqual(
      events()
        .filter((e) => e.category === "promise")
        .map((e) => e.change),
      ["created", "released"]
    );
  });

  it("legacy turns without provenance simply have no events", () => {
    getDb()
      .prepare("UPDATE messages SET alternates='[]' WHERE id IN (?, ?)")
      .run(assistantIdOf(CREATE_TURN), assistantIdOf(CANCEL_TURN));
    assert.deepEqual(events(), []);
    assert.deepEqual(selectPromiseHistoryForPrompt(events(), "야경 약속 기억나?"), []);
  });

  it("possession changes are listed with the same provenance", () => {
    applyAtTurn(40, { items: ["Tester: 청동열쇠"] });
    const item = events().find((e) => e.category === "item")!;
    assert.equal(item.change, "created");
    assert.equal(item.turn, 40);
    assert.equal(item.validity, "active");
    assert.match(item.label, /청동열쇠/);
  });

  it("never reads another chat's provenance", () => {
    seedChat(OTHER_CHAT_ID);
    seedTurns(OTHER_CHAT_ID, 5, 100_000);
    applyAtTurn(3, { promisesAdd: [{ text: "다른 방의 비밀 약속" }] }, OTHER_CHAT_ID, 100_000);
    assert.ok(events().every((e) => !e.label.includes("다른 방")));
    assert.deepEqual(selectPromiseHistoryForPrompt(events(), "다른 방의 비밀 이야기 기억나?"), []);
  });
});
