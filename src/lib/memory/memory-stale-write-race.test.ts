/**
 * Production-equivalent stale derived-memory write proofs.
 * Uses real source-mutation paths + deferred async seams — no direct epoch SQL.
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
import { deleteChatOwnedDerivedRows } from "@/lib/chatOwnedDataCleanup";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  __setLorebookMaintenanceDeferForTests,
  scheduleBackgroundLorebookMaintenance,
} from "./memory-manager";
import { getOrCreateChatMemory, updateChatMemory } from "./memory-db";
import { persistValidatedSummaryBatch } from "./memory-summary-persist";
import { reconcileMemoryAfterTurnDelete } from "./memory-reconcile";
import {
  invalidateDerivedMemoryGenerationCore,
  isMemoryWriteGuardCurrentCore,
} from "./memory-source-boundary";
import {
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
} from "./memory-rolling-summary";
import { listMemoryRecordsForChat, rebuildLorebookFromRecords } from "./memory-turn-summary";

const CHAT = 950001;
const USER = 950002;
const CHAR = 950003;
const STALE_MARKER = "STALE_ROLLING_OBSOLETE_XYZ";
const CANONICAL_MARKER = "CANONICAL_AFTER_DELETE_ABC";

const VALID_SUMMARY =
  "장면 요약: 초기 배치 기록. 사실만 압축하고 반복 묘사는 생략한다. " +
  "인물 관계와 약속 상태를 유지하며 다음 장면 연결점을 짧게 기록한다.";

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
    `stale-${USER}@test.local`,
    "stale",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(CHAR, "StaleChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    CHAT,
    USER,
    CHAR
  );
  getOrCreateChatMemory(CHAT, USER, CHAR, "free");
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    CHAT,
    "assistant",
    "opening",
    "greeting"
  );
  for (let t = 1; t <= 5; t++) {
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      CHAT,
      "user",
      `user turn ${t}`,
      "user"
    );
    db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
      CHAT,
      "assistant",
      `assistant ${t}`,
      "test"
    );
  }
}

function seedTenTurns() {
  seed();
  for (let t = 6; t <= 10; t++) {
    getDb()
      .prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`)
      .run(CHAT, "user", `user turn ${t}`, "user");
    getDb()
      .prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`)
      .run(CHAT, "assistant", `assistant ${t}`, "test");
  }
}

function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("waitUntil timeout"));
        return;
      }
      setImmediate(tick);
    };
    tick();
  });
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

beforeEach(() => {
  process.env.MEMORY_5PLUS4_ENABLED = "1";
  seed();
});

afterEach(() => {
  __setSummarizeTurnBatchCallerForTests(null);
  __setLorebookMaintenanceDeferForTests(null);
  cleanup();
});

describe("stale rolling summary — production-equivalent race", () => {
  it("A: turn delete invalidates generation; stale rolling persist rejected", async () => {
    seedTenTurns();
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: VALID_SUMMARY,
      summaryKind: "main_canon",
      scopePayload: {
        v: 1,
        scopes: { main_canon: VALID_SUMMARY },
        branchId: null,
        branchStatus: null,
        promotedBy: null,
        promotedAt: null,
      },
      branchId: null,
      branchStatus: null,
      promotedBy: null,
      promotedAt: null,
      playableTurnCount: 10,
    });

    let llmEntered = false;
    let releaseLlm!: () => void;
    const llmGate = new Promise<void>((resolve) => {
      releaseLlm = resolve;
    });

    __setSummarizeTurnBatchCallerForTests(async () => {
      llmEntered = true;
      await llmGate;
      return {
        text:
          `${STALE_MARKER} `.repeat(8) +
          "obsolete batch that must not commit after source mutation.",
      };
    });

    const batchPromise = processRollingSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "StaleChar",
      tier: "free",
      memoryCapacity: 10_000,
    });

    await waitUntil(() => llmEntered);

    const db = getDb();
    const lastUser = db
      .prepare(`SELECT id FROM messages WHERE chat_id=? AND role='user' ORDER BY id DESC LIMIT 1`)
      .get(CHAT) as { id: number };
    const lastAssistant = db
      .prepare(
        `SELECT id FROM messages WHERE chat_id=? AND role='assistant' AND model='test' ORDER BY id DESC LIMIT 1`
      )
      .get(CHAT) as { id: number };
    db.prepare(`DELETE FROM messages WHERE id IN (?,?)`).run(lastUser.id, lastAssistant.id);

    reconcileMemoryAfterTurnDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "StaleChar",
      tier: "free",
      memoryCapacity: 10_000,
      deletedUserMessageId: lastUser.id,
      deletedAssistantMessageId: lastAssistant.id,
      deletedPlayableTurn: 10,
    });

    updateChatMemory(CHAT, USER, CHAR, {
      recent_summary: CANONICAL_MARKER,
      membership_tier: "free",
    });

    releaseLlm();
    const ok = await batchPromise;
    assert.equal(ok, false);
    const lore = rebuildLorebookFromRecords(CHAT);
    assert.doesNotMatch(lore, new RegExp(STALE_MARKER));
    const recent = (
      getDb()
        .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
        .get(CHAT) as { recent_summary: string }
    ).recent_summary;
    assert.ok(recent.includes(CANONICAL_MARKER));
    assert.equal(
      listMemoryRecordsForChat(CHAT).some((r) => r.summary.includes(STALE_MARKER)),
      false
    );
  });
});

describe("stale lorebook maintenance — production-equivalent race", () => {
  it("B: turn delete during maintenance; stale recent_summary write rejected", async () => {
    seedTenTurns();
    persistValidatedSummaryBatch({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      turnStart: 1,
      assistantMessageId: null,
      summary: VALID_SUMMARY,
      playableTurnCount: 10,
    });
    updateChatMemory(CHAT, USER, CHAR, {
      recent_summary: CANONICAL_MARKER,
      membership_tier: "free",
    });

    let releaseDefer!: () => void;
    const defer = new Promise<void>((resolve) => {
      releaseDefer = resolve;
    });
    __setLorebookMaintenanceDeferForTests(defer);

    scheduleBackgroundLorebookMaintenance({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 200,
    });

    await new Promise((r) => setTimeout(r, 50));

    const db = getDb();
    const lastUser = db
      .prepare(`SELECT id FROM messages WHERE chat_id=? AND role='user' ORDER BY id DESC LIMIT 1`)
      .get(CHAT) as { id: number };
    const lastAssistant = db
      .prepare(
        `SELECT id FROM messages WHERE chat_id=? AND role='assistant' AND model='test' ORDER BY id DESC LIMIT 1`
      )
      .get(CHAT) as { id: number };
    db.prepare(`DELETE FROM messages WHERE id IN (?,?)`).run(lastUser.id, lastAssistant.id);

    reconcileMemoryAfterTurnDelete({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      charName: "StaleChar",
      tier: "free",
      memoryCapacity: 200,
      deletedUserMessageId: lastUser.id,
      deletedAssistantMessageId: lastAssistant.id,
      deletedPlayableTurn: 10,
    });

    updateChatMemory(CHAT, USER, CHAR, {
      recent_summary: "POST_RECONCILE_CANONICAL",
      membership_tier: "free",
    });

    releaseDefer();
    await new Promise((r) => setTimeout(r, 100));

    const recent = (
      getDb()
        .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
        .get(CHAT) as { recent_summary: string }
    ).recent_summary;
    assert.ok(recent.includes("POST_RECONCILE_CANONICAL"));
    assert.doesNotMatch(recent, /STALE_LOREBOOK_MAINT/);
  });
});

describe("stale background job after chat delete", () => {
  it("C: deleted chat memory row is not recreated by lorebook maintenance", async () => {
    seed();
    let releaseDefer!: () => void;
    __setLorebookMaintenanceDeferForTests(
      new Promise<void>((resolve) => {
        releaseDefer = resolve;
      })
    );

    scheduleBackgroundLorebookMaintenance({
      chatId: CHAT,
      userId: USER,
      characterId: CHAR,
      tier: "free",
      memoryCapacity: 10_000,
    });

    await new Promise((r) => setTimeout(r, 30));

    getDb().transaction(() => {
      deleteChatOwnedDerivedRows(getDb(), CHAT, USER);
    })();

    releaseDefer();
    await new Promise((r) => setTimeout(r, 100));

    assert.equal(
      (
        getDb()
          .prepare(`SELECT COUNT(*) AS n FROM chat_memories WHERE chat_id=?`)
          .get(CHAT) as { n: number }
      ).n,
      0
    );
    assert.equal(
      (getDb().prepare(`SELECT COUNT(*) AS n FROM chats WHERE id=?`).get(CHAT) as { n: number }).n,
      0
    );
  });
});

describe("helper-level guard invariant (supplementary)", () => {
  it("invalidateDerivedMemoryGeneration bumps epoch without clearing canonical text", () => {
    seed();
    updateChatMemory(CHAT, USER, CHAR, {
      recent_summary: "keep this body",
      membership_tier: "free",
    });
    const after = invalidateDerivedMemoryGenerationCore(getDb(), CHAT);
    assert.equal(after.epoch, 1);
    const row = getDb()
      .prepare(`SELECT recent_summary, archive_summary FROM chat_memories WHERE chat_id=?`)
      .get(CHAT) as { recent_summary: string; archive_summary: string };
    assert.equal(row.recent_summary, "keep this body");
    assert.equal(row.archive_summary, "");
  });

  it("write guard rejects stale snapshot after production invalidation", () => {
    seed();
    const snapshot = { resetAfterMessageId: null, epoch: 0 };
    invalidateDerivedMemoryGenerationCore(getDb(), CHAT);
    assert.equal(
      isMemoryWriteGuardCurrentCore(getDb(), { chatId: CHAT, snapshot, sourceUserMessageIds: [] }),
      false
    );
  });
});
