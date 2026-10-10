import { existsSync, readFileSync } from "node:fs";
import { CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL, buildCheaperInferenceHeaders } from "@/lib/cheaperInferenceConfig";
import { buildTrpgGmProviderRequest } from "./gmCall";
import { finishReasonFromSsePayload } from "./gmCompletionIntegrity";
import { parseTrpgGmOutput } from "./gmPrompt";
import { feedGmProviderSseBytes } from "./gmProviderSse";
import {
  assembleTrpg1462NewBenchmark,
  assertProductionGmContract,
  sha256Utf8,
  TRPG_1462_NEW_BENCHMARK_ID,
  TRPG_1462_NEW_BENCHMARK_REQUEST_IDS,
  TRPG_1462_PINNED_REQUEST_HASHES,
  TRPG_1462_SYSTEM_SHA_1465,
  type Trpg1462NewBenchmarkRequestId,
} from "./trpg1462GeminiGmNewBenchmark";
import {
  assertNotForbiddenPrivatePath,
  canPostTrpg1462Attempt,
  consumedTrpg1462Attempts,
  createTrpg1462AttemptJournal,
  loadTrpg1462AttemptJournal,
  markTrpg1462Attempted,
  markTrpg1462PossiblySent,
  reserveTrpg1462Attempt,
  settleTrpg1462Attempt,
  trpg1462PrecallJournalPath,
  trpg1462ResultPath,
  tryAcquireTrpg1462JournalLock,
  writePrivateAtomicJson,
  writeTrpg1462AttemptJournal,
  type Trpg1462AttemptJournal,
  type Trpg1462DurableWriteHooks,
  type Trpg1462JournalStatus,
} from "./trpg1462GeminiGmPrecallJournal";
import { TRPG_GM_MODEL } from "./types";

export const TRPG_1462_APPROVED_PROVIDER = "cheaperinference";
export const TRPG_1462_APPROVED_MODEL = TRPG_GM_MODEL;
export const TRPG_1462_MAX_PAID_CALLS = 6;
export const TRPG_1462_ONESHOT_TIMEOUT_MS = 180_000;
export const TRPG_1462_TEST_APPROVAL_KIND = "TEST_ONLY";
export const TRPG_1462_TEST_EXECUTION_BASE_SHA = "test-only-not-a-live-approval";
export const TRPG_1462_TEST_MAX_COST_USD = 0.03;
export const TRPG_1462_TEST_API_KEY = "trpg-1462-test-key";

export type Trpg1462PaidApprovalRecord = {
  experiment: typeof TRPG_1462_NEW_BENCHMARK_ID;
  kind: typeof TRPG_1462_TEST_APPROVAL_KIND;
  approvedCaseIds: Trpg1462NewBenchmarkRequestId[];
  requestBodySha256: Record<Trpg1462NewBenchmarkRequestId, string>;
  model: typeof TRPG_1462_APPROVED_MODEL;
  provider: typeof TRPG_1462_APPROVED_PROVIDER;
  maxCalls: number;
  maxCostUsd: number;
  executionBaseSha: string;
  grantedBy: "TEST_FIXTURE";
};

export function createTrpg1462TestApproval(
  overrides: Partial<Trpg1462PaidApprovalRecord> = {}
): Trpg1462PaidApprovalRecord {
  const requestBodySha256 = Object.fromEntries(
    TRPG_1462_NEW_BENCHMARK_REQUEST_IDS.map((id) => [id, TRPG_1462_PINNED_REQUEST_HASHES[id].requestBodySha256])
  ) as Record<Trpg1462NewBenchmarkRequestId, string>;
  return {
    experiment: TRPG_1462_NEW_BENCHMARK_ID,
    kind: TRPG_1462_TEST_APPROVAL_KIND,
    approvedCaseIds: [...TRPG_1462_NEW_BENCHMARK_REQUEST_IDS],
    requestBodySha256,
    model: TRPG_1462_APPROVED_MODEL,
    provider: TRPG_1462_APPROVED_PROVIDER,
    maxCalls: TRPG_1462_MAX_PAID_CALLS,
    maxCostUsd: TRPG_1462_TEST_MAX_COST_USD,
    executionBaseSha: TRPG_1462_TEST_EXECUTION_BASE_SHA,
    grantedBy: "TEST_FIXTURE",
    ...overrides,
  };
}

export function assertTrpg1462PaidApproval(
  approval: Trpg1462PaidApprovalRecord | null | undefined,
  requestId: Trpg1462NewBenchmarkRequestId,
  bodySha: string
): void {
  if (!approval) throw new Error("APPROVAL_DENIED");
  if (approval.kind !== TRPG_1462_TEST_APPROVAL_KIND) throw new Error("APPROVAL_DENIED");
  if (approval.grantedBy !== "TEST_FIXTURE") throw new Error("APPROVAL_DENIED");
  if (approval.experiment !== TRPG_1462_NEW_BENCHMARK_ID) throw new Error("APPROVAL_MISMATCH");
  if (approval.model !== TRPG_1462_APPROVED_MODEL) throw new Error("APPROVAL_MISMATCH");
  if (approval.provider !== TRPG_1462_APPROVED_PROVIDER) throw new Error("APPROVAL_MISMATCH");
  if (approval.executionBaseSha.trim() === "") throw new Error("APPROVAL_MISMATCH");
  if (!(approval.maxCalls > 0 && approval.maxCalls <= TRPG_1462_MAX_PAID_CALLS)) throw new Error("APPROVAL_MISMATCH");
  if (!(approval.maxCostUsd > 0)) throw new Error("APPROVAL_MISMATCH");
  if (!approval.approvedCaseIds.includes(requestId)) throw new Error("APPROVAL_MISMATCH");
  if (approval.requestBodySha256[requestId] !== bodySha) throw new Error("APPROVAL_MISMATCH");
}

/** Experiment-only. Pass an explicit key so production env is never consulted. */
export function buildTrpg1462OneShotProviderHeaders(apiKey: string | undefined): Record<string, string> {
  const key = apiKey?.trim() ?? "";
  if (!key) throw new Error("AUTH_MISSING");
  return buildCheaperInferenceHeaders(key);
}

export type Trpg1462OneShotFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }
) => Promise<Response>;

export type Trpg1462OneShotResult = {
  ok: boolean;
  blocked: boolean;
  reason: string | null;
  requestId: string;
  posts: number;
  status: Trpg1462JournalStatus | "blocked";
  httpStatus: number | null;
  finishReason: string | null;
  narration: string | null;
  delta: unknown;
  inputTokens: number | null;
  outputTokens: number | null;
};

const EMPTY_RESULT = {
  finishReason: null as string | null,
  narration: null as string | null,
  delta: null as unknown,
  inputTokens: null as number | null,
  outputTokens: null as number | null,
};

function isApprovedRequestId(id: string): id is Trpg1462NewBenchmarkRequestId {
  return (TRPG_1462_NEW_BENCHMARK_REQUEST_IDS as readonly string[]).includes(id);
}

export function verifyTrpg1462SealedFingerprints() {
  const assembled = assembleTrpg1462NewBenchmark();
  for (const id of TRPG_1462_NEW_BENCHMARK_REQUEST_IDS) {
    const row = assembled.requests[id];
    const pinned = TRPG_1462_PINNED_REQUEST_HASHES[id];
    if (row.requestBodySha256 !== pinned.requestBodySha256) {
      throw new Error(`sealed body SHA drift for ${id}`);
    }
    if (row.promptSha256 !== pinned.promptSha256) {
      throw new Error(`sealed prompt SHA drift for ${id}`);
    }
    if (row.userSha256 !== pinned.userSha256) {
      throw new Error(`sealed user SHA drift for ${id}`);
    }
    assertProductionGmContract(row);
    if (row.model !== TRPG_1462_APPROVED_MODEL) {
      throw new Error(`model ${row.model}`);
    }
  }
  return assembled;
}

function buildSealedProviderRequest(id: Trpg1462NewBenchmarkRequestId) {
  const assembled = verifyTrpg1462SealedFingerprints();
  const row = assembled.requests[id];
  const request = buildTrpgGmProviderRequest({
    system: row.systemSha256 === TRPG_1462_SYSTEM_SHA_1465 ? assembled.system1465 : assembled.system1480,
    user: assembled.users[row.userCase],
  });
  const serialized = JSON.stringify(request.body);
  if (sha256Utf8(serialized) !== TRPG_1462_PINNED_REQUEST_HASHES[id].requestBodySha256) {
    throw new Error(`request-body SHA mismatch for ${id}`);
  }
  if (request.provider !== TRPG_1462_APPROVED_PROVIDER) {
    throw new Error(`provider ${request.provider}`);
  }
  if (request.endpoint !== CHEAPER_INFERENCE_CHAT_COMPLETIONS_URL) {
    throw new Error("provider endpoint drift");
  }
  return { assembled, request, serialized, bodySha: TRPG_1462_PINNED_REQUEST_HASHES[id].requestBodySha256 };
}

function blocked(
  requestId: string,
  reason: string,
  extra: Partial<Trpg1462OneShotResult> = {}
): Trpg1462OneShotResult {
  return {
    ok: false,
    blocked: true,
    reason,
    requestId,
    posts: 0,
    status: "blocked",
    httpStatus: null,
    ...EMPTY_RESULT,
    ...extra,
  };
}

function persistJournal(
  path: string,
  journal: Trpg1462AttemptJournal,
  persist: ((path: string, journal: Trpg1462AttemptJournal) => void) | undefined,
  hooks: Trpg1462DurableWriteHooks
): void {
  if (persist) {
    persist(path, journal);
    return;
  }
  writeTrpg1462AttemptJournal(path, journal, hooks);
}

export function ensureTrpg1462AttemptJournal(root: string): Trpg1462AttemptJournal {
  assertNotForbiddenPrivatePath(root);
  const path = trpg1462PrecallJournalPath(root);
  if (!existsSync(path)) {
    const assembled = verifyTrpg1462SealedFingerprints();
    const bodies = Object.fromEntries(
      TRPG_1462_NEW_BENCHMARK_REQUEST_IDS.map((id) => [id, assembled.requests[id].requestBodySha256])
    ) as Record<Trpg1462NewBenchmarkRequestId, string>;
    writeTrpg1462AttemptJournal(path, createTrpg1462AttemptJournal(bodies));
  }
  return loadTrpg1462AttemptJournal(path);
}

function parseProviderUsage(payload: unknown): { inputTokens: number | null; outputTokens: number | null } {
  if (!payload || typeof payload !== "object") return { inputTokens: null, outputTokens: null };
  const usage = (payload as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage;
  if (!usage) return { inputTokens: null, outputTokens: null };
  return {
    inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
    outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
  };
}

export function parseTrpg1462OneShotProviderText(text: string): {
  raw: string;
  finishReason: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return { raw: "", finishReason: null, inputTokens: null, outputTokens: null };
  }
  if (trimmed.startsWith("data:") || trimmed.includes("\ndata:")) {
    const sseState = { buffer: "" };
    let raw = "";
    let finishReason: string | null = null;
    let usage = { inputTokens: null as number | null, outputTokens: null as number | null };
    feedGmProviderSseBytes(sseState, text, (payload) => {
      const obj = payload as {
        choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown } }>;
      };
      const delta = obj.choices?.[0]?.delta?.content;
      const message = obj.choices?.[0]?.message?.content;
      if (typeof delta === "string") raw += delta;
      else if (typeof message === "string") raw += message;
      finishReason = finishReasonFromSsePayload(payload) ?? finishReason;
      const parsedUsage = parseProviderUsage(payload);
      if (parsedUsage.inputTokens != null || parsedUsage.outputTokens != null) usage = parsedUsage;
    }, true);
    return { raw, finishReason, ...usage };
  }
  try {
    const json = JSON.parse(trimmed) as {
      choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    };
    const content = json.choices?.[0]?.message?.content;
    return {
      raw: typeof content === "string" ? content : "",
      finishReason: typeof json.choices?.[0]?.finish_reason === "string" ? json.choices[0].finish_reason : null,
      ...parseProviderUsage(json),
    };
  } catch {
    return { raw: trimmed, finishReason: null, inputTokens: null, outputTokens: null };
  }
}

function writeResultFile(
  root: string,
  id: Trpg1462NewBenchmarkRequestId,
  payload: Record<string, unknown>,
  hooks: Trpg1462DurableWriteHooks = {}
): string {
  const path = trpg1462ResultPath(root, id);
  writePrivateAtomicJson(path, payload, hooks);
  return path;
}

export function loadTrpg1462OneShotResult(root: string, id: Trpg1462NewBenchmarkRequestId): Record<string, unknown> {
  return JSON.parse(readFileSync(trpg1462ResultPath(root, id), "utf8")) as Record<string, unknown>;
}

export async function executeTrpg1462OneShot(opts: {
  requestId: string;
  root: string;
  fetchImpl: Trpg1462OneShotFetch;
  timeoutMs?: number;
  persist?: (path: string, journal: Trpg1462AttemptJournal) => void;
  durableHooks?: Trpg1462DurableWriteHooks;
  resultWriteHooks?: Trpg1462DurableWriteHooks;
  crashAfterReserve?: boolean;
  approval?: Trpg1462PaidApprovalRecord | null;
  apiKey?: string;
}): Promise<Trpg1462OneShotResult> {
  assertNotForbiddenPrivatePath(opts.root);
  if (!isApprovedRequestId(opts.requestId)) {
    return blocked(opts.requestId, "UNAPPROVED_CASE_ID");
  }
  const id = opts.requestId;
  const durableHooks = opts.durableHooks ?? {};
  const journalPath = trpg1462PrecallJournalPath(opts.root);
  let sealed;
  try {
    sealed = buildSealedProviderRequest(id);
  } catch (error) {
    return blocked(id, error instanceof Error ? error.message : "FINGERPRINT_MISMATCH");
  }

  let headers: Record<string, string>;
  try {
    assertTrpg1462PaidApproval(opts.approval, id, sealed.bodySha);
    headers = buildTrpg1462OneShotProviderHeaders(opts.apiKey);
  } catch (error) {
    return blocked(id, error instanceof Error ? error.message : "APPROVAL_DENIED");
  }

  const lock = tryAcquireTrpg1462JournalLock(opts.root);
  if (!lock.ok) {
    return blocked(id, lock.reason);
  }

  let reserved = false;
  try {
    const journal = ensureTrpg1462AttemptJournal(opts.root);
    if (journal.cases[id].requestBodySha256 !== sealed.bodySha) {
      return blocked(id, "REQUEST_BODY_SHA_MISMATCH");
    }
    if (consumedTrpg1462Attempts(journal) >= TRPG_1462_MAX_PAID_CALLS) {
      return blocked(id, "MAX_PAID_CALLS");
    }
    if (!canPostTrpg1462Attempt(journal, id, sealed.bodySha)) {
      return blocked(id, `ONE_SHOT_BLOCKED_${journal.cases[id].status.toUpperCase()}`);
    }
    const reservedJournal = reserveTrpg1462Attempt(journal, id, sealed.bodySha);
    persistJournal(journalPath, reservedJournal, opts.persist, durableHooks);
    reserved = true;
    persistJournal(journalPath, markTrpg1462Attempted(reservedJournal, id), opts.persist, durableHooks);
  } catch (error) {
    return blocked(id, error instanceof Error && /one-shot blocked/.test(error.message) ? "ONE_SHOT_BLOCKED" : "JOURNAL_WRITE_FAILED");
  } finally {
    lock.release();
  }

  if (!reserved) {
    return blocked(id, "RESERVE_FAILED");
  }
  if (opts.crashAfterReserve) {
    throw new Error("CRASH_AFTER_RESERVE");
  }

  let posts = 0;
  let settleStatus: Exclude<Trpg1462JournalStatus, "planned" | "reserved"> = "unknown";
  let httpStatus: number | null = null;
  let parsed = { raw: "", finishReason: null as string | null, inputTokens: null as number | null, outputTokens: null as number | null };
  try {
    posts = 1;
    const response = await opts.fetchImpl(sealed.request.endpoint, {
      method: "POST",
      headers,
      body: sealed.serialized,
      signal: AbortSignal.timeout(opts.timeoutMs ?? TRPG_1462_ONESHOT_TIMEOUT_MS),
    });
    httpStatus = response.status;
    if (!response.ok) {
      settleStatus = "http_error";
    } else {
      const text = await response.text();
      parsed = parseTrpg1462OneShotProviderText(text);
      if (!parsed.raw.trim()) {
        settleStatus = "unknown";
      } else {
        settleStatus = "posted";
      }
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    settleStatus = name === "TimeoutError" || name === "AbortError" ? "timeout" : "unknown";
  }

  const parsedOut = parsed.raw.trim() ? parseTrpgGmOutput(parsed.raw) : null;
  const resultPayload = {
    requestId: id,
    requestBodySha256: sealed.bodySha,
    status: settleStatus,
    httpStatus,
    finishReason: parsed.finishReason,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
    raw: parsed.raw,
    narration: parsedOut?.narration ?? null,
    delta: parsedOut?.delta ?? null,
    posts,
  };

  let resultFile: string;
  try {
    resultFile = writeResultFile(opts.root, id, resultPayload, opts.resultWriteHooks);
  } catch {
    const failLock = tryAcquireTrpg1462JournalLock(opts.root);
    if (failLock.ok) {
      try {
        const latest = loadTrpg1462AttemptJournal(journalPath);
        persistJournal(journalPath, markTrpg1462PossiblySent(latest, id), opts.persist, durableHooks);
      } finally {
        failLock.release();
      }
    }
    return {
      ok: false,
      blocked: false,
      reason: "RESULT_WRITE_FAILED",
      requestId: id,
      posts,
      status: settleStatus,
      httpStatus,
      finishReason: parsed.finishReason,
      narration: parsedOut?.narration ?? null,
      delta: parsedOut?.delta ?? null,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
    };
  }

  const settleLock = tryAcquireTrpg1462JournalLock(opts.root);
  if (!settleLock.ok) {
    return {
      ok: false,
      blocked: false,
      reason: "SETTLE_LOCK_FAILED",
      requestId: id,
      posts,
      status: settleStatus,
      httpStatus,
      finishReason: parsed.finishReason,
      narration: parsedOut?.narration ?? null,
      delta: parsedOut?.delta ?? null,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
    };
  }
  try {
    const latest = loadTrpg1462AttemptJournal(journalPath);
    const settled = settleTrpg1462Attempt(latest, id, settleStatus, httpStatus);
    settled.cases[id].finishReason = parsed.finishReason;
    settled.cases[id].inputTokens = parsed.inputTokens;
    settled.cases[id].outputTokens = parsed.outputTokens;
    settled.cases[id].narrationSha256 = parsedOut ? sha256Utf8(parsedOut.narration) : null;
    settled.cases[id].deltaSha256 = parsedOut ? sha256Utf8(JSON.stringify(parsedOut.delta)) : null;
    settled.cases[id].resultFile = resultFile;
    persistJournal(journalPath, settled, opts.persist, durableHooks);
  } finally {
    settleLock.release();
  }

  return {
    ok: settleStatus === "posted",
    blocked: false,
    reason: settleStatus === "posted" ? null : settleStatus.toUpperCase(),
    requestId: id,
    posts,
    status: settleStatus,
    httpStatus,
    finishReason: parsed.finishReason,
    narration: parsedOut?.narration ?? null,
    delta: parsedOut?.delta ?? null,
    inputTokens: parsed.inputTokens,
    outputTokens: parsed.outputTokens,
  };
}
