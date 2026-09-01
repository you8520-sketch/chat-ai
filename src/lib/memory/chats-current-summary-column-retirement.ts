import type Database from "better-sqlite3";
import {
  hasChatsCurrentSummaryColumn,
  hasChatsMemoryColumn,
} from "./chats-memory-column-compat";
import { convergeLegacyChatsMemoryIntoCanonical } from "./chats-memory-convergence";
import {
  chatsTableExists,
  hasChatsTableColumn,
} from "./chats-memory-column-retirement";

export type LegacyCurrentSummaryRecoveryCandidate = {
  chatId: number;
  expectedText: string;
};

function selectLegacyRecoveryText(
  row: {
    current_summary?: string | null;
    memory?: string | null;
  },
  hasMemoryCol: boolean
): string {
  const currentSummary = row.current_summary?.trim() ?? "";
  if (currentSummary) return currentSummary;
  if (!hasMemoryCol) return "";
  return row.memory?.trim() ?? "";
}

/** Chats without canonical chat_memories that carry recoverable legacy summary text. */
export function listLegacyCurrentSummaryRecoveryCandidates(
  db: Database.Database
): LegacyCurrentSummaryRecoveryCandidate[] {
  if (!chatsTableExists(db, "chats")) return [];
  if (!hasChatsCurrentSummaryColumn(db)) return [];

  const hasMemoryCol = hasChatsMemoryColumn(db);
  const selectCols = ["c.id", "c.user_id", "c.character_id"];
  if (hasMemoryCol) selectCols.push("c.memory");
  if (hasChatsCurrentSummaryColumn(db)) selectCols.push("c.current_summary");

  const rows = db
    .prepare(
      `SELECT ${selectCols.join(", ")}
       FROM chats c
       LEFT JOIN chat_memories cm ON cm.chat_id = c.id
       WHERE cm.chat_id IS NULL`
    )
    .all() as Array<{
    id: number;
    current_summary?: string | null;
    memory?: string | null;
  }>;

  const candidates: LegacyCurrentSummaryRecoveryCandidate[] = [];
  for (const row of rows) {
    const expectedText = selectLegacyRecoveryText(row, hasMemoryCol);
    if (!expectedText) continue;
    candidates.push({ chatId: row.id, expectedText });
  }
  return candidates;
}

function countUnrecoveredLegacyCurrentOnlyRows(db: Database.Database): number {
  if (!hasChatsCurrentSummaryColumn(db)) return 0;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM chats c
       LEFT JOIN chat_memories cm ON cm.chat_id = c.id
       WHERE cm.chat_id IS NULL
         AND TRIM(COALESCE(c.current_summary, '')) <> ''`
    )
    .get() as { c: number };
  return Number(row.c);
}

function countNonemptyCurrentSummaryRows(db: Database.Database): number {
  if (!hasChatsCurrentSummaryColumn(db)) return 0;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM chats
       WHERE TRIM(COALESCE(current_summary, '')) <> ''`
    )
    .get() as { c: number };
  return Number(row.c);
}

/** Schema objects other than chats table DDL that reference chats.current_summary. */
export function listBlockingChatsCurrentSummarySchemaDependencies(
  db: Database.Database
): string[] {
  const rows = db
    .prepare(
      `SELECT type, name, tbl_name FROM sqlite_master
       WHERE sql IS NOT NULL
         AND INSTR(LOWER(sql), 'current_summary') > 0
         AND NOT (type = 'table' AND name = 'chats')`
    )
    .all() as Array<{ type: string; name: string; tbl_name: string }>;
  return rows.map((row) => `${row.type}:${row.name}`);
}

export function verifyLegacyCurrentSummaryRecovery(
  db: Database.Database,
  candidates: LegacyCurrentSummaryRecoveryCandidate[]
): void {
  for (const candidate of candidates) {
    const canonical = db
      .prepare(`SELECT recent_summary FROM chat_memories WHERE chat_id=?`)
      .get(candidate.chatId) as { recent_summary: string } | undefined;
    if (!canonical || canonical.recent_summary !== candidate.expectedText) {
      throw new Error(
        `Refusing to DROP chats.current_summary: unrecovered legacy chat_id=${candidate.chatId}`
      );
    }
  }

  const unrecovered = countUnrecoveredLegacyCurrentOnlyRows(db);
  if (unrecovered > 0) {
    throw new Error(
      `Refusing to DROP chats.current_summary: ${unrecovered} legacy current-only rows remain`
    );
  }

  const nonempty = countNonemptyCurrentSummaryRows(db);
  if (nonempty > 0) {
    throw new Error(
      `Refusing to DROP chats.current_summary: ${nonempty} nonempty carrier rows remain`
    );
  }
}

/**
 * Physical retirement of chats.current_summary (#806 C2 carrier → absent).
 * Self-verifying recover-before-drop owner. Idempotent via actual column presence.
 */
export function dropChatsCurrentSummaryColumnOnce(db: Database.Database): void {
  if (!chatsTableExists(db, "chats")) return;
  if (!hasChatsCurrentSummaryColumn(db)) return;

  const candidates = listLegacyCurrentSummaryRecoveryCandidates(db);
  convergeLegacyChatsMemoryIntoCanonical(db);
  verifyLegacyCurrentSummaryRecovery(db, candidates);

  const dependencies = listBlockingChatsCurrentSummarySchemaDependencies(db);
  if (dependencies.length > 0) {
    throw new Error(
      `Refusing to DROP chats.current_summary: schema dependencies ${dependencies.join(", ")}`
    );
  }

  db.exec(`ALTER TABLE chats DROP COLUMN current_summary`);

  if (hasChatsCurrentSummaryColumn(db)) {
    throw new Error("chats.current_summary still present after DROP COLUMN");
  }
}

export {
  countNonemptyCurrentSummaryRows,
  countUnrecoveredLegacyCurrentOnlyRows,
  hasChatsTableColumn as hasChatsColumn,
};
