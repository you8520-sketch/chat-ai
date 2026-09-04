import "server-only";

import { getDb } from "@/lib/db";

export type AdminBillingReceiptLocator =
  | { kind: "messageId"; messageId: number }
  | { kind: "chatRequestId"; chatId: number; requestId: string };

export type ParseAdminBillingReceiptLocatorResult =
  | { ok: true; locator: AdminBillingReceiptLocator }
  | { ok: false; error: string; status: 400 };

export type LocatePrivilegedAssistantMessageResult =
  | { ok: true; messageId: number; chatId: number }
  | { ok: false; error: string; status: 404 | 409 | 400 };

export function parseAdminBillingReceiptLocator(
  searchParams: URLSearchParams
): ParseAdminBillingReceiptLocatorResult {
  const messageIdRaw = searchParams.get("messageId");
  const chatIdRaw = searchParams.get("chatId");
  const requestIdRaw = searchParams.get("requestId")?.trim() ?? "";

  const hasMessageId = messageIdRaw != null && messageIdRaw.trim() !== "";
  const hasChatId = chatIdRaw != null && chatIdRaw.trim() !== "";
  const hasRequestId = requestIdRaw.length > 0;

  if (hasMessageId && (hasChatId || hasRequestId)) {
    return {
      ok: false,
      error: "messageId 또는 chatId+requestId 중 하나만 지정하세요.",
      status: 400,
    };
  }

  if (hasChatId !== hasRequestId) {
    return {
      ok: false,
      error: "chatId와 requestId는 함께 지정해야 합니다.",
      status: 400,
    };
  }

  if (hasMessageId) {
    const messageId = Number(messageIdRaw);
    if (!Number.isInteger(messageId) || messageId <= 0) {
      return { ok: false, error: "messageId가 유효하지 않습니다.", status: 400 };
    }
    return { ok: true, locator: { kind: "messageId", messageId } };
  }

  if (hasChatId && hasRequestId) {
    const chatId = Number(chatIdRaw);
    if (!Number.isInteger(chatId) || chatId <= 0) {
      return { ok: false, error: "chatId가 유효하지 않습니다.", status: 400 };
    }
    return { ok: true, locator: { kind: "chatRequestId", chatId, requestId: requestIdRaw } };
  }

  return {
    ok: false,
    error: "messageId 또는 chatId+requestId가 필요합니다.",
    status: 400,
  };
}

/** Privileged admin forensic locator — no chat ownership filter. */
export function locatePrivilegedAssistantMessage(
  locator: AdminBillingReceiptLocator
): LocatePrivilegedAssistantMessageResult {
  const db = getDb();

  if (locator.kind === "messageId") {
    const row = db
      .prepare(`SELECT id, chat_id, role FROM messages WHERE id=?`)
      .get(locator.messageId) as { id: number; chat_id: number; role: string } | undefined;

    if (!row) {
      return { ok: false, error: "메시지를 찾을 수 없습니다.", status: 404 };
    }
    if (row.role !== "assistant") {
      return { ok: false, error: "assistant 메시지만 조회할 수 있습니다.", status: 400 };
    }
    return { ok: true, messageId: row.id, chatId: row.chat_id };
  }

  const rows = db
    .prepare(
      `SELECT id, chat_id, role FROM messages
       WHERE chat_id=? AND request_id=? AND role='assistant'`
    )
    .all(locator.chatId, locator.requestId) as Array<{
    id: number;
    chat_id: number;
    role: string;
  }>;

  if (rows.length === 0) {
    return {
      ok: false,
      error: "일치하는 assistant 메시지를 찾을 수 없습니다.",
      status: 404,
    };
  }
  if (rows.length > 1) {
    return {
      ok: false,
      error: "ambiguous_billing_message_locator",
      status: 409,
    };
  }

  return { ok: true, messageId: rows[0]!.id, chatId: rows[0]!.chat_id };
}
