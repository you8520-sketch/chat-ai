import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { ensureCharacterAppearanceColumns } from "@/lib/db";

describe("appearance DB migration", () => {
  it("adds appearance columns to an existing characters table and is repeatable", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE characters (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");

    ensureCharacterAppearanceColumns(db);
    ensureCharacterAppearanceColumns(db);

    const columns = db.prepare("PRAGMA table_info(characters)").all() as { name: string; notnull: number; dflt_value: string | null }[];
    const byName = new Map(columns.map((col) => [col.name, col]));
    for (const name of [
      "appearance_raw",
      "appearance_compiled",
      "appearance_compiled_source_hash",
      "appearance_compiled_version",
    ]) {
      assert.ok(byName.has(name), `${name} column should exist`);
    }

    db.prepare("INSERT INTO characters (id, name) VALUES (?, ?)").run(1, "legacy");
    const row = db.prepare("SELECT appearance_raw, appearance_compiled, appearance_compiled_source_hash, appearance_compiled_version FROM characters WHERE id=1").get() as Record<string, unknown>;
    assert.equal(row.appearance_raw, "");
    assert.equal(row.appearance_compiled, "");
    assert.equal(row.appearance_compiled_source_hash, "");
    assert.equal(row.appearance_compiled_version, 0);

    db.close();
  });
});
