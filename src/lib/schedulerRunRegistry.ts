import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  SCHEDULER_DEFINITIONS,
  SCHEDULER_TIMEZONE,
  type SchedulerJobName,
} from "@/lib/schedulerDefinitions";
import type {
  SchedulerRunOverview,
  SchedulerRunRow,
  SchedulerSlotResolution,
  SchedulerTriggerKind,
} from "@/lib/schedulerRunShared";

export type SchedulerRunClaim =
  | {
      outcome: "CLAIMED";
      row: SchedulerRunRow;
      reclaimed: boolean;
      reason: "new" | "retry_failed" | "reclaim_stale";
    }
  | {
      outcome:
        | "SKIPPED_COMPLETED"
        | "SKIPPED_RUNNING"
        | "SKIPPED_FAILED"
        | "SKIPPED_STALE_BLOCKED";
      row: SchedulerRunRow;
    };



export function ensureSchedulerRunRegistrySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduler_registry_meta (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      activated_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO scheduler_registry_meta (id, activated_at)
    VALUES (1, datetime('now'));

    CREATE TABLE IF NOT EXISTS scheduler_run_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_name TEXT NOT NULL,
      slot_key TEXT NOT NULL,
      status TEXT NOT NULL
        CHECK(status IN ('RUNNING','SUCCEEDED','FAILED','STALE_BLOCKED')),
      trigger_kind TEXT NOT NULL
        CHECK(trigger_kind IN ('cron','boot_recovery','manual')),
      execution_token TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 1,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      heartbeat_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      last_error TEXT NOT NULL DEFAULT '',
      result_json TEXT NOT NULL DEFAULT '',
      UNIQUE(job_name, slot_key)
    );

    CREATE INDEX IF NOT EXISTS idx_scheduler_run_slots_job_started
      ON scheduler_run_slots(job_name, started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_scheduler_run_slots_status
      ON scheduler_run_slots(status, heartbeat_at);
  `);
}

function rowForSlot(
  db: Database.Database,
  jobName: SchedulerJobName,
  slotKey: string
): SchedulerRunRow | null {
  return (
    (db
      .prepare(
        `SELECT id, job_name, slot_key, status, trigger_kind, execution_token,
                attempt_count, started_at, heartbeat_at, finished_at,
                last_error, result_json
         FROM scheduler_run_slots
         WHERE job_name=? AND slot_key=?`
      )
      .get(jobName, slotKey) as SchedulerRunRow | undefined) ?? null
  );
}

function latestRowForJob(
  db: Database.Database,
  jobName: SchedulerJobName
): SchedulerRunRow | null {
  return (
    (db
      .prepare(
        `SELECT id, job_name, slot_key, status, trigger_kind, execution_token,
                attempt_count, started_at, heartbeat_at, finished_at,
                last_error, result_json
         FROM scheduler_run_slots
         WHERE job_name=?
         ORDER BY id DESC
         LIMIT 1`
      )
      .get(jobName) as SchedulerRunRow | undefined) ?? null
  );
}

function registryActivatedAtMs(db: Database.Database): number {
  ensureSchedulerRunRegistrySchema(db);
  const row = db
    .prepare("SELECT activated_at FROM scheduler_registry_meta WHERE id=1")
    .get() as { activated_at: string };
  return Date.parse(`${row.activated_at.replace(" ", "T")}Z`);
}

function kstParts(now: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
    weekday: weekdayMap[read("weekday")] ?? 0,
  };
}

function dateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthKey(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function kstScheduledUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
): number {
  return Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0);
}

function shiftLocalDate(
  year: number,
  month: number,
  day: number,
  deltaDays: number
): { year: number; month: number; day: number } {
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function timeReached(
  currentHour: number,
  currentMinute: number,
  hour: number,
  minute: number
): boolean {
  return currentHour > hour || (currentHour === hour && currentMinute >= minute);
}

export function resolveSchedulerSlot(
  jobName: SchedulerJobName,
  now: Date = new Date()
): SchedulerSlotResolution {
  const definition = SCHEDULER_DEFINITIONS[jobName];
  const local = kstParts(now);

  if (definition.cadence === "daily") {
    return {
      slotKey: dateKey(local.year, local.month, local.day),
      due: timeReached(local.hour, local.minute, definition.hour, definition.minute),
      scheduledAtUtcMs: kstScheduledUtcMs(
        local.year,
        local.month,
        local.day,
        definition.hour,
        definition.minute
      ),
    };
  }

  if (definition.cadence === "monthly") {
    const due =
      local.day > definition.dayOfMonth ||
      (local.day === definition.dayOfMonth &&
        timeReached(local.hour, local.minute, definition.hour, definition.minute));
    return {
      slotKey: monthKey(local.year, local.month),
      due,
      scheduledAtUtcMs: kstScheduledUtcMs(
        local.year,
        local.month,
        definition.dayOfMonth,
        definition.hour,
        definition.minute
      ),
    };
  }

  if (definition.cadence === "weekly") {
    if (
      local.weekday === definition.dayOfWeek &&
      !timeReached(local.hour, local.minute, definition.hour, definition.minute)
    ) {
      return {
        slotKey: dateKey(local.year, local.month, local.day),
        due: false,
        scheduledAtUtcMs: kstScheduledUtcMs(
          local.year,
          local.month,
          local.day,
          definition.hour,
          definition.minute
        ),
      };
    }

    const delta = (local.weekday - definition.dayOfWeek + 7) % 7;
    const target = shiftLocalDate(local.year, local.month, local.day, -delta);
    return {
      slotKey: dateKey(target.year, target.month, target.day),
      due: true,
      scheduledAtUtcMs: kstScheduledUtcMs(
        target.year,
        target.month,
        target.day,
        definition.hour,
        definition.minute
      ),
    };
  }

  const _exhaustive: never = definition;
  return _exhaustive;
}

function isStale(
  db: Database.Database,
  row: SchedulerRunRow,
  staleAfterMinutes: number
): boolean {
  const stale = db
    .prepare(
      `SELECT CASE
         WHEN datetime(?, ?) <= datetime('now') THEN 1
         ELSE 0
       END AS stale`
    )
    .get(row.heartbeat_at, `+${staleAfterMinutes} minutes`) as { stale: number };
  return stale.stale === 1;
}

function readRowById(db: Database.Database, id: number): SchedulerRunRow {
  return db
    .prepare(
      `SELECT id, job_name, slot_key, status, trigger_kind, execution_token,
              attempt_count, started_at, heartbeat_at, finished_at,
              last_error, result_json
       FROM scheduler_run_slots WHERE id=?`
    )
    .get(id) as SchedulerRunRow;
}

export function claimSchedulerRun(
  db: Database.Database,
  params: {
    jobName: SchedulerJobName;
    slotKey: string;
    triggerKind: SchedulerTriggerKind;
  }
): SchedulerRunClaim {
  ensureSchedulerRunRegistrySchema(db);
  const definition = SCHEDULER_DEFINITIONS[params.jobName];
  const executionToken = randomUUID();

  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO scheduler_run_slots
         (job_name, slot_key, status, trigger_kind, execution_token, attempt_count,
          started_at, heartbeat_at, finished_at, last_error, result_json)
       VALUES (?, ?, 'RUNNING', ?, ?, 1, datetime('now'), datetime('now'), NULL, '', '')`
    )
    .run(params.jobName, params.slotKey, params.triggerKind, executionToken);

  if (Number(inserted.changes) > 0) {
    const row = rowForSlot(db, params.jobName, params.slotKey);
    if (!row) throw new Error("scheduler run claim inserted but row missing");
    return { outcome: "CLAIMED", row, reclaimed: false, reason: "new" };
  }

  const existing = rowForSlot(db, params.jobName, params.slotKey);
  if (!existing) {
    return claimSchedulerRun(db, params);
  }

  if (existing.status === "SUCCEEDED") {
    return { outcome: "SKIPPED_COMPLETED", row: existing };
  }

  if (existing.status === "FAILED") {
    if (!definition.safeFailedRetry) {
      return { outcome: "SKIPPED_FAILED", row: existing };
    }
    const updated = db
      .prepare(
        `UPDATE scheduler_run_slots
         SET status='RUNNING',
             trigger_kind=?,
             execution_token=?,
             attempt_count=attempt_count+1,
             started_at=datetime('now'),
             heartbeat_at=datetime('now'),
             finished_at=NULL,
             last_error='',
             result_json=''
         WHERE id=? AND status='FAILED'`
      )
      .run(params.triggerKind, executionToken, existing.id);
    if (Number(updated.changes) > 0) {
      return {
        outcome: "CLAIMED",
        row: readRowById(db, existing.id),
        reclaimed: true,
        reason: "retry_failed",
      };
    }
    return claimSchedulerRun(db, params);
  }

  if (existing.status === "STALE_BLOCKED") {
    return { outcome: "SKIPPED_STALE_BLOCKED", row: existing };
  }

  if (!isStale(db, existing, definition.staleAfterMinutes)) {
    return { outcome: "SKIPPED_RUNNING", row: existing };
  }

  if (!definition.safeStaleReclaim) {
    const blocked = db
      .prepare(
        `UPDATE scheduler_run_slots
         SET status='STALE_BLOCKED',
             finished_at=datetime('now'),
             last_error='stale run requires manual review'
         WHERE id=? AND status='RUNNING' AND execution_token=?`
      )
      .run(existing.id, existing.execution_token);
    if (Number(blocked.changes) > 0) {
      return {
        outcome: "SKIPPED_STALE_BLOCKED",
        row: readRowById(db, existing.id),
      };
    }
    return claimSchedulerRun(db, params);
  }

  const reclaimed = db
    .prepare(
      `UPDATE scheduler_run_slots
       SET status='RUNNING',
           trigger_kind=?,
           execution_token=?,
           attempt_count=attempt_count+1,
           started_at=datetime('now'),
           heartbeat_at=datetime('now'),
           finished_at=NULL,
           last_error='',
           result_json=''
       WHERE id=?
         AND status='RUNNING'
         AND execution_token=?
         AND datetime(heartbeat_at, ?) <= datetime('now')`
    )
    .run(
      params.triggerKind,
      executionToken,
      existing.id,
      existing.execution_token,
      `+${definition.staleAfterMinutes} minutes`
    );

  if (Number(reclaimed.changes) > 0) {
    return {
      outcome: "CLAIMED",
      row: readRowById(db, existing.id),
      reclaimed: true,
      reason: "reclaim_stale",
    };
  }

  return claimSchedulerRun(db, params);
}

export function heartbeatSchedulerRun(
  db: Database.Database,
  row: Pick<SchedulerRunRow, "id" | "execution_token">
): boolean {
  const result = db
    .prepare(
      `UPDATE scheduler_run_slots
       SET heartbeat_at=datetime('now')
       WHERE id=? AND status='RUNNING' AND execution_token=?`
    )
    .run(row.id, row.execution_token);
  return Number(result.changes) > 0;
}

export function finishSchedulerRun(
  db: Database.Database,
  params: {
    row: Pick<SchedulerRunRow, "id" | "execution_token">;
    status: "SUCCEEDED" | "FAILED";
    error?: string;
    result?: unknown;
  }
): boolean {
  const serialized =
    params.result === undefined
      ? ""
      : JSON.stringify(params.result).slice(0, 4000);
  const result = db
    .prepare(
      `UPDATE scheduler_run_slots
       SET status=?,
           heartbeat_at=datetime('now'),
           finished_at=datetime('now'),
           last_error=?,
           result_json=?
       WHERE id=? AND status='RUNNING' AND execution_token=?`
    )
    .run(
      params.status,
      (params.error ?? "").slice(0, 1000),
      serialized,
      params.row.id,
      params.row.execution_token
    );
  return Number(result.changes) > 0;
}

export type DurableSchedulerRunResult<T> =
  | {
      status: "completed";
      claim: Extract<SchedulerRunClaim, { outcome: "CLAIMED" }>;
      value: T;
    }
  | {
      status: "failed";
      claim: Extract<SchedulerRunClaim, { outcome: "CLAIMED" }>;
      error: Error;
    }
  | {
      status: "skipped";
      claim: Exclude<SchedulerRunClaim, { outcome: "CLAIMED" }>;
    };

export async function runDurableScheduledJob<T>(
  db: Database.Database,
  params: {
    jobName: SchedulerJobName;
    slotKey: string;
    triggerKind: SchedulerTriggerKind;
    execute: () => Promise<T> | T;
    summarize?: (value: T) => unknown;
  }
): Promise<DurableSchedulerRunResult<T>> {
  const claim = claimSchedulerRun(db, {
    jobName: params.jobName,
    slotKey: params.slotKey,
    triggerKind: params.triggerKind,
  });
  if (claim.outcome !== "CLAIMED") {
    return { status: "skipped", claim };
  }

  const definition = SCHEDULER_DEFINITIONS[params.jobName];
  const heartbeatEveryMs = Math.max(
    15_000,
    Math.min(60_000, Math.floor((definition.staleAfterMinutes * 60_000) / 3))
  );
  const heartbeat = setInterval(() => {
    heartbeatSchedulerRun(db, claim.row);
  }, heartbeatEveryMs);
  heartbeat.unref?.();

  try {
    const value = await params.execute();
    finishSchedulerRun(db, {
      row: claim.row,
      status: "SUCCEEDED",
      result: params.summarize?.(value),
    });
    return { status: "completed", claim, value };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    finishSchedulerRun(db, {
      row: claim.row,
      status: "FAILED",
      error: err.message,
    });
    return { status: "failed", claim, error: err };
  } finally {
    clearInterval(heartbeat);
  }
}

export function listSchedulerRunOverview(
  db: Database.Database,
  now: Date = new Date()
): SchedulerRunOverview[] {
  ensureSchedulerRunRegistrySchema(db);
  const activatedAtMs = registryActivatedAtMs(db);

  return (Object.keys(SCHEDULER_DEFINITIONS) as SchedulerJobName[]).map((jobName) => {
    const definition = SCHEDULER_DEFINITIONS[jobName];
    const slot = resolveSchedulerSlot(jobName, now);
    const current = rowForSlot(db, jobName, slot.slotKey);
    const latest = latestRowForJob(db, jobName);
    const activated = slot.scheduledAtUtcMs >= activatedAtMs;

    let state: SchedulerRunOverview["state"];
    if (!activated) state = "PRE_ACTIVATION";
    else if (!slot.due) state = "NOT_DUE";
    else if (current) state = current.status;
    else state = "MISSING";

    return {
      jobName,
      label: definition.label,
      cronExpression:
        definition.cadence === "daily"
          ? `${definition.minute} ${definition.hour} * * *`
          : definition.cadence === "monthly"
            ? `${definition.minute} ${definition.hour} ${definition.dayOfMonth} * *`
            : `${definition.minute} ${definition.hour} * * ${definition.dayOfWeek}`,
      currentSlotKey: slot.slotKey,
      due: slot.due,
      activated,
      state,
      latest,
      current,
    };
  });
}

export function shouldAttemptBootRecovery(
  db: Database.Database,
  jobName: SchedulerJobName,
  now: Date = new Date()
): boolean {
  ensureSchedulerRunRegistrySchema(db);
  const slot = resolveSchedulerSlot(jobName, now);
  if (!slot.due) return false;
  if (slot.scheduledAtUtcMs < registryActivatedAtMs(db)) return false;
  return rowForSlot(db, jobName, slot.slotKey) == null;
}
