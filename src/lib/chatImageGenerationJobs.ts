/**
 * Durable in-flight state for chat image generation.
 *
 * The generation routes keep running after the browser disconnects, but until now
 * nothing was written until the image succeeded — so a refresh left the panel with
 * an enabled "생성" button while a paid job was still running. A job row is written
 * before the upstream call and terminalized afterwards, so a returning client can
 * restore the 생성중 state and pick up the result.
 *
 * Billing is unchanged: points are still deducted only on success.
 */

import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";

export type ChatImageGenerationJobStatus = "running" | "completed" | "failed";

/** Upstream image call caps at 285s; past this a "running" row is unrecoverable. */
export const CHAT_IMAGE_JOB_STALE_MS = 6 * 60 * 1000;

/** How long a finished job stays visible to a client that was away. */
export const CHAT_IMAGE_JOB_PICKUP_MS = 10 * 60 * 1000;

export type ChatImageGenerationJobRow = {
  id: number;
  user_id: number;
  chat_id: number | null;
  character_id: number;
  persona_id: number | null;
  template_id: string;
  mode: string;
  status: ChatImageGenerationJobStatus;
  result_url: string | null;
  error_message: string | null;
  failure_diagnostic_json: string | null;
  provider_attempts_json: string | null;
  created_at: string;
  updated_at: string;
};

let ensured = false;

export function ensureChatImageGenerationJobSchema(db: Database.Database = getDb()): void {
  if (ensured) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_image_generation_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      chat_id INTEGER,
      character_id INTEGER NOT NULL,
      persona_id INTEGER,
      template_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      result_url TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_chat_image_jobs_scope
      ON chat_image_generation_jobs (user_id, character_id, status, id DESC);
  `);
  const columns = db.prepare("PRAGMA table_info(chat_image_generation_jobs)").all() as Array<{
    name: string;
  }>;
  if (!columns.some((column) => column.name === "failure_diagnostic_json")) {
    db.exec("ALTER TABLE chat_image_generation_jobs ADD COLUMN failure_diagnostic_json TEXT");
  }
  if (!columns.some((column) => column.name === "provider_attempts_json")) {
    db.exec("ALTER TABLE chat_image_generation_jobs ADD COLUMN provider_attempts_json TEXT");
  }
  ensured = true;
}

export type ChatImageGenerationJobScope = {
  userId: number;
  chatId: number | null;
  characterId: number;
  personaId: number | null;
};

export function startChatImageGenerationJob(
  opts: ChatImageGenerationJobScope & {
    templateId: string;
    mode: string;
    db?: Database.Database;
  }
): number | null {
  const db = opts.db ?? getDb();
  try {
    ensureChatImageGenerationJobSchema(db);
    const result = db
      .prepare(
        `INSERT INTO chat_image_generation_jobs
           (user_id, chat_id, character_id, persona_id, template_id, mode, status)
         VALUES (?,?,?,?,?,?,'running')`
      )
      .run(
        opts.userId,
        opts.chatId,
        opts.characterId,
        opts.personaId,
        opts.templateId,
        opts.mode
      );
    return Number(result.lastInsertRowid);
  } catch (error) {
    // Job tracking must never block a paid generation.
    console.error("[chat-image-job] start failed", error);
    return null;
  }
}

export function finishChatImageGenerationJob(opts: {
  jobId: number | null;
  status: Exclude<ChatImageGenerationJobStatus, "running">;
  resultUrl?: string | null;
  errorMessage?: string | null;
  failureDiagnosticJson?: string | null;
  providerAttemptsJson?: string | null;
  db?: Database.Database;
}): void {
  if (opts.jobId == null) return;
  const db = opts.db ?? getDb();
  try {
    ensureChatImageGenerationJobSchema(db);
    db.prepare(
      `UPDATE chat_image_generation_jobs
          SET status=?, result_url=?, error_message=?, failure_diagnostic_json=?, provider_attempts_json=?, updated_at=datetime('now')
        WHERE id=? AND status='running'`
    ).run(
      opts.status,
      opts.resultUrl ?? null,
      opts.errorMessage ?? null,
      opts.failureDiagnosticJson ?? null,
      opts.providerAttemptsJson ?? null,
      opts.jobId
    );
  } catch (error) {
    console.error("[chat-image-job] finish failed", error);
  }
}

/** Terminalize rows whose process died mid-generation, mirroring stale turn recovery. */
export function recoverStaleChatImageGenerationJobs(
  userId: number,
  db: Database.Database = getDb()
): void {
  try {
    ensureChatImageGenerationJobSchema(db);
    db.prepare(
      `UPDATE chat_image_generation_jobs
          SET status='failed',
              error_message='생성이 중단되었습니다.',
              updated_at=datetime('now')
        WHERE user_id=? AND status='running'
          AND created_at <= datetime('now', ?)`
    ).run(userId, `-${Math.round(CHAT_IMAGE_JOB_STALE_MS / 1000)} seconds`);
  } catch (error) {
    console.error("[chat-image-job] stale recovery failed", error);
  }
}

export type ChatImageGenerationJobDto = {
  id: number;
  status: ChatImageGenerationJobStatus;
  mode: string;
  templateId: string;
  resultUrl: string | null;
  errorMessage: string | null;
  startedAt: string;
};

function toDto(row: ChatImageGenerationJobRow): ChatImageGenerationJobDto {
  return {
    id: row.id,
    status: row.status,
    mode: row.mode,
    templateId: row.template_id,
    resultUrl: row.result_url,
    errorMessage: row.error_message,
    startedAt: row.created_at,
  };
}

/**
 * Latest job the panel should reflect: a still-running job, or one that finished
 * while the client was away so the result is not silently lost.
 */
export function findLatestChatImageGenerationJob(
  scope: Pick<ChatImageGenerationJobScope, "userId" | "characterId" | "chatId">,
  db: Database.Database = getDb()
): ChatImageGenerationJobDto | null {
  try {
    ensureChatImageGenerationJobSchema(db);
    recoverStaleChatImageGenerationJobs(scope.userId, db);
    const row = db
      .prepare(
        `SELECT * FROM chat_image_generation_jobs
          WHERE user_id=? AND character_id=?
            AND (? IS NULL OR chat_id IS NULL OR chat_id=?)
            AND (
              status='running'
              OR updated_at >= datetime('now', ?)
            )
          ORDER BY id DESC
          LIMIT 1`
      )
      .get(
        scope.userId,
        scope.characterId,
        scope.chatId,
        scope.chatId,
        `-${Math.round(CHAT_IMAGE_JOB_PICKUP_MS / 1000)} seconds`
      ) as ChatImageGenerationJobRow | undefined;
    return row ? toDto(row) : null;
  } catch (error) {
    console.error("[chat-image-job] lookup failed", error);
    return null;
  }
}

/** Block a second paid generation while one is already running for this user. */
export function hasRunningChatImageGenerationJob(
  userId: number,
  db: Database.Database = getDb()
): boolean {
  try {
    ensureChatImageGenerationJobSchema(db);
    recoverStaleChatImageGenerationJobs(userId, db);
    const row = db
      .prepare(
        `SELECT id FROM chat_image_generation_jobs
          WHERE user_id=? AND status='running' LIMIT 1`
      )
      .get(userId) as { id: number } | undefined;
    return row != null;
  } catch (error) {
    console.error("[chat-image-job] running check failed", error);
    return false;
  }
}
