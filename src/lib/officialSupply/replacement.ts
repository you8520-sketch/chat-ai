import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  listingImageUrls,
  normalizeCreatorAssetTag,
  parseAssets,
  withReplacedAssetFile,
  type CharacterAsset,
} from "@/lib/characterAssets";
import type { OfficialAdminActor } from "@/lib/officialAdminAccess";
import { evaluateAssetPlan } from "@/lib/officialSupply/assetPlan";
import { officialApprovedAssetReference } from "@/lib/officialSupply/generationReferences";
import { evaluateOfficialImageDimensions, officialImageProfileForSlot } from "@/lib/officialSupply/imageProfile";
import { canonicalAssetModerationFields, officialModerationVerdict } from "@/lib/officialSupply/moderation";
import { mapOfficialPublicAssetSlots, officialStagedAssetOrder } from "@/lib/officialSupply/publicAssetMap";
import {
  externalReplacementFilename,
  type OfficialAssetStorage,
  type OfficialImageOps,
} from "@/lib/officialSupply/runner";
import {
  canonicalJson,
  isCompletePassingAnchorQa,
  OfficialSupplyGateError,
  type OfficialCharacterRecord,
  type OfficialReplacementRecord,
  type OfficialSupplyStore,
} from "@/lib/officialSupply/store";
import type { OfficialAssetPlan, OfficialGenerationReferencePolicy } from "@/lib/officialSupply/types";

export type OfficialReplacementApplyResult = {
  status: "applied" | "dry_run";
  characterId: number;
  draftKey: string;
  swapped: string[];
  /** Ledger id for `rollbackOfficialAssetReplacementApply`; null for a dry run. */
  applyId: string | null;
};

/**
 * Required when the representative is among the applied slots. The approved
 * plan becomes the stored asset plan, and the new representative becomes the
 * character's identity+style variation reference.
 */
export type OfficialRepresentativeApplySet = {
  nextAssetPlan: OfficialAssetPlan;
  generationReference: OfficialGenerationReferencePolicy["mode"];
};

export type OfficialReplacementRollbackResult = {
  status: "rolled_back" | "dry_run";
  applyId: string;
  characterId: number;
  draftKey: string;
  restored: string[];
};

class ReplacementDryRun extends Error {
  constructor() {
    super("replacement dry-run");
    this.name = "ReplacementDryRun";
  }
}

type SupplyAssetState = {
  status: string;
  result_url: string | null;
  width: number | null;
  height: number | null;
  model: string | null;
  provider_request_id: string | null;
  qa_json: string | null;
  moderation_json: string | null;
  appearance_lock_hash: string | null;
  approved_tag: string | null;
  error: string | null;
  lease_owner: string | null;
  lease_expires_at: number | null;
};

/** Everything an apply may write, plus the identity it must not write. */
type ReplacementApplyState = {
  character: {
    assets: string;
    images: string;
    official: number;
    visibility: string;
    moderation_status: string;
    creator_id: number | null;
  };
  supplyCharacter: {
    stage: string;
    staged_character_id: number | null;
    text_lock_hash: string | null;
    appearance_lock_hash: string | null;
    asset_plan_json: string | null;
    anchor_approved_by: string | null;
    generation_reference_json: string | null;
  };
  supplyAssets: Record<string, SupplyAssetState>;
  replacements: Record<string, { status: string; applied_at: string | null }>;
};

function readApplyState(
  db: Database.Database,
  draftKey: string,
  characterId: number,
  slotKeys: readonly string[]
): ReplacementApplyState {
  const character = db
    .prepare("SELECT assets, images, official, visibility, moderation_status, creator_id FROM characters WHERE id=?")
    .get(characterId) as ReplacementApplyState["character"] | undefined;
  const supplyCharacter = db
    .prepare(
      `SELECT stage, staged_character_id, text_lock_hash, appearance_lock_hash, asset_plan_json,
              anchor_approved_by, generation_reference_json
         FROM official_supply_characters WHERE draft_key=?`
    )
    .get(draftKey) as ReplacementApplyState["supplyCharacter"] | undefined;
  if (!character || !supplyCharacter) {
    throw new OfficialSupplyGateError("character_missing", `draft ${draftKey} / character ${characterId} not found`);
  }
  const assetStmt = db.prepare(
    `SELECT status, result_url, width, height, model, provider_request_id, qa_json, moderation_json,
            appearance_lock_hash, approved_tag, error, lease_owner, lease_expires_at
       FROM official_supply_assets WHERE draft_key=? AND slot_key=?`
  );
  const replacementStmt = db.prepare(
    "SELECT status, applied_at FROM official_supply_asset_replacements WHERE draft_key=? AND slot_key=?"
  );
  const supplyAssets: Record<string, SupplyAssetState> = {};
  const replacements: ReplacementApplyState["replacements"] = {};
  for (const slotKey of slotKeys) {
    const asset = assetStmt.get(draftKey, slotKey) as SupplyAssetState | undefined;
    const replacement = replacementStmt.get(draftKey, slotKey) as
      | { status: string; applied_at: string | null }
      | undefined;
    if (!asset || !replacement) {
      throw new OfficialSupplyGateError("replacement_not_found", `${draftKey}/${slotKey} has no asset or candidate row`);
    }
    supplyAssets[slotKey] = asset;
    replacements[slotKey] = replacement;
  }
  return { character, supplyCharacter, supplyAssets, replacements };
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

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
  return {
    ...withReplacedAssetFile(current, {
      url: candidate.candidateResultUrl,
      width: candidate.width,
      height: candidate.height,
    }),
    tag: replacementAppliedTag(current.tag, candidate),
    ...canonicalAssetModerationFields(candidate.moderation),
  };
}

function assertRepresentativeReviewCurrent(
  character: OfficialCharacterRecord,
  candidate: OfficialReplacementRecord
): void {
  const where = `${candidate.draftKey}/${candidate.slotKey}`;
  if (character.stage !== "staged_private") {
    throw new OfficialSupplyGateError(
      "replacement_representative_forbidden",
      `${where} representative replacement is limited to staged_private characters`
    );
  }
  if (!candidate.candidateSha256 || !candidate.reviewedBy?.trim()) {
    throw new OfficialSupplyGateError("representative_review_missing", `${where} has no anchor review bound to its file`);
  }
  if (!character.textLockHash || candidate.reviewedTextLockHash !== character.textLockHash) {
    throw new OfficialSupplyGateError("representative_review_stale", `${where} anchor review predates the Text Lock`);
  }
  if (!isCompletePassingAnchorQa(candidate.qa)) {
    throw new OfficialSupplyGateError("representative_review_missing", `${where} has no passing anchor QA`);
  }
}

function assertCandidateReadyForApply(
  store: OfficialSupplyStore,
  character: OfficialCharacterRecord,
  slotKey: string,
  expectedAppearanceLock: string,
  activeUrl: string
): OfficialReplacementRecord {
  const draftKey = character.draftKey;
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
  if (candidate.kind === "representative") assertRepresentativeReviewCurrent(character, candidate);
  return candidate;
}

/**
 * The approved plan keeps slot keys, kinds and order (the public asset map
 * depends on them), passes plan QA, changes only targeted slots, and carries
 * the same tag each targeted asset will store.
 */
function assertApprovedPlanForApply(
  character: OfficialCharacterRecord,
  plan: OfficialAssetPlan,
  slotKeys: readonly string[],
  appliedTags: ReadonlyMap<string, string>
): void {
  const current = character.assetPlan;
  if (!current) throw new OfficialSupplyGateError("asset_plan_missing", `${character.draftKey} has no asset plan`);
  const qa = evaluateAssetPlan(character.draft, plan);
  if (!qa.ok) {
    throw new OfficialSupplyGateError("asset_plan_qa_failed", `${character.draftKey}: approved plan failed QA`, qa);
  }
  const shape = (p: OfficialAssetPlan) => p.slots.map((slot) => `${slot.slotKey}:${slot.kind}`).join(",");
  if (shape(plan) !== shape(current)) {
    throw new OfficialSupplyGateError(
      "asset_plan_slots_changed",
      `${character.draftKey}: approved plan must keep slot keys, kinds and order`
    );
  }
  for (const [index, slot] of plan.slots.entries()) {
    const targeted = slotKeys.includes(slot.slotKey);
    if (!targeted && canonicalJson(slot) !== canonicalJson(current.slots[index])) {
      throw new OfficialSupplyGateError(
        "asset_plan_untargeted_change",
        `${character.draftKey}/${slot.slotKey} plan changes without an applied image`
      );
    }
    if (targeted && appliedTags.get(slot.slotKey) !== slot.tag) {
      throw new OfficialSupplyGateError(
        "asset_plan_tag_mismatch",
        `${character.draftKey}/${slot.slotKey} applied tag does not match the approved plan tag`
      );
    }
  }
}

/**
 * Atomic owner that swaps approved replacement candidates into the linked
 * character. Published official rows keep the published predicate. Staged-private
 * rows must stay private and non-official. Updates only selected
 * `characters.assets` entries, the matching active `official_supply_assets`
 * rows, and the replacement status. Never publishes, never changes owner or
 * visibility, never notifies followers, never deletes old files, and never
 * rewrites text/canon. `dryRun` executes the same writes, then rolls them back.
 *
 * The representative is replaceable only on a staged_private row, with an
 * anchor review bound to the candidate file and the current Locks, and only
 * together with `representative`: the approved plan becomes the stored plan
 * and the new representative becomes the variation identity+style reference.
 * Each apply records its before/after state for
 * `rollbackOfficialAssetReplacementApply`.
 */
export function applyApprovedOfficialAssetReplacements(input: {
  store: OfficialSupplyStore;
  draftKey: string;
  slotKeys: readonly string[];
  actor: OfficialAdminActor;
  representative?: OfficialRepresentativeApplySet;
  dryRun?: boolean;
}): OfficialReplacementApplyResult {
  const { store, draftKey } = input;
  const slotKeys = uniqueSlotKeys(input.slotKeys);
  const character = store.assertReplacementOperator(draftKey, input.actor);
  let targetsRepresentative = false;
  for (const slotKey of slotKeys) {
    if (store.assertReplacementTargetAllowed(character, slotKey).kind === "representative") {
      targetsRepresentative = true;
    }
  }
  if (targetsRepresentative && !input.representative) {
    throw new OfficialSupplyGateError(
      "representative_apply_set_required",
      `${draftKey} representative apply needs the approved plan and reference policy`
    );
  }
  if (!targetsRepresentative && input.representative) {
    throw new OfficialSupplyGateError(
      "representative_apply_set_unexpected",
      `${draftKey} approved plan is applied only together with the representative`
    );
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
    const db = store.database;
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
    store.assertTextLockCurrent(liveCharacter);
    const livePlan = liveCharacter.assetPlan;
    if (!livePlan) throw new OfficialSupplyGateError("asset_plan_missing", `${draftKey} has no asset plan`);

    const before = readApplyState(db, draftKey, characterId, slotKeys);
    if (
      before.character.official !== identityBefore.official ||
      before.character.visibility !== identityBefore.visibility ||
      before.character.moderation_status !== identityBefore.moderation_status ||
      before.character.creator_id !== identityBefore.creator_id
    ) {
      throw new OfficialSupplyGateError(
        "replacement_target_mismatch",
        `character ${characterId} owner or visibility changed during apply`
      );
    }

    const publicAssets = parseAssets(before.character.assets);
    const activeUrlBySlot = new Map(
      store.listAssets(draftKey).map((asset) => [asset.slotKey, asset.resultUrl ?? ""])
    );
    const mapped = mapOfficialPublicAssetSlots({ plan: livePlan, publicAssets, activeUrlBySlot });
    if (!mapped.ok) {
      throw new OfficialSupplyGateError("public_asset_map_mismatch", mapped.reason);
    }

    const candidates = new Map<string, OfficialReplacementRecord>();
    for (const slotKey of slotKeys) {
      const active = store.assertReplacementTargetAllowed(liveCharacter, slotKey);
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
        liveCharacter,
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

    const ordered = officialStagedAssetOrder(livePlan);
    const representative = ordered.find((slot) => slot.kind === "representative");
    if (representative) {
      const repIndex = mapped.indexes.get(representative.slotKey);
      if (!slotKeys.includes(representative.slotKey)) {
        if (repIndex == null || nextAssets[repIndex]?.url !== publicAssets[repIndex]?.url) {
          throw new OfficialSupplyGateError(
            "representative_implicit_change",
            `${draftKey} apply would change the representative without targeting it`
          );
        }
      } else if (repIndex == null || nextAssets[repIndex]?.representativeRank !== 1) {
        throw new OfficialSupplyGateError(
          "representative_rank_lost",
          `${draftKey} replacement representative must keep the first representative rank`
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

    const appliedTags = new Map(
      slotKeys.map((slotKey) => [slotKey, nextAssets[mapped.indexes.get(slotKey)!]!.tag] as const)
    );
    if (input.representative) {
      assertApprovedPlanForApply(liveCharacter, input.representative.nextAssetPlan, slotKeys, appliedTags);
    }

    const assetsJson = JSON.stringify(nextAssets);
    const imagesJson = targetsRepresentative
      ? JSON.stringify(listingImageUrls(nextAssets))
      : before.character.images;
    const updated = db
      .prepare("UPDATE characters SET assets=?, images=? WHERE id=? AND assets=? AND images=?")
      .run(assetsJson, imagesJson, characterId, before.character.assets, before.character.images);
    if (updated.changes !== 1) {
      throw new OfficialSupplyGateError("character_missing", `character ${characterId} could not be updated`);
    }

    const syncActive = db.prepare(
      `UPDATE official_supply_assets
       SET result_url=?, width=?, height=?, model=?, provider_request_id=?,
           qa_json=?, moderation_json=?, status='approved', appearance_lock_hash=?,
           approved_tag=?,
           error=NULL, lease_owner=NULL, lease_expires_at=NULL, updated_at=datetime('now')
       WHERE draft_key=? AND slot_key=? AND status='approved' AND result_url=?`
    );
    const markApplied = db.prepare(
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
        appliedTags.get(slotKey),
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

    if (input.representative && representative) {
      const repCandidate = candidates.get(representative.slotKey)!;
      const policy: OfficialGenerationReferencePolicy = {
        mode: input.representative.generationReference,
        url: repCandidate.candidateResultUrl!,
        sha256: repCandidate.candidateSha256!,
      };
      try {
        officialApprovedAssetReference(policy.url, policy.sha256);
      } catch (error) {
        throw new OfficialSupplyGateError(
          "reference_policy_invalid",
          `${draftKey}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      const info = db
        .prepare(
          `UPDATE official_supply_characters
           SET asset_plan_json=?, anchor_approved_by=?, generation_reference_json=?, updated_at=datetime('now')
           WHERE draft_key=? AND stage='staged_private' AND staged_character_id=?
             AND text_lock_hash=? AND appearance_lock_hash=?
             AND asset_plan_json IS ? AND anchor_approved_by IS ? AND generation_reference_json IS ?`
        )
        .run(
          JSON.stringify(input.representative.nextAssetPlan),
          repCandidate.reviewedBy,
          JSON.stringify(policy),
          draftKey,
          characterId,
          before.supplyCharacter.text_lock_hash,
          before.supplyCharacter.appearance_lock_hash,
          before.supplyCharacter.asset_plan_json,
          before.supplyCharacter.anchor_approved_by,
          before.supplyCharacter.generation_reference_json
        );
      if (info.changes !== 1) {
        throw new OfficialSupplyGateError(
          "replacement_character_cas_failed",
          `${draftKey} supply character changed during apply`
        );
      }
    }

    const applyId = randomUUID();
    const after = readApplyState(db, draftKey, characterId, slotKeys);
    db.prepare(
      `INSERT INTO official_supply_replacement_applies
         (apply_id, draft_key, character_id, slot_keys_json, before_json, after_json, status, applied_by_id)
       VALUES (?, ?, ?, ?, ?, ?, 'applied', ?)`
    ).run(
      applyId,
      draftKey,
      characterId,
      JSON.stringify(slotKeys),
      canonicalJson(before),
      canonicalJson(after),
      input.actor.id ?? null
    );

    const result: OfficialReplacementApplyResult = {
      status: input.dryRun ? "dry_run" : "applied",
      characterId,
      draftKey,
      swapped: [...slotKeys],
      applyId: input.dryRun ? null : applyId,
    };
    if (input.dryRun) {
      dryRunResult = result;
      throw new ReplacementDryRun();
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

type ReplacementApplyLedgerRow = {
  apply_id: string;
  draft_key: string;
  character_id: number;
  slot_keys_json: string;
  before_json: string;
  after_json: string;
  status: string;
};

export type OfficialReplacementApplySummary = {
  applyId: string;
  characterId: number;
  slotKeys: string[];
  status: string;
  appliedById: number | null;
  appliedAt: string;
  rolledBackById: number | null;
  rolledBackAt: string | null;
};

/** Apply ledger rows for one draft, oldest first. */
export function listOfficialAssetReplacementApplies(
  store: OfficialSupplyStore,
  draftKey: string
): OfficialReplacementApplySummary[] {
  const rows = store.database
    .prepare(
      `SELECT apply_id, character_id, slot_keys_json, status, applied_by_id, applied_at, rolled_back_by_id, rolled_back_at
       FROM official_supply_replacement_applies WHERE draft_key=? ORDER BY applied_at, rowid`
    )
    .all(draftKey) as Array<{
    apply_id: string;
    character_id: number;
    slot_keys_json: string;
    status: string;
    applied_by_id: number | null;
    applied_at: string;
    rolled_back_by_id: number | null;
    rolled_back_at: string | null;
  }>;
  return rows.map((row) => ({
    applyId: row.apply_id,
    characterId: row.character_id,
    slotKeys: JSON.parse(row.slot_keys_json) as string[],
    status: row.status,
    appliedById: row.applied_by_id,
    appliedAt: row.applied_at,
    rolledBackById: row.rolled_back_by_id,
    rolledBackAt: row.rolled_back_at,
  }));
}

/**
 * Restores the state recorded before one successful apply: public assets and
 * images (tags, representative designation), the active supply rows (QA,
 * moderation, approved tag), the stored plan, anchor approver and reference
 * policy. Runs only while the current state still equals that apply's result;
 * any later edit is refused. Candidates return to `approved`; stored files
 * and the review/apply history are kept. `dryRun` rolls the restore back.
 */
export function rollbackOfficialAssetReplacementApply(input: {
  store: OfficialSupplyStore;
  draftKey: string;
  applyId: string;
  actor: OfficialAdminActor;
  dryRun?: boolean;
}): OfficialReplacementRollbackResult {
  const { store, draftKey, applyId } = input;
  let dryRunResult: OfficialReplacementRollbackResult | null = null;
  const rollback = store.database.transaction(() => {
    const db = store.database;
    const character = store.assertReplacementOperator(draftKey, input.actor);
    const ledger = db
      .prepare("SELECT * FROM official_supply_replacement_applies WHERE apply_id=? AND draft_key=?")
      .get(applyId, draftKey) as ReplacementApplyLedgerRow | undefined;
    if (!ledger) {
      throw new OfficialSupplyGateError("rollback_not_found", `${draftKey} has no apply ${applyId}`);
    }
    if (ledger.status !== "applied") {
      throw new OfficialSupplyGateError("rollback_not_applied", `${draftKey} apply ${applyId} is ${ledger.status}`);
    }
    if (character.stagedCharacterId !== ledger.character_id) {
      throw new OfficialSupplyGateError(
        "staged_character_mismatch",
        `draft ${draftKey} is no longer linked to character ${ledger.character_id}`
      );
    }
    const slotKeys = JSON.parse(ledger.slot_keys_json) as string[];
    const current = readApplyState(db, draftKey, ledger.character_id, slotKeys);
    if (canonicalJson(current) !== ledger.after_json) {
      throw new OfficialSupplyGateError(
        "rollback_stale",
        `${draftKey} changed after apply ${applyId}; rollback refused`
      );
    }
    const before = JSON.parse(ledger.before_json) as ReplacementApplyState;

    const restoredCharacter = db
      .prepare("UPDATE characters SET assets=?, images=? WHERE id=? AND assets=? AND images=?")
      .run(
        before.character.assets,
        before.character.images,
        ledger.character_id,
        current.character.assets,
        current.character.images
      );
    const restoredSupply = db
      .prepare(
        `UPDATE official_supply_characters
         SET asset_plan_json=?, anchor_approved_by=?, generation_reference_json=?, updated_at=datetime('now')
         WHERE draft_key=? AND asset_plan_json IS ? AND anchor_approved_by IS ? AND generation_reference_json IS ?`
      )
      .run(
        before.supplyCharacter.asset_plan_json,
        before.supplyCharacter.anchor_approved_by,
        before.supplyCharacter.generation_reference_json,
        draftKey,
        current.supplyCharacter.asset_plan_json,
        current.supplyCharacter.anchor_approved_by,
        current.supplyCharacter.generation_reference_json
      );
    if (restoredCharacter.changes !== 1 || restoredSupply.changes !== 1) {
      throw new OfficialSupplyGateError("rollback_stale", `${draftKey} changed during rollback`);
    }
    const restoreAsset = db.prepare(
      `UPDATE official_supply_assets
       SET status=?, result_url=?, width=?, height=?, model=?, provider_request_id=?, qa_json=?,
           moderation_json=?, appearance_lock_hash=?, approved_tag=?, error=?, lease_owner=?,
           lease_expires_at=?, updated_at=datetime('now')
       WHERE draft_key=? AND slot_key=? AND result_url IS ?`
    );
    const restoreReplacement = db.prepare(
      `UPDATE official_supply_asset_replacements
       SET status=?, applied_at=?, updated_at=datetime('now')
       WHERE draft_key=? AND slot_key=? AND status='applied'`
    );
    for (const slotKey of slotKeys) {
      const asset = before.supplyAssets[slotKey]!;
      const assetInfo = restoreAsset.run(
        asset.status,
        asset.result_url,
        asset.width,
        asset.height,
        asset.model,
        asset.provider_request_id,
        asset.qa_json,
        asset.moderation_json,
        asset.appearance_lock_hash,
        asset.approved_tag,
        asset.error,
        asset.lease_owner,
        asset.lease_expires_at,
        draftKey,
        slotKey,
        current.supplyAssets[slotKey]!.result_url
      );
      const replacement = before.replacements[slotKey]!;
      const replacementInfo = restoreReplacement.run(replacement.status, replacement.applied_at, draftKey, slotKey);
      if (assetInfo.changes !== 1 || replacementInfo.changes !== 1) {
        throw new OfficialSupplyGateError("rollback_stale", `${draftKey}/${slotKey} changed during rollback`);
      }
    }
    if (canonicalJson(readApplyState(db, draftKey, ledger.character_id, slotKeys)) !== ledger.before_json) {
      throw new OfficialSupplyGateError("rollback_postcondition", `${draftKey} did not return to the pre-apply state`);
    }
    db.prepare(
      `UPDATE official_supply_replacement_applies
       SET status='rolled_back', rolled_back_by_id=?, rolled_back_at=datetime('now')
       WHERE apply_id=? AND status='applied'`
    ).run(input.actor.id ?? null, applyId);

    const result: OfficialReplacementRollbackResult = {
      status: input.dryRun ? "dry_run" : "rolled_back",
      applyId,
      characterId: ledger.character_id,
      draftKey,
      restored: slotKeys,
    };
    if (input.dryRun) {
      dryRunResult = result;
      throw new ReplacementDryRun();
    }
    return result;
  });

  try {
    return rollback();
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
    const asset = input.store.getAsset(input.draftKey, input.slotKey);
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
      sha256: sha256Hex(input.bytes),
    });
  } catch (error) {
    input.store.releaseExternalReplacementIntake(input.draftKey, input.slotKey, intakeId);
    throw error;
  }
}
