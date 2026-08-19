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
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { highestContiguousCompletedTurn } from "./memory-summary-integrity";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import { listMemoryRecordsForChat } from "./memory-turn-summary";
import {
  __setSummarizeTurnBatchCallerForTests,
  ensureSummaryBarrier,
  isRollingSummaryInFlight,
} from "./memory-rolling-summary";

const CHAT = 932707;
const USER = 932708;
const CHAR = 932709;

const MOCK_SUMMARY =
  "짧지만 중요한 사건 하나만 기록함. 이후 전개에 영향을 주는 약속과 관계 변화만 남김. " +
  "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심만 유지.";

function cleanup() {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

function seed() {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `bar-${USER}@test.local`,
    "bar",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "BarChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
}

function insertMsg(role: "user" | "assistant", content: string, model = "test") {
  getDb()
    .prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`)
    .run(CHAT, role, content, role === "assistant" ? model : "user");
}

function seedPlayableTurns(count: number) {
  getDb().prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  insertMsg("assistant", "인사.", "greeting");
  for (let t = 1; t <= count; t++) {
    insertMsg("user", `본편 턴 ${t}`);
    insertMsg("assistant", `응답 ${t}`);
  }
  updateChatMemory(CHAT, USER, CHAR, { message_count: count, summarized_turn_count: 0 });
}

function sealBatch1to5() {
  const r = persistValidatedSummaryBatch({
    chatId: CHAT,
    userId: USER,
    characterId: CHAR,
    tier: "free",
    turnStart: 1,
    assistantMessageId: null,
    summary: MOCK_SUMMARY,
    summaryKind: "main_canon",
    scopePayload: {
      v: 1,
      scopes: { main_canon: MOCK_SUMMARY },
      branchId: null,
      branchStatus: null,
      promotedBy: null,
      promotedAt: null,
    },
    branchId: null,
    branchStatus: null,
    promotedBy: null,
    promotedAt: null,
    playableTurnCount: 5,
  });
  assert.equal(r.ok, true);
  updateChatMemory(CHAT, USER, CHAR, { summarized_turn_count: 5, message_count: 5 });
}

beforeEach(seed);
afterEach(() => __setSummarizeTurnBatchCallerForTests(null));
after(cleanup);

describe("summary barrier B1-B7", () => {
  it("B1 summary already sealed => no LLM call", async () => {
    seedPlayableTurns(6);
    sealBatch1to5();
    let calls = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      calls += 1;
      return { text: MOCK_SUMMARY };
    });
    const barrier = await ensureSummaryBarrier({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "BarChar",
      tier: "free",
      memoryCapacity: 8000,
      completedTurns: 6,
    });
    assert.equal(barrier.ok, true);
    if (barrier.ok) assert.equal(barrier.summarizedThrough, 5);
    assert.equal(calls, 0);
  });

  it("B4 seal succeeds => summarizedThrough advances to 5 at turn 6 boundary", async () => {
    seedPlayableTurns(5);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: MOCK_SUMMARY }));
    const before = highestContiguousCompletedTurn(listMemoryRecordsForChat(CHAT), 5);
    assert.equal(before, 0);
    const barrier = await ensureSummaryBarrier({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "BarChar",
      tier: "free",
      memoryCapacity: 8000,
      completedTurns: 5,
    });
    assert.equal(barrier.ok, true);
    if (barrier.ok) assert.equal(barrier.summarizedThrough, 5);
    assert.equal(listMemoryRecordsForChat(CHAT).filter((r) => !r.inactive).length, 1);
  });

  it("B5 summary exhausts retries => barrier failure", async () => {
    seedPlayableTurns(5);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: "" }));
    const barrier = await ensureSummaryBarrier({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "BarChar",
      tier: "free",
      memoryCapacity: 8000,
      completedTurns: 5,
    });
    assert.equal(barrier.ok, false);
  });

  it("B2/B6 two simultaneous boundary requests coalesce to one seal", async () => {
    seedPlayableTurns(5);
    let calls = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return { text: MOCK_SUMMARY };
    });
    const opts = {
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "BarChar",
      tier: "free" as const,
      memoryCapacity: 8000,
      completedTurns: 5,
    };
    const [a, b] = await Promise.all([ensureSummaryBarrier(opts), ensureSummaryBarrier(opts)]);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.equal(calls, 1);
    assert.equal(listMemoryRecordsForChat(CHAT).filter((r) => !r.inactive).length, 1);
  });

  it("B7 persisted row before barrier => zero duplicate LLM calls", async () => {
    seedPlayableTurns(5);
    sealBatch1to5();
    let calls = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      calls += 1;
      return { text: MOCK_SUMMARY };
    });
    const barrier = await ensureSummaryBarrier({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "BarChar",
      tier: "free",
      memoryCapacity: 8000,
      completedTurns: 5,
    });
    assert.equal(barrier.ok, true);
    assert.equal(calls, 0);
    assert.equal(isRollingSummaryInFlight(CHAT), false);
  });
});
