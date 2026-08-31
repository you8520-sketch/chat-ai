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

export type LoadAdminBillingReceiptV3Result =
  | { ok: true; receipt: AdminBillingReceiptV3 }
  | { ok: false; error: string; status: 403 | 404 | 400 };

function resolveMemoryTaskForGeneration(
  task: MemoryRelationshipTaskRecord | null,
  scope: AssistantGenerationScope
): MemoryRelationshipTaskRecord | null {
  if (!task) return null;
  if (task.generationSequence == null) return null;
  return task.generationSequence === scope.generationSequence ? task : null;
}

/** Canonical privileged server receipt projection owner. */
export function loadAdminBillingReceiptV3ForMessage(input: {
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

  const db = getDb();
  const messageRow = db
    .prepare(
      `SELECT id, content, model, usage, alternates, active_variant, request_id, generation_status,
              suggested_replies_json, status_meta, created_at
       FROM messages WHERE id=?`
    )
    .get(input.messageId) as
    | {
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
        created_at: string;
      }
    | undefined;

  if (!messageRow) {
    return { ok: false, error: "메시지를 찾을 수 없습니다.", status: 404 };
  }

  const generationScope = resolveActiveAssistantGenerationScopeFromRow(messageRow);
  if (!generationScope) {
    return { ok: false, error: "generation scope를 확인할 수 없습니다.", status: 400 };
  }

  const { variants, activeVariant } = normalizeMessageVariants(messageRow);
  const activeVariantUsage = variants[activeVariant]?.usage;
  let usage: Usage | null = activeVariantUsage ?? null;
  if (!usage && messageRow.usage?.trim()) {
    try {
      usage = JSON.parse(messageRow.usage) as Usage;
    } catch {
      usage = null;
    }
  }
  if (!usage) {
    return { ok: false, error: "usage 스냅샷이 없습니다.", status: 404 };
  }

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

  const receipt = buildAdminBillingReceiptV3({
    usage,
    assistantMessageId: input.messageId,
    chatId: row.chat_id,
    generationScope,
    hasUnscopedLedgerRows: hasUnscopedRows,
    suggestedRepliesRecord,
    statusMetaRecord,
    memoryRelationshipTask,
    ledgerRows: scopedRows,
  });

  return { ok: true, receipt };
}
