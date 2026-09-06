import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export const CANONICAL_INITIAL_HISTORY_MARKER = "[playwright-canonical-initial-history]";

type SeededHistory = {
  dbPath: string;
  marker: string;
  assistantCount: number;
};

function requireCanonicalPlaywrightDatabasePath(): string {
  const dataDir = process.env.PLAYWRIGHT_DATA_DIR;
  if (!dataDir) {
    throw new Error("PLAYWRIGHT_DATA_DIR must be resolved by playwright.config.ts");
  }

  const dbPath = path.resolve(dataDir, "app.db");
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Expected app bootstrap to create the canonical database first: ${dbPath}`);
  }
  return dbPath;
}

/**
 * Inserts only completed message rows into the database already bootstrapped by
 * the application. This helper intentionally owns neither schema nor chat creation.
 */
export function seedCanonicalCompletedChatHistory(chatId: number, turns = 10): SeededHistory {
  const dbPath = requireCanonicalPlaywrightDatabasePath();
  const db = new Database(dbPath);
  const marker = `${CANONICAL_INITIAL_HISTORY_MARKER}:${chatId}`;

  try {
    const columns = new Set(
      (db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>).map(({ name }) => name)
    );
    for (const required of ["chat_id", "role", "content", "model", "generation_status"]) {
      if (!columns.has(required)) throw new Error(`App bootstrap schema is missing messages.${required}`);
    }

    const insert = db.prepare(
      "INSERT INTO messages (chat_id, role, content, model, generation_status) VALUES (?, ?, ?, ?, 'completed')"
    );
    db.transaction(() => {
      for (let index = 1; index <= turns; index += 1) {
        insert.run(chatId, "user", `fixture history user ${index}`, "playwright-fixture");
        const suffix = index === turns ? ` ${marker}` : "";
        insert.run(
          chatId,
          "assistant",
          `fixture history assistant ${index}. ${"완료된 일반 채팅 기록입니다. ".repeat(14)}${suffix}`,
          "playwright-fixture"
        );
      }
    })();

    return { dbPath, marker, assistantCount: turns };
  } finally {
    db.close();
  }
}
