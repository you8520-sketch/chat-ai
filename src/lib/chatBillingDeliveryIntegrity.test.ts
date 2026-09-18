/**
 * Billing / delivery integrity audit fixtures (D1–D14).
 * Deterministic reproduction before patch; regression gate after guard.
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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { after, before, describe, it } from "node:test";
import {
  BillingProductNotDeliveredError,
  readAssistantChargeEligibility,
  readChatBillingSettlement,
  settleChatTurnBillingExactlyOnce,
  CHAT_TURN_CHARGE_KIND,
  SUCCESSFUL_DURABLE_GENERATION_STATUSES,
} from "./chatBillingSettlement";
import { ensureChatBillingSettlementSchema } from "./chatBillingSettlementSchema";
import { getDb } from "./db";
import { getPointBalance } from "./points";
import { refundMessageDeduction } from "./refund";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "./test/isolatedTestDatabase";
import { finalizeAssistantMessageCore, createDisconnectSafeSend } from "./streamingPersistence";
import { classifyReconcileStatus } from "./chatStreamEofReconcile";
import { isSuccessfulDurableGenerationStatus } from "./streamingPersistenceShared";

function createIntegrityDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      points REAL NOT NULL DEFAULT 0,
      creator_points REAL NOT NULL DEFAULT 0,
      creator_exclusive INTEGER NOT NULL DEFAULT 0
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
      is_refunded INTEGER NOT NULL DEFAULT 0,
      usage TEXT,
      model TEXT,
      alternates TEXT DEFAULT '[]',
      active_variant INTEGER DEFAULT 0,
      status_widget_values_json TEXT,
      status_widget_turn_active INTEGER DEFAULT 0,
      status_meta TEXT,
      status TEXT,
      updated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE chats (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL
    );
    INSERT INTO users (id, points) VALUES (1, 10000);
    INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
      VALUES (1, 'PAID', 10000, '2030-01-01');
    INSERT INTO chats (id, user_id, character_id) VALUES (1, 1, 1);
  `);
  ensureChatBillingSettlementSchema(db);
  return db;
}

function withDb(run: (db: Database.Database, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "billing-delivery-integrity-"));
  const dbPath = join(dir, "test.db");
  try {
    const db = createIntegrityDb(dbPath);
    run(db, dir);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function insertAssistant(
  db: Database.Database,
  opts: {
    requestId: string;
    generationStatus: string;
    content?: string;
  }
): number {
  const result = db
    .prepare(
      `INSERT INTO messages (chat_id, role, content, request_id, generation_status)
       VALUES (1, 'assistant', ?, ?, ?)`
    )
    .run(opts.content ?? "assistant answer", opts.requestId, opts.generationStatus);
  return Number(result.lastInsertRowid);
}

function userBalance(db: Database.Database): number {
  return (db.prepare(`SELECT points FROM users WHERE id=1`).get() as { points: number }).points;
}

function countSettlements(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM chat_billing_settlements`).get() as { c: number })
    .c;
}

function countNegativeLogs(db: Database.Database): number {
  return (
    db.prepare(`SELECT COUNT(*) AS c FROM point_logs WHERE user_id=1 AND delta<0`).get() as {
      c: number;
    }
  ).c;
}

/** D13 integrity scanner — settlement charged while generation not durable. */
function detectPaidWithoutDurableProduct(
  db: Database.Database,
  userId: number,
  chatId: number,
  requestId: string
): boolean {
  const settlement = readChatBillingSettlement(db, userId, chatId, requestId, CHAT_TURN_CHARGE_KIND);
  if (!settlement || settlement.settledPoints <= 0) return false;
  const assistantMessageId = settlement.assistantMessageId;
  if (assistantMessageId == null) return true;
  const eligibility = readAssistantChargeEligibility(db, assistantMessageId, chatId, requestId);
  return !eligibility.ok;
}

type ForensicCategory = "A" | "B" | "C" | "D" | "E";

function classifyTurnForensic(input: {
  providerCostUsd: number | null;
  durableProduct: boolean;
  userChargedPoints: number;
}): ForensicCategory {
  const providerCost = input.providerCostUsd ?? 0;
  const charged = input.userChargedPoints > 0;
  const durable = input.durableProduct;

  if (providerCost > 0 && durable && charged) return "A";
  if (providerCost > 0 && durable && !charged) return "B";
  if (providerCost > 0 && !durable && !charged) return "C";
  if (providerCost > 0 && !durable && charged) return "D";
  if (providerCost <= 0 && charged) return "E";
  return "C";
}

describe("billing delivery integrity — D1 normal success", () => {
  it("D1 provider success + completed assistant + one charge", () => {
    withDb((db) => {
      const before = userBalance(db);
      const msgId = insertAssistant(db, {
        requestId: "d1_req",
        generationStatus: "completed",
        content: "final answer",
      });
      const settlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "d1_req",
        assistantMessageId: msgId,
        requestedPoints: 79,
        reason: "D1",
      });
      assert.equal(settlement.appliedNewCharge, true);
      assert.equal(settlement.settledPoints, 79);
      assert.equal(countSettlements(db), 1);
      assert.equal(countNegativeLogs(db), 1);
      assert.equal(userBalance(db), before - 79);
      assert.equal(detectPaidWithoutDurableProduct(db, 1, 1, "d1_req"), false);
    });
  });
});

describe("billing delivery integrity — D2/D7 transport loss", () => {
  it("D2 charge remains when SSE done unavailable (transport lost, DB durable)", () => {
    withDb((db) => {
      const transport = createDisconnectSafeSend(
        () => {
          throw new Error("client disconnected");
        },
        (obj) => new TextEncoder().encode(JSON.stringify(obj))
      );
      const msgId = insertAssistant(db, {
        requestId: "d2_req",
        generationStatus: "completed",
      });
      const settlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "d2_req",
        assistantMessageId: msgId,
        requestedPoints: 79,
        reason: "D2",
      });
      transport.send({ type: "done" });
      assert.equal(settlement.settledPoints, 79);
      assert.equal(transport.isDisconnected(), true);
      const row = db
        .prepare(`SELECT generation_status, content FROM messages WHERE id=?`)
        .get(msgId) as { generation_status: string; content: string };
      assert.equal(classifyReconcileStatus(row.generation_status), "completed");
      assert.ok(row.content.length > 0);
    });
  });

  it("D7 settlement + send failure leaves DB completed and charge intact", () => {
    withDb((db) => {
      const transport = createDisconnectSafeSend(
        () => {
          throw new Error("send failed");
        },
        (obj) => new TextEncoder().encode(JSON.stringify(obj))
      );
      const msgId = insertAssistant(db, {
        requestId: "d7_req",
        generationStatus: "completed",
      });
      const settlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "d7_req",
        assistantMessageId: msgId,
        requestedPoints: 79,
        reason: "D7",
      });
      transport.send({ type: "done" });
      assert.equal(settlement.settledPoints, 79);
      assert.equal(transport.isDisconnected(), true);
    });
  });
});

describe("billing delivery integrity — generation lifecycle owner", () => {
  it("billing pins successful durable generation statuses", () => {
    assert.deepEqual(SUCCESSFUL_DURABLE_GENERATION_STATUSES, [
      "completed",
      "ok",
      "completed_with_postprocess_error",
    ]);
    assert.equal(isSuccessfulDurableGenerationStatus("completed"), true);
    assert.equal(isSuccessfulDurableGenerationStatus("interrupted"), false);
  });
});

describe("billing delivery integrity — D3 missing assistant row", () => {
  it("D3 missing assistant row before settlement → no charge, no settlement row", () => {
    withDb((db) => {
      const before = userBalance(db);
      assert.throws(
        () =>
          settleChatTurnBillingExactlyOnce(db, {
            userId: 1,
            chatId: 1,
            requestId: "d3_req",
            assistantMessageId: 99999,
            requestedPoints: 79,
            reason: "D3",
          }),
        BillingProductNotDeliveredError
      );
      assert.equal(userBalance(db), before);
      assert.equal(countSettlements(db), 0);
      assert.equal(countNegativeLogs(db), 0);
    });
  });
});

describe("billing delivery integrity — D3b/D13b empty product", () => {
  it("D3b completed row with empty content blocks charge (empty_product)", () => {
    withDb((db) => {
      const before = userBalance(db);
      const msgId = insertAssistant(db, {
        requestId: "d3b_empty",
        generationStatus: "completed",
        content: "",
      });
      assert.throws(
        () =>
          settleChatTurnBillingExactlyOnce(db, {
            userId: 1,
            chatId: 1,
            requestId: "d3b_empty",
            assistantMessageId: msgId,
            requestedPoints: 79,
            reason: "D3b",
          }),
        (err: unknown) =>
          err instanceof BillingProductNotDeliveredError && err.reason === "empty_product"
      );
      assert.equal(userBalance(db), before);
      assert.equal(countSettlements(db), 0);
      assert.equal(countNegativeLogs(db), 0);
      const eligibility = readAssistantChargeEligibility(db, msgId, 1, "d3b_empty");
      assert.equal(eligibility.ok, false);
      if (!eligibility.ok) assert.equal(eligibility.reason, "empty_product");
    });
  });

  it("D13b whitespace-only content blocks charge (empty_product)", () => {
    withDb((db) => {
      const msgId = insertAssistant(db, {
        requestId: "d13b_ws",
        generationStatus: "completed",
        content: "   \n\t  ",
      });
      assert.throws(
        () =>
          settleChatTurnBillingExactlyOnce(db, {
            userId: 1,
            chatId: 1,
            requestId: "d13b_ws",
            assistantMessageId: msgId,
            requestedPoints: 79,
            reason: "D13b",
          }),
        (err: unknown) =>
          err instanceof BillingProductNotDeliveredError && err.reason === "empty_product"
      );
      assert.equal(detectPaidWithoutDurableProduct(db, 1, 1, "d13b_ws"), false);
    });
  });

  it("completed_with_postprocess_error with durable content remains billable", () => {
    withDb((db) => {
      const msgId = insertAssistant(db, {
        requestId: "d3b_postprocess",
        generationStatus: "completed_with_postprocess_error",
        content: "recoverable answer",
      });
      const settlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "d3b_postprocess",
        assistantMessageId: msgId,
        requestedPoints: 79,
        reason: "postprocess billable",
      });
      assert.equal(settlement.appliedNewCharge, true);
      assert.equal(settlement.settledPoints, 79);
    });
  });
});

describe("billing delivery integrity — D4 idempotent completed row", () => {
  it("D4 finalize wrote=false (already terminal) + first settlement still charges once", () => {
    withDb((db) => {
      const msgId = insertAssistant(db, {
        requestId: "d4_req",
        generationStatus: "completed",
      });
      const firstFinalize = finalizeAssistantMessageCore(db, {
        assistantMessageId: msgId,
        chatId: 1,
        content: "already done",
        model: "test",
        usageJson: "{}",
        alternatesJson: "[]",
        activeVariant: 0,
        generationStatus: "completed",
      });
      assert.equal(firstFinalize.wrote, false);
      const settlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "d4_req",
        assistantMessageId: msgId,
        requestedPoints: 79,
        reason: "D4 first",
      });
      const replay = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "d4_req",
        assistantMessageId: msgId,
        requestedPoints: 79,
        reason: "D4 replay",
      });
      assert.equal(settlement.appliedNewCharge, true);
      assert.equal(replay.duplicate, true);
      assert.equal(countNegativeLogs(db), 1);
    });
  });
});

describe("billing delivery integrity — D5 generation failure", () => {
  it("D5 failed generation status blocks settlement charge", () => {
    withDb((db) => {
      const msgId = insertAssistant(db, {
        requestId: "d5_req",
        generationStatus: "failed",
      });
      assert.throws(
        () =>
          settleChatTurnBillingExactlyOnce(db, {
            userId: 1,
            chatId: 1,
            requestId: "d5_req",
            assistantMessageId: msgId,
            requestedPoints: 79,
            reason: "D5",
          }),
        (err: unknown) =>
          err instanceof BillingProductNotDeliveredError &&
          err.reason === "not_durable_terminal"
      );
      assert.equal(countSettlements(db), 0);
      assert.equal(countNegativeLogs(db), 0);
    });
  });
});

describe("billing delivery integrity — D6 provider cost without product", () => {
  it("D6 platform provider loss is classified separately from user charge", () => {
    const category = classifyTurnForensic({
      providerCostUsd: 0.019,
      durableProduct: false,
      userChargedPoints: 0,
    });
    assert.equal(category, "C");
    assert.notEqual(category, "D");
  });
});

describe("billing delivery integrity — D8/D9 crash windows", () => {
  it("D8 durable answer finalized but no settlement → no phantom charge", () => {
    withDb((db) => {
      const before = userBalance(db);
      const msgId = insertAssistant(db, {
        requestId: "d8_req",
        generationStatus: "generating",
      });
      const finalized = finalizeAssistantMessageCore(db, {
        assistantMessageId: msgId,
        chatId: 1,
        content: "durable before crash",
        model: "test",
        usageJson: "{}",
        alternatesJson: "[]",
        activeVariant: 0,
        generationStatus: "completed",
      });
      assert.equal(finalized.wrote, true);
      assert.equal(countSettlements(db), 0);
      assert.equal(userBalance(db), before);
    });
  });

  it("D9 durable answer + settlement survives without SSE terminal", () => {
    withDb((db) => {
      const msgId = insertAssistant(db, {
        requestId: "d9_req",
        generationStatus: "completed",
        content: "reload recoverable",
      });
      const settlement = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "d9_req",
        assistantMessageId: msgId,
        requestedPoints: 79,
        reason: "D9",
      });
      assert.equal(settlement.settledPoints, 79);
      const row = db
        .prepare(`SELECT content, generation_status FROM messages WHERE id=?`)
        .get(msgId) as { content: string; generation_status: string };
      assert.ok(isSuccessfulDurableGenerationStatus(row.generation_status));
      assert.ok(row.content.includes("reload"));
    });
  });
});

describe("billing delivery integrity — D10/D11 exactly-once", () => {
  it("D10 same request replay → exactly one settlement", () => {
    withDb((db) => {
      const msgId = insertAssistant(db, { requestId: "d10_req", generationStatus: "completed" });
      const first = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "d10_req",
        assistantMessageId: msgId,
        requestedPoints: 79,
        reason: "D10",
      });
      const second = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "d10_req",
        assistantMessageId: msgId,
        requestedPoints: 79,
        reason: "D10 replay",
      });
      assert.equal(first.appliedNewCharge, true);
      assert.equal(second.duplicate, true);
      assert.equal(countSettlements(db), 1);
      assert.equal(countNegativeLogs(db), 1);
    });
  });
});

describe("billing delivery integrity — D12 regeneration", () => {
  it("D12 new regen request_id charges independently; stale fresh claim blocked", () => {
    withDb((db) => {
      const assistantId = insertAssistant(db, {
        requestId: "d12_regen_a",
        generationStatus: "completed",
      });
      const first = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "d12_regen_a",
        assistantMessageId: assistantId,
        requestedPoints: 79,
        reason: "old gen",
      });
      db.prepare(`UPDATE messages SET request_id='d12_regen_b' WHERE id=?`).run(assistantId);
      const staleReplay = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "d12_regen_a",
        assistantMessageId: assistantId,
        requestedPoints: 79,
        reason: "stale regen replay",
      });
      const second = settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "d12_regen_b",
        assistantMessageId: assistantId,
        requestedPoints: 90,
        reason: "new regen",
      });
      const failedRegen = insertAssistant(db, {
        requestId: "d12_regen_fail",
        generationStatus: "failed",
      });
      assert.throws(
        () =>
          settleChatTurnBillingExactlyOnce(db, {
            userId: 1,
            chatId: 1,
            requestId: "d12_regen_fail",
            assistantMessageId: failedRegen,
            requestedPoints: 90,
            reason: "failed regen",
          }),
        BillingProductNotDeliveredError
      );
      assert.equal(first.appliedNewCharge, true);
      assert.equal(staleReplay.duplicate, true);
      assert.equal(second.appliedNewCharge, true);
      assert.equal(countSettlements(db), 2);
      assert.equal(countNegativeLogs(db), 2);
    });
  });
});

describe("billing delivery integrity — D13 integrity invariant", () => {
  it("D13 detectPaidWithoutDurableProduct flags category-D violations only", () => {
    withDb((db) => {
      const msgId = insertAssistant(db, {
        requestId: "d13_ok",
        generationStatus: "completed",
      });
      settleChatTurnBillingExactlyOnce(db, {
        userId: 1,
        chatId: 1,
        requestId: "d13_ok",
        assistantMessageId: msgId,
        requestedPoints: 79,
        reason: "valid",
      });
      assert.equal(detectPaidWithoutDurableProduct(db, 1, 1, "d13_ok"), false);

      db.prepare(
        `INSERT INTO chat_billing_settlements
         (user_id, chat_id, request_id, charge_kind, assistant_message_id, requested_points, settled_points, outcome, deduction_slices_json, reason, source)
         VALUES (1, 1, 'd13_bad', 'chat_turn', ?, 79, 79, 'charged', '[]', 'synthetic', 'native')`
      ).run(msgId);
      db.prepare(`UPDATE messages SET generation_status='failed' WHERE id=?`).run(msgId);
      assert.equal(detectPaidWithoutDurableProduct(db, 1, 1, "d13_bad"), true);
      assert.equal(
        classifyTurnForensic({
          providerCostUsd: 0.01,
          durableProduct: false,
          userChargedPoints: 79,
        }),
        "D"
      );
    });
  });
});

describe("billing delivery integrity — D14 refund via canonical owner", () => {
  before(() => installIsolatedTestDatabase());
  after(() => uninstallIsolatedTestDatabase());

  it("D14 refundMessageDeduction restores exact lots and settlement marker", () => {
    const db = getDb();
    const userRow = db
      .prepare(`INSERT INTO users (email, nickname, pw_hash, points) VALUES (?, ?, ?, ?)`)
      .run("d14@test.local", "d14user", "x", 10_000);
    const userId = Number(userRow.lastInsertRowid);
    db.prepare(
      `INSERT INTO point_transactions (user_id, point_type, remaining_amount, expires_at)
       VALUES (?, 'PAID', 10000, '2030-01-01')`
    ).run(userId);
    db.prepare(`INSERT INTO characters (name) VALUES ('d14char')`).run();
    const characterId = Number(
      (db.prepare(`SELECT id FROM characters WHERE name='d14char'`).get() as { id: number }).id
    );
    const chatRow = db
      .prepare(`INSERT INTO chats (user_id, character_id) VALUES (?, ?)`)
      .run(userId, characterId);
    const chatId = Number(chatRow.lastInsertRowid);
    const msgRow = db
      .prepare(
        `INSERT INTO messages (chat_id, role, content, request_id, generation_status)
         VALUES (?, 'assistant', ?, ?, 'completed')`
      )
      .run(chatId, "refundable answer", "d14_req");
    const msgId = Number(msgRow.lastInsertRowid);

    const beforeLots = db
      .prepare(
        `SELECT id, point_type, remaining_amount FROM point_transactions WHERE user_id=? ORDER BY id`
      )
      .all(userId) as Array<{ id: number; point_type: string; remaining_amount: number }>;
    const balanceBeforeCharge = getPointBalance(userId).total;

    const settlement = settleChatTurnBillingExactlyOnce(db, {
      userId,
      chatId,
      requestId: "d14_req",
      assistantMessageId: msgId,
      requestedPoints: 79,
      reason: "D14 charge",
    });
    assert.equal(settlement.appliedNewCharge, true);
    assert.ok(settlement.slices.length > 0);
    assert.equal(settlement.slices[0]!.pointType, "PAID");
    assert.equal(getPointBalance(userId).total, balanceBeforeCharge - 79);

    const consumedLot = db
      .prepare(`SELECT remaining_amount, point_type FROM point_transactions WHERE id=?`)
      .get(settlement.slices[0]!.transactionId) as {
      remaining_amount: number;
      point_type: string;
    };
    assert.ok(consumedLot.remaining_amount < beforeLots[0]!.remaining_amount);

    refundMessageDeduction(userId, msgId, settlement.slices, settlement.settledPoints, "D14 refund");

    const restoredLot = db
      .prepare(`SELECT remaining_amount, point_type FROM point_transactions WHERE id=?`)
      .get(settlement.slices[0]!.transactionId) as {
      remaining_amount: number;
      point_type: string;
    };
    assert.equal(restoredLot.point_type, "PAID");
    assert.equal(restoredLot.remaining_amount, beforeLots[0]!.remaining_amount);
    assert.equal(getPointBalance(userId).total, balanceBeforeCharge);

    const messageRow = db
      .prepare(`SELECT is_refunded FROM messages WHERE id=?`)
      .get(msgId) as { is_refunded: number };
    assert.equal(messageRow.is_refunded, 1);

    const settlementRow = db
      .prepare(`SELECT refunded_at FROM chat_billing_settlements WHERE request_id='d14_req'`)
      .get() as { refunded_at: string | null };
    assert.ok(settlementRow.refunded_at);

    const replay = settleChatTurnBillingExactlyOnce(db, {
      userId,
      chatId,
      requestId: "d14_req",
      assistantMessageId: msgId,
      requestedPoints: 79,
      reason: "D14 replay after refund",
    });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.appliedNewCharge, false);
  });
});
