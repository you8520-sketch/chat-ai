import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { isAdminUser } from "@/lib/isAdminUser";
import { LUCIAN_CANONICAL_NAME, normalizeOfficialDisplayCreatorName } from "@/lib/officialDisplayCreatorName";
import {
  LUCIAN_DRAFT_KEY,
  LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY,
} from "@/lib/officialSupply/officialDraftIdentity";
import { isSiteManagedUser } from "@/lib/siteManagedAccounts";
import { isStageAtLeast, type OfficialCharacterStage } from "@/lib/officialSupply/types";

export type OfficialAdminActor = {
  id?: number;
  email?: string | null;
  is_admin?: number;
};

export type OfficialOwnerSession = {
  id: number;
  nickname: string;
  is_adult: number;
  email?: string;
  is_admin?: number;
};

export type OfficialOwnerResolution =
  | { status: "ok"; id: number; nickname: string }
  | { status: "missing" }
  | { status: "ambiguous"; count: number };

export type OfficialManageableCharacter = {
  id: number;
  name: string;
  creator_id: number | null;
  creator_name: string;
  official: number;
  visibility: string;
  moderation_status: string;
};

export function isOfficialAdminActor(user: OfficialAdminActor | null | undefined): boolean {
  if (!user) return false;
  return isAdminUser({
    email: user.email ?? "",
    is_admin: user.is_admin ?? 0,
  });
}

export function sqliteTableExists(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { ok: number } | undefined;
  return row != null;
}

/** Supply provenance: `official_supply_characters.staged_character_id` is the only trusted link. */
export function listOfficialSupplyLinks(
  db: Database.Database,
  characterId: number
): Array<{ draft_key: string; stage: string }> {
  if (!sqliteTableExists(db, "official_supply_characters")) return [];
  return db
    .prepare(
      `SELECT draft_key, stage FROM official_supply_characters
       WHERE staged_character_id=? ORDER BY draft_key ASC`
    )
    .all(characterId) as Array<{ draft_key: string; stage: string }>;
}

export function isOfficialSupplyLinkedCharacter(db: Database.Database, characterId: number): boolean {
  return listOfficialSupplyLinks(db, characterId).length > 0;
}

/** SQL fragment excluding supply-linked rows from regular-creator aggregates (`alias.id`). */
export function notOfficialSupplyLinkedSql(db: Database.Database, alias: string): string {
  if (!sqliteTableExists(db, "official_supply_characters")) return "1=1";
  return `NOT EXISTS (SELECT 1 FROM official_supply_characters osc WHERE osc.staged_character_id = ${alias}.id)`;
}

export function isOfficialAdminUserId(db: Database.Database, userId: number): boolean {
  const owner = db
    .prepare("SELECT id, email, is_admin FROM users WHERE id=?")
    .get(userId) as { id: number; email: string; is_admin: number } | undefined;
  return owner != null && isOfficialAdminActor(owner);
}

/**
 * A pre-publish supply character whose real owner is an admin account (after the #1589 owner
 * transfer). Requires exactly one supply link at `staged_private`, a non-official row and an
 * admin owner; a regular admin-owned character never matches.
 */
export function isAdminOwnedOfficialSupplyCharacter(
  row: Pick<OfficialManageableCharacter, "id" | "official" | "creator_id"> | null | undefined,
  db: Database.Database = getDb()
): boolean {
  if (!row || row.official === 1 || row.creator_id == null) return false;
  const links = listOfficialSupplyLinks(db, row.id);
  if (links.length !== 1 || links[0]!.stage !== "staged_private") return false;
  return isOfficialAdminUserId(db, row.creator_id);
}

export function isOfficialManagedCharacterRow(
  row: Pick<OfficialManageableCharacter, "id" | "official" | "creator_id"> | null | undefined,
  db: Database.Database = getDb()
): boolean {
  if (!row) return false;
  if (row.official === 1) return true;
  if (row.creator_id == null) return false;
  return isSiteManagedUser(row.creator_id) || isAdminOwnedOfficialSupplyCharacter(row, db);
}

export function canAdminManageOfficialCharacter(
  admin: OfficialAdminActor | null | undefined,
  row: Pick<OfficialManageableCharacter, "id" | "official" | "creator_id"> | null | undefined
): boolean {
  return isOfficialAdminActor(admin) && isOfficialManagedCharacterRow(row);
}

/**
 * Owner of the supply-managed lorebooks/world library for a character. Site-managed rows use their
 * own owner. Admin-owned supply rows keep their shared lorebooks under the original studio account,
 * so the studio is derived from the attached lorebooks and must be a single site-managed account.
 */
export function resolveOfficialSupplyAssetOwnerId(
  db: Database.Database,
  row: Pick<OfficialManageableCharacter, "id" | "official" | "creator_id">,
  attachedLorebookIds: readonly number[]
): number | null {
  if (row.creator_id == null) return null;
  if (isSiteManagedUser(row.creator_id)) return row.creator_id;
  if (!isAdminOwnedOfficialSupplyCharacter(row, db) || attachedLorebookIds.length === 0) return null;
  const placeholders = attachedLorebookIds.map(() => "?").join(",");
  const owners = db
    .prepare(`SELECT DISTINCT creator_id FROM keyword_lorebooks WHERE id IN (${placeholders})`)
    .all(...attachedLorebookIds) as Array<{ creator_id: number }>;
  if (owners.length !== 1) return null;
  const ownerId = owners[0]!.creator_id;
  return isSiteManagedUser(ownerId) ? ownerId : null;
}

export type OfficialCharacterEditorAccess = "owner" | "official_admin" | "forbidden";

export function resolveOfficialCharacterEditorAccess(
  user: OfficialAdminActor | null | undefined,
  row: Pick<OfficialManageableCharacter, "id" | "official" | "creator_id"> | null | undefined
): OfficialCharacterEditorAccess {
  if (!user || !row) return "forbidden";
  if (canAdminManageOfficialCharacter(user, row)) return "official_admin";
  if (row.creator_id != null && row.creator_id === user.id && row.official !== 1) return "owner";
  return "forbidden";
}

export function resolveCanonicalOfficialOwner(): OfficialOwnerResolution {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, nickname FROM users
       WHERE site_managed=1
       ORDER BY id ASC`
    )
    .all() as Array<{ id: number; nickname: string }>;
  if (rows.length === 0) return { status: "missing" };
  if (rows.length === 1) {
    return { status: "ok", id: rows[0]!.id, nickname: rows[0]!.nickname };
  }

  const owningOfficial = db
    .prepare(
      `SELECT DISTINCT creator_id AS id
       FROM characters
       WHERE official=1 AND creator_id IS NOT NULL
         AND creator_id IN (SELECT id FROM users WHERE site_managed=1)
       ORDER BY id ASC`
    )
    .all() as Array<{ id: number }>;
  if (owningOfficial.length === 1) {
    const owner = rows.find((row) => row.id === owningOfficial[0]!.id);
    if (owner) return { status: "ok", id: owner.id, nickname: owner.nickname };
  }
  return { status: "ambiguous", count: rows.length };
}

export function loadOfficialOwnerSession(ownerId: number): OfficialOwnerSession | null {
  if (!isSiteManagedUser(ownerId)) return null;
  const row = getDb()
    .prepare("SELECT id, nickname, is_adult, email, is_admin FROM users WHERE id=?")
    .get(ownerId) as
    | { id: number; nickname: string; is_adult: number; email: string; is_admin: number }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    nickname: row.nickname,
    is_adult: row.is_adult,
    email: row.email,
    is_admin: row.is_admin,
  };
}

type AdminListSupplyRow = {
  draft_key: string;
  staged_character_id: number | null;
  stage: string;
};

function resolveAdminListSupply(input: {
  characterId: number;
  characterName: string;
  supplies: readonly AdminListSupplyRow[];
}): { draft_key: string | null; supply_stage: string | null } {
  const staged = input.supplies.filter((row) => row.staged_character_id === input.characterId);
  if (input.characterName.trim() === LUCIAN_CANONICAL_NAME) {
    const approved = input.supplies.find((row) => row.draft_key === LUCIAN_DRAFT_KEY) ?? null;
    const predecessor = staged.find((row) => row.draft_key === LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY) ?? null;
    const foreign = staged.filter(
      (row) =>
        row.draft_key !== LUCIAN_DRAFT_KEY && row.draft_key !== LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY
    );
    const approvedLinkedHere = approved?.staged_character_id === input.characterId;
    const approvedUnlinked = approved != null && approved.staged_character_id == null;
    const approvedLinkedElsewhere =
      approved != null &&
      approved.staged_character_id != null &&
      approved.staged_character_id !== input.characterId;
    const predecessorPublishedHere =
      predecessor != null &&
      predecessor.staged_character_id === input.characterId &&
      isStageAtLeast(predecessor.stage as OfficialCharacterStage, "staged_private");
    const verifiedLucianPair =
      approved != null &&
      !approvedLinkedElsewhere &&
      foreign.length === 0 &&
      (approvedLinkedHere || (approvedUnlinked && predecessorPublishedHere));
    if (verifiedLucianPair) {
      return { draft_key: LUCIAN_DRAFT_KEY, supply_stage: approved.stage };
    }
    return { draft_key: null, supply_stage: null };
  }
  if (staged.length === 1 && staged[0]!.draft_key !== LUCIAN_DRAFT_KEY) {
    return { draft_key: staged[0]!.draft_key, supply_stage: staged[0]!.stage };
  }
  return { draft_key: null, supply_stage: null };
}

export function listOfficialCharactersForAdmin(): Array<{
  id: number;
  name: string;
  tagline: string;
  creator_id: number | null;
  creator_name: string;
  official: number;
  visibility: string;
  moderation_status: string;
  nsfw: number;
  updated_at: string | null;
  draft_key: string | null;
  supply_stage: string | null;
}> {
  const db = getDb();
  const supplyCandidateSql = sqliteTableExists(db, "official_supply_characters")
    ? `OR (c.official=0 AND c.id IN (
            SELECT staged_character_id FROM official_supply_characters
            WHERE staged_character_id IS NOT NULL AND stage='staged_private'
          ))`
    : "";
  const candidates = db
    .prepare(
      `SELECT c.id, c.name, c.tagline, c.creator_id, c.creator_name, c.official,
              c.visibility, c.moderation_status, c.nsfw, c.updated_at
       FROM characters c
       WHERE c.official=1
          OR c.creator_id IN (SELECT id FROM users WHERE site_managed=1)
          ${supplyCandidateSql}
       ORDER BY c.official DESC, c.id ASC`
    )
    .all() as Array<{
    id: number;
    name: string;
    tagline: string;
    creator_id: number | null;
    creator_name: string;
    official: number;
    visibility: string;
    moderation_status: string;
    nsfw: number;
    updated_at: string | null;
  }>;
  const characters = candidates.filter((row) => isOfficialManagedCharacterRow(row, db));
  const supplies = sqliteTableExists(db, "official_supply_characters")
    ? (db
        .prepare(
          `SELECT draft_key, staged_character_id, stage
           FROM official_supply_characters`
        )
        .all() as AdminListSupplyRow[])
    : [];
  return characters.map((row) => ({
    ...row,
    ...resolveAdminListSupply({
      characterId: row.id,
      characterName: row.name,
      supplies,
    }),
  }));
}

export function updateOfficialDisplayCreatorNameAsAdmin(input: {
  admin: OfficialAdminActor;
  characterId: number;
  displayCreatorName: string;
}): { ok: true; characterId: number; displayCreatorName: string } | { ok: false; error: string; status: number } {
  if (!isOfficialAdminActor(input.admin)) {
    return { ok: false, error: "관리자 권한이 필요합니다.", status: 403 };
  }
  const normalized = normalizeOfficialDisplayCreatorName(input.displayCreatorName);
  if (!normalized.ok) return { ok: false, error: normalized.error, status: 400 };

  const db = getDb();
  const row = db
    .prepare("SELECT id, official, creator_id FROM characters WHERE id=?")
    .get(input.characterId) as OfficialManageableCharacter | undefined;
  if (!row) return { ok: false, error: "캐릭터를 찾을 수 없습니다.", status: 404 };
  if (!canAdminManageOfficialCharacter(input.admin, row)) {
    return { ok: false, error: "공식 캐릭터만 공개 제작자명을 바꿀 수 있습니다.", status: 403 };
  }
  db.prepare("UPDATE characters SET creator_name=?, updated_at=datetime('now') WHERE id=?").run(
    normalized.value,
    row.id
  );
  return { ok: true, characterId: row.id, displayCreatorName: normalized.value };
}
