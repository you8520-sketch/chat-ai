import "server-only";

import { getDb } from "@/lib/db";
import { assertMessageAccess } from "@/lib/chatAccess";
import {
  asyncRecordMatchesGenerationScope,
  filterLedgerRowsForGenerationScope,
  resolveActiveAssistantGenerationScopeFromRow,
  type AssistantGenerationScope,
} from "@/lib/assistantGenerationScope";
import {
  buildAdminBillingReceiptV3,
  buildAdminBillingReceiptV3ForMissingUsage,
} from "@/lib/adminBillingReceiptV3";
import type { AdminBillingReceiptV3 } from "@/lib/adminBillingReceiptV3Shared";
import type { Usage } from "@/lib/chatUsage";
import { loadMessageSuggestedReplies } from "@/lib/suggestedReplies/job";
import { loadMessageStatusMeta } from "@/lib/statusMeta/job";
import { listProviderCostEventsForAssistantMessage } from "@/lib/providerCostLedger";
import { parseSuggestedRepliesRecord } from "@/lib/suggestedReplies/parse";
import { parseStatusMetaRecord } from "@/lib/statusMeta/types";
import {
  loadMessageMemoryRelationshipTask,
  type MemoryRelationshipTaskRecord,
} from "@/lib/memory/memoryRelationshipTask";
import { normalizeMessageVariants } from "@/lib/messageAlternates";
import { buildAdminBillingForensicMetadata } from "@/lib/adminBillingForensicMetadata";
import {
  locatePrivilegedAssistantMessage,
  type AdminBillingReceiptLocator,
} from "@/lib/adminBillingMessageLocator";
import { resolveStoredTurnChargeEvidence } from "@/lib/storedTurnChargeEvidence";

export type LoadAdminBillingReceiptV3Result =
  | { ok: true; receipt: AdminBillingReceiptV3 }
  | { ok: false; error: string; status: 403 | 404 | 400 | 409 };

type AssistantMessageDbRow = {
  id: number;
  content: string;
  model: string;
  usage: string | null;
  alternates: string | null;
  active_variant: number | null;
  request_id: string | null;
  generation_status: string | null;
  suggested_replies_json: string | null;
  status_meta: string | null;
  deduction_slices: string | null;
  created_at: string;
  chat_id: number;
  user_id: number;
};

function resolveMemoryTaskForGeneration(
  task: MemoryRelationshipTaskRecord | null,
  scope: AssistantGenerationScope
): MemoryRelationshipTaskRecord | null {
  if (!task) return null;
  if (task.generationSequence == null) return null;
  return task.generationSequence === scope.generationSequence ? task : null;
}

function loadAssistantMessageRow(messageId: number): AssistantMessageDbRow | undefined {
  const db = getDb();
  return db
    .prepare(
      `SELECT m.id, m.content, m.model, m.usage, m.alternates, m.active_variant, m.request_id,
              m.generation_status, m.suggested_replies_json, m.status_meta, m.deduction_slices,
              m.created_at, m.chat_id, c.user_id
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       WHERE m.id=?`
    )
    .get(messageId) as AssistantMessageDbRow | undefined;
}

function resolveUsageFromMessageRow(messageRow: AssistantMessageDbRow): Usage | null {
  const { variants, activeVariant } = normalizeMessageVariants(messageRow);
  const activeVariantUsage = variants[activeVariant]?.usage;
  if (activeVariantUsage) return activeVariantUsage;
  if (!messageRow.usage?.trim()) return null;
  try {
    return JSON.parse(messageRow.usage) as Usage;
  } catch {
    return null;
  }
}

/** Canonical receipt assembly — stored truth only, no ownership filter. */
function assembleAdminBillingReceiptV3FromMessage(input: {
  messageId: number;
  chatId: number;
}): LoadAdminBillingReceiptV3Result {
  const messageRow = loadAssistantMessageRow(input.messageId);
  if (!messageRow) {
    return { ok: false, error: "메시지를 찾을 수 없습니다.", status: 404 };
  }

  const generationScope = resolveActiveAssistantGenerationScopeFromRow(messageRow);
  if (!generationScope) {
    return { ok: false, error: "generation scope를 확인할 수 없습니다.", status: 400 };
  }

  const storedUsage = resolveUsageFromMessageRow(messageRow);
  const db = getDb();
  const chargeEvidence = resolveStoredTurnChargeEvidence(db, {
    userId: messageRow.user_id,
    chatId: input.chatId,
    assistantMessageId: input.messageId,
    requestId: messageRow.request_id,
    generationStatus: messageRow.generation_status,
    deductionSlicesRaw: messageRow.deduction_slices,
    usage: storedUsage,
    model: messageRow.model,
  });

  const rawSuggested = messageRow.suggested_replies_json
    ? parseSuggestedRepliesRecord(messageRow.suggested_replies_json)
    : loadMessageSuggestedReplies(input.messageId);
  const rawStatusMeta = messageRow.status_meta
    ? parseStatusMetaRecord(messageRow.status_meta)
    : loadMessageStatusMeta(input.messageId);

  const suggestedRepliesRecord = asyncRecordMatchesGenerationScope(rawSuggested, generationScope)
    ? rawSuggested
    : null;
  const statusMetaRecord = asyncRecordMatchesGenerationScope(rawStatusMeta, generationScope)
    ? rawStatusMeta
    : null;

  const allLedgerRows = listProviderCostEventsForAssistantMessage(input.messageId, db);
  const { scopedRows, hasUnscopedRows } = filterLedgerRowsForGenerationScope(
    allLedgerRows,
    generationScope
  );
  const memoryRelationshipTask = resolveMemoryTaskForGeneration(
    loadMessageMemoryRelationshipTask(input.messageId),
    generationScope
  );

  const forensic = buildAdminBillingForensicMetadata({
    assistantMessageId: input.messageId,
    chatId: input.chatId,
    requestId: messageRow.request_id,
    usage: storedUsage,
    deductionSlicesRaw: messageRow.deduction_slices,
    generationStatus: messageRow.generation_status,
    chargeEvidence,
  });

  // NO STORED USAGE → usage = null. Never fabricate Usage from settlement evidence.
  // Explicit evidence-only Admin V3 mode (Strategy B: nullable unavailable sync section).
  if (!storedUsage) {
    if (chargeEvidence.status === "pending") {
      return { ok: false, error: "생성이 아직 진행 중입니다.", status: 409 };
    }
    const receipt = buildAdminBillingReceiptV3ForMissingUsage({
      assistantMessageId: input.messageId,
      chatId: input.chatId,
      generationScope,
      hasUnscopedLedgerRows: hasUnscopedRows,
      suggestedRepliesRecord,
      statusMetaRecord,
      memoryRelationshipTask,
      ledgerRows: scopedRows,
    });
    return {
      ok: true,
      receipt: {
        ...receipt,
        forensic,
      },
    };
  }

  const receipt = buildAdminBillingReceiptV3({
    usage: storedUsage,
    assistantMessageId: input.messageId,
    chatId: input.chatId,
    generationScope,
    hasUnscopedLedgerRows: hasUnscopedRows,
    suggestedRepliesRecord,
    statusMetaRecord,
    memoryRelationshipTask,
    ledgerRows: scopedRows,
  });

  return {
    ok: true,
    receipt: {
      ...receipt,
      forensic,
    },
  };
}

/** Normal user ownership path — assertMessageAccess semantics unchanged. */
export function loadAdminBillingReceiptV3ForOwnedMessage(input: {
  userId: number;
  messageId: number;
}): LoadAdminBillingReceiptV3Result {
  const row = assertMessageAccess(input.userId, input.messageId);
  if (!row) {
    return { ok: false, error: "메시지를 찾을 수 없습니다.", status: 404 };
  }
  if (row.role !== "assistant") {
    return { ok: false, error: "assistant 메시지만 조회할 수 있습니다.", status: 400 };
  }
  return assembleAdminBillingReceiptV3FromMessage({
    messageId: input.messageId,
    chatId: row.chat_id,
  });
}

/** Privileged admin forensic path — cross-chat lookup after canonical admin auth. */
export function loadPrivilegedAdminBillingReceiptV3ForMessage(
  locator: AdminBillingReceiptLocator
): LoadAdminBillingReceiptV3Result {
  const located = locatePrivilegedAssistantMessage(locator);
  if (!located.ok) {
    return { ok: false, error: located.error, status: located.status };
  }
  return assembleAdminBillingReceiptV3FromMessage({
    messageId: located.messageId,
    chatId: located.chatId,
  });
}

/** @deprecated Prefer loadAdminBillingReceiptV3ForOwnedMessage or loadPrivilegedAdminBillingReceiptV3ForMessage. */
export function loadAdminBillingReceiptV3ForMessage(input: {
  userId: number;
  messageId: number;
}): LoadAdminBillingReceiptV3Result {
  return loadAdminBillingReceiptV3ForOwnedMessage(input);
}
