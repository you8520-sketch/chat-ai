import { getDb } from "@/lib/db";
import type { Route } from "@/lib/ai";
import { extractRelationshipMetaFromTurn, extractRelationshipMetaAfterRegenerate } from "@/lib/ai";
import {
  EMPTY_MEMORY_META,
  mergeMemoryMeta,
  normalizeMemoryMeta,
  parseMemoryMeta,
  type HonorificNames,
  type MemoryMeta,
  type RelationshipMetaCategory,
  type RelationshipMetaDelta,
} from "@/lib/chatMemory";
import { isMemoryFeatureEnabled } from "./memory-feature";

export type { RelationshipMetaCategory };

export function loadChatRelationshipMeta(chatId: number, names?: HonorificNames): MemoryMeta {
  const db = getDb();
  const row = db
    .prepare("SELECT memory_meta FROM chats WHERE id=?")
    .get(chatId) as { memory_meta: string } | undefined;
  const meta = parseMemoryMeta(row?.memory_meta);
  return names ? normalizeMemoryMeta(meta, names) : meta;
}

export function saveChatRelationshipMeta(chatId: number, meta: MemoryMeta): void {
  const db = getDb();
  db.prepare("UPDATE chats SET memory_meta=? WHERE id=?").run(JSON.stringify(meta), chatId);
}

export function removeRelationshipMetaItem(
  meta: MemoryMeta,
  category: RelationshipMetaCategory,
  text: string
): MemoryMeta {
  const needle = text.trim();
  if (!needle) return meta;
  if (category === "promises") {
    return {
      ...meta,
      promises: meta.promises.filter((p) => p.text !== needle),
    };
  }
  return {
    ...meta,
    [category]: meta[category].filter((item) => item !== needle),
  };
}

export function clearChatRelationshipMeta(chatId: number): void {
  saveChatRelationshipMeta(chatId, { ...EMPTY_MEMORY_META });
}

function hasRelationshipDelta(delta: RelationshipMetaDelta): boolean {
  return (
    (delta.honorifics?.length ?? 0) > 0 ||
    Boolean(delta.currentLocation?.trim()) ||
    (delta.items?.length ?? 0) > 0 ||
    (delta.thoughts?.length ?? 0) > 0 ||
    (delta.itemsRemove?.length ?? 0) > 0 ||
    (delta.thoughtsRemove?.length ?? 0) > 0 ||
    (delta.promisesAdd?.length ?? 0) > 0 ||
    (delta.promisesRemove?.length ?? 0) > 0
  );
}

function applyRelationshipDeltaToChat(opts: {
  chatId: number;
  names: HonorificNames;
  delta: RelationshipMetaDelta;
}): MemoryMeta {
  const prev = loadChatRelationshipMeta(opts.chatId);
  const prevNormalized = normalizeMemoryMeta(prev, opts.names);
  if (!hasRelationshipDelta(opts.delta)) {
    if (JSON.stringify(prev) !== JSON.stringify(prevNormalized)) {
      saveChatRelationshipMeta(opts.chatId, prevNormalized);
    }
    return prevNormalized;
  }

  const merged = mergeMemoryMeta(prevNormalized, opts.delta, opts.names);
  saveChatRelationshipMeta(opts.chatId, merged);
  return merged;
}

/** 턴 종료 후 호칭·물건·속마음·약속 추출 → chats.memory_meta 병합 */
export async function mergeRelationshipMetaFromTurn(opts: {
  chatId: number;
  names: HonorificNames;
  userMessage: string;
  assistantMessage: string;
  route: Route;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
  /** DeepSeek/Qwen — 메인 모델 JSON tail 파싱 성공 시 Flash 생략 */
  mainModelTailParsed?: boolean;
  mainModelDelta?: RelationshipMetaDelta | null;
}): Promise<MemoryMeta> {
  if (!isMemoryFeatureEnabled()) return loadChatRelationshipMeta(opts.chatId);
  const names = opts.names;

  if (opts.mainModelTailParsed === true) {
    return applyRelationshipDeltaToChat({
      chatId: opts.chatId,
      names,
      delta: opts.mainModelDelta ?? {},
    });
  }

  const prev = loadChatRelationshipMeta(opts.chatId);
  const prevNormalized = normalizeMemoryMeta(prev, names);
  const delta = await extractRelationshipMetaFromTurn(
    opts.userMessage,
    opts.assistantMessage,
    names.charName,
    names.userName,
    opts.route,
    prevNormalized,
    opts.turnTrace
  );
  if (!hasRelationshipDelta(delta)) {
    if (JSON.stringify(prev) !== JSON.stringify(prevNormalized)) {
      saveChatRelationshipMeta(opts.chatId, prevNormalized);
    }
    return prevNormalized;
  }

  const merged = mergeMemoryMeta(prevNormalized, delta, names);
  saveChatRelationshipMeta(opts.chatId, merged);
  return merged;
}

/** 재생성 — 거부본 대비 소지품·속마음 제거 후 새 정본 반영 */
export async function mergeRelationshipMetaAfterRegenerate(opts: {
  chatId: number;
  names: HonorificNames;
  userMessage: string;
  newAssistantMessage: string;
  previousAssistantMessage: string;
  route: Route;
  turnTrace?: import("@/lib/geminiRequestTrace").GeminiTurnTrace;
}): Promise<MemoryMeta> {
  if (!isMemoryFeatureEnabled()) return loadChatRelationshipMeta(opts.chatId);
  const names = opts.names;
  const prev = loadChatRelationshipMeta(opts.chatId);
  const prevNormalized = normalizeMemoryMeta(prev, names);
  const delta = await extractRelationshipMetaAfterRegenerate(
    opts.userMessage,
    opts.newAssistantMessage,
    opts.previousAssistantMessage,
    names.charName,
    names.userName,
    opts.route,
    prevNormalized,
    opts.turnTrace
  );
  if (!hasRelationshipDelta(delta)) {
    if (JSON.stringify(prev) !== JSON.stringify(prevNormalized)) {
      saveChatRelationshipMeta(opts.chatId, prevNormalized);
    }
    return prevNormalized;
  }

  const merged = mergeMemoryMeta(prevNormalized, delta, names);
  saveChatRelationshipMeta(opts.chatId, merged);
  return merged;
}
