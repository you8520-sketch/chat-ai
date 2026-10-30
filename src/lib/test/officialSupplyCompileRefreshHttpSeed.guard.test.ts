import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import Database from "better-sqlite3";

import {
  ISOLATED_TEST_DB_REQUIRED,
  bindIsolatedTestDatabaseForGuardTest,
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

const ISOLATED_DIR_PREFIX = "habby-test-db-";

describe("officialSupplyCompileRefreshHttpSeed destructive guard", () => {
  let previousDataDir: string | undefined;

  before(() => {
    previousDataDir = process.env.DATA_DIR;
  });

  after(() => {
    global.__db?.close();
    global.__db = undefined;
    uninstallIsolatedTestDatabase();
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

  it("refuses when isolated install is not active", async () => {
    global.__db?.close();
    global.__db = undefined;
    delete process.env.DATA_DIR;
    const { seedWolfgang51ForHttpTest } = await import("@/lib/test/officialSupplyCompileRefreshHttpSeed");
    assert.throws(
      () => seedWolfgang51ForHttpTest(),
      (error: unknown) => {
        assert.match(String(error), new RegExp(ISOLATED_TEST_DB_REQUIRED));
        assert.match(String(error), /installIsolatedTestDatabase has not activated/);
        return true;
      }
    );
  });

  it("refuses when global.__db is still connected to a different file", async () => {
    installIsolatedTestDatabase();
    const stalePath = path.join(os.tmpdir(), `habby-stale-${process.pid}.db`);
    fs.writeFileSync(stalePath, "");
    try {
      const { getDb } = await import("@/lib/db");
      getDb();
      global.__db?.close();
      global.__db = new Database(stalePath);
      const { seedWolfgang51ForHttpTest } = await import("@/lib/test/officialSupplyCompileRefreshHttpSeed");
      assert.throws(
        () => seedWolfgang51ForHttpTest(),
        (error: unknown) => {
          assert.match(String(error), new RegExp(ISOLATED_TEST_DB_REQUIRED));
          assert.match(String(error), /open database is not the isolated file/);
          return true;
        }
      );
    } finally {
      global.__db?.close();
      global.__db = undefined;
      fs.rmSync(stalePath, { force: true });
      uninstallIsolatedTestDatabase();
    }
  });

  it("refuses tmp symlink that resolves to workspace data", async () => {
    const workspaceData = path.resolve(process.cwd(), "data");
    fs.mkdirSync(workspaceData, { recursive: true });
    const linkPath = path.join(os.tmpdir(), `${ISOLATED_DIR_PREFIX}symlink-guard-${process.pid}`);
    fs.rmSync(linkPath, { recursive: true, force: true });
    fs.symlinkSync(workspaceData, linkPath);
    bindIsolatedTestDatabaseForGuardTest(linkPath);
    try {
      const { seedWolfgang51ForHttpTest } = await import("@/lib/test/officialSupplyCompileRefreshHttpSeed");
      assert.throws(
        () => seedWolfgang51ForHttpTest(),
        (error: unknown) => {
          const message = String(error);
          assert.match(message, new RegExp(ISOLATED_TEST_DB_REQUIRED));
          assert.match(message, /realpath aliases workspace data|realpath is outside os\.tmpdir\(\)/);
          return true;
        }
      );
    } finally {
      uninstallIsolatedTestDatabase();
      fs.rmSync(linkPath, { force: true });
    }
  });
});
