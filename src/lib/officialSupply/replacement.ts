import {
  orientationFromSize,
  parseAssets,
  type CharacterAsset,
} from "@/lib/characterAssets";
import { officialImageProfileForSlot } from "@/lib/officialSupply/imageProfile";
import { canonicalAssetModerationFields, officialModerationVerdict } from "@/lib/officialSupply/moderation";
import { mapOfficialPublicAssetSlots, officialStagedAssetOrder } from "@/lib/officialSupply/publicAssetMap";
import {
  OfficialSupplyGateError,
  type OfficialReplacementRecord,
  type OfficialSupplyStore,
} from "@/lib/officialSupply/store";

export type OfficialReplacementApplyResult = {
  status: "applied";
  characterId: number;
  draftKey: string;
  swapped: string[];
};

type PublicCharacterRow = {
  id: number;
  official: number;
  visibility: string;
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
 * Atomic owner that swaps approved replacement candidates into the live
 * published character. Updates only selected `characters.assets` entries and
 * the matching active `official_supply_assets` rows. Never publishes, never
 * notifies followers, never deletes old files, and never rewrites text/canon.
 */
export function applyApprovedOfficialAssetReplacements(input: {
  store: OfficialSupplyStore;
  draftKey: string;
  slotKeys: readonly string[];
}): OfficialReplacementApplyResult {
  const { store, draftKey } = input;
  const slotKeys = uniqueSlotKeys(input.slotKeys);
  const character = store.assertPublishedOfficialCharacter(draftKey);
  if (!character.assetPlan || !character.appearanceLockHash) {
    throw new OfficialSupplyGateError("asset_plan_missing", `${draftKey} has no asset plan`);
  }
  const characterId = character.stagedCharacterId;
  if (characterId == null) {
    throw new OfficialSupplyGateError("not_staged", `draft ${draftKey} has no public character`);
  }

  const apply = store.database.transaction(() => {
    const liveCharacter = store.getCharacter(draftKey);
    if (liveCharacter.stage !== "published" || liveCharacter.stagedCharacterId !== characterId) {
      throw new OfficialSupplyGateError(
        "character_stage",
        `draft ${draftKey} is ${liveCharacter.stage}; published official character required`
      );
    }
    if (!liveCharacter.appearanceLockHash || liveCharacter.appearanceLockHash !== character.appearanceLockHash) {
      throw new OfficialSupplyGateError("appearance_lock_stale", `${draftKey} appearance lock changed during apply`);
    }
    const publicRow = store.database
      .prepare("SELECT id, official, visibility, assets, images FROM characters WHERE id=?")
      .get(characterId) as PublicCharacterRow | undefined;
    if (!publicRow || publicRow.id !== characterId || publicRow.official !== 1 || publicRow.visibility !== "public") {
      throw new OfficialSupplyGateError(
        "character_not_published",
        `character ${characterId} is not the published official row`
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
      const active = store.getAsset(draftKey, slotKey);
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

    return {
      status: "applied" as const,
      characterId,
      draftKey,
      swapped: [...slotKeys],
    };
  });

  return apply();
}
