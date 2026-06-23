import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(process.cwd(), "data", "app.db"));
const rows = db
  .prepare(
    "SELECT id, role, length(content) as len, substr(content,1,55) as p FROM messages WHERE chat_id=24 AND id>=290 ORDER BY id"
  )
  .all() as { id: number; role: string; len: number; p: string }[];

for (const r of rows) {
  console.log(`#${r.id} [${r.role}] ${r.len}  ${r.p.replace(/\n/g, " ")}`);
}
