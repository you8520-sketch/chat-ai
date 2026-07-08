import { notFound, redirect } from "next/navigation";

import { getDb } from "@/lib/db";

import { getSessionUser } from "@/lib/auth";
import { canShowFullBillingReceipt } from "@/lib/billingReceiptAccess";
import { getReportStatusesForMessages } from "@/lib/refund";

import { parseAssets, chatAssets } from "@/lib/characterAssets";

import { parseStatusMetaRecord } from "@/lib/statusMeta/types";
import { normalizeMessageVariants, serializeVariantsForClient, resolveActiveVariantContent } from "@/lib/messageAlternates";
import { resolveClientStatusMetaFlags } from "@/lib/statusMeta/displayPolicy";
import {
  markdownPipeTableStatusWindowActive,
  resolveUserNoteStatusWindowPolicy,
} from "@/lib/statusWindowNotePolicy";
import type { Usage } from "@/lib/chatUsage";
import ChatClient from "./ChatClient";

import { DEFAULT_SELECTED_AI, resolveSelectedAI } from "@/lib/chatModels";

import { ensureDefaultPersona, validatePersonaSelection } from "@/lib/userPersonas";
import { listUserNotePresets } from "@/lib/userNotePresets";
import { listStatusWidgetPresets } from "@/lib/statusWidgetPresets";
import { canAccessCharacter } from "@/lib/characterVisibility";
import {
  mergeUserNoteWithChatPrefs,
  resolveInitialUserChatPrefs,
} from "@/lib/userChatPrefs";
import { parseStatusWidgetMode, parseStatusWidgetStackOrder } from "@/lib/statusWidget";
import { resolveStatusWidgetTurn } from "@/lib/statusWidget/resolve";
import {
  parseStoredStatusWidgetValuesJson,
  stripExtractedFactsForClient,
} from "@/lib/statusWidget/parseValues";
import { filterOutMessageIds, purgeOrphanUserMessages } from "@/lib/chatMessageHygiene";
import { takeRecentTurns, takeRecentTurnsIncludingMessage } from "@/lib/chatMessagePagination";
import { createChatSession } from "@/lib/chatSessionCreate";

export const dynamic = "force-dynamic";

type ChatRow = {
  id: number;
  mode: string;
  memory: string;
  memory_pending: string;
  memory_meta: string;
  gemini_model: string;
  user_note: string;
  selected_persona_id: number | null;
  user_impersonation?: number;
  target_response_chars?: number;
  title?: string;
  writing_style_override?: string;
  memory_capacity?: number;
  status_window_enabled?: number;
  status_widget_mode?: string;
  user_status_widget_json?: string;
  status_widget_stack_order?: string;
};

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ chat?: string; fresh?: string; persona?: string; msg?: string }>;
}) {
  const { id } = await params;
  const {
    chat: chatParam,
    fresh: freshParam,
    persona: personaParam,
    msg: msgParam,
  } = await searchParams;
  const startFresh = freshParam === "1" || freshParam === "true";
  const scrollMessageId = msgParam ? Number(msgParam) : 0;

  const user = await getSessionUser();

  if (!user) redirect("/login");

  const db = getDb();

  const c = db
    .prepare(
      "SELECT id, name, emoji, hue, nsfw, greeting, assets, creator_id, creator_name, visibility, moderation_status, official, recommended_writing_style, status_window_prompt, status_widget_json, status_widget_allow_user_override FROM characters WHERE id=?"
    )
    .get(id) as
    | {
        id: number;
        name: string;
        emoji: string;
        hue: number;
        nsfw: number;
        greeting: string;
        assets: string;
        creator_id: number | null;
        creator_name: string;
        visibility: string;
        moderation_status: string;
        official: number;
        recommended_writing_style: string;
      }
    | undefined;

  if (!c) notFound();

  const access = canAccessCharacter(
    {
      id: c.id,
      creator_id: c.creator_id,
      visibility: (c.visibility as "public" | "link" | "private") ?? "private",
      moderation_status: (c.moderation_status as "pending" | "approved" | "rejected") ?? "approved",
      share_slug: null,
      official: c.official,
    },
    user.id
  );
  if (!access.ok) redirect(`/character/${c.id}`);

  if (c.nsfw === 1 && !user.is_adult) redirect("/verify");

  const adminRow = db
    .prepare("SELECT is_admin FROM users WHERE id = ?")
    .get(user.id) as { is_admin: number } | undefined;
  const showFullBillingReceipt = canShowFullBillingReceipt({
    ...user,
    is_admin: adminRow?.is_admin ?? 0,
  });

  const assets = chatAssets(parseAssets(c.assets));
  const isCharacterCreator = c.creator_id === user.id;

  const userProfileRow = db
    .prepare("SELECT user_note, chat_prefs FROM users WHERE id=?")
    .get(user.id) as { user_note: string; chat_prefs: string };

  const personaList = ensureDefaultPersona(user.id, user.nickname);
  const notePresetList = listUserNotePresets(user.id);
  const statusWidgetPresetList = listStatusWidgetPresets(user.id);

  let chat: ChatRow | undefined;

  if (!startFresh) {
    if (chatParam) {
      const requestedId = Number(chatParam);
      if (requestedId) {
        chat = db
          .prepare(
            "SELECT id, mode, memory, memory_pending, memory_meta, gemini_model, user_note, selected_persona_id, user_impersonation, target_response_chars, title, writing_style_override, memory_capacity, status_window_enabled, status_widget_mode, user_status_widget_json, status_widget_stack_order FROM chats WHERE id=? AND user_id=? AND character_id=?"
          )
          .get(requestedId, user.id, c.id) as ChatRow | undefined;
      }
    }

    if (!chat) {
      chat = db
        .prepare(
          "SELECT id, mode, memory, memory_pending, memory_meta, gemini_model, user_note, selected_persona_id, user_impersonation, target_response_chars, title, writing_style_override, memory_capacity, status_window_enabled, status_widget_mode, user_status_widget_json, status_widget_stack_order FROM chats WHERE user_id=? AND character_id=? ORDER BY id DESC LIMIT 1"
        )
        .get(user.id, c.id) as ChatRow | undefined;
    }
  }

  if (chat && !startFresh) {
    const requestedId = chatParam ? Number(chatParam) : 0;
    if (requestedId !== chat.id) {
      redirect(`/chat/${id}?chat=${chat.id}`);
    }
  }

  if (!startFresh && chatParam) {
    const requestedId = Number(chatParam);
    if (requestedId && !chat) {
      notFound();
    }
  }

  if (startFresh || !chat) {
    const bootstrapPrefs = resolveInitialUserChatPrefs({
      serverRaw: userProfileRow.chat_prefs,
      chatTargetResponseChars: undefined,
    });
    let createPersonaId = personaList[0]?.id ?? null;
    if (personaParam) {
      const requestedPersonaId = Number(personaParam);
      if (Number.isFinite(requestedPersonaId)) {
        const selection = validatePersonaSelection(personaList, requestedPersonaId);
        if (selection.ok) {
          createPersonaId = selection.persona.id;
        } else if (selection.fallbackPersona) {
          createPersonaId = selection.fallbackPersona.id;
        }
      }
    }
    const newChatId = createChatSession({
      userId: user.id,
      characterId: c.id,
      greeting: c.greeting,
      mode: c.nsfw ? "nsfw" : "safe",
      userNote: mergeUserNoteWithChatPrefs("", bootstrapPrefs),
      selectedPersonaId: createPersonaId,
      targetResponseChars: bootstrapPrefs.targetResponseChars,
    });
    redirect(`/chat/${id}?chat=${newChatId}`);
  }

  if (!chat) notFound();

  if (personaParam && !startFresh) {
    const requestedPersonaId = Number(personaParam);
    if (Number.isFinite(requestedPersonaId)) {
      const selection = validatePersonaSelection(personaList, requestedPersonaId);
      const nextPersonaId = selection.ok
        ? selection.persona.id
        : selection.fallbackPersona?.id;
      if (nextPersonaId && nextPersonaId !== chat.selected_persona_id) {
        db.prepare("UPDATE chats SET selected_persona_id=? WHERE id=?").run(nextPersonaId, chat.id);
        chat.selected_persona_id = nextPersonaId;
      }
    }
  }

  const selectedPersonaId =
    chat?.selected_persona_id && personaList.some((p) => p.id === chat.selected_persona_id)
      ? chat.selected_persona_id
      : (personaList[0]?.id ?? null);

  const userChatPrefs = resolveInitialUserChatPrefs({
    serverRaw: userProfileRow.chat_prefs,
    chatTargetResponseChars: chat?.target_response_chars,
  });
  const mergedInitialUserNote = mergeUserNoteWithChatPrefs(chat?.user_note ?? "", userChatPrefs);
  const markdownStatusWindowActive = markdownPipeTableStatusWindowActive(
    resolveUserNoteStatusWindowPolicy(mergedInitialUserNote)
  );
  const statusWidgetActive = resolveStatusWidgetTurn({
    characterWidgetJson: (c as { status_widget_json?: string }).status_widget_json,
    chatMode: chat.status_widget_mode,
    userWidgetJson: chat.user_status_widget_json,
    stackOrder: chat.status_widget_stack_order,
    characterAllowUserOverride:
      (c as { status_widget_allow_user_override?: number }).status_widget_allow_user_override !== 0,
  }).active;

  let rawMessages = db
    .prepare(
      "SELECT id, role, content, model, usage, is_refunded, alternates, active_variant, status_meta, status_widget_values_json, status_widget_turn_active, created_at FROM messages WHERE chat_id=? ORDER BY id ASC"
    )
    .all(chat.id) as {
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
    created_at: string;
  }[];

  if (rawMessages.length > 0) {
    const purgedIds = purgeOrphanUserMessages(db, chat.id, rawMessages);
    if (purgedIds.length > 0) {
      rawMessages = filterOutMessageIds(rawMessages, purgedIds);
    }
  }

  const assistantMessageIds = rawMessages
    .filter((m) => m.role === "assistant")
    .map((m) => m.id);
  const reportStatusByMessageId = getReportStatusesForMessages(user.id, assistantMessageIds);

  const allMessages = rawMessages.map((m, idx) => {
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
    const pairedUserMessage =
      m.role === "assistant"
        ? [...rawMessages].slice(0, idx).reverse().find((row) => row.role === "user")?.content
        : undefined;
    const selectedPersonaDesc =
      selectedPersonaId != null
        ? personaList.find((p) => p.id === selectedPersonaId)?.description
        : undefined;
    const statusFlags = resolveClientStatusMetaFlags({
      statusRecord,
      messageContent: activeContent,
      userNote: mergedInitialUserNote,
      userPersona: selectedPersonaDesc,
      userMessage: pairedUserMessage,
      markdownStatusWindowActive,
      statusWidgetActive,
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
      statusMetaFailed: statusFlags.statusMetaFailed,
      statusWidgetValues: stripExtractedFactsForClient(
        parseStoredStatusWidgetValuesJson(m.status_widget_values_json)
      ),
      statusWidgetTurnActive: m.status_widget_turn_active === 1,
      createdAt: m.created_at,
      reportStatus: reportStatusByMessageId.get(m.id) ?? "none",
    };
  });

  const {
    messages,
    hasMoreOlder: initialHasMoreOlder,
    hiddenTurnCount: initialHiddenTurnCount,
  } =
    scrollMessageId > 0
      ? takeRecentTurnsIncludingMessage(allMessages, scrollMessageId)
      : takeRecentTurns(allMessages);

  let initialScrollMessageId: number | null = null;
  if (scrollMessageId > 0) {
    const scrollRow = db
      .prepare("SELECT id FROM messages WHERE id=? AND chat_id=?")
      .get(scrollMessageId, chat.id) as { id: number } | undefined;
    if (scrollRow) initialScrollMessageId = scrollMessageId;
  }

  const bookmarkedIds = (
    db
      .prepare(
        `SELECT b.message_id FROM bookmarks b
         INNER JOIN messages m ON m.id = b.message_id
         WHERE b.user_id = ? AND m.chat_id = ?`
      )
      .all(user.id, chat.id) as { message_id: number }[]
  ).map((r) => r.message_id);

  const charMemory = db
    .prepare(
      `SELECT used_chars FROM character_memories WHERE user_id=? AND character_id=?`
    )
    .get(user.id, c.id) as { used_chars: number } | undefined;

  const hasCharacterMemory = (charMemory?.used_chars ?? 0) > 0;

  const clientKey = initialScrollMessageId
    ? `${chat.id}-msg-${initialScrollMessageId}`
    : String(chat.id);

  return (
    <ChatClient
      key={clientKey}
      character={{ id: c.id, name: c.name, emoji: c.emoji, hue: c.hue, nsfw: c.nsfw }}
      creatorName={c.creator_name}
      creatorId={c.creator_id}
      assets={assets}
      initialChatId={chat.id}
      initialMessages={messages}
      initialHasMoreOlder={initialHasMoreOlder}
      initialHiddenTurnCount={initialHiddenTurnCount}
      initialBookmarkedIds={bookmarkedIds}
      initialScrollMessageId={initialScrollMessageId}
      initialMode={(chat?.mode as "safe" | "nsfw") ?? (c.nsfw ? "nsfw" : "safe")}
      hasMemory={
        hasCharacterMemory ||
        !!(chat?.memory || chat?.memory_pending !== "[]" || chat?.memory_meta !== "{}")
      }
      initialUserNote={mergedInitialUserNote}
      defaultUserNote={notePresetList[0]?.content ?? userProfileRow.user_note ?? ""}
      initialNotePresets={notePresetList}
      initialStatusWidgetPresets={statusWidgetPresetList}
      initialPersonas={personaList}
      initialSelectedPersonaId={selectedPersonaId}
      nickname={user.nickname}
      isAdult={!!user.is_adult}
      userNsfwOn={!!user.nsfw_on}
      initialSelectedAI={resolveSelectedAI(chat?.gemini_model, DEFAULT_SELECTED_AI)}
      initialTargetResponseChars={userChatPrefs.targetResponseChars}
      initialChatTitle={chat?.title ?? ""}
      initialDisplayPrefs={userChatPrefs.displayPrefs}
      isCharacterCreator={isCharacterCreator}
      initialStatusWidgetMode={parseStatusWidgetMode(chat.status_widget_mode)}
      initialCharacterWidgetJson={(c as { status_widget_json?: string }).status_widget_json ?? ""}
      initialUserWidgetJson={chat.user_status_widget_json ?? ""}
      initialStatusWidgetStackOrder={parseStatusWidgetStackOrder(chat.status_widget_stack_order)}
      characterWidgetAllowUserOverride={
        (c as { status_widget_allow_user_override?: number }).status_widget_allow_user_override !== 0
      }
      showFullBillingReceipt={showFullBillingReceipt}
    />
  );
}
