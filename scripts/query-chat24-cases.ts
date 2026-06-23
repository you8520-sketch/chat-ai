import Database from "better-sqlite3";
import path from "path";

const chatId = 24;
const db = new Database(path.join(process.cwd(), "data", "app.db"));

const byLen = db
  .prepare(
    `SELECT id, length(content) as len, substr(content,1,80) as preview
     FROM messages WHERE chat_id=? AND role='assistant'
     AND (length(content) BETWEEN 2780 AND 2860 OR length(content) BETWEEN 3500 AND 3550)
     ORDER BY id DESC`
  )
  .all(chatId) as { id: number; len: number; preview: string }[];

console.log("=== By length range ===");
for (const r of byLen) {
  console.log(`#${r.id}  ${r.len}  ${r.preview.replace(/\n/g, " ")}`);
}

const byPreview = db
  .prepare(
    `SELECT id, length(content) as len, substr(content,1,80) as preview
     FROM messages WHERE chat_id=? AND role='assistant'
     AND content LIKE '%시간은 오후 3시%'
     ORDER BY id DESC`
  )
  .all(chatId) as { id: number; len: number; preview: string }[];

console.log("\n=== By mirror preview ===");
for (const r of byPreview) {
  console.log(`#${r.id}  ${r.len}  ${r.preview.replace(/\n/g, " ")}`);
}

const byCorridor = db
  .prepare(
    `SELECT id, length(content) as len, substr(content,1,80) as preview
     FROM messages WHERE chat_id=? AND role='assistant'
     AND content LIKE '%서쪽 별관%'
     ORDER BY id DESC`
  )
  .all(chatId) as { id: number; len: number; preview: string }[];

console.log("\n=== By corridor preview (case B) ===");
for (const r of byCorridor) {
  console.log(`#${r.id}  ${r.len}  ${r.preview.replace(/\n/g, " ")}`);
}
