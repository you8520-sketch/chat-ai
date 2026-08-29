/**
 * Fork entry for true concurrent settlement overlap tests.
 * Spawned with: node --conditions=react-server --import tsx concurrentFork.ts
 */

import process from "node:process";
import Database from "better-sqlite3";
import { settleChatTurnBillingExactlyOnce } from "./chatBillingSettlement";

type StartMessage = {
  type: "start";
  dbPath: string;
  input: {
    userId: number;
    chatId: number;
    requestId: string;
    assistantMessageId: number;
    requestedPoints: number;
    reason: string;
  };
};

process.on("message", (message: StartMessage) => {
  if (message?.type !== "start") return;
  try {
    const db = new Database(message.dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    const result = settleChatTurnBillingExactlyOnce(db, message.input);
    db.close();
    process.send?.({
      type: "result",
      ok: true,
      appliedNewCharge: result.appliedNewCharge,
      duplicate: result.duplicate,
      settledPoints: result.settledPoints,
      settlementId: result.settlementId,
    });
    process.exit(0);
  } catch (error) {
    process.send?.({
      type: "result",
      ok: false,
      code: (error as Error & { code?: string }).code ?? "UNKNOWN",
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : "Error",
    });
    process.exit(1);
  }
});

process.send?.({ type: "ready" });
