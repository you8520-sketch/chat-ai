import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDatabasePath, getRemoteDatabaseConfig, hasMountedPersistentVolume } from "@/lib/dataDir";

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
  refuseIfRealpathAliasesForbiddenData(tempDataDir);
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

function realpathSafe(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function refuseIfRealpathAliasesForbiddenData(isolatedDir: string): void {
  const isolatedReal = realpathSafe(isolatedDir);
  const tmpReal = realpathSafe(os.tmpdir());
  if (!isInsideDirectory(tmpReal, isolatedReal)) {
    refuse("isolated directory realpath is outside os.tmpdir()");
  }

  const workspaceData = path.resolve(process.cwd(), "data");
  if (fs.existsSync(workspaceData)) {
    const workspaceReal = realpathSafe(workspaceData);
    if (
      isolatedReal === workspaceReal ||
      isInsideDirectory(workspaceReal, isolatedReal) ||
      isInsideDirectory(isolatedReal, workspaceReal)
    ) {
      refuse("isolated directory realpath aliases workspace data");
    }
  }

  if (fs.existsSync("/data")) {
    const productionReal = realpathSafe("/data");
    if (
      isolatedReal === productionReal ||
      isInsideDirectory(productionReal, isolatedReal) ||
      isInsideDirectory(isolatedReal, productionReal)
    ) {
      refuse("isolated directory realpath aliases /data");
    }
  }

  if (hasMountedPersistentVolume(isolatedReal)) {
    refuse("isolated directory is on a mounted persistent volume");
  }
}

function assertOpenDatabaseMatchesFile(expectedDatabasePath: string): void {
  const expectedReal = realpathSafe(expectedDatabasePath);
  const open = global.__db;
  if (!open) return;

  const openName = typeof open.name === "string" ? open.name : "";
  if (/^(?:libsql|https|http):\/\//i.test(openName)) {
    refuse("open database is remote");
  }
  if (openName && realpathSafe(openName) !== expectedReal) {
    refuse("open database is not the isolated file");
  }
  let mainFile = "";
  try {
    const rows = open.prepare("PRAGMA database_list").all() as { name?: string; file?: string }[];
    const main = rows.find((row) => row.name === "main");
    mainFile = typeof main?.file === "string" ? main.file : "";
  } catch {
    refuse("open database path could not be read");
  }
  if (!mainFile) {
    refuse("open database has no local file");
  }
  if (/^(?:libsql|https|http):\/\//i.test(mainFile)) {
    refuse("open database is remote");
  }
  if (realpathSafe(mainFile) !== expectedReal) {
    refuse("open database is not the isolated file");
  }
}

/**
 * Fail-closed check that the live SQLite path is the helper's temp dir.
 * NODE_ENV, DRY_RUN_ONLY, and caller booleans are not evidence.
 */
export function assertIsolatedTestDatabaseActive(): void {
  refuseRemoteDatabaseConfig();

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

  refuseIfRealpathAliasesForbiddenData(isolatedDir);

  const databasePath = path.resolve(getDatabasePath());
  if (!isInsideDirectory(isolatedDir, databasePath) || path.basename(databasePath) !== "app.db") {
    refuse("getDatabasePath is not the isolated app.db");
  }
  if (realpathSafe(databasePath) !== realpathSafe(path.join(realpathSafe(isolatedDir), "app.db"))) {
    refuse("database realpath is outside the isolated directory");
  }

  assertOpenDatabaseMatchesFile(databasePath);
}

/** Guard regression tests only — bind isolated state to an existing directory (e.g. symlink fixture). */
export function bindIsolatedTestDatabaseForGuardTest(dir: string): void {
  closeGlobalDb();
  previousDataDir = process.env.DATA_DIR;
  tempDataDir = dir;
  process.env.DATA_DIR = dir;
}

function refuseRemoteDatabaseConfig(): void {
  try {
    if (getRemoteDatabaseConfig()) {
      refuse("remote Turso/libSQL is configured");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    refuse(`remote database config is unsafe (${message})`);
  }
}
