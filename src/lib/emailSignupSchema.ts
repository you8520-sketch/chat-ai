import type Database from "better-sqlite3";

export const PENDING_EMAIL_SIGNUPS_TABLE = "pending_email_signups";
export const LOGIN_ALIASES_TABLE = "login_aliases";

export const PENDING_EMAIL_SIGNUPS_DDL = `
  CREATE TABLE IF NOT EXISTS pending_email_signups (
    email TEXT PRIMARY KEY,
    nickname TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    pref TEXT,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    send_count INTEGER NOT NULL DEFAULT 1,
    last_sent_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_pending_email_signups_token_hash
    ON pending_email_signups(token_hash);
  CREATE INDEX IF NOT EXISTS idx_pending_email_signups_expires
    ON pending_email_signups(expires_at);
`;

export const LOGIN_ALIASES_DDL = `
  CREATE TABLE IF NOT EXISTS login_aliases (
    alias TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

export function ensureEmailSignupSchema(
  db: Pick<Database.Database, "exec" | "prepare">
): void {
  db.exec(PENDING_EMAIL_SIGNUPS_DDL);
  db.exec(LOGIN_ALIASES_DDL);

  const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  const names = new Set(cols.map((col) => col.name));
  if (!names.has("account_kind")) {
    db.exec("ALTER TABLE users ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'standard'");
  }
  if (!names.has("login_disabled")) {
    db.exec("ALTER TABLE users ADD COLUMN login_disabled INTEGER NOT NULL DEFAULT 0");
  }
}
