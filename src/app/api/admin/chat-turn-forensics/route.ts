import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireForensicAdminAccess } from "@/lib/adminForensicAccess";
import { hashForensicsText } from "@/lib/streamTurnForensics";
import type { Usage } from "@/lib/chatUsage";

type ForensicMessageRow = {
  id: number;
  chat_id: number;
  role: string;
  content: string;
  model: string;
  request_id: string | null;
  generation_status: string | null;
  status: string | null;
  usage: string | null;
  alternates: string | null;
  active_variant: number | null;
  status_widget_turn_active: number | null;
  status_widget_values_json: string | null;
  user_message_id: number | null;
  deduction_slices: string | null;
  created_at: string;
  updated_at: string;
};

function parseMessageId(raw: string | null): number | null {
  const cleaned = raw?.trim().replace(/^msg-/i, "") ?? "";
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseWidgetExtractDiagnostics(
  raw: string | null
): Usage["statusWidgetExtractDiagnostics"] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Usage;
    return parsed.statusWidgetExtractDiagnostics ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  if (!(await requireForensicAdminAccess(req))) {
    return NextResponse.json({ error: "admin diagnostics access denied" }, { status: 403 });
  }

  const url = new URL(req.url);
  const messageId = parseMessageId(url.searchParams.get("messageId"));
  const chatIdParam = Number(url.searchParams.get("chatId"));
  const chatId =
    Number.isInteger(chatIdParam) && chatIdParam > 0 ? chatIdParam : null;
  const includeContentTail = url.searchParams.get("includeContentTail") === "1";

  const db = getDb();

  if (messageId) {
    const row = db
      .prepare(
        `SELECT id, chat_id, role, content, model, request_id, generation_status, status,
                usage, alternates, active_variant, status_widget_turn_active,
                status_widget_values_json, user_message_id, deduction_slices,
                created_at, updated_at
         FROM messages WHERE id=?`
      )
      .get(messageId) as ForensicMessageRow | undefined;

    if (!row) {
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }

    return NextResponse.json(formatForensicRow(row, includeContentTail));
  }

  if (!chatId) {
    return NextResponse.json({ error: "messageId or chatId is required" }, { status: 400 });
  }

  const rows = db
    .prepare(
      `SELECT id, chat_id, role, content, model, request_id, generation_status, status,
              usage, alternates, active_variant, status_widget_turn_active,
              status_widget_values_json, user_message_id, deduction_slices,
              created_at, updated_at
       FROM messages WHERE chat_id=? ORDER BY id DESC LIMIT 6`
    )
    .all(chatId) as ForensicMessageRow[];

  return NextResponse.json({
    chatId,
    messages: rows.map((row) => formatForensicRow(row, includeContentTail)),
  });
}

function formatForensicRow(row: ForensicMessageRow, includeContentTail: boolean) {
  const content = row.content ?? "";
  const statusWidgetValuesJson = row.status_widget_values_json ?? "";
  return {
    messageId: row.id,
    chatId: row.chat_id,
    role: row.role,
    model: row.model,
    requestId: row.request_id,
    generationStatus: row.generation_status,
    status: row.status,
    contentChars: content.length,
    contentHash: hashForensicsText(content),
    ...(includeContentTail ? { contentTail: content.slice(-300) } : {}),
    alternatesChars: row.alternates?.length ?? 0,
    activeVariant: row.active_variant,
    statusWidgetTurnActive: row.status_widget_turn_active === 1,
    statusWidgetValuesChars: statusWidgetValuesJson.length,
    statusWidgetValuesHash: hashForensicsText(statusWidgetValuesJson),
    userMessageId: row.user_message_id,
    deductionSlices: row.deduction_slices,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    extractDiagnostics: parseWidgetExtractDiagnostics(row.usage),
  };
}
