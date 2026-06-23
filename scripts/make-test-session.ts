import Database from "better-sqlite3";
import crypto from "crypto";

const db = new Database("data/app.db");
const token = crypto.randomBytes(32).toString("hex");
const expires = new Date(Date.now() + 3600 * 1000).toISOString();
db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)").run(token, 4, expires);
console.log(token);
