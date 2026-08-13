import { TRPG_MEMORY_SEAL_ROUNDS, TRPG_RECENT_ROUND_RAW } from "./types";

export type TrpgMemoryRound = {
  roundNumber: number;
  actions: Array<{ actorName: string; text: string }>;
  gmNarration: string;
};

export type TrpgStructuredCampaignMemory = {
  roundNumber: number;
  location: string;
  sheets: Array<{ name: string; hp: number; maxHp: number; conditions: string[] }>;
  quests: string[];
  npcs: string[];
  worldFlags: string[];
};

/**
 * TRPG memory is campaign-scoped, keyed by completed rounds — never chat_memories.
 * Structured campaign state is the source of truth; summaries only add prose.
 * There is no OOC channel; only locked actions + GM narration enter memory.
 */
export function shouldSealTrpgMemory(
  completedRounds: number,
  sealedRoundCount: number,
  interval = TRPG_MEMORY_SEAL_ROUNDS
): boolean {
  if (completedRounds < interval) return false;
  const due = Math.floor(completedRounds / interval) * interval;
  return due > sealedRoundCount;
}

export function selectRawRecentRounds(
  rounds: TrpgMemoryRound[],
  keep = TRPG_RECENT_ROUND_RAW
): TrpgMemoryRound[] {
  return rounds.slice(-keep);
}

export function buildTrpgMemoryPromptBlock(opts: {
  structured: TrpgStructuredCampaignMemory;
  sealedSummary: string;
  recentRounds: TrpgMemoryRound[];
}): string {
  const sheets = opts.structured.sheets
    .map((s) => `- ${s.name}: HP ${s.hp}/${s.maxHp}` + (s.conditions.length ? ` (${s.conditions.join(", ")})` : ""))
    .join("\n");
  const recent = opts.recentRounds
    .map((r) => {
      const acts = r.actions.map((a) => `  ${a.actorName}: ${a.text}`).join("\n");
      return `[ROUND ${r.roundNumber}]\n${acts}\n  GM: ${r.gmNarration}`;
    })
    .join("\n\n");
  return [
    "[TRPG STRUCTURED STATE — authoritative; do not contradict]",
    `round=${opts.structured.roundNumber}`,
    `location=${opts.structured.location || "—"}`,
    sheets,
    opts.structured.quests.length ? `quests: ${opts.structured.quests.join("; ")}` : "",
    opts.structured.npcs.length ? `npcs: ${opts.structured.npcs.join("; ")}` : "",
    opts.structured.worldFlags.length ? `flags: ${opts.structured.worldFlags.join("; ")}` : "",
    opts.sealedSummary.trim() ? `[SEALED CAMPAIGN SUMMARY]\n${opts.sealedSummary.trim()}` : "",
    recent ? `[RECENT ROUNDS — RAW]\n${recent}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
