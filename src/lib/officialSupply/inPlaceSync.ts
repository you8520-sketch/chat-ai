import crypto from "node:crypto";

import type Database from "better-sqlite3";

import type { SessionUser } from "@/lib/characterFormSave";
import { parseAssets } from "@/lib/characterAssets";
import { buildAndSaveCharacterChunks } from "@/lib/characterChunks";
import { primaryCharacterGenre, sanitizeCharacterGenres } from "@/lib/characterGenres";
import { resolveCharacterGender } from "@/lib/characterGender";
import { parseCharacterTagsInput } from "@/lib/characterTags";
import { getDb } from "@/lib/db";
import { enqueueCharacterDerivedRefreshJob } from "@/lib/derivedCache/characterEnqueue";
import { kickDerivedCacheWorker } from "@/lib/derivedCache/jobs";
import {
  ensureCreatorLorebookSchema,
  insertCreatorLorebookForOwner,
  listCharacterCreatorLorebookAttachmentIds,
  parseCreatorLorebookUnitEntry,
  updateCreatorLorebookForOwner,
} from "@/lib/creatorLorebook";
import {
  canAdminManageOfficialCharacter,
  isOfficialAdminActor,
  loadOfficialOwnerSession,
  sqliteTableExists,
} from "@/lib/officialAdminAccess";
import {
  LUCIAN_CANONICAL_NAME,
  LUCIAN_DEFAULT_DISPLAY_CREATOR_NAME,
  LUCIAN_DRAFT_KEY,
  normalizeOfficialDisplayCreatorName,
} from "@/lib/officialDisplayCreatorName";
import { composeOfficialCreatorComment } from "@/lib/officialSupply/publicProfileText";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import { isStageAtLeast, type OfficialCharacterStage, type OfficialWorldLorebookEntry } from "@/lib/officialSupply/types";
import { isSiteManagedUser } from "@/lib/siteManagedAccounts";
import { composeExampleDialog } from "@/lib/speechCreatorFields";

export const OFFICIAL_IN_PLACE_APPLY_ENV = "OFFICIAL_IN_PLACE_APPLY_ENABLED";

export type OfficialInPlaceSyncMode = "dry_run" | "apply";
export type OfficialInPlaceTestInjectFailure = "after_lorebook_write";

export type OfficialInPlacePreflightSnapshot = {
  characterId: number;
  draftKey: string;
  name: string;
  creatorId: number;
  official: number;
  visibility: string;
  moderationStatus: string;
  tagline: string;
  descriptionHash: string;
  greetingHash: string;
  systemPromptHash: string;
  worldHash: string;
  creatorName: string;
  assetsHash: string;
  lorebookIds: number[];
  token: string;
};

export type OfficialInPlaceLorebookPlan = {
  entryKey: string;
  lorebookId: number | null;
  action: "insert" | "update" | "skip_identical";
  shared: boolean;
  linkedCharacterIds: number[];
};

export type OfficialInPlaceSyncResult = {
  mode: OfficialInPlaceSyncMode;
  characterId: number;
  draftKey: string;
  sameCharacterId: true;
  createdNewCharacter: false;
  notifiedFollowers: false;
  displayCreatorName: string;
  systemPromptHash: string;
  appearanceKind: "runtime_compact" | "full_visual";
  preflightSnapshot: OfficialInPlacePreflightSnapshot;
  lorebookPlan: OfficialInPlaceLorebookPlan[];
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

type OfficialCharacterRow = {
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
  nsfw: number;
  comments_enabled: number;
  assets: string;
  images: string;
  gender: string | null;
  example_dialog: string;
  creator_comment: string;
  tags: string;
  genres: string;
  genre: string;
  status_widget_json: string;
  jsx_components_json: string;
  recommended_writing_style: string;
  narration_style_instructions: string;
  appearance_raw: string;
  appearance_compiled: string;
  likes: number;
  chats_count: number;
};

type SupplyLink = {
  draft_key: string;
  staged_character_id: number;
  stage: string;
};

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

export function isOfficialInPlaceApplyEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[OFFICIAL_IN_PLACE_APPLY_ENV] === "1";
}

export function withSqliteQueryOnly<T>(db: Database.Database, fn: () => T): T {
  db.pragma("query_only = ON");
  try {
    return fn();
  } finally {
    db.pragma("query_only = OFF");
  }
}

function loadSupplyLink(db: Database.Database, characterId: number): SupplyLink | null {
  if (!sqliteTableExists(db, "official_supply_characters")) return null;
  const row = db
    .prepare(
      `SELECT draft_key, staged_character_id, stage
       FROM official_supply_characters
       WHERE staged_character_id=?`
    )
    .get(characterId) as SupplyLink | undefined;
  return row ?? null;
}

function findWorldLorebookId(
  db: Database.Database,
  worldKey: string,
  entryKey: string,
  ownerId: number
): number | null {
  if (!sqliteTableExists(db, "official_supply_world_lorebooks")) return null;
  const row = db
    .prepare(
      `SELECT lorebook_id FROM official_supply_world_lorebooks
       WHERE world_key=? AND entry_key=? AND creator_id=?`
    )
    .get(worldKey, entryKey, ownerId) as { lorebook_id: number } | undefined;
  return row?.lorebook_id ?? null;
}

function rememberWorldLorebook(
  db: Database.Database,
  worldKey: string,
  entryKey: string,
  ownerId: number,
  lorebookId: number
): void {
  if (!sqliteTableExists(db, "official_supply_world_lorebooks")) {
    throw new OfficialSupplyGateError(
      "supply_schema_missing",
      "official_supply_world_lorebooks is required before writing a new mapping"
    );
  }
  db.prepare(
    `INSERT OR IGNORE INTO official_supply_world_lorebooks
     (world_key, entry_key, creator_id, lorebook_id) VALUES (?, ?, ?, ?)`
  ).run(worldKey, entryKey, ownerId, lorebookId);
}

function existingLorebookKeys(
  db: Database.Database,
  worldKey: string,
  ownerId: number,
  lorebookIds: readonly number[]
): string[] {
  if (!sqliteTableExists(db, "official_supply_world_lorebooks")) return [];
  const keys: string[] = [];
  for (const lorebookId of lorebookIds) {
    const mapped = db
      .prepare(
        `SELECT entry_key FROM official_supply_world_lorebooks
         WHERE world_key=? AND creator_id=? AND lorebook_id=?`
      )
      .get(worldKey, ownerId, lorebookId) as { entry_key: string } | undefined;
    if (mapped?.entry_key) keys.push(mapped.entry_key);
  }
  return keys;
}

function linkedCharacterIds(db: Database.Database, lorebookId: number, exceptCharacterId: number): number[] {
  if (!sqliteTableExists(db, "character_lorebook_attachments")) return [];
  return (
    db
      .prepare(
        `SELECT character_id FROM character_lorebook_attachments
         WHERE lorebook_id=? AND character_id!=?
         ORDER BY character_id ASC`
      )
      .all(lorebookId, exceptCharacterId) as Array<{ character_id: number }>
  ).map((row) => row.character_id);
}

function lorebookUnitMatches(
  row: { name: string; entries_json: string },
  entry: OfficialWorldLorebookEntry
): boolean {
  const parsed = parseCreatorLorebookUnitEntry(row.entries_json);
  if (!parsed) return false;
  const nextKeywords = entry.keywords.map((word) => word.trim()).filter(Boolean);
  return (
    row.name === entry.name &&
    parsed.content === entry.content.trim() &&
    JSON.stringify(parsed.keywords) === JSON.stringify(nextKeywords)
  );
}

function planWorldLorebooks(input: {
  db: Database.Database;
  worldKey: string;
  ownerId: number;
  characterId: number;
  sharedKeys: ReadonlySet<string>;
  entries: readonly OfficialWorldLorebookEntry[];
}): OfficialInPlaceLorebookPlan[] {
  return input.entries.map((entry) => {
    const existingId = findWorldLorebookId(input.db, input.worldKey, entry.entryKey, input.ownerId);
    if (existingId == null) {
      return {
        entryKey: entry.entryKey,
        lorebookId: null,
        action: "insert" as const,
        shared: input.sharedKeys.has(entry.entryKey),
        linkedCharacterIds: [],
      };
    }
    const row = input.db
      .prepare("SELECT name, entries_json FROM keyword_lorebooks WHERE id=? AND creator_id=?")
      .get(existingId, input.ownerId) as { name: string; entries_json: string } | undefined;
    const identical = row ? lorebookUnitMatches(row, entry) : false;
    return {
      entryKey: entry.entryKey,
      lorebookId: existingId,
      action: identical ? ("skip_identical" as const) : ("update" as const),
      shared: input.sharedKeys.has(entry.entryKey),
      linkedCharacterIds: linkedCharacterIds(input.db, existingId, input.characterId),
    };
  });
}

function applyWorldLorebooks(input: {
  db: Database.Database;
  worldKey: string;
  ownerId: number;
  plan: readonly OfficialInPlaceLorebookPlan[];
  entries: readonly OfficialWorldLorebookEntry[];
}): { id: number; entryKey: string }[] {
  return input.plan.map((item) => {
    const entry = input.entries.find((candidate) => candidate.entryKey === item.entryKey);
    if (!entry) {
      throw new OfficialSupplyGateError("lorebook_invalid", `${item.entryKey}: compiled entry missing`);
    }
    if (item.action === "skip_identical" && item.lorebookId != null) {
      return { id: item.lorebookId, entryKey: item.entryKey };
    }
    if (item.action === "update" && item.lorebookId != null) {
      const updated = updateCreatorLorebookForOwner(input.db, {
        lorebookId: item.lorebookId,
        creatorId: input.ownerId,
        name: entry.name,
        summary: "",
        keywords: entry.keywords,
        content: entry.content,
      });
      if (!updated.ok) {
        throw new OfficialSupplyGateError("lorebook_invalid", `${entry.entryKey}: ${updated.error}`);
      }
      return { id: item.lorebookId, entryKey: item.entryKey };
    }
    const created = insertCreatorLorebookForOwner(input.db, {
      creatorId: input.ownerId,
      name: entry.name,
      summary: "",
      keywords: entry.keywords,
      content: entry.content,
    });
    if (!created.ok) {
      throw new OfficialSupplyGateError("lorebook_invalid", `${entry.entryKey}: ${created.error}`);
    }
    rememberWorldLorebook(input.db, input.worldKey, entry.entryKey, input.ownerId, created.id);
    return { id: created.id, entryKey: entry.entryKey };
  });
}

function snapshotToken(parts: Omit<OfficialInPlacePreflightSnapshot, "token">): string {
  return sha256(
    JSON.stringify({
      characterId: parts.characterId,
      draftKey: parts.draftKey,
      name: parts.name,
      creatorId: parts.creatorId,
      official: parts.official,
      visibility: parts.visibility,
      moderationStatus: parts.moderationStatus,
      tagline: parts.tagline,
      descriptionHash: parts.descriptionHash,
      greetingHash: parts.greetingHash,
      systemPromptHash: parts.systemPromptHash,
      worldHash: parts.worldHash,
      creatorName: parts.creatorName,
      assetsHash: parts.assetsHash,
      lorebookIds: parts.lorebookIds,
    })
  );
}

function buildPreflightSnapshot(input: {
  characterId: number;
  draftKey: string;
  row: OfficialCharacterRow;
  assetsJson: string;
  lorebookIds: readonly number[];
}): OfficialInPlacePreflightSnapshot {
  const parts = {
    characterId: input.characterId,
    draftKey: input.draftKey,
    name: input.row.name,
    creatorId: Number(input.row.creator_id),
    official: input.row.official,
    visibility: input.row.visibility,
    moderationStatus: input.row.moderation_status,
    tagline: input.row.tagline,
    descriptionHash: sha256(input.row.description ?? ""),
    greetingHash: sha256(input.row.greeting ?? ""),
    systemPromptHash: sha256(input.row.system_prompt ?? ""),
    worldHash: sha256(input.row.world ?? ""),
    creatorName: input.row.creator_name,
    assetsHash: sha256(input.assetsJson),
    lorebookIds: [...input.lorebookIds],
  };
  return { ...parts, token: snapshotToken(parts) };
}

function requireLucianSupplyLink(input: {
  draftKey: string;
  row: OfficialCharacterRow;
  supply: SupplyLink | null;
}): SupplyLink {
  if (input.draftKey !== LUCIAN_DRAFT_KEY) {
    if (input.supply && input.supply.draft_key !== input.draftKey) {
      throw new OfficialSupplyGateError(
        "supply_draft_mismatch",
        `character ${input.row.id} is linked to ${input.supply.draft_key}, not ${input.draftKey}`
      );
    }
    return input.supply ?? {
      draft_key: input.draftKey,
      staged_character_id: input.row.id,
      stage: "published",
    };
  }
  if (!input.supply) {
    throw new OfficialSupplyGateError(
      "supply_mapping_required",
      `Lucian in-place requires official_supply_characters draft_key=${LUCIAN_DRAFT_KEY} ↔ staged_character_id=${input.row.id}`
    );
  }
  if (input.supply.draft_key !== LUCIAN_DRAFT_KEY || input.supply.staged_character_id !== input.row.id) {
    throw new OfficialSupplyGateError(
      "supply_draft_mismatch",
      `character ${input.row.id} is linked to ${input.supply.draft_key}, not ${LUCIAN_DRAFT_KEY}`
    );
  }
  if (!isStageAtLeast(input.supply.stage as OfficialCharacterStage, "staged_private")) {
    throw new OfficialSupplyGateError(
      "supply_stage_required",
      `Lucian mapping stage ${input.supply.stage} is below staged_private`
    );
  }
  return input.supply;
}

function inspectTarget(input: {
  admin: SessionUser;
  characterId: number;
  draftKey: string;
  displayCreatorName?: string;
}): {
  row: OfficialCharacterRow;
  owner: NonNullable<ReturnType<typeof loadOfficialOwnerSession>>;
  source: ReturnType<typeof loadCompiledOfficialCharacterSource>;
  alias: string;
  attachedIds: number[];
  beforeKeys: string[];
  assetsJson: string;
  compiled: {
    tagline: string;
    description: string;
    greeting: string;
    systemPrompt: string;
    world: string;
    creatorComment: string;
    exampleDialog: string;
    tagsJson: string;
    genresJson: string;
    primaryGenre: string;
  };
  lorebookPlan: OfficialInPlaceLorebookPlan[];
  supply: SupplyLink;
} {
  const db = getDb();
  const source = loadCompiledOfficialCharacterSource(input.draftKey);
  const row = db
    .prepare(
      `SELECT id, name, tagline, description, greeting, system_prompt, world, creator_id, creator_name,
              official, visibility, moderation_status, nsfw, comments_enabled, assets, images, gender,
              COALESCE(example_dialog, '') AS example_dialog,
              COALESCE(creator_comment, '') AS creator_comment,
              COALESCE(tags, '[]') AS tags,
              COALESCE(genres, '[]') AS genres,
              COALESCE(genre, '') AS genre,
              COALESCE(status_widget_json, '') AS status_widget_json,
              COALESCE(jsx_components_json, '') AS jsx_components_json,
              COALESCE(recommended_writing_style, '') AS recommended_writing_style,
              COALESCE(narration_style_instructions, '') AS narration_style_instructions,
              COALESCE(appearance_raw, '') AS appearance_raw,
              COALESCE(appearance_compiled, '') AS appearance_compiled,
              COALESCE(likes, 0) AS likes,
              COALESCE(chats_count, 0) AS chats_count
       FROM characters WHERE id=?`
    )
    .get(input.characterId) as OfficialCharacterRow | undefined;
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
  if (input.draftKey === LUCIAN_DRAFT_KEY && row.name.trim() !== LUCIAN_CANONICAL_NAME) {
    throw new OfficialSupplyGateError(
      "character_identity_mismatch",
      `refusing to sync ${input.draftKey} onto character ${row.id} named ${row.name}`
    );
  }

  const supply = requireLucianSupplyLink({
    draftKey: input.draftKey,
    row,
    supply: loadSupplyLink(db, row.id),
  });

  const officialDuplicate = db
    .prepare("SELECT id FROM characters WHERE name=? AND official=1 AND id!=? LIMIT 1")
    .get(row.name, row.id) as { id: number } | undefined;
  if (officialDuplicate && input.draftKey === LUCIAN_DRAFT_KEY) {
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

  const assets = parseAssets(row.assets);
  if (assets.length === 0) {
    throw new OfficialSupplyGateError("publish_assets_missing", "existing representative assets are required");
  }

  const attachedIds = listCharacterCreatorLorebookAttachmentIds(db, row.id);
  const beforeKeys = existingLorebookKeys(db, source.worldKey, owner.id, attachedIds);
  const sharedKeys = new Set(source.sharedLorebook.map((entry) => entry.entryKey));
  const lorebookPlan = planWorldLorebooks({
    db,
    worldKey: source.worldKey,
    ownerId: owner.id,
    characterId: row.id,
    sharedKeys,
    entries: source.resolvedLorebook,
  });

  const genres = sanitizeCharacterGenres(source.draft.genres);
  const compiled = {
    tagline: source.draft.tagline,
    description: source.draft.description,
    greeting: source.draft.greeting,
    systemPrompt: source.systemPrompt,
    world: source.draft.sections.worldAndSituation,
    creatorComment: composeOfficialCreatorComment(source.draft),
    exampleDialog: composeExampleDialog({
      speech_personality: source.draft.speech.personality,
      speech_traits: source.draft.speech.traits,
      speech_examples: source.draft.speech.examples,
      speech_forbidden: source.draft.speech.forbidden,
    }),
    tagsJson: JSON.stringify(parseCharacterTagsInput(source.draft.tags)),
    genresJson: JSON.stringify(genres),
    primaryGenre: primaryCharacterGenre(genres),
  };

  return {
    row,
    owner,
    source,
    alias: alias.value,
    attachedIds,
    beforeKeys,
    assetsJson: row.assets,
    compiled,
    lorebookPlan,
    supply,
  };
}

function toResult(input: {
  mode: OfficialInPlaceSyncMode;
  inspected: ReturnType<typeof inspectTarget>;
  applied: boolean;
  lorebookKeys?: string[];
}): OfficialInPlaceSyncResult {
  const { row, source, compiled, alias, attachedIds, beforeKeys, assetsJson, lorebookPlan } = input.inspected;
  const preflightSnapshot = buildPreflightSnapshot({
    characterId: row.id,
    draftKey: source.draftKey,
    row,
    assetsJson,
    lorebookIds: attachedIds,
  });
  const after = {
    tagline: compiled.tagline,
    descriptionHash: sha256(compiled.description),
    greetingHash: sha256(compiled.greeting),
    systemPromptHash: sha256(compiled.systemPrompt),
    worldHash: sha256(compiled.world),
    creatorName: alias,
    lorebookKeys: input.lorebookKeys ?? source.resolvedLorebook.map((entry) => entry.entryKey),
    lorebookCount: source.resolvedLorebook.length,
  };
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
    assetCount: parseAssets(row.assets).length,
    lorebookIds: attachedIds,
    lorebookKeys: beforeKeys,
  };
  const changedFields = (
    [
      ["tagline", row.tagline !== after.tagline],
      ["description", before.descriptionHash !== after.descriptionHash],
      ["greeting", before.greetingHash !== after.greetingHash],
      ["system_prompt", before.systemPromptHash !== after.systemPromptHash],
      ["world", before.worldHash !== after.worldHash],
      ["creator_name", before.creatorName !== after.creatorName],
      ["lorebook", JSON.stringify(before.lorebookKeys) !== JSON.stringify(after.lorebookKeys)],
    ] as const
  )
    .filter(([, changed]) => changed)
    .map(([field]) => field);

  return {
    mode: input.mode,
    characterId: row.id,
    draftKey: source.draftKey,
    sameCharacterId: true,
    createdNewCharacter: false,
    notifiedFollowers: false,
    displayCreatorName: alias,
    systemPromptHash: after.systemPromptHash,
    appearanceKind: source.draft.promptStandard === "compact_rp_v1" ? "runtime_compact" : "full_visual",
    preflightSnapshot,
    lorebookPlan,
    before,
    after,
    changedFields,
    applied: input.applied,
  };
}

function applyGuardedCanonicalFields(input: {
  db: Database.Database;
  inspected: ReturnType<typeof inspectTarget>;
  testInjectFailure?: OfficialInPlaceTestInjectFailure;
}): { id: number; entryKey: string }[] {
  const { row, owner, source, compiled, alias, lorebookPlan, supply } = input.inspected;
  const applyTx = input.db.transaction(() => {
    const synced = applyWorldLorebooks({
      db: input.db,
      worldKey: source.worldKey,
      ownerId: owner.id,
      plan: lorebookPlan,
      entries: source.resolvedLorebook,
    });
    if (input.testInjectFailure === "after_lorebook_write") {
      throw new OfficialSupplyGateError(
        "test_injected_failure",
        "injected failure after lorebook write"
      );
    }

    const updated = input.db
      .prepare(
        `UPDATE characters SET
           tagline=?, description=?, greeting=?, system_prompt=?, world=?,
           creator_comment=?, example_dialog=?, tags=?, genre=?, genres=?, creator_name=?,
           updated_at=datetime('now')
         WHERE id=?
           AND creator_id=?
           AND official=?
           AND visibility=?
           AND moderation_status=?
           AND nsfw=?
           AND comments_enabled=?
           AND COALESCE(assets,'')=?
           AND COALESCE(status_widget_json,'')=?
           AND COALESCE(jsx_components_json,'')=?
           AND COALESCE(recommended_writing_style,'')=?
           AND COALESCE(narration_style_instructions,'')=?
           AND COALESCE(appearance_raw,'')=?
           AND COALESCE(appearance_compiled,'')=?
           AND COALESCE(likes,0)=?
           AND COALESCE(chats_count,0)=?`
      )
      .run(
        compiled.tagline,
        compiled.description,
        compiled.greeting,
        compiled.systemPrompt,
        compiled.world,
        compiled.creatorComment,
        compiled.exampleDialog,
        compiled.tagsJson,
        compiled.primaryGenre,
        compiled.genresJson,
        alias,
        row.id,
        row.creator_id,
        row.official,
        row.visibility,
        row.moderation_status,
        row.nsfw,
        row.comments_enabled,
        row.assets,
        row.status_widget_json,
        row.jsx_components_json,
        row.recommended_writing_style,
        row.narration_style_instructions,
        row.appearance_raw,
        row.appearance_compiled,
        row.likes,
        row.chats_count
      );
    if (updated.changes !== 1) {
      throw new OfficialSupplyGateError(
        "preserved_fields_changed",
        "refusing apply because unrelated Lucian fields changed under the preflight snapshot"
      );
    }

    input.db.prepare("DELETE FROM character_lorebook_attachments WHERE character_id=?").run(row.id);
    const attach = input.db.prepare(
      `INSERT INTO character_lorebook_attachments (character_id, lorebook_id, position)
       VALUES (?, ?, ?)`
    );
    synced.forEach((entry, position) => {
      attach.run(row.id, entry.id, position);
    });
    buildAndSaveCharacterChunks(row.id, {
      name: row.name,
      gender: resolveCharacterGender(row.gender),
      systemPrompt: compiled.systemPrompt,
      world: compiled.world,
      exampleDialog: compiled.exampleDialog,
      speechInput: {
        speech_personality: source.draft.speech.personality,
        speech_traits: source.draft.speech.traits,
        speech_examples: source.draft.speech.examples,
        speech_forbidden: source.draft.speech.forbidden,
      },
    });

    if (sqliteTableExists(input.db, "official_supply_characters")) {
      input.db
        .prepare(
          `UPDATE official_supply_characters
           SET draft_json=?, updated_at=datetime('now')
           WHERE staged_character_id=? AND draft_key=?`
        )
        .run(JSON.stringify(source.draft), row.id, supply.draft_key);
    }
    return synced;
  });
  return applyTx();
}

export async function syncOfficialCharacterInPlace(input: {
  admin: SessionUser;
  characterId: number;
  draftKey?: string;
  mode: OfficialInPlaceSyncMode;
  displayCreatorName?: string;
  preflightSnapshot?: OfficialInPlacePreflightSnapshot;
  testInjectFailure?: OfficialInPlaceTestInjectFailure;
}): Promise<OfficialInPlaceSyncResult> {
  if (!isOfficialAdminActor(input.admin)) {
    throw new OfficialSupplyGateError("admin_required", "공식 캐릭터 동기화는 관리자만 실행할 수 있습니다.");
  }
  if (input.testInjectFailure && process.env.NODE_TEST_CONTEXT == null) {
    throw new OfficialSupplyGateError("test_hook_forbidden", "testInjectFailure is test-only");
  }

  const draftKey = input.draftKey?.trim() || LUCIAN_DRAFT_KEY;
  const db = getDb();
  const inspectInput = {
    admin: input.admin,
    characterId: input.characterId,
    draftKey,
    displayCreatorName: input.displayCreatorName,
  };

  if (input.mode === "dry_run") {
    return withSqliteQueryOnly(db, () => toResult({
      mode: "dry_run",
      inspected: inspectTarget(inspectInput),
      applied: false,
    }));
  }

  if (!isOfficialInPlaceApplyEnabled()) {
    throw new OfficialSupplyGateError(
      "apply_disabled",
      `${OFFICIAL_IN_PLACE_APPLY_ENV} is not 1; refusing in-place apply before an independently approved live DB receipt`
    );
  }
  if (!input.preflightSnapshot?.token) {
    throw new OfficialSupplyGateError(
      "preflight_required",
      "apply requires a revalidated dry-run preflightSnapshot; UI confirmation alone is not enough"
    );
  }

  const inspected = inspectTarget(inspectInput);
  const preview = toResult({ mode: "apply", inspected, applied: false });
  if (preview.preflightSnapshot.token !== input.preflightSnapshot.token) {
    throw new OfficialSupplyGateError(
      "preflight_mismatch",
      "preflight snapshot no longer matches the live row; re-run dry_run"
    );
  }

  ensureCreatorLorebookSchema(db);
  const synced = applyGuardedCanonicalFields({
    db,
    inspected,
    testInjectFailure: input.testInjectFailure,
  });
  enqueueCharacterDerivedRefreshJob(db, inspected.row.id);
  kickDerivedCacheWorker();

  const afterRow = db
    .prepare("SELECT id, tagline, creator_name, official, visibility FROM characters WHERE id=?")
    .get(inspected.row.id) as {
    id: number;
    tagline: string;
    creator_name: string;
    official: number;
    visibility: string;
  };
  if (afterRow.id !== inspected.row.id) {
    throw new OfficialSupplyGateError("identity_changed", "in-place sync must keep the same character id");
  }
  if (afterRow.official !== inspected.row.official || afterRow.visibility !== inspected.row.visibility) {
    throw new OfficialSupplyGateError("listing_changed", "in-place sync must preserve official/visibility");
  }

  return {
    ...preview,
    applied: true,
    displayCreatorName: afterRow.creator_name,
    after: {
      ...preview.after,
      tagline: afterRow.tagline,
      creatorName: afterRow.creator_name,
      lorebookKeys: synced.map((entry) => entry.entryKey),
      lorebookCount: synced.length,
    },
  };
}
