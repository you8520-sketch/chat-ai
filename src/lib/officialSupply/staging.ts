import { randomUUID } from "node:crypto";
import { createCharacterFromForm, type SessionUser } from "@/lib/characterFormSave";
import { insertCreatorLorebookForOwner } from "@/lib/creatorLorebook";
import {
  buildOfficialCharacterFormBody,
  type OfficialCanonicalFormAsset,
} from "@/lib/officialSupply/characterText";
import { OfficialSupplyGateError, type OfficialSupplyStore } from "@/lib/officialSupply/store";
import { canonicalAssetModerationFields } from "@/lib/officialSupply/moderation";
import type { OfficialWorldLorebookEntry } from "@/lib/officialSupply/types";
import { evaluateSharedLorebook } from "@/lib/officialSupply/worldQa";

type CanonicalSave = typeof createCharacterFromForm;

export type OfficialStagingResult =
  | { status: "staged"; characterId: number }
  | { status: "already_staged"; characterId: number };

/**
 * Canonical asset order: the 2:3 representative is index 0 (card/profile owner
 * `getCharacterRepresentativeImageUrl` reads assets[0]); 3:2 RP assets follow
 * in plan order and are inline-eligible by orientation.
 */
export function buildStagingAssets(store: OfficialSupplyStore, draftKey: string): OfficialCanonicalFormAsset[] {
  const record = store.getCharacter(draftKey);
  const plan = record.assetPlan;
  if (!plan) throw new OfficialSupplyGateError("asset_plan_missing", `${draftKey} has no asset plan`);
  const byKey = new Map(store.listAssets(draftKey).map((asset) => [asset.slotKey, asset]));
  const ordered = [...plan.slots].sort(
    (a, b) => Number(b.kind === "representative") - Number(a.kind === "representative")
  );
  return ordered.map((slot) => {
    const asset = byKey.get(slot.slotKey);
    if (!asset?.resultUrl || asset.width == null || asset.height == null) {
      throw new OfficialSupplyGateError("asset_missing", `${draftKey}/${slot.slotKey} has no result`);
    }
    return {
      url: asset.resultUrl,
      tag: slot.tag,
      width: asset.width,
      height: asset.height,
      viewerBlur: slot.kind !== "representative" && slot.depiction === "adult_grounded_non_explicit",
      ...canonicalAssetModerationFields(asset.moderation),
    };
  });
}

function ensureWorldLorebooks(
  store: OfficialSupplyStore,
  worldKey: string,
  stagingUser: SessionUser,
  entries: readonly OfficialWorldLorebookEntry[]
): number[] {
  return entries.map((entry) => {
    const existing = store.findWorldLorebookId(worldKey, entry.entryKey, stagingUser.id);
    if (existing != null) return existing;
    const created = insertCreatorLorebookForOwner(store.database, {
      creatorId: stagingUser.id,
      name: entry.name,
      summary: "",
      keywords: entry.keywords,
      content: entry.content,
    });
    if (!created.ok) throw new OfficialSupplyGateError("lorebook_invalid", `${entry.entryKey}: ${created.error}`);
    store.rememberWorldLorebook(worldKey, entry.entryKey, stagingUser.id, created.id);
    return created.id;
  });
}

/**
 * Private staging through the canonical character save owner. The row is
 * created `visibility=private`, `official=0`, owned by a real adult-verified
 * staging account — so neither `listableWhere` nor `canAccessCharacter` (both
 * short-circuit on `official=1`) nor the boot-time `creator_id IS NULL`
 * publisher can expose it. Publishing is a separate follow-up decision.
 */
export async function stageOfficialCharacterPrivately(input: {
  store: OfficialSupplyStore;
  draftKey: string;
  stagingUser: SessionUser;
  sharedLorebook?: OfficialWorldLorebookEntry[];
  save?: CanonicalSave;
}): Promise<OfficialStagingResult> {
  const { store, draftKey, stagingUser } = input;
  const record = store.getCharacter(draftKey);
  if (record.stagedCharacterId != null) {
    return { status: "already_staged", characterId: record.stagedCharacterId };
  }
  if (record.stage !== "qa_passed") {
    throw new OfficialSupplyGateError("character_stage", `draft ${draftKey} is ${record.stage}; QA_PASSED required`);
  }
  const entries = input.sharedLorebook ?? [];
  const siblings = store.listWorldCharacters(record.batchKey, record.worldKey).map((c) => c.draft);
  const lorebookQa = evaluateSharedLorebook(entries, siblings);
  if (!lorebookQa.ok) {
    throw new OfficialSupplyGateError("lorebook_knowledge_boundary", "shared lorebook failed QA", lorebookQa);
  }

  const token = randomUUID();
  if (!store.claimStaging(draftKey, token)) {
    throw new OfficialSupplyGateError("staging_in_progress", `draft ${draftKey} is being staged by another worker`);
  }
  try {
    const lorebookIds = ensureWorldLorebooks(store, record.worldKey, stagingUser, entries);
    const body = buildOfficialCharacterFormBody({
      draft: record.draft,
      appearanceBlock: store.appearanceBlockFor(record),
      assets: buildStagingAssets(store, draftKey),
      lorebookIds,
    });
    const saved = await (input.save ?? createCharacterFromForm)(stagingUser, body);
    if (!saved.ok) {
      throw new OfficialSupplyGateError("canonical_save_rejected", saved.error);
    }
    const row = store.database
      .prepare("SELECT official, visibility FROM characters WHERE id=?")
      .get(saved.id) as { official: number; visibility: string } | undefined;
    if (!row || row.official !== 0 || row.visibility !== "private") {
      throw new OfficialSupplyGateError("staging_not_private", `character ${saved.id} is not a private non-official row`);
    }
    store.markStaged(draftKey, token, saved.id);
    return { status: "staged", characterId: saved.id };
  } catch (error) {
    store.releaseStagingClaim(draftKey, token);
    throw error;
  }
}
