import type Database from "better-sqlite3";
import { normalizeCommentTextForModeration } from "@/lib/commentTextNormalize";
import type { CommentBannedWordCategory } from "@/lib/commentModerationPolicy";

export type CommentBannedWord = {
  id: number;
  word: string;
  category: CommentBannedWordCategory;
  match_type: "substring" | "regex";
  ai_check: number;
  enabled: number;
  created_at: string;
  updated_at: string;
};

export type BannedWordMatch = {
  id: number;
  word: string;
  category: CommentBannedWordCategory;
  match_type: "substring" | "regex";
  ai_check: boolean;
};

export function listCommentBannedWords(
  db: Database.Database,
  opts?: { enabledOnly?: boolean; category?: CommentBannedWordCategory }
): CommentBannedWord[] {
  let sql = "SELECT * FROM comment_banned_words WHERE 1=1";
  const params: unknown[] = [];
  if (opts?.enabledOnly) {
    sql += " AND enabled=1";
  }
  if (opts?.category) {
    sql += " AND category=?";
    params.push(opts.category);
  }
  sql += " ORDER BY category ASC, id ASC";
  return db.prepare(sql).all(...params) as CommentBannedWord[];
}

export function insertCommentBannedWord(
  db: Database.Database,
  input: {
    word: string;
    category: CommentBannedWordCategory;
    match_type?: "substring" | "regex";
    ai_check?: boolean;
  }
): number {
  const result = db
    .prepare(
      `INSERT INTO comment_banned_words (word, category, match_type, ai_check, enabled, updated_at)
       VALUES (?,?,?,?,1,datetime('now'))`
    )
    .run(
      input.word.trim(),
      input.category,
      input.match_type ?? "substring",
      input.ai_check === false ? 0 : 1
    );
  return Number(result.lastInsertRowid);
}

export function deleteCommentBannedWord(db: Database.Database, id: number): boolean {
  const result = db.prepare("DELETE FROM comment_banned_words WHERE id=?").run(id);
  return result.changes > 0;
}

export function updateCommentBannedWord(
  db: Database.Database,
  id: number,
  patch: Partial<{
    word: string;
    category: CommentBannedWordCategory;
    match_type: "substring" | "regex";
    ai_check: boolean;
    enabled: boolean;
  }>
): boolean {
  const row = db.prepare("SELECT id FROM comment_banned_words WHERE id=?").get(id);
  if (!row) return false;
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.word != null) {
    fields.push("word=?");
    values.push(patch.word.trim());
  }
  if (patch.category != null) {
    fields.push("category=?");
    values.push(patch.category);
  }
  if (patch.match_type != null) {
    fields.push("match_type=?");
    values.push(patch.match_type);
  }
  if (patch.ai_check != null) {
    fields.push("ai_check=?");
    values.push(patch.ai_check ? 1 : 0);
  }
  if (patch.enabled != null) {
    fields.push("enabled=?");
    values.push(patch.enabled ? 1 : 0);
  }
  if (fields.length === 0) return true;
  fields.push("updated_at=datetime('now')");
  values.push(id);
  db.prepare(`UPDATE comment_banned_words SET ${fields.join(", ")} WHERE id=?`).run(...values);
  return true;
}

export function bulkInsertCommentBannedWords(
  db: Database.Database,
  rows: { word: string; category: CommentBannedWordCategory; match_type?: "substring" | "regex"; ai_check?: boolean }[]
): number {
  const insert = db.prepare(
    `INSERT INTO comment_banned_words (word, category, match_type, ai_check, enabled, updated_at)
     VALUES (?,?,?,?,1,datetime('now'))`
  );
  let count = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const word = row.word.trim();
      if (!word) continue;
      insert.run(word, row.category, row.match_type ?? "substring", row.ai_check === false ? 0 : 1);
      count += 1;
    }
  });
  tx();
  return count;
}

/** 정규화된 본문에서 금지어 매칭 */
export function matchCommentBannedWords(
  db: Database.Database,
  rawContent: string
): { normalized: string; matches: BannedWordMatch[]; requiresAi: boolean } {
  const normalized = normalizeCommentTextForModeration(rawContent);
  const words = listCommentBannedWords(db, { enabledOnly: true });
  const matches: BannedWordMatch[] = [];

  for (const w of words) {
    if (w.match_type === "regex") {
      try {
        const re = new RegExp(w.word, "iu");
        if (re.test(rawContent) || re.test(normalized)) {
          matches.push({
            id: w.id,
            word: w.word,
            category: w.category,
            match_type: w.match_type,
            ai_check: w.ai_check !== 0,
          });
        }
      } catch {
        continue;
      }
      continue;
    }
    const needle = normalizeCommentTextForModeration(w.word);
    if (!needle) continue;
    if (normalized.includes(needle)) {
      matches.push({
        id: w.id,
        word: w.word,
        category: w.category,
        match_type: w.match_type,
        ai_check: w.ai_check !== 0,
      });
    }
  }

  const requiresAi = matches.some((m) => m.ai_check);
  return { normalized, matches, requiresAi };
}
