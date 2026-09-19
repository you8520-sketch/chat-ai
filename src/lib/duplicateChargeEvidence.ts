/**
 * Duplicate billing/charge identity detection for report-refund "복수 출력".
 * Uses request/billing identity — never text similarity.
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
 * Detect duplicate charge: two assistant messages after the same user turn both charged.
 * Refund target = duplicate portion only (not full primary charge).
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
      `SELECT m.id, m.request_id, m.usage, m.is_refunded, m.created_at,
              (SELECT um.id FROM messages um
                WHERE um.chat_id = m.chat_id AND um.role = 'user' AND um.id < m.id
                ORDER BY um.id DESC LIMIT 1) AS paired_user_id
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
        created_at: string;
        paired_user_id: number | null;
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

  if (!target.paired_user_id) {
    return {
      isDuplicate: false,
      duplicateChargePoints: 0,
      primaryChargePoints: targetCost,
      duplicateMessageId: null,
      reason: "no paired user message",
    };
  }

  const siblings = db
    .prepare(
      `SELECT m.id, m.request_id, m.usage, m.is_refunded, m.created_at
       FROM messages m
       WHERE m.chat_id = ?
         AND m.role = 'assistant'
         AND m.id > ?
         AND m.id <= COALESCE(
           (SELECT MIN(u2.id) FROM messages u2
             WHERE u2.chat_id = m.chat_id AND u2.role = 'user' AND u2.id > ?),
           (SELECT MAX(id) FROM messages WHERE chat_id = m.chat_id)
         )
       ORDER BY m.id ASC`
    )
    .all(input.chatId, target.paired_user_id, target.paired_user_id) as Array<{
    id: number;
    request_id: string | null;
    usage: string | null;
    is_refunded: number;
    created_at: string;
  }>;

  const charged = siblings.filter((m) => !m.is_refunded && parseUsageCost(m.usage) > 0);
  if (charged.length < 2) {
    return {
      isDuplicate: false,
      duplicateChargePoints: 0,
      primaryChargePoints: targetCost,
      duplicateMessageId: null,
      reason: "single charge for user turn",
    };
  }

  const primary = charged[0];
  const duplicate = charged.find((m) => m.id === input.messageId) ?? charged[charged.length - 1];
  if (duplicate.id === primary.id) {
    return {
      isDuplicate: false,
      duplicateChargePoints: 0,
      primaryChargePoints: parseUsageCost(primary.usage),
      duplicateMessageId: null,
      reason: "only one charge in turn window",
    };
  }

  const primaryCost = parseUsageCost(primary.usage);
  const duplicateCost = parseUsageCost(duplicate.usage);

  if (primary.request_id && duplicate.request_id && primary.request_id === duplicate.request_id) {
    const settlements = db
      .prepare(
        `SELECT COUNT(*) AS c FROM chat_billing_settlements
         WHERE user_id = ? AND chat_id = ? AND request_id = ? AND charge_kind = ?
           AND outcome = 'charged' AND refunded_at IS NULL`
      )
      .get(input.userId, input.chatId, primary.request_id, CHAT_TURN_CHARGE_KIND) as {
      c: number;
    };
    if ((settlements?.c ?? 0) <= 1) {
      return {
        isDuplicate: false,
        duplicateChargePoints: 0,
        primaryChargePoints: primaryCost,
        duplicateMessageId: null,
        reason: "settlement dedup prevents double charge",
      };
    }
  }

  if (duplicate.id !== input.messageId) {
    return {
      isDuplicate: false,
      duplicateChargePoints: 0,
      primaryChargePoints: primaryCost,
      duplicateMessageId: null,
      reason: "reported message is primary charge",
    };
  }

  return {
    isDuplicate: true,
    duplicateChargePoints: duplicateCost,
    primaryChargePoints: primaryCost,
    duplicateMessageId: duplicate.id,
    reason: "duplicate assistant charge after same user turn",
  };
}
