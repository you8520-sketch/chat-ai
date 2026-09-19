import {
  formatAdminActualUsd,
  formatAdminKrwFromUsd,
  type AdminBillingReceiptV2,
  type AdminBillingReceiptV2Fx,
} from "@/lib/adminBillingReceiptV2";
import { formatPoints } from "@/lib/billingDisplay";
import type { Usage } from "@/lib/chatUsage";
import { convertUsdToKrw } from "@/lib/exchangeRate";
import { buildAdminReceiptTurnSummary } from "@/lib/adminBillingReceiptTurnSummary";
import type {
  AsyncFamilyCoverageState,
  AsyncFamilyExpectationState,
  AsyncTurnCoverageResult,
  TurnAttributableAsyncFamily,
} from "@/lib/asyncTurnCoverage";
import type { AdminBillingForensicMetadata } from "@/lib/adminBillingForensicMetadataShared";

export type AdminBillingReceiptV3WholeTurnCoverage =
  | "complete"
  | "pending"
  | "partial"
  | "unverifiable";

export type AdminBillingReceiptV3AsyncFamilySummary = {
  family: TurnAttributableAsyncFamily;
  label: string;
  expectationState: AsyncFamilyExpectationState;
  coverage: AsyncFamilyCoverageState;
  physicalCallCount: number;
  exactPhysicalCallCount: number;
  incompletePhysicalCallCount: number;
  knownActualCostUsd: number;
  exactActualCostUsd: number | null;
  taskPending?: boolean;
  taskFailed?: boolean;
  skipReason?: string;
};

export type AdminBillingReceiptV3AsyncSection = {
  coverage: AdminBillingReceiptV3WholeTurnCoverage;
  expectation: AsyncTurnCoverageResult;
  physicalCallCount: number;
  exactPhysicalCallCount: number;
  incompletePhysicalCallCount: number;
  knownActualCostUsd: number;
  exactActualCostUsd: number | null;
  unexpectedRowCount: number;
  unexpectedFamilies: string[];
  byFamily: AdminBillingReceiptV3AsyncFamilySummary[];
  events?: Array<{
    eventKey: string | null;
    family: string | null;
    eventStatus: string | null;
    actualCostUsd: number | null;
    actualCostSource: string | null;
    exact: boolean;
    incomplete: boolean;
    /** Delivered model from the provider ledger — canonical, not inferred. */
    actualModel?: string | null;
    /** Requested model from the provider ledger. */
    requestedModel?: string | null;
    canonicalOwner?: string | null;
    requestKind?: string | null;
    trigger?: string | null;
    attempt?: number | null;
    providerRequestId?: string | null;
    costAttribution?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
  }>;
};

export type AdminBillingReceiptV3WholeTurnSection = {
  scope: "turn_attributable";
  coverage: AdminBillingReceiptV3WholeTurnCoverage;
  mainActualCostUsd: number | null;
  /** Canonical main cost source — ledger-first, same owner as mainActualCostUsd. */
  mainActualCostSource: string | null;
  mainExact: boolean;
  syncActualCostUsd: number | null;
  syncExact: boolean;
  syncProvablyNone: boolean;
  asyncKnownActualCostUsd: number;
  asyncExactActualCostUsd: number | null;
  knownProviderSpendUsd: number;
  exactProviderSpendUsd: number | null;
  exactProviderSpendKrw: number | null;
  contributionMarginKrw: number | null;
  contributionMarginPercent: number | null;
  fx: AdminBillingReceiptV2Fx | null;
};

export type AdminBillingReceiptV3 = {
  version: 3;
  assistantMessageId: number;
  chatId: number;
  /** Exact visible character count from the scoped persisted Main RP text. */
  mainRpOutputVisibleChars: number | null;
  /**
   * Usage-based sync receipt. Null when no stored Usage snapshot exists —
   * settlement evidence lives in `forensic` only (Strategy B: nullable unavailable
   * sync section). Never fabricate Usage to fill this.
   */
  syncReceipt: AdminBillingReceiptV2 | null;
  async: AdminBillingReceiptV3AsyncSection;
  wholeTurn: AdminBillingReceiptV3WholeTurnSection;
  excludedCostScopes: string[];
  historicalNote?: string;
  /** Admin billing forensics — stored truth projection, no repricing. */
  forensic?: AdminBillingForensicMetadata;
  /** Admin-only widget extract diagnostics — projected from Usage at build time. */
  statusWidgetExtractDiagnostics?: Usage["statusWidgetExtractDiagnostics"];
  /** Scoped sync_post_turn physical provider rows — canonical provenance source. */
  syncPhysicalEvents?: AdminBillingReceiptV3AsyncSection["events"];
};

/**
 * Main RP model identity — canonical stored-evidence resolution.
 *
 * Sources (scoped per generation by the receipt assembly):
 *  - syncReceipt.userCharge.selectedModelLabel — human-readable selected label
 *  - syncReceipt.userCharge.billingModelId — delivered billing model id when
 *    the handoff identity differs from the selected model
 *  - syncReceipt.mainRp.actual.model — actual delivered model id
 *
 * Rules:
 *  - selected == delivered  → `Main RP 모델: <selectedModelLabel>`
 *  - selected != delivered  → `선택 모델: <selected>` + `실제 처리 모델: <delivered>`
 *  - no usable stored evidence → `Main RP 모델: 확인 불가` (no guess / fallback /
 *    current-selection inference). A failed generation without its own stored
 *    Usage snapshot must never inherit a prior generation's model.
 */
export type AdminBillingReceiptV3MainRpModelIdentity =
  | { kind: "same"; selectedModelLabel: string }
  | { kind: "different"; selectedModelLabel: string; deliveredModel: string }
  | { kind: "unverified" };

export function resolveAdminBillingReceiptV3MainRpModelIdentity(
  receipt: AdminBillingReceiptV3
): AdminBillingReceiptV3MainRpModelIdentity {
  const sync = receipt.syncReceipt;
  if (!sync) return { kind: "unverified" };

  const selectedModelLabel = sync.userCharge.selectedModelLabel?.trim() || "";
  const billingModelId = sync.userCharge.billingModelId?.trim() || "";
  const mainActualModel = sync.mainRp?.actual?.model?.trim() || "";

  // Delivered identity from stored evidence only — never inferred from the
  // current selection or another generation.
  const deliveredModel = mainActualModel || billingModelId || "";

  if (!selectedModelLabel && !deliveredModel) return { kind: "unverified" };
  // Without a stored delivered-model identity we cannot prove same/different.
  if (!deliveredModel) return { kind: "unverified" };

  // billingModelId is stored by the V2 builder only when the delivered billing
  // model differs from the selected model — canonical mismatch signal.
  if (billingModelId) {
    return {
      kind: "different",
      selectedModelLabel: selectedModelLabel || deliveredModel,
      deliveredModel,
    };
  }
  return {
    kind: "same",
    selectedModelLabel: selectedModelLabel || deliveredModel,
  };
}

export function formatAdminBillingReceiptV3MainRpModelLines(
  identity: AdminBillingReceiptV3MainRpModelIdentity
): string[] {
  switch (identity.kind) {
    case "same":
      return [`Main RP 모델: ${identity.selectedModelLabel}`];
    case "different":
      return [
        `선택 모델: ${identity.selectedModelLabel}`,
        `실제 처리 모델: ${identity.deliveredModel}`,
      ];
    case "unverified":
      return ["Main RP 모델: 확인 불가"];
    default: {
      const _exhaustive: never = identity;
      return _exhaustive;
    }
  }
}

/**
 * Compact Admin Receipt view model — ONE canonical display owner.
 *
 * The default receipt shows only what a decision needs:
 *  - mainRp: model + actual cost + provenance label
 *  - userCharge: deducted points (published-final duplication removed when equal)
 *  - auxiliaryCalls: only jobs that actually ran (zero-call / missing-record rows
 *    are hidden from the default display; the underlying forensic data is kept)
 *
 * Every UI section resolves from this view model, never from raw DB/forensic
 * objects independently. ONE RESPONSIBILITY = ONE CANONICAL DISPLAY OWNER.
 */

export type AdminReceiptAuxiliaryCall = {
  label: string;
  model: string | null;
  calls: number;
  /** Transport/job event outcome — NOT cost exactness. */
  result: "success" | "failed" | "partial";
  /** Semantic extraction outcome when a sync widget call ran (null = unknown / N/A). */
  extractionResult?: "success" | "failed" | "partial" | null;
  costUsd: number | null;
  /** Cost provenance label when a cost is shown (kept separate from result). */
  costProvenanceLabel: string | null;
  canonicalOwner?: string | null;
  requestKind?: string | null;
  trigger?: string | null;
  attempt?: number | null;
  providerRequestId?: string | null;
  costAttribution?: string | null;
};

export type AdminReceiptMainRpCost = {
  /** Delivered model label when known. */
  model: string | null;
  /** Actual provider cost USD, or null when not provable. */
  costUsd: number | null;
  /** Stored actual cost source — CI billed / provider reported / catalog estimated. */
  provenance: string | null;
  /** Human-readable provenance label matching the stored evidence. */
  provenanceLabel: string | null;
};

export type AdminReceiptCompactViewModel = {
  mainRp: AdminReceiptMainRpCost;
  deductedPoints: number | null;
  auxiliaryCalls: AdminReceiptAuxiliaryCall[];
  /** True when a complete, same-provenance turn total is provable. */
  hasCompleteTotal: boolean;
  /** Complete total USD when hasCompleteTotal, else null. */
  completeTotalUsd: number | null;
  /** Known settled/partial provider spend USD for this turn (never includes in-progress). */
  knownTurnCostUsd: number | null;
  /** FX projection of knownTurnCostUsd using the receipt's billing FX snapshot. */
  knownTurnCostKrw: number | null;
  turnCostCoverage: AdminBillingReceiptV3WholeTurnCoverage;
  marginPercent: number | null;
  marginUnavailableReason: string | null;
  contextSummaryAvailable: boolean;
};

/** Separate provider transport success from semantic widget extraction success. */
export function resolveStatusWidgetSyncAuxiliaryOutcome(input: {
  syncSpendAvailable: boolean;
  diagnostics?: Usage["statusWidgetExtractDiagnostics"];
}): {
  callResult: "success" | "failed" | "partial";
  extractionResult: "success" | "failed" | "partial" | null;
} {
  if (!input.syncSpendAvailable) {
    return { callResult: "partial", extractionResult: null };
  }
  const diagnostics = input.diagnostics;
  if (!diagnostics) {
    return { callResult: "success", extractionResult: null };
  }
  if (diagnostics.exhausted) {
    return { callResult: "success", extractionResult: "failed" };
  }
  const semanticSucceeded = diagnostics.attempts.some((attempt) => attempt.succeeded === true);
  if (semanticSucceeded) {
    return { callResult: "success", extractionResult: "success" };
  }
  if (diagnostics.attempts.length > 0) {
    return { callResult: "success", extractionResult: "partial" };
  }
  return { callResult: "success", extractionResult: null };
}

export function formatAdminReceiptAuxiliaryCallOutcome(call: AdminReceiptAuxiliaryCall): string {
  if (call.extractionResult === "failed" && call.result === "success") {
    return `${call.calls}회 호출 성공 · 추출 실패`;
  }
  if (call.extractionResult === "success" && call.result === "success") {
    return `${call.calls}회 성공`;
  }
  if (call.result === "success") {
    return `${call.calls}회 성공`;
  }
  if (call.result === "failed") {
    return `${call.calls}회 실패`;
  }
  return `${call.calls}회 partial`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function projectKnownTurnCostKrw(receipt: AdminBillingReceiptV3): number | null {
  const knownUsd = receipt.wholeTurn.knownProviderSpendUsd;
  const fx = receipt.wholeTurn.fx?.effectiveKrwPerUsd ?? null;
  if (!(knownUsd > 0) || fx == null) return null;
  return round1(convertUsdToKrw(knownUsd, fx));
}

/** Map a stored actual-cost source to an evidence-true Korean label. */
export function resolveMainRpCostProvenanceLabel(source: string | null | undefined): string | null {
  switch (source) {
    case "cheaper_inference_billed":
    case "cheaper_inference_usage_api":
      return "CI 실제 청구 원가";
    case "provider_reported":
      // CI + provider_reported is exactness=estimated in the canonical V2
      // semantics; "보고" states the evidence without overclaiming "실제 청구".
      return "Provider 보고 원가";
    case "live_catalog_estimated":
      // Uses the customer-facing discounted CI catalog rate.
      return "CI 할인 요율 추정 원가";
    case "live_catalog_partial":
      return "CI 할인 요율 부분 추정";
    case "published_fallback_estimated":
      // Uses the provider open-router fallback rate (not the Published user price).
      return "Provider 요율 추정 원가";
    case "unavailable":
      return null;
    default:
      return source ? `원가 출처: ${source}` : null;
  }
}

/**
 * Resolve the delivered model for an async family from its provider-ledger
 * events. Canonical preference: actual_model → requested_model → null.
 * If multiple distinct delivered models exist, return null (do not fabricate
 * a single model that contradicts the evidence).
 */
export function resolveAsyncFamilyModel(
  events:
    | Array<{ actualModel?: string | null; requestedModel?: string | null }>
    | undefined
    | null
): string | null {
  if (!events || events.length === 0) return null;
  const delivered = new Set<string>();
  for (const ev of events) {
    const m = ev.actualModel ?? ev.requestedModel;
    if (m) delivered.add(m);
  }
  if (delivered.size === 1) {
    return [...delivered][0] ?? null;
  }
  // Multiple distinct delivered models → cannot truthfully show one.
  return null;
}

/**
 * Resolve the transport/job event outcome for an async family from its
 * provider-ledger events. This is the CALL RESULT — independent of whether the
 * cost is exact/estimated. A successful provider call with an estimated cost is
 * still "success".
 */
export function resolveAsyncCallResult(
  events:
    | Array<{ eventStatus?: string | null }>
    | undefined
    | null,
  taskFailed?: boolean
): "success" | "failed" | "partial" {
  if (taskFailed === true) return "failed";
  if (!events || events.length === 0) return "partial";
  const failed = events.some((ev) => {
    const s = ev.eventStatus ?? "";
    return s === "failed_with_usage" || s === "failed_without_usage";
  });
  if (failed) return "failed";
  const hasSettled = events.some((ev) => {
    const s = ev.eventStatus ?? "";
    return s === "settled" || s === "completed_without_exact_cost";
  });
  return hasSettled ? "success" : "partial";
}

export type AdminReceiptMainRpCostEvidence = {
  costUsd: number | null;
  provenance: string | null;
  provenanceLabel: string | null;
};

/**
 * Select Main RP display cost as one evidence object — value, exactness, and
 * source must never come from different owners (ledger vs usage snapshot).
 */
export function resolveMainRpDisplayEvidence(
  receipt: AdminBillingReceiptV3
): AdminReceiptMainRpCostEvidence {
  const mainActual = receipt.syncReceipt?.mainRp?.actual ?? null;
  const whole = receipt.wholeTurn;

  if (whole.mainExact && whole.mainActualCostUsd != null) {
    return {
      costUsd: whole.mainActualCostUsd,
      provenance: whole.mainActualCostSource,
      provenanceLabel: resolveMainRpCostProvenanceLabel(whole.mainActualCostSource),
    };
  }

  if (mainActual?.exactness === "settled" && mainActual.actualProviderCostUsd != null) {
    return {
      costUsd: mainActual.actualProviderCostUsd,
      provenance: mainActual.actualCostSource,
      provenanceLabel: resolveMainRpCostProvenanceLabel(mainActual.actualCostSource),
    };
  }

  if (mainActual?.actualProviderCostUsd != null) {
    return {
      costUsd: mainActual.actualProviderCostUsd,
      provenance: mainActual.actualCostSource,
      provenanceLabel: resolveMainRpCostProvenanceLabel(mainActual.actualCostSource),
    };
  }

  const provenance = whole.mainActualCostSource ?? mainActual?.actualCostSource ?? null;
  return {
    costUsd: whole.mainActualCostUsd,
    provenance,
    provenanceLabel: resolveMainRpCostProvenanceLabel(provenance),
  };
}

/** Build the canonical compact view model from a receipt. */
export function buildAdminReceiptCompactViewModel(
  receipt: AdminBillingReceiptV3
): AdminReceiptCompactViewModel {
  const sync = receipt.syncReceipt;
  const mainRpModelIdentity = resolveAdminBillingReceiptV3MainRpModelIdentity(receipt);
  const mainEvidence = resolveMainRpDisplayEvidence(receipt);

  const mainRp: AdminReceiptMainRpCost = {
    model:
      mainRpModelIdentity.kind === "same"
        ? mainRpModelIdentity.selectedModelLabel
        : mainRpModelIdentity.kind === "different"
          ? mainRpModelIdentity.deliveredModel
          : null,
    costUsd: mainEvidence.costUsd,
    provenance: mainEvidence.provenance,
    provenanceLabel: mainEvidence.provenanceLabel,
  };

  const auxiliaryCalls: AdminReceiptAuxiliaryCall[] = [];
  // Sync platform spend (status widget extraction) is a real auxiliary provider call.
  const syncSpend = sync?.syncPlatformSpend;
  if (syncSpend?.status === "available" && (syncSpend.callCount ?? 1) > 0) {
    const widgetOutcome = resolveStatusWidgetSyncAuxiliaryOutcome({
      syncSpendAvailable: true,
      diagnostics: receipt.statusWidgetExtractDiagnostics,
    });
    const widgetLabel =
      syncSpend.groupLabel?.trim() ||
      (syncSpend.postTurnSharedInitial ? "공유 초기 (상태창 + 추천입력)" : "상태창 위젯");
    const syncLedgerEvent = receipt.syncPhysicalEvents?.[0] ?? null;
    auxiliaryCalls.push({
      label: widgetLabel,
      model:
        syncLedgerEvent?.actualModel ??
        syncLedgerEvent?.requestedModel ??
        syncSpend.modelLabel ??
        syncSpend.model ??
        null,
      calls: syncSpend.callCount ?? 1,
      result: widgetOutcome.callResult,
      extractionResult: widgetOutcome.extractionResult,
      costUsd:
        syncLedgerEvent?.actualCostUsd != null && syncLedgerEvent.actualCostUsd > 0
          ? syncLedgerEvent.actualCostUsd
          : syncSpend.actualProviderCostUsd != null && syncSpend.actualProviderCostUsd > 0
            ? syncSpend.actualProviderCostUsd
            : null,
      costProvenanceLabel: resolveMainRpCostProvenanceLabel(
        syncLedgerEvent?.actualCostSource ?? syncSpend.actualCostSource
      ),
      canonicalOwner: syncLedgerEvent?.canonicalOwner ?? null,
      requestKind: syncLedgerEvent?.requestKind ?? null,
      trigger: syncLedgerEvent?.trigger ?? null,
      attempt: syncLedgerEvent?.attempt ?? null,
      providerRequestId: syncLedgerEvent?.providerRequestId ?? null,
      costAttribution: syncLedgerEvent?.costAttribution ?? null,
    });
  }
  for (const family of receipt.async.byFamily) {
    // Only show jobs that actually made a physical provider call.
    if (family.physicalCallCount <= 0) continue;
    // Call result comes from the transport/job event outcome, NOT cost exactness.
    const familyEvents = family.family
      ? receipt.async.events?.filter((ev) => ev.family === family.family)
      : [];
    const result = resolveAsyncCallResult(familyEvents, family.taskFailed);
    const model = resolveAsyncFamilyModel(familyEvents);
    // A single settled cost source is the family's provenance; known-but-mixed
    // sources keep a neutral label rather than a fabricated one.
    const costSources = new Set(
      (familyEvents ?? [])
        .map((ev) => ev.actualCostSource?.trim())
        .filter((s): s is string => Boolean(s))
    );
    const provenanceLabel =
      costSources.size === 1 ? resolveMainRpCostProvenanceLabel([...costSources][0]) : null;
    const firstEvent = familyEvents?.[0];
    auxiliaryCalls.push({
      label: family.label,
      model,
      calls: family.physicalCallCount,
      result,
      costUsd: family.knownActualCostUsd > 0 ? family.knownActualCostUsd : null,
      costProvenanceLabel: provenanceLabel,
      canonicalOwner: firstEvent?.canonicalOwner ?? null,
      requestKind: firstEvent?.requestKind ?? null,
      trigger: firstEvent?.trigger ?? null,
      attempt: firstEvent?.attempt ?? null,
      providerRequestId: firstEvent?.providerRequestId ?? null,
      costAttribution: firstEvent?.costAttribution ?? "turn_attributable_async",
    });
  }

  // Complete total is provable only when whole-turn coverage is complete and
  // exact (includes Main RP + sync + async, all settled).
  const hasCompleteTotal = receipt.wholeTurn.coverage === "complete";
  const completeTotalUsd = hasCompleteTotal ? receipt.wholeTurn.exactProviderSpendUsd : null;
  const turnSummary = buildAdminReceiptTurnSummary(receipt);
  const knownTurnCostUsd =
    receipt.wholeTurn.knownProviderSpendUsd > 0 ? receipt.wholeTurn.knownProviderSpendUsd : null;

  return {
    mainRp,
    deductedPoints:
      sync != null
        ? (sync.userCharge.settledDeductedPoints ?? sync.userCharge.deductedPoints)
        : receipt.forensic?.chargeEvidenceSettledPoints ?? null,
    auxiliaryCalls,
    hasCompleteTotal,
    completeTotalUsd,
    knownTurnCostUsd,
    knownTurnCostKrw: projectKnownTurnCostKrw(receipt),
    turnCostCoverage: receipt.wholeTurn.coverage,
    marginPercent: turnSummary.marginPercent,
    marginUnavailableReason: turnSummary.marginUnavailableReason,
    contextSummaryAvailable: false,
  };
}

export function wholeTurnCoverageLabel(
  coverage: AdminBillingReceiptV3WholeTurnCoverage
): string {
  switch (coverage) {
    case "complete":
      return "확정";
    case "pending":
      return "처리 중";
    case "partial":
      return "부분 수집";
    case "unverifiable":
      return "검증 불가";
    default: {
      const _exhaustive: never = coverage;
      return _exhaustive;
    }
  }
}

export function formatAdminBillingReceiptV3Text(receipt: AdminBillingReceiptV3): string {
  const fxRate = receipt.wholeTurn.fx?.effectiveKrwPerUsd ?? null;
  const fxSuffix = (usd: number | null | undefined): string => {
    const krw = formatAdminKrwFromUsd(usd, fxRate);
    return krw == null ? "" : ` (${krw})`;
  };
  const mainRpModelIdentity = resolveAdminBillingReceiptV3MainRpModelIdentity(receipt);
  const vm = buildAdminReceiptCompactViewModel(receipt);

  const lines: string[] = [
    "Admin Receipt v3",
    ...formatAdminBillingReceiptV3MainRpModelLines(mainRpModelIdentity),
  ];
  if (receipt.historicalNote) lines.push(receipt.historicalNote);

  lines.push("", "[Main RP]");
  if (vm.mainRp.provenanceLabel && vm.mainRp.costUsd != null) {
    lines.push(
      `${vm.mainRp.provenanceLabel}: ${formatAdminActualUsd(vm.mainRp.costUsd)}${fxSuffix(vm.mainRp.costUsd)}`
    );
  }

  if (receipt.syncReceipt != null) {
    lines.push("", "[차감]");
    lines.push(
      `실제 차감: ${vm.deductedPoints != null ? `${formatPoints(vm.deductedPoints)} P` : "확인 불가"}`
    );
    if (vm.hasCompleteTotal && vm.completeTotalUsd != null) {
      lines.push(
        `총 실제 청구원가: ${formatAdminActualUsd(vm.completeTotalUsd)}${fxSuffix(vm.completeTotalUsd)}`
      );
      if (vm.marginPercent != null) {
        lines.push(`마진율: ${vm.marginPercent}%`);
      }
    } else if (vm.knownTurnCostUsd != null && vm.knownTurnCostKrw != null) {
      lines.push(
        `확정 원가 (부분): ${formatAdminActualUsd(vm.knownTurnCostUsd)}${fxSuffix(vm.knownTurnCostUsd)} · ${wholeTurnCoverageLabel(vm.turnCostCoverage)}`
      );
      if (vm.marginUnavailableReason) {
        lines.push(`마진율: 계산 불가 (${vm.marginUnavailableReason})`);
      }
    } else if (vm.marginUnavailableReason) {
      lines.push(`마진율: 계산 불가 (${vm.marginUnavailableReason})`);
    }
  }

  if (vm.auxiliaryCalls.length > 0) {
    lines.push("", "[이번 턴 보조 호출]");
    for (const call of vm.auxiliaryCalls) {
      const model = call.model ? ` · ${call.model}` : "";
      const cost = call.costUsd != null ? ` · ${formatAdminActualUsd(call.costUsd)}${fxSuffix(call.costUsd)}` : "";
      const prov = call.costProvenanceLabel ? ` (${call.costProvenanceLabel})` : "";
      lines.push(
        `${call.label}:${model} · ${formatAdminReceiptAuxiliaryCallOutcome(call)}${cost}${prov}`
      );
    }
  }

  if (vm.hasCompleteTotal && vm.completeTotalUsd != null) {
    lines.push("", "[이번 턴 확인 원가]");
    lines.push(`합계: ${formatAdminActualUsd(vm.completeTotalUsd)}${fxSuffix(vm.completeTotalUsd)}`);
  }

  return lines.join("\n");
}
