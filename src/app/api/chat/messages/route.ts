import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { filterOutMessageIds, purgeOrphanUserMessages } from "@/lib/chatMessageHygiene";
import { normalizeMessageVariants, serializeVariantsForClient, resolveActiveVariantContent } from "@/lib/messageAlternates";
import { resolveClientStatusMetaFlags } from "@/lib/statusMeta/displayPolicy";
import {
  markdownPipeTableStatusWindowActive,
  resolveUserNoteStatusWindowPolicy,
} from "@/lib/statusWindowNotePolicy";
import { parseStatusMetaRecord } from "@/lib/statusMeta/types";
import type { Usage } from "@/lib/chatUsage";
import {
  parseStoredStatusWidgetValuesJson,
} from "@/lib/statusWidget";
import {
  CHAT_LOAD_MORE_TURNS,
  takeOlderTurnsBefore,
  type ChatMessageLike,
} from "@/lib/chatMessagePagination";

type DbMessageRow = {
  id: number;
  role: "user" | "assistant";
  content: string;
  model: string;
  usage: string | null;
  is_refunded: number;
  alternates: string | null;
  active_variant: number | null;
  status_meta: string | null;
  status_widget_values_json: string | null;
  status_widget_turn_active: number | null;
};

function mapDbMessageForClient(m: DbMessageRow, userNote?: string) {
  const { variants, activeVariant } = normalizeMessageVariants(m);
  const variantMeta = serializeVariantsForClient(variants, activeVariant);
  const rowUsage = m.usage ? (JSON.parse(m.usage) as Usage) : null;
  const activeUsage = variants[activeVariant]?.usage ?? rowUsage;
  const statusRecord = parseStatusMetaRecord(m.status_meta);
  const activeContent = resolveActiveVariantContent({
    content: m.content,
    variants: variantMeta.variants,
    activeVariant: variantMeta.activeVariant,
  });
  const markdownStatusWindowActive = userNote
    ? markdownPipeTableStatusWindowActive(resolveUserNoteStatusWindowPolicy(userNote))
    : false;
  const statusFlags = resolveClientStatusMetaFlags({
    statusRecord,
    messageContent: activeContent,
    userNote,
    markdownStatusWindowActive,
  });
  return {
    id: m.id,
    role: m.role,
    content: activeContent,
    model: m.model,
    usage: activeUsage,
    isRefunded: !!m.is_refunded,
    variants: variantMeta.variants,
    activeVariant: variantMeta.activeVariant,
    variantCount: variantMeta.variantCount,
    statusMeta: statusFlags.statusMeta,
    statusMetaFormatSpec: statusRecord?.formatSpec ?? null,
    statusMetaPending: statusFlags.statusMetaPending,
    statusMetaRequested: statusFlags.statusMetaRequested,
    statusWidgetValues: parseStoredStatusWidgetValuesJson(m.status_widget_values_json),
    statusWidgetTurnActive: m.status_widget_turn_active === 1,
  };
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const url = new URL(req.url);
  const chatId = Number(url.searchParams.get("chatId"));
  const beforeMessageId = Number(url.searchParams.get("beforeMessageId"));
  const turnLimit = Number(url.searchParams.get("turnLimit") ?? CHAT_LOAD_MORE_TURNS);

  if (!chatId) return NextResponse.json({ error: "chatId가 필요합니다." }, { status: 400 });
  if (!beforeMessageId) {
    return NextResponse.json({ error: "beforeMessageId가 필요합니다." }, { status: 400 });
  }

  const db = getDb();
  const chat = db
    .prepare("SELECT id, user_note FROM chats WHERE id=? AND user_id=?")
    .get(chatId, user.id) as { id: number; user_note: string | null } | undefined;
  if (!chat) return NextResponse.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });

  let rawMessages = db
    .prepare(
      "SELECT id, role, content, model, usage, is_refunded, alternates, active_variant, status_meta, status_widget_values_json, status_widget_turn_active FROM messages WHERE chat_id=? ORDER BY id ASC"
    )
    .all(chatId) as DbMessageRow[];

  if (rawMessages.length > 0) {
    const purgedIds = purgeOrphanUserMessages(db, chatId, rawMessages);
    if (purgedIds.length > 0) {
      rawMessages = filterOutMessageIds(rawMessages, purgedIds);
    }
  }

  const mapped = rawMessages.map((m) => mapDbMessageForClient(m, chat.user_note ?? undefined)) as ChatMessageLike[];
  const safeTurnLimit =
    Number.isFinite(turnLimit) && turnLimit > 0
      ? Math.min(Math.floor(turnLimit), 50)
      : CHAT_LOAD_MORE_TURNS;

  const { messages, hasMoreOlder } = takeOlderTurnsBefore(
    mapped,
    beforeMessageId,
    safeTurnLimit
  );

  const idSet = new Set(messages.map((m) => m.id));
  const ordered = rawMessages
    .filter((r) => idSet.has(r.id))
    .map((r) => mapDbMessageForClient(r, chat.user_note ?? undefined));

  return NextResponse.json({
    messages: ordered,
    hasMoreOlder,
    loadedTurnCount: safeTurnLimit,
  });
}
