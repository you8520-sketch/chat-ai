import fs from "fs";
import Module from "module";
import os from "os";
import path from "path";

// Own DB so this suite never deletes or advances a developer's real derived_cache_jobs queue.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "derived-worker-enablement-"));

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { getDb } from "@/lib/db";
import {
  enqueueDerivedCacheJob,
  ensureDerivedCacheJobsTable,
  isDerivedCacheWorkerDisabled,
  kickDerivedCacheWorker,
} from "@/lib/derivedCache/jobs";
import { TRANSLATION_DERIVATION_VERSION, worldContentFingerprint } from "@/lib/derivedCache/versions";
import { enqueueWorldTranslationJob } from "@/lib/derivedCache/worldTranslation";
import {
  __testOnly_awaitDerivedCacheDrainIdle,
  __testOnly_resetDerivedCacheWakeupState,
  requestDerivedCacheWake,
  startDerivedCacheWakeup,
} from "@/lib/derivedCache/wakeupScheduler";

const WORLD_CONTENT = "붉은 달이 뜨는 밤마다 오래된 성문이 열리는 세계. ".repeat(4);

type JobRow = { id: number; status: string; attempts: number };

function envRef(): Record<string, string | undefined> {
  return process.env as Record<string, string | undefined>;
}

function seedWorldWithPendingJob(): { worldId: number; jobIds: number[] } {
  const db = getDb();
  ensureDerivedCacheJobsTable(db);
  db.exec(`DELETE FROM derived_cache_jobs`);
  db.prepare(
    "INSERT OR IGNORE INTO users (id, email, nickname, pw_hash, points, is_adult) VALUES (?,?,?,?,0,1)"
  ).run(97001, "enablement@test.local", "enablement", "hash");
  const worldId = Number(
    db
      .prepare(
        `INSERT INTO worlds (creator_id, name, summary, content, updated_at)
         VALUES (97001, 'W', 's', ?, datetime('now'))`
      )
      .run(WORLD_CONTENT).lastInsertRowid
  );
  enqueueWorldTranslationJob(db, worldId, WORLD_CONTENT);
  return { worldId, jobIds: jobRows().map((row) => row.id) };
}

function jobRows(): JobRow[] {
  return getDb()
    .prepare(`SELECT id, status, attempts FROM derived_cache_jobs ORDER BY id`)
    .all() as JobRow[];
}

function installCountingProviderFetch() {
  const previousFetch = globalThis.fetch;
  let posts = 0;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    if ((init?.method ?? "GET").toUpperCase() === "POST") posts += 1;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "⟦SEG 1⟧\nEN world\n⟦/SEG 1⟧" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  return {
    get posts() {
      return posts;
    },
    restore() {
      globalThis.fetch = previousFetch;
    },
  };
}

async function wakeEveryEntryPoint(): Promise<void> {
  startDerivedCacheWakeup();
  requestDerivedCacheWake();
  kickDerivedCacheWorker();
  await new Promise((resolve) => setTimeout(resolve, 80));
  await __testOnly_awaitDerivedCacheDrainIdle();
}

describe("derived cache worker enablement by environment", { concurrency: 1 }, () => {
  const saved = {
    nodeEnv: process.env.NODE_ENV,
    disable: process.env.DISABLE_DERIVED_CACHE_WORKER,
    key: process.env.CHEAPER_INFERENCE_API_KEY,
  };

  beforeEach(() => {
    envRef().CHEAPER_INFERENCE_API_KEY = "test-key-never-sent";
    delete process.env.DISABLE_DERIVED_CACHE_WORKER;
    __testOnly_resetDerivedCacheWakeupState();
  });

  afterEach(() => {
    __testOnly_resetDerivedCacheWakeupState();
    const env = envRef();
    for (const [name, value] of [
      ["NODE_ENV", saved.nodeEnv],
      ["DISABLE_DERIVED_CACHE_WORKER", saved.disable],
      ["CHEAPER_INFERENCE_API_KEY", saved.key],
    ] as const) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
  });

  it("development default with a provider key and a pending job: 0 provider POST, job untouched", async () => {
    envRef().NODE_ENV = "development";
    const { jobIds } = seedWorldWithPendingJob();
    const before = jobRows();
    const spy = installCountingProviderFetch();
    try {
      await wakeEveryEntryPoint();
      assert.equal(spy.posts, 0);
      assert.equal(isDerivedCacheWorkerDisabled(), true);
    } finally {
      spy.restore();
    }
    assert.deepEqual(jobRows(), before);
    assert.deepEqual(
      before.map((row) => row.id),
      jobIds
    );
    assert.equal(before[0]?.status, "pending");
  });

  it("unset NODE_ENV (test runner) is treated as non-production and stays off", async () => {
    delete process.env.NODE_ENV;
    seedWorldWithPendingJob();
    const spy = installCountingProviderFetch();
    try {
      await wakeEveryEntryPoint();
      assert.equal(spy.posts, 0);
      assert.equal(isDerivedCacheWorkerDisabled(), true);
    } finally {
      spy.restore();
    }
  });

  it("development with DISABLE_DERIVED_CACHE_WORKER=0 runs the existing worker", async () => {
    envRef().NODE_ENV = "development";
    envRef().DISABLE_DERIVED_CACHE_WORKER = "0";
    seedWorldWithPendingJob();
    const spy = installCountingProviderFetch();
    try {
      assert.equal(isDerivedCacheWorkerDisabled(), false);
      await wakeEveryEntryPoint();
      assert.equal(spy.posts, 1);
    } finally {
      spy.restore();
    }
    assert.deepEqual(
      jobRows().map((row) => row.status),
      ["done"]
    );
  });

  it("development with DISABLE_DERIVED_CACHE_WORKER=1 stays off", async () => {
    envRef().NODE_ENV = "development";
    envRef().DISABLE_DERIVED_CACHE_WORKER = "1";
    assert.equal(isDerivedCacheWorkerDisabled(), true);
  });

  it("production verification profile (DISABLE_DERIVED_CACHE_WORKER=1) performs no provider POST", async () => {
    envRef().NODE_ENV = "production";
    envRef().DISABLE_DERIVED_CACHE_WORKER = "1";
    const { jobIds } = seedWorldWithPendingJob();
    const before = jobRows();
    const spy = installCountingProviderFetch();
    try {
      await wakeEveryEntryPoint();
      assert.equal(spy.posts, 0);
      assert.equal(isDerivedCacheWorkerDisabled(), true);
    } finally {
      spy.restore();
    }
    assert.deepEqual(jobRows(), before);
    assert.equal(before[0]?.status, "pending");
    assert.deepEqual(
      before.map((row) => row.id),
      jobIds
    );
  });

  it("production keeps the automatic worker with the flag unset or 0, and the opt-out with 1", async () => {
    envRef().NODE_ENV = "production";
    assert.equal(isDerivedCacheWorkerDisabled(), false);
    envRef().DISABLE_DERIVED_CACHE_WORKER = "0";
    assert.equal(isDerivedCacheWorkerDisabled(), false);
    envRef().DISABLE_DERIVED_CACHE_WORKER = "1";
    assert.equal(isDerivedCacheWorkerDisabled(), true);

    delete process.env.DISABLE_DERIVED_CACHE_WORKER;
    seedWorldWithPendingJob();
    const spy = installCountingProviderFetch();
    try {
      await wakeEveryEntryPoint();
      assert.equal(spy.posts, 1);
    } finally {
      spy.restore();
    }
    assert.deepEqual(
      jobRows().map((row) => row.status),
      ["done"]
    );
  });

  it("restart keeps the same pending job (no loss, no duplicate), then one opt-in run completes it once", async () => {
    envRef().NODE_ENV = "development";
    const { worldId, jobIds } = seedWorldWithPendingJob();
    const spy = installCountingProviderFetch();
    try {
      await wakeEveryEntryPoint();
      __testOnly_resetDerivedCacheWakeupState();
      enqueueDerivedCacheJob(getDb(), {
        jobKind: "world_translate",
        entityType: "world",
        entityId: worldId,
        sourceFingerprint: worldContentFingerprint(WORLD_CONTENT),
        derivationVersion: TRANSLATION_DERIVATION_VERSION,
      });
      await wakeEveryEntryPoint();
      assert.equal(spy.posts, 0);
      assert.deepEqual(
        jobRows().map((row) => [row.id, row.status, row.attempts]),
        jobIds.map((id) => [id, "pending", 0])
      );

      envRef().DISABLE_DERIVED_CACHE_WORKER = "0";
      __testOnly_resetDerivedCacheWakeupState();
      await wakeEveryEntryPoint();
      assert.equal(spy.posts, 1);
    } finally {
      spy.restore();
    }
    assert.deepEqual(
      jobRows().map((row) => [row.id, row.status, row.attempts]),
      jobIds.map((id) => [id, "done", 1])
    );
  });
});
