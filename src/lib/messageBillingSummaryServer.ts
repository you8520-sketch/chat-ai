import "server-only";

import { getDb } from "@/lib/db";
import { assertMessageAccess } from "@/lib/chatAccess";
import { billingModelDisplayName } from "@/lib/billingDisplay";
import { normalizeMessageVariants } from "@/lib/messageAlternates";
import type { Usage } from "@/lib/chatUsage";
import {
  resolveStoredTurnChargeEvidence,
  type UserMessageBillingSummary,
} from "@/lib/storedTurnChargeEvidence";

export type LoadUserMessageBillingSummaryResult =
  | { ok: true; summary: UserMessageBillingSummary }
  | { ok: false; error: string; status: 403 | 404 | 400 };

type AssistantMessageRow = {
  id: number;
  chat_id: number;
  role: string;
  content: string;
  model: string;
  usage: string | null;
  alternates: string | null;
  active_variant: number | null;
  request_id: string | null;
  generation_status: string | null;
  deduction_slices: string | null;
};

function loadAssistantMessageRow(messageId: number): AssistantMessageRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, chat_id, role, content, model, usage, alternates, active_variant, request_id,
              generation_status, deduction_slices
       FROM messages WHERE id=?`
    )
    .get(messageId) as AssistantMessageRow | undefined;
}

function resolveStoredUsage(row: AssistantMessageRow): Usage | null {
  const { variants, activeVariant } = normalizeMessageVariants(row);
  const activeVariantUsage = variants[activeVariant]?.usage;
  if (activeVariantUsage) return activeVariantUsage;
  if (!row.usage?.trim()) return null;
  try {
    return JSON.parse(row.usage) as Usage;
  } catch {
    return null;
  }
}

export function buildUserMessageBillingSummary(input: {
  userId: number;
  chatId: number;
  row: AssistantMessageRow;
}): UserMessageBillingSummary {
  const usage = resolveStoredUsage(input.row);
  const chargeEvidence = resolveStoredTurnChargeEvidence(getDb(), {
    userId: input.userId,
    chatId: input.chatId,
    assistantMessageId: input.row.id,
    requestId: input.row.request_id,
    generationStatus: input.row.generation_status,
    deductionSlicesRaw: input.row.deduction_slices,
    usage,
    model: input.row.model,
  });

  const modelLabel =
    usage?.modelLabel ??
    (usage?.selectedAI
      ? billingModelDisplayName(usage.selectedAI)
      : input.row.model?.trim() || null);

  return {
    messageId: input.row.id,
    requestId: input.row.request_id,
    generationStatus: input.row.generation_status ?? "completed",
    chargeStatus: chargeEvidence.status,
    settledPoints: chargeEvidence.settledPoints,
    modelLabel,
  };
}

/** Owned assistant message only — sanitized user-safe billing summary. */
export function loadUserMessageBillingSummaryForOwnedMessage(input: {
  userId: number;
  messageId: number;
}): LoadUserMessageBillingSummaryResult {
  const access = assertMessageAccess(input.userId, input.messageId);
  if (!access) {
    return { ok: false, error: "메시지를 찾을 수 없습니다.", status: 404 };
  }
  if (access.role !== "assistant") {
    return { ok: false, error: "assistant 메시지만 조회할 수 있습니다.", status: 400 };
  }

  const row = loadAssistantMessageRow(input.messageId);
  if (!row) {
    return { ok: false, error: "메시지를 찾을 수 없습니다.", status: 404 };
  }

  return {
    ok: true,
    summary: buildUserMessageBillingSummary({
      userId: input.userId,
      chatId: access.chat_id,
      row,
    }),
  };
}
