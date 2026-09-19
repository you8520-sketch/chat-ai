/**
 * Child-process worker for overlapping nonnumeric variant PATCH simulation.
 * Invoked from rpNonnumericVariantToctou.test.ts only.
 */
import Database from "better-sqlite3";
import { executeAtomicNonnumericVariantSwitch } from "@/lib/nonnumericVariantSwitchAtomic";
import {
  NumericHistoricalVariantReplayUnsupportedError,
  NumericVariantFrontierMovedError,
} from "@/lib/rpNumericState/types";

type StartMessage = {
  type: "start";
  dbPath: string;
  input: {
    chatId: number;
    characterId: number;
    userId: number;
    messageId: number;
    variantIndex: number;
    workerLabel: string;
  };
};

function sendResult(payload: Record<string, unknown>): void {
  process.send?.({ type: "result", ...payload });
}

process.send?.({ type: "ready" });

process.on("message", (message: StartMessage) => {
  if (message.type !== "start") return;
  let db: Database.Database | undefined;
  try {
    db = new Database(message.dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 10000");
    const result = executeAtomicNonnumericVariantSwitch(db, message.input);
    sendResult({
      ok: true,
      workerLabel: message.input.workerLabel,
      kind: result.kind,
      activeVariant: result.activeVariant,
      selectedContent: result.selectedContent,
    });
  } catch (e) {
    const err = e as Error & { code?: string };
    sendResult({
      ok: false,
      workerLabel: message.input.workerLabel,
      name: err.name,
      code:
        err instanceof NumericVariantFrontierMovedError ||
        err instanceof NumericHistoricalVariantReplayUnsupportedError
          ? err.code
          : err.code ?? "UNKNOWN",
      message: err.message,
    });
  } finally {
    db?.close();
    process.exit(0);
  }
});

process.on("uncaughtException", (err) => {
  sendResult({
    ok: false,
    workerLabel: "unknown",
    name: err.name,
    code: "UNCAUGHT",
    message: err.message,
  });
  process.exit(0);
});
