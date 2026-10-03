import crypto from "node:crypto";

import type { SessionUser } from "@/lib/characterFormSave";
import { updateCharacterFromForm } from "@/lib/characterFormSave";
import { parseAssets } from "@/lib/characterAssets";
import { getDb } from "@/lib/db";
import {
  canAdminManageOfficialCharacter,
  isOfficialAdminActor,
  loadOfficialOwnerSession,
} from "@/lib/officialAdminAccess";
import {
  LUCIAN_CANONICAL_NAME,
  LUCIAN_DEFAULT_DISPLAY_CREATOR_NAME,
  LUCIAN_DRAFT_KEY,
  normalizeOfficialDisplayCreatorName,
} from "@/lib/officialDisplayCreatorName";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import {
  buildOfficialCharacterFormBody,
  type OfficialCanonicalFormAsset,
} from "@/lib/officialSupply/characterText";
import { OfficialSupplyGateError, OfficialSupplyStore } from "@/lib/officialSupply/store";
import {
  insertCreatorLorebookForOwner,
  listCharacterCreatorLorebookAttachmentIds,
  updateCreatorLorebookForOwner,
} from "@/lib/creatorLorebook";
import { isSiteManagedUser } from "@/lib/siteManagedAccounts";
import type { OfficialWorldLorebookEntry } from "@/lib/officialSupply/types";

export type OfficialInPlaceSyncMode = "dry_run" | "apply";

export type OfficialInPlaceSyncResult = {
  mode: OfficialInPlaceSyncMode;
  characterId: number;
  draftKey: string;
  sameCharacterId: true;
  createdNewCharacter: false;
  notifiedFollowers: false;
  displayCreatorName: string;
  before: {
    name: string;
    tagline: string;
    descriptionHash: string;
    greetingHash: string;
    systemPromptHash: string;
    worldHash: string;
    creatorName: string;
    official: number;
    visibility: string;
    moderationStatus: string;
    assetCount: number;
    lorebookIds: number[];
    lorebookKeys: string[];
  };
  after: {
    tagline: string;
    descriptionHash: string;
    greetingHash: string;
    systemPromptHash: string;
    worldHash: string;
    creatorName: string;
    lorebookKeys: string[];
    lorebookCount: number;
  };
  changedFields: string[];
  applied: boolean;
};

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function syncWorldLorebooks(
  store: OfficialSupplyStore,
  worldKey: string,
  ownerId: number,
  entries: readonly OfficialWorldLorebookEntry[]
): { id: number; entryKey: string }[] {
  return entries.map((entry) => {
    const existing = store.findWorldLorebookId(worldKey, entry.entryKey, ownerId);
    if (existing != null) {
      const updated = updateCreatorLorebookForOwner(store.database, {
        lorebookId: existing,
        creatorId: ownerId,
        name: entry.name,
        summary: "",
        keywords: entry.keywords,
        content: entry.content,
      });
      if (!updated.ok) {
        throw new OfficialSupplyGateError("lorebook_invalid", `${entry.entryKey}: ${updated.error}`);
      }
      return { id: existing, entryKey: entry.entryKey };
    }
    const created = insertCreatorLorebookForOwner(store.database, {
      creatorId: ownerId,
      name: entry.name,
      summary: "",
      keywords: entry.keywords,
      content: entry.content,
    });
    if (!created.ok) {
      throw new OfficialSupplyGateError("lorebook_invalid", `${entry.entryKey}: ${created.error}`);
    }
    store.rememberWorldLorebook(worldKey, entry.entryKey, ownerId, created.id);
    return { id: created.id, entryKey: entry.entryKey };
  });
}

function existingLorebookKeys(
  store: OfficialSupplyStore,
  worldKey: string,
  ownerId: number,
  lorebookIds: readonly number[]
): string[] {
  const keys: string[] = [];
  for (const lorebookId of lorebookIds) {
    const mapped = store.database
      .prepare(
        `SELECT entry_key FROM official_supply_world_lorebooks
         WHERE world_key=? AND creator_id=? AND lorebook_id=?`
      )
      .get(worldKey, ownerId, lorebookId) as { entry_key: string } | undefined;
    if (mapped?.entry_key) keys.push(mapped.entry_key);
  }
  return keys;
}

export async function syncOfficialCharacterInPlace(input: {
  admin: SessionUser;
  characterId: number;
  draftKey?: string;
  mode: OfficialInPlaceSyncMode;
  displayCreatorName?: string;
}): Promise<OfficialInPlaceSyncResult> {
  if (!isOfficialAdminActor(input.admin)) {
    throw new OfficialSupplyGateError("admin_required", "공식 캐릭터 동기화는 관리자만 실행할 수 있습니다.");
  }

  const draftKey = input.draftKey?.trim() || LUCIAN_DRAFT_KEY;
  const source = loadCompiledOfficialCharacterSource(draftKey);
  const db = getDb();
  const store = new OfficialSupplyStore(db);

  const row = db
    .prepare(
      `SELECT id, name, tagline, description, greeting, system_prompt, world, creator_id, creator_name,
              official, visibility, moderation_status, assets, images
       FROM characters WHERE id=?`
    )
    .get(input.characterId) as
    | {
        id: number;
        name: string;
        tagline: string;
        description: string;
        greeting: string;
        system_prompt: string;
        world: string;
        creator_id: number | null;
        creator_name: string;
        official: number;
        visibility: string;
        moderation_status: string;
        assets: string;
        images: string;
      }
    | undefined;
  if (!row) {
    throw new OfficialSupplyGateError("character_missing", `character ${input.characterId} not found`);
  }
  if (!canAdminManageOfficialCharacter(input.admin, row)) {
    throw new OfficialSupplyGateError("not_official_manageable", `character ${row.id} is not an official-managed row`);
  }
  if (!row.creator_id || !isSiteManagedUser(row.creator_id)) {
    throw new OfficialSupplyGateError(
      "owner_not_site_managed",
      `character ${row.id} owner is not the site-managed official account`
    );
  }
  if (draftKey === LUCIAN_DRAFT_KEY && row.name.trim() !== LUCIAN_CANONICAL_NAME) {
    throw new OfficialSupplyGateError(
      "character_identity_mismatch",
      `refusing to sync ${draftKey} onto character ${row.id} named ${row.name}`
    );
  }

  const supply = db
    .prepare("SELECT draft_key, staged_character_id FROM official_supply_characters WHERE staged_character_id=?")
    .get(row.id) as { draft_key: string; staged_character_id: number } | undefined;
  if (supply && supply.draft_key !== draftKey) {
    throw new OfficialSupplyGateError(
      "supply_draft_mismatch",
      `character ${row.id} is linked to ${supply.draft_key}, not ${draftKey}`
    );
  }
  const officialDuplicate = db
    .prepare("SELECT id FROM characters WHERE name=? AND official=1 AND id!=? LIMIT 1")
    .get(row.name, row.id) as { id: number } | undefined;
  if (officialDuplicate && draftKey === LUCIAN_DRAFT_KEY) {
    throw new OfficialSupplyGateError(
      "duplicate_official_character",
      `another official row already uses this name; refusing to sync`
    );
  }

  const owner = loadOfficialOwnerSession(row.creator_id);
  if (!owner) {
    throw new OfficialSupplyGateError("owner_missing", "site-managed official owner session is unavailable");
  }

  const requestedAlias =
    input.displayCreatorName ??
    (row.name.trim() === LUCIAN_CANONICAL_NAME ? LUCIAN_DEFAULT_DISPLAY_CREATOR_NAME : row.creator_name);
  const alias = normalizeOfficialDisplayCreatorName(requestedAlias);
  if (!alias.ok) {
    throw new OfficialSupplyGateError("display_name_invalid", alias.error);
  }

  const attachedIds = listCharacterCreatorLorebookAttachmentIds(db, row.id);
  const beforeKeys = existingLorebookKeys(store, source.worldKey, owner.id, attachedIds);
  const assets: OfficialCanonicalFormAsset[] = parseAssets(row.assets).map((asset, index) => {
    if (asset.width == null || asset.height == null) {
      throw new OfficialSupplyGateError("publish_asset_invalid", "existing asset is missing width/height");
    }
    return {
      url: asset.url,
      tag: asset.tag,
      width: asset.width,
      height: asset.height,
      viewerBlur: asset.viewerBlur === true,
      representativeRank: asset.representativeRank ?? (index === 0 ? 1 : undefined),
      adultFlagged: asset.adultFlagged,
      moderationReject: asset.moderationReject,
      moderationReason: asset.moderationReason,
    };
  });
  if (assets.length === 0) {
    throw new OfficialSupplyGateError("publish_assets_missing", "existing representative assets are required");
  }

  const compiledBody = buildOfficialCharacterFormBody({
    draft: source.draft,
    appearanceBlock: source.appearanceBlock,
    assets,
    lorebookIds: attachedIds,
  });
  const compiledDescription = String(compiledBody.description ?? "");
  const compiledGreeting = String(compiledBody.greeting ?? "");
  const compiledSystem = String(compiledBody.system_prompt ?? "");
  const compiledWorld = String(compiledBody.world ?? "");

  const before = {
    name: row.name,
    tagline: row.tagline,
    descriptionHash: sha256(row.description ?? ""),
    greetingHash: sha256(row.greeting ?? ""),
    systemPromptHash: sha256(row.system_prompt ?? ""),
    worldHash: sha256(row.world ?? ""),
    creatorName: row.creator_name,
    official: row.official,
    visibility: row.visibility,
    moderationStatus: row.moderation_status,
    assetCount: assets.length,
    lorebookIds: attachedIds,
    lorebookKeys: beforeKeys,
  };
  const afterPreview = {
    tagline: source.draft.tagline,
    descriptionHash: sha256(compiledDescription),
    greetingHash: sha256(compiledGreeting),
    systemPromptHash: sha256(compiledSystem),
    worldHash: sha256(compiledWorld),
    creatorName: alias.value,
    lorebookKeys: source.resolvedLorebook.map((entry) => entry.entryKey),
    lorebookCount: source.resolvedLorebook.length,
  };
  const changedFields = (
    [
      ["tagline", row.tagline !== afterPreview.tagline],
      ["description", before.descriptionHash !== afterPreview.descriptionHash],
      ["greeting", before.greetingHash !== afterPreview.greetingHash],
      ["system_prompt", before.systemPromptHash !== afterPreview.systemPromptHash],
      ["world", before.worldHash !== afterPreview.worldHash],
      ["creator_name", before.creatorName !== afterPreview.creatorName],
      ["lorebook", JSON.stringify(before.lorebookKeys) !== JSON.stringify(afterPreview.lorebookKeys)],
    ] as const
  )
    .filter(([, changed]) => changed)
    .map(([field]) => field);

  if (input.mode === "dry_run") {
    return {
      mode: "dry_run",
      characterId: row.id,
      draftKey,
      sameCharacterId: true,
      createdNewCharacter: false,
      notifiedFollowers: false,
      displayCreatorName: alias.value,
      before,
      after: afterPreview,
      changedFields,
      applied: false,
    };
  }

  const synced = syncWorldLorebooks(store, source.worldKey, owner.id, source.resolvedLorebook);
  const body = {
    ...compiledBody,
    visibility: row.visibility,
    lorebook_ids: synced.map((entry) => entry.id),
  };
  const saved = await updateCharacterFromForm(owner, row.id, body, {
    actor: "official_admin",
    adminUser: input.admin,
    displayCreatorName: alias.value,
    preserveListingState: true,
    preserveAdultFlags: true,
    skipFollowerNotify: true,
  });
  if (!saved.ok) {
    throw new OfficialSupplyGateError("canonical_save_rejected", saved.error);
  }

  const afterRow = db
    .prepare("SELECT id, tagline, creator_name, official, visibility FROM characters WHERE id=?")
    .get(row.id) as { id: number; tagline: string; creator_name: string; official: number; visibility: string };
  if (afterRow.id !== row.id) {
    throw new OfficialSupplyGateError("identity_changed", "in-place sync must keep the same character id");
  }
  if (afterRow.official !== row.official || afterRow.visibility !== row.visibility) {
    throw new OfficialSupplyGateError("listing_changed", "in-place sync must preserve official/visibility");
  }

  if (supply) {
    db.prepare(
      `UPDATE official_supply_characters
       SET draft_json=?, updated_at=datetime('now')
       WHERE staged_character_id=? AND draft_key=?`
    ).run(JSON.stringify(source.draft), row.id, draftKey);
  }

  return {
    mode: "apply",
    characterId: row.id,
    draftKey,
    sameCharacterId: true,
    createdNewCharacter: false,
    notifiedFollowers: false,
    displayCreatorName: alias.value,
    before,
    after: {
      ...afterPreview,
      tagline: afterRow.tagline,
      creatorName: afterRow.creator_name,
      lorebookKeys: synced.map((entry) => entry.entryKey),
      lorebookCount: synced.length,
    },
    changedFields,
    applied: true,
  };
}
