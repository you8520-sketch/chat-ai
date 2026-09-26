import { listableWhere } from "@/lib/characterVisibility";
import { OfficialSupplyGateError, type OfficialSupplyStore } from "@/lib/officialSupply/store";
import { isSiteManagedUser } from "@/lib/siteManagedAccounts";
import { notifyFollowersOfNewCharacter } from "@/lib/userNotifications";

export type OfficialPublishResult =
  | {
      status: "published";
      characterId: number;
      draftKey: string;
      official: 1;
      visibility: "public";
      moderationStatus: "approved";
    }
  | {
      status: "already_published";
      characterId: number;
      draftKey: string;
      official: 1;
      visibility: "public";
      moderationStatus: "approved";
    };

type PublishCharacterRow = {
  id: number;
  creator_id: number | null;
  creator_name: string;
  name: string;
  official: number;
  visibility: string;
  moderation_status: string;
  nsfw: number;
  participant_min_age: number | null;
  assets: string;
};

function parseAssets(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function assertPublishableAssets(assets: unknown[]): void {
  if (assets.length === 0) {
    throw new OfficialSupplyGateError("publish_assets_missing", "representative asset required before publish");
  }
  for (const asset of assets) {
    if (!asset || typeof asset !== "object") {
      throw new OfficialSupplyGateError("publish_asset_invalid", "asset entry is not an object");
    }
    const row = asset as Record<string, unknown>;
    if (typeof row.url !== "string" || !row.url.trim()) {
      throw new OfficialSupplyGateError("publish_asset_invalid", "asset url missing");
    }
    // Canonical CharacterAsset hard-reject field. Staging persists this exact
    // boolean via canonicalAssetModerationFields(); do not invent a second
    // moderation-status vocabulary at publish time.
    if (row.moderationReject === true) {
      throw new OfficialSupplyGateError("publish_moderation_reject", "hard-rejected asset blocks publish");
    }
  }
}

function isAlreadyPublished(row: PublishCharacterRow): boolean {
  return (
    row.official === 1 &&
    row.visibility === "public" &&
    row.moderation_status === "approved"
  );
}

/**
 * Canonical official-supply publish owner.
 *
 * Prerequisites:
 * - supply stage is `staged_private` (or already `published` for idempotent retry)
 * - staged character row exists and is owned by a site-managed studio account
 * - representative assets present; no hard-moderation reject
 *
 * Transition (single transaction):
 * - characters.visibility='public'
 * - characters.moderation_status='approved'
 * - characters.official=1  (product "공식" badge + existing official readers)
 * - supply stage → `published`
 *
 * Follower notification uses the existing idempotent per-character owner
 * (`notifyFollowersOfNewCharacter`). Bulk spam policy is a separate follow-up.
 */
export function publishOfficialSupplyCharacter(input: {
  store: OfficialSupplyStore;
  draftKey: string;
  /** Optional actor id for provenance logs; does not grant privileges. */
  actorUserId?: number | null;
}): OfficialPublishResult {
  const { store, draftKey } = input;
  const record = store.getCharacter(draftKey);

  if (record.stagedCharacterId == null) {
    throw new OfficialSupplyGateError("not_staged", `draft ${draftKey} has no staged character`);
  }
  if (record.stage !== "staged_private" && record.stage !== "published") {
    throw new OfficialSupplyGateError(
      "character_stage",
      `draft ${draftKey} is ${record.stage}; staged_private required`
    );
  }

  const characterId = record.stagedCharacterId;
  const db = store.database;

  // Stale supply assets (post-lock regenerate failure) must not publish.
  const stale = db
    .prepare(
      `SELECT slot_key FROM official_supply_assets
       WHERE draft_key=? AND status='stale' LIMIT 1`
    )
    .get(draftKey) as { slot_key: string } | undefined;
  if (stale) {
    throw new OfficialSupplyGateError(
      "publish_stale_assets",
      `draft ${draftKey} has stale asset ${stale.slot_key}`
    );
  }

  const row = db
    .prepare(
      `SELECT id, creator_id, creator_name, name, official, visibility, moderation_status,
              nsfw, participant_min_age, assets
       FROM characters WHERE id=?`
    )
    .get(characterId) as PublishCharacterRow | undefined;
  if (!row) {
    throw new OfficialSupplyGateError("character_missing", `character ${characterId} not found`);
  }
  if (!row.creator_id || !isSiteManagedUser(row.creator_id)) {
    throw new OfficialSupplyGateError(
      "owner_not_site_managed",
      `character ${characterId} owner is not a site-managed studio`
    );
  }

  assertPublishableAssets(parseAssets(row.assets));

  if (row.nsfw === 1) {
    const age = Number(row.participant_min_age ?? 0);
    if (!Number.isFinite(age) || age < 19) {
      throw new OfficialSupplyGateError(
        "publish_adult_invalid",
        `character ${characterId} NSFW requires participant_min_age >= 19`
      );
    }
  }

  if (isAlreadyPublished(row) && record.stage === "published") {
    return {
      status: "already_published",
      characterId,
      draftKey,
      official: 1,
      visibility: "public",
      moderationStatus: "approved",
    };
  }

  const creatorId = row.creator_id;
  const creatorName = String(row.creator_name || "").trim() || "공식 스튜디오";
  const characterAlreadyPublic = isAlreadyPublished(row);

  db.transaction(() => {
    // Re-read inside the transaction to keep publish atomic and idempotent.
    const live = db
      .prepare(
        `SELECT id, creator_id, official, visibility, moderation_status FROM characters WHERE id=?`
      )
      .get(characterId) as
      | {
          id: number;
          creator_id: number | null;
          official: number;
          visibility: string;
          moderation_status: string;
        }
      | undefined;
    if (!live || live.creator_id !== creatorId) {
      throw new OfficialSupplyGateError("publish_race", `character ${characterId} ownership changed`);
    }

    if (
      !(
        live.official === 1 &&
        live.visibility === "public" &&
        live.moderation_status === "approved"
      )
    ) {
      const updated = db
        .prepare(
          `UPDATE characters
           SET visibility='public',
               moderation_status='approved',
               moderation_note='',
               official=1,
               updated_at=datetime('now')
           WHERE id=? AND creator_id=?`
        )
        .run(characterId, creatorId);
      if (updated.changes !== 1) {
        throw new OfficialSupplyGateError("publish_update_failed", `character ${characterId} update failed`);
      }
    }

    store.markPublished(draftKey, characterId);

    // Idempotent per character id — safe for retry; bulk spam policy is follow-up.
    notifyFollowersOfNewCharacter(db, creatorId, creatorName, characterId, row.name);
  })();

  const after = db
    .prepare(
      `SELECT official, visibility, moderation_status FROM characters WHERE id=?`
    )
    .get(characterId) as {
    official: number;
    visibility: string;
    moderation_status: string;
  };

  if (
    after.official !== 1 ||
    after.visibility !== "public" ||
    after.moderation_status !== "approved"
  ) {
    throw new OfficialSupplyGateError("publish_incomplete", `character ${characterId} not fully published`);
  }

  // Sanity: must be listable via the public listing owner.
  const listed = db
    .prepare(`SELECT 1 AS ok FROM characters WHERE id=? AND ${listableWhere()}`)
    .get(characterId) as { ok: number } | undefined;
  if (!listed) {
    throw new OfficialSupplyGateError("publish_not_listable", `character ${characterId} failed listableWhere`);
  }

  return {
    status: characterAlreadyPublic ? "already_published" : "published",
    characterId,
    draftKey,
    official: 1,
    visibility: "public",
    moderationStatus: "approved",
  };
}
