import type { CharacterAsset } from "@/lib/characterAssets";
import { parseGenresJson, type CharacterGenre } from "@/lib/characterGenres";
import { normalizeScenarioAssets } from "./scenarioAssets";
import {
  DEFAULT_TRPG_STAT_DEFS,
  DEFAULT_TRPG_STAT_KEYS,
  defsFromKeys,
  evenStats,
  floorStats,
  isLegacyStatKey,
  parseCanonicalStatKeys,
  pointPoolFor,
  validateStatAllocation,
} from "./stats";
import {
  countScenarioPlanChars,
  hasPlayableScenarioPlan,
  parseTrpgScenarioPlan,
  type TrpgScenarioPlan,
} from "./scenarioPlan";
import { validateScenarioPublicationTransition } from "./trpgPublication";
import { parseTrpgVisibility, TRPG_MAX_BOTS, type TrpgStatDefinition, type TrpgVisibility } from "./types";

export const TRPG_SCENARIO_TITLE_LIMIT = 80;
export const TRPG_SCENARIO_SUMMARY_LIMIT = 200;
export const TRPG_SCENARIO_CONTENT_LIMIT = 10000;
export const TRPG_SCENARIO_SECRET_LIMIT = 10000;
export const TRPG_SCENARIO_LOCATION_LIMIT = 80;
export const TRPG_SCENARIO_MAX_BOTS = TRPG_MAX_BOTS;
/** Linked world + scenario prose + hidden notes + NPC cards, combined. */
export const TRPG_SCENARIO_BUNDLE_LIMIT = 10000;
export const TRPG_SCENARIO_NPC_NAME_LIMIT = 40;
export const TRPG_SCENARIO_NPC_DESCRIPTION_LIMIT = 2000;
export const TRPG_SCENARIO_NPC_GREETING_LIMIT = 800;
export const TRPG_SCENARIO_NPC_PROMPT_LIMIT = 8000;
/** Story-only mob NPCs. They do not take player-character model seats. */
export const TRPG_SCENARIO_MAX_NPCS = 8;

export type TrpgScenarioNpcRole = "supporting" | "boss";

export type TrpgScenarioNpc = {
  /** Stable internal identity for image linkage — not shown in authoring UI. */
  npcKey: string;
  role: TrpgScenarioNpcRole;
  name: string;
  description: string;
  greeting: string;
  systemPrompt: string;
  stats: Record<string, number> | null;
  /** Representative portrait/scene image for this NPC (V1: one image). */
  image?: CharacterAsset | null;
};

export function createScenarioNpcKey(): string {
  return `npc_${globalThis.crypto.randomUUID()}`;
}

function parseNpcRole(raw: unknown): TrpgScenarioNpcRole {
  return raw === "boss" ? "boss" : "supporting";
}

function parseNpcImage(raw: unknown, npcKey: string, fallbackTag: string): CharacterAsset | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const url = String(row.url ?? "").trim();
  if (!url) return null;
  const tag = clip(String(row.tag ?? fallbackTag), 40) || fallbackTag;
  const asset: CharacterAsset = {
    url,
    tag,
    visualSubjectKey: npcKey,
    public: true,
    chat: true,
    viewerBlur: typeof row.viewerBlur === "boolean" ? row.viewerBlur : false,
  };
  const width = Number(row.width);
  const height = Number(row.height);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    asset.width = Math.round(width);
    asset.height = Math.round(height);
    const orientation = row.orientation;
    if (orientation === "landscape" || orientation === "portrait" || orientation === "square") {
      asset.orientation = orientation;
    }
  }
  if (row.moderationReject === true) asset.moderationReject = true;
  if (typeof row.moderationReason === "string" && row.moderationReason.trim()) {
    asset.moderationReason = row.moderationReason.trim().slice(0, 200);
  }
  return asset;
}

export function ensureScenarioNpcKeys(npcs: readonly TrpgScenarioNpc[]): TrpgScenarioNpc[] {
  return npcs.map((npc) => {
    const npcKey = npc.npcKey?.trim() || createScenarioNpcKey();
    const role = npc.role === "boss" ? "boss" : "supporting";
    const image =
      npc.image?.url?.trim()
        ? { ...npc.image, visualSubjectKey: npcKey, tag: npc.image.tag?.trim() || npc.name.trim() || "npc" }
        : null;
    return { ...npc, npcKey, role, image };
  });
}

export function scenarioHasBossNpc(npcs: readonly TrpgScenarioNpc[]): boolean {
  return npcs.some((npc) => npc.role === "boss" && npc.name.trim());
}

export type TrpgScenarioTemplate = {
  id: number;
  creatorId: number;
  worldId: number | null;
  title: string;
  summary: string;
  content: string;
  secretContent: string;
  visibility: TrpgVisibility;
  startLocation: string;
  startInventory: string[];
  defaultPcStats: Record<string, number> | null;
  statKeys: string[];
  npcs: TrpgScenarioNpc[];
  characterIds: number[];
  genres: CharacterGenre[];
  assets: CharacterAsset[];
  scenarioPlan: TrpgScenarioPlan | null;
  createdAt: string;
  updatedAt: string;
};

export type TrpgScenarioTemplateInput = {
  title: string;
  summary?: string;
  content: string;
  secretContent?: string;
  worldId?: number | null;
  visibility?: unknown;
  startLocation?: string;
  startInventory?: string[];
  defaultPcStats?: Record<string, number> | null;
  statKeys?: unknown;
  npcs?: unknown;
  characterIds?: unknown;
  genres?: unknown;
  assets?: unknown;
  scenarioPlan?: unknown;
};

function clip(text: string, max: number): string {
  return text.trim().slice(0, max);
}

export function parseStatRecord(
  raw: unknown,
  defs: TrpgStatDefinition[] = DEFAULT_TRPG_STAT_DEFS,
  pool = pointPoolFor(defs)
): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  let authored = false;
  const stats = floorStats(defs);
  for (const def of defs) {
    const value = (raw as Record<string, unknown>)[def.key];
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isInteger(n)) {
      stats[def.key] = n;
      authored = true;
    }
  }
  if (!authored) return null;
  const check = validateStatAllocation(defs, stats, pool);
  return check.ok ? stats : floorStats(defs);
}

export function parseScenarioNpcs(raw: unknown, defs: TrpgStatDefinition[] = DEFAULT_TRPG_STAT_DEFS): TrpgScenarioNpc[] {
  if (!Array.isArray(raw)) return [];
  const out: TrpgScenarioNpc[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = clip(String(row.name ?? ""), TRPG_SCENARIO_NPC_NAME_LIMIT);
    if (!name) continue;
    const npcKey = clip(String(row.npcKey ?? ""), 80) || createScenarioNpcKey();
    out.push({
      npcKey,
      role: parseNpcRole(row.role),
      name,
      description: clip(String(row.description ?? ""), TRPG_SCENARIO_NPC_DESCRIPTION_LIMIT),
      greeting: clip(String(row.greeting ?? ""), TRPG_SCENARIO_NPC_GREETING_LIMIT),
      systemPrompt: clip(String(row.systemPrompt ?? ""), TRPG_SCENARIO_NPC_PROMPT_LIMIT),
      stats: parseStatRecord(row.stats, defs),
      image: parseNpcImage(row.image, npcKey, name),
    });
    if (out.length >= TRPG_SCENARIO_MAX_NPCS) break;
  }
  return ensureScenarioNpcKeys(out);
}

export function parseCharacterIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    const id = Number(item);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= TRPG_SCENARIO_MAX_BOTS) break;
  }
  return out;
}

export function parseInventory(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => clip(String(item ?? ""), 40))
    .filter(Boolean)
    .slice(0, 12);
}

export type NormalizeScenarioTemplateOptions = {
  /**
   * Legacy keys already stored on the existing DB row.
   * UPDATE only: preserve these. The request payload cannot add new legacy keys.
   */
  preservedLegacyStatKeys?: readonly string[];
  /** Visibility before this save. INSERT defaults to private. */
  previousVisibility?: TrpgVisibility;
};

function uniquePreservedLegacyKeys(raw: readonly string[] | undefined): string[] {
  if (!raw || raw.length === 0) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const item of raw) {
    const key = String(item ?? "").trim();
    if (!key || seen.has(key) || !isLegacyStatKey(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

export function normalizeScenarioTemplateInput(
  input: TrpgScenarioTemplateInput,
  options?: NormalizeScenarioTemplateOptions
): {
  title: string;
  summary: string;
  content: string;
  secretContent: string;
  worldId: number | null;
  visibility: TrpgVisibility;
  startLocation: string;
  startInventory: string[];
  defaultPcStats: Record<string, number> | null;
  statKeys: string[];
  npcs: TrpgScenarioNpc[];
  characterIds: number[];
  genres: CharacterGenre[];
  assets: CharacterAsset[];
  scenarioPlan: TrpgScenarioPlan | null;
} {
  const title = clip(String(input.title ?? ""), TRPG_SCENARIO_TITLE_LIMIT);
  const content = clip(String(input.content ?? ""), TRPG_SCENARIO_CONTENT_LIMIT);
  const scenarioPlan = parseTrpgScenarioPlan(input.scenarioPlan);
  if (!title) throw new Error("시나리오 제목을 입력해 주세요.");
  if (!content && !hasPlayableScenarioPlan(scenarioPlan)) {
    throw new Error("시작 상황과 플레이어 목표를 입력해 주세요.");
  }
  const preservedLegacy = uniquePreservedLegacyKeys(options?.preservedLegacyStatKeys);
  const requestedCanonical = parseCanonicalStatKeys(input.statKeys, {
    fallbackToDefault: preservedLegacy.length === 0,
  });
  const statDefs = defsFromKeys(
    requestedCanonical.length + preservedLegacy.length > 0
      ? [...requestedCanonical, ...preservedLegacy]
      : [...DEFAULT_TRPG_STAT_KEYS]
  );
  const statKeys = statDefs.map((def) => def.key);
  const pool = pointPoolFor(statDefs);
  const npcs = parseScenarioNpcs(input.npcs, statDefs);
  const characterIds = parseCharacterIds(input.characterIds);
  if (characterIds.length > TRPG_SCENARIO_MAX_BOTS) {
    throw new Error(`플레이어 캐릭터는 최대 ${TRPG_SCENARIO_MAX_BOTS}명입니다.`);
  }
  if (npcs.length > TRPG_SCENARIO_MAX_NPCS) {
    throw new Error(`모브 NPC는 최대 ${TRPG_SCENARIO_MAX_NPCS}명입니다.`);
  }
  const visibility = parseTrpgVisibility(input.visibility);
  const summary = clip(String(input.summary ?? ""), TRPG_SCENARIO_SUMMARY_LIMIT);
  validateScenarioPublicationTransition({
    previousVisibility: options?.previousVisibility ?? "private",
    nextVisibility: visibility,
    summary,
  });
  const worldIdRaw = Number(input.worldId);
  return {
    title,
    summary,
    content,
    secretContent: clip(String(input.secretContent ?? ""), TRPG_SCENARIO_SECRET_LIMIT),
    worldId: Number.isInteger(worldIdRaw) && worldIdRaw > 0 ? worldIdRaw : null,
    visibility,
    startLocation: clip(String(input.startLocation ?? ""), TRPG_SCENARIO_LOCATION_LIMIT),
    startInventory: parseInventory(input.startInventory),
    defaultPcStats: parseStatRecord(input.defaultPcStats, statDefs, pool) ?? evenStats(statDefs, pool),
    statKeys,
    npcs,
    characterIds,
    genres: parseGenresJson(input.genres),
    assets: normalizeScenarioAssets(input.assets),
    scenarioPlan,
  };
}

export type TrpgScenarioBundleParts = {
  worldSummary?: string;
  worldContent?: string;
  summary?: string;
  content?: string;
  secretContent?: string;
  npcs?: unknown;
  scenarioPlan?: TrpgScenarioPlan | null;
};

function bundleCharLen(text: string | undefined): number {
  return String(text ?? "").trim().length;
}

export function countScenarioBundleChars(parts: TrpgScenarioBundleParts): number {
  const npcs = parseScenarioNpcs(parts.npcs);
  const npcChars = npcs.reduce(
    (n, npc) =>
      n +
      bundleCharLen(npc.name) +
      bundleCharLen(npc.description) +
      bundleCharLen(npc.greeting) +
      bundleCharLen(npc.systemPrompt),
    0
  );
  return (
    bundleCharLen(parts.worldSummary) +
    bundleCharLen(parts.worldContent) +
    bundleCharLen(parts.summary) +
    bundleCharLen(parts.content) +
    bundleCharLen(parts.secretContent) +
    countScenarioPlanChars(parts.scenarioPlan) +
    npcChars
  );
}

export function remainingScenarioFieldMax(usedTotal: number, thisFieldChars: number, fieldCap: number): number {
  const others = Math.max(0, usedTotal - thisFieldChars);
  return Math.max(0, Math.min(fieldCap, TRPG_SCENARIO_BUNDLE_LIMIT - others));
}

export function scenarioBundleLimitError(count: number): string {
  return `연결 세계관·시나리오 본문·숨겨진 설정·NPC를 합쳐 ${TRPG_SCENARIO_BUNDLE_LIMIT.toLocaleString()}자 이하여야 합니다. 지금 ${count.toLocaleString()}자입니다.`;
}

export function assertScenarioBundleLimit(count: number): void {
  if (count > TRPG_SCENARIO_BUNDLE_LIMIT) {
    throw new Error(scenarioBundleLimitError(count));
  }
}

/** GM world context: name and setting. Not pasted into player chat. */
export function scenarioMobNpcWorldBrief(npcs: readonly TrpgScenarioNpc[]): string {
  const rows = npcs
    .map((npc) => {
      const name = npc.name.trim();
      if (!name) return "";
      const summary = npc.description.trim();
      const prefix = npc.role === "boss" ? "[보스] " : "";
      return summary ? `${prefix}${name} — ${summary}` : `${prefix}${name}`;
    })
    .filter(Boolean);
  if (rows.length === 0) return "";
  return `시나리오 NPC (모브, 플레이어 캐릭터 아님)\n${rows.join("\n")}`;
}

/** GM-only voice/notes. Never shown to players. */
export function scenarioMobNpcGmNotes(npcs: readonly TrpgScenarioNpc[]): string {
  const rows = npcs
    .map((npc) => {
      const name = npc.name.trim();
      if (!name) return "";
      const bits = [npc.greeting.trim() && `말투: ${npc.greeting.trim()}`, npc.systemPrompt.trim()].filter(Boolean);
      return bits.length ? `${name}\n${bits.join("\n")}` : "";
    })
    .filter(Boolean);
  if (rows.length === 0) return "";
  return `모브 NPC 진행 메모\n${rows.join("\n\n")}`;
}

export function scenarioMobNpcNames(npcs: readonly TrpgScenarioNpc[]): string[] {
  return npcs.map((npc) => npc.name.trim()).filter(Boolean);
}
