import type Database from "better-sqlite3";

import type { OfficialWorldBible, WorldFaction } from "@/lib/officialSupply/bible";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
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
export const OFFICIAL_SHARED_WORLD_LIBRARY_GENRE = "로맨스 판타지";

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

const WORLD_PROJECTION_MIN_CHARS = 1500;
const WORLD_PROJECTION_MAX_CHARS = 2300;
const SOCIETY_FIELD_KEYS = ["계급", "결혼/가족", "법"] as const;
type FactionProjectionField = "purpose" | "publicView" | "relations";

type SharedWorldRenderOptions = {
  factionFields: readonly FactionProjectionField[];
  commonCount: number;
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
  const parts = [asClause(name)];
  for (const field of fields) {
    const clause = asClause(faction[field] ?? "");
    if (clause) parts.push(clause);
  }
  return parts.join(" ");
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
    `${compactText(bible.era)}의 무대이며, ${compactText(bible.techLevel)} 위에서 ${compactText(bible.societyForm)}이 공존한다.`,
    `주요 지역은 ${compactText(bible.regions)}이다.`,
  ].join(" ");

  const commonFacts = (bible.knowledge.common ?? [])
    .map((fact) => asClause(fact))
    .filter(Boolean)
    .slice(0, options.commonCount);

  const crisis = [asClause(bible.situation.biggestEvent), ...commonFacts].filter(Boolean).join(" ");

  const factions = (bible.factions ?? [])
    .map((faction) => renderFaction(faction, options.factionFields))
    .filter(Boolean)
    .join(" ");

  const magic = [
    labeledClause("에테르 사용", bible.powerSystem.limits),
    labeledClause("대가", bible.powerSystem.costs),
    labeledClause("사회적 영향", bible.powerSystem.socialImpact),
    labeledClause("금기", bible.powerSystem.taboos),
  ]
    .filter(Boolean)
    .join(" ");

  const society = selectedSocietyKeys(bible.society)
    .map((key) => labeledClause(key === "결혼/가족" ? "결혼" : key, bible.society[key] ?? ""))
    .filter(Boolean)
    .join(" ");

  const macro = [
    asClause(bible.situation.upcomingChange),
    labeledClause("이득을 보는 쪽", bible.situation.beneficiaries),
    labeledClause("위협받는 쪽", bible.situation.threatened),
  ]
    .filter(Boolean)
    .join(" ");

  const entry = [
    asClause(bible.userEntry.note),
    labeledClause(
      "가능한 입장",
      bible.userEntry.allowedRoles.map((role) => compactText(role)).filter(Boolean).join(" / ")
    ),
  ]
    .filter(Boolean)
    .join(" ");

  return joinParagraphs([identity, crisis, factions, magic, society, macro, entry]);
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
    { factionFields: ["purpose", "publicView", "relations"], commonCount: Number.POSITIVE_INFINITY },
    { factionFields: ["purpose", "publicView"], commonCount: Number.POSITIVE_INFINITY },
    { factionFields: ["purpose", "publicView"], commonCount: 3 },
    { factionFields: ["purpose"], commonCount: 3 },
    { factionFields: ["purpose"], commonCount: 2 },
  ];
  let projected = renderOfficialSharedWorld(bible, attempts[0]!);
  for (const options of attempts) {
    const candidate = renderOfficialSharedWorld(bible, options);
    if (candidate.length <= WORLD_PROJECTION_MAX_CHARS) {
      projected = candidate;
      break;
    }
    projected = candidate;
  }
  if (projected.length < WORLD_PROJECTION_MIN_CHARS || projected.length > WORLD_PROJECTION_MAX_CHARS) {
    throw new OfficialSupplyGateError(
      "official_world_projection_band",
      `official shared world projection ${projected.length} chars is outside ${WORLD_PROJECTION_MIN_CHARS}-${WORLD_PROJECTION_MAX_CHARS}`
    );
  }
  assertOfficialSharedWorldProjection(projected);
  if (worldContentBundleCharCount(projected, "") > WORLD_CONTENT_LIMIT) {
    throw new OfficialSupplyGateError(
      "official_world_projection_too_large",
      `official shared world projection exceeds ${WORLD_CONTENT_LIMIT}`
    );
  }
  return projected;
}

export function assertOfficialSharedWorldProjection(text: string): void {
  const body = text.trim();
  if (!body) {
    throw new OfficialSupplyGateError("official_world_projection_empty", "official shared world projection is empty");
  }
  if (!body.includes(OFFICIAL_SHARED_WORLD_LIBRARY_NAME)) {
    throw new OfficialSupplyGateError(
      "official_world_projection_missing_identity",
      "official shared world projection lost Ethernos identity"
    );
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
  const genresJson = JSON.stringify([OFFICIAL_SHARED_WORLD_LIBRARY_GENRE]);
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
