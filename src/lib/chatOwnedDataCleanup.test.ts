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
import { after, before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { persistEpisodicMemoryFactsBestEffort } from "@/lib/episodicMemoryFacts";
import { persistValidatedSummaryBatch } from "@/lib/memory/memory-summary-persist";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import { ensureMemorySummaryMigrationsTable } from "@/lib/memory/memory-summary-migration-schema";
import { MEMORY_SUMMARY_MIGRATION_VERSION } from "@/lib/memory/memory-summary-migration";
import { deleteChatOwnedDerivedRows } from "@/lib/chatOwnedDataCleanup";

const CHAT = 860011;
const USER = 860012;
const CHAR = 860013;

function cleanup() {
  const db = getDb();
  ensureMemorySummaryMigrationsTable(db);
  try {
    deleteChatOwnedDerivedRows(db, CHAT, USER);
  } catch {
    // room may already be gone
  }
  db.prepare("DELETE FROM users WHERE id=?").run(USER);
  db.prepare("DELETE FROM characters WHERE id=?").run(CHAR);
}

function seed() {
  cleanup();
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    USER,
    `del-${USER}@test.local`,
    "del",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "DelChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
}

before(seed);
after(cleanup);

describe("chat delete owned derived data", () => {
  it("commit wipes episodic facts, summaries, memories, and migration rows", () => {
    seed();
    persistEpisodicMemoryFactsBestEffort(getDb(), {
      chatId: CHAT,
      characterId: CHAR,
      userId: USER,
      sourceTurn: 5,
      facts: [
        {
          category: "preference",
          subject: "user",
          attribute: "favorite_drink",
          value: "syrup_coffee",
          importance: "important",
          fact_text: "사용자는 커피에 시럽을 두 번 넣어 마신다.",
          evidence_type: "explicit_user_statement",
        },
      ],
    });
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      turnEnd: 5,
      assistantMessageId: null,
      summary: "레온은 정원에서 렌을 만나 약속을 나눴다. 커프링크스를 건네고 다음을 기약했다.",
      playableTurnCount: 5,
    });
    getDb()
      .prepare(
        `INSERT INTO memory_summary_migrations
          (chat_id, migration_version, status, attempt_count) VALUES (?, ?, 'PENDING', 1)`
      )
      .run(CHAT, MEMORY_SUMMARY_MIGRATION_VERSION);

    getDb().transaction(() => {
      deleteChatOwnedDerivedRows(getDb(), CHAT, USER);
    })();

    const db = getDb();
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE chat_id=?").get(CHAT) as { n: number }).n,
      0
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM chat_turn_summaries WHERE chat_id=?").get(CHAT) as { n: number }).n,
      0
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM chat_memories WHERE chat_id=?").get(CHAT) as { n: number }).n,
      0
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM memory_summary_migrations WHERE chat_id=?").get(CHAT) as { n: number }).n,
      0
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM chats WHERE id=?").get(CHAT) as { n: number }).n,
      0
    );
  });

  it("rollback keeps chat and episodic facts", () => {
    seed();
    persistEpisodicMemoryFactsBestEffort(getDb(), {
      chatId: CHAT,
      characterId: CHAR,
      userId: USER,
      sourceTurn: 5,
      facts: [
        {
          category: "preference",
          subject: "user",
          attribute: "favorite_drink",
          value: "syrup_coffee",
          importance: "important",
          fact_text: "사용자는 커피에 시럽을 두 번 넣어 마신다.",
          evidence_type: "explicit_user_statement",
        },
      ],
    });
    try {
      getDb().transaction(() => {
        deleteChatOwnedDerivedRows(getDb(), CHAT, USER);
        throw new Error("force rollback");
      })();
    } catch {
      // expected
    }
    const db = getDb();
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM chats WHERE id=?").get(CHAT) as { n: number }).n,
      1
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM episodic_memory_facts WHERE chat_id=?").get(CHAT) as { n: number }).n,
      1
    );
  });
});
