import "server-only";

import { getDb } from "@/lib/db";
import { assertMessageAccess } from "@/lib/chatAccess";
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
import { loadMessageMemoryRelationshipTask } from "@/lib/memory/memoryRelationshipTask";

export type LoadAdminBillingReceiptV3Result =
  | { ok: true; receipt: AdminBillingReceiptV3 }
  | { ok: false; error: string; status: 403 | 404 | 400 };

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

  let usage: Usage | null = null;
  if (row.usage?.trim()) {
    try {
      usage = JSON.parse(row.usage) as Usage;
    } catch {
      usage = null;
    }
  }
  if (!usage) {
    return { ok: false, error: "usage 스냅샷이 없습니다.", status: 404 };
  }

  const db = getDb();
  const messageRow = db
    .prepare(
      `SELECT suggested_replies_json, status_meta, created_at FROM messages WHERE id=?`
    )
    .get(input.messageId) as
    | {
        suggested_replies_json: string | null;
        status_meta: string | null;
        created_at: string;
      }
    | undefined;

  const suggestedRepliesRecord = messageRow
    ? parseSuggestedRepliesRecord(messageRow.suggested_replies_json)
    : loadMessageSuggestedReplies(input.messageId);
  const statusMetaRecord = messageRow
    ? parseStatusMetaRecord(messageRow.status_meta)
    : loadMessageStatusMeta(input.messageId);

  const ledgerRows = listProviderCostEventsForAssistantMessage(input.messageId, db);
  const memoryRelationshipTask = loadMessageMemoryRelationshipTask(input.messageId);

  const receipt = buildAdminBillingReceiptV3({
    usage,
    assistantMessageId: input.messageId,
    chatId: row.chat_id,
    suggestedRepliesRecord,
    statusMetaRecord,
    memoryRelationshipTask,
    ledgerRows,
  });

  return { ok: true, receipt };
}
