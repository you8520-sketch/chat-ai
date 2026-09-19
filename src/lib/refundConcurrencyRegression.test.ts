import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, it } from "node:test";
import { getDb } from "@/lib/db";
import { installIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";
import { creditPoints, deductPoints, type DeductionSlice } from "@/lib/points";
import { processReportRefund, reviewReportRefund } from "@/lib/refund";
import { AUTO_REFUND_DAILY_LIMIT } from "@/lib/reportRefundPolicy";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";
import type { Usage } from "@/lib/chatUsage";

const CONCURRENT_FORK_PATH = fileURLToPath(
  new URL("./refund.concurrentFork.ts", import.meta.url)
);
const CONCURRENT_FORK_EXEC_ARGV = ["--conditions=react-server", "--import", "tsx"];

let characterId = 0;
let dataDir = "";

type RefundWorkerResult =
  | { ok: true; status: string; autoRefund: boolean }
  | { ok: false; message: string };

function spawnRefundFork(input: {
  userId: number;
  messageId: number;
  chatId: number;
}): { child: ChildProcess; ready: Promise<void>; result: Promise<RefundWorkerResult> } {
  const child = fork(CONCURRENT_FORK_PATH, [], {
    execArgv: CONCURRENT_FORK_EXEC_ARGV,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });

  let readyResolve!: () => void;
  const ready = new Promise<void>((resolve) => {
    readyResolve = resolve;
  });

  const result = new Promise<RefundWorkerResult>((resolve, reject) => {
    let settled = false;
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
            status: String(message.status),
            autoRefund: Boolean(message.autoRefund),
          });
        } else {
          resolve({
            ok: false,
            message: String(message.message ?? "unknown"),
          });
        }
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!settled && code !== 0 && code !== null) {
        reject(new Error(`fork exited ${code}`));
      }
    });
  });

  return { child, ready, result };
}

function releaseDbForConcurrentWorkers(): void {
  if (global.__db) {
    try {
      global.__db.pragma("wal_checkpoint(FULL)");
    } catch {
      // best-effort checkpoint before fork workers attach
    }
    global.__db.close();
    global.__db = undefined;
  }
}

function reopenDbAfterConcurrentWorkers(): void {
  getDb().pragma("journal_mode = WAL");
}

function runConcurrentRefundWorkers(
  workers: Array<{ userId: number; messageId: number; chatId: number }>
): Promise<RefundWorkerResult[]> {
  const spawned = workers.map((input) => spawnRefundFork(input));
  return Promise.all(spawned.map((s) => s.ready)).then(async () => {
    for (let i = 0; i < spawned.length; i += 1) {
      spawned[i]!.child.send({
        type: "start",
        dataDir,
        input: { ...workers[i]!, category: "under_length" as const },
      });
    }
    const results = await Promise.all(spawned.map((s) => s.result));
    for (const s of spawned) {
      s.child.kill();
    }
    return results;
  });
}

before(() => {
  installIsolatedTestDatabase();
  dataDir = process.env.DATA_DIR!;
  const db = getDb();
  db.pragma("journal_mode = WAL");
  ensureChatBillingSettlementSchema(db);
  characterId = Number(
    db.prepare("INSERT INTO characters (name) VALUES ('refund-concurrency')").run().lastInsertRowid
  );
});

function createUser(): number {
  const tag = `rc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  return Number(
    getDb()
      .prepare("INSERT INTO users (email, nickname, pw_hash, points) VALUES (?,?,?,0)")
      .run(`${tag}@t.local`, tag, "x").lastInsertRowid
  );
}

function createChat(userId: number): number {
  return Number(
    getDb()
      .prepare("INSERT INTO chats (user_id, character_id) VALUES (?,?)")
      .run(userId, characterId).lastInsertRowid
  );
}

function chargeAndInsertAssistant(opts: {
  userId: number;
  chatId: number;
  content?: string;
  cost?: number;
}): { messageId: number; slices: DeductionSlice[] } {
  const cost = opts.cost ?? 10;
  creditPoints(opts.userId, cost + 100, "PAID", "test credit");
  const messageId = Number(
    getDb()
      .prepare(
        `INSERT INTO messages (chat_id, role, content, model, generation_status)
         VALUES (?, 'assistant', ?, 'test-model', 'completed')`
      )
      .run(opts.chatId, opts.content ?? "짧음").lastInsertRowid
  );
  const deducted = deductPoints(opts.userId, cost, "test charge", {
    messageId,
    chatId: opts.chatId,
  });
  const usage: Usage = {
    input: 100,
    output: 200,
    model: "test-model",
    route: "safe",
    cost,
    savedOutputChars: 800,
    breakdown: [],
  };
  getDb()
    .prepare("UPDATE messages SET usage = ?, deduction_slices = ? WHERE id = ?")
    .run(JSON.stringify(usage), JSON.stringify(deducted.slices), messageId);
  return { messageId, slices: deducted.slices };
}

describe("refund concurrency regression", () => {
  it("4 simultaneous valid reports → max 3 auto, remaining pending", async () => {
    const userId = createUser();
    const chatId = createChat(userId);
    const workers = Array.from({ length: 4 }, () => {
      const { messageId } = chargeAndInsertAssistant({ userId, chatId });
      return { userId, chatId, messageId };
    });

    releaseDbForConcurrentWorkers();
    const results = await runConcurrentRefundWorkers(workers);
    reopenDbAfterConcurrentWorkers();
    assert.equal(results.length, 4);
    const failures = results.filter((r) => !r.ok);
    assert.equal(failures.length, 0, failures.map((f) => f.message).join("\n"));

    const approved = results.filter((r) => r.ok && r.status === "approved");
    const pending = results.filter((r) => r.ok && r.status === "pending");
    assert.equal(approved.length, AUTO_REFUND_DAILY_LIMIT);
    assert.ok(pending.length >= 1);

    const autoCount = (
      getDb()
        .prepare(
          `SELECT COUNT(*) AS c FROM report_refunds
           WHERE user_id = ? AND auto_refund = 1 AND status = 'approved'`
        )
        .get(userId) as { c: number }
    ).c;
    assert.equal(autoCount, AUTO_REFUND_DAILY_LIMIT);
  });

  it("same message concurrent report → refund exactly once", async () => {
    const userId = createUser();
    const chatId = createChat(userId);
    const { messageId } = chargeAndInsertAssistant({ userId, chatId, content: "짧음" });
    const workers = Array.from({ length: 4 }, () => ({ userId, chatId, messageId }));

    releaseDbForConcurrentWorkers();
    const results = await runConcurrentRefundWorkers(workers);
    reopenDbAfterConcurrentWorkers();
    const failures = results.filter((r) => !r.ok);
    assert.equal(failures.length, 0, failures.map((f) => f.message).join("\n"));
    const approved = results.filter((r) => r.ok && r.status === "approved");
    const rejected = results.filter((r) => r.ok && r.status === "rejected");
    assert.equal(approved.length, 1);
    assert.equal(rejected.length, 3);

    const refunded = (
      getDb().prepare("SELECT is_refunded FROM messages WHERE id = ?").get(messageId) as {
        is_refunded: number;
      }
    ).is_refunded;
    assert.equal(refunded, 1);
  });

  it("auto-refund vs admin-approve race → refund exactly once", async () => {
    const userId = createUser();
    const chatId = createChat(userId);
    for (let i = 0; i < AUTO_REFUND_DAILY_LIMIT; i++) {
      const { messageId } = chargeAndInsertAssistant({ userId, chatId, content: "짧음" });
      processReportRefund(userId, messageId, chatId, "under_length");
    }

    const { messageId } = chargeAndInsertAssistant({ userId, chatId, content: "짧음" });
    const pending = processReportRefund(userId, messageId, chatId, "under_length");
    assert.equal(pending.status, "pending");

    const reportId = (
      getDb()
        .prepare("SELECT id FROM report_refunds WHERE message_id = ?")
        .get(messageId) as { id: number }
    ).id;

    const forked = spawnRefundFork({ userId, messageId, chatId });
    await forked.ready;
    forked.child.send({
      type: "start",
      dataDir,
      input: { userId, messageId, chatId, category: "under_length" },
    });
    const adminResult = reviewReportRefund(reportId, "approve");
    const forkResult = await forked.result;
    forked.child.kill();

    const successCount =
      (forkResult.ok && forkResult.status === "approved" ? 1 : 0) +
      (adminResult.ok === true ? 1 : 0);
    assert.ok(successCount <= 1);

    const refundRows = getDb()
      .prepare(`SELECT status FROM report_refunds WHERE message_id = ?`)
      .all(messageId) as Array<{ status: string }>;
    assert.equal(refundRows.length, 1);
    assert.equal(refundRows[0]!.status, "approved");
  });
});
