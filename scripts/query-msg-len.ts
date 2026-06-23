import Database from "better-sqlite3";
import path from "path";

const db = new Database(path.join(process.cwd(), "data", "app.db"));
const rows = db
  .prepare(
    `SELECT id, length(content) as len FROM messages
     WHERE chat_id=24 AND role='assistant'
     AND (len BETWEEN 2800 AND 2820 OR len BETWEEN 3510 AND 3540 OR len BETWEEN 4270 AND 4290)
     ORDER BY id DESC`
  )
  .all() as { id: number; len: number }[];
console.log(rows);
