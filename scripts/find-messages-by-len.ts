import Database from "better-sqlite3";
import path from "path";

const chatId = Number(process.argv[2] ?? 24);
const db = new Database(path.join(process.cwd(), "data", "app.db"));
const rows = db
  .prepare(
    `SELECT id, length(content) as len, substr(content,1,60) as preview
     FROM messages WHERE chat_id=? AND role='assistant'
     ORDER BY id DESC LIMIT 20`
  )
  .all(chatId) as { id: number; len: number; preview: string }[];

for (const r of rows) {
  console.log(`#${r.id}  ${r.len} chars  ${r.preview.replace(/\n/g, " ")}`);
}
