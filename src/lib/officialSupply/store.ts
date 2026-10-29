import type Database from "better-sqlite3";
import { parseAssets } from "@/lib/characterAssets";
import { parseCharacterFormBody, type SessionUser } from "@/lib/characterFormSave";
import { primaryCharacterGenre } from "@/lib/characterGenres";
import { getDb } from "@/lib/db";
import type { OpenAiImageQuality } from "@/lib/openAiImageEdit";
import {
  computeAppearanceLockHash,
  evaluateAppearanceLock,
  renderRuntimeAppearanceBlock,
} from "@/lib/officialSupply/appearance";
import { evaluateAssetPlan } from "@/lib/officialSupply/assetPlan";
import { canAdminManageOfficialCharacter, type OfficialAdminActor } from "@/lib/officialAdminAccess";
import { officialModerationVerdict } from "@/lib/officialSupply/moderation";
import {
  buildOfficialCharacterFormBody,
  computeTextLockHash,
  evaluateAgeAndAdultConsistency,
  evaluateDraftSchema,
  evaluateOfficialStagedSaveLength,
  evaluateOfficialTextLength,
  evaluateSupportingNpcs,
  mergeQa,
} from "@/lib/officialSupply/characterText";
import {
  parseOfficialApprovedAssetReference,
  resolveOfficialGenerationReferencePlan,
} from "@/lib/officialSupply/generationReferences";
import { officialImageProfileForSlot } from "@/lib/officialSupply/imageProfile";
import { mapOfficialPublicAssetSlots } from "@/lib/officialSupply/publicAssetMap";
import { evaluatePortfolioBalance, type OfficialPortfolioPolicy } from "@/lib/officialSupply/research";
import {
  DEFAULT_STYLE_PROOF_ASSET_LIMIT,
  validateStyleProposal,
  validateStyleSeedForApproval,
} from "@/lib/officialSupply/style";
import {
  isStageAtLeast,
  qaResult,
  type OfficialAnchorQaReport,
  type OfficialAppearanceLock,
  type OfficialAssetModeration,
  type OfficialAssetPlan,
  type OfficialAssetSlotKind,
  type OfficialAssetSlotPlan,
  type OfficialAssetStatus,
  type OfficialCharacterDraft,
  type OfficialCharacterStage,
  type OfficialGenerationReferencePolicy,
  type OfficialGenreStyle,
  type OfficialReplacementStatus,
  type OfficialStyleStage,
  type OfficialVariationQaReport,
  type QaIssue,
  type QaResult,
  type StyleReference,
  type VisualStyleCandidate,
} from "@/lib/officialSupply/types";
import {
  evaluateOriginality,
  evaluateWorldDiversity,
  type OriginalityCorpusEntry,
} from "@/lib/officialSupply/worldQa";

export type OfficialSupplyBatchConfig = {
  /** Rollout gate (e.g. pilot 5 worlds / 50 characters) — configuration, never hardcoded. */
  rollout: { maxWorlds: number; maxCharacters: number };
  budgetUsd: { batch: number; perGenre?: number; perWorld?: number; perCharacter?: number };
  /** Conservative per-image reserve used for pre-call budget checks and unknown-cost attempts. */
  reservePerImageUsd: number;
  maxAttemptsPerSlot: number;
  leaseMs: number;
  quality: OpenAiImageQuality;
  portfolio: OfficialPortfolioPolicy;
};

export type OfficialSupplyBatch = {
  batchKey: string;
  config: OfficialSupplyBatchConfig;
  status: "active" | "paused";
  pauseReason: string | null;
};

export type OfficialCharacterRecord = {
  draftKey: string;
  batchKey: string;
  worldKey: string;
  styleKey: string;
  stage: OfficialCharacterStage;
  draft: OfficialCharacterDraft;
  textLockHash: string | null;
  appearance: OfficialAppearanceLock | null;
  appearanceLockHash: string | null;
  assetPlan: OfficialAssetPlan | null;
  isStyleProof: boolean;
  stagedCharacterId: number | null;
  generationReferencePolicy?: OfficialGenerationReferencePolicy | null;
};

export type OfficialLockedSnapshotReconcileInput = {
  expectedDraftJson: string;
  expectedAssetPlanJson: string;
  expectedTextLockHash: string;
  expectedAppearanceLockHash: string;
  expectedRepresentative: {
    status: "generated";
    resultUrl: string;
    attempts: number;
  };
  nextDraft: OfficialCharacterDraft;
  nextPlan: OfficialAssetPlan;
};

export type OfficialLockedSnapshotReconcileResult = {
  status: "updated" | "already_current";
  textLockHash: string;
};

export type OfficialAssetRecord = {
  draftKey: string;
  slotKey: string;
  kind: OfficialAssetSlotKind;
  status: OfficialAssetStatus;
  attempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  model: string | null;
  providerRequestId: string | null;
  resultUrl: string | null;
  width: number | null;
  height: number | null;
  spentUsd: number;
  hasUnknownCost: boolean;
  appearanceLockHash: string | null;
  error: string | null;
  qa: OfficialVariationQaReport | OfficialAnchorQaReport | null;
  moderation: OfficialAssetModeration | null;
  /** Human-approved action/situation tag. Never filled from vision auto-classification. */
  approvedTag: string | null;
};

/** One pending/reviewed replacement candidate for an already-active slot. */
export type OfficialReplacementRecord = {
  draftKey: string;
  slotKey: string;
  kind: OfficialAssetSlotKind;
  status: OfficialReplacementStatus;
  baseResultUrl: string;
  candidateResultUrl: string | null;
  width: number | null;
  height: number | null;
  attempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
  model: string | null;
  providerRequestId: string | null;
  spentUsd: number;
  hasUnknownCost: boolean;
  appearanceLockHash: string | null;
  error: string | null;
  qa: OfficialVariationQaReport | OfficialAnchorQaReport | null;
  moderation: OfficialAssetModeration | null;
  appliedAt: string | null;
  /** Human-approved action/situation tag. Never filled from vision auto-classification. */
  approvedTag: string | null;
  /** Raw SHA-256 of an external candidate file, recorded before the file is stored. */
  candidateSha256: string | null;
  /** Representative anchor reviewer; null for RP variation review. */
  reviewedBy: string | null;
  /** Text Lock the candidate review was recorded against. */
  reviewedTextLockHash: string | null;
};

/** Append-only record of one explicit correction of a rejected representative review. */
export type OfficialReplacementRereviewRecord = {
  id: number;
  draftKey: string;
  slotKey: string;
  candidateResultUrl: string;
  candidateSha256: string;
  baseResultUrl: string;
  textLockHash: string | null;
  appearanceLockHash: string;
  previousStatus: string;
  previousQa: OfficialAnchorQaReport;
  previousReviewedBy: string | null;
  previousReviewedTextLockHash: string | null;
  newStatus: string;
  newQa: OfficialAnchorQaReport;
  reviewer: string;
  correctionReason: string;
  correctionEvidence: string;
  actorId: number | null;
  createdAt: string;
};

type RereviewRow = {
  id: number;
  draft_key: string;
  slot_key: string;
  candidate_result_url: string;
  candidate_sha256: string;
  base_result_url: string;
  text_lock_hash: string | null;
  appearance_lock_hash: string;
  previous_status: string;
  previous_qa_json: string;
  previous_reviewed_by: string | null;
  previous_reviewed_text_lock_hash: string | null;
  new_status: string;
  new_qa_json: string;
  reviewer: string;
  correction_reason: string;
  correction_evidence: string;
  actor_id: number | null;
  created_at: string;
};

/** Public voice fields that failed QA. View-only; never a saved character. */
export type RejectedPublicManuscript = {
  greeting: string;
  description: string;
  comment: string;
};

export class OfficialSupplyGateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly qa?: QaResult,
    public readonly rejectedPublicManuscript?: RejectedPublicManuscript
  ) {
    super(message);
    this.name = "OfficialSupplyGateError";
  }
}

/** Additive tables only — no existing table is altered. */
export function ensureOfficialSupplySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS official_supply_batches (
      batch_key TEXT PRIMARY KEY,
      config_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      pause_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS official_supply_styles (
      style_key TEXT PRIMARY KEY,
      genre TEXT NOT NULL,
      stage TEXT NOT NULL,
      candidates_json TEXT NOT NULL,
      approved_candidate_id TEXT,
      style_seed_json TEXT,
      proof_asset_limit INTEGER NOT NULL,
      candidate_approved_by TEXT,
      proof_decided_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS official_supply_characters (
      draft_key TEXT PRIMARY KEY,
      batch_key TEXT NOT NULL,
      world_key TEXT NOT NULL,
      style_key TEXT NOT NULL,
      stage TEXT NOT NULL,
      draft_json TEXT NOT NULL,
      text_lock_hash TEXT,
      appearance_json TEXT,
      appearance_lock_hash TEXT,
      asset_plan_json TEXT,
      is_style_proof INTEGER NOT NULL DEFAULT 0,
      anchor_approved_by TEXT,
      staging_claim TEXT,
      staged_character_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_official_supply_characters_batch
      ON official_supply_characters(batch_key, world_key);
    CREATE TABLE IF NOT EXISTS official_supply_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_key TEXT NOT NULL,
      slot_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT,
      lease_expires_at INTEGER,
      model TEXT,
      provider_request_id TEXT,
      result_url TEXT,
      width INTEGER,
      height INTEGER,
      spent_usd REAL NOT NULL DEFAULT 0,
      has_unknown_cost INTEGER NOT NULL DEFAULT 0,
      appearance_lock_hash TEXT,
      error TEXT,
      qa_json TEXT,
      moderation_json TEXT,
      approved_tag TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(draft_key, slot_key)
    );
    CREATE TABLE IF NOT EXISTS official_supply_world_lorebooks (
      world_key TEXT NOT NULL,
      entry_key TEXT NOT NULL,
      creator_id INTEGER NOT NULL,
      lorebook_id INTEGER NOT NULL,
      PRIMARY KEY (world_key, entry_key, creator_id)
    );
    CREATE TABLE IF NOT EXISTS official_supply_asset_replacements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_key TEXT NOT NULL,
      slot_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      base_result_url TEXT NOT NULL,
      candidate_result_url TEXT,
      width INTEGER,
      height INTEGER,
      attempts INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT,
      lease_expires_at INTEGER,
      model TEXT,
      provider_request_id TEXT,
      spent_usd REAL NOT NULL DEFAULT 0,
      has_unknown_cost INTEGER NOT NULL DEFAULT 0,
      appearance_lock_hash TEXT,
      error TEXT,
      moderation_json TEXT,
      qa_json TEXT,
      applied_at TEXT,
      approved_tag TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(draft_key, slot_key)
    );
    CREATE TABLE IF NOT EXISTS official_supply_replacement_applies (
      apply_id TEXT PRIMARY KEY,
      draft_key TEXT NOT NULL,
      character_id INTEGER NOT NULL,
      slot_keys_json TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      status TEXT NOT NULL,
      applied_by_id INTEGER,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      rolled_back_by_id INTEGER,
      rolled_back_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_official_supply_replacement_applies_draft
      ON official_supply_replacement_applies(draft_key, applied_at);
    CREATE TABLE IF NOT EXISTS official_supply_replacement_rereviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_key TEXT NOT NULL,
      slot_key TEXT NOT NULL,
      candidate_result_url TEXT NOT NULL,
      candidate_sha256 TEXT NOT NULL,
      base_result_url TEXT NOT NULL,
      text_lock_hash TEXT,
      appearance_lock_hash TEXT NOT NULL,
      previous_status TEXT NOT NULL,
      previous_qa_json TEXT NOT NULL,
      previous_reviewed_by TEXT,
      previous_reviewed_text_lock_hash TEXT,
      new_status TEXT NOT NULL,
      new_qa_json TEXT NOT NULL,
      reviewer TEXT NOT NULL,
      correction_reason TEXT NOT NULL,
      correction_evidence TEXT NOT NULL,
      actor_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_official_supply_replacement_rereviews_slot
      ON official_supply_replacement_rereviews(draft_key, slot_key, id);
  `);
  ensureOfficialSupplyColumn(db, "official_supply_assets", "approved_tag", "TEXT");
  ensureOfficialSupplyColumn(db, "official_supply_asset_replacements", "approved_tag", "TEXT");
  ensureOfficialSupplyColumn(db, "official_supply_asset_replacements", "candidate_sha256", "TEXT");
  ensureOfficialSupplyColumn(db, "official_supply_asset_replacements", "reviewed_by", "TEXT");
  ensureOfficialSupplyColumn(db, "official_supply_asset_replacements", "reviewed_text_lock_hash", "TEXT");
  ensureOfficialSupplyColumn(db, "official_supply_characters", "generation_reference_json", "TEXT");
  const assetColumns = new Set(
    (db.prepare("PRAGMA table_info(official_supply_assets)").all() as Array<{ name: string }>).map((c) => c.name)
  );
  if (!assetColumns.has("moderation_json")) {
    db.exec("ALTER TABLE official_supply_assets ADD COLUMN moderation_json TEXT");
  }
}

function ensureOfficialSupplyColumn(
  db: Database.Database,
  table: "official_supply_assets" | "official_supply_asset_replacements" | "official_supply_characters",
  column: string,
  ddl: string
): void {
  const columns = new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name)
  );
  if (!columns.has(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

type CharacterRow = {
  draft_key: string;
  batch_key: string;
  world_key: string;
  style_key: string;
  stage: string;
  draft_json: string;
  text_lock_hash: string | null;
  appearance_json: string | null;
  appearance_lock_hash: string | null;
  asset_plan_json: string | null;
  is_style_proof: number;
  staged_character_id: number | null;
  generation_reference_json: string | null;
};

type AssetRow = {
  draft_key: string;
  slot_key: string;
  kind: string;
  status: string;
  attempts: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  model: string | null;
  provider_request_id: string | null;
  result_url: string | null;
  width: number | null;
  height: number | null;
  spent_usd: number;
  has_unknown_cost: number;
  appearance_lock_hash: string | null;
  error: string | null;
  qa_json: string | null;
  moderation_json: string | null;
  approved_tag: string | null;
};

type ReplacementRow = {
  draft_key: string;
  slot_key: string;
  kind: string;
  status: string;
  base_result_url: string;
  candidate_result_url: string | null;
  width: number | null;
  height: number | null;
  attempts: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  model: string | null;
  provider_request_id: string | null;
  spent_usd: number;
  has_unknown_cost: number;
  appearance_lock_hash: string | null;
  error: string | null;
  qa_json: string | null;
  moderation_json: string | null;
  applied_at: string | null;
  approved_tag: string | null;
  candidate_sha256: string | null;
  reviewed_by: string | null;
  reviewed_text_lock_hash: string | null;
};

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

function toCharacter(row: CharacterRow): OfficialCharacterRecord {
  return {
    draftKey: row.draft_key,
    batchKey: row.batch_key,
    worldKey: row.world_key,
    styleKey: row.style_key,
    stage: row.stage as OfficialCharacterStage,
    draft: JSON.parse(row.draft_json) as OfficialCharacterDraft,
    textLockHash: row.text_lock_hash,
    appearance: parseJson<OfficialAppearanceLock>(row.appearance_json),
    appearanceLockHash: row.appearance_lock_hash,
    assetPlan: parseJson<OfficialAssetPlan>(row.asset_plan_json),
    isStyleProof: row.is_style_proof === 1,
    stagedCharacterId: row.staged_character_id,
    generationReferencePolicy: parseJson<OfficialGenerationReferencePolicy>(row.generation_reference_json),
  };
}

function toAsset(row: AssetRow): OfficialAssetRecord {
  return {
    draftKey: row.draft_key,
    slotKey: row.slot_key,
    kind: row.kind as OfficialAssetSlotKind,
    status: row.status as OfficialAssetStatus,
    attempts: row.attempts,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    model: row.model,
    providerRequestId: row.provider_request_id,
    resultUrl: row.result_url,
    width: row.width,
    height: row.height,
    spentUsd: row.spent_usd,
    hasUnknownCost: row.has_unknown_cost === 1,
    appearanceLockHash: row.appearance_lock_hash,
    error: row.error,
    qa: parseJson(row.qa_json),
    moderation: parseJson<OfficialAssetModeration>(row.moderation_json),
    approvedTag: row.approved_tag,
  };
}

function toReplacement(row: ReplacementRow): OfficialReplacementRecord {
  return {
    draftKey: row.draft_key,
    slotKey: row.slot_key,
    kind: row.kind as OfficialAssetSlotKind,
    status: row.status as OfficialReplacementStatus,
    baseResultUrl: row.base_result_url,
    candidateResultUrl: row.candidate_result_url,
    width: row.width,
    height: row.height,
    attempts: row.attempts,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    model: row.model,
    providerRequestId: row.provider_request_id,
    spentUsd: row.spent_usd,
    hasUnknownCost: row.has_unknown_cost === 1,
    appearanceLockHash: row.appearance_lock_hash,
    error: row.error,
    qa: parseJson(row.qa_json),
    moderation: parseJson<OfficialAssetModeration>(row.moderation_json),
    appliedAt: row.applied_at,
    approvedTag: row.approved_tag,
    candidateSha256: row.candidate_sha256,
    reviewedBy: row.reviewed_by,
    reviewedTextLockHash: row.reviewed_text_lock_hash,
  };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

const REPRESENTATIVE_LOOK_FIELDS = [
  "slotKey",
  "kind",
  "tag",
  "expression",
  "pose",
  "outfit",
  "location",
  "situation",
  "characterPresence",
  "depiction",
  "personTag",
] as const;

type LockedCharacterRow = {
  draft_key: string;
  batch_key: string;
  world_key: string;
  style_key: string;
  stage: string;
  draft_json: string;
  text_lock_hash: string | null;
  appearance_json: string | null;
  appearance_lock_hash: string | null;
  asset_plan_json: string | null;
  is_style_proof: number;
  anchor_approved_by: string | null;
  staging_claim: string | null;
  staged_character_id: number | null;
};

type AssetSnapshotRow = AssetRow & { id: number; updated_at: string };

function anchorQaPasses(qa: OfficialAnchorQaReport): boolean {
  return Object.values(qa).every((check) => check.ok);
}

export const VARIATION_QA_KEYS = [
  "identityMatchesAnchor",
  "expressionMatchesPlan",
  "characterPresent",
  "artStyle",
] as const satisfies ReadonlyArray<keyof OfficialVariationQaReport>;

export const ANCHOR_QA_KEYS = [
  "gender",
  "ageAppearance",
  "face",
  "hair",
  "eyes",
  "body",
  "identifyingFeatures",
  "artStyle",
  "outfit",
  "cardCrop",
] as const satisfies ReadonlyArray<keyof OfficialAnchorQaReport>;

/** Check every new review must record on top of the legacy keys (composition is not a clone of a reference). */
export const COMPOSITION_QA_KEY = "compositionIndependence" as const satisfies
  keyof OfficialAnchorQaReport & keyof OfficialVariationQaReport;

/**
 * Every anchor check is present and passing. A variation report never qualifies.
 * `compositionIndependence` is required when a review is recorded (`assertCompositionReviewRecorded`) but
 * absent from reviews recorded earlier, so at apply time it only blocks when recorded as failing.
 */
export function isCompletePassingAnchorQa(qa: unknown): qa is OfficialAnchorQaReport {
  if (!qa || typeof qa !== "object") return false;
  const record = qa as Record<string, { ok?: unknown } | undefined>;
  if (record[COMPOSITION_QA_KEY] && record[COMPOSITION_QA_KEY]?.ok !== true) return false;
  return ANCHOR_QA_KEYS.every((key) => record[key]?.ok === true);
}

/** A new review must state whether composition is independent; a missing answer is not an approval or a rejection. */
function assertCompositionReviewRecorded(
  qa: OfficialAnchorQaReport | OfficialVariationQaReport,
  scope: string
): void {
  if (typeof qa[COMPOSITION_QA_KEY]?.ok !== "boolean") {
    throw new OfficialSupplyGateError(
      "composition_review_required",
      `${scope} review must record ${COMPOSITION_QA_KEY} (composition is not a clone of a style reference)`
    );
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const REVIEW_CANDIDATE_REFERENCE = /^official-review-candidate:([0-9a-f]{64}):/;

/** Reference ids that already carry the file's SHA-256 (review-candidate and approved-asset tokens). */
function pinnedReferenceSha256(id: string): string | null {
  const candidate = REVIEW_CANDIDATE_REFERENCE.exec(id)?.[1];
  if (candidate) return candidate;
  try {
    return parseOfficialApprovedAssetReference(id)?.sha256 ?? null;
  } catch {
    return null;
  }
}

/**
 * A representative review is the only gate before 13 slots inherit the face. It must therefore carry the
 * full anchor checklist (no key left out) and a composition judgement with its comparison basis: the
 * candidate (URL + SHA-256) and every reference image it was compared against. A reviewer's blanket
 * "approve" is not a QA report.
 */
function assertRepresentativeReviewEvidence(
  qa: OfficialAnchorQaReport,
  scope: string,
  bound: {
    candidateUrl: string;
    candidateSha256?: string;
    /** Exactly the reference ids the generator sent; absent when the candidate is an external file. */
    sentReferenceIds?: readonly string[];
  }
): void {
  const missing = ANCHOR_QA_KEYS.filter((key) => typeof qa[key]?.ok !== "boolean");
  if (missing.length > 0) {
    throw new OfficialSupplyGateError("qa_incomplete", `${scope} review is missing QA checks: ${missing.join(", ")}`);
  }
  const unexplained = ANCHOR_QA_KEYS.filter((key) => typeof qa[key]?.note !== "string" || !qa[key]?.note?.trim());
  if (unexplained.length > 0) {
    throw new OfficialSupplyGateError(
      "qa_note_required",
      `${scope} review needs a non-empty note for every QA check: ${unexplained.join(", ")}`
    );
  }
  assertCompositionReviewRecorded(qa, scope);
  const check = qa[COMPOSITION_QA_KEY]!;
  const fail = (code: string, message: string): never => {
    throw new OfficialSupplyGateError(code, `${scope} ${COMPOSITION_QA_KEY}: ${message}`);
  };
  if (!check.note?.trim()) fail("composition_evidence_required", "a note explaining the judgement is required");
  const evidence = check.evidence;
  if (!evidence || typeof evidence !== "object") {
    return fail("composition_evidence_required", "comparison evidence (candidate and references) is required");
  }
  if (evidence.candidateUrl !== bound.candidateUrl) {
    fail("composition_evidence_mismatch", "evidence names a different candidate file than the one being reviewed");
  }
  const candidateSha = String(evidence.candidateSha256 ?? "").trim().toLowerCase();
  if (!SHA256_HEX.test(candidateSha)) fail("composition_evidence_required", "candidate SHA-256 is required");
  if (bound.candidateSha256 && candidateSha !== bound.candidateSha256.trim().toLowerCase()) {
    fail("composition_evidence_mismatch", "evidence SHA-256 differs from the stored candidate file");
  }
  const references = Array.isArray(evidence.references) ? evidence.references : [];
  if (references.length === 0) fail("composition_evidence_required", "at least one compared reference is required");
  const ids = new Set<string>();
  for (const reference of references) {
    const id = typeof reference?.id === "string" ? reference.id.trim() : "";
    if (!id || !SHA256_HEX.test(String(reference?.sha256 ?? "").trim().toLowerCase())) {
      fail("composition_evidence_required", "every reference needs an id and a SHA-256");
    }
    if (ids.has(id)) fail("composition_evidence_required", `reference ${id} is listed twice`);
    const pinned = pinnedReferenceSha256(id);
    if (pinned && pinned !== String(reference.sha256).trim().toLowerCase()) {
      fail("composition_evidence_mismatch", `reference ${id} SHA-256 differs from the one pinned in its id`);
    }
    ids.add(id);
  }
  if (bound.sentReferenceIds) {
    const sent = new Set(bound.sentReferenceIds);
    const unsent = [...ids].filter((id) => !sent.has(id));
    const uncompared = [...sent].filter((id) => !ids.has(id));
    if (unsent.length > 0 || uncompared.length > 0) {
      fail(
        "composition_evidence_mismatch",
        `compared references must be exactly the ones sent (not sent: ${unsent.length}, not compared: ${uncompared.length})`
      );
    }
  }
}

function variationQaPasses(qa: OfficialVariationQaReport): boolean {
  return Object.values(qa).every((check) => check.ok);
}

/** Placeholder asset used only for the canonical dry-run parse at TEXT_LOCK — never persisted. */
const TEXT_LOCK_DRY_RUN_ASSET = {
  url: "/uploads/official-supply-dry-run.webp",
  tag: "dry-run",
  width: 1024,
  height: 1536,
  viewerBlur: false,
  representativeRank: 1,
};

export class OfficialSupplyStore {
  constructor(private readonly db: Database.Database = getDb()) {
    ensureOfficialSupplySchema(db);
  }

  get database(): Database.Database {
    return this.db;
  }

  createBatch(batchKey: string, config: OfficialSupplyBatchConfig): OfficialSupplyBatch {
    this.db
      .prepare("INSERT INTO official_supply_batches (batch_key, config_json) VALUES (?, ?)")
      .run(batchKey, JSON.stringify(config));
    return this.getBatch(batchKey);
  }

  getBatch(batchKey: string): OfficialSupplyBatch {
    const row = this.db
      .prepare("SELECT batch_key, config_json, status, pause_reason FROM official_supply_batches WHERE batch_key=?")
      .get(batchKey) as { batch_key: string; config_json: string; status: string; pause_reason: string | null } | undefined;
    if (!row) throw new OfficialSupplyGateError("batch_not_found", `batch ${batchKey} not found`);
    return {
      batchKey: row.batch_key,
      config: JSON.parse(row.config_json) as OfficialSupplyBatchConfig,
      status: row.status === "paused" ? "paused" : "active",
      pauseReason: row.pause_reason,
    };
  }

  pauseBatch(batchKey: string, reason: string): void {
    this.db
      .prepare("UPDATE official_supply_batches SET status='paused', pause_reason=? WHERE batch_key=?")
      .run(reason, batchKey);
  }

  resumeBatch(batchKey: string): void {
    this.db
      .prepare("UPDATE official_supply_batches SET status='active', pause_reason=NULL WHERE batch_key=?")
      .run(batchKey);
  }

  /**
   * One-way config promotion after every style used by the batch is locked.
   * Idempotent for the target config and fail-closed on config drift.
   */
  promoteBatchConfigAfterStyleLock(
    batchKey: string,
    expectedCurrent: OfficialSupplyBatchConfig,
    next: OfficialSupplyBatchConfig
  ): OfficialSupplyBatch {
    const current = this.getBatch(batchKey);
    if (current.status !== "active") {
      throw new OfficialSupplyGateError(
        "batch_paused",
        `batch ${batchKey} is paused: ${current.pauseReason ?? ""}`
      );
    }

    const currentJson = JSON.stringify(current.config);
    const expectedJson = JSON.stringify(expectedCurrent);
    const nextJson = JSON.stringify(next);
    if (currentJson === nextJson) return current;
    if (currentJson !== expectedJson) {
      throw new OfficialSupplyGateError(
        "batch_config_drift",
        `batch ${batchKey} config differs from both expected proof config and production config`
      );
    }

    const unlocked = this.db
      .prepare(
        `SELECT DISTINCT c.style_key, s.stage
           FROM official_supply_characters c
           JOIN official_supply_styles s ON s.style_key=c.style_key
          WHERE c.batch_key=? AND s.stage<>'style_locked'`
      )
      .all(batchKey) as Array<{ style_key: string; stage: string }>;
    if (unlocked.length > 0) {
      throw new OfficialSupplyGateError(
        "style_not_locked",
        `batch ${batchKey} contains unlocked styles: ${unlocked
          .map((row) => `${row.style_key}=${row.stage}`)
          .join(",")}`
      );
    }

    this.db
      .prepare("UPDATE official_supply_batches SET config_json=? WHERE batch_key=?")
      .run(nextJson, batchKey);
    return this.getBatch(batchKey);
  }

  // ── Genre style (STYLE_CANDIDATE_APPROVAL / STYLE_PROOF_APPROVAL) ──────────

  proposeStyle(input: {
    styleKey: string;
    genre: OfficialGenreStyle["genre"];
    candidates: VisualStyleCandidate[];
    proofAssetLimit?: number;
  }): OfficialGenreStyle {
    const qa = validateStyleProposal(input);
    if (!qa.ok) throw new OfficialSupplyGateError("style_proposal_invalid", "style proposal failed QA", qa);
    this.db
      .prepare(
        `INSERT INTO official_supply_styles (style_key, genre, stage, candidates_json, proof_asset_limit)
         VALUES (?, ?, 'candidates_proposed', ?, ?)`
      )
      .run(
        input.styleKey,
        input.genre,
        JSON.stringify(input.candidates),
        input.proofAssetLimit ?? DEFAULT_STYLE_PROOF_ASSET_LIMIT
      );
    return this.getStyle(input.styleKey);
  }

  getStyle(styleKey: string): OfficialGenreStyle {
    const row = this.db
      .prepare(
        `SELECT style_key, genre, stage, candidates_json, approved_candidate_id, style_seed_json, proof_asset_limit
         FROM official_supply_styles WHERE style_key=?`
      )
      .get(styleKey) as
      | {
          style_key: string;
          genre: string;
          stage: string;
          candidates_json: string;
          approved_candidate_id: string | null;
          style_seed_json: string | null;
          proof_asset_limit: number;
        }
      | undefined;
    if (!row) throw new OfficialSupplyGateError("style_not_found", `style ${styleKey} not found`);
    return {
      styleKey: row.style_key,
      genre: row.genre as OfficialGenreStyle["genre"],
      stage: row.stage as OfficialStyleStage,
      candidates: JSON.parse(row.candidates_json) as VisualStyleCandidate[],
      approvedCandidateId: row.approved_candidate_id,
      styleSeed: parseJson<StyleReference>(row.style_seed_json),
      proofAssetLimit: row.proof_asset_limit,
    };
  }

  /** REQUIRED USER GATE — STYLE_CANDIDATE_APPROVAL. Style DNA is frozen from here on (new version to change). */
  approveStyleCandidate(styleKey: string, candidateId: string, seed: StyleReference, reviewer: string): OfficialGenreStyle {
    const style = this.getStyle(styleKey);
    if (style.stage !== "candidates_proposed") {
      throw new OfficialSupplyGateError("style_stage", `style ${styleKey} is ${style.stage}`);
    }
    if (!style.candidates.some((c) => c.candidateId === candidateId)) {
      throw new OfficialSupplyGateError("style_candidate_unknown", `candidate ${candidateId} not proposed`);
    }
    if (!reviewer.trim()) throw new OfficialSupplyGateError("reviewer_required", "approver identity required");
    const seedError = validateStyleSeedForApproval(seed);
    if (seedError) throw new OfficialSupplyGateError("style_seed_invalid", seedError);
    this.db
      .prepare(
        `UPDATE official_supply_styles
         SET stage='candidate_approved', approved_candidate_id=?, style_seed_json=?, candidate_approved_by=?, updated_at=datetime('now')
         WHERE style_key=? AND stage='candidates_proposed'`
      )
      .run(candidateId, JSON.stringify(seed), reviewer, styleKey);
    return this.getStyle(styleKey);
  }

  /** Paid proof slots started for a style (across its proof characters). */
  countStyleProofSlotsStarted(styleKey: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM official_supply_assets a
         JOIN official_supply_characters c ON c.draft_key = a.draft_key
         WHERE c.style_key=? AND c.is_style_proof=1 AND a.attempts > 0`
      )
      .get(styleKey) as { n: number };
    return row.n;
  }

  /** REQUIRED USER GATE — STYLE_PROOF_APPROVAL. Only STYLE_LOCKED unlocks bulk generation. */
  decideStyleProof(styleKey: string, decision: "approve" | "reject", reviewer: string): OfficialGenreStyle {
    const style = this.getStyle(styleKey);
    if (style.stage !== "candidate_approved") {
      throw new OfficialSupplyGateError("style_stage", `style ${styleKey} is ${style.stage}`);
    }
    if (!reviewer.trim()) throw new OfficialSupplyGateError("reviewer_required", "approver identity required");
    const generatedProofs = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM official_supply_assets a
         JOIN official_supply_characters c ON c.draft_key = a.draft_key
         WHERE c.style_key=? AND c.is_style_proof=1 AND a.status IN ('generated','approved')`
      )
      .get(styleKey) as { n: number };
    if (decision === "approve" && generatedProofs.n === 0) {
      throw new OfficialSupplyGateError("style_proof_missing", "no generated proof image to approve");
    }
    const next: OfficialStyleStage = decision === "approve" ? "style_locked" : "rejected";
    this.db
      .prepare(
        `UPDATE official_supply_styles SET stage=?, proof_decided_by=?, updated_at=datetime('now')
         WHERE style_key=? AND stage='candidate_approved'`
      )
      .run(next, reviewer, styleKey);
    return this.getStyle(styleKey);
  }

  // ── Characters ──────────────────────────────────────────────────────────────

  addCharacterDraft(batchKey: string, draft: OfficialCharacterDraft, opts: { isStyleProof?: boolean } = {}): OfficialCharacterRecord {
    const batch = this.getBatch(batchKey);
    this.getStyle(draft.styleKey);
    const counts = this.db
      .prepare(
        `SELECT COUNT(*) AS characters, COUNT(DISTINCT world_key) AS worlds,
                SUM(CASE WHEN world_key=? THEN 1 ELSE 0 END) AS in_world
         FROM official_supply_characters WHERE batch_key=?`
      )
      .get(draft.worldKey, batchKey) as { characters: number; worlds: number; in_world: number | null };
    if (counts.characters + 1 > batch.config.rollout.maxCharacters) {
      throw new OfficialSupplyGateError("rollout_character_cap", `batch ${batchKey} is capped at ${batch.config.rollout.maxCharacters} characters`);
    }
    const newWorld = !counts.in_world;
    if (newWorld && counts.worlds + 1 > batch.config.rollout.maxWorlds) {
      throw new OfficialSupplyGateError("rollout_world_cap", `batch ${batchKey} is capped at ${batch.config.rollout.maxWorlds} worlds`);
    }
    this.db
      .prepare(
        `INSERT INTO official_supply_characters (draft_key, batch_key, world_key, style_key, stage, draft_json, is_style_proof)
         VALUES (?, ?, ?, ?, 'draft', ?, ?)`
      )
      .run(draft.draftKey, batchKey, draft.worldKey, draft.styleKey, JSON.stringify(draft), opts.isStyleProof ? 1 : 0);
    return this.getCharacter(draft.draftKey);
  }

  /** Portfolio QA (SFW / 19+ share, genre concentration) against the batch's configured policy. */
  evaluateBatchPortfolio(batchKey: string): QaResult {
    const batch = this.getBatch(batchKey);
    const drafts = (
      this.db
        .prepare("SELECT draft_json FROM official_supply_characters WHERE batch_key=?")
        .all(batchKey) as Array<{ draft_json: string }>
    ).map((row) => JSON.parse(row.draft_json) as OfficialCharacterDraft);
    return evaluatePortfolioBalance(
      drafts.map((draft) => ({
        draftKey: draft.draftKey,
        primaryGenre: primaryCharacterGenre(draft.genres),
        nsfw: draft.adult.nsfw,
      })),
      batch.config.portfolio
    );
  }

  getCharacter(draftKey: string): OfficialCharacterRecord {
    const row = this.db
      .prepare("SELECT * FROM official_supply_characters WHERE draft_key=?")
      .get(draftKey) as CharacterRow | undefined;
    if (!row) throw new OfficialSupplyGateError("character_not_found", `draft ${draftKey} not found`);
    return toCharacter(row);
  }

  listWorldCharacters(batchKey: string, worldKey: string): OfficialCharacterRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM official_supply_characters WHERE batch_key=? AND world_key=? ORDER BY draft_key")
        .all(batchKey, worldKey) as CharacterRow[]
    ).map(toCharacter);
  }

  /**
   * Text edits after a lock invalidate everything downstream: the appearance
   * lock, the asset plan and every generated asset become stale so an old image
   * can never be staged against new text.
   */
  updateDraft(draftKey: string, draft: OfficialCharacterDraft): OfficialCharacterRecord {
    const current = this.getCharacter(draftKey);
    if (current.stage === "staged_private" || current.stage === "published") {
      throw new OfficialSupplyGateError("already_staged", "staged characters are edited through the canonical update owner");
    }
    if (draft.draftKey !== draftKey || draft.worldKey !== current.worldKey || draft.styleKey !== current.styleKey) {
      throw new OfficialSupplyGateError("draft_identity_changed", "draftKey/worldKey/styleKey are immutable");
    }
    const changed = computeTextLockHash(draft) !== computeTextLockHash(current.draft);
    const tx = this.db.transaction(() => {
      this.db
        .prepare("UPDATE official_supply_characters SET draft_json=?, updated_at=datetime('now') WHERE draft_key=?")
        .run(JSON.stringify(draft), draftKey);
      if (changed && current.stage !== "draft") {
        this.db
          .prepare(
            `UPDATE official_supply_characters
             SET stage='draft', text_lock_hash=NULL, appearance_json=NULL, appearance_lock_hash=NULL,
                 asset_plan_json=NULL, anchor_approved_by=NULL, updated_at=datetime('now')
             WHERE draft_key=?`
          )
          .run(draftKey);
        this.db
          .prepare("UPDATE official_supply_assets SET status='stale', lease_owner=NULL, updated_at=datetime('now') WHERE draft_key=?")
          .run(draftKey);
      }
    });
    tx();
    return this.getCharacter(draftKey);
  }

  /**
   * TEXT_LOCK. Runs every pipeline text QA plus the canonical form parser as a
   * dry run (same limits/age contract the real save will enforce).
   */
  lockText(
    draftKey: string,
    opts: { stagingUser: SessionUser; originalityCorpus?: OriginalityCorpusEntry[]; worldTerms?: string[] }
  ): QaResult {
    const record = this.getCharacter(draftKey);
    if (record.stage !== "draft") {
      throw new OfficialSupplyGateError("character_stage", `draft ${draftKey} is ${record.stage}`);
    }
    const draft = record.draft;
    const siblings = this.listWorldCharacters(record.batchKey, record.worldKey).map((c) => c.draft);
    const dryRun = parseCharacterFormBody(
      buildOfficialCharacterFormBody({ draft, appearanceBlock: "", assets: [TEXT_LOCK_DRY_RUN_ASSET] }),
      opts.stagingUser
    );
    const canonical = dryRun.ok
      ? qaResult([])
      : qaResult([{ code: "canonical_form_rejected", message: dryRun.error }]);
    const qa = mergeQa(
      evaluateDraftSchema(draft),
      evaluateOfficialTextLength(draft),
      evaluateSupportingNpcs(draft),
      evaluateAgeAndAdultConsistency(draft),
      evaluateWorldDiversity(siblings),
      evaluateOriginality(draft, opts.originalityCorpus ?? [], opts.worldTerms ?? []),
      canonical
    );
    if (!qa.ok) return qa;
    this.db
      .prepare(
        `UPDATE official_supply_characters SET stage='text_locked', text_lock_hash=?, updated_at=datetime('now')
         WHERE draft_key=? AND stage='draft'`
      )
      .run(computeTextLockHash(draft), draftKey);
    return qa;
  }

  assertTextLockCurrent(record: OfficialCharacterRecord): void {
    if (!record.textLockHash || record.textLockHash !== computeTextLockHash(record.draft)) {
      throw new OfficialSupplyGateError("text_lock_stale", `draft ${record.draftKey} text changed after TEXT_LOCK`);
    }
  }

  /** APPEARANCE_LOCK — structured identity + outfit policy, rendered into the canonical `[외형]` block. */
  lockAppearance(draftKey: string, lock: OfficialAppearanceLock): QaResult {
    const record = this.getCharacter(draftKey);
    if (record.stage !== "text_locked") {
      throw new OfficialSupplyGateError("character_stage", `draft ${draftKey} is ${record.stage}`);
    }
    this.assertTextLockCurrent(record);
    const appearanceBlock = this.appearanceBlockForDraft(record.draft, lock);
    const qa = mergeQa(
      evaluateAppearanceLock(record.draft, lock),
      evaluateOfficialStagedSaveLength(record.draft, appearanceBlock)
    );
    if (!qa.ok) return qa;
    this.db
      .prepare(
        `UPDATE official_supply_characters
         SET stage='appearance_locked', appearance_json=?, appearance_lock_hash=?, updated_at=datetime('now')
         WHERE draft_key=? AND stage='text_locked'`
      )
      .run(JSON.stringify(lock), computeAppearanceLockHash(lock), draftKey);
    return qa;
  }

  /** Visual Asset Plan — text-only, QA'd before any spend. Creates one durable row per slot. */
  lockAssetPlan(draftKey: string, plan: OfficialAssetPlan): QaResult {
    const record = this.getCharacter(draftKey);
    if (record.stage !== "appearance_locked") {
      throw new OfficialSupplyGateError("character_stage", `draft ${draftKey} is ${record.stage}`);
    }
    this.assertTextLockCurrent(record);
    const qa = mergeQa(
      evaluateAssetPlan(record.draft, plan),
      evaluateOfficialStagedSaveLength(record.draft, this.appearanceBlockFor(record))
    );
    if (!qa.ok) return qa;
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM official_supply_assets WHERE draft_key=?").run(draftKey);
      const insert = this.db.prepare(
        `INSERT INTO official_supply_assets (draft_key, slot_key, kind, status, appearance_lock_hash)
         VALUES (?, ?, ?, 'planned', ?)`
      );
      for (const slot of plan.slots) insert.run(draftKey, slot.slotKey, slot.kind, record.appearanceLockHash);
      this.db
        .prepare(
          `UPDATE official_supply_characters SET stage='asset_plan_locked', asset_plan_json=?, updated_at=datetime('now')
           WHERE draft_key=? AND stage='appearance_locked'`
        )
        .run(JSON.stringify(plan), draftKey);
    });
    tx();
    return qa;
  }

  /**
   * CAS rewrite of a locked character's stored draft + asset plan when the
   * generated representative and all 14 asset rows must stay untouched.
   * `updateDraft` / `lockAssetPlan` are the wrong owners here.
   */
  reconcileLockedSnapshot(
    draftKey: string,
    input: OfficialLockedSnapshotReconcileInput
  ): OfficialLockedSnapshotReconcileResult {
    return this.db.transaction(() => this.reconcileLockedSnapshotTx(draftKey, input))();
  }

  private readLockedCharacterRow(draftKey: string): LockedCharacterRow {
    const row = this.db
      .prepare(
        `SELECT draft_key, batch_key, world_key, style_key, stage, draft_json, text_lock_hash,
                appearance_json, appearance_lock_hash, asset_plan_json, is_style_proof,
                anchor_approved_by, staging_claim, staged_character_id
           FROM official_supply_characters WHERE draft_key=?`
      )
      .get(draftKey) as LockedCharacterRow | undefined;
    if (!row) throw new OfficialSupplyGateError("character_not_found", `draft ${draftKey} not found`);
    return row;
  }

  private snapshotAssetRows(draftKey: string): AssetSnapshotRow[] {
    return this.db
      .prepare("SELECT * FROM official_supply_assets WHERE draft_key=? ORDER BY id")
      .all(draftKey) as AssetSnapshotRow[];
  }

  private assertRepresentativeLookPreserved(
    draftKey: string,
    expectedPlan: OfficialAssetPlan | { slots: Array<Record<string, unknown>> },
    nextPlan: OfficialAssetPlan
  ): void {
    const expectedRep = expectedPlan.slots.find((slot) => slot.kind === "representative");
    const nextRep = nextPlan.slots.find((slot) => slot.kind === "representative");
    if (!expectedRep || !nextRep) {
      throw new OfficialSupplyGateError("locked_snapshot_rep_plan_changed", `${draftKey}: representative slot missing`);
    }
    for (const field of REPRESENTATIVE_LOOK_FIELDS) {
      if (canonicalJson(expectedRep[field]) !== canonicalJson(nextRep[field])) {
        throw new OfficialSupplyGateError(
          "locked_snapshot_rep_plan_changed",
          `${draftKey}: representative ${field} cannot change`
        );
      }
    }
    const subjects = nextRep.imageSubjects;
    if (!subjects) {
      throw new OfficialSupplyGateError(
        "locked_snapshot_rep_plan_changed",
        `${draftKey}: representative imageSubjects is required`
      );
    }
    if (
      subjects.foreground !== "solo_character" ||
      subjects.backgroundExtras !== "none" ||
      "partnerRole" in subjects
    ) {
      throw new OfficialSupplyGateError(
        "locked_snapshot_rep_plan_changed",
        `${draftKey}: representative imageSubjects must stay solo_character/none`
      );
    }
  }

  private assertLockedSnapshotAssets(
    draftKey: string,
    input: OfficialLockedSnapshotReconcileInput,
    appearanceLockHash: string,
    rows: AssetSnapshotRow[]
  ): void {
    if (rows.length !== 14) {
      throw new OfficialSupplyGateError("locked_snapshot_assets_drift", `${draftKey}: expected 14 asset rows, found ${rows.length}`);
    }
    const nextSlotKinds = new Map(input.nextPlan.slots.map((slot) => [slot.slotKey, slot.kind]));
    if (
      nextSlotKinds.size !== 14 ||
      rows.some((row) => nextSlotKinds.get(row.slot_key) !== row.kind)
    ) {
      throw new OfficialSupplyGateError(
        "locked_snapshot_assets_drift",
        `${draftKey}: persisted asset keys/kinds must match the approved 14-slot plan`
      );
    }
    const kinds = { representative: 0, signature: 0, emotion: 0, scene: 0 };
    let inFlight = 0;
    let startedNonRep = 0;
    let rep: AssetSnapshotRow | undefined;
    for (const row of rows) {
      if (row.draft_key !== draftKey) {
        throw new OfficialSupplyGateError("locked_snapshot_assets_drift", `${draftKey}: asset row draft mismatch`);
      }
      if (row.appearance_lock_hash !== appearanceLockHash) {
        throw new OfficialSupplyGateError("appearance_lock_stale", `${draftKey}/${row.slot_key} appearance hash drifted`);
      }
      kinds[row.kind as OfficialAssetSlotKind] += 1;
      if (row.status === "generating" || row.status === "upload_pending" || row.lease_owner != null) {
        inFlight += 1;
      }
      if (row.kind === "representative") {
        if (rep) throw new OfficialSupplyGateError("locked_snapshot_assets_drift", `${draftKey}: duplicate representative`);
        rep = row;
        continue;
      }
      if (row.status !== "planned" || row.attempts !== 0 || row.result_url != null || row.lease_owner != null) {
        startedNonRep += 1;
      }
    }
    if (kinds.representative !== 1 || kinds.signature !== 4 || kinds.emotion !== 6 || kinds.scene !== 3) {
      throw new OfficialSupplyGateError(
        "locked_snapshot_assets_drift",
        `${draftKey}: slot kinds ${JSON.stringify(kinds)}`
      );
    }
    if (inFlight > 0) {
      throw new OfficialSupplyGateError("locked_snapshot_in_flight", `${draftKey}: in-flight asset rows present`);
    }
    if (startedNonRep > 0) {
      throw new OfficialSupplyGateError("locked_snapshot_assets_drift", `${draftKey}: non-representative slot already started`);
    }
    if (!rep || rep.slot_key !== "rep") {
      throw new OfficialSupplyGateError("locked_snapshot_rep_drift", `${draftKey}: representative row missing`);
    }
    const expected = input.expectedRepresentative;
    if (
      rep.status !== expected.status ||
      rep.result_url !== expected.resultUrl ||
      rep.attempts !== expected.attempts ||
      rep.lease_owner != null ||
      officialModerationVerdict(parseJson<OfficialAssetModeration>(rep.moderation_json)) !== "clean"
    ) {
      throw new OfficialSupplyGateError(
        "locked_snapshot_rep_drift",
        `${draftKey}: representative status/url/attempts/moderation drifted`
      );
    }
    const replacements = this.db
      .prepare("SELECT COUNT(*) AS n FROM official_supply_asset_replacements WHERE draft_key=?")
      .get(draftKey) as { n: number };
    if (replacements.n > 0) {
      throw new OfficialSupplyGateError("locked_snapshot_replacement_present", `${draftKey}: replacements exist`);
    }
  }

  private assertNextLockedSnapshot(
    row: LockedCharacterRow,
    input: OfficialLockedSnapshotReconcileInput
  ): { nextTextLockHash: string; appearance: OfficialAppearanceLock } {
    const expectedDraft = JSON.parse(input.expectedDraftJson) as OfficialCharacterDraft;
    const next = input.nextDraft;
    if (
      next.draftKey !== row.draft_key ||
      next.worldKey !== row.world_key ||
      next.styleKey !== row.style_key ||
      next.name !== expectedDraft.name ||
      next.gender !== expectedDraft.gender ||
      next.age !== expectedDraft.age ||
      canonicalJson(next.adult) !== canonicalJson(expectedDraft.adult)
    ) {
      throw new OfficialSupplyGateError("locked_snapshot_identity_changed", `${row.draft_key}: identity/world/style/adult drifted`);
    }
    if (computeTextLockHash(expectedDraft) !== input.expectedTextLockHash) {
      throw new OfficialSupplyGateError(
        "locked_snapshot_preimage_mismatch",
        `${row.draft_key}: expected text hash does not match the supplied old draft`
      );
    }
    if (!row.appearance_json || !row.appearance_lock_hash) {
      throw new OfficialSupplyGateError("appearance_lock_stale", `${row.draft_key}: appearance lock missing`);
    }
    const appearance = JSON.parse(row.appearance_json) as OfficialAppearanceLock;
    if (
      row.appearance_lock_hash !== input.expectedAppearanceLockHash ||
      computeAppearanceLockHash(appearance) !== input.expectedAppearanceLockHash
    ) {
      throw new OfficialSupplyGateError("appearance_lock_stale", `${row.draft_key}: appearance lock drifted`);
    }
    const expectedPlan = JSON.parse(input.expectedAssetPlanJson) as { slots: OfficialAssetSlotPlan[] };
    this.assertRepresentativeLookPreserved(row.draft_key, expectedPlan, input.nextPlan);
    const qa = mergeQa(
      evaluateDraftSchema(next),
      evaluateOfficialTextLength(next),
      evaluateAgeAndAdultConsistency(next),
      evaluateAppearanceLock(next, appearance),
      evaluateAssetPlan(next, input.nextPlan)
    );
    if (!qa.ok) {
      throw new OfficialSupplyGateError("locked_snapshot_qa_failed", `${row.draft_key}: next draft/plan failed QA`, qa);
    }
    return { nextTextLockHash: computeTextLockHash(next), appearance };
  }

  private reconcileLockedSnapshotTx(
    draftKey: string,
    input: OfficialLockedSnapshotReconcileInput
  ): OfficialLockedSnapshotReconcileResult {
    const row = this.readLockedCharacterRow(draftKey);
    if (row.stage !== "asset_plan_locked") {
      throw new OfficialSupplyGateError("character_stage", `draft ${draftKey} is ${row.stage}`);
    }
    if (row.anchor_approved_by || row.staging_claim || row.staged_character_id != null) {
      throw new OfficialSupplyGateError(
        "locked_snapshot_stage",
        `${draftKey}: approval/staging state is not empty`
      );
    }
    if (!row.asset_plan_json) {
      throw new OfficialSupplyGateError("locked_snapshot_preimage_mismatch", `${draftKey}: asset plan missing`);
    }
    const assetsBefore = this.snapshotAssetRows(draftKey);
    this.assertLockedSnapshotAssets(draftKey, input, input.expectedAppearanceLockHash, assetsBefore);
    const { nextTextLockHash } = this.assertNextLockedSnapshot(row, input);

    const dbDraftCanon = canonicalJson(JSON.parse(row.draft_json));
    const dbPlanCanon = canonicalJson(JSON.parse(row.asset_plan_json));
    const nextDraftCanon = canonicalJson(input.nextDraft);
    const nextPlanCanon = canonicalJson(input.nextPlan);
    const expectedDraftCanon = canonicalJson(JSON.parse(input.expectedDraftJson));
    const expectedPlanCanon = canonicalJson(JSON.parse(input.expectedAssetPlanJson));
    const draftAlreadyNext = dbDraftCanon === nextDraftCanon;
    const planAlreadyNext = dbPlanCanon === nextPlanCanon;
    if (draftAlreadyNext !== planAlreadyNext) {
      throw new OfficialSupplyGateError("locked_snapshot_partial", `${draftKey}: draft/plan only one side is current`);
    }
    if (draftAlreadyNext && planAlreadyNext) {
      if (row.text_lock_hash !== nextTextLockHash) {
        throw new OfficialSupplyGateError("locked_snapshot_partial", `${draftKey}: stored text hash is not current`);
      }
      return { status: "already_current", textLockHash: nextTextLockHash };
    }
    if (row.draft_json !== input.expectedDraftJson || row.asset_plan_json !== input.expectedAssetPlanJson) {
      throw new OfficialSupplyGateError(
        "locked_snapshot_preimage_mismatch",
        `${draftKey}: stored draft/plan is not the exact observed preimage`
      );
    }
    if (canonicalJson(JSON.parse(row.draft_json)) !== expectedDraftCanon || canonicalJson(JSON.parse(row.asset_plan_json)) !== expectedPlanCanon) {
      throw new OfficialSupplyGateError("locked_snapshot_preimage_mismatch", `${draftKey}: preimage parse drifted`);
    }
    if (row.text_lock_hash !== input.expectedTextLockHash) {
      throw new OfficialSupplyGateError("locked_snapshot_preimage_mismatch", `${draftKey}: stored text hash is not the observed preimage`);
    }
    if (row.appearance_lock_hash !== input.expectedAppearanceLockHash) {
      throw new OfficialSupplyGateError("appearance_lock_stale", `${draftKey}: appearance hash is not the observed preimage`);
    }

    const nextDraftJson = JSON.stringify(input.nextDraft);
    const nextPlanJson = JSON.stringify(input.nextPlan);
    const updated = this.db
      .prepare(
        `UPDATE official_supply_characters
         SET draft_json=?, text_lock_hash=?, asset_plan_json=?, updated_at=datetime('now')
         WHERE draft_key=? AND stage='asset_plan_locked'
           AND draft_json=? AND asset_plan_json=? AND text_lock_hash=?
           AND appearance_lock_hash=? AND batch_key=? AND world_key=? AND style_key=?
           AND is_style_proof=? AND anchor_approved_by IS NULL AND staging_claim IS NULL
           AND staged_character_id IS NULL`
      )
      .run(
        nextDraftJson,
        nextTextLockHash,
        nextPlanJson,
        draftKey,
        input.expectedDraftJson,
        input.expectedAssetPlanJson,
        input.expectedTextLockHash,
        input.expectedAppearanceLockHash,
        row.batch_key,
        row.world_key,
        row.style_key,
        row.is_style_proof
      );
    if (updated.changes !== 1) {
      throw new OfficialSupplyGateError("locked_snapshot_cas_failed", `${draftKey}: CAS updated ${updated.changes} rows`);
    }

    const after = this.readLockedCharacterRow(draftKey);
    if (
      after.stage !== "asset_plan_locked" ||
      after.draft_json !== nextDraftJson ||
      after.asset_plan_json !== nextPlanJson ||
      after.text_lock_hash !== nextTextLockHash ||
      after.appearance_json !== row.appearance_json ||
      after.appearance_lock_hash !== row.appearance_lock_hash ||
      after.batch_key !== row.batch_key ||
      after.world_key !== row.world_key ||
      after.style_key !== row.style_key ||
      after.is_style_proof !== row.is_style_proof ||
      after.anchor_approved_by ||
      after.staging_claim ||
      after.staged_character_id != null
    ) {
      throw new OfficialSupplyGateError("locked_snapshot_cas_failed", `${draftKey}: postcondition drifted`);
    }
    const assetsAfter = this.snapshotAssetRows(draftKey);
    if (canonicalJson(assetsAfter) !== canonicalJson(assetsBefore)) {
      throw new OfficialSupplyGateError("locked_snapshot_assets_drift", `${draftKey}: asset rows changed`);
    }
    return { status: "updated", textLockHash: nextTextLockHash };
  }

  listAssets(draftKey: string): OfficialAssetRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM official_supply_assets WHERE draft_key=? ORDER BY id")
        .all(draftKey) as AssetRow[]
    ).map(toAsset);
  }

  getAsset(draftKey: string, slotKey: string): OfficialAssetRecord {
    const row = this.db
      .prepare("SELECT * FROM official_supply_assets WHERE draft_key=? AND slot_key=?")
      .get(draftKey, slotKey) as AssetRow | undefined;
    if (!row) throw new OfficialSupplyGateError("asset_not_found", `${draftKey}/${slotKey} not planned`);
    return toAsset(row);
  }

  representativeAsset(draftKey: string): OfficialAssetRecord {
    const row = this.db
      .prepare("SELECT * FROM official_supply_assets WHERE draft_key=? AND kind='representative'")
      .get(draftKey) as AssetRow | undefined;
    if (!row) throw new OfficialSupplyGateError("asset_not_found", `${draftKey} has no representative slot`);
    return toAsset(row);
  }

  /**
   * Hard gate evaluated before every paid call. Throws with the exact gate
   * that blocks; the runner never calls the provider when this throws.
   */
  assertGenerationAllowed(draftKey: string, slotKey: string): {
    character: OfficialCharacterRecord;
    style: OfficialGenreStyle;
    asset: OfficialAssetRecord;
  } {
    const character = this.getCharacter(draftKey);
    const style = this.getStyle(character.styleKey);
    if (!isStageAtLeast(character.stage, "asset_plan_locked") || character.stage === "staged_private") {
      throw new OfficialSupplyGateError("character_stage", `draft ${draftKey} is ${character.stage}; TEXT/APPEARANCE lock + asset plan required`);
    }
    this.assertTextLockCurrent(character);
    const saveLength = evaluateOfficialStagedSaveLength(character.draft, this.appearanceBlockFor(character));
    if (!saveLength.ok) {
      throw new OfficialSupplyGateError(
        "canonical_save_over_limit",
        saveLength.errors[0]?.message ?? `${draftKey}: staged save exceeds the canonical character limit`,
        saveLength
      );
    }
    const asset = this.getAsset(draftKey, slotKey);
    if (!character.appearanceLockHash || asset.appearanceLockHash !== character.appearanceLockHash) {
      throw new OfficialSupplyGateError("appearance_lock_stale", `${draftKey}/${slotKey} was planned for another appearance lock`);
    }
    if (asset.status === "stale") {
      throw new OfficialSupplyGateError("asset_stale", `${draftKey}/${slotKey} is stale`);
    }
    if (asset.kind !== "representative" && !isStageAtLeast(character.stage, "anchor_approved")) {
      throw new OfficialSupplyGateError("anchor_not_approved", `${draftKey}: ANCHOR_APPROVAL required before RP assets`);
    }
    switch (style.stage) {
      case "style_locked":
        break;
      case "candidate_approved": {
        if (!character.isStyleProof) {
          throw new OfficialSupplyGateError("style_not_locked", `style ${style.styleKey} awaits STYLE_PROOF_APPROVAL; only proof characters may generate`);
        }
        if (asset.attempts === 0 && this.countStyleProofSlotsStarted(style.styleKey) >= style.proofAssetLimit) {
          throw new OfficialSupplyGateError("style_proof_quota", `style ${style.styleKey} proof quota ${style.proofAssetLimit} exhausted`);
        }
        break;
      }
      case "candidates_proposed":
        throw new OfficialSupplyGateError("style_candidate_not_approved", `style ${style.styleKey} awaits STYLE_CANDIDATE_APPROVAL`);
      case "rejected":
        throw new OfficialSupplyGateError("style_rejected", `style ${style.styleKey} was rejected; propose a new version`);
      default: {
        const exhaustive: never = style.stage;
        throw new OfficialSupplyGateError("style_stage", `unknown style stage ${String(exhaustive)}`);
      }
    }
    if (!style.styleSeed) {
      throw new OfficialSupplyGateError("style_seed_missing", `style ${style.styleKey} has no generation-safe seed`);
    }
    return { character, style, asset };
  }

  /** Atomic slot claim — duplicate starts, double clicks and concurrent workers converge on one call. */
  claimSlot(draftKey: string, slotKey: string, workerId: string, nowMs: number, leaseMs: number, maxAttempts: number): boolean {
    const info = this.db
      .prepare(
        `UPDATE official_supply_assets
         SET status='generating', lease_owner=?, lease_expires_at=?, attempts=attempts+1, error=NULL, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND attempts < ?
           AND (status IN ('planned','failed','rejected') OR (status='generating' AND lease_expires_at < ?))`
      )
      .run(workerId, nowMs + leaseMs, draftKey, slotKey, maxAttempts, nowMs);
    return info.changes === 1;
  }

  /** Records provider spend immediately (before upload) so retries never lose track of a paid call. */
  recordSpend(draftKey: string, slotKey: string, input: { costUsd: number; unknownCost: boolean; model: string; providerRequestId: string | null }): void {
    this.db
      .prepare(
        `UPDATE official_supply_assets
         SET spent_usd = spent_usd + ?, has_unknown_cost = CASE WHEN ? = 1 THEN 1 ELSE has_unknown_cost END,
             model=?, provider_request_id=COALESCE(?, provider_request_id), updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=?`
      )
      .run(input.costUsd, input.unknownCost ? 1 : 0, input.model, input.providerRequestId, draftKey, slotKey);
  }

  markUploadPending(draftKey: string, slotKey: string, workerId: string, error: string, width: number, height: number): void {
    this.db
      .prepare(
        `UPDATE official_supply_assets SET status='upload_pending', lease_owner=NULL, error=?, width=?, height=?, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND lease_owner=?`
      )
      .run(error, width, height, draftKey, slotKey, workerId);
  }

  /** Only the current lease owner may publish a result (a worker whose lease expired cannot overwrite). */
  completeSlot(draftKey: string, slotKey: string, workerId: string, input: { url: string; width: number; height: number }): boolean {
    const info = this.db
      .prepare(
        `UPDATE official_supply_assets SET status='generated', lease_owner=NULL, lease_expires_at=NULL, result_url=?, width=?, height=?, error=NULL, qa_json=NULL, moderation_json=NULL, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND status IN ('generating','upload_pending') AND lease_owner=?`
      )
      .run(input.url, input.width, input.height, draftKey, slotKey, workerId);
    return info.changes === 1;
  }

  claimPendingUpload(draftKey: string, slotKey: string, workerId: string): boolean {
    const info = this.db
      .prepare(
        `UPDATE official_supply_assets SET lease_owner=?, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND status='upload_pending' AND lease_owner IS NULL`
      )
      .run(workerId, draftKey, slotKey);
    return info.changes === 1;
  }

  failSlot(draftKey: string, slotKey: string, workerId: string, error: string): void {
    this.db
      .prepare(
        `UPDATE official_supply_assets SET status='failed', lease_owner=NULL, lease_expires_at=NULL, error=?, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND lease_owner=?`
      )
      .run(error.slice(0, 500), draftKey, slotKey, workerId);
  }

  /**
   * Releases only the current claim when preparation failed before a provider
   * request began. The provider-attempt budget/quota must not be consumed.
   */
  failSlotBeforeProvider(draftKey: string, slotKey: string, workerId: string, error: string): void {
    const info = this.db
      .prepare(
        `UPDATE official_supply_assets
         SET status='failed', attempts=CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
             lease_owner=NULL, lease_expires_at=NULL, error=?, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND status='generating' AND lease_owner=?`
      )
      .run(error.slice(0, 500), draftKey, slotKey, workerId);
    if (info.changes !== 1) {
      throw new OfficialSupplyGateError(
        "pre_provider_release_failed",
        `${draftKey}/${slotKey}: current provider-free claim could not be released`
      );
    }
  }

  /** Spend at every budget level for the character's batch/genre style/world/character. */
  spendSnapshot(draftKey: string, reservePerImageUsd: number): { batch: number; genre: number; world: number; character: number } {
    const character = this.getCharacter(draftKey);
    const style = this.getStyle(character.styleKey);
    const sum = (where: string, ...params: unknown[]) =>
      (
        this.db
          .prepare(
            `SELECT COALESCE(SUM(spent_usd + CASE WHEN has_unknown_cost=1 THEN ? ELSE 0 END), 0) AS usd
             FROM (
               SELECT a.spent_usd AS spent_usd, a.has_unknown_cost AS has_unknown_cost,
                      c.draft_key AS draft_key, c.batch_key AS batch_key,
                      c.world_key AS world_key, s.genre AS genre
                 FROM official_supply_assets a
                 JOIN official_supply_characters c ON c.draft_key=a.draft_key
                 JOIN official_supply_styles s ON s.style_key=c.style_key
               UNION ALL
               SELECT r.spent_usd, r.has_unknown_cost, c.draft_key, c.batch_key, c.world_key, s.genre
                 FROM official_supply_asset_replacements r
                 JOIN official_supply_characters c ON c.draft_key=r.draft_key
                 JOIN official_supply_styles s ON s.style_key=c.style_key
             ) spend
             WHERE ${where}`
          )
          .get(reservePerImageUsd, ...params) as { usd: number }
      ).usd;
    return {
      batch: sum("batch_key=?", character.batchKey),
      genre: sum("batch_key=? AND genre=?", character.batchKey, style.genre),
      world: sum("batch_key=? AND world_key=?", character.batchKey, character.worldKey),
      character: sum("draft_key=?", draftKey),
    };
  }

  /** Stores the canonical asset-vision moderation result for the current image of a slot. */
  recordModeration(draftKey: string, slotKey: string, moderation: OfficialAssetModeration): void {
    const info = this.db
      .prepare(
        `UPDATE official_supply_assets SET moderation_json=?, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND status='generated' AND result_url IS NOT NULL`
      )
      .run(JSON.stringify(moderation), draftKey, slotKey);
    if (info.changes !== 1) {
      throw new OfficialSupplyGateError("asset_not_generated", `${draftKey}/${slotKey} has no generated image to moderate`);
    }
  }

  /**
   * Moderation precedes visual review for every slot. Missing/unavailable
   * moderation blocks the review (asset stays `generated` until moderation is
   * re-run); a hard reject rejects the slot regardless of visual QA.
   */
  private moderationGate(asset: OfficialAssetRecord): "rejected" | "pass" {
    return this.moderationGateFor(asset.moderation, asset.draftKey, asset.slotKey);
  }

  /** REQUIRED GATE — ANCHOR_APPROVAL. Canonical moderation + visual QA must both pass; a failed anchor is rejected (retry anchor only). */
  reviewAnchor(draftKey: string, qa: OfficialAnchorQaReport, reviewer: string): { approved: boolean } {
    const character = this.getCharacter(draftKey);
    if (character.stage !== "asset_plan_locked") {
      throw new OfficialSupplyGateError("character_stage", `draft ${draftKey} is ${character.stage}`);
    }
    if (!reviewer.trim()) throw new OfficialSupplyGateError("reviewer_required", "approver identity required");
    const rep = this.representativeAsset(draftKey);
    if (rep.status !== "generated") {
      throw new OfficialSupplyGateError("anchor_not_generated", `representative is ${rep.status}`);
    }
    const sentReferences = resolveOfficialGenerationReferencePlan({
      kind: "representative",
      styleSeed: this.getStyle(character.styleKey).styleSeed,
      representativeUrl: null,
    });
    assertRepresentativeReviewEvidence(qa, `${draftKey}/representative`, {
      candidateUrl: rep.resultUrl ?? "",
      sentReferenceIds: sentReferences.ok ? sentReferences.plan.references : undefined,
    });
    const approved = this.moderationGate(rep) === "pass" && anchorQaPasses(qa);
    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE official_supply_assets SET status=?, qa_json=?, updated_at=datetime('now')
           WHERE draft_key=? AND kind='representative'`
        )
        .run(approved ? "approved" : "rejected", JSON.stringify(qa), draftKey);
      if (approved) {
        this.db
          .prepare(
            `UPDATE official_supply_characters SET stage='anchor_approved', anchor_approved_by=?, updated_at=datetime('now')
             WHERE draft_key=? AND stage='asset_plan_locked'`
          )
          .run(reviewer, draftKey);
      }
    });
    tx();
    return { approved };
  }

  /** Per-slot variation QA. A rejected slot is regenerated alone; siblings are untouched. */
  reviewVariation(draftKey: string, slotKey: string, qa: OfficialVariationQaReport): { approved: boolean } {
    const character = this.getCharacter(draftKey);
    if (character.stage !== "anchor_approved") {
      throw new OfficialSupplyGateError("character_stage", `draft ${draftKey} is ${character.stage}`);
    }
    assertCompositionReviewRecorded(qa, `${draftKey}/${slotKey}`);
    const asset = this.getAsset(draftKey, slotKey);
    if (asset.kind === "representative") {
      throw new OfficialSupplyGateError("use_anchor_review", "the representative is reviewed through ANCHOR_APPROVAL");
    }
    if (asset.status !== "generated") {
      throw new OfficialSupplyGateError("asset_not_generated", `${draftKey}/${slotKey} is ${asset.status}`);
    }
    const approved = this.moderationGate(asset) === "pass" && variationQaPasses(qa);
    this.db
      .prepare("UPDATE official_supply_assets SET status=?, qa_json=?, updated_at=datetime('now') WHERE draft_key=? AND slot_key=?")
      .run(approved ? "approved" : "rejected", JSON.stringify(qa), draftKey, slotKey);
    const remaining = this.db
      .prepare("SELECT COUNT(*) AS n FROM official_supply_assets WHERE draft_key=? AND status != 'approved'")
      .get(draftKey) as { n: number };
    if (remaining.n === 0) {
      this.db
        .prepare("UPDATE official_supply_characters SET stage='assets_complete', updated_at=datetime('now') WHERE draft_key=? AND stage='anchor_approved'")
        .run(draftKey);
    }
    return { approved };
  }

  /** Final pre-staging QA: every asset approved, current against both locks, moderated and not hard-rejected. */
  markQaPassed(draftKey: string): QaResult {
    const character = this.getCharacter(draftKey);
    if (character.stage !== "assets_complete") {
      throw new OfficialSupplyGateError("character_stage", `draft ${draftKey} is ${character.stage}`);
    }
    this.assertTextLockCurrent(character);
    const errors: QaIssue[] = [];
    for (const asset of this.listAssets(draftKey)) {
      if (asset.status !== "approved" || !asset.resultUrl) {
        errors.push({ code: "asset_not_approved", message: `${asset.slotKey} is ${asset.status}` });
      }
      if (asset.appearanceLockHash !== character.appearanceLockHash) {
        errors.push({ code: "asset_appearance_stale", message: `${asset.slotKey} predates the appearance lock` });
      }
      const verdict = officialModerationVerdict(asset.moderation);
      if (verdict !== "clean" && verdict !== "adult_flagged") {
        errors.push({ code: "asset_moderation", message: `${asset.slotKey} moderation is ${verdict}` });
      }
      const profile = officialImageProfileForSlot(asset.kind);
      if (asset.width !== profile.width || asset.height !== profile.height) {
        errors.push({ code: "asset_dimensions", message: `${asset.slotKey} is ${asset.width}x${asset.height}, expected ${profile.size}` });
      }
    }
    const qa = qaResult(errors);
    if (qa.ok) {
      this.db
        .prepare("UPDATE official_supply_characters SET stage='qa_passed', updated_at=datetime('now') WHERE draft_key=? AND stage='assets_complete'")
        .run(draftKey);
    }
    return qa;
  }

  claimStaging(draftKey: string, token: string): boolean {
    const info = this.db
      .prepare(
        `UPDATE official_supply_characters SET staging_claim=?, updated_at=datetime('now')
         WHERE draft_key=? AND stage='qa_passed' AND staging_claim IS NULL AND staged_character_id IS NULL`
      )
      .run(token, draftKey);
    return info.changes === 1;
  }

  releaseStagingClaim(draftKey: string, token: string): void {
    this.db
      .prepare("UPDATE official_supply_characters SET staging_claim=NULL WHERE draft_key=? AND staging_claim=?")
      .run(draftKey, token);
  }

  markStaged(draftKey: string, token: string, characterId: number): void {
    this.db
      .prepare(
        `UPDATE official_supply_characters SET stage='staged_private', staged_character_id=?, updated_at=datetime('now')
         WHERE draft_key=? AND staging_claim=?`
      )
      .run(characterId, draftKey, token);
  }

  /**
   * Idempotent publish marker. Only transitions `staged_private` → `published`
   * (or no-ops when already published for the same character id).
   */
  markPublished(draftKey: string, characterId: number): void {
    const row = this.db
      .prepare("SELECT stage, staged_character_id FROM official_supply_characters WHERE draft_key=?")
      .get(draftKey) as { stage: string; staged_character_id: number | null } | undefined;
    if (!row) throw new OfficialSupplyGateError("draft_missing", `draft ${draftKey} not found`);
    if (row.staged_character_id !== characterId) {
      throw new OfficialSupplyGateError(
        "publish_character_mismatch",
        `draft ${draftKey} is staged as ${row.staged_character_id}, not ${characterId}`
      );
    }
    if (row.stage === "published") return;
    if (row.stage !== "staged_private") {
      throw new OfficialSupplyGateError("character_stage", `draft ${draftKey} is ${row.stage}; staged_private required`);
    }
    this.db
      .prepare(
        `UPDATE official_supply_characters SET stage='published', updated_at=datetime('now')
         WHERE draft_key=? AND stage='staged_private' AND staged_character_id=?`
      )
      .run(draftKey, characterId);
  }

  /**
   * Paid replacement generation only. The published official predicate is
   * unchanged: stage `published`, linked row `official=1`, `visibility=public`,
   * `moderation_status=approved`. Staged-private intake uses
   * `assertReplacementLiveCharacter` and does not loosen this check.
   */
  assertPublishedOfficialCharacter(draftKey: string): OfficialCharacterRecord {
    const character = this.getCharacter(draftKey);
    if (character.stage !== "published") {
      throw new OfficialSupplyGateError(
        "character_stage",
        `draft ${draftKey} is ${character.stage}; published official character required`
      );
    }
    this.assertPublishedCharacterRow(character);
    return character;
  }

  /**
   * Live replacement target. Published rows keep the published predicate.
   * Staged-private rows must be the linked private non-official character.
   * Any other stage is refused.
   */
  assertReplacementLiveCharacter(draftKey: string): OfficialCharacterRecord {
    const character = this.getCharacter(draftKey);
    switch (character.stage) {
      case "published":
        this.assertPublishedCharacterRow(character);
        return character;
      case "staged_private":
        this.assertStagedPrivateCharacterRow(character);
        return character;
      case "draft":
      case "text_locked":
      case "appearance_locked":
      case "asset_plan_locked":
      case "anchor_approved":
      case "assets_complete":
      case "qa_passed":
        throw new OfficialSupplyGateError(
          "character_stage",
          `draft ${draftKey} is ${character.stage}; published or staged_private required`
        );
      default: {
        const exhaustive: never = character.stage;
        throw new OfficialSupplyGateError("character_stage", String(exhaustive));
      }
    }
  }

  /** Official admin who can manage this linked character. Does not change owner or visibility. */
  assertReplacementOperator(draftKey: string, actor: OfficialAdminActor): OfficialCharacterRecord {
    const character = this.assertReplacementLiveCharacter(draftKey);
    const row = this.loadLinkedCharacterRow(character);
    if (
      !canAdminManageOfficialCharacter(actor, {
        id: row.id,
        creator_id: row.creator_id,
        official: row.official,
      })
    ) {
      throw new OfficialSupplyGateError(
        "replacement_forbidden",
        `actor cannot run a replacement for character ${row.id}`
      );
    }
    return character;
  }

  private loadLinkedCharacterRow(character: OfficialCharacterRecord): {
    id: number;
    official: number;
    visibility: string;
    moderation_status: string;
    creator_id: number | null;
  } {
    if (character.stagedCharacterId == null) {
      throw new OfficialSupplyGateError("not_staged", `draft ${character.draftKey} has no linked character`);
    }
    const row = this.db
      .prepare(
        "SELECT id, official, visibility, moderation_status, creator_id FROM characters WHERE id=?"
      )
      .get(character.stagedCharacterId) as
      | {
          id: number;
          official: number;
          visibility: string;
          moderation_status: string;
          creator_id: number | null;
        }
      | undefined;
    if (!row) {
      throw new OfficialSupplyGateError(
        "character_missing",
        `character ${character.stagedCharacterId} not found`
      );
    }
    if (row.id !== character.stagedCharacterId) {
      throw new OfficialSupplyGateError(
        "staged_character_mismatch",
        `draft ${character.draftKey} stagedCharacterId ${character.stagedCharacterId} does not match character ${row.id}`
      );
    }
    return row;
  }

  private assertPublishedCharacterRow(character: OfficialCharacterRecord): void {
    const row = this.loadLinkedCharacterRow(character);
    if (row.official !== 1 || row.visibility !== "public" || row.moderation_status !== "approved") {
      throw new OfficialSupplyGateError(
        "character_not_published",
        `character ${row.id} is not the published official row`
      );
    }
  }

  private assertStagedPrivateCharacterRow(character: OfficialCharacterRecord): void {
    const row = this.loadLinkedCharacterRow(character);
    if (row.official !== 0 || row.visibility !== "private") {
      throw new OfficialSupplyGateError(
        "replacement_target_mismatch",
        `staged_private character ${row.id} is official=${row.official} visibility=${row.visibility}`
      );
    }
  }

  /** Default slot gate (paid generation and published rows): the representative is never replaced. */
  assertReplacementSlotAllowed(draftKey: string, slotKey: string): OfficialAssetRecord {
    const asset = this.getAsset(draftKey, slotKey);
    if (asset.kind === "representative") {
      throw new OfficialSupplyGateError(
        "replacement_representative_forbidden",
        `${draftKey}/${slotKey} representative replacement is not supported`
      );
    }
    return asset;
  }

  /**
   * Slot gate for external intake and apply. `character` must come from
   * `assertReplacementOperator`. The representative is allowed only while the
   * linked row is staged_private (official=0, private); every other stage keeps
   * the default refusal.
   */
  assertReplacementTargetAllowed(character: OfficialCharacterRecord, slotKey: string): OfficialAssetRecord {
    const asset = this.getAsset(character.draftKey, slotKey);
    if (asset.kind === "representative" && character.stage !== "staged_private") {
      throw new OfficialSupplyGateError(
        "replacement_representative_forbidden",
        `${character.draftKey}/${slotKey} representative replacement is limited to staged_private characters`
      );
    }
    return asset;
  }

  /** The linked row's public assets are this draft's active slots, in plan order. */
  private assertLinkedPublicAssetsMatch(character: OfficialCharacterRecord): void {
    if (!character.assetPlan || character.stagedCharacterId == null) {
      throw new OfficialSupplyGateError("not_staged", `draft ${character.draftKey} has no linked character`);
    }
    const row = this.db
      .prepare("SELECT assets FROM characters WHERE id=?")
      .get(character.stagedCharacterId) as { assets: string } | undefined;
    const mapped = mapOfficialPublicAssetSlots({
      plan: character.assetPlan,
      publicAssets: parseAssets(row?.assets ?? "[]"),
      activeUrlBySlot: new Map(
        this.listAssets(character.draftKey).map((asset) => [asset.slotKey, asset.resultUrl ?? ""])
      ),
    });
    if (!mapped.ok) {
      throw new OfficialSupplyGateError(
        "staged_character_mismatch",
        `draft ${character.draftKey} is not linked to its public character: ${mapped.reason}`
      );
    }
  }

  listReplacements(draftKey: string): OfficialReplacementRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM official_supply_asset_replacements WHERE draft_key=? ORDER BY id")
        .all(draftKey) as ReplacementRow[]
    ).map(toReplacement);
  }

  getReplacement(draftKey: string, slotKey: string): OfficialReplacementRecord {
    const row = this.db
      .prepare("SELECT * FROM official_supply_asset_replacements WHERE draft_key=? AND slot_key=?")
      .get(draftKey, slotKey) as ReplacementRow | undefined;
    if (!row) throw new OfficialSupplyGateError("replacement_not_found", `${draftKey}/${slotKey} has no replacement candidate`);
    return toReplacement(row);
  }

  private getReplacementOrNull(draftKey: string, slotKey: string): OfficialReplacementRecord | null {
    const row = this.db
      .prepare("SELECT * FROM official_supply_asset_replacements WHERE draft_key=? AND slot_key=?")
      .get(draftKey, slotKey) as ReplacementRow | undefined;
    return row ? toReplacement(row) : null;
  }

  /**
   * Exclusive intake claim before any file write. Approved/applied/busy
   * candidates are refused without touching their stored bytes.
   */
  claimExternalReplacementIntake(
    actor: OfficialAdminActor,
    draftKey: string,
    slotKey: string,
    intakeId: string,
    nowMs = Date.now()
  ): OfficialReplacementRecord {
    const claim = this.db.transaction(() => {
      const character = this.assertReplacementOperator(draftKey, actor);
      this.assertTextLockCurrent(character);
      const asset = this.assertReplacementTargetAllowed(character, slotKey);
      this.assertLinkedPublicAssetsMatch(character);
      if (asset.status !== "approved" || !asset.resultUrl) {
        throw new OfficialSupplyGateError(
          "active_slot_not_approved",
          `${draftKey}/${slotKey} is ${asset.status}; approved active slot required`
        );
      }
      if (!character.appearanceLockHash || asset.appearanceLockHash !== character.appearanceLockHash) {
        throw new OfficialSupplyGateError(
          "appearance_lock_stale",
          `${draftKey}/${slotKey} was planned for another appearance lock`
        );
      }
      const leaseMs = this.getBatch(character.batchKey).config.leaseMs;
      const expiresAt = nowMs + leaseMs;
      const existing = this.getReplacementOrNull(draftKey, slotKey);
      if (existing) {
        switch (existing.status) {
          case "applied":
            throw new OfficialSupplyGateError(
              "replacement_already_applied",
              `${draftKey}/${slotKey} replacement is already applied`
            );
          case "approved":
          case "generating":
          case "upload_pending":
            throw new OfficialSupplyGateError(
              "replacement_busy",
              `${draftKey}/${slotKey} replacement is ${existing.status}`
            );
          case "planned":
          case "failed":
          case "rejected":
          case "generated":
            break;
          default: {
            const exhaustive: never = existing.status;
            throw new OfficialSupplyGateError("replacement_busy", String(exhaustive));
          }
        }
        const info = this.db
          .prepare(
            `UPDATE official_supply_asset_replacements
             SET lease_owner=?, lease_expires_at=?, updated_at=datetime('now')
             WHERE draft_key=? AND slot_key=?
               AND status IN ('planned','failed','rejected','generated')
               AND (lease_owner IS NULL OR lease_owner=? OR lease_expires_at < ?)`
          )
          .run(intakeId, expiresAt, draftKey, slotKey, intakeId, nowMs);
        if (info.changes !== 1) {
          throw new OfficialSupplyGateError(
            "replacement_busy",
            `${draftKey}/${slotKey} replacement is ${existing.status}`
          );
        }
      } else {
        const info = this.db
          .prepare(
            `INSERT INTO official_supply_asset_replacements (
               draft_key, slot_key, kind, status, base_result_url, appearance_lock_hash,
               lease_owner, lease_expires_at
             ) VALUES (?, ?, ?, 'planned', ?, ?, ?, ?)`
          )
          .run(
            draftKey,
            slotKey,
            asset.kind,
            asset.resultUrl,
            character.appearanceLockHash,
            intakeId,
            expiresAt
          );
        if (info.changes !== 1) {
          throw new OfficialSupplyGateError("replacement_busy", `${draftKey}/${slotKey} replacement could not be claimed`);
        }
      }
      return this.getReplacement(draftKey, slotKey);
    });
    return claim();
  }

  releaseExternalReplacementIntake(draftKey: string, slotKey: string, intakeId: string): void {
    this.db
      .prepare(
        `UPDATE official_supply_asset_replacements
         SET lease_owner=NULL, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND lease_owner=?
           AND status IN ('planned','failed','rejected','generated')`
      )
      .run(draftKey, slotKey, intakeId);
  }

  /**
   * Opens (or resets a finished) replacement candidate. Snapshots the current
   * active `result_url` as `base_result_url`. Never mutates the active asset.
   */
  createReplacementCandidate(
    actor: OfficialAdminActor,
    draftKey: string,
    slotKey: string,
    nowMs = Date.now()
  ): OfficialReplacementRecord {
    const character = this.assertReplacementOperator(draftKey, actor);
    this.assertTextLockCurrent(character);
    const asset = this.assertReplacementSlotAllowed(draftKey, slotKey);
    if (asset.status !== "approved" || !asset.resultUrl) {
      throw new OfficialSupplyGateError(
        "active_slot_not_approved",
        `${draftKey}/${slotKey} is ${asset.status}; approved active slot required`
      );
    }
    if (!character.appearanceLockHash || asset.appearanceLockHash !== character.appearanceLockHash) {
      throw new OfficialSupplyGateError(
        "appearance_lock_stale",
        `${draftKey}/${slotKey} was planned for another appearance lock`
      );
    }
    const info = this.db
      .prepare(
        `INSERT INTO official_supply_asset_replacements (
           draft_key, slot_key, kind, status, base_result_url, appearance_lock_hash
         ) VALUES (?, ?, ?, 'planned', ?, ?)
         ON CONFLICT(draft_key, slot_key) DO UPDATE SET
           kind=excluded.kind,
           status='planned',
           base_result_url=excluded.base_result_url,
           candidate_result_url=NULL,
           width=NULL,
           height=NULL,
           lease_owner=NULL,
           lease_expires_at=NULL,
           model=NULL,
           provider_request_id=NULL,
           error=NULL,
           moderation_json=NULL,
           qa_json=NULL,
           applied_at=NULL,
           approved_tag=NULL,
           candidate_sha256=NULL,
           reviewed_by=NULL,
           reviewed_text_lock_hash=NULL,
           appearance_lock_hash=excluded.appearance_lock_hash,
           updated_at=datetime('now')
         WHERE official_supply_asset_replacements.status IN ('planned','failed','rejected')
           AND (lease_owner IS NULL OR lease_expires_at < ?)`
      )
      .run(draftKey, slotKey, asset.kind, asset.resultUrl, character.appearanceLockHash, nowMs);
    if (info.changes !== 1) {
      const existing = this.getReplacement(draftKey, slotKey);
      if (existing.status === "applied") {
        throw new OfficialSupplyGateError(
          "replacement_already_applied",
          `${draftKey}/${slotKey} replacement is already applied`
        );
      }
      throw new OfficialSupplyGateError(
        "replacement_busy",
        `${draftKey}/${slotKey} replacement is ${existing.status}`
      );
    }
    return this.getReplacement(draftKey, slotKey);
  }

  /**
   * Registers an already-stored external file as a generated replacement
   * candidate. Does not call a provider, does not write a model or request id,
   * and does not add generation spend. Moderation stays empty until the
   * existing moderation owner records a checked result.
   */
  registerExternalReplacementCandidate(
    actor: OfficialAdminActor,
    draftKey: string,
    slotKey: string,
    input: {
      url: string;
      width: number;
      height: number;
      approvedTag: string;
      intakeId: string;
      sha256: string;
    }
  ): OfficialReplacementRecord {
    const register = this.db.transaction(() => {
      const character = this.assertReplacementOperator(draftKey, actor);
      this.assertTextLockCurrent(character);
      const asset = this.assertReplacementTargetAllowed(character, slotKey);
      if (asset.status !== "approved" || !asset.resultUrl) {
        throw new OfficialSupplyGateError(
          "active_slot_not_approved",
          `${draftKey}/${slotKey} is ${asset.status}; approved active slot required`
        );
      }
      if (!character.appearanceLockHash || asset.appearanceLockHash !== character.appearanceLockHash) {
        throw new OfficialSupplyGateError(
          "appearance_lock_stale",
          `${draftKey}/${slotKey} was planned for another appearance lock`
        );
      }
      const info = this.db
        .prepare(
          `UPDATE official_supply_asset_replacements
           SET status='generated',
               base_result_url=?,
               candidate_result_url=?,
               width=?,
               height=?,
               model=NULL,
               provider_request_id=NULL,
               lease_owner=NULL,
               lease_expires_at=NULL,
               error=NULL,
               moderation_json=NULL,
               qa_json=NULL,
               applied_at=NULL,
               appearance_lock_hash=?,
               approved_tag=?,
               candidate_sha256=?,
               reviewed_by=NULL,
               reviewed_text_lock_hash=NULL,
               updated_at=datetime('now')
           WHERE draft_key=? AND slot_key=? AND lease_owner=?
             AND status IN ('planned','failed','rejected','generated')`
        )
        .run(
          asset.resultUrl,
          input.url,
          input.width,
          input.height,
          character.appearanceLockHash,
          input.approvedTag,
          input.sha256,
          draftKey,
          slotKey,
          input.intakeId
        );
      if (info.changes !== 1) {
        const existing = this.getReplacementOrNull(draftKey, slotKey);
        if (existing?.status === "applied") {
          throw new OfficialSupplyGateError(
            "replacement_already_applied",
            `${draftKey}/${slotKey} replacement is already applied`
          );
        }
        throw new OfficialSupplyGateError(
          "replacement_busy",
          `${draftKey}/${slotKey} replacement is ${existing?.status ?? "missing"}`
        );
      }
      const saved = this.getReplacement(draftKey, slotKey);
      if (saved.model != null || saved.providerRequestId != null) {
        throw new OfficialSupplyGateError(
          "replacement_provider_identity",
          `${draftKey}/${slotKey} external candidate must not carry a provider identity`
        );
      }
      if (saved.baseResultUrl !== asset.resultUrl) {
        throw new OfficialSupplyGateError(
          "replacement_base_stale",
          `${draftKey}/${slotKey} base_result_url no longer matches the active slot`
        );
      }
      return saved;
    });
    return register();
  }

  assertReplacementGenerationAllowed(draftKey: string, slotKey: string): {
    character: OfficialCharacterRecord;
    style: OfficialGenreStyle;
    asset: OfficialAssetRecord;
    replacement: OfficialReplacementRecord;
  } {
    const character = this.assertPublishedOfficialCharacter(draftKey);
    this.assertTextLockCurrent(character);
    this.assertReplacementSlotAllowed(draftKey, slotKey);
    const style = this.getStyle(character.styleKey);
    if (style.stage !== "style_locked" || !style.styleSeed) {
      throw new OfficialSupplyGateError(
        "style_not_locked",
        `style ${style.styleKey} must be style_locked before replacement generation`
      );
    }
    const asset = this.getAsset(draftKey, slotKey);
    if (asset.status !== "approved" || !asset.resultUrl) {
      throw new OfficialSupplyGateError(
        "active_slot_not_approved",
        `${draftKey}/${slotKey} is ${asset.status}; approved active slot required`
      );
    }
    if (!character.appearanceLockHash || asset.appearanceLockHash !== character.appearanceLockHash) {
      throw new OfficialSupplyGateError(
        "appearance_lock_stale",
        `${draftKey}/${slotKey} was planned for another appearance lock`
      );
    }
    const replacement = this.getReplacement(draftKey, slotKey);
    if (replacement.appearanceLockHash !== character.appearanceLockHash) {
      throw new OfficialSupplyGateError(
        "appearance_lock_stale",
        `${draftKey}/${slotKey} replacement predates the appearance lock`
      );
    }
    if (replacement.baseResultUrl !== asset.resultUrl) {
      throw new OfficialSupplyGateError(
        "replacement_base_stale",
        `${draftKey}/${slotKey} base_result_url no longer matches the active slot`
      );
    }
    if (replacement.status === "applied") {
      throw new OfficialSupplyGateError(
        "replacement_already_applied",
        `${draftKey}/${slotKey} replacement is already applied`
      );
    }
    return { character, style, asset, replacement };
  }

  claimReplacement(
    draftKey: string,
    slotKey: string,
    workerId: string,
    nowMs: number,
    leaseMs: number,
    maxAttempts: number
  ): boolean {
    const info = this.db
      .prepare(
        `UPDATE official_supply_asset_replacements
         SET status='generating', lease_owner=?, lease_expires_at=?, attempts=attempts+1, error=NULL, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND attempts < ?
           AND (lease_owner IS NULL OR lease_expires_at < ?)
           AND (status IN ('planned','failed','rejected') OR (status='generating' AND lease_expires_at < ?))`
      )
      .run(workerId, nowMs + leaseMs, draftKey, slotKey, maxAttempts, nowMs, nowMs);
    return info.changes === 1;
  }

  recordReplacementSpend(
    draftKey: string,
    slotKey: string,
    input: { costUsd: number; unknownCost: boolean; model: string; providerRequestId: string | null }
  ): void {
    this.db
      .prepare(
        `UPDATE official_supply_asset_replacements
         SET spent_usd = spent_usd + ?, has_unknown_cost = CASE WHEN ? = 1 THEN 1 ELSE has_unknown_cost END,
             model=?, provider_request_id=COALESCE(?, provider_request_id), updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=?`
      )
      .run(input.costUsd, input.unknownCost ? 1 : 0, input.model, input.providerRequestId, draftKey, slotKey);
  }

  markReplacementUploadPending(
    draftKey: string,
    slotKey: string,
    workerId: string,
    error: string,
    width: number,
    height: number
  ): void {
    this.db
      .prepare(
        `UPDATE official_supply_asset_replacements
         SET status='upload_pending', lease_owner=NULL, error=?, width=?, height=?, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND lease_owner=?`
      )
      .run(error, width, height, draftKey, slotKey, workerId);
  }

  completeReplacement(
    draftKey: string,
    slotKey: string,
    workerId: string,
    input: { url: string; width: number; height: number }
  ): boolean {
    const info = this.db
      .prepare(
        `UPDATE official_supply_asset_replacements
         SET status='generated', lease_owner=NULL, lease_expires_at=NULL,
             candidate_result_url=?, width=?, height=?, error=NULL, qa_json=NULL, moderation_json=NULL,
             candidate_sha256=NULL, reviewed_by=NULL, reviewed_text_lock_hash=NULL,
             updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND status IN ('generating','upload_pending') AND lease_owner=?`
      )
      .run(input.url, input.width, input.height, draftKey, slotKey, workerId);
    return info.changes === 1;
  }

  claimReplacementPendingUpload(draftKey: string, slotKey: string, workerId: string): boolean {
    const info = this.db
      .prepare(
        `UPDATE official_supply_asset_replacements SET lease_owner=?, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND status='upload_pending' AND lease_owner IS NULL`
      )
      .run(workerId, draftKey, slotKey);
    return info.changes === 1;
  }

  failReplacement(draftKey: string, slotKey: string, workerId: string, error: string): void {
    this.db
      .prepare(
        `UPDATE official_supply_asset_replacements
         SET status='failed', lease_owner=NULL, lease_expires_at=NULL, error=?, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND lease_owner=?`
      )
      .run(error.slice(0, 500), draftKey, slotKey, workerId);
  }

  failReplacementBeforeProvider(draftKey: string, slotKey: string, workerId: string, error: string): void {
    const info = this.db
      .prepare(
        `UPDATE official_supply_asset_replacements
         SET status='failed', attempts=CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
             lease_owner=NULL, lease_expires_at=NULL, error=?, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND status='generating' AND lease_owner=?`
      )
      .run(error.slice(0, 500), draftKey, slotKey, workerId);
    if (info.changes !== 1) {
      throw new OfficialSupplyGateError(
        "pre_provider_release_failed",
        `${draftKey}/${slotKey}: current provider-free replacement claim could not be released`
      );
    }
  }

  recordReplacementModeration(
    draftKey: string,
    slotKey: string,
    candidateUrl: string,
    moderation: OfficialAssetModeration
  ): void {
    const info = this.db
      .prepare(
        `UPDATE official_supply_asset_replacements SET moderation_json=?, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND status='generated' AND candidate_result_url=?`
      )
      .run(JSON.stringify(moderation), draftKey, slotKey, candidateUrl);
    if (info.changes !== 1) {
      throw new OfficialSupplyGateError(
        "replacement_moderation_stale",
        `${draftKey}/${slotKey} moderation no longer matches the inspected candidate`
      );
    }
  }

  /**
   * Visual review of a generated replacement candidate. Writes only candidate
   * status/qa. Does not require `anchor_approved` and never mutates the live slot.
   */
  reviewReplacement(
    actor: OfficialAdminActor,
    draftKey: string,
    slotKey: string,
    qa: OfficialVariationQaReport,
    expectedCandidateUrl: string
  ): { approved: boolean } {
    const character = this.assertReplacementOperator(draftKey, actor);
    this.assertTextLockCurrent(character);
    assertCompositionReviewRecorded(qa, `${draftKey}/${slotKey}`);
    const asset = this.assertReplacementTargetAllowed(character, slotKey);
    if (asset.kind === "representative") {
      throw new OfficialSupplyGateError(
        "use_anchor_review",
        `${draftKey}/${slotKey} representative candidates are reviewed with anchor QA`
      );
    }
    const { replacement, inspectedUrl } = this.assertReviewableReplacement(
      character,
      asset,
      expectedCandidateUrl
    );
    const approved = this.moderationGateFor(
      replacement.moderation,
      draftKey,
      slotKey
    ) === "pass" && variationQaPasses(qa);
    const info = this.db
      .prepare(
        `UPDATE official_supply_asset_replacements
         SET status=?, qa_json=?, reviewed_text_lock_hash=?, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND status='generated' AND candidate_result_url=?`
      )
      .run(
        approved ? "approved" : "rejected",
        JSON.stringify(qa),
        character.textLockHash,
        draftKey,
        slotKey,
        inspectedUrl
      );
    if (info.changes !== 1) {
      throw new OfficialSupplyGateError(
        "replacement_review_stale",
        `${draftKey}/${slotKey} review no longer matches the inspected candidate`
      );
    }
    return { approved };
  }

  /**
   * ANCHOR_APPROVAL for a replacement representative on a staged_private
   * character. Uses anchor QA, not variation QA. The review is bound to the
   * inspected candidate URL, its raw file SHA-256 and the current Text Lock /
   * Appearance Lock. The live representative row and its earlier anchor QA are
   * untouched until apply.
   */
  reviewRepresentativeReplacement(
    actor: OfficialAdminActor,
    draftKey: string,
    qa: OfficialAnchorQaReport,
    inspected: { candidateUrl: string; candidateSha256: string },
    reviewer: string
  ): { approved: boolean } {
    const character = this.assertReplacementOperator(draftKey, actor);
    this.assertTextLockCurrent(character);
    if (!reviewer.trim()) throw new OfficialSupplyGateError("reviewer_required", "approver identity required");
    assertCompositionReviewRecorded(qa, `${draftKey}/representative`);
    const representative = this.representativeAsset(draftKey);
    const asset = this.assertReplacementTargetAllowed(character, representative.slotKey);
    const { replacement, inspectedUrl } = this.assertReviewableReplacement(
      character,
      asset,
      inspected.candidateUrl
    );
    const inspectedSha = inspected.candidateSha256.trim().toLowerCase();
    if (!replacement.candidateSha256 || replacement.candidateSha256 !== inspectedSha) {
      throw new OfficialSupplyGateError(
        "replacement_review_stale",
        `${draftKey}/${asset.slotKey} review does not match the stored candidate file`
      );
    }
    assertRepresentativeReviewEvidence(qa, `${draftKey}/representative`, {
      candidateUrl: inspectedUrl,
      candidateSha256: inspectedSha,
    });
    const approved =
      this.moderationGateFor(replacement.moderation, draftKey, asset.slotKey) === "pass" &&
      isCompletePassingAnchorQa(qa);
    const info = this.db
      .prepare(
        `UPDATE official_supply_asset_replacements
         SET status=?, qa_json=?, reviewed_by=?, reviewed_text_lock_hash=?, updated_at=datetime('now')
         WHERE draft_key=? AND slot_key=? AND kind='representative' AND status='generated'
           AND candidate_result_url=? AND candidate_sha256=? AND appearance_lock_hash=?`
      )
      .run(
        approved ? "approved" : "rejected",
        JSON.stringify(qa),
        approved ? reviewer.trim() : null,
        character.textLockHash,
        draftKey,
        asset.slotKey,
        inspectedUrl,
        inspectedSha,
        character.appearanceLockHash
      );
    if (info.changes !== 1) {
      throw new OfficialSupplyGateError(
        "replacement_review_stale",
        `${draftKey}/${asset.slotKey} review no longer matches the inspected candidate`
      );
    }
    return { approved };
  }

  /**
   * Explicit correction of a rejected representative review on the SAME stored
   * candidate. The default review stays closed on `rejected`; only this call
   * reopens it, and only when the candidate file (URL + raw SHA-256), both
   * Locks, the replaced URL and a passing moderation are all unchanged. The
   * earlier rejection (QA, reviewer, Lock) and the correction are appended to
   * `official_supply_replacement_rereviews` in the same transaction as the new
   * status, so nothing about the earlier judgement is overwritten unrecorded.
   * A new QA that still fails keeps the candidate `rejected`.
   */
  rereviewRepresentativeReplacement(
    actor: OfficialAdminActor,
    draftKey: string,
    qa: OfficialAnchorQaReport,
    inspected: { candidateUrl: string; candidateSha256: string },
    reviewer: string,
    correction: { reason: string; evidence: string }
  ): { approved: boolean; rereviewId: number } {
    const character = this.assertReplacementOperator(draftKey, actor);
    this.assertTextLockCurrent(character);
    if (!reviewer.trim()) throw new OfficialSupplyGateError("reviewer_required", "approver identity required");
    assertCompositionReviewRecorded(qa, `${draftKey}/representative`);
    if (!correction.reason.trim() || !correction.evidence.trim()) {
      throw new OfficialSupplyGateError(
        "rereview_correction_required",
        `${draftKey} re-review needs the reason the earlier judgement is corrected and its new evidence`
      );
    }
    if (character.stage !== "staged_private") {
      throw new OfficialSupplyGateError(
        "replacement_representative_forbidden",
        `${draftKey} representative re-review is limited to staged_private characters`
      );
    }
    const representative = this.representativeAsset(draftKey);
    const asset = this.assertReplacementTargetAllowed(character, representative.slotKey);
    const { replacement, inspectedUrl } = this.assertReviewableReplacement(
      character,
      asset,
      inspected.candidateUrl,
      "rejected"
    );
    const inspectedSha = inspected.candidateSha256.trim().toLowerCase();
    if (!replacement.candidateSha256 || replacement.candidateSha256 !== inspectedSha) {
      throw new OfficialSupplyGateError(
        "replacement_review_stale",
        `${draftKey}/${asset.slotKey} re-review does not match the stored candidate file`
      );
    }
    assertRepresentativeReviewEvidence(qa, `${draftKey}/representative`, {
      candidateUrl: inspectedUrl,
      candidateSha256: inspectedSha,
    });
    if (replacement.kind !== "representative" || !replacement.qa || !replacement.appearanceLockHash) {
      throw new OfficialSupplyGateError(
        "rereview_no_prior_review",
        `${draftKey}/${asset.slotKey} has no recorded representative review to correct`
      );
    }
    if (replacement.reviewedTextLockHash !== character.textLockHash) {
      throw new OfficialSupplyGateError(
        "replacement_review_stale",
        `${draftKey}/${asset.slotKey} the rejected review predates the current Text Lock`
      );
    }
    if (this.moderationGateFor(replacement.moderation, draftKey, asset.slotKey) !== "pass") {
      throw new OfficialSupplyGateError(
        "rereview_moderation_rejected",
        `${draftKey}/${asset.slotKey} moderation rejected this file; it cannot be re-reviewed`
      );
    }
    const approved = isCompletePassingAnchorQa(qa);
    const previousQaJson = JSON.stringify(replacement.qa);
    const newQaJson = JSON.stringify(qa);
    const save = this.db.transaction((): number => {
      const info = this.db
        .prepare(
          `UPDATE official_supply_asset_replacements
           SET status=?, qa_json=?, reviewed_by=?, reviewed_text_lock_hash=?, updated_at=datetime('now')
           WHERE draft_key=? AND slot_key=? AND kind='representative' AND status='rejected'
             AND candidate_result_url=? AND candidate_sha256=? AND appearance_lock_hash=?
             AND base_result_url=? AND qa_json=? AND reviewed_by IS ? AND reviewed_text_lock_hash IS ?`
        )
        .run(
          approved ? "approved" : "rejected",
          newQaJson,
          approved ? reviewer.trim() : null,
          character.textLockHash,
          draftKey,
          asset.slotKey,
          inspectedUrl,
          inspectedSha,
          character.appearanceLockHash,
          asset.resultUrl,
          previousQaJson,
          replacement.reviewedBy,
          replacement.reviewedTextLockHash
        );
      if (info.changes !== 1) {
        throw new OfficialSupplyGateError(
          "replacement_review_stale",
          `${draftKey}/${asset.slotKey} re-review no longer matches the rejected candidate`
        );
      }
      const history = this.db
        .prepare(
          `INSERT INTO official_supply_replacement_rereviews
             (draft_key, slot_key, candidate_result_url, candidate_sha256, base_result_url, text_lock_hash,
              appearance_lock_hash, previous_status, previous_qa_json, previous_reviewed_by,
              previous_reviewed_text_lock_hash, new_status, new_qa_json, reviewer, correction_reason,
              correction_evidence, actor_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'rejected', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          draftKey,
          asset.slotKey,
          inspectedUrl,
          inspectedSha,
          replacement.baseResultUrl,
          character.textLockHash,
          character.appearanceLockHash,
          previousQaJson,
          replacement.reviewedBy,
          replacement.reviewedTextLockHash,
          approved ? "approved" : "rejected",
          newQaJson,
          reviewer.trim(),
          correction.reason.trim(),
          correction.evidence.trim(),
          actor.id ?? null
        );
      return Number(history.lastInsertRowid);
    });
    return { approved, rereviewId: save() };
  }

  listReplacementRereviews(draftKey: string, slotKey?: string): OfficialReplacementRereviewRecord[] {
    const rows = (
      slotKey === undefined
        ? this.db
            .prepare("SELECT * FROM official_supply_replacement_rereviews WHERE draft_key=? ORDER BY id")
            .all(draftKey)
        : this.db
            .prepare("SELECT * FROM official_supply_replacement_rereviews WHERE draft_key=? AND slot_key=? ORDER BY id")
            .all(draftKey, slotKey)
    ) as RereviewRow[];
    return rows.map((row) => ({
      id: row.id,
      draftKey: row.draft_key,
      slotKey: row.slot_key,
      candidateResultUrl: row.candidate_result_url,
      candidateSha256: row.candidate_sha256,
      baseResultUrl: row.base_result_url,
      textLockHash: row.text_lock_hash,
      appearanceLockHash: row.appearance_lock_hash,
      previousStatus: row.previous_status,
      previousQa: JSON.parse(row.previous_qa_json) as OfficialAnchorQaReport,
      previousReviewedBy: row.previous_reviewed_by,
      previousReviewedTextLockHash: row.previous_reviewed_text_lock_hash,
      newStatus: row.new_status,
      newQa: JSON.parse(row.new_qa_json) as OfficialAnchorQaReport,
      reviewer: row.reviewer,
      correctionReason: row.correction_reason,
      correctionEvidence: row.correction_evidence,
      actorId: row.actor_id,
      createdAt: row.created_at,
    }));
  }

  private assertReviewableReplacement(
    character: OfficialCharacterRecord,
    asset: OfficialAssetRecord,
    expectedCandidateUrl: string,
    expectedStatus: "generated" | "rejected" = "generated"
  ): { replacement: OfficialReplacementRecord; inspectedUrl: string } {
    const { draftKey, slotKey } = asset;
    if (asset.status !== "approved" || !asset.resultUrl) {
      throw new OfficialSupplyGateError(
        "active_slot_not_approved",
        `${draftKey}/${slotKey} is ${asset.status}; approved active slot required`
      );
    }
    if (!character.appearanceLockHash || asset.appearanceLockHash !== character.appearanceLockHash) {
      throw new OfficialSupplyGateError(
        "appearance_lock_stale",
        `${draftKey}/${slotKey} was planned for another appearance lock`
      );
    }
    const inspectedUrl = expectedCandidateUrl.trim();
    if (!inspectedUrl) {
      throw new OfficialSupplyGateError(
        "replacement_review_stale",
        `${draftKey}/${slotKey} review did not name the inspected candidate`
      );
    }
    const replacement = this.getReplacement(draftKey, slotKey);
    if (replacement.status !== expectedStatus) {
      throw new OfficialSupplyGateError(
        expectedStatus === "generated" ? "replacement_not_generated" : "replacement_not_rejected",
        `${draftKey}/${slotKey} replacement is ${replacement.status}`
      );
    }
    if (!replacement.candidateResultUrl || replacement.candidateResultUrl !== inspectedUrl) {
      throw new OfficialSupplyGateError(
        "replacement_review_stale",
        `${draftKey}/${slotKey} review no longer matches the inspected candidate`
      );
    }
    if (replacement.appearanceLockHash !== character.appearanceLockHash) {
      throw new OfficialSupplyGateError(
        "appearance_lock_stale",
        `${draftKey}/${slotKey} replacement predates the appearance lock`
      );
    }
    if (replacement.baseResultUrl !== asset.resultUrl) {
      throw new OfficialSupplyGateError(
        "replacement_base_stale",
        `${draftKey}/${slotKey} base_result_url no longer matches the active slot`
      );
    }
    return { replacement, inspectedUrl };
  }

  private moderationGateFor(
    moderation: OfficialAssetModeration | null,
    draftKey: string,
    slotKey: string
  ): "rejected" | "pass" {
    const verdict = officialModerationVerdict(moderation);
    switch (verdict) {
      case "missing":
        throw new OfficialSupplyGateError("moderation_missing", `${draftKey}/${slotKey} has not been moderated`);
      case "unavailable":
        throw new OfficialSupplyGateError("moderation_unavailable", `${draftKey}/${slotKey} moderation unavailable; re-run moderation`);
      case "rejected":
        return "rejected";
      case "adult_flagged":
      case "clean":
        return "pass";
      default: {
        const exhaustive: never = verdict;
        throw new OfficialSupplyGateError("moderation_unknown", String(exhaustive));
      }
    }
  }

  findWorldLorebookId(worldKey: string, entryKey: string, creatorId: number): number | null {
    const row = this.db
      .prepare("SELECT lorebook_id FROM official_supply_world_lorebooks WHERE world_key=? AND entry_key=? AND creator_id=?")
      .get(worldKey, entryKey, creatorId) as { lorebook_id: number } | undefined;
    return row?.lorebook_id ?? null;
  }

  rememberWorldLorebook(worldKey: string, entryKey: string, creatorId: number, lorebookId: number): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO official_supply_world_lorebooks (world_key, entry_key, creator_id, lorebook_id) VALUES (?, ?, ?, ?)"
      )
      .run(worldKey, entryKey, creatorId, lorebookId);
  }

  appearanceBlockFor(record: OfficialCharacterRecord): string {
    if (!record.appearance) throw new OfficialSupplyGateError("appearance_missing", `${record.draftKey} has no appearance lock`);
    return this.appearanceBlockForDraft(record.draft, record.appearance);
  }

  private appearanceBlockForDraft(
    draft: Pick<OfficialCharacterDraft, "promptStandard">,
    lock: OfficialAppearanceLock
  ): string {
    return renderRuntimeAppearanceBlock(lock);
  }
}
