import type Database from "better-sqlite3";

import { parseGenresJson } from "@/lib/characterGenres";
import type { OfficialWorldBible, WorldFaction } from "@/lib/officialSupply/bible";
import {
  OfficialSupplyGateError,
  type OfficialWorldProjectionHit,
} from "@/lib/officialSupply/store";
import { qaResult, type OfficialCharacterDraft } from "@/lib/officialSupply/types";
import {
  WORLD_CONTENT_LIMIT,
  WORLD_NAME_LIMIT,
  WORLD_SUMMARY_LIMIT,
  worldContentBundleCharCount,
} from "@/lib/worlds";

/**
 * Canonical World Library owner for official Ethernos characters.
 *
 * ONE WORLD = ONE `worlds` row owned by the site-managed official studio.
 * This is not a second official-only world database.
 *
 * Runtime chat still reads `characters.world` (the snapshot). `world_id`
 * attaches that snapshot to the existing World Library path so creator edit
 * and `resolveWorldSelectionForUser` share the same owner.
 */
export const OFFICIAL_SHARED_WORLD_LIBRARY_NAME = "에테르노스 제국";

const USER_BINDING_MARKER = /당신|유저|플레이어/u;

const HIDDEN_KNOWLEDGE_MARKERS = [
  /황제는 이미 거동이/u,
  /수도로 진격/u,
  /인위적으로 부추/u,
  /건국 당시의 원죄/u,
  /고대 신의 유해/u,
  /세계의 리셋/u,
  /루시안/u,
  /카엘룸|볼프강|율리우스|바스티안|세라피나|이노센트|에드릭|노엘/u,
] as const;

function compactText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function joinParagraphs(parts: string[]): string {
  return parts.map((part) => compactText(part)).filter(Boolean).join("\n\n");
}

export function officialSharedWorldLibraryName(
  bible: Pick<OfficialWorldBible, "name"> = { name: OFFICIAL_SHARED_WORLD_LIBRARY_NAME }
): string {
  const stripped = compactText(bible.name).replace(/\s*\([^)]*\)\s*$/u, "");
  return (stripped || OFFICIAL_SHARED_WORLD_LIBRARY_NAME).slice(0, WORLD_NAME_LIMIT);
}

export function officialSharedWorldLibrarySummary(bible: OfficialWorldBible): string {
  return compactText(bible.centralPremise || bible.premise).slice(0, WORLD_SUMMARY_LIMIT);
}

const WORLD_PROJECTION_MIN_CHARS = 2000;
const WORLD_PROJECTION_MAX_CHARS = 3000;
const SOCIETY_FIELD_KEYS = ["계급", "결혼/가족", "법"] as const;
const FACTION_FIELD_LABELS = {
  purpose: "목적",
  leadership: "지도부",
  relations: "대외 관계",
  publicView: "세간의 평가",
} as const;
type FactionProjectionField = keyof typeof FACTION_FIELD_LABELS;

const POWER_FIELD_KEYS = ["acquisition", "ranks", "limits", "costs", "socialImpact", "taboos"] as const;
type PowerProjectionField = (typeof POWER_FIELD_KEYS)[number];

/** Ethernos keeps its pre-G5 labels byte-for-byte; every other world gets setting-neutral labels. */
const ETHERNOS_POWER_LABELS: Record<PowerProjectionField, string> = {
  acquisition: "에테르를 다루는 법",
  ranks: "등급",
  limits: "에테르 사용",
  costs: "대가",
  socialImpact: "사회적 영향",
  taboos: "금기",
};
const NEUTRAL_POWER_LABELS: Record<PowerProjectionField, string> = {
  acquisition: "영향력을 얻는 법",
  ranks: "서열",
  limits: "한계",
  costs: "대가",
  socialImpact: "사회적 영향",
  taboos: "금기",
};

type SharedWorldRenderOptions = {
  factionFields: readonly FactionProjectionField[];
  commonCount: number;
  powerFields?: readonly PowerProjectionField[];
};

function asClause(value: string): string {
  const text = compactText(value);
  if (!text) return "";
  return /[.!?。]$/u.test(text) ? text : `${text}.`;
}

function labeledClause(label: string, value: string): string {
  const text = compactText(value);
  if (!text) return "";
  return `${label}: ${asClause(text)}`;
}

function renderFaction(faction: WorldFaction, fields: readonly FactionProjectionField[]): string {
  const name = compactText(faction.name);
  if (!name) return "";
  const parts = fields
    .map((field) => labeledClause(FACTION_FIELD_LABELS[field], faction[field] ?? ""))
    .filter(Boolean);
  return parts.length > 0 ? `${name} — ${parts.join(" ")}` : asClause(name);
}

function stripTrailingParenthetical(value: string): string {
  return compactText(value).replace(/\s*\([^)]*\)\s*$/u, "");
}

function selectedSocietyKeys(society: OfficialWorldBible["society"]): string[] {
  const preferred = SOCIETY_FIELD_KEYS.filter((key) => compactText(society[key] ?? ""));
  if (preferred.length >= 3) return [...preferred];
  const preferredSet = new Set<string>(preferred);
  const extra = Object.keys(society).filter((key) => !preferredSet.has(key) && compactText(society[key] ?? ""));
  extra.sort((a, b) => a.localeCompare(b, "ko"));
  return [...preferred, ...extra].slice(0, 3);
}

function renderOfficialSharedWorld(bible: OfficialWorldBible, options: SharedWorldRenderOptions): string {
  const name = officialSharedWorldLibraryName(bible);
  const identity = [
    `${name}은 ${compactText(bible.genre)} 세계다.`,
    `${stripTrailingParenthetical(bible.era)}의 무대이며, ${compactText(bible.techLevel)} 위에서 ${compactText(bible.societyForm)}이 공존한다.`,
    `주요 지역은 ${compactText(bible.regions)}이다.`,
  ].join(" ");

  const commonFacts = (bible.knowledge.common ?? [])
    .map((fact) => asClause(fact))
    .filter(Boolean)
    .slice(0, options.commonCount);

  const timeline = (bible.history ?? [])
    .map((entry) => asClause(`${compactText(entry.event)}: ${compactText(entry.impact)}`))
    .filter((clause) => clause.length > 1);
  const crisis = [timeline.length > 0 ? `사건의 순서. ${timeline.join(" ")}` : "", ...commonFacts]
    .filter(Boolean)
    .join(" ");

  const factions = (bible.factions ?? [])
    .map((faction) => renderFaction(faction, options.factionFields))
    .filter(Boolean)
    .join(" ");

  const powerLabels = name === OFFICIAL_SHARED_WORLD_LIBRARY_NAME ? ETHERNOS_POWER_LABELS : NEUTRAL_POWER_LABELS;
  const magic = (options.powerFields ?? POWER_FIELD_KEYS)
    .map((key) => labeledClause(powerLabels[key], bible.powerSystem[key]))
    .filter(Boolean)
    .join(" ");

  const society = selectedSocietyKeys(bible.society)
    .map((key) => labeledClause(key === "결혼/가족" ? "결혼" : key, bible.society[key] ?? ""))
    .filter(Boolean)
    .join(" ");

  const customs = (bible.culture ?? [])
    .map((item) => stripTrailingParenthetical(item.name))
    .filter(Boolean)
    .join(", ");
  const culture = customs ? `사교 문화: ${asClause(customs)}` : "";

  const macro = [
    asClause(bible.situation.upcomingChange),
    labeledClause("이득을 보는 쪽", bible.situation.beneficiaries),
    labeledClause("위협받는 쪽", bible.situation.threatened),
  ]
    .filter(Boolean)
    .join(" ");

  return joinParagraphs([identity, crisis, factions, magic, [society, culture].filter(Boolean).join(" "), macro]);
}

const USER_BINDING_CODE = "official_world_projection_user_binding";
const USER_BINDING_MESSAGE =
  "official shared world projection addresses or binds the user; entry guidance belongs to the character situation";
const USER_BINDING_EXCERPT_CHARS = 80;
const USER_BINDING_HIT_LIMIT = 4;

function bindingExcerpt(value: string): string | null {
  const text = compactText(value);
  if (!text) return null;
  USER_BINDING_MARKER.lastIndex = 0;
  const match = USER_BINDING_MARKER.exec(text);
  if (!match) return null;
  const end = Math.min(text.length, Math.max(match.index + match[0].length, match.index + USER_BINDING_EXCERPT_CHARS));
  const start = Math.max(0, end - USER_BINDING_EXCERPT_CHARS);
  return text.slice(start, Math.min(text.length, start + USER_BINDING_EXCERPT_CHARS));
}

function rememberBinding(hits: OfficialWorldProjectionHit[], field: string, value: string): void {
  if (hits.length >= USER_BINDING_HIT_LIMIT) return;
  const excerpt = bindingExcerpt(value);
  if (!excerpt) return;
  hits.push({ field, excerpt });
}

/** Fields that `renderOfficialSharedWorld` included for this shrink. Same marker, no second regex. */
function userBindingHits(bible: OfficialWorldBible, options: SharedWorldRenderOptions, projected: string): OfficialWorldProjectionHit[] {
  const hits: OfficialWorldProjectionHit[] = [];
  rememberBinding(hits, "name", officialSharedWorldLibraryName(bible));
  rememberBinding(hits, "genre", bible.genre);
  rememberBinding(hits, "era", stripTrailingParenthetical(bible.era));
  rememberBinding(hits, "techLevel", bible.techLevel);
  rememberBinding(hits, "societyForm", bible.societyForm);
  rememberBinding(hits, "regions", bible.regions);

  (bible.knowledge.common ?? [])
    .map((fact, index) => ({ fact, index }))
    .filter(({ fact }) => compactText(fact))
    .slice(0, options.commonCount)
    .forEach(({ fact, index }) => rememberBinding(hits, `knowledge.common[${index}]`, fact));

  (bible.history ?? []).forEach((entry, index) => {
    const clause = asClause(`${compactText(entry.event)}: ${compactText(entry.impact)}`);
    if (clause.length <= 1) return;
    rememberBinding(hits, `history[${index}].event`, entry.event);
    rememberBinding(hits, `history[${index}].impact`, entry.impact);
  });

  (bible.factions ?? []).forEach((faction, index) => {
    if (!compactText(faction.name)) return;
    rememberBinding(hits, `factions[${index}].name`, faction.name);
    for (const field of options.factionFields) {
      rememberBinding(hits, `factions[${index}].${field}`, faction[field] ?? "");
    }
  });

  for (const key of options.powerFields ?? POWER_FIELD_KEYS) {
    rememberBinding(hits, `powerSystem.${key}`, bible.powerSystem[key]);
  }

  for (const key of selectedSocietyKeys(bible.society)) {
    rememberBinding(hits, `society.${key}`, bible.society[key] ?? "");
  }

  (bible.culture ?? []).forEach((item, index) => {
    const name = stripTrailingParenthetical(item.name);
    if (!name) return;
    rememberBinding(hits, `culture[${index}].name`, name);
  });

  rememberBinding(hits, "situation.upcomingChange", bible.situation.upcomingChange);
  rememberBinding(hits, "situation.beneficiaries", bible.situation.beneficiaries);
  rememberBinding(hits, "situation.threatened", bible.situation.threatened);

  if (hits.length > 0) return hits;
  const excerpt = bindingExcerpt(projected) ?? compactText(projected).slice(0, USER_BINDING_EXCERPT_CHARS);
  return [{ field: "projection", excerpt }];
}

export function officialSharedWorldUserBindingError(
  hits: readonly OfficialWorldProjectionHit[]
): OfficialSupplyGateError {
  return new OfficialSupplyGateError(
    USER_BINDING_CODE,
    USER_BINDING_MESSAGE,
    qaResult(
      hits.map((hit) => ({
        code: USER_BINDING_CODE,
        message: `world_projection ${hit.field}: ${hit.excerpt}`,
      }))
    ),
    undefined,
    { stage: "world_projection", code: USER_BINDING_CODE, hits }
  );
}

function userBindingGate(bible: OfficialWorldBible, options: SharedWorldRenderOptions, projected: string): OfficialSupplyGateError {
  return officialSharedWorldUserBindingError(userBindingHits(bible, options, projected));
}

/**
 * Core fields that remain in every shrink of the shared projection.
 * Atlas-only text and fields a shrink can drop are not scanned here.
 */
export type OfficialSharedWorldCoreBindingInput = {
  name: string;
  genre: string;
  era: string;
  techLevel: string;
  societyForm: string;
  regions: string;
  society: Record<string, string>;
  cultureNames: readonly string[];
  upcomingChange: string;
  beneficiaries: string;
  threatened: string;
  factions: readonly { name: string; purpose: string }[];
  powerAcquisition: string;
  powerLimits: string;
  powerCosts: string;
};

export function officialSharedWorldCoreBindingHits(
  input: OfficialSharedWorldCoreBindingInput
): OfficialWorldProjectionHit[] {
  const hits: OfficialWorldProjectionHit[] = [];
  rememberBinding(hits, "name", officialSharedWorldLibraryName({ name: input.name }));
  rememberBinding(hits, "genre", input.genre);
  rememberBinding(hits, "era", stripTrailingParenthetical(input.era));
  rememberBinding(hits, "techLevel", input.techLevel);
  rememberBinding(hits, "societyForm", input.societyForm);
  rememberBinding(hits, "regions", input.regions);
  for (const key of selectedSocietyKeys(input.society)) {
    rememberBinding(hits, `society.${key}`, input.society[key] ?? "");
  }
  input.cultureNames.forEach((name, index) => {
    const stripped = stripTrailingParenthetical(name);
    if (!stripped) return;
    rememberBinding(hits, `culture[${index}].name`, stripped);
  });
  rememberBinding(hits, "situation.upcomingChange", input.upcomingChange);
  rememberBinding(hits, "situation.beneficiaries", input.beneficiaries);
  rememberBinding(hits, "situation.threatened", input.threatened);
  input.factions.forEach((faction, index) => {
    if (!compactText(faction.name)) return;
    rememberBinding(hits, `factions[${index}].name`, faction.name);
    rememberBinding(hits, `factions[${index}].purpose`, faction.purpose);
  });
  rememberBinding(hits, "powerSystem.acquisition", input.powerAcquisition);
  rememberBinding(hits, "powerSystem.limits", input.powerLimits);
  rememberBinding(hits, "powerSystem.costs", input.powerCosts);
  return hits;
}

/**
 * Deterministic compact shared-world projection.
 * Domain facts come from OfficialWorldBible fields. Literals are labels,
 * punctuation, connective wording, and section order only.
 * Never dumps the world-bible JSON, lorebooks, FACTION / CHARACTER_LOCAL /
 * AUTHOR_ONLY knowledge, or a character-local incident.
 */
export function projectOfficialSharedWorld(bible: OfficialWorldBible): string {
  const attempts: SharedWorldRenderOptions[] = [
    { factionFields: ["purpose", "leadership", "relations", "publicView"], commonCount: Number.POSITIVE_INFINITY },
    { factionFields: ["purpose", "leadership", "publicView"], commonCount: Number.POSITIVE_INFINITY },
    { factionFields: ["purpose", "leadership", "publicView"], commonCount: 3 },
    { factionFields: ["purpose", "publicView"], commonCount: 3 },
    { factionFields: ["purpose"], commonCount: 2 },
    { factionFields: ["purpose"], commonCount: 2, powerFields: ["acquisition", "limits", "costs"] },
  ];
  let chosen = attempts[0]!;
  let projected = "";
  for (const options of attempts) {
    projected = renderOfficialSharedWorld(bible, options);
    chosen = options;
    if (projected.length <= WORLD_PROJECTION_MAX_CHARS) break;
  }
  if (projected.length < WORLD_PROJECTION_MIN_CHARS || projected.length > WORLD_PROJECTION_MAX_CHARS) {
    throw new OfficialSupplyGateError(
      "official_world_projection_band",
      `official shared world projection ${projected.length} chars is outside ${WORLD_PROJECTION_MIN_CHARS}-${WORLD_PROJECTION_MAX_CHARS}`
    );
  }
  assertOfficialSharedWorldProjection(projected, officialSharedWorldLibraryName(bible), { bible, options: chosen });
  if (worldContentBundleCharCount(projected, "") > WORLD_CONTENT_LIMIT) {
    throw new OfficialSupplyGateError(
      "official_world_projection_too_large",
      `official shared world projection exceeds ${WORLD_CONTENT_LIMIT}`
    );
  }
  return projected;
}

export function assertOfficialSharedWorldProjection(
  text: string,
  expectedWorldName: string = OFFICIAL_SHARED_WORLD_LIBRARY_NAME,
  diagnostic?: { bible: OfficialWorldBible; options: SharedWorldRenderOptions }
): void {
  const body = text.trim();
  if (!body) {
    throw new OfficialSupplyGateError("official_world_projection_empty", "official shared world projection is empty");
  }
  if (!body.includes(expectedWorldName)) {
    throw new OfficialSupplyGateError(
      "official_world_projection_missing_identity",
      `official shared world projection lost world identity: ${expectedWorldName}`
    );
  }
  USER_BINDING_MARKER.lastIndex = 0;
  if (USER_BINDING_MARKER.test(body)) {
    if (diagnostic) throw userBindingGate(diagnostic.bible, diagnostic.options, body);
    throw new OfficialSupplyGateError(USER_BINDING_CODE, USER_BINDING_MESSAGE);
  }
  for (const marker of HIDDEN_KNOWLEDGE_MARKERS) {
    if (marker.test(body)) {
      throw new OfficialSupplyGateError(
        "official_world_projection_knowledge_boundary",
        `official shared world projection leaked hidden/local knowledge: ${marker}`
      );
    }
  }
}

export function composeOfficialCurrentSituation(input: {
  personalSituation: string;
  userEntry: string;
}): string {
  return [input.personalSituation, input.userEntry].map((part) => part.trim()).filter(Boolean).join("\n\n");
}

export type OfficialSharedWorldLibraryRow = {
  worldId: number;
  name: string;
  summary: string;
  content: string;
  created: boolean;
  updated: boolean;
};

/** A draft attaches to the shared World Library row iff its manuscript splits world and currentSituation. */
export function officialDraftUsesSharedWorld(
  draft: Pick<OfficialCharacterDraft, "promptStandard" | "sections">
): boolean {
  return draft.promptStandard === "compact_rp_v1" || draft.promptStandard === "compact_rp_v2" || Boolean(draft.sections.currentSituation?.trim());
}

export function findOfficialSharedWorldLibraryRow(
  db: Database.Database,
  creatorId: number,
  name = OFFICIAL_SHARED_WORLD_LIBRARY_NAME
): { id: number; content: string; summary: string } | null {
  const row = db
    .prepare(
      `SELECT id, content, COALESCE(summary, '') AS summary
       FROM worlds WHERE creator_id = ? AND name = ?`
    )
    .get(creatorId, name) as { id: number; content: string; summary: string } | undefined;
  return row ?? null;
}

/**
 * Create or reuse the single studio-owned Ethernos World Library row.
 * Does not create one world per character and does not add an official_supply_worlds table.
 */
export function ensureOfficialSharedWorldLibraryRow(input: {
  db: Database.Database;
  creatorId: number;
  bible: OfficialWorldBible;
}): OfficialSharedWorldLibraryRow {
  const name = officialSharedWorldLibraryName(input.bible);
  const summary = officialSharedWorldLibrarySummary(input.bible);
  const content = projectOfficialSharedWorld(input.bible);
  const genresJson = JSON.stringify(parseGenresJson([input.bible.genre]));
  const existing = findOfficialSharedWorldLibraryRow(input.db, input.creatorId, name);
  if (existing) {
    const needsUpdate = existing.content !== content || existing.summary !== summary;
    if (needsUpdate) {
      const updated = input.db
        .prepare(
          `UPDATE worlds
           SET content=?, summary=?, genres=?, secret_content='', updated_at=datetime('now')
           WHERE id=? AND creator_id=?`
        )
        .run(content, summary, genresJson, existing.id, input.creatorId);
      if (updated.changes !== 1) {
        throw new OfficialSupplyGateError(
          "official_world_row_update_failed",
          `failed to update official world ${existing.id}`
        );
      }
    }
    return {
      worldId: existing.id,
      name,
      summary,
      content,
      created: false,
      updated: needsUpdate,
    };
  }

  const inserted = input.db
    .prepare(
      `INSERT INTO worlds (
         creator_id, name, summary, content, secret_content,
         trpg_enabled, trpg_visibility, genres, cover_url, updated_at
       )
       VALUES (?, ?, ?, ?, '', 0, 'private', ?, '', datetime('now'))`
    )
    .run(input.creatorId, name, summary, content, genresJson);
  return {
    worldId: Number(inserted.lastInsertRowid),
    name,
    summary,
    content,
    created: true,
    updated: false,
  };
}

/**
 * Attach the studio World Library row for in-place sync.
 * Reuses an existing row without rewriting content used by other live characters.
 * Creates the row only when the studio has none.
 */
export function attachOfficialSharedWorldLibraryRow(input: {
  db: Database.Database;
  creatorId: number;
  bible: OfficialWorldBible;
  createIfMissing: boolean;
}): { worldId: number | null; created: boolean; contentDiffers: boolean } {
  const name = officialSharedWorldLibraryName(input.bible);
  const existing = findOfficialSharedWorldLibraryRow(input.db, input.creatorId, name);
  if (existing) {
    const projected = projectOfficialSharedWorld(input.bible);
    const summary = officialSharedWorldLibrarySummary(input.bible);
    return {
      worldId: existing.id,
      created: false,
      contentDiffers: existing.content !== projected || existing.summary !== summary,
    };
  }
  if (!input.createIfMissing) {
    return { worldId: null, created: false, contentDiffers: false };
  }
  const created = ensureOfficialSharedWorldLibraryRow(input);
  return { worldId: created.worldId, created: true, contentDiffers: false };
}
