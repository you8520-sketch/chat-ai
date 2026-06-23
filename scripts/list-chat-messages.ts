import Database from "better-sqlite3";
import path from "path";

const chatId = Number(process.argv[2] ?? 24);
const db = new Database(path.join(process.cwd(), "data", "app.db"));
const rows = db
  .prepare(
    "SELECT id, length(content) as len, substr(content,1,55) as p FROM messages WHERE chat_id=? AND role='assistant' ORDER BY id"
  )
  .all(chatId) as { id: number; len: number; p: string }[];

for (const r of rows) {
  console.log(`#${r.id}  ${r.len}  ${r.p.replace(/\n/g, " ")}`);
}
