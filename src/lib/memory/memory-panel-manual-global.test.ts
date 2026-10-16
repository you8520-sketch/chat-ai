/**
 * GET /api/chat/memory read + catch-up path must not discard a user-saved manual Global memory.
 * Zero provider calls (summary caller is stubbed).
 */
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
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { MEMORY_CAPACITY_FIXED } from "./memory-capacity-shared";
import { getChatMemoryRow, getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { prepareMemoryPanelView, syncAndCompressMemoryFromChat } from "./memory-backfill";
import { updateLorebookForChat } from "./memory-manager";
import { __setSummarizeTurnBatchCallerForTests } from "./memory-rolling-summary";
import { listMemoryRecordsForChat } from "./memory-turn-summary";

const CHAT = 997001;
const USER = 997002;
const CHAR = 997003;
const MANUAL_TEXT = "USER_MANUAL_GLOBAL_TEXT — 유저가 직접 확정한 장기기억";
const MOCK_SUMMARY =
  "짧지만 중요한 사건 하나만 기록함. 이후 전개에 영향을 주는 약속과 관계 변화만 남김. " +
  "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심만 유지.";

const ENV_MEMORY = "MEMORY_FEATURE_ENABLED";
let savedEnv: string | undefined;

const opts = {
  userId: USER,
  characterId: CHAR,
  chatId: CHAT,
  charName: "PanelChar",
  tier: "free" as const,
  memoryCapacity: MEMORY_CAPACITY_FIXED,
};

function cleanup(): void {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(CHAT);
  db.prepare("DELETE FROM chats WHERE id=?").run(CHAT);
}

function seedChat(playableTurns: number): void {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `panel-${USER}@test.local`,
    "panel-owner",
    "x"
  );
  db.prepare(`INSERT OR IGNORE INTO characters (id, name) VALUES (?,?)`).run(CHAR, "PanelChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT,
    "assistant",
    "인사.",
    "greeting"
  );
  for (let t = 1; t <= playableTurns; t++) {
    const userMsgId = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
      )
      .run(CHAT, "user", `본편 턴 ${t}`).lastInsertRowid as number;
    db.prepare(
      `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id) VALUES (?,?,?,?,'completed',?)`
    ).run(CHAT, "assistant", `응답 ${t} 대사`, "test", userMsgId);
  }
}

async function saveManualGlobal(): Promise<void> {
  await updateLorebookForChat(CHAT, USER, CHAR, MANUAL_TEXT, "free", MEMORY_CAPACITY_FIXED);
  const row = getChatMemoryRow(CHAT)!;
  assert.equal(row.recent_summary, MANUAL_TEXT);
  assert.equal(row.global_projection_kind, "manual_global");
}

function assertManualGlobalIntact(): void {
  const row = getChatMemoryRow(CHAT)!;
  assert.equal(row.recent_summary, MANUAL_TEXT);
  assert.equal(row.global_projection_kind, "manual_global");
  assert.equal(row.global_source_fingerprint, null);
  assert.equal(row.global_covered_through_turn, 0, "saved before any sealed record existed");
}

before(() => installIsolatedTestDatabase());
after(() => {
  cleanup();
  uninstallIsolatedTestDatabase();
});

beforeEach(() => {
  savedEnv = process.env[ENV_MEMORY];
  process.env[ENV_MEMORY] = "1";
});

afterEach(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  if (savedEnv === undefined) delete process.env[ENV_MEMORY];
  else process.env[ENV_MEMORY] = savedEnv;
});

describe("memory panel GET keeps manual Global memory", () => {
  it("A: message_count=0 with RAW present — panel sync repairs counts and keeps manual text", async () => {
    seedChat(12);
    await saveManualGlobal();
    updateChatMemory(CHAT, USER, CHAR, { message_count: 0, summarized_turn_count: 0 });

    prepareMemoryPanelView(opts);

    assertManualGlobalIntact();
    assert.equal(getChatMemoryRow(CHAT)!.message_count, 12);
  });

  it("B: missing 5-turn summary — panel catch-up still seals the batch and keeps manual text", async () => {
    seedChat(12);
    await saveManualGlobal();
    updateChatMemory(CHAT, USER, CHAR, { message_count: 12 });
    let summaryCalls = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      summaryCalls += 1;
      return { text: MOCK_SUMMARY };
    });

    prepareMemoryPanelView(opts);
    await syncAndCompressMemoryFromChat(opts);

    assert.equal(summaryCalls, 1, "catch-up must still repair the missing batch");
    const records = listMemoryRecordsForChat(CHAT).filter((r) => !r.inactive);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.turnStart, 1);
    assertManualGlobalIntact();
    assert.equal(getChatMemoryRow(CHAT)!.summarized_turn_count, 5);
  });

  it("B2: message_count=0 schedules a background seal — it also keeps manual text", async () => {
    seedChat(12);
    await saveManualGlobal();
    updateChatMemory(CHAT, USER, CHAR, { message_count: 0, summarized_turn_count: 0 });
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: MOCK_SUMMARY }));

    prepareMemoryPanelView(opts);
    await syncAndCompressMemoryFromChat(opts);

    assertManualGlobalIntact();
    assert.equal(listMemoryRecordsForChat(CHAT).filter((r) => !r.inactive).length, 1);
  });

  it("without manual Global the catch-up still mirrors the rebuilt Global (auto path unchanged)", async () => {
    seedChat(12);
    __setSummarizeTurnBatchCallerForTests(async () => ({ text: MOCK_SUMMARY }));

    prepareMemoryPanelView(opts);
    await syncAndCompressMemoryFromChat(opts);

    const row = getChatMemoryRow(CHAT)!;
    assert.equal(row.global_projection_kind, null);
    assert.ok(row.recent_summary?.includes(MOCK_SUMMARY.slice(0, 20)));
  });
});
