import type { Route } from "@/lib/ai";
import {
  analyzeTurnMemory,
  compressLongTermMemory,
  mergeTurnSummariesToLongTerm,
} from "@/lib/ai";
import {
  TURNS_PER_LONG_MERGE,
  demoTurnSummary,
  mergeMemoryMeta,
  parseMemoryMeta,
  parsePendingTurns,
  type MemoryMeta,
} from "@/lib/chatMemory";

export type ProcessTurnMemoryResult = {
  memory: string;
  memoryPending: string;
  memoryMeta: MemoryMeta;
};

/** 매 턴: 150자 요약 · 5턴마다 장기 기억 병합 · 한도 초과 시 압축 */
export async function processTurnMemory(opts: {
  userMessage: string;
  assistantMessage: string;
  charName: string;
  route: Route;
  maxChars: number;
  prevMemory: string;
  prevPendingRaw: string;
  prevMetaRaw: string;
  assistantTurnCount: number;
}): Promise<ProcessTurnMemoryResult> {
  let meta = parseMemoryMeta(opts.prevMetaRaw);
  let pending = parsePendingTurns(opts.prevPendingRaw);
  let memory = opts.prevMemory;

  let analysis;
  try {
    analysis = await analyzeTurnMemory(
      opts.userMessage,
      opts.assistantMessage,
      opts.charName,
      opts.route
    );
  } catch {
    analysis = {
      turnSummary: demoTurnSummary(opts.userMessage, opts.assistantMessage, opts.charName),
      meta: {},
    };
  }

  if (analysis.turnSummary) {
    pending = [...pending, analysis.turnSummary];
  }
  meta = mergeMemoryMeta(meta, analysis.meta);

  if (opts.assistantTurnCount > 0 && opts.assistantTurnCount % TURNS_PER_LONG_MERGE === 0) {
    memory = await mergeTurnSummariesToLongTerm(memory, pending, opts.maxChars, opts.route);
    pending = [];
  }

  if (memory.length > opts.maxChars) {
    memory = await compressLongTermMemory(memory, opts.maxChars, opts.route);
  }

  return {
    memory,
    memoryPending: JSON.stringify(pending),
    memoryMeta: meta,
  };
}
