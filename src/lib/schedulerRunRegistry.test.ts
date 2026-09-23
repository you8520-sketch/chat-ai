import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  claimSchedulerRun,
  ensureSchedulerRunRegistrySchema,
  finishSchedulerRun,
  listSchedulerRunOverview,
  resolveLatestDueSchedulerSlot,
  resolveSchedulerSlot,
  runDurableScheduledJob,
  shouldAttemptBootRecovery,
  shouldAttemptRuntimeRecovery,
} from "@/lib/schedulerRunRegistry";
import { schedulerCronExpression } from "@/lib/schedulerDefinitions";

function db(): Database.Database {
  const value = new Database(":memory:");
  ensureSchedulerRunRegistrySchema(value);
  return value;
}

function makeStale(
  database: Database.Database,
  jobName: string,
  slotKey: string
): void {
  database
    .prepare(
      `UPDATE scheduler_run_slots
       SET heartbeat_at=datetime('now', '-240 minutes')
       WHERE job_name=? AND slot_key=?`
    )
    .run(jobName, slotKey);
}

describe("scheduler definitions", () => {
  it("preserves existing production cron expressions from one canonical owner", () => {
    assert.equal(schedulerCronExpression("finance_daily"), "0 12 * * *");
    assert.equal(schedulerCronExpression("payout_monthly"), "0 3 15 * *");
    assert.equal(schedulerCronExpression("training_daily"), "0 4 * * *");
    assert.equal(schedulerCronExpression("training_weekly"), "0 5 * * 0");
  });

  it("resolves KST current slots deterministically", () => {
    const now = new Date("2026-09-23T05:00:00.000Z"); // 14:00 KST
    assert.deepEqual(resolveSchedulerSlot("finance_daily", now), {
      slotKey: "2026-09-23",
      due: true,
      scheduledAtUtcMs: Date.parse("2026-09-23T03:00:00.000Z"),
    });
    assert.deepEqual(resolveSchedulerSlot("payout_monthly", now), {
      slotKey: "2026-09",
      due: true,
      scheduledAtUtcMs: Date.parse("2026-09-14T18:00:00.000Z"),
    });
  });

  it("resolves the latest actually due slot across daily/monthly/weekly boundaries", () => {
    const beforeDaily = new Date("2026-09-22T23:00:00.000Z"); // Sep 23 08:00 KST
    assert.deepEqual(resolveLatestDueSchedulerSlot("finance_daily", beforeDaily), {
      slotKey: "2026-09-22",
      due: true,
      scheduledAtUtcMs: Date.parse("2026-09-22T03:00:00.000Z"),
    });

    const beforeMonthly = new Date("2026-09-10T00:00:00.000Z"); // Sep 10 09:00 KST
    assert.deepEqual(resolveLatestDueSchedulerSlot("payout_monthly", beforeMonthly), {
      slotKey: "2026-08",
      due: true,
      scheduledAtUtcMs: Date.parse("2026-08-14T18:00:00.000Z"),
    });

    const sundayBeforeWeekly = new Date("2026-09-19T19:00:00.000Z"); // Sep 20 Sun 04:00 KST
    assert.deepEqual(resolveLatestDueSchedulerSlot("training_weekly", sundayBeforeWeekly), {
      slotKey: "2026-09-13",
      due: true,
      scheduledAtUtcMs: Date.parse("2026-09-12T20:00:00.000Z"),
    });
  });
});

describe("durable scheduler claims", () => {
  it("only one worker owns the same job slot", () => {
    const database = db();
    const first = claimSchedulerRun(database, {
      jobName: "finance_daily",
      slotKey: "2026-09-23",
      triggerKind: "cron",
    });
    const second = claimSchedulerRun(database, {
      jobName: "finance_daily",
      slotKey: "2026-09-23",
      triggerKind: "cron",
    });

    assert.equal(first.outcome, "CLAIMED");
    assert.equal(second.outcome, "SKIPPED_RUNNING");
    database.close();
  });

  it("completed slot never executes twice", () => {
    const database = db();
    const first = claimSchedulerRun(database, {
      jobName: "payout_monthly",
      slotKey: "2026-09",
      triggerKind: "cron",
    });
    assert.equal(first.outcome, "CLAIMED");
    if (first.outcome !== "CLAIMED") throw new Error("claim expected");
    assert.equal(
      finishSchedulerRun(database, {
        row: first.row,
        status: "SUCCEEDED",
        result: { processed: 2 },
      }),
      true
    );

    const duplicate = claimSchedulerRun(database, {
      jobName: "payout_monthly",
      slotKey: "2026-09",
      triggerKind: "boot_recovery",
    });
    assert.equal(duplicate.outcome, "SKIPPED_COMPLETED");
    database.close();
  });

  it("finance and payout may reclaim failed slots, training may not", () => {
    const database = db();

    for (const jobName of ["finance_daily", "payout_monthly"] as const) {
      const slotKey = jobName === "finance_daily" ? "2026-09-23" : "2026-09";
      const first = claimSchedulerRun(database, {
        jobName,
        slotKey,
        triggerKind: "cron",
      });
      assert.equal(first.outcome, "CLAIMED");
      if (first.outcome !== "CLAIMED") throw new Error("claim expected");
      finishSchedulerRun(database, {
        row: first.row,
        status: "FAILED",
        error: "simulated",
      });

      const retry = claimSchedulerRun(database, {
        jobName,
        slotKey,
        triggerKind: "boot_recovery",
      });
      assert.equal(retry.outcome, "CLAIMED");
      if (retry.outcome === "CLAIMED") {
        assert.equal(retry.reason, "retry_failed");
        assert.equal(retry.row.attempt_count, 2);
      }
    }

    const training = claimSchedulerRun(database, {
      jobName: "training_daily",
      slotKey: "2026-09-23",
      triggerKind: "cron",
    });
    assert.equal(training.outcome, "CLAIMED");
    if (training.outcome !== "CLAIMED") throw new Error("claim expected");
    finishSchedulerRun(database, {
      row: training.row,
      status: "FAILED",
      error: "provider cost may already have been spent",
    });
    const blockedRetry = claimSchedulerRun(database, {
      jobName: "training_daily",
      slotKey: "2026-09-23",
      triggerKind: "boot_recovery",
    });
    assert.equal(blockedRetry.outcome, "SKIPPED_FAILED");

    database.close();
  });

  it("safe stale reclaim fences the old worker from overwriting the new attempt", () => {
    const database = db();
    const first = claimSchedulerRun(database, {
      jobName: "finance_daily",
      slotKey: "2026-09-23",
      triggerKind: "cron",
    });
    assert.equal(first.outcome, "CLAIMED");
    if (first.outcome !== "CLAIMED") throw new Error("claim expected");

    makeStale(database, "finance_daily", "2026-09-23");
    const reclaimed = claimSchedulerRun(database, {
      jobName: "finance_daily",
      slotKey: "2026-09-23",
      triggerKind: "boot_recovery",
    });
    assert.equal(reclaimed.outcome, "CLAIMED");
    if (reclaimed.outcome !== "CLAIMED") throw new Error("reclaim expected");
    assert.equal(reclaimed.reason, "reclaim_stale");
    assert.notEqual(reclaimed.row.execution_token, first.row.execution_token);

    assert.equal(
      finishSchedulerRun(database, {
        row: first.row,
        status: "SUCCEEDED",
      }),
      false
    );
    assert.equal(
      finishSchedulerRun(database, {
        row: reclaimed.row,
        status: "SUCCEEDED",
      }),
      true
    );

    const row = database
      .prepare(
        "SELECT status, attempt_count FROM scheduler_run_slots WHERE job_name='finance_daily' AND slot_key='2026-09-23'"
      )
      .get() as { status: string; attempt_count: number };
    assert.equal(row.status, "SUCCEEDED");
    assert.equal(row.attempt_count, 2);
    database.close();
  });

  it("unsafe stale training run becomes durable STALE_BLOCKED instead of auto-restarting", () => {
    const database = db();
    const first = claimSchedulerRun(database, {
      jobName: "training_weekly",
      slotKey: "2026-09-20",
      triggerKind: "cron",
    });
    assert.equal(first.outcome, "CLAIMED");
    makeStale(database, "training_weekly", "2026-09-20");

    const next = claimSchedulerRun(database, {
      jobName: "training_weekly",
      slotKey: "2026-09-20",
      triggerKind: "boot_recovery",
    });
    assert.equal(next.outcome, "SKIPPED_STALE_BLOCKED");
    assert.equal(next.row.status, "STALE_BLOCKED");

    const again = claimSchedulerRun(database, {
      jobName: "training_weekly",
      slotKey: "2026-09-20",
      triggerKind: "manual",
    });
    assert.equal(again.outcome, "SKIPPED_STALE_BLOCKED");
    database.close();
  });

  it("two async callers execute the slot body once", async () => {
    const database = db();
    let executions = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = runDurableScheduledJob(database, {
      jobName: "finance_daily",
      slotKey: "2026-09-23",
      triggerKind: "cron",
      execute: async () => {
        executions += 1;
        await gate;
        return { ok: true };
      },
    });
    const second = runDurableScheduledJob(database, {
      jobName: "finance_daily",
      slotKey: "2026-09-23",
      triggerKind: "cron",
      execute: async () => {
        executions += 1;
        return { ok: true };
      },
    });

    const secondResult = await second;
    assert.equal(secondResult.status, "skipped");
    release();
    const firstResult = await first;
    assert.equal(firstResult.status, "completed");
    assert.equal(executions, 1);
    database.close();
  });
});

describe("activation baseline and observability", () => {
  it("does not backfill a slot scheduled before registry activation", () => {
    const database = db();
    database
      .prepare("UPDATE scheduler_registry_meta SET activated_at='2026-09-23 04:00:00' WHERE id=1")
      .run();

    const now = new Date("2026-09-23T05:00:00.000Z"); // finance due; scheduled 03:00Z
    assert.equal(shouldAttemptBootRecovery(database, "finance_daily", now), false);

    const overview = listSchedulerRunOverview(database, now).find(
      (row) => row.jobName === "finance_daily"
    );
    assert.equal(overview?.state, "PRE_ACTIVATION");
    database.close();
  });

  it("flags a post-activation due slot as missing and boot-recoverable", () => {
    const database = db();
    database
      .prepare("UPDATE scheduler_registry_meta SET activated_at='2026-09-22 00:00:00' WHERE id=1")
      .run();

    const now = new Date("2026-09-23T05:00:00.000Z");
    assert.equal(shouldAttemptBootRecovery(database, "finance_daily", now), true);

    const overview = listSchedulerRunOverview(database, now).find(
      (row) => row.jobName === "finance_daily"
    );
    assert.equal(overview?.state, "MISSING");
    database.close();
  });

  it("recovers yesterday's missed daily slot when reboot happens before today's schedule", () => {
    const database = db();
    database
      .prepare("UPDATE scheduler_registry_meta SET activated_at='2026-09-21 00:00:00' WHERE id=1")
      .run();

    const now = new Date("2026-09-22T23:00:00.000Z"); // Sep 23 08:00 KST
    assert.equal(shouldAttemptBootRecovery(database, "finance_daily", now), true);
    const overview = listSchedulerRunOverview(database, now).find(
      (row) => row.jobName === "finance_daily"
    );
    assert.equal(overview?.currentSlotKey, "2026-09-22");
    assert.equal(overview?.state, "MISSING");
    database.close();
  });

  it("existing FAILED safe slot is boot-recoverable, but failed training is not", () => {
    const database = db();
    database
      .prepare("UPDATE scheduler_registry_meta SET activated_at='2026-09-22 00:00:00' WHERE id=1")
      .run();
    const now = new Date("2026-09-23T05:00:00.000Z");

    const finance = claimSchedulerRun(database, {
      jobName: "finance_daily",
      slotKey: "2026-09-23",
      triggerKind: "cron",
    });
    assert.equal(finance.outcome, "CLAIMED");
    if (finance.outcome !== "CLAIMED") throw new Error("finance claim expected");
    finishSchedulerRun(database, {
      row: finance.row,
      status: "FAILED",
      error: "simulated finance failure",
    });
    assert.equal(shouldAttemptBootRecovery(database, "finance_daily", now), true);

    const training = claimSchedulerRun(database, {
      jobName: "training_daily",
      slotKey: "2026-09-23",
      triggerKind: "cron",
    });
    assert.equal(training.outcome, "CLAIMED");
    if (training.outcome !== "CLAIMED") throw new Error("training claim expected");
    finishSchedulerRun(database, {
      row: training.row,
      status: "FAILED",
      error: "provider cost may already have been spent",
    });
    assert.equal(shouldAttemptBootRecovery(database, "training_daily", now), false);
    database.close();
  });

  it("runtime recovery catches a missed due slot without waiting for process restart", () => {
    const database = db();
    database
      .prepare("UPDATE scheduler_registry_meta SET activated_at='2026-09-21 00:00:00' WHERE id=1")
      .run();

    const now = new Date("2026-09-22T23:00:00.000Z"); // Sep 23 08:00 KST
    assert.equal(shouldAttemptRuntimeRecovery(database, "finance_daily", now), true);
    database.close();
  });

  it("runtime recovery does not endlessly retry FAILED safe jobs", () => {
    const database = db();
    database
      .prepare("UPDATE scheduler_registry_meta SET activated_at='2026-09-22 00:00:00' WHERE id=1")
      .run();
    const now = new Date("2026-09-23T05:00:00.000Z");

    const claim = claimSchedulerRun(database, {
      jobName: "finance_daily",
      slotKey: "2026-09-23",
      triggerKind: "cron",
    });
    assert.equal(claim.outcome, "CLAIMED");
    if (claim.outcome !== "CLAIMED") throw new Error("claim expected");
    finishSchedulerRun(database, {
      row: claim.row,
      status: "FAILED",
      error: "simulated",
    });

    assert.equal(shouldAttemptBootRecovery(database, "finance_daily", now), true);
    assert.equal(shouldAttemptRuntimeRecovery(database, "finance_daily", now), false);
    database.close();
  });

  it("stale safe slot is boot-recoverable and visible as STALE", () => {
    const database = db();
    database
      .prepare("UPDATE scheduler_registry_meta SET activated_at='2026-09-22 00:00:00' WHERE id=1")
      .run();
    const now = new Date("2026-09-23T05:00:00.000Z");

    const claim = claimSchedulerRun(database, {
      jobName: "finance_daily",
      slotKey: "2026-09-23",
      triggerKind: "cron",
    });
    assert.equal(claim.outcome, "CLAIMED");
    makeStale(database, "finance_daily", "2026-09-23");

    assert.equal(shouldAttemptBootRecovery(database, "finance_daily", now), true);
    const overview = listSchedulerRunOverview(database, now).find(
      (row) => row.jobName === "finance_daily"
    );
    assert.equal(overview?.state, "STALE");
    database.close();
  });

  it("admin overview never exposes execution fencing tokens or result payloads", () => {
    const database = db();
    database
      .prepare("UPDATE scheduler_registry_meta SET activated_at='2026-09-22 00:00:00' WHERE id=1")
      .run();

    const claim = claimSchedulerRun(database, {
      jobName: "finance_daily",
      slotKey: "2026-09-23",
      triggerKind: "cron",
    });
    assert.equal(claim.outcome, "CLAIMED");
    if (claim.outcome !== "CLAIMED") throw new Error("claim expected");
    finishSchedulerRun(database, {
      row: claim.row,
      status: "SUCCEEDED",
      result: { internal: "do-not-expose" },
    });

    const now = new Date("2026-09-23T05:00:00.000Z");
    const overview = listSchedulerRunOverview(database, now).find(
      (row) => row.jobName === "finance_daily"
    );
    const serialized = JSON.stringify(overview);
    assert.doesNotMatch(serialized, /execution_token/);
    assert.doesNotMatch(serialized, /do-not-expose/);
    database.close();
  });

  it("stale unsafe training enters recovery once only to become STALE_BLOCKED", () => {
    const database = db();
    database
      .prepare("UPDATE scheduler_registry_meta SET activated_at='2026-09-01 00:00:00' WHERE id=1")
      .run();
    const now = new Date("2026-09-23T05:00:00.000Z"); // latest weekly slot Sep 20

    const claim = claimSchedulerRun(database, {
      jobName: "training_weekly",
      slotKey: "2026-09-20",
      triggerKind: "cron",
    });
    assert.equal(claim.outcome, "CLAIMED");
    makeStale(database, "training_weekly", "2026-09-20");

    assert.equal(shouldAttemptBootRecovery(database, "training_weekly", now), true);
    assert.equal(shouldAttemptRuntimeRecovery(database, "training_weekly", now), true);
    const transition = claimSchedulerRun(database, {
      jobName: "training_weekly",
      slotKey: "2026-09-20",
      triggerKind: "boot_recovery",
    });
    assert.equal(transition.outcome, "SKIPPED_STALE_BLOCKED");
    assert.equal(shouldAttemptBootRecovery(database, "training_weekly", now), false);
    database.close();
  });
});

describe("scheduler owner structure", () => {
  it("cron schedulers no longer use process-local running flags as execution owners", () => {
    for (const relative of [
      "src/cron/financeScheduler.ts",
      "src/cron/payoutScheduler.ts",
      "src/cron/trainingScheduler.ts",
    ]) {
      const source = fs.readFileSync(path.join(process.cwd(), relative), "utf8");
      assert.doesNotMatch(source, /let\s+\w*Running\s*=\s*false/);
      assert.match(source, /runDurableScheduledJob/);
      assert.match(source, /shouldAttemptBootRecovery/);
      assert.match(source, /shouldAttemptRuntimeRecovery/);
      assert.match(source, /resolveLatestDueSchedulerSlot/);
      assert.match(source, /SCHEDULER_RECOVERY_POLL_MS/);
    }
  });

  it("finance recovery writes the recovered slot date instead of execution date", () => {
    const scheduler = fs.readFileSync(
      path.join(process.cwd(), "src/cron/financeScheduler.ts"),
      "utf8"
    );
    const finance = fs.readFileSync(
      path.join(process.cwd(), "src/lib/adminFinance.ts"),
      "utf8"
    );

    assert.match(scheduler, /saveDailyFinanceSnapshot\(getDb\(\), slotKey\)/);
    assert.match(finance, /snapshotDateOverride/);
    assert.match(finance, /const monthKey = snapshotDate\.slice\(0, 7\)/);
    assert.match(finance, /buildAdminFinanceSummary\(db, monthKey\)/);
  });

  it("derived-cache keeps its existing durable item lease owner outside this registry", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/lib/derivedCache/jobs.ts"),
      "utf8"
    );
    assert.match(source, /status = 'processing'/);
    assert.match(source, /locked_at = datetime\('now'\)/);
    assert.match(source, /WHERE id = \? AND status = 'pending'/);
  });
});
