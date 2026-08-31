import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { filterOutMessageIds, purgeOrphanUserMessages } from "@/lib/chatMessageHygiene";
import { normalizeMessageVariants, serializeVariantsForClient, resolveActiveVariantContent } from "@/lib/messageAlternates";
import { resolveClientStatusMetaFlags } from "@/lib/statusMeta/displayPolicy";
import {
  resolveClientSuggestedReplies,
} from "@/lib/suggestedReplies/parse";
import { resolveClientAsyncRecordsFromMessageRow } from "@/lib/clientAsyncRecordRead";
import {
  markdownPipeTableStatusWindowActive,
  resolveUserNoteStatusWindowPolicy,
} from "@/lib/statusWindowNotePolicy";
import type { Usage } from "@/lib/chatUsage";
import {
  keepInternalAdultRoutingForUser,
  serializeUsageForPublicClient,
} from "@/lib/billingReceiptAccess";
import {
  parseStoredStatusWidgetValuesJson,
  stripExtractedFactsForClient,
} from "@/lib/statusWidget";
import {
  CHAT_LOAD_MORE_TURNS,
  takeOlderTurnsBefore,
  type ChatMessageLike,
} from "@/lib/chatMessagePagination";
import { getReportStatusesForMessages } from "@/lib/refund";
import { collectStaleOocAdoptionIds, readOocSceneClientFlags } from "@/lib/oocSceneRender";

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
  suggested_replies_json: string | null;
  created_at: string;
  request_id: string | null;
  generation_status: string | null;
};

function mapDbMessageForClient(
  m: DbMessageRow,
  userNote?: string,
  reportStatus: "none" | "pending" | "approved" | "rejected" = "none",
  keepInternalAdultRouting = false
) {
  const { variants, activeVariant } = normalizeMessageVariants(m);
  const variantMeta = serializeVariantsForClient(variants, activeVariant, {
    keepInternalAdultRouting,
  });
  const rowUsage = m.usage ? (JSON.parse(m.usage) as Usage) : null;
  const activeUsage = variants[activeVariant]?.usage ?? rowUsage;
  const oocFlags = readOocSceneClientFlags(activeUsage ?? rowUsage);
  const clientUsage = activeUsage
    ? serializeUsageForPublicClient(activeUsage, {
        keepInternal: keepInternalAdultRouting,
      })
    : null;
  const { statusRecord, suggestedRepliesRecord } = resolveClientAsyncRecordsFromMessageRow(m);
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
  const activeVariantSnapshot = variants[activeVariant];
  const hasVariantStatusSnapshot = Object.prototype.hasOwnProperty.call(
    activeVariantSnapshot ?? {},
    "statusWidgetValues"
  );
  const messageStatusWidgetValues = hasVariantStatusSnapshot
    ? (activeVariantSnapshot?.statusWidgetValues ?? null)
    : parseStoredStatusWidgetValuesJson(m.status_widget_values_json);
  const suggestedRepliesFields = resolveClientSuggestedReplies(suggestedRepliesRecord);

  return {
    id: m.id,
    role: m.role,
    content: activeContent,
    model: m.model,
    usage: clientUsage,
    isRefunded: !!m.is_refunded,
    variants: variantMeta.variants,
    activeVariant: variantMeta.activeVariant,
    variantCount: variantMeta.variantCount,
    statusMeta: statusFlags.statusMeta,
    statusMetaFormatSpec: statusRecord?.formatSpec ?? null,
    statusMetaPending: statusFlags.statusMetaPending,
    statusMetaRequested: statusFlags.statusMetaRequested,
    statusWidgetValues: stripExtractedFactsForClient(messageStatusWidgetValues),
    statusWidgetTurnActive: m.status_widget_turn_active === 1,
    ...suggestedRepliesFields,
    createdAt: m.created_at,
    requestId: m.request_id ?? undefined,
    generationStatus: m.generation_status ?? undefined,
    reportStatus,
    oocSceneRender: oocFlags.oocSceneRender,
    canonAdopted: oocFlags.canonAdopted,
  };
}

function attachCanonAdoptionStale<T extends { id: number; canonAdoptionStale?: boolean }>(
  mapped: T[],
  rawMessages: DbMessageRow[]
): T[] {
  const staleIds = new Set(
    collectStaleOocAdoptionIds(
      rawMessages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        model: m.model,
        usage: m.usage,
        generation_status: m.generation_status,
      }))
    )
  );
  return mapped.map((m) => (staleIds.has(m.id) ? { ...m, canonAdoptionStale: true } : m));
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
      "SELECT id, role, content, model, usage, is_refunded, alternates, active_variant, status_meta, status_widget_values_json, status_widget_turn_active, suggested_replies_json, created_at, request_id, generation_status FROM messages WHERE chat_id=? ORDER BY id ASC"
    )
    .all(chatId) as DbMessageRow[];

  if (rawMessages.length > 0) {
    const purgedIds = purgeOrphanUserMessages(db, chatId, rawMessages);
    if (purgedIds.length > 0) {
      rawMessages = filterOutMessageIds(rawMessages, purgedIds);
    }
  }

  const reportStatusByMessageId = getReportStatusesForMessages(
    user.id,
    rawMessages.filter((m) => m.role === "assistant").map((m) => m.id)
  );
  const keepInternalAdultRouting = keepInternalAdultRoutingForUser(user);

  const mapped = attachCanonAdoptionStale(
    rawMessages.map((m) =>
      mapDbMessageForClient(
        m,
        chat.user_note ?? undefined,
        reportStatusByMessageId.get(m.id) ?? "none",
        keepInternalAdultRouting
      )
    ),
    rawMessages
  ) as ChatMessageLike[];
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
    .map((r) =>
      mapDbMessageForClient(
        r,
        chat.user_note ?? undefined,
        reportStatusByMessageId.get(r.id) ?? "none",
        keepInternalAdultRouting
      )
    );

  return NextResponse.json({
    messages: ordered,
    hasMoreOlder,
    loadedTurnCount: safeTurnLimit,
  });
}
