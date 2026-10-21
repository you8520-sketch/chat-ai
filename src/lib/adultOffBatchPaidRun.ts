import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  ADULT_OFF_GUARD_POLICY_VERSION,
  ADULT_OFF_GUARD_WINDOW_CHARS,
  ADULT_OFF_GUARD_WINDOW_OVERLAP_CHARS,
  AdultOffClassifierCallError,
  adultOffApprovedTextHash,
  evaluateAdultOffOutput,
  splitAdultOffGuardWindows,
  type AdultOffClassify,
  type AdultOffInspectionOutcome,
} from "@/lib/adultOffOutputGuard";
import type { AdultOffClassifierTurnScope } from "@/lib/adultOffOutputClassifier";
import { isLedgerEventCostExact } from "@/lib/providerCostLedger";
import {
  ADULT_OFF_BATCH_MODERATION_REQUEST_KIND,
  adultOffGuardDecisionToInspectionOutcome,
  adultOffBatchRunRequestPrefix,
  buildAdultOffBatchGenerationRequestId,
  commitAdultOffAuxSurveyItemIfFresh,
  commitAdultOffInspectionIfFresh,
  fingerprintAdultOffAuxSurveyItem,
  loadAssistantRowsForAdultOffInspection,
  planAdultOffBatchInspection,
  planAdultOffBatchInspectionSummary,
  readAdultOffBatchCallCost,
  sumAdultOffBatchModerationSpend,
  surveyAdultOffAuxSurfaces,
  type AdultOffAuxSurfaceFingerprint,
  type AdultOffAuxTextItem,
  type AdultOffInspectionMessageRow,
  type AdultOffInspectionPlanItem,
} from "@/lib/adultOffBatchInspectionPrep";

export type AdultOffBatchMode = "plan" | "execute";

export const ADULT_OFF_BATCH_DEFAULT_RESERVE_KRW_PER_WINDOW = 0.45;
export const ADULT_OFF_BATCH_DEFAULT_USD_KRW = 1450;
const PLAN_DISPLAY_CAP_KRW = 1500;
const USD_TO_KRW_MARKUP = 1.02;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const POSITIVE_DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
const LIVE_PRODUCTION_DB_PATHS = ["/data/app.db"] as const;

export class AdultOffBatchConfigError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AdultOffBatchConfigError";
  }
}

export class AdultOffBatchRunRefusedError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AdultOffBatchRunRefusedError";
  }
}

export type AdultOffBatchPaidRunConfig = {
  mode: AdultOffBatchMode;
  runId: string | null;
  dbPath: string;
  dbRealPath: string;
  liveProductionDb: boolean;
  capKrw: number;
  fxKrwPerUsd: number;
  reservePerWindowKrw: number;
  stateDir: string | null;
  allowProdWrite: boolean;
};

type Env = Readonly<Record<string, string | undefined>>;

function readPositiveNumber(env: Env, name: string, fallback: number | null): number {
  const raw = env[name];
  if (raw === undefined) {
    if (fallback == null) {
      throw new AdultOffBatchConfigError("missing_" + name.toLowerCase(), `${name} is required`);
    }
    return fallback;
  }
  const trimmed = raw.trim();
  if (!POSITIVE_DECIMAL_PATTERN.test(trimmed)) {
    throw new AdultOffBatchConfigError(
      "invalid_" + name.toLowerCase(),
      `${name} must be a finite positive decimal number`
    );
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) {
    throw new AdultOffBatchConfigError(
      "invalid_" + name.toLowerCase(),
      `${name} must be a finite positive decimal number`
    );
  }
  return value;
}

function readMode(env: Env): AdultOffBatchMode {
  const raw = env.ADULT_OFF_BATCH_MODE;
  if (raw === undefined) return "plan";
  const trimmed = raw.trim();
  if (trimmed === "plan" || trimmed === "execute") return trimmed;
  throw new AdultOffBatchConfigError(
    "invalid_mode",
    "ADULT_OFF_BATCH_MODE must be exactly 'plan' or 'execute'"
  );
}

/** 같은 파일(심볼릭 링크·상대 경로·hard link 포함)이 운영 볼륨 DB인지 inode 단위로 판정한다. */
export function isLiveProductionDatabase(dbPath: string, env: Env = process.env): boolean {
  const target = fs.statSync(dbPath);
  const targetReal = fs.realpathSync(dbPath);
  const candidates: string[] = [...LIVE_PRODUCTION_DB_PATHS];
  const volumeMount = env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (volumeMount) candidates.push(path.join(volumeMount, "app.db"));
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.dev === target.dev && stat.ino === target.ino) return true;
      if (fs.realpathSync(candidate) === targetReal) return true;
    } catch {
      continue;
    }
  }
  return false;
}

/**
 * 모든 환경변수·경로 검증을 DB를 열기 전에 끝낸다.
 * 실패하면 유료 호출도, DB 쓰기도, 상태 파일 쓰기도 일어나지 않는다.
 */
export function parseAdultOffBatchPaidRunConfig(
  env: Env,
  dbPath: string
): AdultOffBatchPaidRunConfig {
  const mode = readMode(env);
  const rawRunId = env.ADULT_OFF_BATCH_RUN_ID;
  let runId: string | null = null;
  if (rawRunId !== undefined) {
    const trimmed = rawRunId.trim();
    if (!RUN_ID_PATTERN.test(trimmed)) {
      throw new AdultOffBatchConfigError(
        "invalid_run_id",
        "ADULT_OFF_BATCH_RUN_ID must match [A-Za-z0-9][A-Za-z0-9._-]{2,63}"
      );
    }
    runId = trimmed;
  }

  const capKrw = readPositiveNumber(
    env,
    "ADULT_OFF_BATCH_CAP_KRW",
    mode === "execute" ? null : PLAN_DISPLAY_CAP_KRW
  );
  const fxKrwPerUsd = readPositiveNumber(
    env,
    "ADULT_OFF_BATCH_USD_KRW",
    ADULT_OFF_BATCH_DEFAULT_USD_KRW
  );
  const reservePerWindowKrw = readPositiveNumber(
    env,
    "ADULT_OFF_BATCH_RESERVE_KRW_PER_WINDOW",
    ADULT_OFF_BATCH_DEFAULT_RESERVE_KRW_PER_WINDOW
  );

  if (!fs.existsSync(dbPath) || !fs.statSync(dbPath).isFile()) {
    throw new AdultOffBatchConfigError("database_missing", "database file does not exist");
  }
  const dbRealPath = fs.realpathSync(dbPath);
  const liveProductionDb = isLiveProductionDatabase(dbPath, env);
  const allowProdWrite = env.ADULT_OFF_BATCH_ALLOW_PROD_WRITE === "1";

  let stateDir: string | null = null;
  if (mode === "execute") {
    if (!runId) {
      throw new AdultOffBatchConfigError("missing_run_id", "ADULT_OFF_BATCH_RUN_ID is required");
    }
    if (env.ADULT_OFF_BATCH_APPROVE_PAID !== "1") {
      throw new AdultOffBatchConfigError(
        "paid_not_approved",
        "ADULT_OFF_BATCH_APPROVE_PAID=1 is required for execute"
      );
    }
    const rawStateDir = env.ADULT_OFF_BATCH_STATE_DIR?.trim();
    if (!rawStateDir || !path.isAbsolute(rawStateDir)) {
      throw new AdultOffBatchConfigError(
        "invalid_state_dir",
        "ADULT_OFF_BATCH_STATE_DIR must be an absolute path"
      );
    }
    stateDir = path.resolve(rawStateDir);
    if (!env.CHEAPER_INFERENCE_API_KEY?.trim()) {
      throw new AdultOffBatchConfigError(
        "missing_cheaper_inference_api_key",
        "CHEAPER_INFERENCE_API_KEY is required for execute"
      );
    }
    if (liveProductionDb && !allowProdWrite) {
      throw new AdultOffBatchConfigError(
        "prod_write_refused",
        "live production database requires ADULT_OFF_BATCH_ALLOW_PROD_WRITE=1"
      );
    }
  }

  return {
    mode,
    runId,
    dbPath: path.resolve(dbPath),
    dbRealPath,
    liveProductionDb,
    capKrw,
    fxKrwPerUsd,
    reservePerWindowKrw,
    stateDir,
    allowProdWrite,
  };
}

export function adultOffUsdToKrw(usd: number, fxKrwPerUsd: number): number {
  return usd * fxKrwPerUsd * USD_TO_KRW_MARKUP;
}

/** 이미 저장된 v2 증명(본문 usage·variant usage·보조 레코드)에서 정확 문자열 판정을 한 번만 색인한다. */
export function buildStoredDispositionIndex(
  rows: readonly AdultOffInspectionMessageRow[]
): (text: string) => "approved" | "restricted" | null {
  const approved = new Set<string>();
  const restricted = new Set<string>();

  const collect = (guard: unknown): void => {
    if (!guard || typeof guard !== "object") return;
    const record = guard as {
      policyVersion?: unknown;
      approvedTextHashes?: unknown;
      restrictedTextHashes?: unknown;
    };
    if (record.policyVersion !== ADULT_OFF_GUARD_POLICY_VERSION) return;
    if (Array.isArray(record.approvedTextHashes)) {
      for (const hash of record.approvedTextHashes) {
        if (typeof hash === "string") approved.add(hash);
      }
    }
    if (Array.isArray(record.restrictedTextHashes)) {
      for (const hash of record.restrictedTextHashes) {
        if (typeof hash === "string") restricted.add(hash);
      }
    }
  };
  const collectJson = (raw: string | null | undefined, pick: (parsed: unknown) => unknown): void => {
    if (!raw?.trim()) return;
    try {
      collect(pick(JSON.parse(raw)));
    } catch {
      return;
    }
  };
  const guardOf = (parsed: unknown): unknown =>
    parsed && typeof parsed === "object" ? (parsed as { adultOffGuard?: unknown }).adultOffGuard : null;

  for (const row of rows) {
    collectJson(row.usage, guardOf);
    collectJson(row.status_meta, guardOf);
    collectJson(row.suggested_replies_json, guardOf);
    if (row.alternates?.trim() && row.alternates !== "[]") {
      try {
        const variants = JSON.parse(row.alternates) as Array<{ usage?: unknown }>;
        if (Array.isArray(variants)) {
          for (const variant of variants) collect(guardOf(variant?.usage));
        }
      } catch {
        continue;
      }
    }
  }

  return (text) => {
    const hash = adultOffApprovedTextHash(text);
    const isApproved = approved.has(hash);
    const isRestricted = restricted.has(hash);
    if (isApproved && !isRestricted) return "approved";
    if (isRestricted && !isApproved) return "restricted";
    return null;
  };
}

function windowCountForText(text: string): number {
  if (!text.trim()) return 0;
  return splitAdultOffGuardWindows(text, ADULT_OFF_GUARD_WINDOW_CHARS, ADULT_OFF_GUARD_WINDOW_OVERLAP_CHARS)
    .length;
}

export type AdultOffBatchAuxWorkItem = {
  item: AdultOffAuxTextItem;
  texts: string[];
  fingerprint: AdultOffAuxSurfaceFingerprint | null;
};

export type AdultOffBatchWork = {
  plan: AdultOffInspectionPlanItem[];
  bodyItems: AdultOffInspectionPlanItem[];
  auxItems: AdultOffBatchAuxWorkItem[];
  storedDisposition: (text: string) => "approved" | "restricted" | null;
  /** 유료 분류가 실제로 필요한 고유 문자열. 저장된 판정이 있는 문자열은 제외. */
  pendingTexts: string[];
  pendingWindows: number;
};

/**
 * 유료 호출 전에 한 번만 만든 작업 목록. fingerprint도 이 시점에 고정하며
 * 유료 호출 뒤 최신 row에서 다시 만들지 않는다.
 */
export function collectAdultOffBatchWork(
  db: DatabaseType,
  rows: readonly AdultOffInspectionMessageRow[],
  options: { buildAuxFingerprints: boolean }
): AdultOffBatchWork {
  const plan = planAdultOffBatchInspection(rows);
  const storedDisposition = buildStoredDispositionIndex(rows);
  const bodyItems = plan.filter((item) => item.kind === "needs_classification");
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const survey = surveyAdultOffAuxSurfaces(rows);
  const auxItems: AdultOffBatchAuxWorkItem[] = [];
  for (const item of survey.items) {
    if (item.allTextsApprovedByProof) continue;
    const texts = item.texts.filter((text) => text.trim());
    if (texts.length === 0) continue;
    const row = rowById.get(item.messageId);
    const fingerprint =
      options.buildAuxFingerprints && row ? fingerprintAdultOffAuxSurveyItem(row, item, db) : null;
    auxItems.push({ item, texts, fingerprint });
  }

  const pending = new Set<string>();
  for (const item of bodyItems) {
    if (!storedDisposition(item.target.text)) pending.add(item.target.text);
  }
  for (const aux of auxItems) {
    for (const text of aux.texts) {
      if (!storedDisposition(text)) pending.add(text);
    }
  }
  const pendingTexts = [...pending];
  const pendingWindows = pendingTexts.reduce((sum, text) => sum + windowCountForText(text), 0);
  return { plan, bodyItems, auxItems, storedDisposition, pendingTexts, pendingWindows };
}

export type AdultOffBatchPlanReport = {
  status: "plan_only_ok";
  mode: "plan";
  runId: string | null;
  database: { path: string; readonly: true; liveProductionDb: boolean };
  requestKind: string;
  targets: ReturnType<typeof planAdultOffBatchInspectionSummary>;
  aux: { itemsNeedingProof: number; fingerprintableAtPlanTime: number };
  pendingClassification: { uniqueTexts: number; windows: number };
  costEstimateKrw: {
    reservePerWindow: number;
    reserveEstimate: number;
    capKrw: number;
    reserveEstimateWithinCap: boolean;
    note: string;
  };
  ledgerSpendToDate: { settledKrw: number; unknownCostEvents: number; totalEvents: number } | null;
};

/** 읽기 전용 DB 핸들에서만 쓴다. 유료 호출·DB 쓰기·상태 파일 쓰기 없음. */
export function buildAdultOffBatchPlanReport(
  db: DatabaseType,
  config: AdultOffBatchPaidRunConfig
): AdultOffBatchPlanReport {
  const rows = loadAssistantRowsForAdultOffInspection(db);
  const work = collectAdultOffBatchWork(db, rows, { buildAuxFingerprints: true });
  const reserveEstimate = work.pendingWindows * config.reservePerWindowKrw;
  let ledgerSpendToDate: AdultOffBatchPlanReport["ledgerSpendToDate"] = null;
  const hasLedger = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='api_cost_ledger'")
    .get();
  if (config.runId && hasLedger) {
    const columns = new Set(
      (db.prepare("PRAGMA table_info(api_cost_ledger)").all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    );
    if (columns.has("generation_request_id") && columns.has("actual_cost_usd")) {
      const spend = sumAdultOffBatchModerationSpendReadOnly(db, config.runId);
      ledgerSpendToDate = {
        settledKrw: adultOffUsdToKrw(spend.settledUsd, config.fxKrwPerUsd),
        unknownCostEvents: spend.unknownCostEvents,
        totalEvents: spend.totalEvents,
      };
    }
  }
  return {
    status: "plan_only_ok",
    mode: "plan",
    runId: config.runId,
    database: { path: config.dbPath, readonly: true, liveProductionDb: config.liveProductionDb },
    requestKind: ADULT_OFF_BATCH_MODERATION_REQUEST_KIND,
    targets: planAdultOffBatchInspectionSummary(work.plan),
    aux: {
      itemsNeedingProof: work.auxItems.length,
      fingerprintableAtPlanTime: work.auxItems.filter((aux) => aux.fingerprint != null).length,
    },
    pendingClassification: {
      uniqueTexts: work.pendingTexts.length,
      windows: work.pendingWindows,
    },
    costEstimateKrw: {
      reservePerWindow: config.reservePerWindowKrw,
      reserveEstimate: Math.round(reserveEstimate * 100) / 100,
      capKrw: config.capKrw,
      reserveEstimateWithinCap: reserveEstimate <= config.capKrw,
      note: "reserve estimate is not a guaranteed maximum; execute stops on observed actual cost and fails closed on unknown cost",
    },
    ledgerSpendToDate,
  };
}

function sumAdultOffBatchModerationSpendReadOnly(db: DatabaseType, runId: string) {
  const rows = db
    .prepare(
      `SELECT actual_cost_usd, actual_cost_source, event_status FROM api_cost_ledger
       WHERE request_kind = ? AND instr(generation_request_id, ?) = 1`
    )
    .all(ADULT_OFF_BATCH_MODERATION_REQUEST_KIND, adultOffBatchRunRequestPrefix(runId)) as Array<{
    actual_cost_usd: number | null;
    actual_cost_source: string | null;
    event_status: string | null;
  }>;
  let settledUsd = 0;
  let unknownCostEvents = 0;
  for (const row of rows) {
    if (isLedgerEventCostExact(row)) settledUsd += row.actual_cost_usd ?? 0;
    else unknownCostEvents += 1;
  }
  return { settledUsd, unknownCostEvents, totalEvents: rows.length };
}

export type AdultOffBatchRunState = {
  version: 1;
  runId: string;
  settledKrw: number;
  maxObservedWindowKrw: number;
  callCount: number;
  nextCallSeq: number;
  inFlight: { requestId: string; reservedKrw: number } | null;
  halted: { reason: string; detail: string; at: string } | null;
  updatedAt: string;
};

function emptyRunState(runId: string): AdultOffBatchRunState {
  return {
    version: 1,
    runId,
    settledKrw: 0,
    maxObservedWindowKrw: 0,
    callCount: 0,
    nextCallSeq: 1,
    inFlight: null,
    halted: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function runStatePath(stateDir: string, runId: string): string {
  return path.join(stateDir, `${runId}.state.json`);
}

function lockPath(stateDir: string): string {
  return path.join(stateDir, "execution.lock");
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export type AdultOffBatchExecutionLock = { release(): void };

/**
 * 상태 디렉터리 단위 전역 실행 잠금. RUN_ID가 같든 다르든 동시에 하나만 돈다.
 * 같은 호스트에서 죽은 PID의 잠금만 자동 회수하고, 그 외에는 사람이 확인할 때까지 거부한다.
 */
export function acquireAdultOffBatchExecutionLock(
  stateDir: string,
  runId: string
): AdultOffBatchExecutionLock {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = lockPath(stateDir);
  const body = JSON.stringify({
    pid: process.pid,
    host: os.hostname(),
    runId,
    startedAt: new Date().toISOString(),
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, "wx", 0o600);
      try {
        fs.writeSync(fd, body);
      } finally {
        fs.closeSync(fd);
      }
      return {
        release() {
          try {
            const held = JSON.parse(fs.readFileSync(file, "utf8")) as { pid?: number; runId?: string };
            if (held.pid === process.pid && held.runId === runId) fs.unlinkSync(file);
          } catch {
            return;
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let holder: { pid?: number; host?: string; runId?: string } = {};
      try {
        holder = JSON.parse(fs.readFileSync(file, "utf8")) as typeof holder;
      } catch {
        holder = {};
      }
      const reclaimable =
        attempt === 0 &&
        holder.host === os.hostname() &&
        typeof holder.pid === "number" &&
        !isProcessAlive(holder.pid);
      if (reclaimable) {
        fs.unlinkSync(file);
        continue;
      }
      throw new AdultOffBatchRunRefusedError(
        "concurrent_run_locked",
        `another adult-off batch execution holds the lock (run ${holder.runId ?? "unknown"})`
      );
    }
  }
  throw new AdultOffBatchRunRefusedError("concurrent_run_locked", "could not acquire execution lock");
}

export function loadAdultOffBatchRunState(stateDir: string, runId: string): AdultOffBatchRunState {
  const file = runStatePath(stateDir, runId);
  if (!fs.existsSync(file)) return emptyRunState(runId);
  let parsed: Partial<AdultOffBatchRunState>;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AdultOffBatchRunState>;
  } catch {
    throw new AdultOffBatchRunRefusedError("state_unreadable", "run state file is not valid JSON");
  }
  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (
    parsed.version !== 1 ||
    parsed.runId !== runId ||
    !finite(parsed.settledKrw) ||
    !finite(parsed.maxObservedWindowKrw) ||
    !finite(parsed.callCount) ||
    !finite(parsed.nextCallSeq)
  ) {
    throw new AdultOffBatchRunRefusedError("state_invalid", "run state file failed validation");
  }
  return {
    version: 1,
    runId,
    settledKrw: parsed.settledKrw,
    maxObservedWindowKrw: parsed.maxObservedWindowKrw,
    callCount: parsed.callCount,
    nextCallSeq: parsed.nextCallSeq,
    inFlight: parsed.inFlight ?? null,
    halted: parsed.halted ?? null,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
  };
}

function saveAdultOffBatchRunState(stateDir: string, state: AdultOffBatchRunState): void {
  const file = runStatePath(stateDir, state.runId);
  const tmp = `${file}.${process.pid}.tmp`;
  state.updatedAt = new Date().toISOString();
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeSync(fd, JSON.stringify(state, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

export type AdultOffBatchStopReason =
  | "completed"
  | "cap_reached"
  | "halted_unknown_cost"
  | "halted_classifier_error";

export type AdultOffBatchExecuteReport = {
  status: "execute_finished" | "execute_stopped";
  stopReason: AdultOffBatchStopReason;
  runId: string;
  database: { path: string; liveProductionDb: boolean };
  budget: {
    capKrw: number;
    settledKrwAtStart: number;
    settledKrwAtEnd: number;
    paidWindowCalls: number;
    cumulativePaidWindowCalls: number;
    maxObservedWindowKrw: number;
  };
  body: {
    classifiedTexts: number;
    reusedStoredTexts: number;
    written: number;
    writtenVariantIsolated: number;
    skippedStale: number;
    skippedNoop: number;
    skippedUnresolved: number;
  };
  aux: {
    classifiedTexts: number;
    written: number;
    skippedStale: number;
    skippedNoop: number;
    skippedUnresolved: number;
    notApproved: number;
    fingerprintMissing: number;
  };
  halted: AdultOffBatchRunState["halted"];
};

class BatchStopSignal extends Error {
  constructor(readonly reason: AdultOffBatchStopReason) {
    super(reason);
    this.name = "BatchStopSignal";
  }
}

export type AdultOffBatchExecuteInput = {
  config: AdultOffBatchPaidRunConfig;
  openDatabase: () => DatabaseType;
  createClassifier: (scope: AdultOffClassifierTurnScope) => AdultOffClassify;
  closeDatabase?: boolean;
};

/**
 * 유료 분류 + 원자 commit 실행기. 설정 검증이 끝난 execute 설정만 받는다.
 * 순서: 전역 잠금 → 상태·원장 복원 → DB open → 작업 목록·fingerprint 고정 → 호출 단위 예산 게이트.
 */
export async function executeAdultOffBatchPaidRun(
  input: AdultOffBatchExecuteInput
): Promise<AdultOffBatchExecuteReport> {
  const { config } = input;
  if (config.mode !== "execute" || !config.runId || !config.stateDir) {
    throw new AdultOffBatchRunRefusedError("not_execute_config", "execute requires a validated execute config");
  }
  const runId = config.runId;
  const stateDir = config.stateDir;
  const lock = acquireAdultOffBatchExecutionLock(stateDir, runId);
  let db: DatabaseType | null = null;
  try {
    const state = loadAdultOffBatchRunState(stateDir, runId);
    if (state.halted) {
      throw new AdultOffBatchRunRefusedError(
        "run_halted",
        `run ${runId} is halted (${state.halted.reason}); investigate before using a new RUN_ID`
      );
    }
    db = input.openDatabase();
    db.pragma("busy_timeout = 5000");
    const database = db;
    const halt = (reason: AdultOffBatchStopReason, detail: string): void => {
      state.halted = { reason, detail: detail.slice(0, 300), at: new Date().toISOString() };
      saveAdultOffBatchRunState(stateDir, state);
    };
    const settleCall = (requestId: string, callError: unknown): void => {
      const cost = readAdultOffBatchCallCost(database, requestId);
      const known = cost.totalEvents > 0 && cost.unknownCostEvents === 0 && cost.settledUsd > 0;
      if (known) {
        const costKrw = adultOffUsdToKrw(cost.settledUsd, config.fxKrwPerUsd);
        state.settledKrw += costKrw;
        state.maxObservedWindowKrw = Math.max(state.maxObservedWindowKrw, costKrw);
        state.callCount += 1;
        state.inFlight = null;
        saveAdultOffBatchRunState(stateDir, state);
      } else {
        halt("halted_unknown_cost", `call ${requestId}: ledger cost unknown (events=${cost.totalEvents})`);
        return;
      }
      const benign =
        callError instanceof AdultOffClassifierCallError && callError.outcome === "invalid_output";
      if (callError && !benign) {
        halt("halted_classifier_error", `call ${requestId}: ${(callError as Error).message ?? "error"}`);
      }
    };

    if (state.inFlight) {
      settleCall(state.inFlight.requestId, null);
      if (state.halted) {
        throw new AdultOffBatchRunRefusedError(
          "interrupted_call_cost_unknown",
          "a previous call was interrupted and its cost cannot be confirmed from the ledger"
        );
      }
    }
    const priorSpend = sumAdultOffBatchModerationSpend(database, runId);
    if (priorSpend.unknownCostEvents > 0) {
      halt("halted_unknown_cost", `ledger has ${priorSpend.unknownCostEvents} unknown-cost events for run`);
      throw new AdultOffBatchRunRefusedError(
        "ledger_unknown_cost",
        "ledger contains moderation events for this run with unknown cost"
      );
    }
    state.settledKrw = Math.max(
      state.settledKrw,
      adultOffUsdToKrw(priorSpend.settledUsd, config.fxKrwPerUsd)
    );
    saveAdultOffBatchRunState(stateDir, state);
    const settledKrwAtStart = state.settledKrw;

    const rows = loadAssistantRowsForAdultOffInspection(database);
    const work = collectAdultOffBatchWork(database, rows, { buildAuxFingerprints: true });
    const chatIdByMessage = new Map<number, number>();
    for (const row of database
      .prepare("SELECT id, chat_id FROM messages WHERE role='assistant'")
      .all() as Array<{ id: number; chat_id: number }>) {
      chatIdByMessage.set(row.id, row.chat_id);
    }

    const report: AdultOffBatchExecuteReport = {
      status: "execute_finished",
      stopReason: "completed",
      runId,
      database: { path: config.dbPath, liveProductionDb: config.liveProductionDb },
      budget: {
        capKrw: config.capKrw,
        settledKrwAtStart,
        settledKrwAtEnd: settledKrwAtStart,
        paidWindowCalls: 0,
        cumulativePaidWindowCalls: state.callCount,
        maxObservedWindowKrw: state.maxObservedWindowKrw,
      },
      body: {
        classifiedTexts: 0,
        reusedStoredTexts: 0,
        written: 0,
        writtenVariantIsolated: 0,
        skippedStale: 0,
        skippedNoop: 0,
        skippedUnresolved: 0,
      },
      aux: {
        classifiedTexts: 0,
        written: 0,
        skippedStale: 0,
        skippedNoop: 0,
        skippedUnresolved: 0,
        notApproved: 0,
        fingerprintMissing: 0,
      },
      halted: null,
    };

    const outcomeByText = new Map<string, AdultOffInspectionOutcome>();
    let stopReason: AdultOffBatchStopReason | null = null;
    let capSignalRaised = false;
    let callsThisRun = 0;

    const haltedReason = (): AdultOffBatchStopReason | null =>
      state.halted ? (state.halted.reason as AdultOffBatchStopReason) : null;

    const reservePerWindow = (): number =>
      Math.max(config.reservePerWindowKrw, state.maxObservedWindowKrw);

    const assertMayCall = (): void => {
      const reason = haltedReason();
      if (reason) throw new BatchStopSignal(reason);
      if (state.settledKrw + reservePerWindow() > config.capKrw) {
        capSignalRaised = true;
        throw new BatchStopSignal("cap_reached");
      }
    };

    const gatedClassifier =
      (chatId: number, assistantMessageId: number): AdultOffClassify =>
      async (windowText) => {
        assertMayCall();
        const requestId = buildAdultOffBatchGenerationRequestId(runId, state.nextCallSeq);
        state.nextCallSeq += 1;
        callsThisRun += 1;
        state.inFlight = { requestId, reservedKrw: reservePerWindow() };
        saveAdultOffBatchRunState(stateDir, state);
        const classify = input.createClassifier({
          chatId,
          assistantMessageId,
          generationSequence: 0,
          generationRequestId: requestId,
        });
        let callError: unknown = null;
        try {
          return await classify(windowText);
        } catch (error) {
          callError = error;
          throw error;
        } finally {
          settleCall(requestId, callError);
        }
      };

    /** @returns null when the run must stop before this text. */
    const classifyText = async (
      text: string,
      messageId: number,
      surface: "body" | "aux"
    ): Promise<AdultOffInspectionOutcome | null> => {
      const cached = outcomeByText.get(text);
      if (cached) return cached;
      const stored = work.storedDisposition(text);
      if (stored) {
        outcomeByText.set(text, stored);
        if (surface === "body") report.body.reusedStoredTexts += 1;
        return stored;
      }
      const windows = windowCountForText(text);
      const haltedBefore = haltedReason();
      if (haltedBefore) {
        stopReason = haltedBefore;
        return null;
      }
      if (state.settledKrw + windows * reservePerWindow() > config.capKrw) {
        stopReason = "cap_reached";
        return null;
      }
      const decision = await evaluateAdultOffOutput(
        [text],
        gatedClassifier(chatIdByMessage.get(messageId) ?? 0, messageId)
      );
      const haltedAfter = haltedReason();
      if (haltedAfter) {
        stopReason = haltedAfter;
        return null;
      }
      if (capSignalRaised) {
        stopReason = "cap_reached";
        return null;
      }
      const outcome = adultOffGuardDecisionToInspectionOutcome(decision);
      outcomeByText.set(text, outcome);
      if (surface === "body") report.body.classifiedTexts += 1;
      else report.aux.classifiedTexts += 1;
      return outcome;
    };

    for (const item of work.bodyItems) {
      const outcome = await classifyText(item.target.text, item.target.messageId, "body");
      if (!outcome) break;
      const result = commitAdultOffInspectionIfFresh(database, {
        fingerprint: item.fingerprint,
        expectedText: item.target.text,
        outcome,
      });
      switch (result) {
        case "written":
          report.body.written += 1;
          break;
        case "written_variant_isolated":
          report.body.writtenVariantIsolated += 1;
          break;
        case "skipped_stale":
          report.body.skippedStale += 1;
          break;
        case "skipped_noop":
          report.body.skippedNoop += 1;
          break;
        case "skipped_unresolved":
          report.body.skippedUnresolved += 1;
          break;
        default: {
          const never: never = result;
          throw new Error(String(never));
        }
      }
    }

    if (!stopReason) {
      for (const aux of work.auxItems) {
        if (!aux.fingerprint) {
          report.aux.fingerprintMissing += 1;
          continue;
        }
        const outcomes: AdultOffInspectionOutcome[] = [];
        let stopped = false;
        for (const text of aux.texts) {
          const outcome = await classifyText(text, aux.item.messageId, "aux");
          if (!outcome) {
            stopped = true;
            break;
          }
          outcomes.push(outcome);
          if (outcome !== "approved") break;
        }
        if (stopped) break;
        if (outcomes.length !== aux.texts.length || outcomes.some((o) => o !== "approved")) {
          if (outcomes.some((o) => o === "unresolved")) report.aux.skippedUnresolved += 1;
          else report.aux.notApproved += 1;
          continue;
        }
        const result = commitAdultOffAuxSurveyItemIfFresh(database, {
          fingerprint: aux.fingerprint,
          expectedTexts: aux.texts,
          outcomes,
        });
        switch (result) {
          case "written":
            report.aux.written += 1;
            break;
          case "skipped_stale":
            report.aux.skippedStale += 1;
            break;
          case "skipped_noop":
            report.aux.skippedNoop += 1;
            break;
          case "skipped_unresolved":
            report.aux.skippedUnresolved += 1;
            break;
          default: {
            const never: never = result;
            throw new Error(String(never));
          }
        }
      }
    }

    report.budget.settledKrwAtEnd = state.settledKrw;
    report.budget.paidWindowCalls = callsThisRun;
    report.budget.cumulativePaidWindowCalls = state.callCount;
    report.budget.maxObservedWindowKrw = state.maxObservedWindowKrw;
    report.halted = state.halted;
    if (stopReason) {
      report.status = "execute_stopped";
      report.stopReason = stopReason;
    }
    return report;
  } finally {
    if (db && input.closeDatabase !== false) db.close();
    lock.release();
  }
}
