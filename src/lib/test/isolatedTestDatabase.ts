import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
