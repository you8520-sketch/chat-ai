import type Database from "better-sqlite3";

export type ChatMessageHygieneRow = {
  id: number;
  role: "user" | "assistant";
  model?: string;
};

/** AI 답변 없이 DB에만 남은 유저 메시지 (과거 생성 실패 잔여) */
export function findOrphanUserMessageIds(rows: ChatMessageHygieneRow[]): number[] {
  const orphans: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.role !== "user") continue;
    const next = rows[i + 1];
    if (!next || next.role !== "assistant" || next.model === "greeting") {
      orphans.push(row.id);
    }
  }
  return orphans;
}

export function deleteChatMessagesByIds(
  db: Database.Database,
  chatId: number,
  ids: number[]
): void {
  if (ids.length === 0) return;
  db.transaction(() => {
    for (const id of ids) {
      db.prepare("DELETE FROM bookmarks WHERE message_id=?").run(id);
      db.prepare("DELETE FROM message_feedback WHERE message_id=?").run(id);
      db.prepare("DELETE FROM reports WHERE message_id=?").run(id);
      db.prepare("DELETE FROM messages WHERE id=? AND chat_id=?").run(id, chatId);
    }
  })();
}

/** 실패 턴 유저 메시지 삭제 — id 목록 반환 */
export function purgeOrphanUserMessages(
  db: Database.Database,
  chatId: number,
  rows: ChatMessageHygieneRow[]
): number[] {
  const orphanIds = findOrphanUserMessageIds(rows);
  deleteChatMessagesByIds(db, chatId, orphanIds);
  if (orphanIds.length > 0) {
    console.info(`[chat] purged ${orphanIds.length} orphan user message(s) chat=${chatId}`, orphanIds);
  }
  return orphanIds;
}

export function filterOutMessageIds<T extends { id: number }>(
  rows: T[],
  idsToRemove: number[]
): T[] {
  if (idsToRemove.length === 0) return rows;
  const drop = new Set(idsToRemove);
  return rows.filter((r) => !drop.has(r.id));
}
