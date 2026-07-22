import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { normalizeMessageVariants, resolveActiveVariantContent } from "@/lib/messageAlternates";
import type { Usage } from "@/lib/chatUsage";
import { normalizeTargetResponseChars } from "@/lib/responseLength";
import {
  buildModelPickerPreview,
  type ModelPickerMessageSample,
  usageToPickerSample,
} from "@/lib/modelPickerPreview";
import { resolveModelPickerAssembledInputSnapshot } from "@/services/modelPickerInputSnapshot";

type DbMessageRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
  model: string;
  usage: string | null;
  alternates: string | null;
  active_variant: number | null;
};

function mapMessagesForPreview(rows: DbMessageRow[]): ModelPickerMessageSample[] {
  return rows.map((m) => {
    const { variants, activeVariant } = normalizeMessageVariants(m);
    const rowUsage = m.usage ? (JSON.parse(m.usage) as Usage) : null;
    const activeUsage = variants[activeVariant]?.usage ?? rowUsage;
    return {
      role: m.role,
      model: m.model,
      usage: usageToPickerSample(activeUsage),
      variants: variants.map((v) => ({ usage: usageToPickerSample(v.usage ?? null) })),
      activeVariant,
    };
  });
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const chatId = Number(body.chatId);
  if (!chatId) {
    return NextResponse.json({ error: "chatId가 필요합니다." }, { status: 400 });
  }

  const db = getDb();
  const chat = db
    .prepare("SELECT id, target_response_chars FROM chats WHERE id=? AND user_id=?")
    .get(chatId, user.id) as { id: number; target_response_chars: number | null } | undefined;
  if (!chat) {
    return NextResponse.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });
  }

  const rows = db
    .prepare(
      `SELECT id, role, content, model, usage, alternates, active_variant
       FROM messages WHERE chat_id=? ORDER BY id ASC`
    )
    .all(chatId) as DbMessageRow[];

  const refreshContext = body.refreshContext === true;
  const skipContextBuild = body.skipContextBuild === true;
  const draftInput = typeof body.draftInput === "string" ? body.draftInput : undefined;
  const inputTokensOverride =
    typeof body.inputTokensOverride === "number" && body.inputTokensOverride > 0
      ? Math.round(body.inputTokensOverride)
      : null;

  let assembledSnapshotTokens: number | null = null;
  if (!skipContextBuild) {
    assembledSnapshotTokens = await resolveModelPickerAssembledInputSnapshot({
      chatId,
      user,
      refresh: refreshContext,
    });
  }

  const targetResponseChars = normalizeTargetResponseChars(
    typeof body.targetResponseChars === "number"
      ? body.targetResponseChars
      : chat.target_response_chars
  );

  const preview = buildModelPickerPreview({
    messages: mapMessagesForPreview(rows),
    targetResponseChars,
    assembledSnapshotTokens,
    draftInput: inputTokensOverride != null ? undefined : draftInput,
    inputTokensOverride,
  });

  return NextResponse.json({
    ...preview,
    totalInputTokens:
      inputTokensOverride ??
      preview.baseInputTokens +
        (draftInput?.trim()
          ? Math.max(1, Math.ceil(draftInput.trim().length * 0.9))
          : 0),
    basis: preview.inputBasis,
  });
}
