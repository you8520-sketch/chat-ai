/**
 * Fork entry for true concurrent report-refund overlap tests.
 */

import process from "node:process";
import { getDb } from "./db";
import { processReportRefund } from "./refund";

type StartMessage = {
  type: "start";
  dataDir: string;
  input: {
    userId: number;
    messageId: number;
    chatId: number;
    category: "under_length";
  };
};

function isDatabaseLocked(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.toLowerCase().includes("database is locked");
}

function openRefundDb(dataDir: string): ReturnType<typeof getDb> {
  process.env.DATA_DIR = dataDir;
  global.__db = undefined;
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    try {
      const db = getDb();
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 5000");
      return db;
    } catch (err) {
      if (!isDatabaseLocked(err) || attempt === 40) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * attempt);
      global.__db = undefined;
    }
  }
  throw new Error("failed to open refund db");
}

process.on("message", (message: StartMessage) => {
  if (message?.type !== "start") return;
  try {
    openRefundDb(message.dataDir);
    const result = processReportRefund(
      message.input.userId,
      message.input.messageId,
      message.input.chatId,
      message.input.category
    );
    if (global.__db) {
      global.__db.close();
      global.__db = undefined;
    }
    process.send?.({
      type: "result",
      ok: true,
      status: result.status,
      autoRefund: result.status === "approved" ? result.autoRefund : false,
    });
    process.exit(0);
  } catch (error) {
    if (global.__db) {
      try {
        global.__db.close();
      } catch {
        // ignore close errors after failure
      }
      global.__db = undefined;
    }
    process.send?.({
      type: "result",
      ok: false,
      message:
        error instanceof Error
          ? `${error.name}: ${error.message}\n${error.stack ?? ""}`
          : String(error),
    });
    process.exit(1);
  }
});

process.send?.({ type: "ready" });
