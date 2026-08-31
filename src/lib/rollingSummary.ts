import {
  catchUpRollingSummaries,
  scheduleCharacterRollingSummary,
} from "@/lib/memory/memory-rolling-summary";
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
