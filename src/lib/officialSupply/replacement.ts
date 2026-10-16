import { randomUUID } from "node:crypto";
import { normalizeCreatorAssetTag, orientationFromSize, parseAssets, type CharacterAsset } from "@/lib/characterAssets";
import type { OfficialAdminActor } from "@/lib/officialAdminAccess";
import { evaluateOfficialImageDimensions, officialImageProfileForSlot } from "@/lib/officialSupply/imageProfile";
import { canonicalAssetModerationFields, officialModerationVerdict } from "@/lib/officialSupply/moderation";
import { mapOfficialPublicAssetSlots, officialStagedAssetOrder } from "@/lib/officialSupply/publicAssetMap";
import {
  externalReplacementFilename,
  type OfficialAssetStorage,
  type OfficialImageOps,
} from "@/lib/officialSupply/runner";
import {
  OfficialSupplyGateError,
  type OfficialReplacementRecord,
  type OfficialSupplyStore,
} from "@/lib/officialSupply/store";

export type OfficialReplacementApplyResult = {
  status: "applied" | "dry_run";
  characterId: number;
  draftKey: string;
  swapped: string[];
};

class ReplacementDryRun extends Error {
  constructor(readonly result: OfficialReplacementApplyResult) {
    super("replacement dry-run");
    this.name = "ReplacementDryRun";
  }
}

type PublicCharacterRow = {
  id: number;
  official: number;
  visibility: string;
  moderation_status: string;
  assets: string;
  images: string;
};

function uniqueSlotKeys(slotKeys: readonly string[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const raw of slotKeys) {
    const slotKey = raw.trim();
    if (!slotKey) {
      throw new OfficialSupplyGateError("replacement_slot_invalid", "replacement slotKey is empty");
    }
    if (seen.has(slotKey)) {
      throw new OfficialSupplyGateError("replacement_slot_duplicate", `replacement slot ${slotKey} requested twice`);
    }
    seen.add(slotKey);
    keys.push(slotKey);
  }
  if (keys.length === 0) {
    throw new OfficialSupplyGateError("replacement_slot_required", "at least one replacement slotKey is required");
  }
  return keys;
}

function replacementAppliedTag(currentTag: string, candidate: OfficialReplacementRecord): string {
  if (candidate.approvedTag == null || candidate.approvedTag.trim() === "") return currentTag;
  const normalized = normalizeCreatorAssetTag(candidate.approvedTag, "");
  if (!normalized) {
    throw new OfficialSupplyGateError(
      "replacement_tag_invalid",
      `${candidate.draftKey}/${candidate.slotKey} approved tag is empty after normalization`
    );
  }
  return normalized;
}

function nextAssetFromCandidate(current: CharacterAsset, candidate: OfficialReplacementRecord): CharacterAsset {
  if (!candidate.candidateResultUrl) {
    throw new OfficialSupplyGateError(
      "replacement_not_generated",
      `${candidate.draftKey}/${candidate.slotKey} has no candidate url`
    );
  }
  const { adultFlagged: _af, moderationReject: _mr, moderationReason: _md, ...kept } = current;
  const orientation = orientationFromSize(candidate.width, candidate.height);
  return {
    ...kept,
    url: candidate.candidateResultUrl,
    tag: replacementAppliedTag(current.tag, candidate),
    ...(candidate.width != null ? { width: candidate.width } : {}),
    ...(candidate.height != null ? { height: candidate.height } : {}),
    ...(orientation ? { orientation } : {}),
    ...canonicalAssetModerationFields(candidate.moderation),
  };
}

function assertCandidateReadyForApply(
  store: OfficialSupplyStore,
  draftKey: string,
  slotKey: string,
  expectedAppearanceLock: string,
  activeUrl: string
): OfficialReplacementRecord {
  const candidate = store.getReplacement(draftKey, slotKey);
  if (candidate.kind === "representative") {
    throw new OfficialSupplyGateError(
      "replacement_representative_forbidden",
      `${draftKey}/${slotKey} representative replacement is not supported`
    );
  }
  if (candidate.status !== "approved") {
    throw new OfficialSupplyGateError(
      "replacement_not_approved",
      `${draftKey}/${slotKey} replacement is ${candidate.status}`
    );
  }
  if (!candidate.candidateResultUrl) {
    throw new OfficialSupplyGateError(
      "replacement_not_generated",
      `${draftKey}/${slotKey} replacement has no candidate url`
    );
  }
  if (candidate.appearanceLockHash !== expectedAppearanceLock) {
    throw new OfficialSupplyGateError(
      "appearance_lock_stale",
      `${draftKey}/${slotKey} replacement predates the appearance lock`
    );
  }
  if (candidate.baseResultUrl !== activeUrl) {
    throw new OfficialSupplyGateError(
      "replacement_base_stale",
      `${draftKey}/${slotKey} base_result_url no longer matches the active slot`
    );
  }
  const verdict = officialModerationVerdict(candidate.moderation);
  switch (verdict) {
    case "missing":
      throw new OfficialSupplyGateError("moderation_missing", `${draftKey}/${slotKey} has not been moderated`);
    case "unavailable":
      throw new OfficialSupplyGateError(
        "moderation_unavailable",
        `${draftKey}/${slotKey} moderation unavailable; re-run moderation`
      );
    case "rejected":
      throw new OfficialSupplyGateError(
        "replacement_moderation_rejected",
        `${draftKey}/${slotKey} replacement moderation is rejected`
      );
    case "adult_flagged":
    case "clean":
      break;
    default: {
      const exhaustive: never = verdict;
      throw new OfficialSupplyGateError("moderation_unknown", String(exhaustive));
    }
  }
  const profile = officialImageProfileForSlot(candidate.kind);
  if (candidate.width !== profile.width || candidate.height !== profile.height) {
    throw new OfficialSupplyGateError(
      "asset_dimensions",
      `${draftKey}/${slotKey} replacement is ${candidate.width}x${candidate.height}, expected ${profile.size}`
    );
  }
  return candidate;
}

/**
 * Atomic owner that swaps approved replacement candidates into the linked
 * character. Published official rows keep the published predicate. Staged-private
 * rows must stay private and non-official. Updates only selected
 * `characters.assets` entries, the matching active `official_supply_assets`
 * rows, and the replacement status. Never publishes, never changes owner or
 * visibility, never notifies followers, never deletes old files, and never
 * rewrites text/canon. `dryRun` executes the same writes, then rolls them back.
 */
export function applyApprovedOfficialAssetReplacements(input: {
  store: OfficialSupplyStore;
  draftKey: string;
  slotKeys: readonly string[];
  actor: OfficialAdminActor;
  dryRun?: boolean;
}): OfficialReplacementApplyResult {
  const { store, draftKey } = input;
  const slotKeys = uniqueSlotKeys(input.slotKeys);
  const character = store.assertReplacementOperator(draftKey, input.actor);
  for (const slotKey of slotKeys) {
    store.assertReplacementSlotAllowed(draftKey, slotKey);
  }
  if (!character.assetPlan || !character.appearanceLockHash) {
    throw new OfficialSupplyGateError("asset_plan_missing", `${draftKey} has no asset plan`);
  }
  const characterId = character.stagedCharacterId;
  if (characterId == null) {
    throw new OfficialSupplyGateError("not_staged", `draft ${draftKey} has no public character`);
  }

  const identityBefore = store.database
    .prepare("SELECT official, visibility, moderation_status, creator_id FROM characters WHERE id=?")
    .get(characterId) as
    | { official: number; visibility: string; moderation_status: string; creator_id: number | null }
    | undefined;
  if (!identityBefore) {
    throw new OfficialSupplyGateError("character_missing", `character ${characterId} not found`);
  }

  let dryRunResult: OfficialReplacementApplyResult | null = null;
  const apply = store.database.transaction(() => {
    const liveCharacter = store.assertReplacementOperator(draftKey, input.actor);
    if (liveCharacter.stage !== character.stage || liveCharacter.stagedCharacterId !== characterId) {
      throw new OfficialSupplyGateError(
        "staged_character_mismatch",
        `draft ${draftKey} link changed during apply`
      );
    }
    if (!liveCharacter.appearanceLockHash || liveCharacter.appearanceLockHash !== character.appearanceLockHash) {
      throw new OfficialSupplyGateError("appearance_lock_stale", `${draftKey} appearance lock changed during apply`);
    }
    const publicRow = store.database
      .prepare(
        "SELECT id, official, visibility, moderation_status, creator_id, assets, images FROM characters WHERE id=?"
      )
      .get(characterId) as (PublicCharacterRow & { creator_id: number | null }) | undefined;
    if (!publicRow || publicRow.id !== characterId) {
      throw new OfficialSupplyGateError("character_missing", `character ${characterId} not found`);
    }
    if (
      publicRow.official !== identityBefore.official ||
      publicRow.visibility !== identityBefore.visibility ||
      publicRow.moderation_status !== identityBefore.moderation_status ||
      publicRow.creator_id !== identityBefore.creator_id
    ) {
      throw new OfficialSupplyGateError(
        "replacement_target_mismatch",
        `character ${characterId} owner or visibility changed during apply`
      );
    }

    const publicAssets = parseAssets(publicRow.assets);
    const activeUrlBySlot = new Map(
      store.listAssets(draftKey).map((asset) => [asset.slotKey, asset.resultUrl ?? ""])
    );
    const mapped = mapOfficialPublicAssetSlots({
      plan: liveCharacter.assetPlan ?? character.assetPlan!,
      publicAssets,
      activeUrlBySlot,
    });
    if (!mapped.ok) {
      throw new OfficialSupplyGateError("public_asset_map_mismatch", mapped.reason);
    }

    const candidates = new Map<string, OfficialReplacementRecord>();
    for (const slotKey of slotKeys) {
      const active = store.assertReplacementSlotAllowed(draftKey, slotKey);
      if (active.status !== "approved" || !active.resultUrl) {
        throw new OfficialSupplyGateError(
          "active_slot_not_approved",
          `${draftKey}/${slotKey} is ${active.status}; approved active slot required`
        );
      }
      if (active.appearanceLockHash !== liveCharacter.appearanceLockHash) {
        throw new OfficialSupplyGateError(
          "appearance_lock_stale",
          `${draftKey}/${slotKey} was planned for another appearance lock`
        );
      }
      const publicIndex = mapped.indexes.get(slotKey);
      if (publicIndex == null) {
        throw new OfficialSupplyGateError("public_asset_map_mismatch", `${slotKey} is not in the public asset map`);
      }
      const publicUrl = publicAssets[publicIndex]?.url ?? "";
      if (publicUrl !== active.resultUrl) {
        throw new OfficialSupplyGateError(
          "replacement_public_stale",
          `${draftKey}/${slotKey} public url no longer matches the active slot`
        );
      }
      const candidate = assertCandidateReadyForApply(
        store,
        draftKey,
        slotKey,
        liveCharacter.appearanceLockHash,
        active.resultUrl
      );
      candidates.set(slotKey, candidate);
    }

    const nextAssets = publicAssets.map((asset) => ({ ...asset }));
    for (const slotKey of slotKeys) {
      const index = mapped.indexes.get(slotKey);
      if (index == null) {
        throw new OfficialSupplyGateError("public_asset_map_mismatch", `${slotKey} is not in the public asset map`);
      }
      nextAssets[index] = nextAssetFromCandidate(publicAssets[index]!, candidates.get(slotKey)!);
    }

    const ordered = officialStagedAssetOrder(liveCharacter.assetPlan ?? character.assetPlan!);
    const representative = ordered.find((slot) => slot.kind === "representative");
    if (representative && !slotKeys.includes(representative.slotKey)) {
      const repIndex = mapped.indexes.get(representative.slotKey);
      if (repIndex == null || nextAssets[repIndex]?.url !== publicAssets[repIndex]?.url) {
        throw new OfficialSupplyGateError(
          "representative_implicit_change",
          `${draftKey} apply would change the representative without targeting it`
        );
      }
    }
    for (const [index, asset] of publicAssets.entries()) {
      const target = slotKeys.find((slotKey) => mapped.indexes.get(slotKey) === index);
      if (target) continue;
      if (nextAssets[index]?.url !== asset.url) {
        throw new OfficialSupplyGateError(
          "non_target_asset_changed",
          `${draftKey} apply would change a non-target public asset`
        );
      }
    }

    const assetsJson = JSON.stringify(nextAssets);
    const updated = store.database.prepare("UPDATE characters SET assets=? WHERE id=?").run(assetsJson, characterId);
    if (updated.changes !== 1) {
      throw new OfficialSupplyGateError("character_missing", `character ${characterId} could not be updated`);
    }

    const syncActive = store.database.prepare(
      `UPDATE official_supply_assets
       SET result_url=?, width=?, height=?, model=?, provider_request_id=?,
           qa_json=?, moderation_json=?, status='approved', appearance_lock_hash=?,
           approved_tag=?,
           error=NULL, lease_owner=NULL, lease_expires_at=NULL, updated_at=datetime('now')
       WHERE draft_key=? AND slot_key=? AND status='approved' AND result_url=?`
    );
    const markApplied = store.database.prepare(
      `UPDATE official_supply_asset_replacements
       SET status='applied', applied_at=datetime('now'), updated_at=datetime('now')
       WHERE draft_key=? AND slot_key=? AND status='approved'`
    );
    for (const slotKey of slotKeys) {
      const candidate = candidates.get(slotKey)!;
      const activeInfo = syncActive.run(
        candidate.candidateResultUrl,
        candidate.width,
        candidate.height,
        candidate.model,
        candidate.providerRequestId,
        candidate.qa ? JSON.stringify(candidate.qa) : null,
        candidate.moderation ? JSON.stringify(candidate.moderation) : null,
        liveCharacter.appearanceLockHash,
        nextAssets[mapped.indexes.get(slotKey)!]!.tag,
        draftKey,
        slotKey,
        candidate.baseResultUrl
      );
      if (activeInfo.changes !== 1) {
        throw new OfficialSupplyGateError(
          "replacement_active_cas_failed",
          `${draftKey}/${slotKey} active row changed during apply`
        );
      }
      const appliedInfo = markApplied.run(draftKey, slotKey);
      if (appliedInfo.changes !== 1) {
        throw new OfficialSupplyGateError(
          "replacement_apply_cas_failed",
          `${draftKey}/${slotKey} replacement was not approved at apply time`
        );
      }
    }

    const result: OfficialReplacementApplyResult = {
      status: input.dryRun ? "dry_run" : "applied",
      characterId,
      draftKey,
      swapped: [...slotKeys],
    };
    if (input.dryRun) {
      dryRunResult = result;
      throw new ReplacementDryRun(result);
    }
    return result;
  });

  try {
    return apply();
  } catch (error) {
    if (dryRunResult) return dryRunResult;
    throw error;
  }
}

/**
 * Stores an external image through the existing official asset storage port
 * and registers it as a replacement candidate. No provider call, no model,
 * no provider request id, and no generation cost. The approved tag is the
 * human action/situation label; vision classification does not write it.
 */
export async function registerExternalOfficialAssetReplacement(input: {
  store: OfficialSupplyStore;
  storage: OfficialAssetStorage;
  imageOps: OfficialImageOps;
  actor: OfficialAdminActor;
  draftKey: string;
  slotKey: string;
  bytes: Buffer;
  approvedTag: string;
  nowMs?: number;
}): Promise<OfficialReplacementRecord> {
  const approvedTag = normalizeCreatorAssetTag(input.approvedTag, "");
  if (!approvedTag) {
    throw new OfficialSupplyGateError(
      "replacement_tag_invalid",
      `${input.draftKey}/${input.slotKey} approved tag is empty after normalization`
    );
  }
  const intakeId = randomUUID();
  try {
    input.store.claimExternalReplacementIntake(
      input.actor,
      input.draftKey,
      input.slotKey,
      intakeId,
      input.nowMs
    );
    const asset = input.store.assertReplacementSlotAllowed(input.draftKey, input.slotKey);
    const profile = officialImageProfileForSlot(asset.kind);
    const dims = await input.imageOps.inspect(input.bytes);
    if (!dims || evaluateOfficialImageDimensions(profile, dims.width, dims.height) !== "exact") {
      throw new OfficialSupplyGateError(
        "asset_dimensions",
        `${input.draftKey}/${input.slotKey} external file is ${dims ? `${dims.width}x${dims.height}` : "unreadable"}, expected ${profile.size}`
      );
    }
    const filename = externalReplacementFilename(input.draftKey, input.slotKey, intakeId);
    const stored = await input.storage.store(filename, input.bytes);
    return input.store.registerExternalReplacementCandidate(input.actor, input.draftKey, input.slotKey, {
      url: stored.url,
      width: dims.width,
      height: dims.height,
      approvedTag,
      intakeId,
    });
  } catch (error) {
    input.store.releaseExternalReplacementIntake(input.draftKey, input.slotKey, intakeId);
    throw error;
  }
}
