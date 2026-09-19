/**
 * Deterministic TOCTOU proofs for nonnumeric variant switch + canon freeze.
 * Route-level gate is non-authoritative; BEGIN IMMEDIATE owner rechecks frontier.
 */
import Module from "module";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
import Database from "better-sqlite3";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { bootstrapStreamingTurn } from "@/lib/streamingPersistence";
import {
  executeAtomicNonnumericVariantSwitch,
  resolveCanonicalVariantSwitchGate,
} from "@/lib/rpDerivedStateLifecycle";
import { ensureStatusWidgetTriggerTables } from "@/lib/statusWidgetTriggers";
import {
  NumericVariantFrontierMovedError,
} from "@/lib/rpNumericState/types";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import {
  __setSummarizeTurnBatchCallerForTests,
  processRollingSummaryBatch,
  scheduleDeferredBoundarySummaryAfterCanonFreeze,
} from "@/lib/memory/memory-rolling-summary";
import { loadMemoryEligibleChatTurnsWithMessageIds } from "@/lib/memory/memory-turn-loader";
import { listMemoryRecordsForChat } from "@/lib/memory/memory-turn-summary";

const BASE_CHAT = 958100;
const BASE_USER = 958101;
const BASE_CHAR = 958102;
let testSeq = 0;

const MOCK_SUMMARY =
  "짧지만 중요한 사건 하나만 기록함. 이후 전개에 영향을 주는 약속과 관계 변화만 남김. " +
  "추가 장식 없이 사실만 압축. 반복 묘사는 생략. 핵심만 유지.";

const CONCURRENT_FORK_PATH = fileURLToPath(
  new URL("./rpNonnumericVariantToctou.concurrentFork.ts", import.meta.url)
);
const CONCURRENT_FORK_EXEC_ARGV = ["--conditions=react-server", "--import", "tsx"];

type ForkResult =
  | { ok: true; workerLabel: string; kind: string; activeVariant: number; selectedContent: string }
  | { ok: false; workerLabel: string; name: string; code: string; message: string };

function ids() {
  testSeq += 1;
  return { chat: BASE_CHAT + testSeq, user: BASE_USER + testSeq, char: BASE_CHAR + testSeq };
}

function cleanup(chatId: number, userId: number, charId: number) {
  const db = getDb();
  db.prepare("DELETE FROM chat_turn_summaries WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chat_memories WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM episodic_memory_facts WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM messages WHERE chat_id=?").run(chatId);
  db.prepare("DELETE FROM chats WHERE id=?").run(chatId);
  db.prepare("DELETE FROM users WHERE id=?").run(userId);
  db.prepare("DELETE FROM characters WHERE id=?").run(charId);
}

function seed(chatId: number, userId: number, charId: number): number[] {
  cleanup(chatId, userId, charId);
  const db = getDb();
  db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
    userId,
    `toctou-${userId}@test.local`,
    "toctou",
    "x"
  );
  db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(charId, "ToctouChar");
  db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
    chatId,
    userId,
    charId
  );
  getOrCreateChatMemory(chatId, userId, charId, "free");
  db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
    chatId,
    "assistant",
    "인사.",
    "greeting"
  );
  const assistantIds: number[] = [];
  for (let t = 1; t <= 5; t++) {
    const userMsgId = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
      )
      .run(chatId, "user", `turn ${t}`).lastInsertRowid as number;
    const assistantId = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id) VALUES (?,?,?,?,'completed',?)`
      )
      .run(chatId, "assistant", `prose A turn ${t}`, "test", userMsgId).lastInsertRowid as number;
    assistantIds.push(assistantId);
  }
  return assistantIds;
}

function seedTurn5Variants(
  assistantId: number,
  variants: { content: string }[]
): void {
  const db = getDb();
  const payload = variants.map((v) => ({
    content: v.content,
    model: "test",
    usage: null,
    created_at: "",
  }));
  db.prepare(
    `UPDATE messages SET content=?, alternates=?, active_variant=0 WHERE id=?`
  ).run(payload[0]!.content, JSON.stringify(payload), assistantId);
}

function readTurn5(db: ReturnType<typeof getDb>, assistantId: number) {
  return db
    .prepare(`SELECT content, active_variant, alternates FROM messages WHERE id=?`)
    .get(assistantId) as { content: string; active_variant: number; alternates: string };
}

function freezeTurn6Bootstrap(chatId: number, charId: number): void {
  const db = getDb();
  bootstrapStreamingTurn(db, {
    chatId,
    requestId: `toctou-freeze-${chatId}`,
    userContent: "turn 6 user",
    skipUserInsert: false,
    characterId: charId,
  });
}

function prepOpts(chatId: number, userId: number, charId: number, completedTurns: number) {
  return {
    chatId,
    userId,
    characterId: charId,
    completedTurns,
    tier: "free" as const,
    memoryCapacity: 8000,
  };
}

function spawnVariantFork(
  dbPath: string,
  input: {
    chatId: number;
    characterId: number;
    userId: number;
    messageId: number;
    variantIndex: number;
    workerLabel: string;
  }
): { child: ChildProcess; ready: Promise<void>; result: Promise<ForkResult> } {
  const child = fork(CONCURRENT_FORK_PATH, [], {
    execArgv: CONCURRENT_FORK_EXEC_ARGV,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let settled = false;
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(`[fork ${input.workerLabel}] ${chunk}`);
  });
  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });
  const result = new Promise<ForkResult>((resolve, reject) => {
    child.on("message", (message: Record<string, unknown>) => {
      if (message.type === "ready") {
        readyResolve();
        return;
      }
      if (message.type === "result") {
        settled = true;
        if (message.ok === true) {
          resolve({
            ok: true,
            workerLabel: String(message.workerLabel),
            kind: String(message.kind),
            activeVariant: Number(message.activeVariant),
            selectedContent: String(message.selectedContent),
          });
        } else {
          resolve({
            ok: false,
            workerLabel: String(message.workerLabel),
            name: String(message.name ?? "Error"),
            code: String(message.code ?? "UNKNOWN"),
            message: String(message.message ?? "unknown"),
          });
        }
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!settled && code !== 0 && code !== null) {
        reject(new Error(`fork exited ${code} before result`));
      }
    });
  });
  return { child, ready, result };
}

function createMinimalSchemaDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL,
      nickname TEXT NOT NULL,
      pw_hash TEXT NOT NULL
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      mode TEXT NOT NULL
    );
    CREATE TABLE chat_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      pinned_facts TEXT NOT NULL DEFAULT '',
      recent_summary TEXT NOT NULL DEFAULT '',
      archive_summary TEXT NOT NULL DEFAULT '',
      membership_tier TEXT NOT NULL DEFAULT 'free',
      used_chars INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      summarized_turn_count INTEGER NOT NULL DEFAULT 0,
      last_compressed_at TEXT,
      memory_reset_after_message_id INTEGER,
      memory_epoch INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      usage TEXT,
      alternates TEXT,
      active_variant INTEGER DEFAULT 0,
      adult_route_meta_json TEXT DEFAULT '',
      status_widget_values_json TEXT DEFAULT '',
      status_widget_turn_active INTEGER DEFAULT 0,
      generation_status TEXT DEFAULT 'completed',
      request_id TEXT,
      user_message_id INTEGER,
      updated_at TEXT
    );
    CREATE TABLE episodic_memory_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      character_id INTEGER,
      user_id INTEGER,
      source_turn INTEGER NOT NULL,
      source_user_message_id INTEGER,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      attribute TEXT NOT NULL,
      value TEXT NOT NULL,
      importance TEXT NOT NULL,
      fact_text TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  ensureStatusWidgetTriggerTables(db);
  return db;
}

before(() => installIsolatedTestDatabase());
after(() => uninstallIsolatedTestDatabase());

beforeEach(() => {
  process.env.MEMORY_5PLUS4_ENABLED = "1";
  __setSummarizeTurnBatchCallerForTests(null);
});

afterEach(() => {
  __setSummarizeTurnBatchCallerForTests(null);
});

describe("TOCTOU nonnumeric variant freeze", () => {
  it("TOCTOU-1 gate before freeze before mutation — txn-local recheck rejects", () => {
    const { chat, user, char } = ids();
    const assistantIds = seed(chat, user, char);
    const turn5Id = assistantIds[4]!;
    seedTurn5Variants(turn5Id, [{ content: "TURN5 A" }, { content: "TURN5 B" }]);
    const db = getDb();

    const gateBefore = resolveCanonicalVariantSwitchGate(db, chat, turn5Id);
    assert.equal(gateBefore.allowed, true, "route precheck allowed at frontier");

    freezeTurn6Bootstrap(chat, char);

    const before = readTurn5(db, turn5Id);
    assert.throws(
      () =>
        executeAtomicNonnumericVariantSwitch(db, {
          chatId: chat,
          characterId: char,
          userId: user,
          messageId: turn5Id,
          variantIndex: 1,
        }),
      (e: unknown) => e instanceof NumericVariantFrontierMovedError
    );

    const after = readTurn5(db, turn5Id);
    assert.equal(after.content, before.content, "TURN5 content unchanged");
    assert.equal(after.active_variant, before.active_variant, "active_variant unchanged");
    assert.equal(after.content, "TURN5 A");
  });

  it("TOCTOU-2 variant transaction first — B commits then freeze; summary uses B", async () => {
    const { chat, user, char } = ids();
    const assistantIds = seed(chat, user, char);
    const turn5Id = assistantIds[4]!;
    seedTurn5Variants(turn5Id, [{ content: "TURN5 A" }, { content: "TURN5 B" }]);
    const db = getDb();

    const applied = executeAtomicNonnumericVariantSwitch(db, {
      chatId: chat,
      characterId: char,
      userId: user,
      messageId: turn5Id,
      variantIndex: 1,
    });
    assert.equal(applied.kind, "APPLIED");
    assert.equal(readTurn5(db, turn5Id).content, "TURN5 B");

    freezeTurn6Bootstrap(chat, char);

    let summaryCalls = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      summaryCalls += 1;
      return { text: MOCK_SUMMARY };
    });
    scheduleDeferredBoundarySummaryAfterCanonFreeze(prepOpts(chat, user, char, 5));
    for (let i = 0; i < 60; i++) {
      if (listMemoryRecordsForChat(chat).filter((r) => !r.inactive).length > 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(summaryCalls, 1);
    const turn5 = loadMemoryEligibleChatTurnsWithMessageIds(chat).find((t) => t.turnNumber === 5);
    assert.equal(turn5?.assistant, "TURN5 B");
  });

  it("TOCTOU-3 bootstrap first — PATCH acquires lock then txn frontier check fails", () => {
    const { chat, user, char } = ids();
    const assistantIds = seed(chat, user, char);
    const turn5Id = assistantIds[4]!;
    seedTurn5Variants(turn5Id, [{ content: "TURN5 A" }, { content: "TURN5 B" }]);
    const db = getDb();

    freezeTurn6Bootstrap(chat, char);
    assert.equal(resolveCanonicalVariantSwitchGate(db, chat, turn5Id).allowed, false);

    assert.throws(
      () =>
        executeAtomicNonnumericVariantSwitch(db, {
          chatId: chat,
          characterId: char,
          userId: user,
          messageId: turn5Id,
          variantIndex: 1,
        }),
      (e: unknown) => e instanceof NumericVariantFrontierMovedError
    );
    assert.equal(readTurn5(db, turn5Id).content, "TURN5 A");
    assert.equal(readTurn5(db, turn5Id).active_variant, 0);
  });

  it("TOCTOU-4 two variant PATCHes — serialized txn re-read; last target wins", async () => {
    const dir = mkdtempSync(join(tmpdir(), "toctou-variant-"));
    const dbPath = join(dir, "test.db");
    try {
      const db = createMinimalSchemaDb(dbPath);
      const chatId = 1;
      const userId = 2;
      const charId = 3;
      db.prepare(`INSERT INTO users (id, email, nickname, pw_hash) VALUES (?,?,?,?)`).run(
        userId,
        "u@test",
        "u",
        "x"
      );
      db.prepare(`INSERT INTO characters (id, name) VALUES (?,?)`).run(charId, "C");
      db.prepare(`INSERT INTO chats (id, user_id, character_id, mode) VALUES (?,?,?,'safe')`).run(
        chatId,
        userId,
        charId
      );
      db.prepare(
        `INSERT INTO chat_memories (chat_id, user_id, character_id, memory_epoch) VALUES (?,?,?,0)`
      ).run(chatId, userId, charId);
      db.prepare(`INSERT INTO messages (chat_id, role, content, model) VALUES (?,?,?,?)`).run(
        chatId,
        "assistant",
        "greeting",
        "greeting"
      );
      for (let t = 1; t <= 5; t++) {
        const userMsgId = db
          .prepare(
            `INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?,?,?,'user','submitted')`
          )
          .run(chatId, "user", `u${t}`).lastInsertRowid as number;
        db.prepare(
          `INSERT INTO messages (chat_id, role, content, model, generation_status, user_message_id) VALUES (?,?,?,?,'completed',?)`
        ).run(chatId, "assistant", `A${t}`, "test", userMsgId);
      }
      const turn5Id = db
        .prepare(
          `SELECT id FROM messages WHERE chat_id=? AND role='assistant' AND model!='greeting' ORDER BY id DESC LIMIT 1`
        )
        .get(chatId) as { id: number };
      const variants = [
        { content: "TURN5 A", model: "test", usage: null, created_at: "" },
        { content: "TURN5 B", model: "test", usage: null, created_at: "" },
        { content: "TURN5 C", model: "test", usage: null, created_at: "" },
      ];
      db.prepare(`UPDATE messages SET content=?, alternates=?, active_variant=0 WHERE id=?`).run(
        "TURN5 A",
        JSON.stringify(variants),
        turn5Id.id
      );
      db.close();

      const base = {
        chatId,
        characterId: charId,
        userId,
        messageId: turn5Id.id,
      };

      const workerB = spawnVariantFork(dbPath, { ...base, variantIndex: 1, workerLabel: "B" });
      await workerB.ready;
      workerB.child.send({
        type: "start",
        dbPath,
        input: { ...base, variantIndex: 1, workerLabel: "B" },
      });
      const resultB = await workerB.result;
      workerB.child.kill();
      assert.equal(resultB.ok, true, JSON.stringify(resultB));
      if (!resultB.ok) return;
      assert.equal(resultB.kind, "APPLIED");
      assert.equal(resultB.selectedContent, "TURN5 B");

      const workerC = spawnVariantFork(dbPath, { ...base, variantIndex: 2, workerLabel: "C" });
      await workerC.ready;
      workerC.child.send({
        type: "start",
        dbPath,
        input: { ...base, variantIndex: 2, workerLabel: "C" },
      });
      const resultC = await workerC.result;
      workerC.child.kill();
      assert.equal(resultC.ok, true, JSON.stringify(resultC));
      if (!resultC.ok) return;
      assert.equal(resultC.kind, "APPLIED");
      assert.equal(resultC.selectedContent, "TURN5 C");

      const ok = [resultB, resultC];

      const verify = new Database(dbPath);
      const row = verify
        .prepare(`SELECT content, active_variant, alternates FROM messages WHERE id=?`)
        .get(turn5Id.id) as { content: string; active_variant: number; alternates: string };
      verify.close();

      assert.equal(row.active_variant, 2);
      assert.equal(row.content, "TURN5 C");
      assert.equal(ok[1]!.selectedContent, row.content);
      const parsed = JSON.parse(row.alternates) as { content: string }[];
      assert.equal(parsed.length, 3);
      assert.equal(parsed[row.active_variant]?.content, row.content);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TOCTOU-5 summary consistency — canonical TURN5 matches summary batch for both orders", async () => {
    const orderVariantFirst = ids();
    const idsA = seed(orderVariantFirst.chat, orderVariantFirst.user, orderVariantFirst.char);
    const turn5A = idsA[4]!;
    seedTurn5Variants(turn5A, [{ content: "CANON A" }, { content: "CANON B" }]);
    const dbA = getDb();
    executeAtomicNonnumericVariantSwitch(dbA, {
      chatId: orderVariantFirst.chat,
      characterId: orderVariantFirst.char,
      userId: orderVariantFirst.user,
      messageId: turn5A,
      variantIndex: 1,
    });
    freezeTurn6Bootstrap(orderVariantFirst.chat, orderVariantFirst.char);
    let callsA = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      callsA += 1;
      return { text: MOCK_SUMMARY };
    });
    assert.equal(
      await processRollingSummaryBatch(
        prepOpts(orderVariantFirst.chat, orderVariantFirst.user, orderVariantFirst.char, 5)
      ),
      true
    );
    assert.equal(callsA, 1);
    const canonA = loadMemoryEligibleChatTurnsWithMessageIds(orderVariantFirst.chat).find(
      (t) => t.turnNumber === 5
    );
    assert.equal(canonA?.assistant, "CANON B");
    assert.equal(readTurn5(dbA, turn5A).content, "CANON B");

    const orderFreezeFirst = ids();
    const idsB = seed(orderFreezeFirst.chat, orderFreezeFirst.user, orderFreezeFirst.char);
    const turn5B = idsB[4]!;
    seedTurn5Variants(turn5B, [{ content: "STAY A" }, { content: "FORBIDDEN B" }]);
    const dbB = getDb();
    freezeTurn6Bootstrap(orderFreezeFirst.chat, orderFreezeFirst.char);
    assert.throws(
      () =>
        executeAtomicNonnumericVariantSwitch(dbB, {
          chatId: orderFreezeFirst.chat,
          characterId: orderFreezeFirst.char,
          userId: orderFreezeFirst.user,
          messageId: turn5B,
          variantIndex: 1,
        }),
      (e: unknown) => e instanceof NumericVariantFrontierMovedError
    );
    let callsB = 0;
    __setSummarizeTurnBatchCallerForTests(async () => {
      callsB += 1;
      return { text: MOCK_SUMMARY };
    });
    assert.equal(
      await processRollingSummaryBatch(
        prepOpts(orderFreezeFirst.chat, orderFreezeFirst.user, orderFreezeFirst.char, 5)
      ),
      true
    );
    assert.equal(callsB, 1);
    const canonB = loadMemoryEligibleChatTurnsWithMessageIds(orderFreezeFirst.chat).find(
      (t) => t.turnNumber === 5
    );
    assert.equal(canonB?.assistant, "STAY A");
    assert.notEqual(canonB?.assistant, "FORBIDDEN B");
  });
});
