import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { assertMessageAccess } from "@/lib/chatAccess";
import {
  normalizeMessageVariants,
  serializeVariantsForClient,
  variantToRowFields,
} from "@/lib/messageAlternates";
import { PREFERENCE_EVENT } from "@/lib/feedback/events";
import { recordPreferenceEvent } from "@/lib/feedback/feedback-db";
import { enqueueScoreRecompute } from "@/lib/feedback/queue";

/** 재생성 버전 선택 */
export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const messageId = Number(body.messageId);
  const variantIndex = Number(body.variantIndex);
  if (!messageId || Number.isNaN(variantIndex)) {
    return NextResponse.json({ error: "messageId와 variantIndex가 필요합니다." }, { status: 400 });
  }

  const msg = assertMessageAccess(user.id, messageId);
  if (!msg) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  if (msg.role !== "assistant" || msg.model === "greeting") {
    return NextResponse.json({ error: "AI 답변만 버전 선택이 가능합니다." }, { status: 400 });
  }

  const db = getDb();
  const row = db
    .prepare("SELECT content, model, usage, alternates, active_variant FROM messages WHERE id=?")
    .get(messageId) as {
    content: string;
    model: string;
    usage: string | null;
    alternates: string | null;
    active_variant: number | null;
  };

  const { variants, activeVariant } = normalizeMessageVariants(row);
  if (variants.length <= 1) {
    return NextResponse.json({ error: "선택할 다른 버전이 없습니다." }, { status: 400 });
  }
  if (variantIndex < 0 || variantIndex >= variants.length) {
    return NextResponse.json({ error: "잘못된 버전 번호입니다." }, { status: 400 });
  }
  if (variantIndex === activeVariant) {
    return NextResponse.json({
      ok: true,
      ...serializeVariantsForClient(variants, activeVariant),
      content: variants[activeVariant].content,
      usage: variants[activeVariant].usage,
    });
  }

  const fromVariant = activeVariant;
  const fields = variantToRowFields(variants, variantIndex);
  db.prepare(
    "UPDATE messages SET content=?, model=?, usage=?, alternates=?, active_variant=? WHERE id=?"
  ).run(
    fields.content,
    fields.model,
    fields.usage,
    JSON.stringify(variants),
    variantIndex,
    messageId
  );

  recordPreferenceEvent({
    userId: user.id,
    chatId: msg.chat_id,
    messageId,
    eventType: PREFERENCE_EVENT.VARIANT_SWITCH,
    payload: { from: fromVariant, to: variantIndex },
  });
  enqueueScoreRecompute(messageId);

  const selected = variants[variantIndex];
  return NextResponse.json({
    ok: true,
    ...serializeVariantsForClient(variants, variantIndex),
    content: selected.content,
    usage: selected.usage,
  });
}
