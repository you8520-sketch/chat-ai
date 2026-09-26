import type Database from "better-sqlite3";
import { parseCharacterFormBody, type SessionUser } from "@/lib/characterFormSave";
import { primaryCharacterGenre } from "@/lib/characterGenres";
import { getDb } from "@/lib/db";
import type { OpenAiImageQuality } from "@/lib/openAiImageEdit";
import {
  computeAppearanceLockHash,
  evaluateAppearanceLock,
  renderAppearanceBlock,
} from "@/lib/officialSupply/appearance";
import { evaluateAssetPlan } from "@/lib/officialSupply/assetPlan";
import {
  buildOfficialCharacterFormBody,
  computeTextLockHash,
  evaluateAgeAndAdultConsistency,
  evaluateDraftSchema,
  evaluateOfficialTextLength,
  evaluateSupportingNpcs,
  mergeQa,
} from "@/lib/officialSupply/characterText";
import { officialImageProfileForSlot } from "@/lib/officialSupply/imageProfile";
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
  type OfficialAssetPlan,
  type OfficialAssetSlotKind,
  type OfficialAssetStatus,
  type OfficialCharacterDraft,
  type OfficialCharacterStage,
  type OfficialGenreStyle,
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
};

export class OfficialSupplyGateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly qa?: QaResult
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
  `);
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
  };
}

function anchorQaPasses(qa: OfficialAnchorQaReport): boolean {
  return Object.values(qa).every((check) => check.ok);
}

function variationQaPasses(qa: OfficialVariationQaReport): boolean {
  return (
    qa.identityMatchesAnchor.ok &&
    qa.expressionMatchesPlan.ok &&
    qa.characterPresent.ok &&
    qa.artStyle.ok &&
    !qa.moderation.moderationReject
  );
}

/** Placeholder asset used only for the canonical dry-run parse at TEXT_LOCK — never persisted. */
const TEXT_LOCK_DRY_RUN_ASSET = { url: "/uploads/official-supply-dry-run.webp", tag: "dry-run", width: 1024, height: 1536, viewerBlur: false };

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
    if (current.stage === "staged_private") {
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

  private assertTextLockCurrent(record: OfficialCharacterRecord): void {
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
    const qa = evaluateAppearanceLock(record.draft, lock);
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
    const qa = evaluateAssetPlan(record.draft, plan);
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
        `UPDATE official_supply_assets SET status='generated', lease_owner=NULL, lease_expires_at=NULL, result_url=?, width=?, height=?, error=NULL, qa_json=NULL, updated_at=datetime('now')
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

  /** Spend at every budget level for the character's batch/genre style/world/character. */
  spendSnapshot(draftKey: string, reservePerImageUsd: number): { batch: number; genre: number; world: number; character: number } {
    const character = this.getCharacter(draftKey);
    const style = this.getStyle(character.styleKey);
    const sum = (where: string, ...params: unknown[]) =>
      (
        this.db
          .prepare(
            `SELECT COALESCE(SUM(a.spent_usd + CASE WHEN a.has_unknown_cost=1 THEN ? ELSE 0 END), 0) AS usd
             FROM official_supply_assets a JOIN official_supply_characters c ON c.draft_key=a.draft_key
             JOIN official_supply_styles s ON s.style_key=c.style_key
             WHERE ${where}`
          )
          .get(reservePerImageUsd, ...params) as { usd: number }
      ).usd;
    return {
      batch: sum("c.batch_key=?", character.batchKey),
      genre: sum("c.batch_key=? AND s.genre=?", character.batchKey, style.genre),
      world: sum("c.batch_key=? AND c.world_key=?", character.batchKey, character.worldKey),
      character: sum("c.draft_key=?", draftKey),
    };
  }

  /** REQUIRED GATE — ANCHOR_APPROVAL. A failed anchor is rejected (retry anchor only). */
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
    const approved = anchorQaPasses(qa);
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
    const asset = this.getAsset(draftKey, slotKey);
    if (asset.kind === "representative") {
      throw new OfficialSupplyGateError("use_anchor_review", "the representative is reviewed through ANCHOR_APPROVAL");
    }
    if (asset.status !== "generated") {
      throw new OfficialSupplyGateError("asset_not_generated", `${draftKey}/${slotKey} is ${asset.status}`);
    }
    const approved = variationQaPasses(qa);
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

  /** Final pre-staging QA: every asset approved, current against both locks, no hard moderation reject. */
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
    return renderAppearanceBlock(record.appearance);
  }
}
