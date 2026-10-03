import { getDb } from "@/lib/db";
import { isAdminUser } from "@/lib/isAdminUser";
import { normalizeOfficialDisplayCreatorName } from "@/lib/officialDisplayCreatorName";
import { OfficialSupplyStore } from "@/lib/officialSupply/store";
import { isSiteManagedUser } from "@/lib/siteManagedAccounts";

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

export function canAdminManageOfficialCharacter(
  admin: OfficialAdminActor | null | undefined,
  row: Pick<OfficialManageableCharacter, "official" | "creator_id"> | null | undefined
): boolean {
  if (!isOfficialAdminActor(admin) || !row) return false;
  if (row.official === 1) return true;
  return row.creator_id != null && isSiteManagedUser(row.creator_id);
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
  new OfficialSupplyStore(db);
  return db
    .prepare(
      `SELECT c.id, c.name, c.tagline, c.creator_id, c.creator_name, c.official,
              c.visibility, c.moderation_status, c.nsfw, c.updated_at,
              s.draft_key, s.stage AS supply_stage
       FROM characters c
       LEFT JOIN official_supply_characters s ON s.staged_character_id = c.id
       WHERE c.official=1
          OR c.creator_id IN (SELECT id FROM users WHERE site_managed=1)
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
    draft_key: string | null;
    supply_stage: string | null;
  }>;
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
