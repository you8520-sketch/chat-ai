import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDatabasePath, getRemoteDatabaseConfig } from "@/lib/dataDir";

export const ISOLATED_TEST_DB_REQUIRED = "ISOLATED_TEST_DB_REQUIRED";
const ISOLATED_DIR_PREFIX = "habby-test-db-";

let previousDataDir: string | undefined;
let tempDataDir: string | undefined;

function closeGlobalDb(): void {
  if (global.__db) {
    global.__db.close();
    global.__db = undefined;
  }
}

/** Give each test file its own on-disk SQLite DB under a unique temp directory. */
export function installIsolatedTestDatabase(): void {
  closeGlobalDb();
  previousDataDir = process.env.DATA_DIR;
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "habby-test-db-"));
  process.env.DATA_DIR = tempDataDir;
}

/** Close the isolated DB and remove temp files after a test file finishes. */
export function uninstallIsolatedTestDatabase(): void {
  closeGlobalDb();
  if (tempDataDir) {
    fs.rmSync(tempDataDir, { recursive: true, force: true });
    tempDataDir = undefined;
  }
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  previousDataDir = undefined;
}

function isInsideDirectory(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function refuse(detail: string): never {
  throw new Error(`${ISOLATED_TEST_DB_REQUIRED}: ${detail}`);
}

/**
 * Fail-closed check that the live SQLite path is the helper's temp dir.
 * NODE_ENV, DRY_RUN_ONLY, and caller booleans are not evidence.
 */
export function assertIsolatedTestDatabaseActive(): void {
  try {
    if (getRemoteDatabaseConfig()) {
      refuse("remote Turso/libSQL is configured");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    refuse(`remote database config is unsafe (${message})`);
  }

  if (!tempDataDir) {
    refuse("installIsolatedTestDatabase has not activated a temp directory");
  }
  const isolatedDir = path.resolve(tempDataDir);
  const envDir = process.env.DATA_DIR?.trim();
  if (!envDir) {
    refuse("DATA_DIR is missing after isolated install");
  }
  if (path.resolve(envDir) !== isolatedDir) {
    refuse("DATA_DIR does not match the installed isolated directory");
  }

  const tmpRoot = path.resolve(os.tmpdir());
  if (!isInsideDirectory(tmpRoot, isolatedDir)) {
    refuse("isolated directory is outside os.tmpdir()");
  }
  if (!path.basename(isolatedDir).startsWith(ISOLATED_DIR_PREFIX)) {
    refuse("isolated directory is not a habby-test-db temp dir");
  }
  if (!fs.existsSync(isolatedDir) || !fs.statSync(isolatedDir).isDirectory()) {
    refuse("isolated directory is missing");
  }

  const databasePath = path.resolve(getDatabasePath());
  if (!isInsideDirectory(isolatedDir, databasePath) || path.basename(databasePath) !== "app.db") {
    refuse("getDatabasePath is not the isolated app.db");
  }

  const open = global.__db;
  if (open) {
    const openName = typeof open.name === "string" ? open.name : "";
    if (!openName) {
      refuse("open database path is unknown");
    }
    if (/^(?:libsql|https|http):\/\//i.test(openName)) {
      refuse("open database is remote");
    }
    if (path.resolve(openName) !== databasePath) {
      refuse("open database is not the isolated file");
    }
  }
}
