import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import { enqueueDerivedCacheJob, ensureDerivedCacheJobsTable } from "@/lib/derivedCache/jobs";
import {
  assertIsolatedTestDatabaseActive,
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";

const GUARDED_TEST_FILES = [
  "src/lib/derivedCache/wakeupScheduler.test.ts",
  "src/lib/derivedCache/derivedCache.test.ts",
];

const REPO_ROOT = path.resolve(__dirname, "../../..");

/** Records every temp dir the child creates and every real (unstubbed) fetch, then blocks it. */
const PROBE_PRELOAD = `
const fs = require("node:fs");
const log = process.env.GUARD_PROBE_LOG;
const realMkdtemp = fs.mkdtempSync;
fs.mkdtempSync = function (...args) {
  const dir = realMkdtemp.apply(this, args);
  if (log) fs.appendFileSync(log, "tmpdir " + dir + "\\n");
  return dir;
};
globalThis.fetch = async (input) => {
  if (log) fs.appendFileSync(log, "fetch " + String((input && input.url) || input) + "\\n");
  throw new Error("real network call blocked by the test DB guard");
};
`;

type ProtectedSnapshot = {
  files: Record<string, string>;
  jobs: unknown[];
};

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function hashDbFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of fs.readdirSync(dir).sort()) {
    out[name] = sha256(path.join(dir, name));
  }
  return out;
}

function readJobs(): unknown[] {
  return getDb().prepare(`SELECT * FROM derived_cache_jobs ORDER BY id`).all();
}

function closeOpenDb(): void {
  global.__db?.close();
  global.__db = undefined;
}

function runChild(
  testFile: string,
  env: Record<string, string | undefined>
): { status: number | null; output: string } {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[name];
  }
  const result = spawnSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--import",
      "./src/lib/test/regularTestEgressPolicy.ts",
      "--test",
      testFile,
    ],
    { cwd: REPO_ROOT, env: childEnv, encoding: "utf8", timeout: 120_000 }
  );
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe("derived cache tests never touch a pre-existing database", { concurrency: 1 }, () => {
  let protectedDir = "";
  let scratchDir = "";
  let preloadPath = "";
  let baseline: ProtectedSnapshot;

  before(() => {
    installIsolatedTestDatabase();
    assertIsolatedTestDatabaseActive();
    protectedDir = path.resolve(process.env.DATA_DIR ?? "");

    const db = getDb();
    ensureDerivedCacheJobsTable(db);
    const base = {
      jobKind: "world_translate" as const,
      entityType: "world" as const,
      sourceFingerprint: "guard-fixture",
      derivationVersion: 1,
    };
    enqueueDerivedCacheJob(db, { ...base, entityId: 981001, jobFlags: "fixture:a" });
    enqueueDerivedCacheJob(db, { ...base, entityId: 981002, jobFlags: "fixture:b" });
    enqueueDerivedCacheJob(db, { ...base, entityId: 981003, jobFlags: "fixture:c" });
    db.prepare(
      `UPDATE derived_cache_jobs SET attempts = 7, last_error = 'fixture_failure',
         run_after = datetime('now', '+30 minutes') WHERE entity_id = 981002`
    ).run();
    db.prepare(`UPDATE derived_cache_jobs SET status = 'failed', attempts = 8 WHERE entity_id = 981003`).run();
    db.pragma("wal_checkpoint(TRUNCATE)");
    const jobs = readJobs();
    assert.equal(jobs.length, 3);
    closeOpenDb();

    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "habby-guard-scratch-"));
    preloadPath = path.join(scratchDir, "probe.cjs");
    fs.writeFileSync(preloadPath, PROBE_PRELOAD);
    baseline = { files: hashDbFiles(protectedDir), jobs };
  });

  after(() => {
    closeOpenDb();
    uninstallIsolatedTestDatabase();
    if (scratchDir) fs.rmSync(scratchDir, { recursive: true, force: true });
  });

  it("each guarded test file runs green on its own temp DB; the protected DB stays byte-identical", () => {
    const tmpDirsByFile = new Map<string, string>();

    for (const file of GUARDED_TEST_FILES) {
      const log = path.join(scratchDir, `${path.basename(file)}.log`);
      fs.writeFileSync(log, "");
      const run = runChild(file, {
        DATA_DIR: protectedDir,
        GUARD_PROBE_LOG: log,
        NODE_OPTIONS: `--require ${preloadPath}`,
        TURSO_DATABASE_URL: undefined,
        TURSO_AUTH_TOKEN: undefined,
      });
      assert.equal(run.status, 0, `${file} failed:\n${run.output.slice(-2000)}`);
      assert.match(run.output, /# fail 0/);
      assert.deepEqual(hashDbFiles(protectedDir), baseline.files, `${file} modified the protected DB`);

      const lines = fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
      assert.deepEqual(
        lines.filter((line) => line.startsWith("fetch ")),
        [],
        `${file} attempted a real network call`
      );
      const dirs = lines
        .filter((line) => line.startsWith("tmpdir "))
        .map((line) => line.slice("tmpdir ".length))
        .filter((dir) => path.basename(dir).startsWith("habby-test-db-"));
      assert.equal(dirs.length, 1, `${file} should create exactly one isolated DB dir`);
      assert.notEqual(path.resolve(dirs[0]!), protectedDir);
      assert.equal(fs.existsSync(dirs[0]!), false, "temp DB dir is removed after the file finishes");
      tmpDirsByFile.set(file, dirs[0]!);
    }

    assert.equal(new Set(tmpDirsByFile.values()).size, GUARDED_TEST_FILES.length, "temp DBs must not overlap");
    assert.deepEqual(hashDbFiles(protectedDir), baseline.files);
  });

  it("a leftover remote DB config fails closed before any DB access or network call", () => {
    const log = path.join(scratchDir, "remote.log");
    fs.writeFileSync(log, "");
    const run = runChild(GUARDED_TEST_FILES[0]!, {
      DATA_DIR: protectedDir,
      GUARD_PROBE_LOG: log,
      NODE_OPTIONS: `--require ${preloadPath}`,
      TURSO_DATABASE_URL: "libsql://guard-must-not-connect.invalid",
      TURSO_AUTH_TOKEN: "guard-token",
    });
    assert.notEqual(run.status, 0);
    assert.match(run.output, /ISOLATED_TEST_DB_REQUIRED: remote Turso\/libSQL is configured/);
    assert.deepEqual(
      fs.readFileSync(log, "utf8").split("\n").filter((line) => line.startsWith("fetch ")),
      []
    );
    assert.deepEqual(hashDbFiles(protectedDir), baseline.files);
  });

  it("the protected DB keeps the same job ids, statuses, attempts and stored data", () => {
    assert.deepEqual(hashDbFiles(protectedDir), baseline.files);
    assert.deepEqual(readJobs(), baseline.jobs);
    closeOpenDb();
  });
});
