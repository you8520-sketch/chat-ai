import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import {
  buildInvestigationAttemptIdempotencyKey,
  buildInvestigationResultIdempotencyKey,
} from "@/lib/investigationAttemptIdempotency";
import { INVESTIGATION_RESOLVER_VERSION } from "@/lib/investigationCatalog";
import { ensureInvestigationSchema } from "@/lib/investigationSchema";
import type {
  InvestigationActionType,
  InvestigationAttemptRow,
  InvestigationAttemptSourceType,
  InvestigationFailureCode,
  InvestigationResultRow,
  InvestigationResultState,
  InvestigationResultType,
  InvestigationStatus,
  InvestigationTargetType,
} from "@/lib/investigationTypes";

export type PersistAttemptInput = {
  chatId: number;
  turnNumber: number;
  sourceMessageId: number | null;
  actionId?: string | null;
  actorType: string;
  actorId: string;
  targetId: string | null;
  targetType: InvestigationTargetType | string;
  targetKey: string;
  actionType: InvestigationActionType;
  sourceType: InvestigationAttemptSourceType;
  requestJson?: Record<string, unknown>;
  status: InvestigationStatus;
  failureCode?: InvestigationFailureCode | null;
};

export function persistInvestigationAttempt(
  input: PersistAttemptInput,
  db: Database.Database = getDb()
): { row: InvestigationAttemptRow; inserted: boolean } {
  ensureInvestigationSchema(db);
  const idempotencyKey = buildInvestigationAttemptIdempotencyKey({
    chatId: input.chatId,
    sourceMessageId: input.sourceMessageId,
    actionId: input.actionId,
    actionType: input.actionType,
    targetKey: input.targetKey,
  });
  const existing = db
    .prepare(`SELECT * FROM investigation_attempts WHERE idempotency_key=?`)
    .get(idempotencyKey) as InvestigationAttemptRow | undefined;
  if (existing) return { row: existing, inserted: false };

  const id = randomUUID();
  const resolvedAt =
    input.status === "REQUESTED" ? null : new Date().toISOString();
  db.prepare(
    `INSERT INTO investigation_attempts (
       id, idempotency_key, chat_id, turn_number, source_message_id,
       actor_type, actor_id, target_id, target_type, target_key,
       action_type, source_type, request_json, status, failure_code, resolved_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    idempotencyKey,
    input.chatId,
    input.turnNumber,
    input.sourceMessageId,
    input.actorType,
    input.actorId,
    input.targetId,
    input.targetType,
    input.targetKey,
    input.actionType,
    input.sourceType,
    JSON.stringify(input.requestJson ?? {}),
    input.status,
    input.failureCode ?? null,
    resolvedAt
  );
  return {
    row: db
      .prepare(`SELECT * FROM investigation_attempts WHERE id=?`)
      .get(id) as InvestigationAttemptRow,
    inserted: true,
  };
}

export type PersistResultInput = {
  attemptId: string;
  chatId: number;
  turnNumber: number;
  targetId: string | null;
  resultType: InvestigationResultType;
  resultState: InvestigationResultState;
  resultTags: string[];
  observableFacts: string[];
  observerType: string;
  observerId: string;
  sourceType: string;
  confidence?: number;
};

export function persistInvestigationResult(
  input: PersistResultInput,
  db: Database.Database = getDb()
): { row: InvestigationResultRow; inserted: boolean } {
  ensureInvestigationSchema(db);
  const idempotencyKey = buildInvestigationResultIdempotencyKey({
    attemptId: input.attemptId,
    resultType: input.resultType,
    resultTags: input.resultTags,
  });
  const existing = db
    .prepare(`SELECT * FROM investigation_results WHERE idempotency_key=?`)
    .get(idempotencyKey) as InvestigationResultRow | undefined;
  if (existing) return { row: existing, inserted: false };

  const id = randomUUID();
  db.prepare(
    `INSERT INTO investigation_results (
       id, idempotency_key, attempt_id, chat_id, turn_number, target_id,
       result_type, result_state, result_tags_json, observable_facts_json,
       observer_type, observer_id, source_type, confidence, resolver_version
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    idempotencyKey,
    input.attemptId,
    input.chatId,
    input.turnNumber,
    input.targetId,
    input.resultType,
    input.resultState,
    JSON.stringify(input.resultTags),
    JSON.stringify(input.observableFacts),
    input.observerType,
    input.observerId,
    input.sourceType,
    input.confidence ?? 100,
    INVESTIGATION_RESOLVER_VERSION
  );
  return {
    row: db
      .prepare(`SELECT * FROM investigation_results WHERE id=?`)
      .get(id) as InvestigationResultRow,
    inserted: true,
  };
}

export function listInvestigationResultsForTurn(opts: {
  chatId: number;
  turnNumber: number;
  db?: Database.Database;
}): InvestigationResultRow[] {
  const db = opts.db ?? getDb();
  ensureInvestigationSchema(db);
  return db
    .prepare(
      `SELECT * FROM investigation_results
       WHERE chat_id=? AND turn_number=?
       ORDER BY created_at ASC`
    )
    .all(opts.chatId, opts.turnNumber) as InvestigationResultRow[];
}
