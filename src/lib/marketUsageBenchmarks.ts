/**
 * Competitor market usage benchmarks — canonical multi-case registry.
 * USER_PRICE_WORKLOAD_BENCHMARK only; never reverse-engineer competitor token rates.
 */

export type MarketReasoningAccounting = "unknown" | "included_in_output";

export type MarketUsageBenchmark = {
  id: string;
  modelId: string;
  inputTokens: number;
  displayedOutputTokens: number;
  displayedReasoningTokens?: number | null;
  reasoningAccounting: MarketReasoningAccounting;
  visibleChars?: number | null;
  competitorChargePoints: number;
  sourceLabel: string;
  inputBreakdown?: Record<string, number>;
  generationTimeSeconds?: number;
  firstTokenSeconds?: number;
  generationSeconds?: number;
};

export const GEMINI37_BENCHMARK_A_ID = "gemini37_competitor_a";
export const GEMINI37_BENCHMARK_B_ID = "gemini37_competitor_b";

export const MODEL_MARKET_BENCHMARKS: Record<string, MarketUsageBenchmark[]> = {
  "gemini-3.7-flash": [
    {
      id: GEMINI37_BENCHMARK_A_ID,
      modelId: "gemini-3.7-flash",
      inputTokens: 24_952,
      displayedOutputTokens: 2_367,
      displayedReasoningTokens: 194,
      reasoningAccounting: "unknown",
      visibleChars: 3_863,
      competitorChargePoints: 55,
      sourceLabel: "competitor observed Gemini 3.7 Flash A",
    },
    {
      id: GEMINI37_BENCHMARK_B_ID,
      modelId: "gemini-3.7-flash",
      inputTokens: 42_195,
      displayedOutputTokens: 3_862,
      reasoningAccounting: "unknown",
      competitorChargePoints: 84.4,
      sourceLabel: "competitor observed Gemini 3.7 Flash B",
      generationTimeSeconds: 46.73,
      firstTokenSeconds: 3.8,
      generationSeconds: 42.92,
      inputBreakdown: {
        recentConversation: 16_217,
        longTermMemory: 10_670,
        activeLorebook: 8_076,
        characterPrompt: 5_682,
        userPersona: 764,
        imagePrompt: 418,
        userNote: 368,
      },
    },
  ],
  "gemini-3.1-pro-preview": [
    {
      id: "gemini31_competitor_a",
      modelId: "gemini-3.1-pro-preview",
      inputTokens: 40_689,
      displayedOutputTokens: 4_307,
      reasoningAccounting: "unknown",
      competitorChargePoints: 244.2,
      sourceLabel: "competitor observed Gemini31",
    },
  ],
  "claude-opus-5": [
    {
      id: "opus5_competitor_a",
      modelId: "claude-opus-5",
      inputTokens: 63_749,
      displayedOutputTokens: 3_629,
      reasoningAccounting: "unknown",
      competitorChargePoints: 741.5,
      sourceLabel: "competitor observed Opus5",
    },
  ],
};

export function getMarketBenchmarks(modelId: string): MarketUsageBenchmark[] {
  return MODEL_MARKET_BENCHMARKS[modelId.trim().toLowerCase()] ?? [];
}

export function getMarketBenchmark(modelId: string, benchmarkId: string): MarketUsageBenchmark | undefined {
  return getMarketBenchmarks(modelId).find((b) => b.id === benchmarkId);
}

export function sumInputBreakdown(benchmark: MarketUsageBenchmark): number | null {
  if (!benchmark.inputBreakdown) return null;
  return Object.values(benchmark.inputBreakdown).reduce((sum, n) => sum + n, 0);
}
