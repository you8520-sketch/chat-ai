import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertMessageAccess } from "@/lib/chatAccess";
import { CHAT_MESSAGE_MAX, ASSISTANT_MESSAGE_MAX } from "@/lib/chatModels";
import { editedMessageVariant } from "@/lib/messageAlternates";
import { normalizeEditedProseForSave } from "@/lib/canonicalProse";
import {
  parseStoredStatusWidgetValuesJson,
  sanitizeParsedStatusWidgetValues,
  serializeStatusWidgetValuesJson,
  stripExtractedFactsForClient,
} from "@/lib/statusWidget/parseValues";
import type { ParsedStatusWidgetTurnValues } from "@/lib/statusWidget/types";

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
