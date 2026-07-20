import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertMessageAccess } from "@/lib/chatAccess";
import { CHAT_MESSAGE_MAX, ASSISTANT_MESSAGE_MAX } from "@/lib/chatModels";
import {
  editedMessageVariant,
  normalizeMessageVariants,
  resolveActiveVariantContent,
  serializeVariantsForClient,
} from "@/lib/messageAlternates";
import { normalizeEditedProseForSave } from "@/lib/canonicalProse";
import {
  parseStoredStatusWidgetValuesJson,
  sanitizeParsedStatusWidgetValues,
  serializeStatusWidgetValuesJson,
  stripExtractedFactsForClient,
} from "@/lib/statusWidget/parseValues";
import type { ParsedStatusWidgetTurnValues } from "@/lib/statusWidget/types";
import { resolveClientStatusMetaFlags } from "@/lib/statusMeta/displayPolicy";
import { parseStatusMetaRecord } from "@/lib/statusMeta/types";
import {
  markdownPipeTableStatusWindowActive,
  resolveUserNoteStatusWindowPolicy,
} from "@/lib/statusWindowNotePolicy";
import type { Usage } from "@/lib/chatUsage";

/** Read-only snapshot for stream EOF reconciliation (generationStatus + final content). */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const url = new URL(req.url);
  const messageId = Number(url.searchParams.get("messageId"));
  if (!messageId) {
    return NextResponse.json({ error: "messageId가 필요합니다." }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT m.id, m.chat_id, m.role, m.content, m.model, m.usage, m.alternates, m.active_variant,
              m.status_meta, m.status_widget_values_json, m.status_widget_turn_active,
              m.generation_status, m.request_id, m.user_message_id, c.user_note
       FROM messages m
       JOIN chats c ON c.id = m.chat_id
       WHERE m.id=? AND c.user_id=? AND m.role='assistant'`
    )
    .get(messageId, user.id) as
    | {
        id: number;
        chat_id: number;
        role: string;
        content: string;
        model: string;
        usage: string | null;
        alternates: string | null;
        active_variant: number | null;
        status_meta: string | null;
        status_widget_values_json: string | null;
        status_widget_turn_active: number | null;
        generation_status: string | null;
        request_id: string | null;
        user_message_id: number | null;
        user_note: string | null;
      }
    | undefined;

  if (!row) {
    return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  }

  const { variants, activeVariant } = normalizeMessageVariants(row);
  const variantMeta = serializeVariantsForClient(variants, activeVariant);
  const rowUsage = row.usage ? (JSON.parse(row.usage) as Usage) : null;
  const activeUsage = variants[activeVariant]?.usage ?? rowUsage;
  const activeContent = resolveActiveVariantContent({
    content: row.content,
    variants: variantMeta.variants,
    activeVariant: variantMeta.activeVariant,
  });
  const statusRecord = parseStatusMetaRecord(row.status_meta);
  const markdownStatusWindowActive = row.user_note
    ? markdownPipeTableStatusWindowActive(resolveUserNoteStatusWindowPolicy(row.user_note))
    : false;
  const statusFlags = resolveClientStatusMetaFlags({
    statusRecord,
    messageContent: activeContent,
    userNote: row.user_note ?? undefined,
    markdownStatusWindowActive,
  });
  const activeVariantSnapshot = variants[activeVariant];
  const hasVariantStatusSnapshot = Object.prototype.hasOwnProperty.call(
    activeVariantSnapshot ?? {},
    "statusWidgetValues"
  );
  const messageStatusWidgetValues = hasVariantStatusSnapshot
    ? (activeVariantSnapshot?.statusWidgetValues ?? null)
    : parseStoredStatusWidgetValuesJson(row.status_widget_values_json);

  return NextResponse.json({
    messageId: row.id,
    chatId: row.chat_id,
    generationStatus: row.generation_status ?? "generating",
    content: activeContent,
    model: row.model,
    usage: activeUsage,
    variants: variantMeta.variants,
    activeVariant: variantMeta.activeVariant,
    variantCount: variantMeta.variantCount,
    statusWidgetValues: stripExtractedFactsForClient(messageStatusWidgetValues),
    statusWidgetTurnActive: row.status_widget_turn_active === 1,
    statusMetaPending: statusFlags.statusMetaPending,
    statusMetaRequested: statusFlags.statusMetaRequested,
    userMessageId: row.user_message_id,
    requestId: row.request_id ?? undefined,
  });
}

function parseIncomingWidgetValues(raw: unknown): ParsedStatusWidgetTurnValues | null {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as ParsedStatusWidgetTurnValues;
  return sanitizeParsedStatusWidgetValues({
    character: obj.character ?? null,
    user: obj.user ?? null,
  });
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const { messageId, content } = body as {
    messageId?: unknown;
    content?: unknown;
    statusWidgetValues?: unknown;
  };
  const id = Number(messageId);
  let text = typeof content === "string" ? normalizeEditedProseForSave(content) : "";
  if (!id) return NextResponse.json({ error: "messageId가 필요합니다." }, { status: 400 });
  if (!text.trim()) return NextResponse.json({ error: "내용을 입력하세요." }, { status: 400 });

  const msg = assertMessageAccess(user.id, id);
  if (!msg) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  if (msg.model === "greeting") {
    return NextResponse.json({ error: "인사말은 수정할 수 없습니다." }, { status: 400 });
  }

  const maxLen = msg.role === "assistant" ? ASSISTANT_MESSAGE_MAX : CHAT_MESSAGE_MAX;
  if (text.length > maxLen) {
    return NextResponse.json(
      { error: `메시지는 ${maxLen.toLocaleString()}자까지 입력할 수 있습니다.` },
      { status: 400 }
    );
  }

  const incomingWidgets =
    msg.role === "assistant" ? parseIncomingWidgetValues(body.statusWidgetValues) : null;
  const hasWidgetPatch = msg.role === "assistant" && "statusWidgetValues" in body;

  const db = getDb();
  if (msg.role === "assistant") {
    const variant = editedMessageVariant({
      content: text,
      model: msg.model,
      usage: msg.usage ? JSON.parse(msg.usage) : null,
    });

    let statusWidgetValuesJson: string | undefined;
    let clientWidgetValues: ParsedStatusWidgetTurnValues | undefined;
    if (hasWidgetPatch) {
      const existing = parseStoredStatusWidgetValuesJson(msg.status_widget_values_json);
      const merged: ParsedStatusWidgetTurnValues = {
        character: incomingWidgets?.character ?? null,
        user: incomingWidgets?.user ?? null,
        ...(existing.extracted_facts?.length
          ? { extracted_facts: existing.extracted_facts }
          : {}),
      };
      const sanitized = sanitizeParsedStatusWidgetValues(merged);
      statusWidgetValuesJson = serializeStatusWidgetValuesJson(sanitized);
      clientWidgetValues = stripExtractedFactsForClient(sanitized);
    }

    if (statusWidgetValuesJson != null) {
      db.prepare(
        "UPDATE messages SET content=?, alternates=?, active_variant=?, status_widget_values_json=? WHERE id=?"
      ).run(text, JSON.stringify([variant]), 0, statusWidgetValuesJson, id);
    } else {
      db.prepare("UPDATE messages SET content=?, alternates=?, active_variant=? WHERE id=?").run(
        text,
        JSON.stringify([variant]),
        0,
        id
      );
    }

    return NextResponse.json({
      ok: true,
      content: text,
      variants: [variant],
      activeVariant: 0,
      variantCount: 1,
      ...(clientWidgetValues != null ? { statusWidgetValues: clientWidgetValues } : {}),
    });
  }

  db.prepare("UPDATE messages SET content=? WHERE id=?").run(text, id);
  return NextResponse.json({ ok: true, content: text });
}
