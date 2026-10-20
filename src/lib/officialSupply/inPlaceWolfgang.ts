import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import type Database from "better-sqlite3";

import {
  classifyStoredAppearanceAgainstApprovedLock,
  computeAppearanceLockHash,
  type StoredAppearanceIdentityClass,
} from "@/lib/officialSupply/appearance";
import { computeTextLockHash } from "@/lib/officialSupply/characterText";
import { getDataDir } from "@/lib/dataDir";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import type { OfficialAppearanceLock, OfficialCharacterDraft } from "@/lib/officialSupply/types";

/**
 * Wolfgang (#51) in-place manuscript sync target.
 *
 * The manuscript source file is `pilot-rf-02`, but the staged private character and its
 * approved image rows are keyed `pilot-rf-v4-02`. Source key, storage key and the pinned
 * Text Lock / Appearance Lock hashes live here so `inPlaceSync` stays the single writer.
 */
export const WOLFGANG_IN_PLACE_TARGET = {
  sourceDraftKey: "pilot-rf-02",
  supplyDraftKey: "pilot-rf-v4-02",
  characterName: "볼프강 폰 발켄하임",
  previousTextLockHash: "599854610891ee4e09224d1bec863501227157584b66068f0e1cab5e0e1ca89c",
  approvedTextLockHash: "e22ba966bdeab1babb331bdc916fe43a0e0d4e8adb3f5f2ba32f969c28ba2af2",
  appearanceLockHash: "1c3ccd134203a6dea6ae869c27cc443c42ff5498d1d0130c6f9765407c24dcc3",
} as const;

export type WolfgangInPlaceTarget = {
  sourceDraftKey: string;
  supplyDraftKey: string;
  characterName: string;
  previousTextLockHash: string;
  approvedTextLockHash: string;
  appearanceLockHash: string;
};

/** Survives Railway redeploy because DATA_DIR is the persistent volume (`/data`). */
export const WOLFGANG_APPROVED_SOURCE_RELATIVE = path.join(
  "official-supply",
  "approved",
  "pilot-rf-02.source.json"
);

export const OFFICIAL_SUPPLY_WOLFGANG_TARGET_PATH_ENV = "OFFICIAL_SUPPLY_WOLFGANG_TARGET_PATH";

export function wolfgangApprovedPersistedSourcePath(dataDir = getDataDir()): string {
  return path.join(dataDir, WOLFGANG_APPROVED_SOURCE_RELATIVE);
}

/**
 * Production pins stay in `WOLFGANG_IN_PLACE_TARGET`. Tests may point at a synthetic
 * target file only while the Node test runner is active.
 */
export function wolfgangInPlaceTarget(): WolfgangInPlaceTarget {
  const override =
    process.env.NODE_TEST_CONTEXT != null ? process.env[OFFICIAL_SUPPLY_WOLFGANG_TARGET_PATH_ENV]?.trim() : "";
  if (!override) return WOLFGANG_IN_PLACE_TARGET;
  const parsed = JSON.parse(fs.readFileSync(override, "utf8")) as WolfgangInPlaceTarget;
  if (
    parsed.sourceDraftKey !== WOLFGANG_IN_PLACE_TARGET.sourceDraftKey ||
    parsed.supplyDraftKey !== WOLFGANG_IN_PLACE_TARGET.supplyDraftKey ||
    parsed.characterName !== WOLFGANG_IN_PLACE_TARGET.characterName
  ) {
    throw new OfficialSupplyGateError(
      "wolfgang_test_target_identity",
      "synthetic Wolfgang target must keep the production source/supply identity"
    );
  }
  return parsed;
}

export function assertWolfgangApprovedLocks(input: {
  draft: OfficialCharacterDraft;
  appearanceLock: OfficialAppearanceLock;
}): { textLockHash: string; appearanceLockHash: string } {
  const target = wolfgangInPlaceTarget();
  const textLockHash = computeTextLockHash(input.draft);
  if (textLockHash !== target.approvedTextLockHash) {
    throw new OfficialSupplyGateError(
      "approved_source_text_lock_mismatch",
      `persisted ${target.sourceDraftKey} Text Lock ${textLockHash} is not the approved ${target.approvedTextLockHash}`
    );
  }
  const appearanceLockHash = computeAppearanceLockHash(input.appearanceLock);
  if (appearanceLockHash !== target.appearanceLockHash) {
    throw new OfficialSupplyGateError(
      "approved_source_appearance_lock_mismatch",
      `persisted ${target.sourceDraftKey} Appearance Lock ${appearanceLockHash} is not the approved ${target.appearanceLockHash}`
    );
  }
  return { textLockHash, appearanceLockHash };
}

const TEXT_LOCK_COVERED_DRAFT_KEYS: ReadonlySet<string> = new Set([
  "name",
  "tagline",
  "description",
  "greeting",
  "gender",
  "age",
  "genres",
  "sections",
  "speech",
  "supportingNpcs",
  "secrets",
  "adult",
  "creatorComment",
]);

const SUPPLY_IDENTITY_DRAFT_KEYS: ReadonlySet<string> = new Set(["draftKey", "styleKey"]);

export type WolfgangSupplyState = "previous_lock" | "approved_lock";

export type WolfgangSupplyPlan = {
  supplyDraftKey: string;
  state: WolfgangSupplyState;
  stage: string;
  characterId: number;
  expectedDraftJson: string;
  expectedTextLockHash: string;
  expectedAppearanceLockHash: string;
  nextDraftJson: string;
  nextTextLockHash: string;
};

type SupplyRow = {
  draft_key: string;
  stage: string;
  staged_character_id: number | null;
  draft_json: string | null;
  text_lock_hash: string | null;
  appearance_lock_hash: string | null;
};

export function resolveInPlaceSourceDraftKey(draftKey: string): string {
  return draftKey === WOLFGANG_IN_PLACE_TARGET.supplyDraftKey
    ? WOLFGANG_IN_PLACE_TARGET.sourceDraftKey
    : draftKey;
}

export function isWolfgangInPlaceSource(sourceDraftKey: string): boolean {
  return sourceDraftKey === WOLFGANG_IN_PLACE_TARGET.sourceDraftKey;
}

function parseStoredDraft(supply: SupplyRow): OfficialCharacterDraft {
  try {
    const parsed = JSON.parse(supply.draft_json ?? "") as OfficialCharacterDraft;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // handled below
  }
  throw new OfficialSupplyGateError(
    "supply_draft_invalid",
    `${supply.draft_key}: stored draft_json is not parseable`
  );
}

/**
 * Read-only plan for moving the staged supply row from the previous Text Lock to the approved
 * one. Every precondition is a STOP: wrong owner link, wrong stage, drifted lock/appearance,
 * a source that does not hash to the approved Text Lock, or a stored draft that differs from
 * the approved draft outside the Text Lock-covered fields.
 */
export function planWolfgangSupply(input: {
  db: Database.Database;
  characterId: number;
  characterName: string;
  source: { draft: OfficialCharacterDraft; appearanceLock: OfficialAppearanceLock };
}): WolfgangSupplyPlan {
  const target = wolfgangInPlaceTarget();
  if (input.characterName.trim() !== target.characterName) {
    throw new OfficialSupplyGateError(
      "character_identity_mismatch",
      `refusing to sync ${target.sourceDraftKey} onto character ${input.characterId} named ${input.characterName}`
    );
  }

  const sourceTextLockHash = computeTextLockHash(input.source.draft);
  if (sourceTextLockHash !== target.approvedTextLockHash) {
    throw new OfficialSupplyGateError(
      "text_lock_mismatch",
      `compiled ${target.sourceDraftKey} Text Lock ${sourceTextLockHash} is not the approved ${target.approvedTextLockHash}`
    );
  }
  const sourceAppearanceLockHash = computeAppearanceLockHash(input.source.appearanceLock);
  if (sourceAppearanceLockHash !== target.appearanceLockHash) {
    throw new OfficialSupplyGateError(
      "appearance_lock_stale",
      `compiled appearance lock ${sourceAppearanceLockHash} is not the approved ${target.appearanceLockHash}`
    );
  }

  const supply = input.db
    .prepare(
      `SELECT draft_key, stage, staged_character_id, draft_json, text_lock_hash, appearance_lock_hash
       FROM official_supply_characters WHERE draft_key=?`
    )
    .get(target.supplyDraftKey) as SupplyRow | undefined;
  if (!supply) {
    throw new OfficialSupplyGateError(
      "supply_mapping_required",
      `Wolfgang in-place requires official_supply_characters draft_key=${target.supplyDraftKey}`
    );
  }
  if (supply.staged_character_id !== input.characterId) {
    throw new OfficialSupplyGateError(
      "supply_draft_mismatch",
      `${target.supplyDraftKey} is linked to ${supply.staged_character_id ?? "no character"}, not ${input.characterId}`
    );
  }
  const foreign = input.db
    .prepare(
      `SELECT draft_key FROM official_supply_characters
       WHERE staged_character_id=? AND draft_key!=? ORDER BY draft_key ASC`
    )
    .all(input.characterId, target.supplyDraftKey) as Array<{ draft_key: string }>;
  if (foreign.length > 0) {
    throw new OfficialSupplyGateError(
      "supply_draft_mismatch",
      `character ${input.characterId} is also linked to ${foreign.map((item) => item.draft_key).join(",")}`
    );
  }
  if (supply.stage !== "staged_private") {
    throw new OfficialSupplyGateError(
      "supply_stage_required",
      `${target.supplyDraftKey} stage ${supply.stage} is not staged_private`
    );
  }
  if (supply.appearance_lock_hash !== target.appearanceLockHash) {
    throw new OfficialSupplyGateError(
      "appearance_lock_stale",
      `${target.supplyDraftKey} stored appearance lock is not the approved ${target.appearanceLockHash}`
    );
  }

  const storedDraft = parseStoredDraft(supply);
  const storedComputedHash = computeTextLockHash(storedDraft);
  if (!supply.text_lock_hash || supply.text_lock_hash !== storedComputedHash) {
    throw new OfficialSupplyGateError(
      "supply_text_lock_inconsistent",
      `${target.supplyDraftKey} text_lock_hash does not match its stored draft_json`
    );
  }
  let state: WolfgangSupplyState;
  if (supply.text_lock_hash === target.previousTextLockHash) {
    state = "previous_lock";
  } else if (supply.text_lock_hash === target.approvedTextLockHash) {
    state = "approved_lock";
  } else {
    throw new OfficialSupplyGateError(
      "supply_text_lock_mismatch",
      `${target.supplyDraftKey} Text Lock ${supply.text_lock_hash} is neither the previous nor the approved lock`
    );
  }

  const nextDraft = {
    ...input.source.draft,
    draftKey: storedDraft.draftKey,
    styleKey: storedDraft.styleKey,
  } satisfies OfficialCharacterDraft;
  if (storedDraft.draftKey !== target.supplyDraftKey) {
    throw new OfficialSupplyGateError(
      "supply_draft_mismatch",
      `${target.supplyDraftKey} stored draft identifies as ${storedDraft.draftKey}`
    );
  }
  if (computeTextLockHash(nextDraft) !== target.approvedTextLockHash) {
    throw new OfficialSupplyGateError(
      "text_lock_mismatch",
      "approved draft changed its Text Lock after supply identity was restored"
    );
  }
  const drifted = [...new Set([...Object.keys(storedDraft), ...Object.keys(nextDraft)])].filter(
    (key) =>
      !TEXT_LOCK_COVERED_DRAFT_KEYS.has(key) &&
      !SUPPLY_IDENTITY_DRAFT_KEYS.has(key) &&
      !isDeepStrictEqual(
        (storedDraft as Record<string, unknown>)[key],
        (nextDraft as Record<string, unknown>)[key]
      )
  );
  if (drifted.length > 0) {
    throw new OfficialSupplyGateError(
      "supply_draft_identity_drift",
      `${target.supplyDraftKey} stored draft differs outside the Text Lock fields: ${drifted.join(",")}`
    );
  }
  if (state === "approved_lock" && !isDeepStrictEqual(storedDraft, nextDraft)) {
    throw new OfficialSupplyGateError(
      "supply_text_lock_inconsistent",
      `${target.supplyDraftKey} carries the approved Text Lock but a different draft_json`
    );
  }

  return {
    supplyDraftKey: target.supplyDraftKey,
    state,
    stage: supply.stage,
    characterId: input.characterId,
    expectedDraftJson: supply.draft_json!,
    expectedTextLockHash: supply.text_lock_hash,
    expectedAppearanceLockHash: supply.appearance_lock_hash,
    nextDraftJson: state === "approved_lock" ? supply.draft_json! : JSON.stringify(nextDraft),
    nextTextLockHash: target.approvedTextLockHash,
  };
}

/** Same-transaction supply write: draft_json and text_lock_hash move together or not at all. */
export function applyWolfgangSupplyPlan(db: Database.Database, plan: WolfgangSupplyPlan): void {
  if (plan.state === "approved_lock") return;
  const updated = db
    .prepare(
      `UPDATE official_supply_characters
       SET draft_json=?, text_lock_hash=?, updated_at=datetime('now')
       WHERE draft_key=? AND stage=? AND staged_character_id=?
         AND draft_json=? AND text_lock_hash=? AND appearance_lock_hash=?`
    )
    .run(
      plan.nextDraftJson,
      plan.nextTextLockHash,
      plan.supplyDraftKey,
      plan.stage,
      plan.characterId,
      plan.expectedDraftJson,
      plan.expectedTextLockHash,
      plan.expectedAppearanceLockHash
    );
  if (updated.changes !== 1) {
    throw new OfficialSupplyGateError(
      "supply_write_mismatch",
      `${plan.supplyDraftKey} changed under the preflight snapshot; refusing to move the Text Lock`
    );
  }
}

/**
 * The stored `[외형]` raw text stays the representation the approved images were made from.
 * Only an identity contradiction against the Appearance Lock stops the sync. The compiled
 * summary is derived from this raw text and is not classified separately.
 */
export function assertWolfgangStoredAppearanceCompatible(input: {
  stored: string;
  lock: OfficialAppearanceLock;
  approvedCompact: string;
}): StoredAppearanceIdentityClass {
  const appearanceClass = classifyStoredAppearanceAgainstApprovedLock(
    input.stored,
    input.lock,
    input.approvedCompact
  );
  if (appearanceClass === "identity_conflict") {
    throw new OfficialSupplyGateError(
      "appearance_conflict",
      "stored appearance_raw contradicts the approved Wolfgang Appearance Lock; refusing sync"
    );
  }
  return appearanceClass;
}
