import crypto from "node:crypto";

import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import {
  canAdminManageOfficialCharacter,
  isOfficialAdminActor,
  sqliteTableExists,
  type OfficialAdminActor,
} from "@/lib/officialAdminAccess";
import { withSqliteQueryOnly } from "@/lib/officialSupply/inPlaceSync";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import { isSiteManagedUser } from "@/lib/siteManagedAccounts";

export const OFFICIAL_OWNER_TRANSFER_ENV = "OFFICIAL_OWNER_TRANSFER_ENABLED";

export type OfficialOwnerTransferMode = "dry_run" | "apply";

export type OfficialOwnerTransferActor = OfficialAdminActor & { id: number };

export type OfficialOwnerTransferSnapshot = {
  characterId: number;
  name: string;
  fromOwnerId: number;
  toOwnerId: number;
  official: number;
  visibility: string;
  moderationStatus: string;
  creatorName: string;
  rowHash: string;
  supplyDraftKeys: string[];
  lorebookIds: number[];
  lorebookOwnerIds: number[];
  token: string;
};

export type OfficialOwnerTransferResult = {
  mode: OfficialOwnerTransferMode;
  applied: boolean;
  characterId: number;
  name: string;
  fromOwnerId: number;
  toOwnerId: number;
  changedFields: Array<"creator_id">;
  sameCharacterId: true;
  createdNewCharacter: false;
  notifiedFollowers: false;
  displayCreatorName: string;
  lorebooks: Array<{ id: number; ownerId: number; sharedWithCharacterIds: number[] }>;
  preflightSnapshot: OfficialOwnerTransferSnapshot;
};

type CharacterRow = Record<string, unknown> & {
  id: number;
  name: string;
  creator_id: number | null;
  creator_name: string;
  official: number;
  visibility: string;
  moderation_status: string;
  nsfw: number;
};

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function isOfficialOwnerTransferEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[OFFICIAL_OWNER_TRANSFER_ENV] === "1";
}

function rowHashExcludingOwner(row: CharacterRow): string {
  const entries = Object.entries(row)
    .filter(([key]) => key !== "creator_id" && key !== "_metadata")
    .sort(([a], [b]) => (a < b ? -1 : 1));
  return sha256(JSON.stringify(entries));
}

function loadSupplyDraftKeys(db: Database.Database, characterId: number): string[] {
  if (!sqliteTableExists(db, "official_supply_characters")) return [];
  return (
    db
      .prepare(
        `SELECT draft_key FROM official_supply_characters
         WHERE staged_character_id=? ORDER BY draft_key ASC`
      )
      .all(characterId) as Array<{ draft_key: string }>
  ).map((row) => row.draft_key);
}

function loadAttachedLorebooks(
  db: Database.Database,
  characterId: number
): OfficialOwnerTransferResult["lorebooks"] {
  if (!sqliteTableExists(db, "character_lorebook_attachments")) return [];
  const attached = db
    .prepare(
      `SELECT a.lorebook_id AS id, l.creator_id AS ownerId
       FROM character_lorebook_attachments a
       JOIN keyword_lorebooks l ON l.id = a.lorebook_id
       WHERE a.character_id=? ORDER BY a.position ASC, a.lorebook_id ASC`
    )
    .all(characterId) as Array<{ id: number; ownerId: number }>;
  const sharedStmt = db.prepare(
    `SELECT character_id FROM character_lorebook_attachments
     WHERE lorebook_id=? AND character_id!=? ORDER BY character_id ASC`
  );
  return attached.map((item) => ({
    id: item.id,
    ownerId: item.ownerId,
    sharedWithCharacterIds: (
      sharedStmt.all(item.id, characterId) as Array<{ character_id: number }>
    ).map((row) => row.character_id),
  }));
}

type Inspected = {
  row: CharacterRow;
  toOwnerId: number;
  result: Omit<OfficialOwnerTransferResult, "mode" | "applied">;
};

function inspectTransfer(input: {
  db: Database.Database;
  admin: OfficialOwnerTransferActor;
  characterId: number;
}): Inspected {
  const { db, admin } = input;
  if (!isOfficialAdminActor(admin) || !Number.isInteger(admin.id) || admin.id <= 0) {
    throw new OfficialSupplyGateError("admin_required", "공식 캐릭터 소유권 이전은 관리자만 실행할 수 있습니다.");
  }
  const adminRow = db
    .prepare("SELECT id, is_adult, site_managed FROM users WHERE id=?")
    .get(admin.id) as { id: number; is_adult: number; site_managed: number } | undefined;
  if (!adminRow) {
    throw new OfficialSupplyGateError("admin_account_missing", `admin account ${admin.id} does not exist`);
  }
  if (Number(adminRow.site_managed) === 1) {
    throw new OfficialSupplyGateError(
      "admin_account_site_managed",
      "대상 소유자는 실제 관리자 계정이어야 하며 사이트 관리 계정일 수 없습니다."
    );
  }

  const row = db.prepare("SELECT * FROM characters WHERE id=?").get(input.characterId) as
    | CharacterRow
    | undefined;
  if (!row) {
    throw new OfficialSupplyGateError("character_missing", `character ${input.characterId} not found`);
  }
  if (row.creator_id == null) {
    throw new OfficialSupplyGateError("owner_missing", `character ${row.id} has no owner`);
  }
  if (row.official === 1 || row.visibility !== "private") {
    throw new OfficialSupplyGateError(
      "transfer_requires_private_unlisted",
      `character ${row.id} is official or not private; transferring a user-visible owner needs a separate approval`
    );
  }
  const supplyDraftKeys = loadSupplyDraftKeys(db, row.id);
  if (supplyDraftKeys.length === 0) {
    throw new OfficialSupplyGateError(
      "supply_link_required",
      `character ${row.id} is not linked to an official supply draft`
    );
  }
  if (row.nsfw === 1 && Number(adminRow.is_adult) !== 1) {
    throw new OfficialSupplyGateError("owner_not_adult", "성인 캐릭터의 소유자는 성인 인증된 관리자 계정이어야 합니다.");
  }
  const alreadyOwned = row.creator_id === admin.id;
  if (!alreadyOwned && !canAdminManageOfficialCharacter(admin, row)) {
    throw new OfficialSupplyGateError(
      "not_official_manageable",
      `character ${row.id} is owned by account ${row.creator_id}, which is not the site-managed official owner`
    );
  }
  if (!alreadyOwned && !isSiteManagedUser(row.creator_id)) {
    throw new OfficialSupplyGateError(
      "owner_not_site_managed",
      `character ${row.id} owner ${row.creator_id} is not the site-managed official account`
    );
  }

  const lorebooks = loadAttachedLorebooks(db, row.id);
  return {
    row,
    toOwnerId: admin.id,
    result: {
      characterId: row.id,
      name: row.name,
      fromOwnerId: row.creator_id,
      toOwnerId: admin.id,
      changedFields: alreadyOwned ? [] : ["creator_id"],
      sameCharacterId: true,
      createdNewCharacter: false,
      notifiedFollowers: false,
      displayCreatorName: row.creator_name,
      lorebooks,
      preflightSnapshot: buildSnapshot({ row, toOwnerId: admin.id, supplyDraftKeys, lorebooks }),
    },
  };
}

function buildSnapshot(input: {
  row: CharacterRow;
  toOwnerId: number;
  supplyDraftKeys: string[];
  lorebooks: OfficialOwnerTransferResult["lorebooks"];
}): OfficialOwnerTransferSnapshot {
  const parts = {
    characterId: input.row.id,
    name: input.row.name,
    fromOwnerId: input.row.creator_id!,
    toOwnerId: input.toOwnerId,
    official: input.row.official,
    visibility: input.row.visibility,
    moderationStatus: input.row.moderation_status,
    creatorName: input.row.creator_name,
    rowHash: rowHashExcludingOwner(input.row),
    supplyDraftKeys: input.supplyDraftKeys,
    lorebookIds: input.lorebooks.map((item) => item.id),
    lorebookOwnerIds: input.lorebooks.map((item) => item.ownerId),
  };
  return { ...parts, token: sha256(JSON.stringify(parts)) };
}

/**
 * Moves ONE staged, private official-supply character from the site-managed studio to the acting
 * admin account. It writes `characters.creator_id` and nothing else: manuscript, images, lorebooks,
 * attachments, supply rows, visibility, display creator name and `updated_at` stay untouched.
 * The target owner is always the acting admin; it can never be an arbitrary user id.
 */
export function transferOfficialCharacterOwnerToAdmin(input: {
  admin: OfficialOwnerTransferActor;
  characterId: number;
  mode: OfficialOwnerTransferMode;
  preflightSnapshot?: OfficialOwnerTransferSnapshot;
}): OfficialOwnerTransferResult {
  const db = getDb();

  if (input.mode === "dry_run") {
    const inspected = withSqliteQueryOnly(db, () =>
      inspectTransfer({ db, admin: input.admin, characterId: input.characterId })
    );
    return { ...inspected.result, mode: "dry_run", applied: false };
  }

  if (!isOfficialOwnerTransferEnabled()) {
    throw new OfficialSupplyGateError(
      "apply_disabled",
      `${OFFICIAL_OWNER_TRANSFER_ENV} is not 1; refusing owner transfer before an independently approved live DB receipt`
    );
  }
  if (!input.preflightSnapshot?.token) {
    throw new OfficialSupplyGateError(
      "preflight_required",
      "apply requires a revalidated dry-run preflightSnapshot; UI confirmation alone is not enough"
    );
  }

  return db.transaction(() => {
    const inspected = inspectTransfer({ db, admin: input.admin, characterId: input.characterId });
    if (inspected.result.preflightSnapshot.token !== input.preflightSnapshot!.token) {
      throw new OfficialSupplyGateError(
        "preflight_mismatch",
        "preflight snapshot no longer matches the live row; re-run dry_run"
      );
    }
    if (inspected.result.changedFields.length === 0) {
      return { ...inspected.result, mode: "apply" as const, applied: false };
    }

    const updated = db
      .prepare(
        `UPDATE characters SET creator_id=?
         WHERE id=? AND creator_id=? AND official=0 AND visibility='private'`
      )
      .run(inspected.toOwnerId, inspected.row.id, inspected.result.fromOwnerId);
    if (updated.changes !== 1) {
      throw new OfficialSupplyGateError(
        "transfer_write_mismatch",
        `character ${inspected.row.id} changed under the preflight snapshot; refusing owner transfer`
      );
    }

    const after = db.prepare("SELECT * FROM characters WHERE id=?").get(inspected.row.id) as CharacterRow;
    if (
      after.creator_id !== inspected.toOwnerId ||
      rowHashExcludingOwner(after) !== inspected.result.preflightSnapshot.rowHash
    ) {
      throw new OfficialSupplyGateError(
        "transfer_side_effect",
        "owner transfer changed a column other than creator_id; rolled back"
      );
    }
    return { ...inspected.result, mode: "apply" as const, applied: true };
  })();
}
