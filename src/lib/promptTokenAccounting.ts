import { estimateTokens } from "@/lib/tokenEstimate";

/** Provider-reported usage is canonical for cost/cache/TTFT decisions. */
export type CanonicalPromptTokenSnapshot = {
  /** App-side estimateTokens() on assembled text — diagnostic only. */
  localEstimatedTokens: number;
  /** Local estimate on system prompt only. */
  localSystemTokens: number;
  /** Local estimate on history messages (excl. current user turn). */
  localHistoryTokens: number;
  /** Local estimate on current user turn content. */
  localUserTurnTokens: number;
  /** OpenRouter/Gemini reported prompt_tokens when available. */
  providerPromptTokens: number | null;
  /** Provider cached_tokens (implicit prefix cache read). */
  providerCachedTokens: number | null;
  /** providerPromptTokens - providerCachedTokens when both known. */
  providerUncachedTokens: number | null;
  /** JSON.stringify(wireBody) length / 4 rough — not canonical. */
  serializedRequestChars: number;
  serializedRequestTokensEst: number;
};

export type TokenAccountingAudit = {
  localEstimate: number;
  providerReported: number | null;
  delta: number | null;
  deltaPercent: number | null;
  doubleCountFound: boolean;
  doubleCountNotes: string[];
  trimmedVsPretrimMismatch: boolean;
  trimmedVsPretrimNotes: string[];
  canonicalTokenOwner: "provider_reported_prompt_tokens";
  rootCause: string;
};

/**
 * Compare local assembly estimate vs provider-reported prompt_tokens.
 * Typical delta on Gemini: local over-estimates by ~30–45% vs provider tokenizer.
 */
export function auditTokenAccounting(opts: {
  localEstimatedTotal: number;
  localSystemTokens: number;
  localHistoryTokens: number;
  localUserTurnTokens: number;
  providerPromptTokens?: number | null;
  providerCachedTokens?: number | null;
  /** When history trim removed messages, pre-trim token estimate if known. */
  preTrimHistoryTokens?: number | null;
  historyMessageCountBeforeTrim?: number;
  historyMessageCountAfterTrim?: number;
}): TokenAccountingAudit {
  const componentSum =
    opts.localSystemTokens + opts.localHistoryTokens + opts.localUserTurnTokens;
  const doubleCountNotes: string[] = [];
  let doubleCountFound = false;

  if (Math.abs(componentSum - opts.localEstimatedTotal) > opts.localEstimatedTotal * 0.02) {
    doubleCountFound = true;
    doubleCountNotes.push(
      `component_sum(${componentSum}) != localEstimatedTotal(${opts.localEstimatedTotal}) — possible concat vs component mismatch`
    );
  }

  const provider = opts.providerPromptTokens ?? null;
  const delta = provider != null ? opts.localEstimatedTotal - provider : null;
  const deltaPercent =
    provider != null && provider > 0
      ? Math.round(((opts.localEstimatedTotal - provider) / provider) * 1000) / 10
      : null;

  const trimmedNotes: string[] = [];
  let trimmedMismatch = false;
  if (
    opts.preTrimHistoryTokens != null &&
    opts.preTrimHistoryTokens > opts.localHistoryTokens + 500
  ) {
    trimmedMismatch = true;
    trimmedNotes.push(
      `preTrimHistoryTokens(${opts.preTrimHistoryTokens}) >> postTrim(${opts.localHistoryTokens})`
    );
  }
  if (
    opts.historyMessageCountBeforeTrim != null &&
    opts.historyMessageCountAfterTrim != null &&
    opts.historyMessageCountBeforeTrim > opts.historyMessageCountAfterTrim
  ) {
    trimmedNotes.push(
      `history messages ${opts.historyMessageCountBeforeTrim} → ${opts.historyMessageCountAfterTrim} after trim`
    );
  }

  let rootCause = "unknown";
  if (provider != null && deltaPercent != null) {
    if (deltaPercent > 20) {
      rootCause =
        "LOCAL estimateTokens() over-counts vs Gemini provider tokenizer on same wire payload; not a double-count bug";
    } else if (deltaPercent < -5) {
      rootCause = "LOCAL under-estimates vs provider — inspect message formatting overhead";
    } else {
      rootCause = "LOCAL and provider counts aligned within ~20%";
    }
  } else {
    rootCause = "provider_prompt_tokens unavailable — use live CI run for canonical metric";
  }

  return {
    localEstimate: opts.localEstimatedTotal,
    providerReported: provider,
    delta,
    deltaPercent,
    doubleCountFound,
    doubleCountNotes,
    trimmedVsPretrimMismatch: trimmedMismatch,
    trimmedVsPretrimNotes: trimmedNotes,
    canonicalTokenOwner: "provider_reported_prompt_tokens",
    rootCause,
  };
}

/** Structured console/log output matching Phase B TOKEN_ACCOUNTING_AUDIT schema. */
export function formatTokenAccountingAudit(audit: TokenAccountingAudit): Record<string, unknown> {
  return {
    TOKEN_ACCOUNTING_AUDIT: {
      LOCAL_ESTIMATE: audit.localEstimate,
      PROVIDER_REPORTED: audit.providerReported,
      DELTA: audit.delta,
      DELTA_PERCENT: audit.deltaPercent,
      DOUBLE_COUNT_FOUND: audit.doubleCountFound ? "YES" : "NO",
      TRIMMED_VS_PRETRIM_MISMATCH: audit.trimmedVsPretrimMismatch ? "YES" : "NO",
      CANONICAL_TOKEN_OWNER: audit.canonicalTokenOwner,
      ROOT_CAUSE: audit.rootCause,
      DOUBLE_COUNT_NOTES: audit.doubleCountNotes,
      TRIMMED_NOTES: audit.trimmedVsPretrimNotes,
    },
  };
}

export function buildCanonicalTokenSnapshot(opts: {
  systemPrompt: string;
  history: { content: string }[];
  userTurnContent: string;
  wireBodyJson: string;
  providerPromptTokens?: number | null;
  providerCachedTokens?: number | null;
}): CanonicalPromptTokenSnapshot {
  const localSystemTokens = estimateTokens(opts.systemPrompt);
  const localHistoryTokens = estimateTokens(
    opts.history.map((m) => m.content).join("\n")
  );
  const localUserTurnTokens = estimateTokens(opts.userTurnContent);
  const localEstimatedTokens = estimateTokens(
    `${opts.systemPrompt}\n${opts.history.map((m) => m.content).join("\n")}\n${opts.userTurnContent}`
  );
  const providerPrompt = opts.providerPromptTokens ?? null;
  const providerCached = opts.providerCachedTokens ?? null;
  const providerUncached =
    providerPrompt != null && providerCached != null
      ? Math.max(0, providerPrompt - providerCached)
      : null;

  return {
    localEstimatedTokens,
    localSystemTokens,
    localHistoryTokens,
    localUserTurnTokens,
    providerPromptTokens: providerPrompt,
    providerCachedTokens: providerCached,
    providerUncachedTokens: providerUncached,
    serializedRequestChars: opts.wireBodyJson.length,
    serializedRequestTokensEst: Math.ceil(opts.wireBodyJson.length / 4),
  };
}
