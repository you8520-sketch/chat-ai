export type CanonCacheObservability = {
  totalInputTokens: number;
  cachedInputTokens: number;
  uncachedInputTokens: number;
  cacheHitRatio: number;
  cacheDiscountKrw: number;
  estimatedInputCostKrw: number;
  totalModelCostKrw: number;
};

export type CanonSourceTokenBreakdown = {
  fullLegacyCanonTokens: number;
  coreCanonTokens: number;
  activeCanonTokens: number;
  archiveCandidateTokens: number;
  archiveInjectedTokens: number;
};

export type CanonInjectionObservability = {
  modelId: string;
  rolloutStage: string;
  policyCanonMode: string;
  policyArchiveMode: string;
  shadowOnly: boolean;
  cache: CanonCacheObservability;
  canonSource: CanonSourceTokenBreakdown;
};

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 3.5);
}

export function buildCanonCacheObservability(input: {
  totalInputTokens: number;
  cachedInputTokens: number;
  estimatedInputCostKrw: number;
  totalModelCostKrw: number;
  cacheDiscountKrw?: number;
}): CanonCacheObservability {
  const totalInputTokens = Math.max(0, input.totalInputTokens);
  const cachedInputTokens = Math.min(Math.max(0, input.cachedInputTokens), totalInputTokens);
  const uncachedInputTokens = totalInputTokens - cachedInputTokens;
  const cacheHitRatio = totalInputTokens > 0 ? cachedInputTokens / totalInputTokens : 0;
  return {
    totalInputTokens,
    cachedInputTokens,
    uncachedInputTokens,
    cacheHitRatio,
    cacheDiscountKrw: input.cacheDiscountKrw ?? 0,
    estimatedInputCostKrw: input.estimatedInputCostKrw,
    totalModelCostKrw: input.totalModelCostKrw,
  };
}

export function buildCanonSourceBreakdown(input: {
  fullLegacyCanonChars: number;
  coreCanonChars: number;
  activeCanonChars: number;
  archiveCandidateChars: number;
  archiveInjectedChars: number;
}): CanonSourceTokenBreakdown {
  return {
    fullLegacyCanonTokens: estimateTokensFromChars(input.fullLegacyCanonChars),
    coreCanonTokens: estimateTokensFromChars(input.coreCanonChars),
    activeCanonTokens: estimateTokensFromChars(input.activeCanonChars),
    archiveCandidateTokens: estimateTokensFromChars(input.archiveCandidateChars),
    archiveInjectedTokens: estimateTokensFromChars(input.archiveInjectedChars),
  };
}
