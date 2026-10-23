import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  ADULT_OFF_GUARD_POLICY_VERSION,
  ADULT_OFF_GUARD_WINDOW_CHARS,
  ADULT_OFF_GUARD_WINDOW_OVERLAP_CHARS,
  ADULT_OFF_CLASSIFIER_JSON_SCHEMA,
  ADULT_OFF_CLASSIFIER_SYSTEM_PROMPT,
  AdultOffClassifierCallError,
  buildAdultOffClassifierUserMessage,
  adultOffApprovedTextHash,
  evaluateAdultOffOutput,
  splitAdultOffGuardWindows,
  type AdultOffClassify,
  type AdultOffInspectionOutcome,
} from "@/lib/adultOffOutputGuard";
import {
  ADULT_OFF_CLASSIFIER_MAX_TOKENS,
  ADULT_OFF_CLASSIFIER_MODEL,
  type AdultOffClassifierTurnScope,
} from "@/lib/adultOffOutputClassifier";
import { hasMountedPersistentVolume } from "@/lib/dataDir";
import { ensureProviderCostLedgerSchema } from "@/lib/providerCostLedger";
import { resolveOpenRouterModelRates, type OpenRouterModelRates } from "@/lib/openRouterModelPricing";
import {
  ADULT_OFF_BATCH_MODERATION_REQUEST_KIND,
  adultOffGuardDecisionToInspectionOutcome,
  buildAdultOffBatchGenerationRequestId,
  commitAdultOffAuxSurveyItemIfFresh,
  commitAdultOffInspectionIfFresh,
  fingerprintAdultOffAuxSurveyItem,
  loadAssistantRowsForAdultOffInspection,
  planAdultOffBatchInspection,
  planAdultOffBatchInspectionSummary,
  readAdultOffBatchCallCost,
  readAdultOffBatchCallLedgerRows,
  readAdultOffBatchLedgerRows,
  summarizeAdultOffBatchLedgerRows,
  sumAdultOffBatchModerationSpend,
  surveyAdultOffAuxSurfaces,
  type AdultOffAuxSurfaceFingerprint,
  type AdultOffAuxTextItem,
  type AdultOffBatchModerationSpend,
  type AdultOffInspectionMessageRow,
  type AdultOffInspectionPlanItem,
} from "@/lib/adultOffBatchInspectionPrep";

export type AdultOffBatchMode = "plan" | "execute";

/** 창당 최소 예약 비용. 호출 직전에 실제 입력 크기와 공급자 단가로 계산한 상한과 비교해 큰 쪽을 쓴다. */
export const ADULT_OFF_BATCH_DEFAULT_RESERVE_KRW_PER_WINDOW = 0.45;
export const ADULT_OFF_BATCH_DEFAULT_USD_KRW = 1450;
const PLAN_DISPLAY_CAP_KRW = 1500;
const USD_TO_KRW_MARKUP = 1.02;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const POSITIVE_DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
const LIVE_PRODUCTION_DB_PATHS = ["/data/app.db"] as const;
const DEFAULT_VOLUME_ROOT = "/data";
/** 이보다 낮은 환율은 USD 실청구액을 원화로 과소계산할 수 있어 실행 전에 거부한다. */
export const ADULT_OFF_BATCH_MIN_USD_KRW = 1300;
export const ADULT_OFF_BATCH_MAX_USD_KRW = 3000;
/** 최근 원장에 기록된 최고 환율 대비 허용 하한 비율. */
const LEDGER_FX_FLOOR_RATIO = 0.95;
const APPROVED_RATES_PATTERN = /^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d{0,15}$/;
const EVENT_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
/** 다른 컨테이너의 잠금은 상태·잠금 파일이 이 시간 이상 변하지 않았을 때만 회수 후보가 된다. */
export const ADULT_OFF_BATCH_FOREIGN_LOCK_QUIESCENT_MS = 10 * 60 * 1000;
/**
 * 미정산 호출 격리 예약액이 가정하는 최소 캐시 쓰기 배율. 계정 카탈로그의 캐시 쓰기 단가는 입력 단가의 2.5배이며,
 * 코드 요율표의 1.25배보다 크다. 이 배율로 계산한 창 상한보다 작은 예약액은 받지 않는다.
 */
export const ADULT_OFF_BATCH_QUARANTINE_MIN_CACHE_WRITE_MULTIPLIER = 2.5;

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
  allowIsolatedPaid: boolean;
  /** 사용자가 읽고 승인한 공급자 모델 요율(입력/출력 USD per 1M). execute에서 필수. */
  approvedRates: { inputUsdPerM: number; outputUsdPerM: number } | null;
  /** 상태·잠금 위치가 마운트된 영구 볼륨 안에 있는지. 운영 DB의 paid execute는 이것이 true여야 한다. */
  statePersistent: boolean;
  stateVolumeRoot: string | null;
  /** 환경과 무관하게 계산된 상태 위치(실행 전에는 만들지 않는다). execute의 stateDir은 이 값이거나 테스트 이음새 값. */
  statePlacementDir: string;
  /** 이미 승인된 CAP보다 큰 CAP을 쓰려면 직전 승인 CAP 값을 그대로 적어야 한다. */
  capRaiseFromKrw: number | null;
  /** 판정 없이 끊긴 호출을 운영자가 확인했음을 나타내는 첫 요청 ID. */
  ackUnresolvedRequestId: string | null;
  /** 원장에 started·비용 미상으로 남은 호출 하나를 정확히 지목해 격리하는 일회성 승인. 4개 값이 모두 맞아야 한다. */
  quarantineUnconfirmed: AdultOffBatchQuarantineApproval | null;
  /** 다른 컨테이너가 남긴 잠금을 회수하는 일회성 승인. 잠금 파일의 4개 값이 정확히 같아야 한다. */
  reclaimForeignLock: AdultOffBatchForeignLockPin | null;
};

export type AdultOffBatchQuarantineApproval = {
  runId: string;
  requestId: string;
  eventKey: string;
  messageId: number;
};

export type AdultOffBatchForeignLockPin = {
  host: string;
  pid: number;
  runId: string;
  startedAt: string;
};

export type AdultOffBatchConfigOptions = {
  /** 테스트 전용 이음새. 운영 환경변수로는 상태 디렉터리를 바꿀 수 없다. */
  stateDir?: string;
  /** 테스트 전용 이음새. 기본은 /proc/self/mountinfo 기반 영구 볼륨 판정. */
  isMountedVolume?: (dir: string) => boolean;
};

export type AdultOffBatchStatePlacement = {
  stateDir: string;
  persistent: boolean;
  volumeRoot: string | null;
};

/**
 * 단일 state/lock 소유 위치. 영구 볼륨(/data 또는 RAILWAY_VOLUME_MOUNT_PATH)이 마운트돼 있으면
 * 그 안의 `private/adult-off-batch`, 아니면 개발·격리 호스트용 고정 사용자 위치.
 * 운영 DB의 paid execute는 앞의 경우만 허용한다.
 */
export function resolveAdultOffBatchStatePlacement(
  env: Readonly<Record<string, string | undefined>>,
  liveVolumeRoot: string | null,
  isMountedVolume: (dir: string) => boolean = hasMountedPersistentVolume
): AdultOffBatchStatePlacement {
  const volumeRoot = liveVolumeRoot ?? (env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || DEFAULT_VOLUME_ROOT);
  try {
    if (fs.existsSync(volumeRoot) && fs.statSync(volumeRoot).isDirectory()) {
      const realRoot = fs.realpathSync(volumeRoot);
      if (isMountedVolume(realRoot)) {
        return {
          stateDir: path.join(realRoot, "private", "adult-off-batch"),
          persistent: true,
          volumeRoot: realRoot,
        };
      }
    }
  } catch {
    // fall through to the non-persistent placement
  }
  return { stateDir: defaultAdultOffBatchStateDir(), persistent: false, volumeRoot: null };
}

/** 하나의 승인 배치가 공유하는 고정 상태 위치. 환경변수·HOME·TMPDIR에 영향을 받지 않는다. */
export function defaultAdultOffBatchStateDir(): string {
  return path.join(os.userInfo().homedir, ".hav-adult-off-batch");
}

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

/** 같은 파일(심볼릭 링크·상대 경로·hard link 포함)이 운영 볼륨 DB이면 그 볼륨 디렉터리를, 아니면 null. */
export function liveProductionVolumeRoot(dbPath: string, env: Env = process.env): string | null {
  const target = fs.statSync(dbPath);
  const targetReal = fs.realpathSync(dbPath);
  const candidates: string[] = [...LIVE_PRODUCTION_DB_PATHS];
  const volumeMount = env.RAILWAY_VOLUME_MOUNT_PATH?.trim();
  if (volumeMount) candidates.push(path.join(volumeMount, "app.db"));
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.dev === target.dev && stat.ino === target.ino) return path.dirname(candidate);
      if (fs.realpathSync(candidate) === targetReal) return path.dirname(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

export function isLiveProductionDatabase(dbPath: string, env: Env = process.env): boolean {
  return liveProductionVolumeRoot(dbPath, env) !== null;
}

function readEnvGroup(env: Env, names: readonly string[], code: string): string[] | null {
  const present = names.filter((name) => env[name] !== undefined);
  if (present.length === 0) return null;
  const values = names.map((name) => env[name]?.trim() ?? "");
  if (present.length !== names.length || values.some((value) => !value)) {
    throw new AdultOffBatchConfigError(code, `${names.join(", ")} must all be set, non-blank, and exact`);
  }
  return values;
}

function readQuarantineApproval(env: Env): AdultOffBatchQuarantineApproval | null {
  const code = "invalid_quarantine_unconfirmed";
  const group = readEnvGroup(
    env,
    [
      "ADULT_OFF_BATCH_QUARANTINE_RUN_ID",
      "ADULT_OFF_BATCH_QUARANTINE_REQUEST_ID",
      "ADULT_OFF_BATCH_QUARANTINE_EVENT_KEY",
      "ADULT_OFF_BATCH_QUARANTINE_MESSAGE_ID",
    ],
    code
  );
  if (!group) return null;
  const [runId, requestId, eventKey, messageId] = group;
  const requestMatch = /^adult-off-batch\/([^/]+)\/([1-9]\d{0,9})$/.exec(requestId);
  if (
    !RUN_ID_PATTERN.test(runId) ||
    !requestMatch ||
    requestMatch[1] !== runId ||
    !EVENT_KEY_PATTERN.test(eventKey) ||
    !POSITIVE_INTEGER_PATTERN.test(messageId)
  ) {
    throw new AdultOffBatchConfigError(
      code,
      "the quarantine approval must name RUN_ID, the exact adult-off-batch/<RUN_ID>/<seq> request id, the ledger event_key and the message id"
    );
  }
  return { runId, requestId, eventKey, messageId: Number(messageId) };
}

function readForeignLockPin(env: Env): AdultOffBatchForeignLockPin | null {
  const code = "invalid_reclaim_foreign_lock";
  const group = readEnvGroup(
    env,
    [
      "ADULT_OFF_BATCH_RECLAIM_LOCK_HOST",
      "ADULT_OFF_BATCH_RECLAIM_LOCK_PID",
      "ADULT_OFF_BATCH_RECLAIM_LOCK_RUN_ID",
      "ADULT_OFF_BATCH_RECLAIM_LOCK_STARTED_AT",
    ],
    code
  );
  if (!group) return null;
  const [host, pid, runId, startedAt] = group;
  if (!POSITIVE_INTEGER_PATTERN.test(pid) || !RUN_ID_PATTERN.test(runId) || !Number.isFinite(Date.parse(startedAt))) {
    throw new AdultOffBatchConfigError(
      code,
      "the lock reclaim approval must copy host, pid, run id and startedAt exactly from the inspected lock file"
    );
  }
  return { host, pid: Number(pid), runId, startedAt };
}

/**
 * 모든 환경변수·경로 검증을 DB를 열기 전에 끝낸다.
 * 실패하면 유료 호출도, DB 쓰기도, 상태 파일 쓰기도 일어나지 않는다.
 */
export function parseAdultOffBatchPaidRunConfig(
  env: Env,
  dbPath: string,
  options: AdultOffBatchConfigOptions = {}
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
    mode === "execute" ? null : ADULT_OFF_BATCH_DEFAULT_USD_KRW
  );
  if (fxKrwPerUsd < ADULT_OFF_BATCH_MIN_USD_KRW || fxKrwPerUsd > ADULT_OFF_BATCH_MAX_USD_KRW) {
    throw new AdultOffBatchConfigError(
      "usd_krw_out_of_range",
      `ADULT_OFF_BATCH_USD_KRW must be between ${ADULT_OFF_BATCH_MIN_USD_KRW} and ${ADULT_OFF_BATCH_MAX_USD_KRW}`
    );
  }
  const reservePerWindowKrw = readPositiveNumber(
    env,
    "ADULT_OFF_BATCH_RESERVE_KRW_PER_WINDOW",
    ADULT_OFF_BATCH_DEFAULT_RESERVE_KRW_PER_WINDOW
  );

  if (!fs.existsSync(dbPath) || !fs.statSync(dbPath).isFile()) {
    throw new AdultOffBatchConfigError("database_missing", "database file does not exist");
  }
  const dbRealPath = fs.realpathSync(dbPath);
  const liveVolumeRoot = liveProductionVolumeRoot(dbPath, env);
  const liveProductionDb = liveVolumeRoot !== null;
  const placement = resolveAdultOffBatchStatePlacement(env, liveVolumeRoot, options.isMountedVolume);
  let approvedRates: AdultOffBatchPaidRunConfig["approvedRates"] = null;
  const allowProdWrite = env.ADULT_OFF_BATCH_ALLOW_PROD_WRITE === "1";

  const capRaiseFromKrw =
    env.ADULT_OFF_BATCH_CAP_RAISE_FROM_KRW === undefined
      ? null
      : readPositiveNumber(env, "ADULT_OFF_BATCH_CAP_RAISE_FROM_KRW", null);
  const rawAck = env.ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID;
  const ackUnresolvedRequestId = rawAck === undefined ? null : rawAck.trim() || null;
  if (rawAck !== undefined && !ackUnresolvedRequestId) {
    throw new AdultOffBatchConfigError(
      "invalid_ack_unresolved_request_id",
      "ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID must not be blank"
    );
  }
  const quarantineUnconfirmed = readQuarantineApproval(env);
  const reclaimForeignLock = readForeignLockPin(env);
  const allowIsolatedPaid = env.ADULT_OFF_BATCH_ALLOW_ISOLATED_PAID === "1";

  if (env.ADULT_OFF_BATCH_STATE_DIR !== undefined) {
    throw new AdultOffBatchConfigError(
      "state_dir_not_configurable",
      "ADULT_OFF_BATCH_STATE_DIR is no longer supported; the batch budget, state and lock have one fixed owner"
    );
  }

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
    const rawRates = env.ADULT_OFF_BATCH_APPROVED_RATES;
    if (rawRates === undefined) {
      throw new AdultOffBatchConfigError(
        "missing_approved_rates",
        "ADULT_OFF_BATCH_APPROVED_RATES=<inputUsdPerM>/<outputUsdPerM> is required; copy it from the PLAN_ONLY report after checking the provider's current rates"
      );
    }
    const ratesMatch = APPROVED_RATES_PATTERN.exec(rawRates.trim());
    const inputRate = ratesMatch ? Number(ratesMatch[1]) : NaN;
    const outputRate = ratesMatch ? Number(ratesMatch[2]) : NaN;
    if (!(inputRate > 0) || !(outputRate > 0) || !Number.isFinite(inputRate) || !Number.isFinite(outputRate)) {
      throw new AdultOffBatchConfigError(
        "invalid_approved_rates",
        "ADULT_OFF_BATCH_APPROVED_RATES must look like 0.07/0.35 (finite positive numbers)"
      );
    }
    approvedRates = { inputUsdPerM: inputRate, outputUsdPerM: outputRate };
    stateDir = path.resolve(options.stateDir ?? placement.stateDir);
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
    if (liveProductionDb && !placement.persistent) {
      throw new AdultOffBatchConfigError(
        "persistent_state_volume_not_confirmed",
        "the batch state and lock must live on a mounted persistent volume (/data); no mounted volume was detected"
      );
    }
    if (!liveProductionDb && !allowIsolatedPaid) {
      throw new AdultOffBatchConfigError(
        "isolated_paid_not_a_completion_path",
        "paid classification of a non-production database spends the shared budget but its proofs cannot be applied to production; set ADULT_OFF_BATCH_ALLOW_ISOLATED_PAID=1 only for a deliberate rehearsal"
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
    allowIsolatedPaid,
    approvedRates,
    statePersistent: placement.persistent,
    stateVolumeRoot: placement.volumeRoot,
    statePlacementDir: placement.stateDir,
    capRaiseFromKrw,
    ackUnresolvedRequestId,
    quarantineUnconfirmed,
    reclaimForeignLock,
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
  return windowsOfText(text).length;
}

const REQUEST_OVERHEAD_BYTES = 512;
let staticRequestBytes: number | null = null;

function staticClassifierRequestBytes(): number {
  staticRequestBytes ??=
    Buffer.byteLength(ADULT_OFF_CLASSIFIER_SYSTEM_PROMPT, "utf8") +
    Buffer.byteLength(JSON.stringify(ADULT_OFF_CLASSIFIER_JSON_SCHEMA), "utf8") +
    REQUEST_OVERHEAD_BYTES;
  return staticRequestBytes;
}

/**
 * 다음 분류 호출 하나가 넘을 수 없는 비용(KRW) 상한.
 * 입력 토큰은 byte-level BPE가 바이트당 토큰 1개를 넘지 않는다는 점으로 상한을 잡고(요청 본문 UTF-8 바이트 수),
 * 출력은 공급자에 보내는 max_tokens로 막혀 있다. 입력 단가는 캐시 쓰기 배율이 있으면 그 쪽을 쓴다.
 * 설정된 창당 최소 예약보다 작아지지 않는다.
 */
export type AdultOffBatchPricing = Pick<AdultOffBatchPaidRunConfig, "fxKrwPerUsd" | "reservePerWindowKrw"> & {
  rates?: OpenRouterModelRates;
};

export function adultOffBatchWindowReserveKrw(
  windowText: string,
  pricing: AdultOffBatchPricing
): number {
  const rates = pricing.rates ?? resolveOpenRouterModelRates(ADULT_OFF_CLASSIFIER_MODEL);
  const inputBytes =
    staticClassifierRequestBytes() +
    Buffer.byteLength(buildAdultOffClassifierUserMessage(windowText), "utf8");
  const inputUsdPerToken = (rates.inputUsdPerM * Math.max(1, rates.cacheWriteMultiplier)) / 1_000_000;
  const outputUsdPerToken = rates.outputUsdPerM / 1_000_000;
  const usd = inputBytes * inputUsdPerToken + ADULT_OFF_CLASSIFIER_MAX_TOKENS * outputUsdPerToken;
  return Math.max(pricing.reservePerWindowKrw, adultOffUsdToKrw(usd, pricing.fxKrwPerUsd));
}

function windowsOfText(text: string): string[] {
  if (!text.trim()) return [];
  return splitAdultOffGuardWindows(text, ADULT_OFF_GUARD_WINDOW_CHARS, ADULT_OFF_GUARD_WINDOW_OVERLAP_CHARS);
}

/** 한 문자열의 모든 창을 끝까지 부르는 데 필요한 예약 상한 합계. */
function adultOffBatchTextReserveKrw(text: string, pricing: AdultOffBatchPricing): number {
  return windowsOfText(text).reduce(
    (sum, windowText) => sum + adultOffBatchWindowReserveKrw(windowText, pricing),
    0
  );
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
    /** 모든 대기 창을 입력 바이트 상한·max_tokens·공급자 단가로 계산한 이론상 최대치. 실제 지출은 이보다 훨씬 작다. */
    worstCaseBoundTotal: number;
    largestWindowBound: number;
    capKrw: number;
    reserveEstimateWithinCap: boolean;
    note: string;
  };
  ledgerSpendToDate: { settledKrw: number; unknownCostEvents: number; totalEvents: number } | null;
  /** 실제 유료 실행 직전에 공급자 요율을 사람이 다시 확인하고, 같은 값을 승인 변수로 되돌려 줘야 한다. */
  providerRates: {
    model: string;
    inputUsdPerM: number;
    outputUsdPerM: number;
    cacheWriteMultiplier: number;
    source: string;
    recheckBeforeExecute: true;
    approveWith: string;
  };
  usdKrw: { configured: number; allowedRange: [number, number]; note: string };
  batchState: {
    dir: string;
    persistentVolumeConfirmed: boolean;
    requiredForLiveDatabase: true;
    existing: {
      approvedCapKrw: number | null;
      settledKrw: number;
      pinnedUsdKrw: number | null;
      pinnedRatesMatchCurrent: boolean | null;
      unresolvedCall: boolean;
      halted: boolean;
    } | null;
    /** 격리 중인 미정산 호출. 같은 문자열 대상은 대기 목록에서 지워지지 않고 여기에 개수로 남는다. */
    quarantine: {
      requestId: string;
      messageId: number;
      reserveKrw: number;
      bodyItemsRemaining: number;
      auxItemsRemaining: number;
    } | null;
  };
};

/** 읽기 전용 DB 핸들에서만 쓴다. 유료 호출·DB 쓰기·상태 파일 쓰기 없음. */
export function buildAdultOffBatchPlanReport(
  db: DatabaseType,
  config: AdultOffBatchPaidRunConfig,
  resolveRates: (model: string) => OpenRouterModelRates = resolveOpenRouterModelRates
): AdultOffBatchPlanReport {
  const rates = resolveRates(ADULT_OFF_CLASSIFIER_MODEL);
  const rows = loadAssistantRowsForAdultOffInspection(db);
  const work = collectAdultOffBatchWork(db, rows, { buildAuxFingerprints: true });
  const reserveEstimate = work.pendingWindows * config.reservePerWindowKrw;
  let worstCaseBoundTotal = 0;
  let largestWindowBound = 0;
  for (const text of work.pendingTexts) {
    for (const windowText of windowsOfText(text)) {
      const bound = adultOffBatchWindowReserveKrw(windowText, { ...config, rates });
      worstCaseBoundTotal += bound;
      largestWindowBound = Math.max(largestWindowBound, bound);
    }
  }
  let ledgerSpendToDate: AdultOffBatchPlanReport["ledgerSpendToDate"] = null;
  const hasLedger = db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='api_cost_ledger'")
    .get();
  if (hasLedger) {
    const columns = new Set(
      (db.prepare("PRAGMA table_info(api_cost_ledger)").all() as Array<{ name: string }>).map(
        (column) => column.name
      )
    );
    if (columns.has("generation_request_id") && columns.has("actual_cost_usd")) {
      const spend = summarizeAdultOffBatchLedgerRows(readAdultOffBatchLedgerRows(db));
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
      worstCaseBoundTotal: Math.round(worstCaseBoundTotal * 100) / 100,
      largestWindowBound: Math.round(largestWindowBound * 100) / 100,
      capKrw: config.capKrw,
      reserveEstimateWithinCap: reserveEstimate <= config.capKrw,
      note: "reserveEstimate is an average-based estimate, not a maximum; execute starts a call only if spent-so-far plus that call's own worst-case bound fits the cap, stops when an actual cost exceeds its bound, and fails closed on unknown cost",
    },
    ledgerSpendToDate,
    providerRates: {
      model: ADULT_OFF_CLASSIFIER_MODEL,
      inputUsdPerM: rates.inputUsdPerM,
      outputUsdPerM: rates.outputUsdPerM,
      cacheWriteMultiplier: rates.cacheWriteMultiplier,
      source:
        "repository rate table (resolveOpenRouterModelRates); the live provider catalog is NOT consulted by this process",
      recheckBeforeExecute: true,
      approveWith: `ADULT_OFF_BATCH_APPROVED_RATES=${rates.inputUsdPerM}/${rates.outputUsdPerM}`,
    },
    usdKrw: {
      configured: config.fxKrwPerUsd,
      allowedRange: [ADULT_OFF_BATCH_MIN_USD_KRW, ADULT_OFF_BATCH_MAX_USD_KRW],
      note: "execute needs an explicit conservative ADULT_OFF_BATCH_USD_KRW; it is pinned on the first execute and cannot be changed afterwards",
    },
    batchState: {
      dir: config.stateDir ?? config.statePlacementDir,
      persistentVolumeConfirmed: config.statePersistent,
      requiredForLiveDatabase: true,
      existing: readExistingBatchState(config.stateDir ?? config.statePlacementDir, rates),
      quarantine: readPlanQuarantine(config.stateDir ?? config.statePlacementDir, work),
    },
  };
}

function readExistingBatchState(
  stateDir: string,
  rates: OpenRouterModelRates
): AdultOffBatchPlanReport["batchState"]["existing"] {
  if (!fs.existsSync(batchStatePath(stateDir))) return null;
  try {
    const state = loadAdultOffBatchState(stateDir);
    return {
      approvedCapKrw: state.approvedCapKrw,
      settledKrw: state.settledKrw,
      pinnedUsdKrw: state.fxKrwPerUsd,
      pinnedRatesMatchCurrent: state.providerRates
        ? sameRates(state.providerRates, pinnedRatesOf(rates))
        : null,
      unresolvedCall: state.unresolved !== null || state.inFlight !== null,
      halted: state.halted !== null,
    };
  } catch {
    return null;
  }
}

function readPlanQuarantine(
  stateDir: string,
  work: AdultOffBatchWork
): AdultOffBatchPlanReport["batchState"]["quarantine"] {
  if (!fs.existsSync(batchStatePath(stateDir))) return null;
  try {
    const held = loadAdultOffBatchState(stateDir).unresolved?.quarantine;
    if (!held) return null;
    const hashes = new Set(held.textHashes);
    return {
      requestId: held.requestId,
      messageId: held.messageId,
      reserveKrw: held.reserveKrw,
      bodyItemsRemaining: work.bodyItems.filter((item) => hashes.has(adultOffApprovedTextHash(item.target.text))).length,
      auxItemsRemaining: work.auxItems.filter((aux) => aux.texts.some((text) => hashes.has(adultOffApprovedTextHash(text))))
        .length,
    };
  } catch {
    return null;
  }
}

export type AdultOffBatchPinnedRates = {
  inputUsdPerM: number;
  outputUsdPerM: number;
  cacheWriteMultiplier: number;
};

export type AdultOffBatchInFlight = {
  messageId: number;
  surface: "body" | "aux";
  requestIds: string[];
  openRequestId: string | null;
  reservedKrw: number;
};

/**
 * 원장에 started·비용 미상으로 남은 호출 하나를 운영자가 정확히 지목해 격리한 기록.
 * 비용이 확정되기 전에는 `reserveKrw`가 실제 비용 대신 예산에 잡히고, 같은 문자열은 어느 메시지에서도 다시 분류하지 않는다.
 */
export type AdultOffBatchQuarantine = {
  runId: string;
  requestId: string;
  eventKey: string;
  messageId: number;
  surface: "body" | "aux";
  textHashes: string[];
  reserveKrw: number;
  at: string;
};

export type AdultOffBatchUnresolved = {
  messageId: number;
  surface: "body" | "aux";
  requestIds: string[];
  at: string;
  quarantine: AdultOffBatchQuarantine | null;
};

/**
 * 승인된 배치 하나가 갖는 단일 예산·상태. RUN_ID는 추적용 라벨일 뿐 예산을 나누지 않는다.
 * 고정 위치의 파일 하나 + 같은 위치의 전역 잠금 하나 + 각 DB의 기존 원장(하한)으로 구성된다.
 */
export type AdultOffBatchState = {
  version: 2;
  settledKrw: number;
  maxObservedWindowKrw: number;
  callCount: number;
  nextCallSeq: number;
  approvedCapKrw: number | null;
  /** 첫 execute가 고정한 환율. 이후 다른 값으로 지출을 다시 계산할 수 없다. */
  fxKrwPerUsd: number | null;
  /** 첫 execute가 고정한 공급자 모델 요율. 바뀌면 STOP. */
  providerRates: AdultOffBatchPinnedRates | null;
  runIds: string[];
  paidDatabases: Array<{ realPath: string; liveProductionDb: boolean }>;
  /** 분류 호출이 시작된 뒤 판정이 DB에 commit되기 전까지만 남는다. 남아 있으면 판정 미확정이다. */
  inFlight: AdultOffBatchInFlight | null;
  /** 이전 실행이 판정 없이 끊긴 흔적. 운영자 확인 전에는 자동 재분류하지 않는다. */
  unresolved: AdultOffBatchUnresolved | null;
  halted: { reason: string; detail: string; at: string } | null;
  updatedAt: string;
};

const MAX_RECORDED_RUN_IDS = 50;

function emptyBatchState(): AdultOffBatchState {
  return {
    version: 2,
    settledKrw: 0,
    maxObservedWindowKrw: 0,
    callCount: 0,
    nextCallSeq: 1,
    approvedCapKrw: null,
    fxKrwPerUsd: null,
    providerRates: null,
    runIds: [],
    paidDatabases: [],
    inFlight: null,
    unresolved: null,
    halted: null,
    updatedAt: new Date(0).toISOString(),
  };
}

function batchStatePath(stateDir: string): string {
  return path.join(stateDir, "batch.state.json");
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

export type AdultOffBatchLockOptions = {
  /** 다른 컨테이너가 남긴 잠금 하나를 회수하는 일회성 승인. 없으면 같은 호스트의 죽은 PID 잠금만 회수한다. */
  foreignLockPin?: AdultOffBatchForeignLockPin | null;
  /** 테스트 이음새: 정지 시간 판정에 쓰는 현재 시각(ms). */
  now?: () => number;
};

type LockHolder = { pid?: unknown; host?: unknown; runId?: unknown; startedAt?: unknown; deploymentId?: unknown };

function lockReclaimGuardPath(stateDir: string): string {
  return path.join(stateDir, "execution.lock.reclaim");
}

function refuseLocked(detail: string): AdultOffBatchRunRefusedError {
  return new AdultOffBatchRunRefusedError("concurrent_run_locked", detail);
}

function isForeignLockApproved(
  stateDir: string,
  holder: LockHolder,
  lockMtimeMs: number,
  options: AdultOffBatchLockOptions
): boolean {
  const pin = options.foreignLockPin;
  if (!pin) return false;
  if (
    holder.host !== pin.host ||
    holder.pid !== pin.pid ||
    holder.runId !== pin.runId ||
    holder.startedAt !== pin.startedAt
  ) {
    return false;
  }
  const currentDeployment = process.env.RAILWAY_DEPLOYMENT_ID?.trim();
  if (currentDeployment && holder.deploymentId === currentDeployment) return false;
  const now = (options.now ?? Date.now)();
  let latestChangeMs = lockMtimeMs;
  try {
    latestChangeMs = Math.max(latestChangeMs, fs.statSync(batchStatePath(stateDir)).mtimeMs);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
  }
  return now - latestChangeMs >= ADULT_OFF_BATCH_FOREIGN_LOCK_QUIESCENT_MS;
}

/**
 * 기존 잠금 하나를 치우는 유일한 경로. 회수 보호 파일(wx)을 쥔 프로세스 하나만 진행하고,
 * 읽은 잠금의 inode가 치운 파일과 같은지 확인한 뒤에만 tombstone으로 옮긴다(삭제하지 않는다).
 * 회수 조건이 아니면 항상 거부한다.
 */
function reclaimExistingLock(stateDir: string, options: AdultOffBatchLockOptions): void {
  const file = lockPath(stateDir);
  const guardFile = lockReclaimGuardPath(stateDir);
  let guardFd: number;
  try {
    guardFd = fs.openSync(guardFile, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw refuseLocked("another process is reclaiming the execution lock");
    }
    throw error;
  }
  try {
    fs.writeSync(guardFd, JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString() }));
    let before: fs.Stats;
    let raw: string;
    try {
      before = fs.lstatSync(file);
      raw = fs.readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    let holder: LockHolder = {};
    try {
      holder = JSON.parse(raw) as LockHolder;
    } catch {
      holder = {};
    }
    const sameHostDead =
      holder.host === os.hostname() && typeof holder.pid === "number" && !isProcessAlive(holder.pid);
    const foreignApproved =
      holder.host !== os.hostname() && isForeignLockApproved(stateDir, holder, before.mtimeMs, options);
    if (!sameHostDead && !foreignApproved) {
      throw refuseLocked(
        `another adult-off batch execution holds the lock (run ${typeof holder.runId === "string" ? holder.runId : "unknown"})`
      );
    }
    const tombstone = `${file}.reclaimed.${Date.now()}.${process.pid}`;
    try {
      fs.renameSync(file, tombstone);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const moved = fs.lstatSync(tombstone);
    if (moved.ino !== before.ino || moved.dev !== before.dev) {
      try {
        fs.linkSync(tombstone, file);
        fs.unlinkSync(tombstone);
      } catch {
        // the lock path was taken again; the moved file stays as the tombstone for inspection
      }
      throw refuseLocked("the execution lock changed while it was being reclaimed");
    }
  } finally {
    fs.closeSync(guardFd);
    fs.rmSync(guardFile, { force: true });
  }
}

/**
 * 고정 상태 위치 하나에 대한 전역 실행 잠금. RUN_ID가 같든 다르든 동시에 하나만 돈다.
 * 같은 호스트에서 죽은 PID의 잠금, 또는 운영자가 4개 값을 정확히 지목하고 상태가 정지돼 있는 다른 컨테이너의 잠금만
 * 단 하나의 회수 경로(`reclaimExistingLock`)로 치운다. 그 외에는 사람이 확인할 때까지 거부한다.
 */
export function acquireAdultOffBatchExecutionLock(
  stateDir: string,
  runId: string,
  options: AdultOffBatchLockOptions = {}
): AdultOffBatchExecutionLock {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = lockPath(stateDir);
  const body = JSON.stringify({
    pid: process.pid,
    host: os.hostname(),
    runId,
    startedAt: new Date().toISOString(),
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID?.trim() || null,
  });
  const tryCreate = (): AdultOffBatchExecutionLock | null => {
    try {
      const fd = fs.openSync(file, "wx", 0o600);
      try {
        fs.writeSync(fd, body);
      } finally {
        fs.closeSync(fd);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
      throw error;
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
  };
  const created = tryCreate();
  if (created) return created;
  reclaimExistingLock(stateDir, options);
  const reclaimed = tryCreate();
  if (reclaimed) return reclaimed;
  throw refuseLocked("could not acquire execution lock");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseCallMarker<T extends { messageId: number; surface: "body" | "aux"; requestIds: string[] }>(
  value: unknown
): T | null {
  if (value == null) return null;
  const record = value as Partial<T>;
  if (
    typeof record.messageId !== "number" ||
    (record.surface !== "body" && record.surface !== "aux") ||
    !isStringArray(record.requestIds)
  ) {
    throw new AdultOffBatchRunRefusedError("state_invalid", "batch state call marker failed validation");
  }
  return value as T;
}

function parseQuarantine(value: unknown): AdultOffBatchQuarantine | null {
  if (value == null) return null;
  const record = value as Partial<AdultOffBatchQuarantine>;
  if (
    typeof record.runId !== "string" ||
    typeof record.requestId !== "string" ||
    typeof record.eventKey !== "string" ||
    typeof record.messageId !== "number" ||
    (record.surface !== "body" && record.surface !== "aux") ||
    !isStringArray(record.textHashes) ||
    typeof record.reserveKrw !== "number" ||
    !Number.isFinite(record.reserveKrw) ||
    record.reserveKrw <= 0 ||
    typeof record.at !== "string"
  ) {
    throw new AdultOffBatchRunRefusedError("state_invalid", "batch state quarantine record failed validation");
  }
  return {
    runId: record.runId,
    requestId: record.requestId,
    eventKey: record.eventKey,
    messageId: record.messageId,
    surface: record.surface,
    textHashes: record.textHashes,
    reserveKrw: record.reserveKrw,
    at: record.at,
  };
}

function parseRates(value: unknown): AdultOffBatchPinnedRates | null {
  if (value == null) return null;
  const record = value as Partial<AdultOffBatchPinnedRates>;
  const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  if (
    !positive(record.inputUsdPerM) ||
    !positive(record.outputUsdPerM) ||
    !positive(record.cacheWriteMultiplier)
  ) {
    throw new AdultOffBatchRunRefusedError("state_invalid", "batch state provider rates failed validation");
  }
  return {
    inputUsdPerM: record.inputUsdPerM,
    outputUsdPerM: record.outputUsdPerM,
    cacheWriteMultiplier: record.cacheWriteMultiplier,
  };
}

function pinnedRatesOf(rates: OpenRouterModelRates): AdultOffBatchPinnedRates {
  return {
    inputUsdPerM: rates.inputUsdPerM,
    outputUsdPerM: rates.outputUsdPerM,
    cacheWriteMultiplier: rates.cacheWriteMultiplier,
  };
}

function sameRates(a: AdultOffBatchPinnedRates, b: AdultOffBatchPinnedRates): boolean {
  return (
    a.inputUsdPerM === b.inputUsdPerM &&
    a.outputUsdPerM === b.outputUsdPerM &&
    a.cacheWriteMultiplier === b.cacheWriteMultiplier
  );
}

/** 상태·잠금 디렉터리가 현재 사용자 소유의 비공개(0700) 실제 디렉터리이고, 영구 볼륨 안에 있는지 확인한다. */
export function prepareAdultOffBatchStateDir(stateDir: string, volumeRoot: string | null): void {
  const unsafe = (detail: string): AdultOffBatchRunRefusedError =>
    new AdultOffBatchRunRefusedError("state_dir_unsafe", `batch state directory is not safe: ${detail}`);
  const insideVolume = (candidate: string): boolean =>
    !volumeRoot || candidate === volumeRoot || candidate.startsWith(volumeRoot + path.sep);
  let existingAncestor = stateDir;
  while (!fs.existsSync(existingAncestor)) existingAncestor = path.dirname(existingAncestor);
  if (!insideVolume(fs.realpathSync(existingAncestor))) throw unsafe("resolves outside the persistent volume");
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(stateDir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafe("not a plain directory");
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && stat.uid !== uid) throw unsafe("owned by another user");
  if ((stat.mode & 0o077) !== 0) {
    fs.chmodSync(stateDir, 0o700);
    if ((fs.lstatSync(stateDir).mode & 0o077) !== 0) throw unsafe("group/world accessible");
  }
  if (!insideVolume(fs.realpathSync(stateDir))) throw unsafe("resolves outside the persistent volume");
}

export function loadAdultOffBatchState(stateDir: string): AdultOffBatchState {
  const file = batchStatePath(stateDir);
  if (!fs.existsSync(file)) return emptyBatchState();
  let parsed: Partial<AdultOffBatchState>;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AdultOffBatchState>;
  } catch {
    throw new AdultOffBatchRunRefusedError("state_unreadable", "batch state file is not valid JSON");
  }
  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0;
  if (
    parsed.version !== 2 ||
    !finite(parsed.settledKrw) ||
    !finite(parsed.maxObservedWindowKrw) ||
    !finite(parsed.callCount) ||
    !finite(parsed.nextCallSeq) ||
    !(parsed.approvedCapKrw === null || finite(parsed.approvedCapKrw)) ||
    !(parsed.fxKrwPerUsd == null || (finite(parsed.fxKrwPerUsd) && parsed.fxKrwPerUsd > 0)) ||
    !isStringArray(parsed.runIds) ||
    !Array.isArray(parsed.paidDatabases)
  ) {
    throw new AdultOffBatchRunRefusedError("state_invalid", "batch state file failed validation");
  }
  const inFlight = parseCallMarker<AdultOffBatchInFlight>(parsed.inFlight);
  const unresolvedMarker = parseCallMarker<Omit<AdultOffBatchUnresolved, "quarantine">>(parsed.unresolved);
  const unresolved: AdultOffBatchUnresolved | null = unresolvedMarker
    ? {
        ...unresolvedMarker,
        quarantine: parseQuarantine((parsed.unresolved as { quarantine?: unknown }).quarantine),
      }
    : null;
  return {
    version: 2,
    settledKrw: parsed.settledKrw,
    maxObservedWindowKrw: parsed.maxObservedWindowKrw,
    callCount: parsed.callCount,
    nextCallSeq: parsed.nextCallSeq,
    approvedCapKrw: parsed.approvedCapKrw,
    fxKrwPerUsd: parsed.fxKrwPerUsd ?? null,
    providerRates: parseRates(parsed.providerRates),
    runIds: parsed.runIds,
    paidDatabases: parsed.paidDatabases,
    inFlight,
    unresolved,
    halted: parsed.halted ?? null,
    updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
  };
}

function saveAdultOffBatchState(stateDir: string, state: AdultOffBatchState): void {
  const file = batchStatePath(stateDir);
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
  | "quarantine_pending"
  | "cap_reached"
  | "halted_unknown_cost"
  | "halted_classifier_error"
  | "halted_cost_exceeds_bound";

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
    /** 격리된 미정산 호출이 실제 비용 대신 예산에 잡고 있는 예약액. 비용이 확정되면 0이 된다. */
    heldQuarantineReserveKrw: number;
  };
  /** 아직 비용이 확정되지 않아 격리 중인 호출. 있으면 배치는 끝난 것이 아니다. */
  quarantine: {
    requestId: string;
    eventKey: string;
    messageId: number;
    reserveKrw: number;
    textHashes: number;
  } | null;
  body: {
    classifiedTexts: number;
    reusedStoredTexts: number;
    written: number;
    writtenVariantIsolated: number;
    skippedStale: number;
    skippedNoop: number;
    skippedUnresolved: number;
    quarantinedSkipped: number;
  };
  aux: {
    classifiedTexts: number;
    written: number;
    skippedStale: number;
    skippedNoop: number;
    skippedUnresolved: number;
    quarantinedSkipped: number;
    notApproved: number;
    fingerprintMissing: number;
  };
  halted: AdultOffBatchState["halted"];
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
  /** 테스트 이음새: 공급자 요율 조회. 기본은 저장소의 단일 요율 owner. */
  resolveRates?: (model: string) => OpenRouterModelRates;
};

/**
 * 유료 분류 + 원자 commit 실행기. 설정 검증이 끝난 execute 설정만 받는다.
 * 순서: 전역 잠금 → 공유 상태 복원·CAP 정책 → DB open → 끊긴 호출 확인 → 원장 하한 → 작업 목록·fingerprint 고정
 * → 호출 직전 예산 게이트(지출 + 그 호출의 상한 ≤ CAP).
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
  prepareAdultOffBatchStateDir(stateDir, config.statePersistent ? config.stateVolumeRoot : null);
  const lock = acquireAdultOffBatchExecutionLock(stateDir, runId, { foreignLockPin: config.reclaimForeignLock });
  let db: DatabaseType | null = null;
  try {
    const state = loadAdultOffBatchState(stateDir);
    if (state.halted) {
      throw new AdultOffBatchRunRefusedError(
        "batch_halted",
        `the approved batch is halted (${state.halted.reason}); a new RUN_ID does not clear it, investigate first`
      );
    }
    const rates = (input.resolveRates ?? resolveOpenRouterModelRates)(ADULT_OFF_CLASSIFIER_MODEL);
    const currentRates = pinnedRatesOf(rates);
    const approvedRates = config.approvedRates;
    if (
      !approvedRates ||
      approvedRates.inputUsdPerM !== currentRates.inputUsdPerM ||
      approvedRates.outputUsdPerM !== currentRates.outputUsdPerM
    ) {
      throw new AdultOffBatchRunRefusedError(
        "provider_rates_not_approved",
        `current ${ADULT_OFF_CLASSIFIER_MODEL} rates are ${currentRates.inputUsdPerM}/${currentRates.outputUsdPerM} USD per 1M; ` +
          "the approved rates do not match, so the cost bound cannot be trusted"
      );
    }
    if (state.providerRates && !sameRates(state.providerRates, currentRates)) {
      throw new AdultOffBatchRunRefusedError(
        "provider_rates_changed",
        "provider rates differ from the ones pinned for this approved batch; STOP and re-approve the whole batch"
      );
    }
    if (state.fxKrwPerUsd != null && state.fxKrwPerUsd !== config.fxKrwPerUsd) {
      throw new AdultOffBatchRunRefusedError(
        "usd_krw_changed",
        `this batch is pinned to ${state.fxKrwPerUsd} KRW per USD; a different rate cannot be used to recompute spend`
      );
    }
    const approvedCap = state.approvedCapKrw;
    if (approvedCap != null && config.capKrw > approvedCap && config.capRaiseFromKrw !== approvedCap) {
      throw new AdultOffBatchRunRefusedError(
        "cap_increase_not_approved",
        `approved cap is ${approvedCap} KRW; raising it needs ADULT_OFF_BATCH_CAP_RAISE_FROM_KRW=${approvedCap}`
      );
    }

    db = input.openDatabase();
    db.pragma("busy_timeout = 5000");
    const database = db;
    ensureProviderCostLedgerSchema(database);
    const ledgerFx = (
      database
        .prepare(
          "SELECT MAX(exchange_rate_krw_per_usd) AS fx FROM api_cost_ledger WHERE datetime(created_at) >= datetime('now', '-30 days')"
        )
        .get() as { fx: number | null } | undefined
    )?.fx;
    if (typeof ledgerFx === "number" && ledgerFx > 0 && config.fxKrwPerUsd < ledgerFx * LEDGER_FX_FLOOR_RATIO) {
      throw new AdultOffBatchRunRefusedError(
        "usd_krw_below_ledger_rate",
        `ADULT_OFF_BATCH_USD_KRW=${config.fxKrwPerUsd} is more than ${Math.round((1 - LEDGER_FX_FLOOR_RATIO) * 100)}% below the recent ledger rate ${ledgerFx}`
      );
    }
    const pricing: AdultOffBatchPricing = { ...config, rates };
    const halt = (reason: AdultOffBatchStopReason, detail: string): void => {
      state.halted = { reason, detail: detail.slice(0, 300), at: new Date().toISOString() };
      saveAdultOffBatchState(stateDir, state);
    };
    const isCallCostKnown = (cost: AdultOffBatchModerationSpend): boolean =>
      cost.totalEvents > 0 && cost.unknownCostEvents === 0 && cost.settledUsd > 0;
    const settleCall = (requestId: string, reservedKrw: number, callError: unknown): void => {
      const cost = readAdultOffBatchCallCost(database, requestId);
      if (!isCallCostKnown(cost)) {
        halt("halted_unknown_cost", `call ${requestId}: ledger cost unknown (events=${cost.totalEvents})`);
        return;
      }
      const costKrw = adultOffUsdToKrw(cost.settledUsd, config.fxKrwPerUsd);
      state.settledKrw += costKrw;
      state.maxObservedWindowKrw = Math.max(state.maxObservedWindowKrw, costKrw);
      state.callCount += 1;
      if (state.inFlight?.openRequestId === requestId) state.inFlight.openRequestId = null;
      saveAdultOffBatchState(stateDir, state);
      if (costKrw > reservedKrw) {
        halt(
          "halted_cost_exceeds_bound",
          `call ${requestId}: actual ${costKrw.toFixed(4)} KRW exceeded its ${reservedKrw.toFixed(4)} KRW bound`
        );
        return;
      }
      const benign =
        callError instanceof AdultOffClassifierCallError && callError.outcome === "invalid_output";
      if (callError && !benign) {
        halt("halted_classifier_error", `call ${requestId}: ${(callError as Error).message ?? "error"}`);
      }
    };

    const rows = loadAssistantRowsForAdultOffInspection(database);
    const work = collectAdultOffBatchWork(database, rows, { buildAuxFingerprints: true });

    /**
     * 비용이 확정되지 않은 호출은 운영자가 4개 식별값을 정확히 지목하고 원장 행이 그와 일치할 때만 격리한다.
     * 격리해도 원장 행은 건드리지 않고, 예약액은 호출 당시 상한과 증명된 창 상한 중 큰 값이다.
     */
    const quarantineInterruptedCall = (interrupted: AdultOffBatchInFlight, requestId: string): AdultOffBatchQuarantine => {
      const approval = config.quarantineUnconfirmed;
      if (!approval) {
        throw new AdultOffBatchRunRefusedError(
          "interrupted_call_cost_unknown",
          `call ${requestId} was interrupted and its cost cannot be confirmed from the ledger; ` +
            "nothing was changed. Only an explicit ADULT_OFF_BATCH_QUARANTINE_* approval naming this exact call can isolate it"
        );
      }
      const mismatch = (detail: string): AdultOffBatchRunRefusedError =>
        new AdultOffBatchRunRefusedError("quarantine_approval_mismatch", `quarantine approval refused: ${detail}`);
      if (
        approval.requestId !== requestId ||
        approval.messageId !== interrupted.messageId ||
        !state.runIds.includes(approval.runId)
      ) {
        throw mismatch("the approved run, request id and message id do not match the interrupted call");
      }
      const ledgerRows = readAdultOffBatchCallLedgerRows(database, requestId);
      const row = ledgerRows.length === 1 ? ledgerRows[0] : null;
      if (
        !row ||
        row.event_key !== approval.eventKey ||
        row.assistant_message_id !== approval.messageId ||
        row.event_status !== "started" ||
        row.provider_request_id != null ||
        row.actual_cost_usd != null
      ) {
        throw mismatch("the ledger row is not exactly one started, cost-less, provider-id-less event with the approved event_key and message id");
      }
      const texts =
        interrupted.surface === "body"
          ? work.bodyItems.filter((item) => item.target.messageId === interrupted.messageId).map((item) => item.target.text)
          : work.auxItems.filter((aux) => aux.item.messageId === interrupted.messageId).flatMap((aux) => aux.texts);
      if (texts.length === 0) throw mismatch("the interrupted target text is no longer a pending classification target");
      const provenRates: OpenRouterModelRates = {
        ...rates,
        cacheWriteMultiplier: Math.max(
          rates.cacheWriteMultiplier,
          ADULT_OFF_BATCH_QUARANTINE_MIN_CACHE_WRITE_MULTIPLIER
        ),
      };
      const windowBound = Math.max(
        ...texts.flatMap((text) =>
          windowsOfText(text).map((windowText) =>
            adultOffBatchWindowReserveKrw(windowText, { ...pricing, rates: provenRates })
          )
        )
      );
      return {
        runId: approval.runId,
        requestId,
        eventKey: approval.eventKey,
        messageId: approval.messageId,
        surface: interrupted.surface,
        textHashes: [...new Set(texts.map((text) => adultOffApprovedTextHash(text)))],
        reserveKrw: Math.max(interrupted.reservedKrw, windowBound),
        at: new Date().toISOString(),
      };
    };

    /** 확정된 격리 호출은 예약액을 실제 비용으로 바꾸고, 판정 없이 끝난 호출은 ACK 없이는 다시 분류하지 않는다. */
    const reconcileUnresolved = (): void => {
      if (state.unresolved?.quarantine) {
        const held = state.unresolved.quarantine;
        if (isCallCostKnown(readAdultOffBatchCallCost(database, held.requestId))) {
          settleCall(held.requestId, held.reserveKrw, null);
          state.unresolved.quarantine = null;
          saveAdultOffBatchState(stateDir, state);
          if (state.halted) {
            throw new AdultOffBatchRunRefusedError(
              "quarantine_cost_exceeds_reserve",
              `the confirmed cost of ${held.requestId} exceeded its ${held.reserveKrw.toFixed(4)} KRW reserve; STOP and re-evaluate the budget`
            );
          }
        }
      }
      if (state.unresolved && !state.unresolved.quarantine) {
        const firstId = state.unresolved.requestIds[0] ?? "";
        if (!firstId || config.ackUnresolvedRequestId !== firstId) {
          throw new AdultOffBatchRunRefusedError(
            "interrupted_call_unresolved",
            `a paid call (${state.unresolved.requestIds.join(", ")}) finished or was cut off without a stored verdict; ` +
              `its cost is counted, but the same text would be paid for again. Inspect message ${state.unresolved.messageId} ` +
              `and re-run with ADULT_OFF_BATCH_ACK_UNRESOLVED_REQUEST_ID=${firstId} to accept one re-classification`
          );
        }
        state.unresolved = null;
      }
    };

    reconcileUnresolved();
    if (state.inFlight) {
      if (state.unresolved?.quarantine) {
        throw new AdultOffBatchRunRefusedError(
          "interrupted_call_while_quarantined",
          `another call was interrupted while ${state.unresolved.quarantine.requestId} is still quarantined; ` +
            "nothing was changed. Resolve the quarantined call's billing first"
        );
      }
      const interrupted = state.inFlight;
      const openRequestId = interrupted.openRequestId;
      let quarantine: AdultOffBatchQuarantine | null = null;
      if (openRequestId) {
        if (isCallCostKnown(readAdultOffBatchCallCost(database, openRequestId))) {
          settleCall(openRequestId, Number.POSITIVE_INFINITY, null);
        } else {
          quarantine = quarantineInterruptedCall(interrupted, openRequestId);
        }
      }
      state.unresolved = {
        messageId: interrupted.messageId,
        surface: interrupted.surface,
        requestIds: interrupted.requestIds,
        at: new Date().toISOString(),
        quarantine,
      };
      state.inFlight = null;
      saveAdultOffBatchState(stateDir, state);
      reconcileUnresolved();
    }
    const heldQuarantine = state.unresolved?.quarantine ?? null;
    const heldReserveKrw = heldQuarantine?.reserveKrw ?? 0;
    const quarantinedHashes = new Set(heldQuarantine?.textHashes ?? []);

    const priorSpend = sumAdultOffBatchModerationSpend(
      database,
      heldQuarantine ? { requestId: heldQuarantine.requestId, eventKey: heldQuarantine.eventKey } : null
    );
    if (priorSpend.unknownCostEvents > 0) {
      halt("halted_unknown_cost", `ledger has ${priorSpend.unknownCostEvents} unknown-cost batch events`);
      throw new AdultOffBatchRunRefusedError(
        "ledger_unknown_cost",
        "ledger contains batch moderation events with unknown cost"
      );
    }
    state.settledKrw = Math.max(
      state.settledKrw,
      adultOffUsdToKrw(priorSpend.settledUsd, config.fxKrwPerUsd)
    );
    state.nextCallSeq = Math.max(state.nextCallSeq, priorSpend.maxCallSeq + 1);
    state.approvedCapKrw = config.capKrw;
    state.fxKrwPerUsd = config.fxKrwPerUsd;
    state.providerRates = currentRates;
    if (!state.runIds.includes(runId)) {
      state.runIds = [...state.runIds, runId].slice(-MAX_RECORDED_RUN_IDS);
    }
    saveAdultOffBatchState(stateDir, state);
    const settledKrwAtStart = state.settledKrw;

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
        heldQuarantineReserveKrw: heldReserveKrw,
      },
      quarantine: heldQuarantine && {
        requestId: heldQuarantine.requestId,
        eventKey: heldQuarantine.eventKey,
        messageId: heldQuarantine.messageId,
        reserveKrw: heldQuarantine.reserveKrw,
        textHashes: heldQuarantine.textHashes.length,
      },
      body: {
        classifiedTexts: 0,
        reusedStoredTexts: 0,
        written: 0,
        writtenVariantIsolated: 0,
        skippedStale: 0,
        skippedNoop: 0,
        skippedUnresolved: 0,
        quarantinedSkipped: 0,
      },
      aux: {
        classifiedTexts: 0,
        written: 0,
        skippedStale: 0,
        skippedNoop: 0,
        skippedUnresolved: 0,
        quarantinedSkipped: 0,
        notApproved: 0,
        fingerprintMissing: 0,
      },
      halted: null,
    };

    const outcomeByText = new Map<string, AdultOffInspectionOutcome>();
    let stopReason: AdultOffBatchStopReason | null = null;
    let capSignalRaised = false;
    let callsThisRun = 0;
    let unit: { messageId: number; surface: "body" | "aux" } | null = null;

    const haltedReason = (): AdultOffBatchStopReason | null =>
      state.halted ? (state.halted.reason as AdultOffBatchStopReason) : null;

    const beginUnit = (messageId: number, surface: "body" | "aux"): void => {
      unit = { messageId, surface };
    };
    /** 판정이 commit까지 끝난 뒤에만 in-flight 표식을 지운다. */
    const endUnit = (): void => {
      unit = null;
      if (state.inFlight && !state.halted) {
        state.inFlight = null;
        saveAdultOffBatchState(stateDir, state);
      }
    };

    const gatedClassifier =
      (chatId: number, assistantMessageId: number): AdultOffClassify =>
      async (windowText) => {
        const reason = haltedReason();
        if (reason) throw new BatchStopSignal(reason);
        const reservedKrw = adultOffBatchWindowReserveKrw(windowText, pricing);
        if (state.settledKrw + heldReserveKrw + reservedKrw > config.capKrw) {
          capSignalRaised = true;
          throw new BatchStopSignal("cap_reached");
        }
        if (!unit) throw new Error("adult-off batch call started outside a work unit");
        const requestId = buildAdultOffBatchGenerationRequestId(runId, state.nextCallSeq);
        state.nextCallSeq += 1;
        callsThisRun += 1;
        state.inFlight ??= {
          messageId: unit.messageId,
          surface: unit.surface,
          requestIds: [],
          openRequestId: null,
          reservedKrw: 0,
        };
        state.inFlight.requestIds.push(requestId);
        state.inFlight.openRequestId = requestId;
        state.inFlight.reservedKrw = reservedKrw;
        if (!state.paidDatabases.some((entry) => entry.realPath === config.dbRealPath)) {
          state.paidDatabases.push({
            realPath: config.dbRealPath,
            liveProductionDb: config.liveProductionDb,
          });
        }
        saveAdultOffBatchState(stateDir, state);
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
          settleCall(requestId, reservedKrw, callError);
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
      const haltedBefore = haltedReason();
      if (haltedBefore) {
        stopReason = haltedBefore;
        return null;
      }
      if (state.settledKrw + heldReserveKrw + adultOffBatchTextReserveKrw(text, pricing) > config.capKrw) {
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
      if (quarantinedHashes.has(adultOffApprovedTextHash(item.target.text))) {
        report.body.quarantinedSkipped += 1;
        continue;
      }
      beginUnit(item.target.messageId, "body");
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
      endUnit();
    }

    if (!stopReason) {
      for (const aux of work.auxItems) {
        if (!aux.fingerprint) {
          report.aux.fingerprintMissing += 1;
          continue;
        }
        if (aux.texts.some((text) => quarantinedHashes.has(adultOffApprovedTextHash(text)))) {
          report.aux.quarantinedSkipped += 1;
          continue;
        }
        beginUnit(aux.item.messageId, "aux");
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
          endUnit();
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
        endUnit();
      }
    }

    report.budget.settledKrwAtEnd = state.settledKrw;
    report.budget.paidWindowCalls = callsThisRun;
    report.budget.cumulativePaidWindowCalls = state.callCount;
    report.budget.maxObservedWindowKrw = state.maxObservedWindowKrw;
    report.halted = state.halted;
    if (!stopReason && heldQuarantine) stopReason = "quarantine_pending";
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
