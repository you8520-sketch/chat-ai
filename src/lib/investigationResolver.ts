/**
 * PR-S3A — Authoritative Investigation Result Layer (secret-blind).
 *
 * MUST NOT import persona secret storage, discovery rules, knowledge,
 * compiler, or secret_description accessors.
 */
import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
import { IMMEDIATE_INVESTIGATION_ACTIONS } from "@/lib/investigationCatalog";
import {
  persistInvestigationAttempt,
  persistInvestigationResult,
} from "@/lib/investigationPersist";
import {
  collectInvestigationRequestCandidates,
  type InvestigationRequestCandidate,
} from "@/lib/investigationRequests";
import { ensureInvestigationSchema } from "@/lib/investigationSchema";
import {
  parseTargetPayload,
  resolveAccessibleInvestigationTarget,
} from "@/lib/investigationTargets";
import type {
  InvestigationFailureCode,
  InvestigationResolveInput,
  InvestigationResultRow,
  InvestigationResultType,
  InvestigationStatus,
} from "@/lib/investigationTypes";
import { INVESTIGATION_RESULT_TYPES } from "@/lib/investigationCatalog";

const RESULT_TYPE_SET = new Set<string>(INVESTIGATION_RESULT_TYPES);

export type ResolveInvestigationTurnResult = {
  attemptCount: number;
  resultCount: number;
  succeededCount: number;
  rejectedCount: number;
  results: InvestigationResultRow[];
};

function actionAllowedOnTarget(
  actionType: string,
  allowed: string[] | undefined
): boolean {
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(actionType);
}

function resolveOneCandidate(opts: {
  candidate: InvestigationRequestCandidate;
  input: InvestigationResolveInput;
  personaId?: number | null;
  db: Database.Database;
}): {
  status: InvestigationStatus;
  failureCode: InvestigationFailureCode | null;
  resultRow: InvestigationResultRow | null;
} {
  const { candidate, input, personaId, db } = opts;

  if (!IMMEDIATE_INVESTIGATION_ACTIONS.has(candidate.actionType)) {
    const { row } = persistInvestigationAttempt(
      {
        chatId: input.chatId,
        turnNumber: input.turnNumber,
        sourceMessageId: input.sourceMessageId ?? null,
        actionId: candidate.actionId,
        actorType: "USER",
        actorId: "persona-user",
        targetId: null,
        targetType: "SYSTEM_DATABASE",
        targetKey: candidate.targetKey,
        actionType: candidate.actionType,
        sourceType: candidate.sourceType,
        requestJson: { actionType: candidate.actionType },
        status: "REJECTED",
        failureCode: "DELAYED_NOT_SUPPORTED",
      },
      db
    );
    void row;
    return { status: "REJECTED", failureCode: "DELAYED_NOT_SUPPORTED", resultRow: null };
  }

  const target = resolveAccessibleInvestigationTarget({
    chatId: input.chatId,
    personaId,
    targetKey: candidate.targetKey,
    db,
  });

  if (!target) {
    persistInvestigationAttempt(
      {
        chatId: input.chatId,
        turnNumber: input.turnNumber,
        sourceMessageId: input.sourceMessageId ?? null,
        actionId: candidate.actionId,
        actorType: "USER",
        actorId: "persona-user",
        targetId: null,
        targetType: "SYSTEM_DATABASE",
        targetKey: candidate.targetKey,
        actionType: candidate.actionType,
        sourceType: candidate.sourceType,
        requestJson: { actionType: candidate.actionType },
        status: "REJECTED",
        failureCode: "TARGET_NOT_FOUND",
      },
      db
    );
    return { status: "REJECTED", failureCode: "TARGET_NOT_FOUND", resultRow: null };
  }

  const payload = parseTargetPayload(target);
  const access = payload.requiredAccess ?? {};
  if (!actionAllowedOnTarget(candidate.actionType, access.allowedActions)) {
    persistInvestigationAttempt(
      {
        chatId: input.chatId,
        turnNumber: input.turnNumber,
        sourceMessageId: input.sourceMessageId ?? null,
        actionId: candidate.actionId,
        actorType: "USER",
        actorId: "persona-user",
        targetId: target.id,
        targetType: target.target_type,
        targetKey: target.target_key,
        actionType: candidate.actionType,
        sourceType: candidate.sourceType,
        requestJson: { actionType: candidate.actionType },
        status: "REJECTED",
        failureCode: "ACTION_NOT_ALLOWED",
      },
      db
    );
    return { status: "REJECTED", failureCode: "ACTION_NOT_ALLOWED", resultRow: null };
  }

  // Merge authoritative overrides (server/creator only) onto target payload.
  let resultType = payload.resultType;
  let resultState = payload.resultState;
  let resultTags = payload.resultTags;
  let observableFacts = payload.observableFacts;
  let confidence = 100;

  if (
    candidate.outcomeOverride &&
    (candidate.sourceType === "SERVER_SCENE_EVENT" ||
      candidate.sourceType === "CREATOR_TRIGGER")
  ) {
    const ov = candidate.outcomeOverride;
    if (ov.resultType && RESULT_TYPE_SET.has(ov.resultType)) {
      resultType = ov.resultType as InvestigationResultType;
    }
    if (ov.resultState === "PARTIAL" || ov.resultState === "VERIFIED") {
      resultState = ov.resultState;
    }
    if (ov.resultTags?.length) resultTags = ov.resultTags;
    if (ov.observableFacts?.length) observableFacts = ov.observableFacts;
    if (typeof ov.confidence === "number") confidence = ov.confidence;
  }

  if (!RESULT_TYPE_SET.has(resultType)) {
    persistInvestigationAttempt(
      {
        chatId: input.chatId,
        turnNumber: input.turnNumber,
        sourceMessageId: input.sourceMessageId ?? null,
        actionId: candidate.actionId,
        actorType: "USER",
        actorId: "persona-user",
        targetId: target.id,
        targetType: target.target_type,
        targetKey: target.target_key,
        actionType: candidate.actionType,
        sourceType: candidate.sourceType,
        requestJson: { actionType: candidate.actionType },
        status: "FAILED",
        failureCode: "RESULT_PAYLOAD_INVALID",
      },
      db
    );
    return { status: "FAILED", failureCode: "RESULT_PAYLOAD_INVALID", resultRow: null };
  }

  const status: InvestigationStatus =
    resultState === "PARTIAL" ? "PARTIAL" : "SUCCEEDED";

  const { row: attempt } = persistInvestigationAttempt(
    {
      chatId: input.chatId,
      turnNumber: input.turnNumber,
      sourceMessageId: input.sourceMessageId ?? null,
      actionId: candidate.actionId,
      actorType: "USER",
      actorId: "persona-user",
      targetId: target.id,
      targetType: target.target_type,
      targetKey: target.target_key,
      actionType: candidate.actionType,
      sourceType: candidate.sourceType,
      requestJson: { actionType: candidate.actionType, targetKey: candidate.targetKey },
      status,
      failureCode: null,
    },
    db
  );

  const { row: resultRow } = persistInvestigationResult(
    {
      attemptId: attempt.id,
      chatId: input.chatId,
      turnNumber: input.turnNumber,
      targetId: target.id,
      resultType,
      resultState,
      resultTags,
      observableFacts,
      observerType: "CHARACTER",
      observerId: String(input.characterId),
      sourceType: candidate.sourceType,
      confidence,
    },
    db
  );

  return { status, failureCode: null, resultRow };
}

/**
 * Resolve investigation requests for a turn into authoritative results.
 * Secret-blind: never receives or queries persona secret content.
 */
export function resolveInvestigationTurn(
  input: InvestigationResolveInput & { personaId?: number | null },
  db: Database.Database = getDb()
): ResolveInvestigationTurnResult {
  ensureInvestigationSchema(db);

  const candidates = collectInvestigationRequestCandidates({
    explicitActions: input.explicitActions,
    authoritativeOutcomes: input.authoritativeOutcomes,
    userMessage: input.userMessage,
  });

  if (candidates.length === 0) {
    return {
      attemptCount: 0,
      resultCount: 0,
      succeededCount: 0,
      rejectedCount: 0,
      results: [],
    };
  }

  const results: InvestigationResultRow[] = [];
  let attemptCount = 0;
  let rejectedCount = 0;
  let succeededCount = 0;

  const tx = db.transaction(() => {
    for (const candidate of candidates) {
      const r = resolveOneCandidate({
        candidate,
        input,
        personaId: input.personaId,
        db,
      });
      attemptCount++;
      if (r.status === "REJECTED" || r.status === "FAILED" || r.status === "REQUESTED") {
        rejectedCount++;
      }
      if (r.resultRow) {
        results.push(r.resultRow);
        if (r.status === "SUCCEEDED" || r.status === "PARTIAL") succeededCount++;
      }
    }
  });
  tx();

  return { attemptCount, resultCount: results.length, succeededCount, rejectedCount, results };
}
