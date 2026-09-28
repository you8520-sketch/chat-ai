/**
 * Phase C.1 — read-only diagnostic analyzer for Gemini 3.1 CI TTFT benchmarks.
 * No production behavior changes.
 */

export type FixtureKind = "A" | "B" | "C";

export type CacheDropClass =
  | "EXPECTED"
  | "UNEXPECTED"
  | "PROVIDER_VARIANCE"
  | "NOT_MEASURABLE"
  | "NONE";

export type SummaryOverlap = "NONE" | "OBSERVED";
export type SummaryContentionVerdict = "YES" | "NO_EVIDENCE" | "INCONCLUSIVE";

export type PhaseCTurnRecord = {
  fixture: FixtureKind;
  turnIndex: number;
  chatId: number;
  userMessage: string;
  clientSubmitMs: number;
  prompt_tokens: number | null;
  cached_tokens: number | null;
  /** Explicit provider cache-read reporting (diagnostic); null = unknown in legacy artifacts */
  cache_read_tokens_reported?: boolean | null;
  uncached_tokens: number | null;
  cache_ratio: number | null;
  reasoning_tokens: number | null;
  provider_completion_tokens: number | null;
  visible_chars: number | null;
  user_charge_points: number | null;
  provider_billed_cost_usd: number | null;
  visible_ttft_ms: number | null;
  provider_first_sse_ms: number | null;
  provider_wait_ms: number | null;
  pre_visible_gap_ms: number | null;
  total_latency_ms: number | null;
  pre_provider_ms: number | null;
  memory_sync_to_canon_ms: number | null;
  summary_contention_active: boolean;
  summary_active_count: number;
  catch_up_scheduled_count: number;
  first_changed_section: string | null;
  first_changed_position: number | null;
  order_change_detected: boolean;
  unchanged_prefix_sections: number;
  unchanged_count: number;
  section_count: number;
  cache_drop_class: CacheDropClass;
  cache_drop_tokens: number | null;
  httpStatus: number;
  error?: string;
  /** Legacy artifact fields (ignored after normalize) */
  ttft_ms?: number | null;
  visible_output_tokens?: number | null;
  billed_cost_usd?: number | null;
  summary_barrier_ms?: number | null;
};

export type CacheReportingStatus = "AVAILABLE" | "UNAVAILABLE" | "PARSER_DROPPED";

export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function stats(nums: (number | null | undefined)[]) {
  const valid = nums.filter((n): n is number => n != null && Number.isFinite(n));
  if (!valid.length) return { min: null, median: null, max: null, n: 0 };
  return {
    min: Math.min(...valid),
    median: median(valid),
    max: Math.max(...valid),
    n: valid.length,
  };
}

/** Normalize legacy Phase C collector rows to corrected semantics. */
export function normalizeLegacyTurnRecord(raw: Record<string, unknown>): PhaseCTurnRecord {
  const cachedRaw = raw.cached_tokens;
  const cacheReported =
    raw.cache_read_tokens_reported === true
      ? true
      : raw.cache_read_tokens_reported === false
        ? false
        : cachedRaw != null
          ? true
          : null;

  const cacheAvailable = cacheReported === true && cachedRaw != null;

  const promptTokens =
    typeof raw.prompt_tokens === "number" ? raw.prompt_tokens : null;

  let cacheRatio: number | null = null;
  let uncached: number | null = null;
  if (cacheAvailable && promptTokens != null && typeof cachedRaw === "number") {
    cacheRatio =
      promptTokens > 0 ? Math.round((cachedRaw / promptTokens) * 1000) / 1000 : null;
    uncached = Math.max(0, promptTokens - cachedRaw);
  }

  const visibleTtft =
    typeof raw.provider_visible_ttft_ms === "number"
      ? raw.provider_visible_ttft_ms
      : typeof raw.visible_ttft_ms === "number"
        ? raw.visible_ttft_ms
        : typeof raw.ttft_ms === "number"
          ? raw.ttft_ms
          : null;

  const providerWait =
    typeof raw.provider_wait_ms === "number"
      ? raw.provider_wait_ms
      : typeof raw.provider_first_sse_ms === "number"
        ? raw.provider_first_sse_ms
        : null;

  const providerFirstSse =
    typeof raw.provider_first_sse_ms === "number" ? raw.provider_first_sse_ms : providerWait;

  const preVisibleGap =
    visibleTtft != null && providerFirstSse != null
      ? Math.max(0, visibleTtft - providerFirstSse)
      : typeof raw.pre_visible_gap_ms === "number"
        ? raw.pre_visible_gap_ms
        : null;

  const legacyDrop = String(raw.cache_drop_class ?? "");
  let cacheDrop: CacheDropClass = "NOT_MEASURABLE";
  if (cacheAvailable) {
    cacheDrop =
      legacyDrop === "EXPECTED" ||
      legacyDrop === "UNEXPECTED" ||
      legacyDrop === "PROVIDER_VARIANCE" ||
      legacyDrop === "NONE"
        ? (legacyDrop as CacheDropClass)
        : "NOT_MEASURABLE";
  }

  return {
    fixture: raw.fixture as FixtureKind,
    turnIndex: Number(raw.turnIndex),
    chatId: Number(raw.chatId),
    userMessage: String(raw.userMessage ?? ""),
    clientSubmitMs: Number(raw.clientSubmitMs),
    prompt_tokens: promptTokens,
    cached_tokens: cacheAvailable ? (cachedRaw as number) : null,
    cache_read_tokens_reported: cacheReported,
    uncached_tokens: uncached,
    cache_ratio: cacheRatio,
    reasoning_tokens:
      typeof raw.reasoning_tokens === "number" ? raw.reasoning_tokens : null,
    provider_completion_tokens:
      typeof raw.provider_completion_tokens === "number"
        ? raw.provider_completion_tokens
        : typeof raw.visible_output_tokens === "number"
          ? raw.visible_output_tokens
          : null,
    visible_chars: typeof raw.visible_chars === "number" ? raw.visible_chars : null,
    user_charge_points:
      typeof raw.user_charge_points === "number"
        ? raw.user_charge_points
        : typeof raw.billed_cost_usd === "number"
          ? raw.billed_cost_usd
          : null,
    provider_billed_cost_usd:
      typeof raw.provider_billed_cost_usd === "number"
        ? raw.provider_billed_cost_usd
        : null,
    visible_ttft_ms: visibleTtft,
    provider_first_sse_ms: providerFirstSse,
    provider_wait_ms: providerWait,
    pre_visible_gap_ms: preVisibleGap,
    total_latency_ms:
      typeof raw.total_latency_ms === "number" ? raw.total_latency_ms : null,
    pre_provider_ms:
      typeof raw.pre_provider_ms === "number" ? raw.pre_provider_ms : null,
    memory_sync_to_canon_ms:
      typeof raw.memory_sync_to_canon_ms === "number"
        ? raw.memory_sync_to_canon_ms
        : typeof raw.summary_barrier_ms === "number"
          ? raw.summary_barrier_ms
          : null,
    summary_contention_active: Boolean(raw.summary_contention_active),
    summary_active_count: Number(raw.summary_active_count ?? 0),
    catch_up_scheduled_count: Number(raw.catch_up_scheduled_count ?? 0),
    first_changed_section:
      typeof raw.first_changed_section === "string" ? raw.first_changed_section : null,
    first_changed_position:
      typeof raw.first_changed_position === "number" ? raw.first_changed_position : null,
    order_change_detected: Boolean(raw.order_change_detected),
    unchanged_prefix_sections: Number(raw.unchanged_prefix_sections ?? 0),
    unchanged_count: Number(raw.unchanged_count ?? 0),
    section_count: Number(raw.section_count ?? 0),
    cache_drop_class: cacheDrop,
    cache_drop_tokens:
      typeof raw.cache_drop_tokens === "number" ? raw.cache_drop_tokens : null,
    httpStatus: Number(raw.httpStatus ?? 0),
    ...(typeof raw.error === "string" ? { error: raw.error } : {}),
  };
}

export function classifyCacheDrop(
  prev: PhaseCTurnRecord | null,
  curr: PhaseCTurnRecord
): CacheDropClass {
  if (curr.cache_read_tokens_reported !== true || curr.cached_tokens == null) {
    return "NOT_MEASURABLE";
  }
  if (prev == null || prev.cached_tokens == null) return "NONE";
  if (curr.cached_tokens >= prev.cached_tokens) return "NONE";

  const drop = prev.cached_tokens - curr.cached_tokens;
  curr.cache_drop_tokens = drop;
  const fp = curr.first_changed_section ?? "";

  if (
    /layout-recency|persona-reference|memory|episodic|dynamic|user-persona|current-user|lore|status|relationship-meta/i.test(
      fp
    )
  ) {
    return "EXPECTED";
  }
  if (curr.order_change_detected) return "EXPECTED";

  if (
    curr.first_changed_position != null &&
    curr.first_changed_position <= 2 &&
    /korean-prose|contamination|godmodding|character-core|identity-and-rules|prose-style|openrouter/i.test(
      fp
    )
  ) {
    return "UNEXPECTED";
  }

  if (drop > 0 && curr.unchanged_prefix_sections >= (prev.unchanged_prefix_sections ?? 0)) {
    return "PROVIDER_VARIANCE";
  }

  return "NOT_MEASURABLE";
}

export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let denx = 0;
  let deny = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    denx += (xs[i]! - mx) ** 2;
    deny += (ys[i]! - my) ** 2;
  }
  const den = Math.sqrt(denx * deny);
  return den > 0 ? Math.round((num / den) * 10000) / 10000 : null;
}

function rankValues(values: number[]): number[] {
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < indexed.length; ) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.v === indexed[i]!.v) j++;
    const avgRank = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[indexed[k]!.i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

export function spearmanCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  return pearsonCorrelation(rankValues(xs), rankValues(ys));
}

export function assessCacheReporting(turns: PhaseCTurnRecord[]): CacheReportingStatus {
  const anyReported = turns.some((t) => t.cache_read_tokens_reported === true);
  const anyExplicitNull = turns.some(
    (t) => t.cache_read_tokens_reported === false || (t.cached_tokens == null && t.cache_ratio === 0)
  );
  if (anyReported) return "AVAILABLE";
  if (anyExplicitNull || turns.every((t) => t.cached_tokens == null)) return "UNAVAILABLE";
  return "PARSER_DROPPED";
}

export function assessSummaryOverlap(turns: PhaseCTurnRecord[]): SummaryOverlap {
  return turns.some((t) => t.summary_contention_active) ? "OBSERVED" : "NONE";
}

/** Contention requires overlap + materially slower active group after basic confound check. */
export function assessSummaryContention(
  turns: PhaseCTurnRecord[],
  opts?: { materialRatio?: number; minActive?: number }
): SummaryContentionVerdict {
  const materialRatio = opts?.materialRatio ?? 1.2;
  const minActive = opts?.minActive ?? 3;

  const active = turns.filter((t) => t.summary_contention_active);
  const inactive = turns.filter((t) => !t.summary_contention_active);
  if (active.length === 0) return "NO_EVIDENCE";
  if (active.length < minActive) return "INCONCLUSIVE";

  const activeTtft = active.map((t) => t.visible_ttft_ms).filter((n): n is number => n != null);
  const inactiveTtft = inactive.map((t) => t.visible_ttft_ms).filter((n): n is number => n != null);
  const activeP50 = median(activeTtft);
  const inactiveP50 = median(inactiveTtft);
  if (activeP50 == null || inactiveP50 == null) return "INCONCLUSIVE";

  const activeReasoning = median(
    active.map((t) => t.reasoning_tokens).filter((n): n is number => n != null)
  );
  const inactiveReasoning = median(
    inactive.map((t) => t.reasoning_tokens).filter((n): n is number => n != null)
  );
  const reasoningConfound =
    activeReasoning != null &&
    inactiveReasoning != null &&
    inactiveReasoning > 0 &&
    activeReasoning / inactiveReasoning > 1.25;

  if (activeP50 <= inactiveP50 * materialRatio || reasoningConfound) {
    return "NO_EVIDENCE";
  }

  const byFixture = new Map<FixtureKind, { active: number[]; inactive: number[] }>();
  for (const t of turns) {
    const bucket = byFixture.get(t.fixture) ?? { active: [], inactive: [] };
    if (t.visible_ttft_ms == null) continue;
    if (t.summary_contention_active) bucket.active.push(t.visible_ttft_ms);
    else bucket.inactive.push(t.visible_ttft_ms);
    byFixture.set(t.fixture, bucket);
  }
  let repeats = 0;
  for (const { active: a, inactive: i } of byFixture.values()) {
    const aP = median(a);
    const iP = median(i);
    if (aP != null && iP != null && aP > iP * materialRatio && a.length >= 2) repeats++;
  }
  if (repeats >= 2) return "YES";
  return "INCONCLUSIVE";
}

export function summarizeSummaryGroups(turns: PhaseCTurnRecord[]) {
  const active = turns.filter((t) => t.summary_contention_active);
  const inactive = turns.filter((t) => !t.summary_contention_active);
  return {
    SUMMARY_ACTIVE_N: active.length,
    SUMMARY_INACTIVE_N: inactive.length,
    ACTIVE_TTFT: stats(active.map((t) => t.visible_ttft_ms)),
    INACTIVE_TTFT: stats(inactive.map((t) => t.visible_ttft_ms)),
    ACTIVE_REASONING_TOKENS: stats(active.map((t) => t.reasoning_tokens)),
    INACTIVE_REASONING_TOKENS: stats(inactive.map((t) => t.reasoning_tokens)),
    ACTIVE_PROMPT_TOKENS: stats(active.map((t) => t.prompt_tokens)),
    INACTIVE_PROMPT_TOKENS: stats(inactive.map((t) => t.prompt_tokens)),
  };
}

export function correlationByFixture(turns: PhaseCTurnRecord[]) {
  const all = turns.filter((t) => t.visible_ttft_ms != null && t.reasoning_tokens != null);
  const byFixture: Partial<Record<FixtureKind, PhaseCTurnRecord[]>> = {};
  for (const t of turns) {
    (byFixture[t.fixture] ??= []).push(t);
  }
  const fixtureCorr: Record<string, { pearson: number | null; spearman: number | null; n: number }> =
    {};
  for (const [f, rows] of Object.entries(byFixture)) {
    const pairs = rows.filter((t) => t.visible_ttft_ms != null && t.reasoning_tokens != null);
    fixtureCorr[f] = {
      n: pairs.length,
      pearson: pearsonCorrelation(
        pairs.map((p) => p.visible_ttft_ms!),
        pairs.map((p) => p.reasoning_tokens!)
      ),
      spearman: spearmanCorrelation(
        pairs.map((p) => p.visible_ttft_ms!),
        pairs.map((p) => p.reasoning_tokens!)
      ),
    };
  }
  return {
    ALL: {
      n: all.length,
      pearson: pearsonCorrelation(
        all.map((p) => p.visible_ttft_ms!),
        all.map((p) => p.reasoning_tokens!)
      ),
      spearman: spearmanCorrelation(
        all.map((p) => p.visible_ttft_ms!),
        all.map((p) => p.reasoning_tokens!)
      ),
    },
    ...fixtureCorr,
  };
}

export type PhaseC1Diagnosis = {
  GEMINI31_CI_PHASE_C1_ROOT_CAUSE: {
    PRODUCTION_CHANGED: "NO";
    EXISTING_PHASE_C_DIAGNOSIS_CORRECTED: "YES";
    CACHE_READ_REPORTING: CacheReportingStatus;
    CACHE_RATIO: number | "NOT_MEASURABLE";
    CI_EXACT_MATCH_CACHE: "separate_unavailable_in_artifacts";
    BACKGROUND_SUMMARY_OVERLAP: SummaryOverlap;
    BACKGROUND_SUMMARY_CONTENTION: SummaryContentionVerdict;
    COUNT_MISMATCH_ROOT_CAUSE?: string;
    summary_groups: ReturnType<typeof summarizeSummaryGroups>;
    TTFT_VS_REASONING: ReturnType<typeof correlationByFixture>;
    PROVIDER_WAIT_P50: number | null;
    VISIBLE_TTFT_P50: number | null;
    PRE_VISIBLE_GAP_P50: number | null;
    HIGH_PROVIDER_SIDE_PRE_VISIBLE_LATENCY: "YES" | "NO";
    PRIMARY_PRE_VISIBLE_LATENCY_OWNER:
      | "CI_GATEWAY_QUEUE"
      | "UPSTREAM_PREFILL"
      | "HIDDEN_REASONING"
      | "CACHE_PREFILL"
      | "MIXED"
      | "UNKNOWN";
    CI_SERVING_FLOOR: "CONFIRMED" | "NOT_CONFIRMED" | "UNKNOWN";
    COST_FIELD_SEMANTICS: string;
    VISIBLE_TOKEN_FIELD_SEMANTICS: string;
    MEMORY_SYNC_TO_CANON_SEMANTICS: string;
    ROOT_CAUSE_STATUS: "ROOT_CAUSE_CONFIRMED_READ_ONLY" | "ROOT_CAUSE_UNCONFIRMED";
    NEXT_RECOMMENDATION: string;
  };
};

export function buildPhaseC1Diagnosis(
  turns: PhaseCTurnRecord[],
  opts?: {
    legacyReportContentionCount?: number;
    stageTimingAvailable?: boolean;
  }
): PhaseC1Diagnosis {
  const cacheReporting = assessCacheReporting(turns);
  const overlap = assessSummaryOverlap(turns);
  const contention = assessSummaryContention(turns);
  const summaryGroups = summarizeSummaryGroups(turns);
  const correlations = correlationByFixture(turns);

  const visibleP50 = median(
    turns.map((t) => t.visible_ttft_ms).filter((n): n is number => n != null)
  );
  const waitP50 = median(
    turns.map((t) => t.provider_wait_ms).filter((n): n is number => n != null)
  );
  const gapP50 = median(
    turns.map((t) => t.pre_visible_gap_ms).filter((n): n is number => n != null)
  );

  const highPreVisible = visibleP50 != null && visibleP50 >= 30_000 ? "YES" : "NO";

  let primaryOwner:
    | "CI_GATEWAY_QUEUE"
    | "UPSTREAM_PREFILL"
    | "HIDDEN_REASONING"
    | "CACHE_PREFILL"
    | "MIXED"
    | "UNKNOWN" = "UNKNOWN";

  const pearsonAll = correlations.ALL.pearson;
  const stageAvailable = opts?.stageTimingAvailable ?? waitP50 != null;

  if (stageAvailable && waitP50 != null && visibleP50 != null) {
    if (waitP50 >= 25_000 && (gapP50 ?? 0) < waitP50 * 0.35) {
      primaryOwner = "CI_GATEWAY_QUEUE";
    } else if ((gapP50 ?? 0) >= 15_000 && pearsonAll != null && pearsonAll > 0.6) {
      primaryOwner = "HIDDEN_REASONING";
    } else if (waitP50 >= 15_000 && (gapP50 ?? 0) >= 5_000) {
      primaryOwner = "MIXED";
    } else if (waitP50 >= 15_000) {
      primaryOwner = "UPSTREAM_PREFILL";
    }
  } else if (pearsonAll != null && pearsonAll > 0.7) {
    primaryOwner = "HIDDEN_REASONING";
  } else if (visibleP50 != null && visibleP50 >= 30_000) {
    primaryOwner = "CI_GATEWAY_QUEUE";
  }

  const ciServingFloor =
    waitP50 != null && waitP50 >= 30_000
      ? "CONFIRMED"
      : visibleP50 != null && visibleP50 >= 30_000 && !stageAvailable
        ? "UNKNOWN"
        : "NOT_CONFIRMED";

  const cacheRatioMedian = median(
    turns.map((t) => t.cache_ratio).filter((n): n is number => n != null)
  );

  let countMismatch: string | undefined;
  if (
    opts?.legacyReportContentionCount != null &&
    opts.legacyReportContentionCount !== summaryGroups.SUMMARY_ACTIVE_N
  ) {
    countMismatch =
      `Legacy report used all-fixture overlap count (${opts.legacyReportContentionCount}) ` +
      `without per-fixture breakdown; fixture C alone is ${turns.filter((t) => t.fixture === "C" && t.summary_contention_active).length}/${turns.filter((t) => t.fixture === "C").length} active.`;
  }

  const rootConfirmed =
    primaryOwner !== "UNKNOWN" || (pearsonAll != null && pearsonAll > 0.6)
      ? "ROOT_CAUSE_CONFIRMED_READ_ONLY"
      : "ROOT_CAUSE_UNCONFIRMED";

  let nextRec = "Enable provider cache-read reporting; re-run stage decomposition with PROVIDER_WAIT_MS captured.";
  if (primaryOwner === "HIDDEN_REASONING") {
    nextRec =
      "Investigate hidden reasoning pre-visible generation (reasoning_effort=low still produces large reasoning_tokens). Do NOT change reasoning yet.";
  } else if (primaryOwner === "CI_GATEWAY_QUEUE") {
    nextRec = "Investigate CI gateway/queue capacity separately from Gemini prefix cache.";
  } else if (contention === "NO_EVIDENCE") {
    nextRec = "Do not optimize summary scheduler for TTFT — overlap observed without contention evidence.";
  }

  return {
    GEMINI31_CI_PHASE_C1_ROOT_CAUSE: {
      PRODUCTION_CHANGED: "NO",
      EXISTING_PHASE_C_DIAGNOSIS_CORRECTED: "YES",
      CACHE_READ_REPORTING: cacheReporting,
      CACHE_RATIO: cacheRatioMedian ?? "NOT_MEASURABLE",
      CI_EXACT_MATCH_CACHE: "separate_unavailable_in_artifacts",
      BACKGROUND_SUMMARY_OVERLAP: overlap,
      BACKGROUND_SUMMARY_CONTENTION: contention,
      ...(countMismatch ? { COUNT_MISMATCH_ROOT_CAUSE: countMismatch } : {}),
      summary_groups: summaryGroups,
      TTFT_VS_REASONING: correlations,
      PROVIDER_WAIT_P50: waitP50,
      VISIBLE_TTFT_P50: visibleP50,
      PRE_VISIBLE_GAP_P50: gapP50,
      HIGH_PROVIDER_SIDE_PRE_VISIBLE_LATENCY: highPreVisible,
      PRIMARY_PRE_VISIBLE_LATENCY_OWNER: primaryOwner,
      CI_SERVING_FLOOR: ciServingFloor,
      COST_FIELD_SEMANTICS:
        "route done.cost = settlement.settledPoints (user_charge_points); legacy billed_cost_usd mislabeled",
      VISIBLE_TOKEN_FIELD_SEMANTICS:
        "provider_completion_tokens = phase audit completion_tokens (includes reasoning in provider total); visible_chars from stream; no separate visible-only token owner",
      MEMORY_SYNC_TO_CANON_SEMANTICS:
        "legacy summary_barrier_ms = T4_MEMORY_SYNC_DONE→T5_CANON_START (post-#718 non-blocking; not summary LLM barrier)",
      ROOT_CAUSE_STATUS: rootConfirmed,
      NEXT_RECOMMENDATION: nextRec,
    },
  };
}

/** Extract turn fields from phase_latency_audit report + done SSE (collector helper). */
export function extractTurnFromPhaseReport(opts: {
  phaseReport: Record<string, unknown> | null;
  doneUsage: Record<string, unknown> | null;
  doneCost: number | null;
  doneProviderBilledUsd: number | null;
  visibleChars: number;
  clientSubmitMs: number;
  firstDeltaMs: number | null;
}): Pick<
  PhaseCTurnRecord,
  | "prompt_tokens"
  | "cached_tokens"
  | "cache_read_tokens_reported"
  | "uncached_tokens"
  | "cache_ratio"
  | "reasoning_tokens"
  | "provider_completion_tokens"
  | "visible_chars"
  | "user_charge_points"
  | "provider_billed_cost_usd"
  | "visible_ttft_ms"
  | "provider_first_sse_ms"
  | "provider_wait_ms"
  | "pre_visible_gap_ms"
  | "pre_provider_ms"
  | "memory_sync_to_canon_ms"
  | "summary_contention_active"
  | "summary_active_count"
  | "catch_up_scheduled_count"
  | "first_changed_section"
  | "first_changed_position"
  | "order_change_detected"
  | "unchanged_prefix_sections"
  | "unchanged_count"
  | "section_count"
> {
  const tokens = (opts.phaseReport?.tokens ?? {}) as Record<string, unknown>;
  const fp = (opts.phaseReport?.prompt_section_fingerprint ?? {}) as Record<string, unknown>;
  const sc = (opts.phaseReport?.summary_contention ?? {}) as Record<string, unknown>;

  let promptTokens =
    typeof tokens.prompt_tokens === "number" ? tokens.prompt_tokens : null;
  let cachedTokens: number | null = null;
  let cacheReported: boolean | null = null;

  const doneHasCacheField =
    opts.doneUsage != null &&
    ("cacheReadTokens" in opts.doneUsage || "cachedContentTokens" in opts.doneUsage);

  if (doneHasCacheField && opts.doneUsage) {
    cachedTokens = Number(
      opts.doneUsage.cacheReadTokens ?? opts.doneUsage.cachedContentTokens ?? 0
    );
    cacheReported = Number.isFinite(cachedTokens);
  } else if (typeof tokens.cached_tokens === "number" && doneHasCacheField) {
    cachedTokens = tokens.cached_tokens;
    cacheReported = true;
  } else {
    cacheReported = doneHasCacheField ? false : null;
  }

  let cacheRatio: number | null = null;
  let uncached: number | null = null;
  if (cacheReported === true && cachedTokens != null && promptTokens != null && promptTokens > 0) {
    cacheRatio = Math.round((cachedTokens / promptTokens) * 1000) / 1000;
    uncached = Math.max(0, promptTokens - cachedTokens);
  }

  const providerWait =
    typeof opts.phaseReport?.PROVIDER_WAIT_MS === "number"
      ? opts.phaseReport.PROVIDER_WAIT_MS
      : null;
  const visibleTtft =
    typeof opts.phaseReport?.PROVIDER_VISIBLE_TTFT_MS === "number"
      ? opts.phaseReport.PROVIDER_VISIBLE_TTFT_MS
      : opts.firstDeltaMs;
  const preVisibleGap =
    visibleTtft != null && providerWait != null ? Math.max(0, visibleTtft - providerWait) : null;

  return {
    prompt_tokens: promptTokens,
    cached_tokens: cacheReported === true ? cachedTokens : null,
    cache_read_tokens_reported: cacheReported,
    uncached_tokens: uncached,
    cache_ratio: cacheRatio,
    reasoning_tokens:
      typeof tokens.reasoning_tokens === "number"
        ? tokens.reasoning_tokens
        : opts.doneUsage && typeof opts.doneUsage.apiReasoningOutputTokens === "number"
          ? opts.doneUsage.apiReasoningOutputTokens
          : null,
    provider_completion_tokens:
      typeof tokens.completion_tokens === "number" ? tokens.completion_tokens : null,
    visible_chars: opts.visibleChars,
    user_charge_points: opts.doneCost,
    provider_billed_cost_usd: opts.doneProviderBilledUsd,
    visible_ttft_ms: visibleTtft,
    provider_first_sse_ms: providerWait,
    provider_wait_ms: providerWait,
    pre_visible_gap_ms: preVisibleGap,
    pre_provider_ms:
      typeof opts.phaseReport?.PRE_PROVIDER_TOTAL_MS === "number"
        ? opts.phaseReport.PRE_PROVIDER_TOTAL_MS
        : null,
    memory_sync_to_canon_ms:
      typeof opts.phaseReport?.SUMMARY_BARRIER_WAIT_MS === "number"
        ? opts.phaseReport.SUMMARY_BARRIER_WAIT_MS
        : null,
    summary_contention_active: Boolean(sc.summaryBackgroundActiveAtProviderStart),
    summary_active_count: Number(sc.summaryActiveCount ?? 0),
    catch_up_scheduled_count: Number(sc.catchUpScheduledCount ?? 0),
    first_changed_section:
      typeof fp.first_changed_section === "string" ? fp.first_changed_section : null,
    first_changed_position:
      typeof fp.first_changed_position === "number" ? fp.first_changed_position : null,
    order_change_detected: Boolean(fp.order_change_detected),
    unchanged_prefix_sections: Number(fp.unchanged_prefix_sections ?? 0),
    unchanged_count: Number(fp.unchanged_count ?? 0),
    section_count: Number(fp.section_count ?? 0),
  };
}
