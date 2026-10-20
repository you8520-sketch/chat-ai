import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type Database from "better-sqlite3";

import { computeTextLockHash } from "@/lib/officialSupply/characterText";
import {
  LUCIAN_DRAFT_KEY,
  LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY,
} from "@/lib/officialSupply/officialDraftIdentity";
import { OfficialSupplyGateError } from "@/lib/officialSupply/store";
import type { OfficialCharacterDraft } from "@/lib/officialSupply/types";

export type LucianSupplyState = "already_synced" | "transition" | "legacy_lock_drift" | "link_only";

export type LucianSupplyPlan = {
  supplyDraftKey: string;
  state: LucianSupplyState;
  stage: string;
  characterId: number;
  expectedDraftJson: string;
  expectedTextLockHash: string;
  expectedStagedCharacterId: number | null;
  storedComputedTextLockHash: string;
  supplyDraftHash: string;
  nextDraftJson: string;
  nextTextLockHash: string;
};

type SupplyRow = {
  draft_key: string;
  stage: string;
  staged_character_id: number | null;
  draft_json: string | null;
  text_lock_hash: string | null;
};

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
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

function normalizeExpectedTextLockHash(value: string | null): string {
  return value?.trim() ?? "";
}

/**
 * Read-only plan for Lucian (#50) supply row Text Lock + draft_json coupling.
 * Unlike Wolfgang, legacy rows may carry a stale text_lock_hash; dry-run reports that drift
 * and apply repairs both columns atomically under the preflight CAS snapshot.
 */
export function planLucianSupply(input: {
  db: Database.Database;
  characterId: number;
  characterName: string;
  source: { draft: OfficialCharacterDraft };
}): LucianSupplyPlan {
  const supply = input.db
    .prepare(
      `SELECT draft_key, stage, staged_character_id, draft_json, text_lock_hash
       FROM official_supply_characters WHERE draft_key=?`
    )
    .get(LUCIAN_DRAFT_KEY) as SupplyRow | undefined;
  if (!supply) {
    throw new OfficialSupplyGateError(
      "supply_mapping_required",
      `Lucian in-place requires official_supply_characters draft_key=${LUCIAN_DRAFT_KEY}`
    );
  }
  if (supply.staged_character_id != null && supply.staged_character_id !== input.characterId) {
    throw new OfficialSupplyGateError(
      "supply_draft_mismatch",
      `${LUCIAN_DRAFT_KEY} is linked to ${supply.staged_character_id}, not ${input.characterId}`
    );
  }

  const foreign = input.db
    .prepare(
      `SELECT draft_key FROM official_supply_characters
       WHERE staged_character_id=? AND draft_key NOT IN (?, ?)
       ORDER BY draft_key ASC`
    )
    .all(input.characterId, LUCIAN_DRAFT_KEY, LUCIAN_PUBLISHED_PREDECESSOR_DRAFT_KEY) as Array<{
    draft_key: string;
  }>;
  if (foreign.length > 0) {
    throw new OfficialSupplyGateError(
      "supply_draft_mismatch",
      `character ${input.characterId} is also linked to ${foreign.map((item) => item.draft_key).join(",")}`
    );
  }

  const expectedDraftJson = supply.draft_json ?? "{}";
  const expectedTextLockHash = normalizeExpectedTextLockHash(supply.text_lock_hash);
  const storedDraft = parseStoredDraft(supply);
  const storedComputedTextLockHash = computeTextLockHash(storedDraft);
  const nextDraft = {
    ...input.source.draft,
    draftKey: LUCIAN_DRAFT_KEY,
    styleKey: storedDraft.styleKey ?? input.source.draft.styleKey,
  } satisfies OfficialCharacterDraft;
  const nextTextLockHash = computeTextLockHash(nextDraft);
  const nextDraftJson = JSON.stringify(nextDraft);
  const lockConsistent = expectedTextLockHash === storedComputedTextLockHash;
  const draftAlreadyTarget =
    expectedDraftJson === nextDraftJson || isDeepStrictEqual(storedDraft, nextDraft);
  const lockAlreadyTarget = expectedTextLockHash === nextTextLockHash;

  let state: LucianSupplyState;
  if (draftAlreadyTarget && lockAlreadyTarget) {
    state = supply.staged_character_id === input.characterId ? "already_synced" : "link_only";
  } else if (!lockConsistent) {
    state = "legacy_lock_drift";
  } else {
    state = "transition";
  }

  return {
    supplyDraftKey: LUCIAN_DRAFT_KEY,
    state,
    stage: supply.stage,
    characterId: input.characterId,
    expectedDraftJson,
    expectedTextLockHash,
    expectedStagedCharacterId: supply.staged_character_id,
    storedComputedTextLockHash,
    supplyDraftHash: sha256(expectedDraftJson),
    nextDraftJson,
    nextTextLockHash,
  };
}

/** Same-transaction supply write: draft_json and text_lock_hash move together or not at all. */
export function applyLucianSupplyPlan(db: Database.Database, plan: LucianSupplyPlan): void {
  if (plan.state === "already_synced") return;

  if (plan.state === "link_only") {
    const linked = db
      .prepare(
        `UPDATE official_supply_characters
         SET staged_character_id=?, updated_at=datetime('now')
         WHERE draft_key=? AND stage=?
           AND COALESCE(draft_json,'')=?
           AND COALESCE(text_lock_hash,'')=?
           AND staged_character_id IS NULL`
      )
      .run(
        plan.characterId,
        plan.supplyDraftKey,
        plan.stage,
        plan.expectedDraftJson,
        plan.expectedTextLockHash
      );
    if (linked.changes !== 1) {
      throw new OfficialSupplyGateError(
        "supply_write_mismatch",
        `${plan.supplyDraftKey} changed under the preflight snapshot; refusing to link the supply row`
      );
    }
    return;
  }

  const updated = db
    .prepare(
      `UPDATE official_supply_characters
       SET draft_json=?, text_lock_hash=?, staged_character_id=?, updated_at=datetime('now')
       WHERE draft_key=? AND stage=?
         AND COALESCE(draft_json,'')=?
         AND COALESCE(text_lock_hash,'')=?
         AND (
           (? IS NULL AND staged_character_id IS NULL) OR staged_character_id=?
         )`
    )
    .run(
      plan.nextDraftJson,
      plan.nextTextLockHash,
      plan.characterId,
      plan.supplyDraftKey,
      plan.stage,
      plan.expectedDraftJson,
      plan.expectedTextLockHash,
      plan.expectedStagedCharacterId,
      plan.characterId
    );
  if (updated.changes !== 1) {
    throw new OfficialSupplyGateError(
      "supply_write_mismatch",
      `${plan.supplyDraftKey} changed under the preflight snapshot; refusing to move draft_json and Text Lock together`
    );
  }
}
