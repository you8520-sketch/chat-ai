import type Database from "better-sqlite3";

import type { OfficialWorldBible } from "@/lib/officialSupply/bible";
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

/**
 * Deterministic compact shared-world projection.
 * Shared facts only — never dumps the world-bible JSON, FACTION / CHARACTER_LOCAL
 * / AUTHOR_ONLY knowledge, or a character-local incident.
 */
export function projectOfficialSharedWorld(bible: OfficialWorldBible): string {
  const name = officialSharedWorldLibraryName(bible);
  const identity = joinParagraphs([
    [
      `${name}은 ${compactText(bible.genre)} 세계다.`,
      `${compactText(bible.era)}의 무대이며, ${compactText(bible.techLevel)} 위에서 ${compactText(bible.societyForm)}이 공존한다.`,
      `주요 지역은 ${compactText(bible.regions)}이다.`,
    ].join(" "),
  ]);

  const crisis = [
    compactText(bible.situation.biggestEvent),
    "제국의 생명줄인 에테르는 해마다 줄어 배급제가 시행되고 있다.",
  ].join(" ");

  const factions = [
    "황실(태양의 옥좌), 북부 발켄하임 철혈 연맹, 메르카토르 골드 길드, 판도라 학술원이 남은 에테르와 패권을 두고 경쟁한다.",
    "태양의 옥좌는 황권과 에테르 통제권 수복을 내세우지만 법령이 가혹해지며 민심이 불안하다.",
    "발켄하임은 북부 자치와 마수 방벽을 지키며 황실과 긴장한다.",
    "메르카토르는 에테르 시장과 채권으로 실권을 키우고, 판도라는 고갈 원인을 연구하며 표면적 중립을 유지한다.",
    "북부 방벽이 무너지면 제국이 무너진다는 것은 공인된 상식이다.",
  ].join(" ");

  const magic = [
    `에테르 사용: ${compactText(bible.powerSystem.limits)}.`,
    `대가: ${compactText(bible.powerSystem.costs)}.`,
    `사회적 영향: ${compactText(bible.powerSystem.socialImpact)}.`,
    `금기: ${compactText(bible.powerSystem.taboos)}. 허가 없는 고대 마법 연구는 금지된다.`,
  ].join(" ");

  const society = [
    `계급: ${compactText(bible.society["계급"] ?? "")}`,
    `결혼: ${compactText(bible.society["결혼/가족"] ?? "")}`,
    `법: ${compactText(bible.society["법"] ?? "")}`,
  ].join(" ");

  const macro = [
    compactText(bible.situation.upcomingChange),
    `이득을 보는 쪽: ${compactText(bible.situation.beneficiaries)}`,
    `위협받는 쪽: ${compactText(bible.situation.threatened)}`,
  ].join(" ");

  const entry = [
    compactText(bible.userEntry.note),
    `가능한 입장: ${bible.userEntry.allowedRoles.map((role) => compactText(role)).filter(Boolean).join(" / ")}.`,
  ].join(" ");

  const projected = joinParagraphs([identity, crisis, factions, magic, society, macro, entry]);
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
