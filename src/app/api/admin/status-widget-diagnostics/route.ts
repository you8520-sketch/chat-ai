import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseMessageVariants } from "@/lib/messageAlternates";
import {
  parseStoredStatusWidgetValuesJson,
  resolveStatusWidgetTurn,
  stripExtractedFactsForClient,
} from "@/lib/statusWidget";
import type { ParsedStatusWidgetTurnValues } from "@/lib/statusWidget";
import {
  diagnoseStatusWidgetValues,
  statusWidgetDiagnosticHash,
} from "@/lib/statusWidget/diagnostics";
import { statusWidgetValuesHasContent } from "@/lib/statusWidget/displayPolicy";

type DiagnosticMessageRow = {
  id: number;
  chat_id: number;
  role: string;
  content: string;
  model: string;
  alternates: string | null;
  active_variant: number | null;
  status_widget_values_json: string | null;
  status_widget_turn_active: number | null;
  request_id: string | null;
  generation_status: string | null;
  chat_status_widget_mode: string | null;
  user_status_widget_json: string | null;
  status_widget_stack_order: string | null;
  status_widget_display_mode: string | null;
  character_status_widget_json: string | null;
  status_widget_allow_user_override: number | null;
};

function parseMessageId(raw: string | null): number | null {
  const cleaned = raw?.trim().replace(/^msg-/i, "") ?? "";
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function requestToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || req.headers.get("x-admin-debug-token")?.trim() || "";
}

function requireDebugToken(req: Request): boolean {
  const expected = process.env.ADMIN_DEBUG_TOKEN?.trim() ?? "";
  if (!expected) return process.env.NODE_ENV !== "production";
  return requestToken(req) === expected;
}

function rawJsonIsInvalid(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false;
  try {
    JSON.parse(raw);
    return false;
  } catch {
    return true;
  }
}

function safeJsonArrayLength(raw: string | null): number {
  return parseMessageVariants(raw).length;
}

function activeVariantHasStatusValues(raw: string | null, activeVariant: number | null): boolean {
  if (!raw?.trim()) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return false;
    const idx = activeVariant ?? parsed.length - 1;
    const variant = parsed[idx] as { statusWidgetValues?: ParsedStatusWidgetTurnValues } | undefined;
    return statusWidgetValuesHasContent(variant?.statusWidgetValues);
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  if (!requireDebugToken(req)) {
    return NextResponse.json({ error: "admin diagnostics access denied" }, { status: 403 });
  }

  const url = new URL(req.url);
  const messageId = parseMessageId(url.searchParams.get("messageId"));
  if (!messageId) {
    return NextResponse.json({ error: "messageId is required" }, { status: 400 });
  }

  const row = getDb()
    .prepare(
      `SELECT
        m.id, m.chat_id, m.role, m.content, m.model, m.alternates, m.active_variant,
        m.status_widget_values_json, m.status_widget_turn_active, m.request_id, m.generation_status,
        ch.status_widget_mode AS chat_status_widget_mode,
        ch.user_status_widget_json,
        ch.status_widget_stack_order,
        ch.status_widget_display_mode,
        c.status_widget_json AS character_status_widget_json,
        c.status_widget_allow_user_override
      FROM messages m
      JOIN chats ch ON ch.id = m.chat_id
      JOIN characters c ON c.id = ch.character_id
      WHERE m.id = ?`
    )
    .get(messageId) as DiagnosticMessageRow | undefined;

  if (!row) {
    return NextResponse.json({ error: "message not found" }, { status: 404 });
  }

  const resolved = resolveStatusWidgetTurn({
    characterWidgetJson: row.character_status_widget_json,
    chatMode: row.chat_status_widget_mode,
    userWidgetJson: row.user_status_widget_json,
    stackOrder: row.status_widget_stack_order,
    displayMode: row.status_widget_display_mode,
    characterAllowUserOverride: row.status_widget_allow_user_override !== 0,
  });
  const invalidJson = rawJsonIsInvalid(row.status_widget_values_json);
  const parsed = invalidJson
    ? {}
    : stripExtractedFactsForClient(
        parseStoredStatusWidgetValuesJson(row.status_widget_values_json)
      );
  const diagnostic = diagnoseStatusWidgetValues({
    resolved,
    statusWidgetTurnActive: row.status_widget_turn_active === 1,
    values: parsed,
    model: row.model,
    invalidJson,
  });

  return NextResponse.json({
    messageId: row.id,
    chatId: row.chat_id,
    role: row.role,
    hasStatusWidgetValuesJson: Boolean(row.status_widget_values_json?.trim()),
    statusWidgetValuesJsonShape: diagnostic.dbValueShape,
    statusWidgetValuesKeys: diagnostic.actualKeys,
    expectedKeys: diagnostic.expectedKeys,
    missingKeys: diagnostic.missingKeys,
    placeholderOnly: diagnostic.placeholderOnly,
    hasUsableValues: diagnostic.hasUsableValues,
    statusWidgetTurnActive: diagnostic.statusWidgetTurnActive,
    rendererWouldShowMain: diagnostic.rendererWouldShow,
    rendererWouldShowEditPreview: diagnostic.rendererWouldShowEditPreview,
    variantsCount: safeJsonArrayLength(row.alternates),
    activeVariantHasStatusValues: activeVariantHasStatusValues(
      row.alternates,
      row.active_variant
    ),
    contentHash: statusWidgetDiagnosticHash(row.content),
    contentLength: row.content.length,
    statusValuesHash: statusWidgetDiagnosticHash(row.status_widget_values_json),
    reasonCode: diagnostic.reasonCode,
    requestId: row.request_id ?? null,
    generationStatus: row.generation_status ?? null,
  });
}
