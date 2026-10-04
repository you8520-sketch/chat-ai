/**
 * Canonical Main RP physical-provider admission.
 * Per-user lease only. Does not store lots, settlements, or generation_status.
 */

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { hasUnresolvedUnderRecoveredSettlement } from "@/lib/chatBillingSettlement";
import { ensureChatGenerationLeaseSchema } from "@/lib/chatGenerationLeaseSchema";
import { findTurnByRequestId } from "@/lib/streamingPersistence";
import { isSuccessfulDurableGenerationStatus } from "@/lib/streamingPersistenceShared";

export const MAIN_RP_GENERATION_LEASE_HEARTBEAT_MS = 25_000;
export const MAIN_RP_GENERATION_LEASE_STALE_MS = 120_000;

export const GENERATION_IN_PROGRESS_CODE = "generation_in_progress" as const;
export const GENERATION_IN_PROGRESS_MESSAGE =
  "다른 생성이 진행 중입니다. 잠시 후 다시 시도해 주세요.";

const LEASE_CONTENTION_MAX_ATTEMPTS = 12;

export type MainRpGenerationLeaseHandle = {
  userId: number;
  requestId: string;
  chatId: number | null;
  leaseToken: string;
};

export type MainRpGenerationAcquireResult =
  | { ok: true; lease: MainRpGenerationLeaseHandle }
  | { ok: false; reason: "generation_in_progress" | "under_recovered" };

export type MainRpGenerationAcquireInput = {
  userId: number;
  requestId: string;
  chatId: number | null;
};

type LeaseRow = {
  user_id: number;
  request_id: string;
  chat_id: number | null;
  assistant_message_id: number | null;
  lease_token: string;
  expires_at: string;
};

function staleModifier(staleMs: number): string {
  const seconds = Math.max(1, Math.ceil(staleMs / 1000));
  return `+${seconds} seconds`;
}

function isRetryableLeaseContention(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: string }).code;
  if (code === "SQLITE_BUSY" || code === "SQLITE_BUSY_SNAPSHOT" || code === "SQLITE_LOCKED") {
    return true;
  }
  return /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(err.message);
}

function runImmediate<T>(db: Database.Database, run: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = run();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Connection may already be rolled back on driver contention errors.
    }
    throw err;
  }
}

/** Read-only fast reject. Authoritative block happens inside acquire. */
export function shouldRejectMainRpGenerationReadOnly(
  db: Database.Database,
  input: MainRpGenerationAcquireInput
): "under_recovered" | null {
  if (!hasUnresolvedUnderRecoveredSettlement(db, input.userId)) return null;
  const requestId = input.requestId.trim();
  if (!requestId || input.chatId == null) return "under_recovered";
  const turn = findTurnByRequestId(db, input.chatId, requestId);
  if (isSuccessfulDurableGenerationStatus(turn.assistantStatus)) return null;
  return "under_recovered";
}

function acquireOnce(
  db: Database.Database,
  input: MainRpGenerationAcquireInput,
  staleMs: number
): MainRpGenerationAcquireResult {
  ensureChatGenerationLeaseSchema(db);
  const requestId = input.requestId.trim();
  if (!requestId) {
    return { ok: false, reason: "generation_in_progress" };
  }
  if (hasUnresolvedUnderRecoveredSettlement(db, input.userId)) {
    return { ok: false, reason: "under_recovered" };
  }

  const existing = db
    .prepare(
      `SELECT user_id, request_id, chat_id, assistant_message_id, lease_token, expires_at
       FROM chat_generation_leases WHERE user_id = ?`
    )
    .get(input.userId) as LeaseRow | undefined;

  const token = randomUUID();
  const expMod = staleModifier(staleMs);

  if (existing) {
    const takeover = db
      .prepare(
        `UPDATE chat_generation_leases
         SET request_id = ?,
             chat_id = ?,
             assistant_message_id = NULL,
             lease_token = ?,
             acquired_at = datetime('now'),
             heartbeat_at = datetime('now'),
             expires_at = datetime('now', ?)
         WHERE user_id = ? AND expires_at <= datetime('now')`
      )
      .run(requestId, input.chatId, token, expMod, input.userId);
    if (takeover.changes !== 1) {
      return { ok: false, reason: "generation_in_progress" };
    }
    return {
      ok: true,
      lease: {
        userId: input.userId,
        requestId,
        chatId: input.chatId,
        leaseToken: token,
      },
    };
  }

  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO chat_generation_leases (
         user_id, request_id, chat_id, assistant_message_id, lease_token, expires_at
       ) VALUES (?, ?, ?, NULL, ?, datetime('now', ?))`
    )
    .run(input.userId, requestId, input.chatId, token, expMod);
  if (inserted.changes !== 1) {
    return { ok: false, reason: "generation_in_progress" };
  }
  return {
    ok: true,
    lease: {
      userId: input.userId,
      requestId,
      chatId: input.chatId,
      leaseToken: token,
    },
  };
}

export function acquireMainRpGenerationLease(
  db: Database.Database,
  input: MainRpGenerationAcquireInput,
  opts?: { staleMs?: number }
): MainRpGenerationAcquireResult {
  const staleMs = opts?.staleMs ?? MAIN_RP_GENERATION_LEASE_STALE_MS;
  try {
    db.pragma("busy_timeout = 5000");
  } catch {
    // Some remote drivers may reject pragma mutation; contention retry remains.
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= LEASE_CONTENTION_MAX_ATTEMPTS; attempt += 1) {
    try {
      return runImmediate(db, () => acquireOnce(db, input, staleMs));
    } catch (err) {
      lastError = err;
      if (isRetryableLeaseContention(err) && attempt < LEASE_CONTENTION_MAX_ATTEMPTS) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15 * attempt);
        continue;
      }
      break;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("Main RP generation lease acquire retries exhausted");
}

export function heartbeatMainRpGenerationLease(
  db: Database.Database,
  lease: MainRpGenerationLeaseHandle,
  opts?: { staleMs?: number }
): boolean {
  ensureChatGenerationLeaseSchema(db);
  const staleMs = opts?.staleMs ?? MAIN_RP_GENERATION_LEASE_STALE_MS;
  const result = db
    .prepare(
      `UPDATE chat_generation_leases
       SET heartbeat_at = datetime('now'),
           expires_at = datetime('now', ?)
       WHERE user_id = ? AND lease_token = ?`
    )
    .run(staleModifier(staleMs), lease.userId, lease.leaseToken);
  return result.changes === 1;
}

export function releaseMainRpGenerationLease(
  db: Database.Database,
  lease: MainRpGenerationLeaseHandle
): boolean {
  ensureChatGenerationLeaseSchema(db);
  const result = db
    .prepare(
      `DELETE FROM chat_generation_leases WHERE user_id = ? AND lease_token = ?`
    )
    .run(lease.userId, lease.leaseToken);
  return result.changes === 1;
}

export function bindMainRpGenerationLeaseAssistant(
  db: Database.Database,
  lease: MainRpGenerationLeaseHandle,
  assistantMessageId: number
): boolean {
  ensureChatGenerationLeaseSchema(db);
  const result = db
    .prepare(
      `UPDATE chat_generation_leases
       SET assistant_message_id = ?
       WHERE user_id = ? AND lease_token = ?`
    )
    .run(assistantMessageId, lease.userId, lease.leaseToken);
  return result.changes === 1;
}

export function ownsMainRpGenerationLease(
  db: Database.Database,
  lease: MainRpGenerationLeaseHandle
): boolean {
  ensureChatGenerationLeaseSchema(db);
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM chat_generation_leases
       WHERE user_id = ? AND lease_token = ? AND expires_at > datetime('now')`
    )
    .get(lease.userId, lease.leaseToken) as { ok: number } | undefined;
  return row != null;
}

export function startMainRpGenerationLeaseHeartbeat(
  db: Database.Database,
  lease: MainRpGenerationLeaseHandle,
  opts?: { intervalMs?: number; staleMs?: number }
): () => void {
  const intervalMs = opts?.intervalMs ?? MAIN_RP_GENERATION_LEASE_HEARTBEAT_MS;
  const tick = () => {
    heartbeatMainRpGenerationLease(db, lease, { staleMs: opts?.staleMs });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => {
    clearInterval(timer);
  };
}

export function readActiveMainRpGenerationLease(
  db: Database.Database,
  userId: number
): LeaseRow | null {
  ensureChatGenerationLeaseSchema(db);
  return (
    (db
      .prepare(
        `SELECT user_id, request_id, chat_id, assistant_message_id, lease_token, expires_at
         FROM chat_generation_leases WHERE user_id = ?`
      )
      .get(userId) as LeaseRow | undefined) ?? null
  );
}
