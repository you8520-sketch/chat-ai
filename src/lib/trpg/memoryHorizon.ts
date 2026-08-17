import type Database from "better-sqlite3";
import { parseTrpgBotAction } from "./botActionParse";
import { clipTrpgChars } from "./clip";
import { loadParticipants } from "./store";

export const TRPG_MEMORY_EVENT_TYPES = [
  "relationship",
  "promise",
  "betrayal",
  "reveal",
  "death",
  "injury",
  "item",
  "quest",
  "npc",
  "faction",
  "location",
  "clue",
  "decision",
  "conflict",
  "world_event",
  "other",
] as const;
export type TrpgMemoryEventType = (typeof TRPG_MEMORY_EVENT_TYPES)[number];

export const TRPG_MEMORY_IMPORTANCE = ["normal", "important", "critical"] as const;
export type TrpgMemoryImportance = (typeof TRPG_MEMORY_IMPORTANCE)[number];

export const TRPG_MEMORY_SCOPES = ["party_observed", "actor_only", "public_world"] as const;
export type TrpgMemoryScope = (typeof TRPG_MEMORY_SCOPES)[number];

export const TRPG_MEMORY_EVENT_FACT_MAX_CHARS = 180;
export const TRPG_MEMORY_EVENTS_PER_SEAL = 8;
export const TRPG_MEMORY_ANCHOR_MAX_CHARS = 1600;
export const TRPG_MEMORY_RECALL_MAX_CHARS = 2000;
export const TRPG_MEMORY_RECALL_TOP_K = 6;
export const TRPG_MEMORY_BOT_RECALL_MAX_CHARS = 1500;
export const TRPG_MEMORY_BOT_RECALL_TOP_K = 5;
export const TRPG_MEMORY_BOT_CONTINUITY_BUDGET = 2500;
export const TRPG_MEMORY_BOT_COMPACT_ROUNDS = 4;
export const TRPG_MEMORY_BOT_COMPACT_LINE_MAX_CHARS = 220;
export const TRPG_MEMORY_CHAPTER_SIZE = 10;
export const TRPG_MEMORY_CHAPTER_MAX_CHARS = 1000;

export const TRPG_MEMORY_SCORE = {
  actorMatch: 100,
  entityMatch: 60,
  questLocationItem: 50,
  critical: 40,
  important: 15,
  keyword: 10,
  recencyMax: 5,
} as const;

export type TrpgMemoryEventDraft = {
  type: TrpgMemoryEventType;
  fact: string;
  actors: string[];
  entities: string[];
  keywords: string[];
  importance: TrpgMemoryImportance;
  scope: TrpgMemoryScope;
  round?: number;
  knownParticipantIds?: number[];
};

export type TrpgMemoryEvent = TrpgMemoryEventDraft & {
  id: number;
  campaignId: number;
  roundStart: number;
  roundEnd: number;
  fingerprint: string;
};

export type TrpgMemoryQuery = {
  names: string[];
  actionText: string;
  location: string;
  quests: string[];
  npcs: string[];
  inventory: string[];
  worldFlags: string[];
  sceneText: string;
  currentRound: number;
  viewerName?: string;
  viewerKind: "gm" | "bot";
};

export type TrpgScoredMemoryEvent = TrpgMemoryEvent & { score: number };

const TYPE_ALIASES: Record<string, TrpgMemoryEventType> = {
  relationship: "relationship",
  promise: "promise",
  betrayal: "betrayal",
  reveal: "reveal",
  death: "death",
  injury: "injury",
  item: "item",
  quest: "quest",
  npc: "npc",
  faction: "faction",
  location: "location",
  clue: "clue",
  decision: "decision",
  conflict: "conflict",
  world_event: "world_event",
  "world-event": "world_event",
  other: "other",
  관계: "relationship",
  약속: "promise",
  배신: "betrayal",
  정체: "reveal",
  공개: "reveal",
  사망: "death",
  죽음: "death",
  부상: "injury",
  아이템: "item",
  퀘스트: "quest",
  세력: "faction",
  장소: "location",
  단서: "clue",
  결정: "decision",
  갈등: "conflict",
  세계: "world_event",
};

function isMemoryEventType(value: string): value is TrpgMemoryEventType {
  return (TRPG_MEMORY_EVENT_TYPES as readonly string[]).includes(value);
}

function isMemoryImportance(value: string): value is TrpgMemoryImportance {
  return (TRPG_MEMORY_IMPORTANCE as readonly string[]).includes(value);
}

function isMemoryScope(value: string): value is TrpgMemoryScope {
  return (TRPG_MEMORY_SCOPES as readonly string[]).includes(value);
}

function coerceEventType(value: unknown): TrpgMemoryEventType | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (isMemoryEventType(trimmed)) return trimmed;
  return TYPE_ALIASES[trimmed] ?? TYPE_ALIASES[value.trim()] ?? null;
}

function coerceImportance(value: unknown): TrpgMemoryImportance {
  if (typeof value === "string" && isMemoryImportance(value.trim().toLowerCase())) {
    return value.trim().toLowerCase() as TrpgMemoryImportance;
  }
  if (value === "중요") return "important";
  if (value === "치명" || value === "결정적") return "critical";
  return "normal";
}

function coerceScope(value: unknown): TrpgMemoryScope {
  if (typeof value === "string" && isMemoryScope(value.trim().toLowerCase())) {
    return value.trim().toLowerCase() as TrpgMemoryScope;
  }
  if (value === "개인") return "actor_only";
  if (value === "세계") return "public_world";
  return "party_observed";
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function normalizeMemoryKey(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function memoryEventFingerprint(opts: {
  campaignId: number;
  type: TrpgMemoryEventType;
  actors: string[];
  fact: string;
}): string {
  const actors = [...opts.actors].map(normalizeMemoryKey).filter(Boolean).sort().join(",");
  return `${opts.campaignId}|${opts.type}|${actors}|${normalizeMemoryKey(opts.fact)}`;
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function parseTrpgSealMemory(raw: string): {
  summary: string;
  events: TrpgMemoryEventDraft[];
  parsedJson: boolean;
} {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { summary: raw.trim(), events: [], parsedJson: false };
  }
  const rec = parsed as Record<string, unknown>;
  const summary = typeof rec.summary === "string" ? rec.summary.trim() : "";
  const list = Array.isArray(rec.events) ? rec.events : [];
  const events: TrpgMemoryEventDraft[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const type = coerceEventType(row.type ?? row.kind ?? row.유형);
    const fact = clipTrpgChars(typeof row.fact === "string" ? row.fact : typeof row.사실 === "string" ? row.사실 : "", TRPG_MEMORY_EVENT_FACT_MAX_CHARS);
    if (!type || !fact) continue;
    const round = typeof row.round === "number" && Number.isFinite(row.round) ? Math.trunc(row.round) : undefined;
    events.push({
      type,
      fact,
      actors: asStringList(row.actors ?? row.인물),
      entities: asStringList(row.entities ?? row.대상),
      keywords: asStringList(row.keywords ?? row.키워드),
      importance: coerceImportance(row.importance ?? row.중요도),
      scope: coerceScope(row.scope ?? row.범위),
      round,
    });
    if (events.length >= TRPG_MEMORY_EVENTS_PER_SEAL) break;
  }
  return { summary, events, parsedJson: true };
}

export function namesOverlap(a: string, b: string): boolean {
  const left = a.trim();
  const right = b.trim();
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  if (/^[가-힣]{3,4}$/.test(left) && right === left.slice(1)) return true;
  if (/^[가-힣]{3,4}$/.test(right) && left === right.slice(1)) return true;
  return false;
}

function listHaystack(values: string[]): string {
  return values.join(" ");
}

function textContainsName(hay: string, name: string): boolean {
  const n = name.trim();
  if (!n || !hay) return false;
  if (hay.includes(n)) return true;
  if (/^[가-힣]{3,4}$/.test(n) && hay.includes(n.slice(1))) return true;
  return false;
}

export function eventVisibleToViewer(event: TrpgMemoryEventDraft, query: Pick<TrpgMemoryQuery, "viewerKind" | "viewerName">): boolean {
  if (query.viewerKind !== "bot") return true;
  if (event.scope === "party_observed" || event.scope === "public_world") return true;
  if (event.scope !== "actor_only") return true;
  const viewer = query.viewerName?.trim() ?? "";
  if (!viewer) return false;
  return event.actors.some((actor) => namesOverlap(actor, viewer));
}

export function scoreMemoryEvent(event: TrpgMemoryEvent, query: TrpgMemoryQuery): number {
  const actionHay = `${query.actionText} ${query.sceneText}`;
  const nameHit = event.actors.some(
    (actor) => query.names.some((name) => namesOverlap(actor, name)) || textContainsName(actionHay, actor)
  );
  const entityHit = event.entities.some(
    (entity) =>
      textContainsName(actionHay, entity) ||
      namesOverlap(entity, query.location) ||
      query.npcs.some((npc) => namesOverlap(entity, npc)) ||
      query.inventory.some((item) => namesOverlap(entity, item)) ||
      query.quests.some((quest) => namesOverlap(entity, quest))
  );
  const questLocationItem =
    (query.location && (textContainsName(event.fact, query.location) || event.entities.some((entity) => namesOverlap(entity, query.location)))) ||
    query.quests.some((quest) => textContainsName(event.fact, quest) || event.keywords.some((key) => namesOverlap(key, quest))) ||
    query.inventory.some((item) => textContainsName(event.fact, item) || event.entities.some((entity) => namesOverlap(entity, item)));
  const keywordHay = `${actionHay} ${query.location} ${listHaystack(query.quests)} ${listHaystack(query.npcs)} ${listHaystack(query.inventory)} ${listHaystack(query.worldFlags)}`;
  const keywordHits = event.keywords.filter((key) => key && keywordHay.includes(key)).length;
  const age = Math.max(0, query.currentRound - event.roundEnd);
  const recency = TRPG_MEMORY_SCORE.recencyMax * (1 - Math.min(age, 100) / 100);
  let importance = 0;
  switch (event.importance) {
    case "critical":
      importance = TRPG_MEMORY_SCORE.critical;
      break;
    case "important":
      importance = TRPG_MEMORY_SCORE.important;
      break;
    case "normal":
      importance = 0;
      break;
    default: {
      const _exhaustive: never = event.importance;
      return _exhaustive;
    }
  }
  return (
    (nameHit ? TRPG_MEMORY_SCORE.actorMatch : 0) +
    (entityHit ? TRPG_MEMORY_SCORE.entityMatch : 0) +
    (questLocationItem ? TRPG_MEMORY_SCORE.questLocationItem : 0) +
    importance +
    Math.min(keywordHits, 4) * TRPG_MEMORY_SCORE.keyword +
    recency
  );
}

export function selectHistoricalRecall(
  events: TrpgMemoryEvent[],
  query: TrpgMemoryQuery,
  opts?: { topK?: number; minScore?: number }
): TrpgScoredMemoryEvent[] {
  const topK = opts?.topK ?? TRPG_MEMORY_RECALL_TOP_K;
  const minScore = opts?.minScore ?? 1;
  return events
    .filter((event) => eventVisibleToViewer(event, query))
    .map((event) => ({ ...event, score: scoreMemoryEvent(event, query) }))
    .filter((event) => event.score >= minScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.importance !== a.importance) {
        const rank = { critical: 2, important: 1, normal: 0 };
        return rank[b.importance] - rank[a.importance];
      }
      return a.roundEnd - b.roundEnd;
    })
    .slice(0, topK);
}

export function selectCampaignAnchors(events: TrpgMemoryEvent[], query: TrpgMemoryQuery): TrpgScoredMemoryEvent[] {
  const related = events.filter((event) => {
    if (event.importance === "normal") return false;
    if (!eventVisibleToViewer(event, query)) return false;
    const score = scoreMemoryEvent(event, query);
    return score >= TRPG_MEMORY_SCORE.entityMatch;
  });
  return selectHistoricalRecall(related, query, { topK: 6, minScore: TRPG_MEMORY_SCORE.important });
}

function formatEventLine(event: TrpgMemoryEvent): string {
  const round = event.round ?? event.roundEnd;
  return `- R${round}: ${event.fact}`;
}

export function formatMemoryLines(events: TrpgMemoryEvent[], maxChars: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const event of events) {
    const line = formatEventLine(event);
    const next = used + Array.from(line).length + (lines.length ? 1 : 0);
    if (next > maxChars) break;
    lines.push(line);
    used = next;
  }
  return lines.join("\n");
}

export function chapterRangeForRound(round: number): { start: number; end: number; label: string } {
  if (round <= 10) return { start: 0, end: 10, label: "R0–10" };
  const start = Math.floor((round - 1) / 10) * 10 + 1;
  const end = start + 9;
  return { start, end, label: `R${start}–${end}` };
}

export function buildArcMemoryBlock(events: TrpgMemoryEvent[], recalled: TrpgMemoryEvent[], currentRound: number): string {
  const current = chapterRangeForRound(currentRound);
  const wanted = new Map<string, { start: number; end: number; label: string }>();
  for (const event of recalled) {
    const chapter = chapterRangeForRound(event.round ?? event.roundEnd);
    if (chapter.label === current.label) continue;
    wanted.set(chapter.label, chapter);
  }
  const blocks: string[] = [];
  for (const chapter of wanted.values()) {
    const facts = events
      .filter((event) => {
        const at = event.round ?? event.roundEnd;
        return at >= chapter.start && at <= chapter.end && event.importance !== "normal";
      })
      .map((event) => formatEventLine(event));
    if (facts.length === 0) continue;
    const body = clipTrpgChars(`${chapter.label}\n${facts.join(" ")}`, TRPG_MEMORY_CHAPTER_MAX_CHARS);
    if (body) blocks.push(body);
    if (blocks.length >= 2) break;
  }
  return blocks.join("\n");
}

export function persistMemoryEvents(
  db: Database.Database,
  opts: {
    campaignId: number;
    roundStart: number;
    roundEnd: number;
    events: TrpgMemoryEventDraft[];
  }
): number {
  const participants = loadParticipants(db, opts.campaignId);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO trpg_memory_events (
       campaign_id, round_start, round_end, type, fact, importance, scope,
       actors_json, entities_json, keywords_json, known_participant_ids_json, fingerprint
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  let added = 0;
  for (const event of opts.events) {
    const fact = clipTrpgChars(event.fact, TRPG_MEMORY_EVENT_FACT_MAX_CHARS);
    if (!fact) continue;
    const roundStart = event.round != null && event.round >= opts.roundStart && event.round <= opts.roundEnd ? event.round : opts.roundStart;
    const roundEnd = event.round != null && event.round >= opts.roundStart && event.round <= opts.roundEnd ? event.round : opts.roundEnd;
    const fingerprint = memoryEventFingerprint({
      campaignId: opts.campaignId,
      type: event.type,
      actors: event.actors,
      fact,
    });
    const known = participants
      .filter((p) => event.actors.some((actor) => namesOverlap(actor, p.display_name)))
      .map((p) => p.id);
    const result = insert.run(
      opts.campaignId,
      roundStart,
      roundEnd,
      event.type,
      fact,
      event.importance,
      event.scope,
      JSON.stringify(event.actors),
      JSON.stringify(event.entities),
      JSON.stringify(event.keywords),
      JSON.stringify(event.knownParticipantIds ?? known),
      fingerprint
    );
    if (result.changes > 0) added += 1;
  }
  return added;
}

function parseJsonList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return asStringList(parsed);
  } catch {
    return [];
  }
}

function parseIdList(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  } catch {
    return [];
  }
}

export function loadMemoryEvents(db: Database.Database, campaignId: number): TrpgMemoryEvent[] {
  const rows = db
    .prepare(
      `SELECT id, campaign_id, round_start, round_end, type, fact, importance, scope,
              actors_json, entities_json, keywords_json, known_participant_ids_json, fingerprint
       FROM trpg_memory_events
       WHERE campaign_id=?
       ORDER BY round_end ASC, id ASC`
    )
    .all(campaignId) as Array<{
    id: number;
    campaign_id: number;
    round_start: number;
    round_end: number;
    type: string;
    fact: string;
    importance: string;
    scope: string;
    actors_json: string;
    entities_json: string;
    keywords_json: string;
    known_participant_ids_json: string;
    fingerprint: string;
  }>;
  return rows.flatMap((row) => {
    const type = coerceEventType(row.type);
    if (!type || !isMemoryImportance(row.importance) || !isMemoryScope(row.scope)) return [];
    return [
      {
        id: row.id,
        campaignId: row.campaign_id,
        roundStart: row.round_start,
        roundEnd: row.round_end,
        type,
        fact: row.fact,
        importance: row.importance,
        scope: row.scope,
        actors: parseJsonList(row.actors_json),
        entities: parseJsonList(row.entities_json),
        keywords: parseJsonList(row.keywords_json),
        knownParticipantIds: parseIdList(row.known_participant_ids_json),
        fingerprint: row.fingerprint,
        round: row.round_end,
      },
    ];
  });
}

export type TrpgCompactContinuityRound = {
  roundNumber: number;
  actions: Array<{ actorName: string; text: string }>;
  gmNarration: string;
};

export function buildBotCompactContinuity(
  rounds: TrpgCompactContinuityRound[],
  previousScene: string,
  budget = TRPG_MEMORY_BOT_CONTINUITY_BUDGET
): { previousScene: string; compact: string } {
  const older = rounds.slice(0, Math.max(0, rounds.length - 1)).slice(-TRPG_MEMORY_BOT_COMPACT_ROUNDS);
  const compact = older
    .map((round) => {
      const acts = round.actions
        .map((action) => {
          const parsed = parseTrpgBotAction(action.text);
          const brief = parsed.intent || clipTrpgChars(parsed.prose || action.text, 80);
          return `${action.actorName}:${brief}`;
        })
        .join(" / ");
      return `R${round.roundNumber} ${acts || "(행동 없음)"} → ${clipTrpgChars(round.gmNarration, 90)}`;
    })
    .join("\n");
  const compactClipped = clipTrpgChars(compact, Math.min(1500, budget));
  const sceneBudget = Math.max(400, budget - Array.from(compactClipped).length);
  return {
    previousScene: clipTrpgChars(previousScene, sceneBudget),
    compact: compactClipped,
  };
}

export function buildHorizonPromptSections(opts: {
  events: TrpgMemoryEvent[];
  query: TrpgMemoryQuery;
}): {
  anchors: string;
  relevant: string;
  arc: string;
  botMemories: string;
  anchorsCount: number;
  relevantCount: number;
  botCount: number;
  relevantChars: number;
} {
  const anchors = selectCampaignAnchors(opts.events, opts.query);
  const anchorIds = new Set(anchors.map((event) => event.id));
  const relevant = selectHistoricalRecall(opts.events, opts.query).filter((event) => !anchorIds.has(event.id));
  const botQuery = { ...opts.query, viewerKind: "bot" as const };
  const botMemories = selectHistoricalRecall(opts.events, botQuery, { topK: TRPG_MEMORY_BOT_RECALL_TOP_K });
  const recalledForArc = [...anchors, ...relevant];
  const anchorText = formatMemoryLines(anchors, TRPG_MEMORY_ANCHOR_MAX_CHARS);
  const relevantText = formatMemoryLines(relevant, TRPG_MEMORY_RECALL_MAX_CHARS);
  const botText = formatMemoryLines(botMemories, TRPG_MEMORY_BOT_RECALL_MAX_CHARS);
  return {
    anchors: anchorText,
    relevant: relevantText,
    arc: buildArcMemoryBlock(opts.events, recalledForArc, opts.query.currentRound),
    botMemories: botText,
    anchorsCount: anchorText ? anchors.length : 0,
    relevantCount: relevantText ? relevant.length : 0,
    botCount: botText ? botMemories.length : 0,
    relevantChars: Array.from(relevantText).length,
  };
}

export function logTrpgMemoryUsage(opts: {
  campaignId: number;
  round: number;
  memoryEventsTotal: number;
  anchorsInjected: number;
  historicalRecalled: number;
  historicalRecalledChars: number;
  botRecalled: number;
  sealSuccess?: boolean;
  sealFallback?: boolean;
}): void {
  console.info("[trpg-memory]", {
    kind: "trpg_memory",
    campaignId: opts.campaignId,
    round: opts.round,
    memoryEventsTotal: opts.memoryEventsTotal,
    anchorsInjected: opts.anchorsInjected,
    historicalRecalled: opts.historicalRecalled,
    historicalRecalledChars: opts.historicalRecalledChars,
    botRecalled: opts.botRecalled,
    sealSuccess: opts.sealSuccess ?? null,
    sealFallback: opts.sealFallback ?? null,
  });
}
