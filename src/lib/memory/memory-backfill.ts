import { ROLLING_SUMMARY_INTERVAL, countPlayableTurns } from "@/lib/hybridMemory";
import {
  catchUpRollingSummaries,
  loadTurnsForChat,
  scheduleCharacterRollingSummary,
  shouldTriggerRollingSummary,
} from "./memory-rolling-summary";
import {
  clearBuffer,
  getBufferCount,
  getOrCreateChatMemory,
  updateChatMemory,
} from "./memory-db";
import { ensureLorebookWithinBudget } from "./memory-lorebook-fit";
import { resolveLorebookFromRecords } from "./memory-lorebook-resolve";
import { resolveMemoryBudgetFromCapacity } from "./memory-capacity-shared";
import { isMemoryFeatureEnabled } from "./memory-feature";
import type { MemoryTier } from "./memory-types";

/**
 * 장기기억 도입 전 대화를 message_count / summarized_turn_count에 1회 동기화.
 * 이 채팅방 메시지만 사용한다.
 */
export function syncMemoryFromChat(opts: {
  userId: number;
  characterId: number;
  chatId: number;
  charName: string;
  tier: MemoryTier;
  memoryCapacity: number;
}): boolean {
  if (!isMemoryFeatureEnabled()) return false;
  const memory = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);

  if (memory.message_count > 0) {
    return false;
  }

  const turns = loadTurnsForChat(opts.chatId);
  if (turns.length === 0) return false;

  const playableCount = countPlayableTurns(turns);

  const bufferCount = getBufferCount(opts.chatId);
  if (bufferCount > 0) {
    clearBuffer(opts.chatId);
  }

  const hasLegacySummary = Boolean(memory.recent_summary.trim() || memory.last_compressed_at);
  const summarizedTurnCount = hasLegacySummary
    ? Math.floor(playableCount / ROLLING_SUMMARY_INTERVAL) * ROLLING_SUMMARY_INTERVAL
    : 0;

  updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
    message_count: playableCount,
    summarized_turn_count: summarizedTurnCount,
    membership_tier: opts.tier,
  });

  console.info(
    `[memory] synced counts chat=${opts.chatId} playable=${playableCount} summarized=${summarizedTurnCount}`
  );

  if (
    playableCount >= ROLLING_SUMMARY_INTERVAL &&
    shouldTriggerRollingSummary(playableCount, summarizedTurnCount)
  ) {
    scheduleCharacterRollingSummary({
      chatId: opts.chatId,
      userId: opts.userId,
      characterId: opts.characterId,
      charName: opts.charName,
      tier: opts.tier,
      memoryCapacity: opts.memoryCapacity,
    });
  }

  return true;
}

export type MemoryBackfillOpts = {
  userId: number;
  characterId: number;
  chatId: number;
  charName: string;
  tier: MemoryTier;
  memoryCapacity: number;
};

/** GET 패널용 — 카운트만 동기화 (LLM 호출 없음, 즉시 반환) */
export function prepareMemoryPanelView(opts: MemoryBackfillOpts): void {
  if (!isMemoryFeatureEnabled()) return;
  syncMemoryFromChat(opts);
}

/** 밀린 5턴 요약·로어북 AI 압축 — UI/채팅 응답을 막지 않도록 백그라운드 실행 */
export function scheduleMemoryPanelBackfill(opts: MemoryBackfillOpts): void {
  if (!isMemoryFeatureEnabled()) return;
  void syncAndCompressMemoryFromChat(opts).catch((e) => {
    console.warn("[memory] panel backfill failed:", (e as Error).message);
  });
}

/** GET 패널용 — 카운트 동기화 + 밀린 5턴 히스토리 백필 + 용량 초과 시 Flash 압축 */
export async function syncAndCompressMemoryFromChat(opts: MemoryBackfillOpts): Promise<boolean> {
  if (!isMemoryFeatureEnabled()) {
    return false;
  }

  const backfilled = syncMemoryFromChat(opts);
  const processed = await catchUpRollingSummaries({ ...opts, maxRounds: 5 });

  const memory = getOrCreateChatMemory(opts.chatId, opts.userId, opts.characterId, opts.tier);
  const budget = resolveMemoryBudgetFromCapacity(opts.memoryCapacity).lorebook;
  const resolved = await resolveLorebookFromRecords(opts.chatId, budget);
  const stored = memory.recent_summary?.trim() ?? "";
  let lorebookUpdated = false;

  if (resolved.text && resolved.text !== stored) {
    updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
      recent_summary: resolved.text,
      last_compressed_at: resolved.compressed ? new Date().toISOString() : undefined,
      membership_tier: opts.tier,
    });
    lorebookUpdated = true;
  } else if (!resolved.text && stored.length > budget) {
    const { text: fitted, compressed } = await ensureLorebookWithinBudget(stored, budget);
    if (compressed && fitted !== stored) {
      updateChatMemory(opts.chatId, opts.userId, opts.characterId, {
        recent_summary: fitted,
        last_compressed_at: new Date().toISOString(),
        membership_tier: opts.tier,
      });
      lorebookUpdated = true;
    }
  }

  return backfilled || processed > 0 || lorebookUpdated;
}
