/**
 * Synthetic SQLite restore proof.
 * Uses a temporary database and SQLite `VACUUM INTO`.
 * The installed driver is libsql aliased as better-sqlite3, and its
 * `Database.backup()` method throws "not implemented".
 * `VACUUM INTO` writes a consistent snapshot, including committed WAL
 * pages, into a new file. It does not copy a live `-wal` file.
 * Does not open /data, app.db, or any production account.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hav-sqlite-restore-"));

function openFixture(file: string): Database.Database {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS fixture_users (
      id INTEGER PRIMARY KEY,
      label TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fixture_notes (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES fixture_users(id),
      body TEXT NOT NULL
    );
  `);
  return db;
}

function withoutMetadata(row: unknown): unknown {
  if (!row || typeof row !== "object") return row;
  const rest = { ...(row as Record<string, unknown>) };
  delete rest._metadata;
  return rest;
}

function rows(db: Database.Database): { users: unknown[]; notes: unknown[] } {
  return {
    users: db.prepare("SELECT id, label FROM fixture_users ORDER BY id").all().map(withoutMetadata),
    notes: db.prepare("SELECT id, user_id, body FROM fixture_notes ORDER BY id").all().map(withoutMetadata),
  };
}

function sqlPath(file: string): string {
  return `'${file.replaceAll("'", "''")}'`;
}

function vacuumInto(db: Database.Database, destination: string): void {
  if (fs.existsSync(destination)) throw new Error("backup_destination_exists");
  db.exec(`VACUUM INTO ${sqlPath(destination)}`);
}

function pragmaText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["integrity_check", "journal_mode"]) {
      if (typeof record[key] === "string") return record[key];
    }
  }
  return "";
}

function integrityOk(db: Database.Database): boolean {
  return pragmaText(db.pragma("integrity_check", { simple: true })) === "ok";
}

function backupConsistent(source: Database.Database, destination: string): void {
  vacuumInto(source, destination);
}

async function restoreConsistent(backupFile: string, destination: string): Promise<void> {
  const staged = `${destination}.restore-tmp`;
  fs.rmSync(staged, { force: true });
  let source: Database.Database | null = null;
  try {
    source = new Database(backupFile, { readonly: true, fileMustExist: true });
    if (!integrityOk(source)) throw new Error("backup_integrity_failed");
    const foreignKeys = source.pragma("foreign_key_check") as unknown[];
    if (foreignKeys.length > 0) throw new Error("backup_foreign_key_failed");
    vacuumInto(source, staged);
    const stagedDb = new Database(staged, { readonly: true, fileMustExist: true });
    try {
      if (!integrityOk(stagedDb)) throw new Error("restored_integrity_failed");
    } finally {
      stagedDb.close();
    }
    fs.renameSync(staged, destination);
  } catch (error) {
    fs.rmSync(staged, { force: true });
    throw error;
  } finally {
    source?.close();
  }
}

before(() => {
  fs.mkdirSync(root, { recursive: true });
});

after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("synthetic sqlite backup restore", () => {
  it("restores a consistent backup without copying a live WAL file", async () => {
    const originalPath = path.join(root, "original.db");
    const backupPath = path.join(root, "backup.db");
    const restoredPath = path.join(root, "restored.db");
    const original = openFixture(originalPath);
    assert.equal(pragmaText(original.pragma("journal_mode", { simple: true })), "wal");
    original.prepare("INSERT INTO fixture_users (id, label) VALUES (?, ?)").run(1, "fixture-alpha");
    original.prepare("INSERT INTO fixture_notes (id, user_id, body) VALUES (?, ?, ?)").run(1, 1, "fixture-note");
    const expected = rows(original);
    backupConsistent(original, backupPath);
    assert.equal(fs.existsSync(`${backupPath}-wal`), false);

    original.prepare("DELETE FROM fixture_notes").run();
    original.prepare("UPDATE fixture_users SET label = ? WHERE id = ?").run("fixture-mutated", 1);
    assert.notDeepEqual(rows(original), expected);
    original.close();

    await restoreConsistent(backupPath, restoredPath);
    const restored = new Database(restoredPath, { readonly: true, fileMustExist: true });
    try {
      assert.deepEqual(rows(restored), expected);
      assert.equal(integrityOk(restored), true);
      assert.deepEqual(restored.pragma("foreign_key_check"), []);
    } finally {
      restored.close();
    }
    const mutated = new Database(originalPath, { readonly: true });
    try {
      assert.equal((rows(mutated).users[0] as { label: string }).label, "fixture-mutated");
    } finally {
      mutated.close();
    }
  });

  it("rejects a damaged backup and leaves the destination bytes unchanged", async () => {
    const destination = path.join(root, "keep.db");
    const keeper = openFixture(destination);
    keeper.prepare("INSERT INTO fixture_users (id, label) VALUES (?, ?)").run(7, "fixture-keep");
    keeper.close();
    const before = fs.readFileSync(destination);

    const damaged = path.join(root, "damaged.db");
    fs.writeFileSync(damaged, "this is not a sqlite database");
    await assert.rejects(restoreConsistent(damaged, destination), /not a database|backup_integrity_failed|file is not a database/i);
    assert.deepEqual(fs.readFileSync(destination), before);
    assert.equal(fs.existsSync(`${destination}.restore-tmp`), false);

    const opened = new Database(destination, { readonly: true });
    try {
      assert.equal((rows(opened).users[0] as { label: string }).label, "fixture-keep");
      assert.equal(integrityOk(opened), true);
    } finally {
      opened.close();
    }
  });
});
