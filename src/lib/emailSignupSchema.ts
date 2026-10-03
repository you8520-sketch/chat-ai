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

function ensureColumn(
  db: Pick<Database.Database, "exec" | "prepare">,
  table: string,
  column: string,
  def: string
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

export function ensureEmailSignupSchema(
  db: Pick<Database.Database, "exec" | "prepare">
): void {
  db.exec(PENDING_EMAIL_SIGNUPS_DDL);
  db.exec(LOGIN_ALIASES_DDL);

  ensureColumn(db, "users", "account_kind", "TEXT NOT NULL DEFAULT 'standard'");
  ensureColumn(db, "users", "login_disabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "login_aliases", "failed_attempts", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "login_aliases", "locked_until", "TEXT");
}
