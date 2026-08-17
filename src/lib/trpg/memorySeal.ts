import { callBackgroundMemory } from "@/lib/ai";
import { isMockApiMode } from "@/lib/mockApiMode";
import type Database from "better-sqlite3";
import {
  buildTrpgSealUserBlock,
  fallbackSealSummary,
  loadCompletedMemoryRounds,
  loadSealedThrough,
  persistRoundSummary,
  roundsDueForSeal,
  TRPG_SEAL_SYSTEM,
  type TrpgMemoryRound,
} from "./memory";
import { clipTrpgChars } from "./campaignLedger";
import {
  logTrpgMemoryUsage,
  persistMemoryEvents,
  parseTrpgSealMemory,
  type TrpgMemoryEventDraft,
} from "./memoryHorizon";
import { TRPG_SEAL_SUMMARY_MAX_CHARS } from "./types";

export type TrpgMemoryCall = (system: string, user: string) => Promise<{ text: string }>;

async function defaultMemoryCall(system: string, user: string): Promise<{ text: string }> {
  if (isMockApiMode()) {
    return { text: "" };
  }
  const { text } = await callBackgroundMemory(
    system,
    [{ role: "user", content: user }],
    undefined,
    "background-memory-extract",
    { maxTokens: 1536, temperature: 0.2 }
  );
  return { text };
}

export async function sealDroppedTrpgRounds(
  db: Database.Database,
  campaignId: number,
  memoryCall?: TrpgMemoryCall
): Promise<void> {
  const completed = loadCompletedMemoryRounds(db, campaignId);
  const dueNumbers = roundsDueForSeal(
    completed.map((r) => r.roundNumber),
    loadSealedThrough(db, campaignId)
  );
  if (dueNumbers.length === 0) return;
  const dueSet = new Set(dueNumbers);
  const due = completed.filter((r) => dueSet.has(r.roundNumber));
  const sealed = await summarizeRounds(due, memoryCall ?? defaultMemoryCall);
  persistRoundSummary(
    db,
    campaignId,
    due[0]!.roundNumber,
    due[due.length - 1]!.roundNumber,
    sealed.summary
  );
  persistMemoryEvents(db, {
    campaignId,
    roundStart: due[0]!.roundNumber,
    roundEnd: due[due.length - 1]!.roundNumber,
    events: sealed.events,
  });
  logTrpgMemoryUsage({
    campaignId,
    round: due[due.length - 1]!.roundNumber,
    memoryEventsTotal: sealed.events.length,
    anchorsInjected: 0,
    historicalRecalled: 0,
    historicalRecalledChars: 0,
    botRecalled: 0,
    sealSuccess: !sealed.fallback,
    sealFallback: sealed.fallback,
  });
}

async function summarizeRounds(
  rounds: TrpgMemoryRound[],
  memoryCall: TrpgMemoryCall
): Promise<{ summary: string; events: TrpgMemoryEventDraft[]; fallback: boolean }> {
  const fallback = fallbackSealSummary(rounds);
  try {
    const { text } = await memoryCall(TRPG_SEAL_SYSTEM, buildTrpgSealUserBlock(rounds));
    const parsed = parseTrpgSealMemory(text);
    if (!parsed.parsedJson) {
      const clipped = clipTrpgChars(text, TRPG_SEAL_SUMMARY_MAX_CHARS);
      return { summary: clipped || fallback, events: [], fallback: !clipped };
    }
    return {
      summary: clipTrpgChars(parsed.summary, TRPG_SEAL_SUMMARY_MAX_CHARS) || fallback,
      events: parsed.events,
      fallback: false,
    };
  } catch {
    return { summary: fallback, events: [], fallback: true };
  }
}
