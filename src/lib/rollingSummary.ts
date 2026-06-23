import {
  catchUpRollingSummaries,
  scheduleCharacterRollingSummary,
} from "@/lib/memory/memory-rolling-summary";
import { getOrCreateChatMemory } from "@/lib/memory/memory-db";
import type { MemoryTier } from "@/lib/memory/memory-types";

/** @deprecated memory-rolling-summary + chat_memories 사용 */
export function scheduleRollingSummaryUpdate(chatId: number, _charName: string): void {
  void chatId;
}

/** @deprecated syncAndCompressMemoryFromChat / catchUpRollingSummaries 사용 */
export async function updateChatSummary(_opts: {
  chatId: number;
  charName: string;
}): Promise<boolean> {
  return false;
}

export function scheduleCharacterMemoryRollingSummary(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  tier: MemoryTier;
  memoryCapacity: number;
}): void {
  scheduleCharacterRollingSummary(opts);
}

export async function catchUpCharacterMemorySummaries(opts: {
  chatId: number;
  userId: number;
  characterId: number;
  charName: string;
  tier: MemoryTier;
  memoryCapacity: number;
}): Promise<number> {
  return catchUpRollingSummaries({ ...opts, maxRounds: 5 });
}

/** tiered memory recent_summary + 레거시 chats.current_summary 폴백 (채팅방 단위) */
export function resolveLongTermMemory(
  chat: { id: number; current_summary?: string | null; memory?: string | null },
  userId?: number,
  characterId?: number,
  tier?: MemoryTier
): string {
  if (userId != null && characterId != null && tier) {
    const memory = getOrCreateChatMemory(chat.id, userId, characterId, tier);
    if (memory.recent_summary.trim()) return memory.recent_summary.trim();
  }

  const summary = chat.current_summary?.trim();
  if (summary) return summary;

  return chat.memory?.trim() ?? "";
}
