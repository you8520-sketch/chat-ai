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
import { after, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { getOrCreateChatMemory } from "./memory-db";
import { rebuildLorebookFromRecords } from "./memory-turn-summary";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import {
  messagesToTurns,
  rawRecentTurnsToHistory,
  resolveMemoryCoverageGap,
  resolveLorebookExcludeFromTrimmedHistory,
} from "@/lib/hybridMemory";

const CHAT = 933001;
const USER = 933002;
const CHAR = 933003;
const UNIQUE = "UNIQUE_EVENT_X_ALPHA";
const MOCK_SUMMARY =
  "짧지만 중요한 사건 하나만 기록함. UNIQUE_EVENT_X_ALPHA and later scene. " +
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

function seedMessages() {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `ltm-${USER}@test.local`,
    "ltm",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "LtmChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
  db.prepare(
    `INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`
  ).run(CHAT, "assistant", "greeting", "greeting");
  for (let t = 1; t <= 5; t++) {
    const user = t === 1 ? `${UNIQUE} user turn` : `user ${t}`;
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      CHAT,
      "user",
      user,
      "user"
    );
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      CHAT,
      "assistant",
      `assistant ${t}`,
      "test"
    );
  }
  const persisted = persistValidatedSummaryBatch({
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
  assert.equal(persisted.ok, true, persisted.ok ? "" : String((persisted as { reason?: string }).reason));
}

beforeEach(seedMessages);
after(cleanup);

describe("LTM + RAW integration gap", () => {
  it("turn6 assembly keeps fact X only via LTM with MIDDLE_GAP=0", () => {
    const rows = getDb()
      .prepare(`SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id`)
      .all(CHAT) as { role: "user" | "assistant"; content: string; model?: string }[];
    const turns = messagesToTurns(rows);
    const raw = rawRecentTurnsToHistory(turns, 4, {
      summarizedTurnCount: 5,
      memoryFeatureEnabled: true,
    });
    const rawText = raw.map((m) => m.content).join("\n");
    assert.doesNotMatch(rawText, new RegExp(UNIQUE));
    assert.match(rawText, /user 2/);
    assert.match(rawText, /user 5/);

    const cutoff =
      resolveLorebookExcludeFromTrimmedHistory(turns, raw) ?? 2;
    const lore = rebuildLorebookFromRecords(CHAT, { excludeTurnStartGte: cutoff });
    assert.match(lore, new RegExp(UNIQUE));
    assert.equal((lore.match(new RegExp(UNIQUE, "g")) ?? []).length, 1);

    const gap = resolveMemoryCoverageGap({
      firstRawPlayableTurn: cutoff,
      summarizedTurnCount: 5,
    });
    assert.equal(gap, 0);
  });
});
