import {
  appendLongTermMemory,
  type DialogueTurn,
  nextBatchRange,
} from "@/lib/hybridMemory";
import { summarizeTurnBatch, compressLongTermWithFlash } from "@/lib/ai";

export type HybridMemoryResult = {
  longTermMemory: string;
  archivedTurnCount: number;
  batchesProcessed: number;
};

/**
 * 하이브리드 장기 기억 처리
 * - 최근 10턴 원본 유지, 11턴째부터 윈도 밖 턴을 배치 요약 (최대 10턴 단위)
 * - longTermMemory 누적 · 한도 초과 시 Flash 강제 압축
 */
export async function processHybridMemory(opts: {
  turns: DialogueTurn[];
  charName: string;
  prevLongTerm: string;
  archivedTurnCount: number;
  maxChars: number;
}): Promise<HybridMemoryResult> {
  let memory = opts.prevLongTerm.trim();
  let archived = opts.archivedTurnCount;
  let batchesProcessed = 0;

  while (true) {
    const range = nextBatchRange(opts.turns.length, archived);
    if (!range) break;

    if (memory.length > opts.maxChars) {
      memory = await compressLongTermWithFlash(memory, opts.maxChars);
    }

    const batch = opts.turns.slice(range.start, range.end);
    const summary = await summarizeTurnBatch(batch, opts.charName, range.start + 1, range.end);
    const block = `- [${range.start + 1}~${range.end}턴] ${summary}`;

    const candidate = appendLongTermMemory(memory, block);
    if (candidate.length > opts.maxChars) {
      memory = await compressLongTermWithFlash(candidate, opts.maxChars);
    } else {
      memory = candidate;
    }

    if (memory.length > opts.maxChars) {
      memory = await compressLongTermWithFlash(memory, opts.maxChars);
    }

    archived = range.end;
    batchesProcessed += 1;
  }

  return {
    longTermMemory: memory,
    archivedTurnCount: archived,
    batchesProcessed,
  };
}
