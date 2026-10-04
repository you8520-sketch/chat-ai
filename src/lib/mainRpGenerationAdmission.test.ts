import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, it } from "node:test";
import {
  UNDER_RECOVERED_OUTCOME,
  hasUnresolvedUnderRecoveredSettlement,
  settleChatTurnBillingExactlyOnce,
} from "./chatBillingSettlement";
import { ensureChatBillingSettlementSchema } from "./chatBillingSettlementSchema";
import { ensureChatGenerationLeaseSchema } from "./chatGenerationLeaseSchema";
import {
  acquireMainRpGenerationLease,
  bindMainRpGenerationLeaseAssistant,
  heartbeatMainRpGenerationLease,
  ownsMainRpGenerationLease,
  readActiveMainRpGenerationLease,
  releaseMainRpGenerationLease,
  shouldRejectMainRpGenerationReadOnly,
} from "./mainRpGenerationAdmission";
import { creditPointsWithIds } from "./points";
import {
  bootstrapStreamingTurn,
  findTurnByRequestId,
} from "./streamingPersistence";
import { isSuccessfulDurableGenerationStatus } from "./streamingPersistenceShared";

function createAdmissionDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      points REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE point_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      point_type TEXT NOT NULL,
      remaining_amount REAL NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE point_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      delta REAL NOT NULL,
      reason TEXT NOT NULL,
      message_id INTEGER,
      chat_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      request_id TEXT,
      deduction_slices TEXT,
      generation_status TEXT,
      user_message_id INTEGER,
      is_refunded INTEGER NOT NULL DEFAULT 0,
      usage TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL
    );
    INSERT INTO users (id, points) VALUES (1, 100), (2, 100);
    INSERT INTO chats (id, user_id) VALUES (1, 1), (2, 2);
  `);
  ensureChatBillingSettlementSchema(db);
  ensureChatGenerationLeaseSchema(db);
  return db;
}

function withDb(run: (db: Database.Database, dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "main-rp-lease-"));
  const dbPath = join(dir, "test.db");
  const db = createAdmissionDb(dbPath);
  try {
    run(db, dbPath);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Current main route order before this admission owner:
 * under_recovered precheck → completed replay → bootstrap → provider.
 * No per-user lease.
 */
function enterMainRpProviderWithoutAdmission(
  db: Database.Database,
  input: { userId: number; chatId: number; requestId: string; userContent: string },
  provider: { calls: number }
): "blocked" | "replay" | "provider" {
  if (
    shouldRejectMainRpGenerationReadOnly(db, {
      userId: input.userId,
      chatId: input.chatId,
      requestId: input.requestId,
    }) === "under_recovered"
  ) {
    return "blocked";
  }
  const existing = findTurnByRequestId(db, input.chatId, input.requestId);
  if (isSuccessfulDurableGenerationStatus(existing.assistantStatus)) {
    return "replay";
  }
  bootstrapStreamingTurn(db, {
    chatId: input.chatId,
    requestId: input.requestId,
    userContent: input.userContent,
    skipUserInsert: false,
  });
  provider.calls += 1;
  return "provider";
}

function enterMainRpProviderWithAdmission(
  db: Database.Database,
  input: { userId: number; chatId: number; requestId: string; userContent: string },
  provider: { calls: number }
): "blocked" | "replay" | "in_progress" | "provider" {
  const existing = findTurnByRequestId(db, input.chatId, input.requestId);
  if (isSuccessfulDurableGenerationStatus(existing.assistantStatus)) {
    return "replay";
  }
  const acquired = acquireMainRpGenerationLease(db, {
    userId: input.userId,
    chatId: input.chatId,
    requestId: input.requestId,
  });
  if (!acquired.ok) {
    return acquired.reason === "under_recovered" ? "blocked" : "in_progress";
  }
  const boot = bootstrapStreamingTurn(db, {
    chatId: input.chatId,
    requestId: input.requestId,
    userContent: input.userContent,
    skipUserInsert: false,
  });
  bindMainRpGenerationLeaseAssistant(db, acquired.lease, boot.assistantMessageId);
  if (!ownsMainRpGenerationLease(db, acquired.lease)) {
    releaseMainRpGenerationLease(db, acquired.lease);
    return "in_progress";
  }
  provider.calls += 1;
  return "provider";
}

function insertCompletedAssistant(
  db: Database.Database,
  chatId: number,
  requestId: string
): number {
  const result = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, request_id, generation_status)
       VALUES (?, 'assistant', 'saved reply', ?, 'completed')`
    )
    .run(chatId, requestId);
  return Number(result.lastInsertRowid);
}

describe("PRE-FIX main RP concurrent path", () => {
  it("BUG A different request ids both enter the provider", () => {
    withDb((db) => {
      const provider = { calls: 0 };
      const a = enterMainRpProviderWithoutAdmission(
        db,
        { userId: 1, chatId: 1, requestId: "req_a", userContent: "A" },
        provider
      );
      const b = enterMainRpProviderWithoutAdmission(
        db,
        { userId: 1, chatId: 1, requestId: "req_b", userContent: "B" },
        provider
      );
      assert.equal(a, "provider");
      assert.equal(b, "provider");
      assert.equal(provider.calls, 2);
    });
  });

  it("BUG B same request_id reuses generating row and still enters provider twice", () => {
    withDb((db) => {
      const provider = { calls: 0 };
      const first = enterMainRpProviderWithoutAdmission(
        db,
        { userId: 1, chatId: 1, requestId: "req_same", userContent: "same" },
        provider
      );
      const second = enterMainRpProviderWithoutAdmission(
        db,
        { userId: 1, chatId: 1, requestId: "req_same", userContent: "same" },
        provider
      );
      const turn = findTurnByRequestId(db, 1, "req_same");
      assert.equal(first, "provider");
      assert.equal(second, "provider");
      assert.equal(turn.assistantStatus, "generating");
      assert.equal(provider.calls, 2);
    });
  });
});

describe("main RP generation admission", () => {
  it("A different request concurrent — winner 1, loser generation_in_progress, provider 1", () => {
    withDb((db) => {
      const provider = { calls: 0 };
      const a = enterMainRpProviderWithAdmission(
        db,
        { userId: 1, chatId: 1, requestId: "req_a", userContent: "A" },
        provider
      );
      const b = enterMainRpProviderWithAdmission(
        db,
        { userId: 1, chatId: 1, requestId: "req_b", userContent: "B" },
        provider
      );
      assert.equal(a, "provider");
      assert.equal(b, "in_progress");
      assert.equal(provider.calls, 1);
      assert.equal(readActiveMainRpGenerationLease(db, 1)?.request_id, "req_a");
    });
  });

  it("B same request concurrent — provider 1; completed replay does not call provider", () => {
    withDb((db) => {
      const provider = { calls: 0 };
      const first = enterMainRpProviderWithAdmission(
        db,
        { userId: 1, chatId: 1, requestId: "req_same", userContent: "same" },
        provider
      );
      const second = enterMainRpProviderWithAdmission(
        db,
        { userId: 1, chatId: 1, requestId: "req_same", userContent: "same" },
        provider
      );
      assert.equal(first, "provider");
      assert.equal(second, "in_progress");
      assert.equal(provider.calls, 1);

      const lease = readActiveMainRpGenerationLease(db, 1);
      assert.ok(lease);
      releaseMainRpGenerationLease(db, {
        userId: 1,
        requestId: "req_same",
        chatId: 1,
        leaseToken: lease.lease_token,
      });
      db.prepare(`UPDATE messages SET generation_status='completed', content='done' WHERE request_id=?`).run(
        "req_same"
      );
      const replay = enterMainRpProviderWithAdmission(
        db,
        { userId: 1, chatId: 1, requestId: "req_same", userContent: "same" },
        provider
      );
      assert.equal(replay, "replay");
      assert.equal(provider.calls, 1);
    });
  });

  it("C different users acquire independently", () => {
    withDb((db) => {
      const provider = { calls: 0 };
      const a = enterMainRpProviderWithAdmission(
        db,
        { userId: 1, chatId: 1, requestId: "req_u1", userContent: "u1" },
        provider
      );
      const b = enterMainRpProviderWithAdmission(
        db,
        { userId: 2, chatId: 2, requestId: "req_u2", userContent: "u2" },
        provider
      );
      assert.equal(a, "provider");
      assert.equal(b, "provider");
      assert.equal(provider.calls, 2);
    });
  });

  it("D stale takeover; old token heartbeat/release cannot mutate the new lease", () => {
    withDb((db) => {
      const first = acquireMainRpGenerationLease(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_old",
      });
      assert.equal(first.ok, true);
      if (!first.ok) return;
      db.prepare(`UPDATE chat_generation_leases SET expires_at = datetime('now', '-1 seconds') WHERE user_id=1`).run();
      const second = acquireMainRpGenerationLease(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_new",
      });
      assert.equal(second.ok, true);
      if (!second.ok) return;
      assert.notEqual(first.lease.leaseToken, second.lease.leaseToken);
      assert.equal(heartbeatMainRpGenerationLease(db, first.lease), false);
      assert.equal(releaseMainRpGenerationLease(db, first.lease), false);
      assert.equal(ownsMainRpGenerationLease(db, second.lease), true);
      assert.equal(readActiveMainRpGenerationLease(db, 1)?.request_id, "req_new");
      assert.equal(releaseMainRpGenerationLease(db, second.lease), true);
    });
  });

  it("E heartbeat refreshes expiry so takeover cannot steal a live lease", () => {
    withDb((db) => {
      const live = acquireMainRpGenerationLease(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_live",
      });
      assert.equal(live.ok, true);
      if (!live.ok) return;
      assert.equal(heartbeatMainRpGenerationLease(db, live.lease, { staleMs: 120_000 }), true);
      const steal = acquireMainRpGenerationLease(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_steal",
      });
      assert.equal(steal.ok, false);
      if (steal.ok) return;
      assert.equal(steal.reason, "generation_in_progress");
    });
  });

  it("F provider-failure style release lets the next request acquire", () => {
    withDb((db) => {
      const first = acquireMainRpGenerationLease(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_fail",
      });
      assert.equal(first.ok, true);
      if (!first.ok) return;
      assert.equal(releaseMainRpGenerationLease(db, first.lease), true);
      const next = acquireMainRpGenerationLease(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_next",
      });
      assert.equal(next.ok, true);
    });
  });

  it("G under_recovered commit blocks a later acquire even if early precheck already passed", () => {
    withDb((db) => {
      creditPointsWithIds(db, 1, 100, "PAID", "seed");
      const early = shouldRejectMainRpGenerationReadOnly(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_b",
      });
      assert.equal(early, null);

      const msgId = insertCompletedAssistant(db, 1, "req_a");
      const settlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_a",
        assistantMessageId: msgId,
        requestedPoints: 800,
        reason: "shortfall",
      });
      assert.equal(settlement.outcome, UNDER_RECOVERED_OUTCOME);
      assert.equal(hasUnresolvedUnderRecoveredSettlement(db, 1), true);

      const provider = { calls: 0 };
      const late = enterMainRpProviderWithAdmission(
        db,
        { userId: 1, chatId: 1, requestId: "req_b", userContent: "B" },
        provider
      );
      assert.equal(late, "blocked");
      assert.equal(provider.calls, 0);
    });
  });

  it("H completed under_recovered replay uses the stored product and skips provider", () => {
    withDb((db) => {
      creditPointsWithIds(db, 1, 100, "PAID", "seed");
      const msgId = insertCompletedAssistant(db, 1, "req_done");
      settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_done",
        assistantMessageId: msgId,
        requestedPoints: 800,
        reason: "shortfall",
      });
      assert.equal(
        shouldRejectMainRpGenerationReadOnly(db, {
          userId: 1,
          chatId: 1,
          requestId: "req_done",
        }),
        null
      );
      const provider = { calls: 0 };
      const replay = enterMainRpProviderWithAdmission(
        db,
        { userId: 1, chatId: 1, requestId: "req_done", userContent: "done" },
        provider
      );
      assert.equal(replay, "replay");
      assert.equal(provider.calls, 0);
    });
  });

  it("I provider I/O is outside BEGIN IMMEDIATE so another writer can commit", async () => {
    await withDbAsync(async (db, dbPath) => {
      const acquired = acquireMainRpGenerationLease(db, {
        userId: 1,
        chatId: 1,
        requestId: "req_io",
      });
      assert.equal(acquired.ok, true);

      let resolveProvider!: () => void;
      const providerPending = new Promise<void>((resolve) => {
        resolveProvider = resolve;
      });

      const writer = new Database(dbPath);
      writer.pragma("busy_timeout = 1000");
      const writeStarted = Date.now();
      writer.prepare(`UPDATE users SET points = 77 WHERE id = 2`).run();
      const elapsed = Date.now() - writeStarted;
      assert.ok(elapsed < 800, `writer blocked for ${elapsed}ms; lease txn leaked`);
      assert.equal(
        (writer.prepare(`SELECT points FROM users WHERE id=2`).get() as { points: number }).points,
        77
      );
      writer.close();
      resolveProvider();
      await providerPending;
    });
  });
});

async function withDbAsync(
  run: (db: Database.Database, dbPath: string) => Promise<void>
): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "main-rp-lease-"));
  const dbPath = join(dir, "test.db");
  const db = createAdmissionDb(dbPath);
  try {
    await run(db, dbPath);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
