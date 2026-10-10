import { existsSync, readFileSync } from "node:fs";
import { getPublishedPricing } from "@/lib/publishedModelPricing";
import {
  TRPG_1462_NEW_BENCHMARK_ID,
  TRPG_1462_NEW_BENCHMARK_REQUEST_IDS,
  TRPG_1462_PINNED_REQUEST_HASHES,
  type Trpg1462NewBenchmarkRequestId,
} from "./trpg1462GeminiGmNewBenchmark";
import {
  assertTrpg1462NetworkPolicy,
  assertTrpg1462PaidApproval,
  buildTrpg1462OneShotProviderHeaders,
  executeTrpg1462OneShot,
  isTrpg1462MockFetch,
  isTrpg1462NonPaidGrantor,
  TRPG_1462_APPROVED_MODEL,
  TRPG_1462_APPROVED_PROVIDER,
  TRPG_1462_LIVE_APPROVAL_KIND,
  TRPG_1462_MAX_PAID_CALLS,
  TRPG_1462_MOCK_LIVE_EXECUTION_SHA,
  TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
  TRPG_1462_MOCK_OPERATOR_GRANTED_BY,
  TRPG_1462_TEST_APPROVAL_KIND,
  TRPG_1462_TEST_EXECUTION_BASE_SHA,
  TRPG_1462_TEST_MAX_COST_USD,
  type Trpg1462LiveApprovalRecord,
  type Trpg1462OneShotFetch,
  type Trpg1462OneShotResult,
  type Trpg1462PaidApprovalRecord,
  type Trpg1462Transport,
} from "./trpg1462GeminiGmOneShot";
import {
  assertNotForbiddenPrivatePath,
  trpg1462LiveApprovalPath,
  type Trpg1462AttemptJournal,
  type Trpg1462DurableWriteHooks,
} from "./trpg1462GeminiGmPrecallJournal";

export const TRPG_1462_OPERATOR_GRANT_KIND = "OPERATOR_PRIVATE_RECORD";
export const TRPG_1462_LIVE_MANIFEST_VERSION = 1;
export const TRPG_1462_PUBLISHED_SIX_CALL_ESTIMATE_USD = 0.027;

export type Trpg1462LiveDispatchMode = "live" | "mock-verify";

export type Trpg1462OperatorLiveApprovalRecord = {
  experiment: typeof TRPG_1462_NEW_BENCHMARK_ID;
  kind: typeof TRPG_1462_LIVE_APPROVAL_KIND;
  grantKind: typeof TRPG_1462_OPERATOR_GRANT_KIND;
  manifestVersion: typeof TRPG_1462_LIVE_MANIFEST_VERSION;
  approvedCaseIds: Trpg1462NewBenchmarkRequestId[];
  requestBodySha256: Record<Trpg1462NewBenchmarkRequestId, string>;
  model: typeof TRPG_1462_APPROVED_MODEL;
  provider: typeof TRPG_1462_APPROVED_PROVIDER;
  maxCalls: number;
  estimatedCostUsd: number;
  maxCostUsd: number;
  costCapGuaranteed: false;
  baselineSha: string;
  executionSha: string;
  grantedBy: string;
  grantEvidence: string;
  createdAt: string;
  expiresAt: string | null;
};

export type Trpg1462CostReport = {
  estimatedUsd: number;
  measuredUsd: number | null;
  costCapGuaranteed: false;
};

export type Trpg1462LiveDispatchResult = Trpg1462OneShotResult & {
  cost: Trpg1462CostReport;
};

function pinnedRequestBodyShas(): Record<Trpg1462NewBenchmarkRequestId, string> {
  return Object.fromEntries(
    TRPG_1462_NEW_BENCHMARK_REQUEST_IDS.map((id) => [id, TRPG_1462_PINNED_REQUEST_HASHES[id].requestBodySha256])
  ) as Record<Trpg1462NewBenchmarkRequestId, string>;
}

/** In-memory mock operator record. Not a user-granted paid approval. */
export function createTrpg1462MockOperatorApproval(
  overrides: Partial<Trpg1462OperatorLiveApprovalRecord> = {}
): Trpg1462OperatorLiveApprovalRecord {
  return {
    experiment: TRPG_1462_NEW_BENCHMARK_ID,
    kind: TRPG_1462_LIVE_APPROVAL_KIND,
    grantKind: TRPG_1462_OPERATOR_GRANT_KIND,
    manifestVersion: TRPG_1462_LIVE_MANIFEST_VERSION,
    approvedCaseIds: [...TRPG_1462_NEW_BENCHMARK_REQUEST_IDS],
    requestBodySha256: pinnedRequestBodyShas(),
    model: TRPG_1462_APPROVED_MODEL,
    provider: TRPG_1462_APPROVED_PROVIDER,
    maxCalls: TRPG_1462_MAX_PAID_CALLS,
    estimatedCostUsd: TRPG_1462_PUBLISHED_SIX_CALL_ESTIMATE_USD,
    maxCostUsd: TRPG_1462_TEST_MAX_COST_USD,
    costCapGuaranteed: false,
    baselineSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
    executionSha: TRPG_1462_MOCK_OPERATOR_EXECUTION_SHA,
    grantedBy: TRPG_1462_MOCK_OPERATOR_GRANTED_BY,
    grantEvidence: "mock-operator-fixture",
    createdAt: "2026-10-10T00:00:00.000Z",
    expiresAt: null,
    ...overrides,
  };
}

export function verifyTrpg1462OperatorApprovedCases(
  approval: Trpg1462OperatorLiveApprovalRecord
): Trpg1462NewBenchmarkRequestId[] {
  const missing = TRPG_1462_NEW_BENCHMARK_REQUEST_IDS.filter((id) => !approval.approvedCaseIds.includes(id));
  if (missing.length > 0) throw new Error("APPROVAL_MISMATCH");
  for (const id of TRPG_1462_NEW_BENCHMARK_REQUEST_IDS) {
    if (approval.requestBodySha256[id] !== TRPG_1462_PINNED_REQUEST_HASHES[id].requestBodySha256) {
      throw new Error("APPROVAL_MISMATCH");
    }
  }
  return [...TRPG_1462_NEW_BENCHMARK_REQUEST_IDS];
}

export function estimateTrpg1462PublishedCostUsd(calls: number): number {
  return (TRPG_1462_PUBLISHED_SIX_CALL_ESTIMATE_USD / TRPG_1462_MAX_PAID_CALLS) * calls;
}

export function measureTrpg1462UsageCostUsd(
  inputTokens: number | null,
  outputTokens: number | null
): number | null {
  if (inputTokens == null || outputTokens == null) return null;
  const pricing = getPublishedPricing(TRPG_1462_APPROVED_MODEL);
  return (
    (inputTokens * pricing.billingReferenceInputUsdPerMillion +
      outputTokens * pricing.billingReferenceOutputUsdPerMillion) /
    1_000_000
  );
}

function isApprovedRequestId(id: string): id is Trpg1462NewBenchmarkRequestId {
  return (TRPG_1462_NEW_BENCHMARK_REQUEST_IDS as readonly string[]).includes(id);
}

function blockedDispatch(requestId: string, reason: string): Trpg1462LiveDispatchResult {
  return {
    ok: false,
    blocked: true,
    reason,
    requestId,
    posts: 0,
    status: "blocked",
    httpStatus: null,
    finishReason: null,
    narration: null,
    delta: null,
    inputTokens: null,
    outputTokens: null,
    cost: {
      estimatedUsd: TRPG_1462_PUBLISHED_SIX_CALL_ESTIMATE_USD,
      measuredUsd: null,
      costCapGuaranteed: false,
    },
  };
}

export function toOneShotLiveApproval(
  approval: Trpg1462OperatorLiveApprovalRecord
): Trpg1462LiveApprovalRecord {
  return {
    experiment: approval.experiment,
    kind: approval.kind,
    approvedCaseIds: approval.approvedCaseIds,
    requestBodySha256: approval.requestBodySha256,
    model: approval.model,
    provider: approval.provider,
    maxCalls: approval.maxCalls,
    maxCostUsd: approval.maxCostUsd,
    executionBaseSha: approval.executionSha,
    grantedBy: approval.grantedBy,
  };
}

export function assertTrpg1462OperatorLiveApproval(
  approval: Trpg1462OperatorLiveApprovalRecord,
  requestId: Trpg1462NewBenchmarkRequestId,
  executionSha: string
): void {
  if (approval.kind !== TRPG_1462_LIVE_APPROVAL_KIND) throw new Error("APPROVAL_DENIED");
  if (approval.grantKind !== TRPG_1462_OPERATOR_GRANT_KIND) throw new Error("LIVE_APPROVAL_NOT_OPERATOR");
  if (approval.manifestVersion !== TRPG_1462_LIVE_MANIFEST_VERSION) throw new Error("APPROVAL_MISMATCH");
  if (approval.experiment !== TRPG_1462_NEW_BENCHMARK_ID) throw new Error("APPROVAL_MISMATCH");
  if (approval.model !== TRPG_1462_APPROVED_MODEL) throw new Error("APPROVAL_MISMATCH");
  if (approval.provider !== TRPG_1462_APPROVED_PROVIDER) throw new Error("APPROVAL_MISMATCH");
  if (approval.grantedBy.trim() === "" || approval.grantEvidence.trim() === "") {
    throw new Error("APPROVAL_DENIED");
  }
  if (approval.baselineSha.trim() === "" || approval.executionSha.trim() === "") {
    throw new Error("APPROVAL_MISMATCH");
  }
  if (
    approval.executionSha === TRPG_1462_TEST_EXECUTION_BASE_SHA ||
    approval.executionSha === TRPG_1462_MOCK_LIVE_EXECUTION_SHA
  ) {
    throw new Error("APPROVAL_MISMATCH");
  }
  if (executionSha !== approval.executionSha) throw new Error("EXECUTION_SHA_MISMATCH");
  if (!(approval.maxCalls > 0 && approval.maxCalls <= TRPG_1462_MAX_PAID_CALLS)) {
    throw new Error("APPROVAL_MISMATCH");
  }
  if (!(approval.estimatedCostUsd > 0) || !(approval.maxCostUsd > 0)) throw new Error("APPROVAL_MISMATCH");
  if (approval.costCapGuaranteed !== false) throw new Error("COST_CAP_NOT_GUARANTEED");
  if (approval.estimatedCostUsd > approval.maxCostUsd) throw new Error("COST_POLICY_EXCEEDED");
  if (approval.createdAt.trim() === "") throw new Error("APPROVAL_MISMATCH");
  if (approval.expiresAt && Date.parse(approval.expiresAt) <= Date.now()) {
    throw new Error("LIVE_APPROVAL_EXPIRED");
  }
  if (!approval.approvedCaseIds.includes(requestId)) throw new Error("APPROVAL_MISMATCH");
  if (approval.requestBodySha256[requestId] !== TRPG_1462_PINNED_REQUEST_HASHES[requestId].requestBodySha256) {
    throw new Error("APPROVAL_MISMATCH");
  }
}

export function assertTrpg1462LiveDispatchBoundary(
  mode: Trpg1462LiveDispatchMode,
  approval: Trpg1462OperatorLiveApprovalRecord | Trpg1462PaidApprovalRecord | null | undefined,
  fetchImpl: Trpg1462OneShotFetch,
  transport?: Trpg1462Transport
): asserts approval is Trpg1462OperatorLiveApprovalRecord {
  if (!approval) throw new Error("LIVE_APPROVAL_MISSING");
  if (approval.kind === TRPG_1462_TEST_APPROVAL_KIND) {
    throw new Error("TEST_ONLY_NETWORK_FORBIDDEN");
  }
  if (!("grantKind" in approval) || approval.grantKind !== TRPG_1462_OPERATOR_GRANT_KIND) {
    throw new Error("LIVE_APPROVAL_NOT_OPERATOR");
  }
  if (isTrpg1462NonPaidGrantor(approval.grantedBy) && mode === "live") {
    throw new Error("LIVE_APPROVAL_NOT_GRANTED");
  }
  if (approval.grantedBy.trim() === "") throw new Error("APPROVAL_DENIED");
  switch (mode) {
    case "live":
      if (transport !== "live") throw new Error("LIVE_TRANSPORT_REQUIRED");
      if (isTrpg1462MockFetch(fetchImpl)) throw new Error("LIVE_MOCK_FETCH_FORBIDDEN");
      break;
    case "mock-verify":
      if (transport === "live") throw new Error("MOCK_VERIFY_LIVE_TRANSPORT_FORBIDDEN");
      if (!isTrpg1462MockFetch(fetchImpl)) throw new Error("MOCK_VERIFY_REQUIRES_TRUSTED_MOCK");
      break;
    default: {
      const unexpected: never = mode;
      throw new Error(`LIVE_DISPATCH_MODE:${String(unexpected)}`);
    }
  }
}

export function loadTrpg1462OperatorLiveApproval(path: string): Trpg1462OperatorLiveApprovalRecord {
  assertNotForbiddenPrivatePath(path);
  if (!existsSync(path)) throw new Error("LIVE_APPROVAL_MISSING");
  return JSON.parse(readFileSync(path, "utf8")) as Trpg1462OperatorLiveApprovalRecord;
}

export async function dispatchTrpg1462LiveOneShot(opts: {
  mode: Trpg1462LiveDispatchMode;
  requestId: string;
  root: string;
  fetchImpl: Trpg1462OneShotFetch;
  executionSha: string;
  approval?: Trpg1462OperatorLiveApprovalRecord | Trpg1462PaidApprovalRecord | null;
  approvalPath?: string;
  apiKey?: string;
  transport?: Trpg1462Transport;
  timeoutMs?: number;
  persist?: (path: string, journal: Trpg1462AttemptJournal) => void;
  durableHooks?: Trpg1462DurableWriteHooks;
  resultWriteHooks?: Trpg1462DurableWriteHooks;
}): Promise<Trpg1462LiveDispatchResult> {
  assertNotForbiddenPrivatePath(opts.root);
  if (!isApprovedRequestId(opts.requestId)) {
    return blockedDispatch(opts.requestId, "UNAPPROVED_CASE_ID");
  }
  const id = opts.requestId;
  let loaded: Trpg1462OperatorLiveApprovalRecord | Trpg1462PaidApprovalRecord | null | undefined =
    opts.approval;
  if (loaded == null && opts.approvalPath) {
    try {
      loaded = loadTrpg1462OperatorLiveApproval(opts.approvalPath);
    } catch (error) {
      return blockedDispatch(id, error instanceof Error ? error.message : "LIVE_APPROVAL_MISSING");
    }
  }
  if (loaded == null) {
    const defaultPath = trpg1462LiveApprovalPath(opts.root);
    if (existsSync(defaultPath)) {
      try {
        loaded = loadTrpg1462OperatorLiveApproval(defaultPath);
      } catch (error) {
        return blockedDispatch(id, error instanceof Error ? error.message : "LIVE_APPROVAL_MISSING");
      }
    }
  }

  let operator: Trpg1462OperatorLiveApprovalRecord;
  let oneShotApproval: Trpg1462LiveApprovalRecord;
  try {
    assertTrpg1462LiveDispatchBoundary(opts.mode, loaded, opts.fetchImpl, opts.transport);
    operator = loaded;
    assertTrpg1462OperatorLiveApproval(operator, id, opts.executionSha);
    oneShotApproval = toOneShotLiveApproval(operator);
    assertTrpg1462PaidApproval(oneShotApproval, id, operator.requestBodySha256[id]);
    const transport: Trpg1462Transport = opts.mode === "live" ? "live" : "mock";
    assertTrpg1462NetworkPolicy(oneShotApproval, opts.fetchImpl, transport);
    buildTrpg1462OneShotProviderHeaders(opts.apiKey);
  } catch (error) {
    return blockedDispatch(id, error instanceof Error ? error.message : "APPROVAL_DENIED");
  }

  const result = await executeTrpg1462OneShot({
    requestId: id,
    root: opts.root,
    fetchImpl: opts.fetchImpl,
    timeoutMs: opts.timeoutMs,
    persist: opts.persist,
    durableHooks: opts.durableHooks,
    resultWriteHooks: opts.resultWriteHooks,
    approval: oneShotApproval,
    apiKey: opts.apiKey,
    transport: opts.mode === "live" ? "live" : "mock",
  });
  return {
    ...result,
    cost: {
      estimatedUsd: operator.estimatedCostUsd,
      measuredUsd: measureTrpg1462UsageCostUsd(result.inputTokens, result.outputTokens),
      costCapGuaranteed: false,
    },
  };
}
