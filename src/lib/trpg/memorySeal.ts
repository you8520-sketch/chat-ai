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
    { maxTokens: 768, temperature: 0.2 }
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
  const summary = await summarizeRounds(due, memoryCall ?? defaultMemoryCall);
  persistRoundSummary(
    db,
    campaignId,
    due[0]!.roundNumber,
    due[due.length - 1]!.roundNumber,
    summary
  );
}

async function summarizeRounds(rounds: TrpgMemoryRound[], memoryCall: TrpgMemoryCall): Promise<string> {
  const fallback = fallbackSealSummary(rounds);
  try {
    const { text } = await memoryCall(TRPG_SEAL_SYSTEM, buildTrpgSealUserBlock(rounds));
    const clipped = clipTrpgChars(text, TRPG_SEAL_SUMMARY_MAX_CHARS);
    return clipped || fallback;
  } catch {
    return fallback;
  }
}
