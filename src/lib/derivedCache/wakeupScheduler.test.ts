import Module from "module";

delete process.env.DISABLE_DERIVED_CACHE_WORKER;

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { getDb } from "@/lib/db";
import {
  claimNextDerivedCacheJob,
  completeDerivedCacheJob,
  derivedCacheLeaseStaleMinutes,
  enqueueDerivedCacheJob,
  ensureDerivedCacheJobsTable,
  getDerivedCacheNextWakeDelayMs,
  maxAttemptsForDerivedJobKind,
  recoverStaleDerivedCacheLeases,
} from "@/lib/derivedCache/jobs";
import { TRANSLATION_DERIVATION_VERSION, worldContentFingerprint } from "@/lib/derivedCache/versions";
import {
  __testOnly_flushDerivedCacheWakeup,
  __testOnly_getScheduledWakeDelayMs,
  __testOnly_resetDerivedCacheWakeupState,
  __testOnly_setDrainExecutor,
  __testOnly_setOnWakeTimerFire,
  __testOnly_awaitDerivedCacheDrainIdle,
  __testOnly_isDrainActive,
  requestDerivedCacheWake,
  startDerivedCacheWakeup,
} from "@/lib/derivedCache/wakeupScheduler";
import { canExecuteWorldBlueprintPregen, WORLD_BLUEPRINT_PREGEN_JOB_KIND } from "@/lib/derivedCache/worldBlueprintPregen";

function clearDerivedJobs(db: ReturnType<typeof getDb>): void {
  ensureDerivedCacheJobsTable(db);
  db.exec(`DELETE FROM derived_cache_jobs`);
}

function insertPendingJob(
  db: ReturnType<typeof getDb>,
  entityId: number,
  opts: { runAfter?: string; jobKind?: "world_translate" | "trpg_sandbox_blueprint_pregen" } = {}
) {
  const fp = worldContentFingerprint(`fixture-${entityId}`);
  enqueueDerivedCacheJob(db, {
    jobKind: opts.jobKind ?? "world_translate",
    entityType: "world",
    entityId,
    sourceFingerprint: fp,
    derivationVersion: TRANSLATION_DERIVATION_VERSION,
  });
  if (opts.runAfter) {
    db.prepare(`UPDATE derived_cache_jobs SET run_after = ? WHERE entity_id = ?`).run(opts.runAfter, entityId);
  }
  return fp;
}

function trackUnhandledRejections() {
  const rejections: unknown[] = [];
  const handler = (reason: unknown) => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", handler);
  return {
    rejections,
    restore: () => {
      process.off("unhandledRejection", handler);
    },
  };
}

function insertDuePendingJobs(db: ReturnType<typeof getDb>, count: number, baseEntityId: number): void {
  for (let i = 0; i < count; i += 1) {
    insertPendingJob(db, baseEntityId + i);
  }
}

function makeThrowingDrainExecutor(message = "fixture-drain-failure"): (maxJobs: number) => Promise<number> {
  return async () => {
    throw new Error(message);
  };
}

function processUpToMaxJobs(db: ReturnType<typeof getDb>, maxJobs: number): Promise<number> {
  return (async () => {
    let processed = 0;
    for (let i = 0; i < maxJobs; i += 1) {
      const job = claimNextDerivedCacheJob(db);
      if (!job) break;
      completeDerivedCacheJob(db, job.id, { ok: true });
      processed += 1;
    }
    return processed;
  })();
}

describe("derived cache wakeup scheduler", { concurrency: 1 }, () => {
  afterEach(() => {
    mock.timers.reset();
    __testOnly_resetDerivedCacheWakeupState();
    delete process.env.DISABLE_DERIVED_CACHE_WORKER;
    delete process.env.TRPG_SANDBOX_DIRECTOR_ENABLED;
  });

  it("T1 — boot with due pending job processes without mutation", async () => {
    const db = getDb();
    clearDerivedJobs(db);
    insertPendingJob(db, 96001);

    const claimed: number[] = [];
    __testOnly_setDrainExecutor(async () => {
      const job = claimNextDerivedCacheJob(db);
      if (!job) return 0;
      claimed.push(job.id);
      completeDerivedCacheJob(db, job.id, { ok: true });
      return 1;
    });

    startDerivedCacheWakeup();
    await __testOnly_flushDerivedCacheWakeup();

    assert.equal(claimed.length, 1);
    const row = db.prepare(`SELECT status FROM derived_cache_jobs WHERE id = ?`).get(claimed[0]!) as {
      status: string;
    };
    assert.equal(row.status, "done");
  });

  it("T2 — future run_after waits then processes without external kick", async () => {
    const db = getDb();
    clearDerivedJobs(db);
    const entityId = 96002;
    insertPendingJob(db, entityId);

    let phase = 0;
    __testOnly_setDrainExecutor(async () => {
      if (phase === 0) {
        const job = claimNextDerivedCacheJob(db);
        if (!job) return 0;
        completeDerivedCacheJob(db, job.id, { ok: false, error: "transient", retryable: true });
        db.prepare(`UPDATE derived_cache_jobs SET run_after = datetime('now', '+10 minutes') WHERE id = ?`).run(
          job.id
        );
        phase = 1;
        return 1;
      }
      const job = claimNextDerivedCacheJob(db);
      if (!job) return 0;
      completeDerivedCacheJob(db, job.id, { ok: true });
      phase = 2;
      return 1;
    });

    startDerivedCacheWakeup();
    await __testOnly_flushDerivedCacheWakeup();
    assert.equal(phase, 1);

    const scheduledMs = __testOnly_getScheduledWakeDelayMs();
    assert.ok(scheduledMs !== null && scheduledMs > 5 * 60 * 1000, "should schedule future wake");

    db.prepare(`UPDATE derived_cache_jobs SET run_after = datetime('now', '-1 second') WHERE entity_id = ?`).run(
      entityId
    );
    assert.equal(getDerivedCacheNextWakeDelayMs(db), 0);

    await __testOnly_flushDerivedCacheWakeup();
    assert.equal(phase, 2);
  });

  it("T3 — active processing lease is not prematurely recovered", () => {
    const db = getDb();
    clearDerivedJobs(db);
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status, locked_at, attempts)
       VALUES ('world_translate', 'world', 96003, 'fp', 1, 'processing', datetime('now', '-1 minute'), 1)`
    ).run();

    recoverStaleDerivedCacheLeases(db);
    const row = db.prepare(`SELECT status FROM derived_cache_jobs WHERE entity_id = 96003`).get() as {
      status: string;
    };
    assert.equal(row.status, "processing");

    const delayMs = getDerivedCacheNextWakeDelayMs(db);
    assert.ok(delayMs !== null && delayMs > 60_000);
    assert.notEqual(delayMs, 0);
  });

  it("T4 — stale processing lease eventually recovered without user mutation", async () => {
    const db = getDb();
    clearDerivedJobs(db);
    const staleMinutes = derivedCacheLeaseStaleMinutes();
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status, locked_at, attempts)
       VALUES ('world_translate', 'world', 96004, 'fp', 1, 'processing', datetime('now', ?), 1)`
    ).run(`-${staleMinutes + 1} minutes`);

    assert.equal(getDerivedCacheNextWakeDelayMs(db), 0);

    const recovered: number[] = [];
    __testOnly_setDrainExecutor(async () => {
      const job = claimNextDerivedCacheJob(db);
      if (!job) return 0;
      recovered.push(job.id);
      completeDerivedCacheJob(db, job.id, { ok: true });
      return 1;
    });

    startDerivedCacheWakeup();
    await __testOnly_flushDerivedCacheWakeup();

    assert.equal(recovered.length, 1);
    const row = db.prepare(`SELECT status FROM derived_cache_jobs WHERE entity_id = 96004`).get() as {
      status: string;
    };
    assert.equal(row.status, "done");
  });

  it("T5 — empty queue has no busy loop timer", async () => {
    const db = getDb();
    clearDerivedJobs(db);

    let drainCalls = 0;
    __testOnly_setDrainExecutor(async () => {
      drainCalls += 1;
      return 0;
    });

    startDerivedCacheWakeup();
    await __testOnly_awaitDerivedCacheDrainIdle();

    assert.equal(drainCalls, 1);
    assert.equal(__testOnly_getScheduledWakeDelayMs(), null);
    assert.equal(getDerivedCacheNextWakeDelayMs(db), null);
  });

  it("T6 — new immediate job advances wake ahead of future retry", async () => {
    const db = getDb();
    clearDerivedJobs(db);

    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status, run_after, attempts)
       VALUES ('world_translate', 'world', 96005, 'future', 1, 'pending', datetime('now', '+10 minutes'), 2)`
    ).run();

    __testOnly_setDrainExecutor(async () => 0);
    startDerivedCacheWakeup();
    await __testOnly_flushDerivedCacheWakeup();

    const beforeKick = __testOnly_getScheduledWakeDelayMs();
    assert.ok(beforeKick !== null && beforeKick > 5 * 60 * 1000);

    insertPendingJob(db, 96006);
    const processed: number[] = [];
    __testOnly_setDrainExecutor(async () => {
      const job = claimNextDerivedCacheJob(db);
      if (!job) return 0;
      processed.push(job.entity_id);
      completeDerivedCacheJob(db, job.id, { ok: true });
      return 1;
    });

    requestDerivedCacheWake();
    await __testOnly_flushDerivedCacheWakeup();

    assert.deepEqual(processed, [96006]);
  });

  it("T7 — repeated kicks coalesce without lost wake", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const db = getDb();
    clearDerivedJobs(db);
    insertPendingJob(db, 96007);
    insertPendingJob(db, 96008);

    let concurrent = 0;
    let maxConcurrent = 0;
    let processed = 0;

    __testOnly_setDrainExecutor(async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      try {
        const job = claimNextDerivedCacheJob(db);
        if (!job) return 0;
        completeDerivedCacheJob(db, job.id, { ok: true });
        processed += 1;
        return 1;
      } finally {
        concurrent -= 1;
      }
    });

    for (let i = 0; i < 10; i += 1) {
      requestDerivedCacheWake();
    }
    await __testOnly_awaitDerivedCacheDrainIdle();
    mock.timers.tick(50);
    await __testOnly_awaitDerivedCacheDrainIdle();

    assert.equal(maxConcurrent, 1);
    assert.equal(processed, 2);
  });

  it("T8 — DISABLE_DERIVED_CACHE_WORKER=1 performs no processing", async () => {
    process.env.DISABLE_DERIVED_CACHE_WORKER = "1";
    const db = getDb();
    clearDerivedJobs(db);
    insertPendingJob(db, 96009);

    let drainCalls = 0;
    __testOnly_setDrainExecutor(async () => {
      drainCalls += 1;
      return 0;
    });

    startDerivedCacheWakeup();
    requestDerivedCacheWake();
    await __testOnly_flushDerivedCacheWakeup();

    assert.equal(drainCalls, 0);
    assert.equal(__testOnly_getScheduledWakeDelayMs(), null);
  });

  it("T9 — Blueprint flag OFF yields zero provider execution eligibility", () => {
    process.env.TRPG_SANDBOX_DIRECTOR_ENABLED = "0";
    const db = getDb();
    clearDerivedJobs(db);
    db.prepare(
      `INSERT INTO worlds (creator_id, name, summary, content, trpg_enabled)
       VALUES (1, 'w', '', 'c', 1)`
    ).run();
    assert.equal(canExecuteWorldBlueprintPregen(db, 1), false);
  });

  it("T10 — Blueprint max attempts remains 1", () => {
    assert.equal(maxAttemptsForDerivedJobKind(WORLD_BLUEPRINT_PREGEN_JOB_KIND), 1);
  });

  it("T11 — translation retry budget stays 8 and future retry wakes automatically", async () => {
    assert.equal(maxAttemptsForDerivedJobKind("world_translate"), 8);

    const db = getDb();
    clearDerivedJobs(db);
    const entityId = 96011;
    insertPendingJob(db, entityId);

    let attempts = 0;
    __testOnly_setDrainExecutor(async () => {
      const job = claimNextDerivedCacheJob(db);
      if (!job) return 0;
      attempts += 1;
      if (attempts === 1) {
        completeDerivedCacheJob(db, job.id, { ok: false, error: "retry-me", retryable: true });
        db.prepare(`UPDATE derived_cache_jobs SET run_after = datetime('now', '+5 minutes') WHERE id = ?`).run(
          job.id
        );
        return 1;
      }
      completeDerivedCacheJob(db, job.id, { ok: true });
      return 1;
    });

    startDerivedCacheWakeup();
    await __testOnly_flushDerivedCacheWakeup();
    assert.equal(attempts, 1);

    const pending = db.prepare(`SELECT status, attempts FROM derived_cache_jobs WHERE entity_id = ?`).get(entityId) as {
      status: string;
      attempts: number;
    };
    assert.equal(pending.status, "pending");
    assert.equal(pending.attempts, 1);

    db.prepare(`UPDATE derived_cache_jobs SET run_after = datetime('now', '-1 second') WHERE entity_id = ?`).run(
      entityId
    );
    await __testOnly_flushDerivedCacheWakeup();
    assert.equal(attempts, 2);

    const done = db.prepare(`SELECT status FROM derived_cache_jobs WHERE entity_id = ?`).get(entityId) as {
      status: string;
    };
    assert.equal(done.status, "done");
  });

  it("T12 — lease just before threshold stays processing with future wake", () => {
    const db = getDb();
    clearDerivedJobs(db);
    const leaseMinutes = derivedCacheLeaseStaleMinutes();
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status, locked_at, attempts)
       VALUES ('world_translate', 'world', 96012, 'fp', 1, 'processing', datetime('now', ?), 1)`
    ).run(`-${leaseMinutes - 1} minutes`);

    recoverStaleDerivedCacheLeases(db);
    const row = db.prepare(`SELECT status FROM derived_cache_jobs WHERE entity_id = 96012`).get() as {
      status: string;
    };
    assert.equal(row.status, "processing");

    const delayMs = getDerivedCacheNextWakeDelayMs(db);
    assert.ok(delayMs !== null && delayMs > 0);
  });

  it("T13 — lease exactly at threshold is due with no null-wake gap", () => {
    const db = getDb();
    clearDerivedJobs(db);
    const leaseMinutes = derivedCacheLeaseStaleMinutes();
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status, locked_at, attempts)
       VALUES ('world_translate', 'world', 96013, 'fp', 1, 'processing', datetime('now', ?), 1)`
    ).run(`-${leaseMinutes} minutes`);

    recoverStaleDerivedCacheLeases(db);
    const recovered = db.prepare(`SELECT status FROM derived_cache_jobs WHERE entity_id = 96013`).get() as {
      status: string;
    };
    assert.equal(recovered.status, "pending");

    clearDerivedJobs(db);
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status, locked_at, attempts)
       VALUES ('world_translate', 'world', 96013, 'fp', 1, 'processing', datetime('now', ?), 1)`
    ).run(`-${leaseMinutes} minutes`);
    assert.equal(getDerivedCacheNextWakeDelayMs(db), 0);
  });

  it("T14 — lease just after threshold is stale and recoverable", () => {
    const db = getDb();
    clearDerivedJobs(db);
    const leaseMinutes = derivedCacheLeaseStaleMinutes();
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status, locked_at, attempts)
       VALUES ('world_translate', 'world', 96014, 'fp', 1, 'processing', datetime('now', ?), 1)`
    ).run(`-${leaseMinutes + 1} minutes`);

    assert.equal(getDerivedCacheNextWakeDelayMs(db), 0);
    recoverStaleDerivedCacheLeases(db);
    const row = db.prepare(`SELECT status FROM derived_cache_jobs WHERE entity_id = 96014`).get() as {
      status: string;
    };
    assert.equal(row.status, "pending");
  });

  it("T15 — timer callback drains future pending job without manual flush", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const db = getDb();
    clearDerivedJobs(db);
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status, run_after, attempts)
       VALUES ('world_translate', 'world', 96015, 'fp', 1, 'pending', datetime('now', '+2 seconds'), 0)`
    ).run();

    let drainCalls = 0;
    let processed = false;
    __testOnly_setDrainExecutor(async () => {
      drainCalls += 1;
      const job = claimNextDerivedCacheJob(db);
      if (!job) return 0;
      processed = true;
      completeDerivedCacheJob(db, job.id, { ok: true });
      return 1;
    });

    startDerivedCacheWakeup();
    await __testOnly_awaitDerivedCacheDrainIdle();
    assert.equal(drainCalls, 1);
    assert.equal(processed, false);

    const scheduledMs = __testOnly_getScheduledWakeDelayMs();
    assert.ok(scheduledMs !== null && scheduledMs > 0, "future wake should be scheduled");

    __testOnly_setOnWakeTimerFire(() => {
      db.prepare(`UPDATE derived_cache_jobs SET run_after = datetime('now', '-1 second') WHERE entity_id = 96015`).run();
    });
    mock.timers.tick((scheduledMs ?? 2000) + 50);
    await __testOnly_awaitDerivedCacheDrainIdle();
    __testOnly_setOnWakeTimerFire(null);

    assert.equal(processed, true);
    assert.ok(drainCalls >= 2, "timer callback should invoke drain executor");
  });

  it("T16 — one request wake invokes drain executor once", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const db = getDb();
    clearDerivedJobs(db);
    insertPendingJob(db, 96016);

    let drainCalls = 0;
    __testOnly_setDrainExecutor(async () => {
      drainCalls += 1;
      const job = claimNextDerivedCacheJob(db);
      if (!job) return 0;
      completeDerivedCacheJob(db, job.id, { ok: true });
      return 1;
    });

    requestDerivedCacheWake();
    await __testOnly_awaitDerivedCacheDrainIdle();
    mock.timers.tick(100);
    await __testOnly_awaitDerivedCacheDrainIdle();

    assert.equal(drainCalls, 1);
  });

  it("T17 — boot drain rejection is contained with no failure loop", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const tracker = trackUnhandledRejections();
    try {
      __testOnly_setDrainExecutor(makeThrowingDrainExecutor());
      startDerivedCacheWakeup();
      await __testOnly_awaitDerivedCacheDrainIdle();
      mock.timers.tick(5000);
      await __testOnly_awaitDerivedCacheDrainIdle();

      assert.equal(tracker.rejections.length, 0);
      assert.equal(__testOnly_isDrainActive(), false);
      assert.equal(__testOnly_getScheduledWakeDelayMs(), null);
    } finally {
      tracker.restore();
    }
  });

  it("T18 — request wake drain rejection is contained with no failure loop", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const tracker = trackUnhandledRejections();
    try {
      __testOnly_setDrainExecutor(makeThrowingDrainExecutor());
      requestDerivedCacheWake();
      await __testOnly_awaitDerivedCacheDrainIdle();
      mock.timers.tick(5000);
      await __testOnly_awaitDerivedCacheDrainIdle();

      assert.equal(tracker.rejections.length, 0);
      assert.equal(__testOnly_isDrainActive(), false);
      assert.equal(__testOnly_getScheduledWakeDelayMs(), null);
    } finally {
      tracker.restore();
    }
  });

  it("T19 — timer wake drain rejection is contained with no failure loop", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const db = getDb();
    clearDerivedJobs(db);
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status, run_after, attempts)
       VALUES ('world_translate', 'world', 96019, 'fp', 1, 'pending', datetime('now', '+2 seconds'), 0)`
    ).run();

    const tracker = trackUnhandledRejections();
    try {
      let timerPhase = 0;
      __testOnly_setDrainExecutor(async () => {
        if (timerPhase === 0) {
          timerPhase = 1;
          return 0;
        }
        throw new Error("fixture-drain-failure");
      });

      startDerivedCacheWakeup();
      await __testOnly_awaitDerivedCacheDrainIdle();
      const scheduledMs = __testOnly_getScheduledWakeDelayMs();
      assert.ok(scheduledMs !== null && scheduledMs > 0);

      mock.timers.tick((scheduledMs ?? 2000) + 50);
      await __testOnly_awaitDerivedCacheDrainIdle();
      mock.timers.tick(5000);
      await __testOnly_awaitDerivedCacheDrainIdle();

      assert.equal(tracker.rejections.length, 0);
      assert.equal(__testOnly_isDrainActive(), false);
      assert.equal(__testOnly_getScheduledWakeDelayMs(), null);
    } finally {
      tracker.restore();
    }
  });

  it("T20 — backlog 7 with maxJobs 3 drains in capped batches across scheduler turns", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const db = getDb();
    clearDerivedJobs(db);
    insertDuePendingJobs(db, 7, 96100);

    let drainCalls = 0;
    let totalProcessed = 0;
    let maxCallsPerDrainCycle = 0;
    let callsThisCycle = 0;

    __testOnly_setDrainExecutor(async (maxJobs) => {
      callsThisCycle += 1;
      maxCallsPerDrainCycle = Math.max(maxCallsPerDrainCycle, callsThisCycle);
      const processed = await processUpToMaxJobs(db, maxJobs);
      totalProcessed += processed;
      callsThisCycle = 0;
      drainCalls += 1;
      return processed;
    });

    startDerivedCacheWakeup();
    await __testOnly_awaitDerivedCacheDrainIdle();
    assert.equal(drainCalls, 1);
    assert.equal(totalProcessed, 3);

    mock.timers.tick(50);
    await __testOnly_awaitDerivedCacheDrainIdle();
    assert.equal(drainCalls, 2);
    assert.equal(totalProcessed, 6);

    mock.timers.tick(50);
    await __testOnly_awaitDerivedCacheDrainIdle();
    assert.equal(drainCalls, 3);
    assert.equal(totalProcessed, 7);
    assert.equal(maxCallsPerDrainCycle, 1);
  });

  it("T21 — wake during active batch coalesces into next scheduler turn", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const db = getDb();
    clearDerivedJobs(db);
    insertDuePendingJobs(db, 4, 96200);

    let drainCalls = 0;
    let releaseFirstBatch: (() => void) | undefined;
    const firstBatchGate = new Promise<void>((resolve) => {
      releaseFirstBatch = resolve;
    });

    __testOnly_setDrainExecutor(async (maxJobs) => {
      drainCalls += 1;
      if (drainCalls === 1) {
        await firstBatchGate;
      }
      return processUpToMaxJobs(db, maxJobs);
    });

    startDerivedCacheWakeup();
    await new Promise((resolve) => {
      setImmediate(resolve);
    });
    assert.equal(drainCalls, 1);
    assert.equal(__testOnly_isDrainActive(), true);

    requestDerivedCacheWake();
    releaseFirstBatch!();
    await __testOnly_awaitDerivedCacheDrainIdle();

    mock.timers.tick(50);
    await __testOnly_awaitDerivedCacheDrainIdle();

    assert.ok(drainCalls >= 2);
    const remaining = db
      .prepare(`SELECT COUNT(*) AS c FROM derived_cache_jobs WHERE status IN ('pending','processing')`)
      .get() as { c: number };
    assert.equal(remaining.c, 0);
  });

  it("T22 — capped batch schedules next turn instead of inline follow-up drain", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const db = getDb();
    clearDerivedJobs(db);
    insertDuePendingJobs(db, 5, 96300);

    let drainCalls = 0;
    let invocationsDuringActiveDrain = 0;

    __testOnly_setDrainExecutor(async (maxJobs) => {
      invocationsDuringActiveDrain += 1;
      assert.ok(invocationsDuringActiveDrain <= 1, "only one executor call per drain cycle");
      drainCalls += 1;
      return processUpToMaxJobs(db, maxJobs);
    });

    startDerivedCacheWakeup();
    await __testOnly_awaitDerivedCacheDrainIdle();
    invocationsDuringActiveDrain = 0;
    assert.equal(drainCalls, 1);

    mock.timers.tick(50);
    await __testOnly_awaitDerivedCacheDrainIdle();
    invocationsDuringActiveDrain = 0;
    assert.equal(drainCalls, 2);
  });
});

describe("derived cache wakeup gaps (before-fix baseline semantics)", { concurrency: 1 }, () => {
  afterEach(() => {
    __testOnly_resetDerivedCacheWakeupState();
  });

  it("R0 — exact stale boundary is due (no null-wake gap while processing)", () => {
    const db = getDb();
    clearDerivedJobs(db);
    const leaseMinutes = derivedCacheLeaseStaleMinutes();
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status, locked_at, attempts)
       VALUES ('world_translate', 'world', 97000, 'fp', 1, 'processing', datetime('now', ?), 1)`
    ).run(`-${leaseMinutes} minutes`);

    const row = db.prepare(`SELECT status FROM derived_cache_jobs WHERE entity_id = 97000`).get() as {
      status: string;
    };
    assert.equal(row.status, "processing");
    assert.equal(getDerivedCacheNextWakeDelayMs(db), 0);

    recoverStaleDerivedCacheLeases(db);
    const recovered = db.prepare(`SELECT status FROM derived_cache_jobs WHERE entity_id = 97000`).get() as {
      status: string;
    };
    assert.equal(recovered.status, "pending");
  });

  it("R1 — due pending job requires wake owner (scheduler processes on boot)", async () => {
    const db = getDb();
    clearDerivedJobs(db);
    insertPendingJob(db, 97001);

    let processed = false;
    __testOnly_setDrainExecutor(async () => {
      const job = claimNextDerivedCacheJob(db);
      if (!job) return 0;
      completeDerivedCacheJob(db, job.id, { ok: true });
      processed = true;
      return 1;
    });

    startDerivedCacheWakeup();
    await __testOnly_flushDerivedCacheWakeup();
    assert.equal(processed, true);
  });

  it("R2/R3 — getDerivedCacheNextWakeDelayMs covers future retry and stale lease", () => {
    const db = getDb();
    clearDerivedJobs(db);

    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status, run_after)
       VALUES ('world_translate', 'world', 97002, 'fp', 1, 'pending', datetime('now', '+10 minutes'))`
    ).run();
    const futureDelay = getDerivedCacheNextWakeDelayMs(db);
    assert.ok(futureDelay !== null && futureDelay > 0);

    clearDerivedJobs(db);
    db.prepare(
      `INSERT INTO derived_cache_jobs
        (job_kind, entity_type, entity_id, source_fingerprint, derivation_version, status, locked_at, attempts)
       VALUES ('world_translate', 'world', 97003, 'fp', 1, 'processing', datetime('now', ?), 1)`
    ).run(`-${derivedCacheLeaseStaleMinutes() + 1} minutes`);
    assert.equal(getDerivedCacheNextWakeDelayMs(db), 0);
  });
});
