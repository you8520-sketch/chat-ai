import type Database from "better-sqlite3";
import { resolveTrpgCanonicalAttempt } from "./canonicalAttempt";
import { clipTrpgChars, loadCampaignLedger, type TrpgCampaignLedger } from "./campaignLedger";
import { loadSheetSnapshots } from "./engineSheets";
import {
  buildHorizonPromptSections,
  loadMemoryEvents,
  logTrpgMemoryUsage,
  TRPG_MEMORY_EVENT_FACT_MAX_CHARS,
  TRPG_MEMORY_EVENTS_PER_SEAL,
  type TrpgMemoryQuery,
} from "./memoryHorizon";
import {
  TRPG_BOT_CONTINUITY_MAX_CHARS,
  TRPG_BOT_CONTINUITY_SCENE_CHARS,
  TRPG_BOT_RECENT_ROUNDS,
  TRPG_RECENT_ROUND_RAW,
  TRPG_SEAL_SUMMARY_MAX_CHARS,
  TRPG_SEALED_PROMPT_MAX_CHARS,
} from "./types";

export type TrpgMemoryRound = {
  roundNumber: number;
  actions: Array<{ actorName: string; text: string }>;
  gmNarration: string;
};

export type TrpgStructuredCampaignMemory = {
  roundNumber: number;
  location: string;
  nextRoundContext: string;
  sheets: Array<{
    name: string;
    hp: number;
    maxHp: number;
    conditions: string[];
    inventory: string[];
    stats?: Record<string, number>;
  }>;
  quests: string[];
  npcs: string[];
  worldFlags: string[];
};

/**
 * Rounds that have fallen out of the raw window and are not sealed yet.
 * Facts live in the campaign ledger; this is only episodic recap.
 */
export function roundsDueForSeal(
  completedRoundNumbers: number[],
  sealedThrough: number,
  keepRaw = TRPG_RECENT_ROUND_RAW
): number[] {
  const completed = [...new Set(completedRoundNumbers)].sort((a, b) => a - b);
  if (completed.length <= keepRaw) return [];
  const keep = new Set(completed.slice(-keepRaw));
  return completed.filter((n) => n > sealedThrough && !keep.has(n));
}

export function selectRawRecentRounds(
  rounds: TrpgMemoryRound[],
  keep = TRPG_RECENT_ROUND_RAW
): TrpgMemoryRound[] {
  return rounds.slice(-keep);
}

export function fallbackSealSummary(rounds: TrpgMemoryRound[], maxChars = TRPG_SEAL_SUMMARY_MAX_CHARS): string {
  const parts = rounds.map((r) => {
    const acts = r.actions.map((a) => `${a.actorName}:${a.text}`).join(" · ") || "(행동 없음)";
    return `R${r.roundNumber} ${acts} → ${clipTrpgChars(r.gmNarration, 160)}`;
  });
  return clipTrpgChars(parts.join(" / "), maxChars);
}

export const TRPG_SEAL_SYSTEM = `You compress completed Korean TRPG rounds into durable campaign memory.

Return JSON only. No markdown. No secrets. No GM notes. No hidden clues. No ending candidates.
{
  "summary": "음슴체 fact recap. cause → action → result. Korean. ${TRPG_SEAL_SUMMARY_MAX_CHARS} characters max.",
  "events": [
    {
      "type": "promise",
      "fact": "한 줄 사실. ${TRPG_MEMORY_EVENT_FACT_MAX_CHARS} characters max.",
      "actors": ["이름"],
      "entities": ["장소나 물건"],
      "keywords": ["핵심어"],
      "importance": "normal|important|critical",
      "scope": "party_observed|actor_only|public_world",
      "round": 4
    }
  ]
}

summary: keep promises, quests, NPC standing, items gained/lost and who holds them, injuries, location, unresolved goal. Delete sensory padding, repetition, and dice numbers.
events: at most ${TRPG_MEMORY_EVENTS_PER_SEAL}. Only durable facts the table actually saw or a named actor privately experienced.
type must be one of: relationship, promise, betrayal, reveal, death, injury, item, quest, npc, faction, location, clue, decision, conflict, world_event, other.
critical: death, betrayal, binding promise, identity reveal, unique item gain/loss, faction join/betrayal, major quest decision, permanent injury, campaign-turning event.
scope: party_observed if the party saw or heard it; actor_only for a private inner experience; public_world for an openly known world fact.
Do not invent hidden GM secrets.`;

export function buildTrpgSealUserBlock(rounds: TrpgMemoryRound[]): string {
  const body = rounds
    .map((r) => {
      const acts = r.actions.map((a) => `- ${a.actorName}: ${a.text}`).join("\n") || "(없음)";
      return `[ROUND ${r.roundNumber}]\n[ACTIONS]\n${acts}\n[GM]\n${r.gmNarration}`;
    })
    .join("\n\n");
  return `[SEAL THESE ROUNDS — JSON {summary, events}. summary ≤${TRPG_SEAL_SUMMARY_MAX_CHARS} chars. events ≤${TRPG_MEMORY_EVENTS_PER_SEAL}.]\n\n${body}`;
}

export function buildTrpgMemoryPromptBlock(opts: {
  structured: TrpgStructuredCampaignMemory;
  sealedSummary: string;
  recentRounds: TrpgMemoryRound[];
  campaignAnchors?: string;
  relevantPastEvents?: string;
  arcMemory?: string;
}): string {
  const sheets = opts.structured.sheets
    .map((s) => {
      const cond = s.conditions.length ? ` (${s.conditions.join(", ")})` : "";
      const inv = s.inventory.length ? ` items=${s.inventory.join(", ")}` : "";
      const stats = s.stats
        ? ` stats=${Object.entries(s.stats)
            .map(([k, v]) => `${k}:${v}`)
            .join(",")}`
        : "";
      return `- ${s.name}: HP ${s.hp}/${s.maxHp}${cond}${inv}${stats}`;
    })
    .join("\n");
  const recent = opts.recentRounds
    .map((r) => {
      const acts = r.actions.map((a) => `  ${a.actorName}: ${a.text}`).join("\n") || "  (행동 없음)";
      return `[ROUND ${r.roundNumber}]\n${acts}\n  GM: ${r.gmNarration}`;
    })
    .join("\n\n");
  const sealed = clipTrpgChars(opts.sealedSummary.trim(), TRPG_SEALED_PROMPT_MAX_CHARS);
  return [
    "[TRPG STRUCTURED STATE — authoritative; do not contradict HP/items/location/flags]",
    `round=${opts.structured.roundNumber}`,
    `location=${opts.structured.location || "—"}`,
    opts.structured.nextRoundContext.trim()
      ? `[NEXT DECISION]\n${opts.structured.nextRoundContext.trim()}`
      : "",
    sheets,
    opts.structured.quests.length ? `quests: ${opts.structured.quests.join("; ")}` : "",
    opts.structured.npcs.length ? `npcs: ${opts.structured.npcs.join("; ")}` : "",
    opts.structured.worldFlags.length ? `flags: ${opts.structured.worldFlags.join("; ")}` : "",
    sealed ? `[SEALED CAMPAIGN SUMMARY]\n${sealed}` : "",
    recent ? `[RECENT ROUNDS — RAW]\n${recent}` : "",
    opts.campaignAnchors?.trim() ? `[CAMPAIGN ANCHORS]\n${opts.campaignAnchors.trim()}` : "",
    opts.relevantPastEvents?.trim() ? `[RELEVANT PAST EVENTS]\n${opts.relevantPastEvents.trim()}` : "",
    opts.arcMemory?.trim() ? `[ARC MEMORY]\n${opts.arcMemory.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function clipKeepLines(text: string, max: number): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  const chars = Array.from(normalized);
  if (chars.length <= max) return chars.join("");
  return chars.slice(0, max).join("").trimEnd();
}

function compactActionLine(actorName: string, text: string): string {
  return `- ${actorName}: ${text}`;
}

function compactSceneResult(narration: string): string {
  const trimmed = narration.replace(/\s+/g, " ").trim();
  if (!trimmed) return "";
  const chars = Array.from(trimmed);
  if (chars.length <= TRPG_BOT_CONTINUITY_SCENE_CHARS) return trimmed;
  const head = Math.floor(TRPG_BOT_CONTINUITY_SCENE_CHARS * 0.55);
  const tail = TRPG_BOT_CONTINUITY_SCENE_CHARS - head - 1;
  return `${chars.slice(0, head).join("")}…${chars.slice(-tail).join("")}`;
}

/**
 * Bot-only lookback for the rounds before the current previous scene.
 * Latest completed narration stays in [PREVIOUS GM SCENE]; this block is compact.
 */
export function buildTrpgBotRecentContinuity(completed: TrpgMemoryRound[]): string {
  if (completed.length <= 1) return "";
  const prior = completed.slice(0, -1).slice(-(TRPG_BOT_RECENT_ROUNDS - 1));
  const body = prior
    .map((round) => {
      const acts = round.actions.map((a) => compactActionLine(a.actorName, a.text)).join("\n") || "- (행동 없음)";
      const result = compactSceneResult(round.gmNarration);
      return [`ROUND ${round.roundNumber}`, acts, result ? `결과: ${result}` : ""].filter(Boolean).join("\n");
    })
    .join("\n\n");
  return clipKeepLines(body, TRPG_BOT_CONTINUITY_MAX_CHARS);
}

export function buildTrpgBotMemoryBlock(opts: {
  ledger: TrpgCampaignLedger;
  sheets: Array<{ name: string; hp: number; maxHp: number; conditions: string[] }>;
}): string {
  const sheets = opts.sheets
    .map((s) => {
      const cond = s.conditions.length ? ` (${s.conditions.join(", ")})` : "";
      return `- ${s.name}: HP ${s.hp}/${s.maxHp}${cond}`;
    })
    .join("\n");
  return [
    "[CAMPAIGN STATE — do not contradict; you are a PC, not the GM]",
    `location=${opts.ledger.location || "—"}`,
    opts.ledger.nextRoundContext.trim() ? `[NEXT DECISION]\n${opts.ledger.nextRoundContext.trim()}` : "",
    sheets,
    opts.ledger.quests.length ? `quests: ${opts.ledger.quests.join("; ")}` : "",
    opts.ledger.npcs.length ? `npcs: ${opts.ledger.npcs.join("; ")}` : "",
    opts.ledger.worldFlags.length ? `flags: ${opts.ledger.worldFlags.join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function loadCompletedMemoryRounds(db: Database.Database, campaignId: number): TrpgMemoryRound[] {
  const roundRows = db
    .prepare(
      `SELECT r.id, r.round_number, g.narration
       FROM trpg_rounds r
       JOIN trpg_gm_messages g ON g.round_id = r.id
       WHERE r.campaign_id=? AND r.phase='ROUND_COMPLETE'
       ORDER BY r.round_number ASC`
    )
    .all(campaignId) as Array<{ id: number; round_number: number; narration: string }>;
  return roundRows.map((row) => {
    const actions = db
      .prepare(
        `SELECT p.display_name AS name, p.kind, s.body
         FROM trpg_action_submissions s
         JOIN trpg_participants p ON p.id = s.participant_id
         WHERE s.round_id=? AND s.locked=1
         ORDER BY s.id ASC`
      )
      .all(row.id) as Array<{ name: string; kind: string; body: string }>;
    return {
      roundNumber: row.round_number,
      actions: actions.map((a) => ({
        actorName: a.name,
        text: resolveTrpgCanonicalAttempt({
          participantKind: a.kind === "ai_character" ? "ai_character" : "human",
          submissionBody: a.body,
        }).canonicalAttempt,
      })),
      gmNarration: row.narration,
    };
  });
}

export function loadSealedSummaries(db: Database.Database, campaignId: number): string {
  const rows = db
    .prepare(
      `SELECT summary FROM trpg_round_summaries WHERE campaign_id=? ORDER BY round_start ASC`
    )
    .all(campaignId) as Array<{ summary: string }>;
  if (rows.length > 0) {
    return rows.map((r) => r.summary.trim()).filter(Boolean).join("\n");
  }
  const mem = db
    .prepare(`SELECT recent_summary FROM trpg_campaign_memories WHERE campaign_id=?`)
    .get(campaignId) as { recent_summary: string } | undefined;
  return mem?.recent_summary ?? "";
}

export function loadSealedThrough(db: Database.Database, campaignId: number): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(round_end), -1) AS n FROM trpg_round_summaries WHERE campaign_id=?`)
    .get(campaignId) as { n: number };
  if (row.n >= 0) return row.n;
  const mem = db
    .prepare(`SELECT sealed_round_count FROM trpg_campaign_memories WHERE campaign_id=?`)
    .get(campaignId) as { sealed_round_count: number } | undefined;
  return (mem?.sealed_round_count ?? 0) - 1;
}

export function persistRoundSummary(
  db: Database.Database,
  campaignId: number,
  roundStart: number,
  roundEnd: number,
  summary: string
): void {
  const text = clipTrpgChars(summary, TRPG_SEAL_SUMMARY_MAX_CHARS);
  if (!text) return;
  db.prepare(
    `INSERT INTO trpg_round_summaries (campaign_id, round_start, round_end, summary)
     VALUES (?,?,?,?)
     ON CONFLICT(campaign_id, round_start) DO UPDATE SET round_end=excluded.round_end, summary=excluded.summary`
  ).run(campaignId, roundStart, roundEnd, text);
  const sealed = loadSealedSummaries(db, campaignId);
  db.prepare(
    `UPDATE trpg_campaign_memories
     SET recent_summary=?, sealed_round_count=?, updated_at=datetime('now')
     WHERE campaign_id=?`
  ).run(clipTrpgChars(sealed, TRPG_SEALED_PROMPT_MAX_CHARS), roundEnd + 1, campaignId);
}

export function buildCampaignMemoryQuery(
  db: Database.Database,
  campaignId: number,
  extra?: Partial<TrpgMemoryQuery>
): TrpgMemoryQuery {
  const ledger = loadCampaignLedger(db, campaignId);
  const state = db
    .prepare(`SELECT round_number FROM trpg_campaign_state WHERE campaign_id=?`)
    .get(campaignId) as { round_number: number } | undefined;
  const sheets = loadSheetSnapshots(db, campaignId);
  return {
    names: extra?.names ?? sheets.map((sheet) => sheet.name),
    actionText: extra?.actionText ?? "",
    location: extra?.location ?? ledger.location,
    quests: extra?.quests ?? ledger.quests,
    npcs: extra?.npcs ?? ledger.npcs,
    inventory: extra?.inventory ?? sheets.flatMap((sheet) => sheet.inventory),
    worldFlags: extra?.worldFlags ?? ledger.worldFlags,
    sceneText: extra?.sceneText ?? "",
    currentRound: extra?.currentRound ?? state?.round_number ?? 0,
    viewerName: extra?.viewerName,
    viewerKind: extra?.viewerKind ?? "gm",
  };
}

export function buildCampaignMemoryPrompt(
  db: Database.Database,
  campaignId: number,
  extra?: Partial<TrpgMemoryQuery>
): string {
  const ledger = loadCampaignLedger(db, campaignId);
  const state = db
    .prepare(`SELECT round_number FROM trpg_campaign_state WHERE campaign_id=?`)
    .get(campaignId) as { round_number: number } | undefined;
  const sheets = loadSheetSnapshots(db, campaignId).map((s) => ({
    name: s.name,
    hp: s.hp,
    maxHp: s.maxHp,
    conditions: s.conditions,
    inventory: s.inventory,
    stats: s.stats,
  }));
  const completed = loadCompletedMemoryRounds(db, campaignId);
  const query = buildCampaignMemoryQuery(db, campaignId, extra);
  const events = loadMemoryEvents(db, campaignId);
  const horizon = buildHorizonPromptSections({ events, query });
  if (events.length > 0 || horizon.relevantCount > 0 || horizon.anchorsCount > 0) {
    logTrpgMemoryUsage({
      campaignId,
      round: query.currentRound,
      memoryEventsTotal: events.length,
      anchorsInjected: horizon.anchorsCount,
      historicalRecalled: horizon.relevantCount,
      historicalRecalledChars: horizon.relevantChars,
      botRecalled: 0,
    });
  }
  return buildTrpgMemoryPromptBlock({
    structured: {
      roundNumber: state?.round_number ?? 0,
      location: ledger.location,
      nextRoundContext: ledger.nextRoundContext,
      sheets,
      quests: ledger.quests,
      npcs: ledger.npcs,
      worldFlags: ledger.worldFlags,
    },
    sealedSummary: loadSealedSummaries(db, campaignId),
    recentRounds: selectRawRecentRounds(completed),
    campaignAnchors: horizon.anchors,
    relevantPastEvents: horizon.relevant,
    arcMemory: horizon.arc,
  });
}
