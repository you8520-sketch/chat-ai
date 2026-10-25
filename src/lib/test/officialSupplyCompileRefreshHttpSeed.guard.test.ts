import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { ISOLATED_TEST_DB_REQUIRED, installIsolatedTestDatabase, uninstallIsolatedTestDatabase } from "@/lib/test/isolatedTestDatabase";

describe("officialSupplyCompileRefreshHttpSeed destructive guard", () => {
  let previousDataDir: string | undefined;

  before(() => {
    previousDataDir = process.env.DATA_DIR;
  });

  after(() => {
    global.__db?.close();
    global.__db = undefined;
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
  });

  it("runs when installIsolatedTestDatabase is active", async () => {
    installIsolatedTestDatabase();
    try {
      const { seedWolfgang51ForHttpTest } = await import("@/lib/test/officialSupplyCompileRefreshHttpSeed");
      seedWolfgang51ForHttpTest();
      const { getDb } = await import("@/lib/db");
      const row = getDb().prepare("SELECT id FROM characters WHERE id=51").get();
      assert.ok(row);
    } finally {
      uninstallIsolatedTestDatabase();
    }
  });

  it("refuses workspace data directory before DELETE", async () => {
    global.__db?.close();
    global.__db = undefined;
    process.env.DATA_DIR = path.join(process.cwd(), "data");
    const { seedWolfgang51ForHttpTest } = await import("@/lib/test/officialSupplyCompileRefreshHttpSeed");
    assert.throws(
      () => seedWolfgang51ForHttpTest(),
      (error: unknown) => {
        assert.match(String(error), new RegExp(ISOLATED_TEST_DB_REQUIRED));
        assert.match(String(error), /workspace data directory/);
        return true;
      }
    );
  });

  it("allows manual tmp DATA_DIR under os.tmpdir()", async () => {
    global.__db?.close();
    global.__db = undefined;
    const manualDir = fs.mkdtempSync(path.join(os.tmpdir(), "habby-manual-seed-"));
    process.env.DATA_DIR = manualDir;
    try {
      const { seedWolfgang51ForHttpTest } = await import("@/lib/test/officialSupplyCompileRefreshHttpSeed");
      seedWolfgang51ForHttpTest();
      const { getDb } = await import("@/lib/db");
      assert.ok(getDb().prepare("SELECT id FROM characters WHERE id=51").get());
    } finally {
      global.__db?.close();
      global.__db = undefined;
      fs.rmSync(manualDir, { recursive: true, force: true });
    }
  });
});
