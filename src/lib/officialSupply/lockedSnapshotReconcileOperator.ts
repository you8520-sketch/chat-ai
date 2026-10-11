import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { evaluateAssetPlan } from "@/lib/officialSupply/assetPlan";
import { loadCompiledOfficialCharacterSource } from "@/lib/officialSupply/compiledOfficialSource";
import { officialModerationVerdict } from "@/lib/officialSupply/moderation";
import { testStyleCandidate } from "@/lib/officialSupply/officialSupply.fixtures";
import { buildPilotClusterBStyleProofDraft } from "@/lib/officialSupply/pilotClusterBStyleProof";
import { PILOT_STYLE_PROOF_CANDIDATE_ID } from "@/lib/officialSupply/pilotStyleProof";
import { composeOfficialSlotGeneration } from "@/lib/officialSupply/runner";
import { ROFAN_CLUSTER_B_VISUAL_STYLE_DNA } from "@/lib/officialSupply/style";
import {
  OfficialSupplyGateError,
  OfficialSupplyStore,
  type OfficialCharacterRecord,
  type OfficialLockedSnapshotReconcileResult,
} from "@/lib/officialSupply/store";
import type {
  OfficialAppearanceLock,
  OfficialAssetModeration,
  OfficialAssetPlan,
  OfficialCharacterDraft,
  OfficialGenreStyle,
} from "@/lib/officialSupply/types";
import {
  buildClusterBRofanStyleSeed,
  PILOT_STYLE_PROOF_V4_BATCH_KEY,
  PILOT_STYLE_PROOF_V4_STYLE_KEY,
} from "@/lib/officialSupply/userOwnedRofanStyleRefs";
import { gitCommitMatchesDeployment } from "@/lib/postDeployVerification";

export const OFFICIAL_LOCKED_SNAPSHOT_APPLY_ENV = "OFFICIAL_LOCKED_SNAPSHOT_APPLY";
export const OFFICIAL_LOCKED_SNAPSHOT_PRODUCTION_CAS_ENV = "OFFICIAL_LOCKED_SNAPSHOT_PRODUCTION_CAS";
export const OFFICIAL_LOCKED_SNAPSHOT_PRODUCTION_DRAFT_KEY_ENV =
  "OFFICIAL_LOCKED_SNAPSHOT_PRODUCTION_DRAFT_KEY";
export const OFFICIAL_LOCKED_SNAPSHOT_PRODUCTION_CONFIRM_ENV =
  "OFFICIAL_LOCKED_SNAPSHOT_PRODUCTION_CONFIRM";
export const WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET = {
  draftKey: "pilot-rf-v4-02",
  sourceDraftKey: "pilot-rf-02",
  worldKey: "pilot-rf-erendel",
  styleKey: PILOT_STYLE_PROOF_V4_STYLE_KEY,
  batchKey: PILOT_STYLE_PROOF_V4_BATCH_KEY,
  expectedOldTextLockHash: "13b5d5aa3ba731b7d7ee080028b0425a65e6b49b9759664100852bc40f172726",
  expectedNextTextLockHash: "6ff02833cfd45a542866aa1afa749486d94362eff5358e10f995b8f77fabd5fd",
  expectedAppearanceLockHash: "1c3ccd134203a6dea6ae869c27cc443c42ff5498d1d0130c6f9765407c24dcc3",
  expectedRepUrl: "/uploads/official-pilot-rf-v4-02__rep-a1.webp",
  expectedRepAttempts: 1,
  expectedRepSha256: "a66c49d4d947209206b70a284c99f2e26ef868934ed5426818042c29ba3a45f1",
  expectedOldDraftJsonSha256: "2f7d4f653e02ef3fceb7e2e02a551853c38fcb14db81f14985d219c5d92b4858",
  expectedOldAssetPlanJsonSha256: "f2f3371754d767041275186b1db50d09fa85e8529c5bd3faecf36fb4d398bc44",
} as const;

const RAILWAY_PRODUCTION_DB_PATH = "/data/app.db";
const FULL_SHA = /^[a-f0-9]{40}$/i;
export const INDEPENDENT_SQLITE_MIN_VERSION = "3.45.2";
const INDEPENDENT_SQLITE_TIMEOUT_MS = 30_000;
const INDEPENDENT_SQLITE_MAX_BUFFER = 16_384;
const INDEPENDENT_SQLITE_CHECKER = `
import json, sqlite3, sys
from pathlib import Path

def check(path):
    resolved = Path(path).resolve()
    if not resolved.is_file():
        raise SystemExit("missing")
    con = sqlite3.connect(resolved.as_uri() + "?mode=ro", uri=True)
    try:
        con.execute("PRAGMA query_only=ON")
        query_only = con.execute("PRAGMA query_only").fetchone()
        if not query_only or int(query_only[0]) != 1:
            raise SystemExit("query_only")
        integrity = [row[0] for row in con.execute("PRAGMA integrity_check")]
        foreign_key_count = len(list(con.execute("PRAGMA foreign_key_check")))
        return {"integrity": integrity, "foreign_key_count": foreign_key_count}
    finally:
        con.close()

if len(sys.argv) != 3:
    raise SystemExit("usage")
print(json.dumps({
    "sqlite_version": sqlite3.sqlite_version,
    "live": check(sys.argv[1]),
    "backup": check(sys.argv[2]),
}))
`.trim();

export type IndependentSqliteCheckDeps = {
  spawn?: typeof spawnSync;
  pythonPath?: string;
  timeoutMs?: number;
};

const STALE_NEEDLES = ["압송", "수갑", "character_plus_required_partner", "플레이어와 함께", "차가운 심문"] as const;
const CURRENT_PLAN_PATH = path.join(
  process.cwd(),
  "src/lib/officialSupply/pilot/characters",
  `${WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.sourceDraftKey}.json`
);

type CharacterInspectRow = {
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
  updated_at: string;
};

type AssetInspectRow = {
  id: number;
  slot_key: string;
  kind: string;
  status: string;
  attempts: number;
  result_url: string | null;
  lease_owner: string | null;
  spent_usd: number;
  appearance_lock_hash: string | null;
  moderation_json: string | null;
};

export type LockedSnapshotInspectReport = {
  mode: "inspect";
  wrote: false;
  storeInstantiated: false;
  queryOnly: true;
  target: typeof WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey;
  runtimeSha: string;
  expectedSha: string;
  shaMatch: true;
  stage: string;
  styleStage: string;
  batchStatus: string;
  isStyleProof: boolean;
  textLockHash: string;
  appearanceLockHash: string;
  textMatchesOld: boolean;
  textMatchesApproved: boolean;
  draftJsonSha256: string;
  assetPlanJsonSha256: string;
  imageSubjectsPresent: number;
  staleNeedles: string[];
  publicCopyLengths: { tagline: number; description: number; greeting: number };
  approvedCopyLengths: { tagline: number; description: number; greeting: number };
  nextTextLockHash: string;
  assetCount: number;
  slotKeys: string[];
  representative: {
    status: string;
    resultUrl: string | null;
    attempts: number;
    lease: null;
    moderation: string;
  };
  nonRepStarted: string[];
  inFlight: string[];
  replacements: number;
  planQaOk: boolean;
  assemblies: { ok: number; failed: number };
  verdict: "ready_for_cas" | "already_current";
  backupPlan: {
    owner: "VACUUM INTO";
    copyLiveWalForbidden: true;
    syntheticProof: "src/lib/sqliteBackupRestore.synthetic.test.ts";
    dataFreeBytes: number | null;
  };
};

export type LockedSnapshotApplyReport = {
  mode: "apply";
  wrote: boolean;
  storeWriter: "OfficialSupplyStore.reconcileLockedSnapshot";
  target: typeof WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey;
  result: OfficialLockedSnapshotReconcileResult;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function stop(code: string, message: string): never {
  throw new OfficialSupplyGateError(code, message);
}

export function isRailwayProductionApplyEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RAILWAY_ENVIRONMENT_NAME === "production";
}

export function isProtectedSqlitePath(dbPath: string, protectedPath = RAILWAY_PRODUCTION_DB_PATH): boolean {
  const canonical = path.resolve(protectedPath);
  const resolved = path.resolve(dbPath);
  if (resolved === canonical) return true;
  let realDb: string | null = null;
  try {
    if (fs.existsSync(dbPath)) realDb = fs.realpathSync(dbPath);
  } catch {
    realDb = null;
  }
  if (realDb === canonical) return true;
  if (!fs.existsSync(protectedPath) || !fs.existsSync(dbPath)) return false;
  try {
    if (realDb && fs.realpathSync(protectedPath) === realDb) return true;
    const left = fs.statSync(protectedPath);
    const right = fs.statSync(dbPath);
    return left.dev === right.dev && left.ino === right.ino;
  } catch {
    return false;
  }
}

export function isRailwayProductionSqlitePath(dbPath: string): boolean {
  return isProtectedSqlitePath(dbPath, RAILWAY_PRODUCTION_DB_PATH);
}

export function isLockedSnapshotApplyAuthorized(
  argv: readonly string[],
  env: NodeJS.ProcessEnv
): boolean {
  return argv.includes("apply") && env[OFFICIAL_LOCKED_SNAPSHOT_APPLY_ENV] === "1";
}

/** Wolfgang v4 only. Does not lift the default production refuse by itself. */
export function isWolfgangV4ProductionCasAuthorized(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[OFFICIAL_LOCKED_SNAPSHOT_PRODUCTION_CAS_ENV] === "1" &&
    env[OFFICIAL_LOCKED_SNAPSHOT_PRODUCTION_DRAFT_KEY_ENV] === WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey &&
    env[OFFICIAL_LOCKED_SNAPSHOT_PRODUCTION_CONFIRM_ENV] === WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey
  );
}

export function isProductionLockedSnapshotApplyBlocked(input: {
  dbPath: string;
  env: NodeJS.ProcessEnv;
}): boolean {
  const production =
    isRailwayProductionApplyEnvironment(input.env) || isRailwayProductionSqlitePath(input.dbPath);
  return production && !isWolfgangV4ProductionCasAuthorized(input.env);
}

export function openOfficialSupplyReadonlyDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  if (!queryOnlyEnabled(db)) {
    db.close();
    stop("locked_snapshot_query_only", "query_only is not ON");
  }
  return db;
}

function queryOnlyEnabled(db: Database.Database): boolean {
  const simple = db.pragma("query_only", { simple: true });
  if (simple === 1 || simple === "1" || simple === true) return true;
  const row = db.prepare("PRAGMA query_only").get() as { query_only?: number } | undefined;
  return row?.query_only === 1;
}

export function loadApprovedWolfgangV4Source(): {
  nextDraft: OfficialCharacterDraft;
  nextPlan: OfficialAssetPlan;
} {
  const compiled = loadCompiledOfficialCharacterSource(WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.sourceDraftKey);
  const nextDraft = buildPilotClusterBStyleProofDraft(compiled.draft);
  const file = JSON.parse(fs.readFileSync(CURRENT_PLAN_PATH, "utf8")) as { assetPlan: OfficialAssetPlan };
  return { nextDraft, nextPlan: file.assetPlan };
}

function approvedAssemblyStyle(env: NodeJS.ProcessEnv): OfficialGenreStyle {
  return {
    styleKey: WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.styleKey,
    genre: "로맨스 판타지",
    stage: "style_locked",
    candidates: [{ ...testStyleCandidate(PILOT_STYLE_PROOF_CANDIDATE_ID), dna: ROFAN_CLUSTER_B_VISUAL_STYLE_DNA }],
    approvedCandidateId: PILOT_STYLE_PROOF_CANDIDATE_ID,
    styleSeed: buildClusterBRofanStyleSeed(env),
    proofAssetLimit: 3,
  };
}

function dataFreeBytes(dbPath: string): number | null {
  try {
    return fs.statfsSync(path.dirname(dbPath)).bfree * fs.statfsSync(path.dirname(dbPath)).bsize;
  } catch {
    return null;
  }
}

function parseSqliteVersion(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)\b/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function sqliteVersionAtLeast(actual: string, minimum: string): boolean {
  const left = parseSqliteVersion(actual);
  const right = parseSqliteVersion(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

export function isPatchedIndependentSqliteVersion(version: string): boolean {
  return sqliteVersionAtLeast(version, INDEPENDENT_SQLITE_MIN_VERSION);
}

function sqliteEngineStop(message: string): never {
  stop("locked_snapshot_sqlite_engine", message);
}

type IndependentSqliteFileReport = {
  integrity: unknown;
  foreign_key_count: unknown;
};

type IndependentSqliteReport = {
  sqlite_version: unknown;
  live: IndependentSqliteFileReport;
  backup: IndependentSqliteFileReport;
};

function readIndependentSqliteReport(stdout: string): IndependentSqliteReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    sqliteEngineStop("independent sqlite checker returned non-JSON output");
  }
  if (!parsed || typeof parsed !== "object") {
    sqliteEngineStop("independent sqlite checker returned an invalid report");
  }
  const record = parsed as Partial<IndependentSqliteReport>;
  if (!record.live || !record.backup) {
    sqliteEngineStop("independent sqlite checker omitted live or backup results");
  }
  return record as IndependentSqliteReport;
}

function assertExactOkIntegrity(label: string, report: IndependentSqliteFileReport): void {
  if (!Array.isArray(report.integrity) || report.integrity.length !== 1 || report.integrity[0] !== "ok") {
    stop("locked_snapshot_backup_invalid", `${label} independent sqlite integrity_check is not the sole row ok`);
  }
  if (report.foreign_key_count !== 0) {
    stop("locked_snapshot_backup_invalid", `${label} independent sqlite foreign_key_check is not empty`);
  }
}

export function assertIndependentSqliteIntegrity(
  liveDbPath: string,
  backupPath: string,
  deps: IndependentSqliteCheckDeps = {}
): void {
  const spawn = deps.spawn ?? spawnSync;
  const pythonPath = deps.pythonPath ?? "python3";
  const timeoutMs = deps.timeoutMs ?? INDEPENDENT_SQLITE_TIMEOUT_MS;
  let result: SpawnSyncReturns<string>;
  try {
    result = spawn(pythonPath, ["-I", "-c", INDEPENDENT_SQLITE_CHECKER, liveDbPath, backupPath], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: INDEPENDENT_SQLITE_MAX_BUFFER,
      windowsHide: true,
      env: { ...process.env, TZ: "UTC" },
    });
  } catch {
    sqliteEngineStop("independent sqlite checker failed to start");
  }
  if (result.error?.message.includes("ETIMEDOUT") || result.signal === "SIGTERM") {
    sqliteEngineStop("independent sqlite checker timed out");
  }
  if (result.error) {
    const code = "code" in result.error ? String(result.error.code) : "";
    if (code === "ENOENT") sqliteEngineStop("python3 is not available for independent sqlite verification");
    if (code === "ETIMEDOUT") sqliteEngineStop("independent sqlite checker timed out");
    sqliteEngineStop("independent sqlite checker failed to start");
  }
  if (result.status !== 0) {
    sqliteEngineStop("independent sqlite checker exited without a trusted report");
  }
  const report = readIndependentSqliteReport((result.stdout ?? "").trim());
  if (typeof report.sqlite_version !== "string" || !parseSqliteVersion(report.sqlite_version)) {
    sqliteEngineStop(`independent sqlite version ${String(report.sqlite_version)} is unreadable`);
  }
  // Hipp ee4f6fa5ab is a false-positive only. Unpatched 3.42.0–3.45.1 may be
  // trusted when the sole row is already `ok`; any other text still STOPs.
  assertExactOkIntegrity("live", report.live);
  assertExactOkIntegrity("backup", report.backup);
}

function assetRowDigest(rows: AssetInspectRow[]): string {
  // The backup must match every persisted column, not only the operator's inspect subset.
  return sha256(canonicalJson(rows));
}

export function assertBackupMatchesLiveSource(
  backupPath: string,
  liveDbPath: string,
  sqliteCheck: IndependentSqliteCheckDeps = {}
): void {
  if (!fs.existsSync(backupPath)) {
    stop("locked_snapshot_backup_missing", "apply requires an existing VACUUM INTO snapshot");
  }
  let backupReal: string;
  let liveReal: string;
  try {
    backupReal = fs.realpathSync(backupPath);
    liveReal = fs.realpathSync(liveDbPath);
  } catch {
    stop("locked_snapshot_backup_invalid", "backup or live database path is unreadable");
  }
  if (backupReal === liveReal) {
    stop("locked_snapshot_backup_invalid", "backup path must be a distinct file from the live database");
  }
  let backupStat: fs.Stats;
  let liveStat: fs.Stats;
  try {
    backupStat = fs.statSync(backupReal);
    liveStat = fs.statSync(liveReal);
  } catch {
    stop("locked_snapshot_backup_invalid", "backup or live database path is unreadable");
  }
  if (backupStat.dev === liveStat.dev && backupStat.ino === liveStat.ino) {
    stop("locked_snapshot_backup_invalid", "backup path must be a distinct file from the live database");
  }
  if (fs.existsSync(`${backupPath}-wal`) || fs.existsSync(`${backupReal}-wal`)) {
    stop("locked_snapshot_backup_invalid", "backup must not include a live WAL file");
  }
  assertIndependentSqliteIntegrity(liveReal, backupReal, sqliteCheck);
  const live = openOfficialSupplyReadonlyDatabase(liveDbPath);
  let liveCharacter: CharacterInspectRow;
  let liveAssets: AssetInspectRow[];
  try {
    const read = readTarget(live, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
    liveCharacter = read.character;
    liveAssets = read.assets;
  } finally {
    live.close();
  }
  const backup = openOfficialSupplyReadonlyDatabase(backupPath);
  try {
    const { character, assets, replacements, styleStage, batchStatus } = readTarget(
      backup,
      WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey
    );
    assertInspectInvariants(character, assets, { replacements, styleStage, batchStatus });
    if (
      character.draft_json !== liveCharacter.draft_json ||
      character.asset_plan_json !== liveCharacter.asset_plan_json ||
      character.text_lock_hash !== liveCharacter.text_lock_hash ||
      character.appearance_lock_hash !== liveCharacter.appearance_lock_hash
    ) {
      stop("locked_snapshot_backup_mismatch", "backup official-supply text/plan/lock is not the live pre-CAS row");
    }
    if (assetRowDigest(assets) !== assetRowDigest(liveAssets)) {
      stop("locked_snapshot_backup_mismatch", "backup 14 asset rows are not the live pre-CAS rows");
    }
  } finally {
    backup.close();
  }
}

function readTarget(db: Database.Database, draftKey: string): {
  character: CharacterInspectRow;
  assets: AssetInspectRow[];
  replacements: number;
  styleStage: string;
  batchStatus: string;
} {
  if (draftKey !== WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey) {
    stop("locked_snapshot_wrong_target", `${draftKey} is not the Wolfgang v4 target`);
  }
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map(
      (row) => row.name
    )
  );
  if (!tables.has("official_supply_characters") || !tables.has("official_supply_assets")) {
    stop("locked_snapshot_schema_missing", "official supply tables are missing");
  }
  const character = db
    .prepare(
      `SELECT draft_key, batch_key, world_key, style_key, stage, draft_json, text_lock_hash,
              appearance_json, appearance_lock_hash, asset_plan_json, is_style_proof,
              anchor_approved_by, staging_claim, staged_character_id, updated_at
         FROM official_supply_characters WHERE draft_key=?`
    )
    .get(draftKey) as CharacterInspectRow | undefined;
  if (!character) stop("character_not_found", `draft ${draftKey} not found`);
  const assets = db
    .prepare(
      "SELECT * FROM official_supply_assets WHERE draft_key=? ORDER BY id"
    )
    .all(draftKey) as AssetInspectRow[];
  const replacements = (
    db.prepare("SELECT COUNT(*) AS n FROM official_supply_asset_replacements WHERE draft_key=?").get(draftKey) as {
      n: number;
    }
  ).n;
  const style = db
    .prepare("SELECT stage FROM official_supply_styles WHERE style_key=?")
    .get(character.style_key) as { stage: string } | undefined;
  const batch = db
    .prepare("SELECT status FROM official_supply_batches WHERE batch_key=?")
    .get(character.batch_key) as { status: string } | undefined;
  if (!style) stop("locked_snapshot_style", "style row missing");
  if (!batch) stop("locked_snapshot_batch", "batch row missing");
  return { character, assets, replacements, styleStage: style.stage, batchStatus: batch.status };
}

function assertInspectInvariants(
  row: CharacterInspectRow,
  assets: AssetInspectRow[],
  extras: { replacements: number; styleStage: string; batchStatus: string }
): void {
  const target = WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET;
  if (row.stage !== "asset_plan_locked") stop("character_stage", `stage=${row.stage}`);
  if (row.anchor_approved_by || row.staging_claim || row.staged_character_id != null) {
    stop("locked_snapshot_stage", "approval/staging state is not empty");
  }
  if (row.world_key !== target.worldKey || row.style_key !== target.styleKey || row.batch_key !== target.batchKey) {
    stop("locked_snapshot_identity_changed", "world/style/batch drifted");
  }
  if (extras.styleStage !== "style_locked") stop("locked_snapshot_style", `style stage=${extras.styleStage}`);
  if (extras.batchStatus !== "active") stop("locked_snapshot_batch", `batch status=${extras.batchStatus}`);
  if (!row.draft_json || !row.asset_plan_json || !row.text_lock_hash || !row.appearance_lock_hash) {
    stop("locked_snapshot_preimage_mismatch", "stored draft/plan/hash missing");
  }
  if (row.appearance_lock_hash !== target.expectedAppearanceLockHash) {
    stop("appearance_lock_stale", "appearance lock drifted");
  }
  if (
    row.text_lock_hash !== target.expectedOldTextLockHash &&
    row.text_lock_hash !== target.expectedNextTextLockHash
  ) {
    stop("locked_snapshot_preimage_mismatch", "stored text hash is neither the observed old snapshot nor the approved hash");
  }
  if (extras.replacements > 0) stop("locked_snapshot_replacement_present", "replacements exist");
  if (assets.length !== 14) stop("locked_snapshot_assets_drift", `expected 14 asset rows, found ${assets.length}`);
  const rep = assets.find((asset) => asset.kind === "representative");
  if (!rep || rep.slot_key !== "rep") stop("locked_snapshot_rep_drift", "representative row missing");
  if (
    rep.status !== "generated" ||
    rep.result_url !== target.expectedRepUrl ||
    rep.attempts !== target.expectedRepAttempts ||
    rep.lease_owner != null ||
    officialModerationVerdict(rep.moderation_json ? (JSON.parse(rep.moderation_json) as OfficialAssetModeration) : null) !==
      "clean"
  ) {
    stop("locked_snapshot_rep_drift", "representative status/url/attempts/moderation drifted");
  }
  const started = assets.filter(
    (asset) =>
      asset.kind !== "representative" &&
      (asset.status !== "planned" || asset.attempts !== 0 || asset.result_url != null || asset.lease_owner != null)
  );
  if (started.length > 0) {
    stop("locked_snapshot_assets_drift", `non-representative slot already started: ${started.map((row) => row.slot_key).join(",")}`);
  }
  const inFlight = assets.filter(
    (asset) => asset.status === "generating" || asset.status === "upload_pending" || asset.lease_owner != null
  );
  if (inFlight.length > 0) stop("locked_snapshot_in_flight", "in-flight asset rows present");
}

function classifyLockedSnapshot(
  character: CharacterInspectRow,
  nextDraft: OfficialCharacterDraft,
  nextPlan: OfficialAssetPlan
): "old_exact" | "approved_exact" {
  const draftSha = sha256(character.draft_json);
  const planSha = sha256(character.asset_plan_json!);
  const oldExact =
    draftSha === WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedOldDraftJsonSha256 &&
    planSha === WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedOldAssetPlanJsonSha256 &&
    character.text_lock_hash === WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedOldTextLockHash;
  if (oldExact) return "old_exact";
  const storedDraft = JSON.parse(character.draft_json) as OfficialCharacterDraft;
  const storedPlan = JSON.parse(character.asset_plan_json!) as OfficialAssetPlan;
  const approvedExact =
    character.text_lock_hash === WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedNextTextLockHash &&
    canonicalJson(storedDraft) === canonicalJson(nextDraft) &&
    canonicalJson(storedPlan) === canonicalJson(nextPlan);
  if (approvedExact) return "approved_exact";
  stop("locked_snapshot_preimage_mismatch", "stored draft/plan is neither the observed 2026-09-27 snapshot nor the approved source");
}

export function inspectLockedSnapshot(input: {
  dbPath: string;
  expectedSha: string;
  runtimeSha: string;
  env?: NodeJS.ProcessEnv;
}): LockedSnapshotInspectReport {
  if (!gitCommitMatchesDeployment(input.runtimeSha, input.expectedSha)) {
    stop("locked_snapshot_sha_mismatch", "runtime SHA does not match the expected deploy SHA");
  }
  const { nextDraft, nextPlan } = loadApprovedWolfgangV4Source();
  const db = openOfficialSupplyReadonlyDatabase(input.dbPath);
  try {
    const { character, assets, replacements, styleStage, batchStatus } = readTarget(
      db,
      WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey
    );
    assertInspectInvariants(character, assets, { replacements, styleStage, batchStatus });
    const draft = JSON.parse(character.draft_json) as OfficialCharacterDraft;
    const plan = JSON.parse(character.asset_plan_json!) as OfficialAssetPlan;
    const appearance = JSON.parse(character.appearance_json ?? "null") as OfficialAppearanceLock | null;
    const qa = evaluateAssetPlan(nextDraft, nextPlan);
    const record: OfficialCharacterRecord = {
      draftKey: nextDraft.draftKey,
      batchKey: character.batch_key,
      worldKey: nextDraft.worldKey,
      styleKey: nextDraft.styleKey,
      stage: "asset_plan_locked",
      draft: nextDraft,
      textLockHash: WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedNextTextLockHash,
      appearance,
      appearanceLockHash: character.appearance_lock_hash,
      assetPlan: nextPlan,
      isStyleProof: character.is_style_proof === 1,
      stagedCharacterId: null,
    };
    const env = input.env ?? process.env;
    let assembliesOk = 0;
    let assembliesFailed = 0;
    for (const slot of nextPlan.slots) {
      const composed = composeOfficialSlotGeneration({
        character: record,
        style: approvedAssemblyStyle(env),
        slotKey: slot.slotKey,
        representativeUrl: WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedRepUrl,
        env,
      });
      if (composed.ok) assembliesOk += 1;
      else assembliesFailed += 1;
    }
    const staleNeedles = STALE_NEEDLES.filter(
      (needle) => character.draft_json.includes(needle) || character.asset_plan_json!.includes(needle)
    );
    const snapshotClass = classifyLockedSnapshot(character, nextDraft, nextPlan);
    if (!qa.ok || assembliesFailed > 0) {
      stop("locked_snapshot_qa_failed", "approved source failed plan QA or no-provider assembly");
    }
    return {
      mode: "inspect",
      wrote: false,
      storeInstantiated: false,
      queryOnly: true,
      target: WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey,
      runtimeSha: input.runtimeSha,
      expectedSha: input.expectedSha,
      shaMatch: true,
      stage: character.stage,
      styleStage,
      batchStatus,
      isStyleProof: character.is_style_proof === 1,
      textLockHash: character.text_lock_hash!,
      appearanceLockHash: character.appearance_lock_hash!,
      textMatchesOld: snapshotClass === "old_exact",
      textMatchesApproved: snapshotClass === "approved_exact",
      draftJsonSha256: sha256(character.draft_json),
      assetPlanJsonSha256: sha256(character.asset_plan_json!),
      imageSubjectsPresent: plan.slots.filter((slot) => slot && "imageSubjects" in slot).length,
      staleNeedles,
      publicCopyLengths: {
        tagline: draft.tagline.length,
        description: draft.description.length,
        greeting: draft.greeting.length,
      },
      approvedCopyLengths: {
        tagline: nextDraft.tagline.length,
        description: nextDraft.description.length,
        greeting: nextDraft.greeting.length,
      },
      nextTextLockHash: WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedNextTextLockHash,
      assetCount: assets.length,
      slotKeys: assets.map((asset) => asset.slot_key),
      representative: {
        status: assets[0] ? assets.find((asset) => asset.kind === "representative")!.status : "missing",
        resultUrl: WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedRepUrl,
        attempts: WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedRepAttempts,
        lease: null,
        moderation: "clean",
      },
      nonRepStarted: [],
      inFlight: [],
      replacements,
      planQaOk: qa.ok,
      assemblies: { ok: assembliesOk, failed: assembliesFailed },
      verdict: snapshotClass === "old_exact" ? "ready_for_cas" : "already_current",
      backupPlan: {
        owner: "VACUUM INTO",
        copyLiveWalForbidden: true,
        syntheticProof: "src/lib/sqliteBackupRestore.synthetic.test.ts",
        dataFreeBytes: dataFreeBytes(input.dbPath),
      },
    };
  } finally {
    db.close();
  }
}

export function applyLockedSnapshot(input: {
  dbPath: string;
  expectedSha: string;
  runtimeSha: string;
  backupPath: string;
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  sqliteCheck?: IndependentSqliteCheckDeps;
}): LockedSnapshotApplyReport {
  if (!isLockedSnapshotApplyAuthorized(input.argv, input.env)) {
    stop("locked_snapshot_apply_forbidden", "apply requires argv apply and OFFICIAL_LOCKED_SNAPSHOT_APPLY=1");
  }
  if (isProductionLockedSnapshotApplyBlocked({ dbPath: input.dbPath, env: input.env })) {
    stop(
      "locked_snapshot_production_apply_blocked",
      "this operator refuses Railway production and /data/app.db unless Wolfgang v4 production CAS is explicitly authorized"
    );
  }
  if (!FULL_SHA.test(input.expectedSha)) {
    stop("locked_snapshot_sha_mismatch", "apply requires an independently provided full expected deploy SHA");
  }
  const runtimeSha = input.env.RAILWAY_GIT_COMMIT_SHA?.trim() ?? "";
  if (!FULL_SHA.test(runtimeSha) || runtimeSha !== input.runtimeSha) {
    stop("locked_snapshot_sha_mismatch", "apply runtime SHA must be the process RAILWAY_GIT_COMMIT_SHA");
  }
  if (!gitCommitMatchesDeployment(runtimeSha, input.expectedSha)) {
    stop("locked_snapshot_sha_mismatch", "apply expected deploy SHA does not match RAILWAY_GIT_COMMIT_SHA");
  }
  const inspect = inspectLockedSnapshot({
    dbPath: input.dbPath,
    expectedSha: input.expectedSha,
    runtimeSha,
    env: input.env,
  });
  if (inspect.verdict !== "ready_for_cas" && inspect.verdict !== "already_current") {
    stop("locked_snapshot_qa_failed", "inspect did not authorize apply");
  }
  assertBackupMatchesLiveSource(input.backupPath, input.dbPath, input.sqliteCheck);
  const { nextDraft, nextPlan } = loadApprovedWolfgangV4Source();
  const readonly = openOfficialSupplyReadonlyDatabase(input.dbPath);
  let expectedDraftJson: string;
  let expectedAssetPlanJson: string;
  let expectedTextLockHash: string;
  try {
    const { character } = readTarget(readonly, WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey);
    classifyLockedSnapshot(character, nextDraft, nextPlan);
    expectedDraftJson = character.draft_json;
    expectedAssetPlanJson = character.asset_plan_json!;
    expectedTextLockHash = character.text_lock_hash!;
  } finally {
    readonly.close();
  }
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = path.dirname(input.dbPath);
  try {
    const store = new OfficialSupplyStore();
    const result = store.reconcileLockedSnapshot(WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey, {
      expectedDraftJson,
      expectedAssetPlanJson,
      expectedTextLockHash,
      expectedAppearanceLockHash: WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedAppearanceLockHash,
      expectedRepresentative: {
        status: "generated",
        resultUrl: WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedRepUrl,
        attempts: WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.expectedRepAttempts,
      },
      nextDraft,
      nextPlan,
    });
    return {
      mode: "apply",
      wrote: result.status === "updated",
      storeWriter: "OfficialSupplyStore.reconcileLockedSnapshot",
      target: WOLFGANG_V4_LOCKED_SNAPSHOT_TARGET.draftKey,
      result,
    };
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
  }
}
