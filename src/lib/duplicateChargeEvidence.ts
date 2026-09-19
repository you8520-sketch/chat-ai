/**
 * Duplicate billing/charge identity detection for report-refund "복수 출력".
 * Auto-refund requires proven duplicate identity — never sibling-assistant heuristics alone.
 */

import { getDb } from "@/lib/db";
import { CHAT_TURN_CHARGE_KIND } from "@/lib/chatBillingSettlementSchema";
import { ensureChatBillingSettlementSchema } from "@/lib/chatBillingSettlementSchema";

export type DuplicateBillingEvidence = {
  isDuplicate: boolean;
  duplicateChargePoints: number;
  primaryChargePoints: number;
  duplicateMessageId: number | null;
  reason: string;
};

function parseUsageCost(raw: string | null): number {
  if (!raw) return 0;
  try {
    const usage = JSON.parse(raw) as { cost?: number };
    return Math.max(0, Number(usage.cost) || 0);
  } catch {
    return 0;
  }
}

/**
 * Detect proven duplicate charge using canonical request/settlement identity.
 * Different requestIds in the same user turn window are ambiguous → not auto-refund.
 */
export function detectDuplicateBillingEvidence(input: {
  userId: number;
  chatId: number;
  messageId: number;
}): DuplicateBillingEvidence {
  const db = getDb();
  ensureChatBillingSettlementSchema(db);

  const target = db
    .prepare(
      `SELECT m.id, m.request_id, m.usage, m.is_refunded
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       WHERE m.id = ? AND m.chat_id = ? AND m.role = 'assistant' AND c.user_id = ?`
    )
    .get(input.messageId, input.chatId, input.userId) as
    | {
        id: number;
        request_id: string | null;
        usage: string | null;
        is_refunded: number;
      }
    | undefined;

  if (!target) {
    return {
      isDuplicate: false,
      duplicateChargePoints: 0,
      primaryChargePoints: 0,
      duplicateMessageId: null,
      reason: "message not found",
    };
  }

  if (target.is_refunded) {
    return {
      isDuplicate: false,
      duplicateChargePoints: 0,
      primaryChargePoints: 0,
      duplicateMessageId: null,
      reason: "already refunded",
    };
  }

  const targetCost = parseUsageCost(target.usage);
  if (targetCost <= 0) {
    return {
      isDuplicate: false,
      duplicateChargePoints: 0,
      primaryChargePoints: 0,
      duplicateMessageId: null,
      reason: "zero charge",
    };
  }

  const requestId = target.request_id?.trim() || null;
  if (!requestId) {
    return {
      isDuplicate: false,
      duplicateChargePoints: 0,
      primaryChargePoints: targetCost,
      duplicateMessageId: null,
      reason: "missing request identity",
    };
  }

  const sameRequestMessages = db
    .prepare(
      `SELECT m.id, m.usage, m.is_refunded, m.created_at
       FROM messages m
       WHERE m.chat_id = ?
         AND m.role = 'assistant'
         AND m.request_id = ?
       ORDER BY m.id ASC`
    )
    .all(input.chatId, requestId) as Array<{
    id: number;
    usage: string | null;
    is_refunded: number;
    created_at: string;
  }>;

  const chargedSameRequest = sameRequestMessages.filter(
    (m) => !m.is_refunded && parseUsageCost(m.usage) > 0
  );

  const chargedSettlements = db
    .prepare(
      `SELECT COUNT(*) AS c FROM chat_billing_settlements
       WHERE user_id = ? AND chat_id = ? AND request_id = ? AND charge_kind = ?
         AND outcome = 'charged' AND refunded_at IS NULL`
    )
    .get(input.userId, input.chatId, requestId, CHAT_TURN_CHARGE_KIND) as { c: number };

  const settlementDuplicate = (chargedSettlements?.c ?? 0) > 1;
  const messageDuplicate = chargedSameRequest.length >= 2;

  if (!messageDuplicate && !settlementDuplicate) {
    return {
      isDuplicate: false,
      duplicateChargePoints: 0,
      primaryChargePoints: targetCost,
      duplicateMessageId: null,
      reason: "no proven duplicate identity",
    };
  }

  const primary = chargedSameRequest[0];
  const duplicate =
    chargedSameRequest.find((m) => m.id === input.messageId) ??
    chargedSameRequest[chargedSameRequest.length - 1];

  if (!primary || duplicate.id === primary.id) {
    return {
      isDuplicate: false,
      duplicateChargePoints: 0,
      primaryChargePoints: parseUsageCost(primary?.usage ?? null),
      duplicateMessageId: null,
      reason: "only one charged message for request identity",
    };
  }

  if (duplicate.id !== input.messageId) {
    return {
      isDuplicate: false,
      duplicateChargePoints: 0,
      primaryChargePoints: parseUsageCost(primary.usage),
      duplicateMessageId: null,
      reason: "reported message is primary charge",
    };
  }

  return {
    isDuplicate: true,
    duplicateChargePoints: parseUsageCost(duplicate.usage),
    primaryChargePoints: parseUsageCost(primary.usage),
    duplicateMessageId: duplicate.id,
    reason: settlementDuplicate
      ? "duplicate settlement identity for same request"
      : "duplicate charge for same request identity",
  };
}
