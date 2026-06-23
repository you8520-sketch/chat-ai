import { getSessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { normalizeMemoryMeta, parseMemoryMeta } from "@/lib/chatMemory";
import { resolveRelationshipMetaNamesForCharacter } from "@/lib/relationshipMetaCharacterName";
import { messagesToTurns } from "@/lib/hybridMemory";
import { getSubscriptionTier, listUserPersonas, resolveChatSelectedPersona } from "@/lib/userPersonas";
import {
  clearMemoryForChat,
  getMemorySnapshot,
  resolveMemoryTier,
  updateLorebookForChat,
} from "@/lib/memory/memory-manager";
import {
  prepareMemoryPanelView,
  scheduleMemoryPanelBackfill,
} from "@/lib/memory/memory-backfill";
import { resolveLorebookFromRecordsSync } from "@/lib/memory/memory-lorebook-resolve";
import { resolveMemoryBudgetFromCapacity } from "@/lib/memory/memory-capacity-shared";
import { getChatMemoryCapacity } from "@/lib/memory/memory-capacity";
import {
  listMemoryRecordsForChat,
  MEMORY_RECORD_MAX_CHARS,
  MEMORY_RECORD_MIN_CHARS,
  updateMemoryRecordById,
} from "@/lib/memory/memory-turn-summary";
import {
  loadChatRelationshipMeta,
  removeRelationshipMetaItem,
  saveChatRelationshipMeta,
  type RelationshipMetaCategory,
} from "@/lib/memory/memory-relationship-meta";

async function resolveChatCharacter(chatId: number, userId: number) {
  const db = getDb();
  const chat = db
    .prepare(
      "SELECT id, character_id, memory_meta, memory_capacity, selected_persona_id FROM chats WHERE id=? AND user_id=?"
    )
    .get(chatId, userId) as
    | {
        id: number;
        character_id: number;
        memory_meta: string;
        memory_capacity?: number;
        selected_persona_id: number | null;
      }
    | undefined;
  return chat;
}

function resolveRelationshipMetaNames(
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>,
  chat: { character_id: number; selected_persona_id: number | null },
  chatId: number
) {
  const personas = listUserPersonas(user.id);
  const { persona } = resolveChatSelectedPersona(user, personas, chat.selected_persona_id, chatId);
  const userName = persona?.name?.trim() || user.nickname;
  return resolveRelationshipMetaNamesForCharacter(chat.character_id, userName);
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const chatId = Number(new URL(req.url).searchParams.get("chatId"));
  if (!chatId) return Response.json({ error: "chatId가 필요합니다." }, { status: 400 });

  const chat = await resolveChatCharacter(chatId, user.id);
  if (!chat) return Response.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });

  const db = getDb();
  const charRow = db
    .prepare("SELECT name FROM characters WHERE id=?")
    .get(chat.character_id) as { name: string } | undefined;
  const names = resolveRelationshipMetaNames(user, chat, chatId);
  const tier = resolveMemoryTier(user);
  const memoryCapacity = getChatMemoryCapacity(chatId);

  const backfillOpts = {
    userId: user.id,
    characterId: chat.character_id,
    chatId,
    charName: charRow?.name ?? "캐릭터",
    tier,
    memoryCapacity,
  };
  prepareMemoryPanelView(backfillOpts);
  const shouldBackfill = new URL(req.url).searchParams.get("backfill") === "1";
  if (shouldBackfill) {
    scheduleMemoryPanelBackfill(backfillOpts);
  }

  const memoryRecords = listMemoryRecordsForChat(chatId);

  const msgRows = db
    .prepare("SELECT role, content, model FROM messages WHERE chat_id=? ORDER BY id ASC")
    .all(chatId) as { role: "user" | "assistant"; content: string; model: string }[];
  const turns = messagesToTurns(msgRows);
  const rawMeta = parseMemoryMeta(chat.memory_meta);
  const meta = normalizeMemoryMeta(rawMeta, names);
  if (JSON.stringify(rawMeta) !== JSON.stringify(meta)) {
    saveChatRelationshipMeta(chatId, meta);
  }
  const snapshot = getMemorySnapshot(chatId, user.id, chat.character_id, tier, memoryCapacity);
  const lorebookBudget = resolveMemoryBudgetFromCapacity(memoryCapacity).lorebook;
  const displayLorebook =
    resolveLorebookFromRecordsSync(chatId, lorebookBudget).text ||
    snapshot.lorebook.trim();
  const displayText = displayLorebook.trim();

  return Response.json({
    longTerm: displayText,
    lorebook: displayLorebook,
    recentSummary: displayLorebook,
    currentMemory: displayLorebook,
    archiveSummary: snapshot.archiveSummary,
    meta,
    limit: snapshot.limit,
    memoryCapacity: snapshot.memoryCapacity,
    tier: snapshot.tier,
    longTermChars: displayText.length,
    totalTurns: turns.length,
    bufferCount: snapshot.bufferCount,
    messagesUntilCompression: snapshot.messagesUntilCompression,
    budget: snapshot.budget,
    subscriptionTier: getSubscriptionTier(user),
    memoryRecords,
    memoryRecordMinChars: MEMORY_RECORD_MIN_CHARS,
    memoryRecordMaxChars: MEMORY_RECORD_MAX_CHARS,
    // legacy fields for older clients
    turnSummaries: memoryRecords.map((r) => ({
      id: r.id,
      turnNumber: r.turnStart,
      summary: r.summary,
      userEdited: r.userEdited,
      charCount: r.charCount,
    })),
    turnSummaryMaxChars: MEMORY_RECORD_MAX_CHARS,
  });
}

export async function PATCH(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const body = await req.json();
  const chatId = Number(body.chatId);
  const action = body.action as
    | "updateLorebook"
    | "clear"
    | "updateMemoryRecord"
    | "updateTurnSummary"
    | "deleteRelationshipMetaItem"
    | undefined;

  if (!chatId) return Response.json({ error: "chatId가 필요합니다." }, { status: 400 });

  const chat = await resolveChatCharacter(chatId, user.id);
  if (!chat) return Response.json({ error: "채팅방을 찾을 수 없습니다." }, { status: 404 });

  const tier = resolveMemoryTier(user);
  const memoryCapacity = getChatMemoryCapacity(chatId);

  if (action === "clear") {
    clearMemoryForChat(chatId, user.id, chat.character_id, tier);
    const snapshot = getMemorySnapshot(chatId, user.id, chat.character_id, tier, memoryCapacity);
    return Response.json({ ok: true, ...snapshot });
  }

  if (action === "updateLorebook") {
    const lorebook = typeof body.lorebook === "string" ? body.lorebook : "";
    const snapshot = await updateLorebookForChat(
      chatId,
      user.id,
      chat.character_id,
      lorebook,
      tier,
      memoryCapacity
    );
    return Response.json({ ok: true, ...snapshot });
  }

  if (action === "updateMemoryRecord" || action === "updateTurnSummary") {
    const recordId = Number(body.recordId ?? body.summaryId);
    const summary = typeof body.summary === "string" ? body.summary : "";
    if (!recordId) return Response.json({ error: "recordId가 필요합니다." }, { status: 400 });
    const updated = updateMemoryRecordById(chatId, recordId, summary);
    if (!updated) {
      return Response.json(
        { error: `기억 기록은 ${MEMORY_RECORD_MIN_CHARS}~${MEMORY_RECORD_MAX_CHARS}자여야 합니다.` },
        { status: 400 }
      );
    }
    return Response.json({ ok: true, memoryRecord: updated, turnSummary: updated });
  }

  if (action === "deleteRelationshipMetaItem") {
    const category = body.category as RelationshipMetaCategory | undefined;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!category || !["honorifics", "items", "thoughts", "promises"].includes(category)) {
      return Response.json({ error: "category(honorifics|items|thoughts|promises)가 필요합니다." }, { status: 400 });
    }
    if (!text) return Response.json({ error: "text가 필요합니다." }, { status: 400 });
    const names = resolveRelationshipMetaNames(user, chat, chatId);
    const prev = loadChatRelationshipMeta(chatId, names);
    const next = removeRelationshipMetaItem(prev, category, text);
    saveChatRelationshipMeta(chatId, next);
    return Response.json({ ok: true, meta: next });
  }

  return Response.json(
    { error: "action이 필요합니다. (updateLorebook | updateMemoryRecord | deleteRelationshipMetaItem | clear)" },
    { status: 400 }
  );
}
