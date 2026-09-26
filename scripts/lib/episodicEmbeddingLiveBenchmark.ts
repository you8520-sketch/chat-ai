/**
 * Opt-in live episodic embedding benchmark — PREP ONLY until approved.
 *
 * Runs the #1072 case suite (non-adult deterministic fixtures) once per arm
 * with a real embeddings provider behind the canonical transport, in
 * record-only mode (model quality never aborts the run). Emits raw metrics
 * only; no winner is chosen. Without the triple opt-in it returns NOT_RUN
 * before any transport is constructed: HTTP = 0. Never reads the production
 * OPENROUTER_API_KEY; ledger writes are skipped (benchmark spend is not
 * production spend).
 */
import { callOpenRouterEmbeddings } from "@/lib/openRouterEmbeddings";
import {
  EPISODIC_SEMANTIC_BENCHMARK_CONTROL_MODELS,
  EPISODIC_SEMANTIC_EMBEDDING_REQUEST_KIND,
  EPISODIC_SEMANTIC_INDEX_TIMEOUT_MS,
  EPISODIC_SEMANTIC_MODEL_CANDIDATES,
  EPISODIC_SEMANTIC_QUERY_TIMEOUT_MS,
  type EpisodicSemanticModelConfig,
} from "@/lib/memory/memory-episodic-semantic-config";
import type { EpisodicEmbedder } from "@/lib/memory/memory-episodic-semantic-jobs";
import {
  BASELINE_MODE,
  measureMilestoneRetention,
  runBenchmarkCases,
  type BenchmarkMode,
} from "@/lib/memory/memory-rp-benchmark-suite";
import {
  resolveOptInEpisodicEmbeddingBenchmarkApiKey,
  sanitizeEmbeddingBenchmarkCredentialText,
} from "./benchmarkOpenRouterEmbeddingsCredential";

export const LIVE_EMBEDDING_BENCHMARK_ARMS: Array<{ arm: string; model: EpisodicSemanticModelConfig }> = [
  { arm: "A", model: EPISODIC_SEMANTIC_MODEL_CANDIDATES.bge_m3 },
  { arm: "B", model: EPISODIC_SEMANTIC_MODEL_CANDIDATES.qwen3_embedding_8b },
  { arm: "C-control", model: EPISODIC_SEMANTIC_BENCHMARK_CONTROL_MODELS.openai_text_embedding_3_small },
];

type RttSummary = { p50: number | null; p95: number | null; max: number | null; count: number };

export type LiveArmResult = {
  arm: string;
  model: string;
  dimensions: number;
  queryRttMs: RttSummary;
  batchRttMs: RttSummary;
  candidateRecall: number | null;
  finalRecall: number | null;
  falseInjectionRate: number | null;
  staleStateRate: number | null;
  knownGap: { candidateHit: boolean; finalHit: boolean };
  knownGapSemantic: { admitted: number; novel: number; overlap: number; added: number } | null;
  milestoneRetention: string;
  milestoneCaseSemantic: { admitted: number; novel: number; overlap: number; added: number };
  providerCalls: number;
  inputTokens: number;
  /** Sum of provider-reported usage.cost; null when no call reported cost. */
  actualProviderCostUsd: number | null;
  failureCount: number;
  failureSamples: string[];
  invariantViolations: string[];
};

export type LiveBenchmarkResult =
  | { status: "NOT_RUN"; reason: string; providerCalls: 0 }
  | { status: "RAN"; baseline: { candidateRecall: number | null; finalRecall: number | null }; arms: LiveArmResult[] };

function summarize(values: number[]): RttSummary {
  if (values.length === 0) return { p50: null, p95: null, max: null, count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! * 10) / 10;
  return { p50: at(0.5), p95: at(0.95), max: Math.round(sorted[sorted.length - 1]! * 10) / 10, count: values.length };
}

export async function runEpisodicEmbeddingLiveBenchmark(opts: {
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
} = {}): Promise<LiveBenchmarkResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const apiKey = resolveOptInEpisodicEmbeddingBenchmarkApiKey(opts.env ?? process.env);
  if (!apiKey) {
    const reason =
      "triple opt-in absent (REGULAR_TEST_REAL_PROVIDER_CALLS=1, REAL_EPISODIC_EMBEDDING_PROBE=1, OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY)";
    log(`NOT_RUN — ${reason}`);
    log("provider calls=0");
    return { status: "NOT_RUN", reason, providerCalls: 0 };
  }

  const noHttp = { snapshot: () => ({ httpCallsObserved: 0, jevCallsObserved: 0 }) };
  const baseline = await runBenchmarkCases(BASELINE_MODE, noHttp);
  const arms: LiveArmResult[] = [];
  for (const { arm, model } of LIVE_EMBEDDING_BENCHMARK_ARMS) {
    const queryRtt: number[] = [];
    const batchRtt: number[] = [];
    const failureSamples: string[] = [];
    let calls = 0;
    let failures = 0;
    let inputTokens = 0;
    let costUsd = 0;
    let costReported = false;
    const embed: EpisodicEmbedder = async (inputs, armModel, purpose) => {
      calls += 1;
      const started = performance.now();
      try {
        const out = await callOpenRouterEmbeddings({
          model: armModel.modelId,
          inputs,
          dimensions: armModel.dimensions,
          requestDimensions: armModel.requestDimensions,
          requestKind: EPISODIC_SEMANTIC_EMBEDDING_REQUEST_KIND,
          timeoutMs: purpose === "query" ? EPISODIC_SEMANTIC_QUERY_TIMEOUT_MS : EPISODIC_SEMANTIC_INDEX_TIMEOUT_MS,
          apiKey,
          ledger: null,
        });
        inputTokens += out.usage.inputTokens;
        if (out.usage.upstreamCostUsd != null) {
          costUsd += out.usage.upstreamCostUsd;
          costReported = true;
        }
        return out.vectors;
      } catch (e) {
        failures += 1;
        if (failureSamples.length < 5) {
          failureSamples.push(sanitizeEmbeddingBenchmarkCredentialText((e as Error).message).slice(0, 200));
        }
        throw e;
      } finally {
        (purpose === "query" ? queryRtt : batchRtt).push(performance.now() - started);
      }
    };
    const mode: BenchmarkMode = { label: `live-${arm}-${model.modelId}`, semantic: { model, embed }, strict: false };
    const probe = { snapshot: () => ({ httpCallsObserved: calls, jevCallsObserved: 0 }) };
    const run = await runBenchmarkCases(mode, probe);
    const retention = await measureMilestoneRetention(mode);
    const result: LiveArmResult = {
      arm,
      model: model.modelId,
      dimensions: model.dimensions,
      queryRttMs: summarize(queryRtt),
      batchRttMs: summarize(batchRtt),
      candidateRecall: run.metrics.candidateRecallAtK.value,
      finalRecall: run.metrics.finalRecallAt8.value,
      falseInjectionRate: run.metrics.falseInjectionRate.value,
      staleStateRate: run.metrics.staleStateRecallRate.value,
      knownGap: { candidateHit: run.knownGap.candidateHit, finalHit: run.knownGap.finalHit },
      knownGapSemantic: run.knownGap.semantic
        ? { admitted: run.knownGap.semantic.admitted, novel: run.knownGap.semantic.novel, overlap: run.knownGap.semantic.overlap, added: run.knownGap.semantic.added }
        : null,
      milestoneRetention: `${retention.retained}/${retention.total}`,
      milestoneCaseSemantic: {
        admitted: retention.semantic.admitted,
        novel: retention.semantic.novel,
        overlap: retention.semantic.overlap,
        added: retention.semantic.added,
      },
      providerCalls: calls,
      inputTokens,
      actualProviderCostUsd: costReported ? costUsd : null,
      failureCount: failures,
      failureSamples,
      invariantViolations: run.invariantViolations,
    };
    arms.push(result);
    log(JSON.stringify(result));
  }
  return {
    status: "RAN",
    baseline: { candidateRecall: baseline.metrics.candidateRecallAtK.value, finalRecall: baseline.metrics.finalRecallAt8.value },
    arms,
  };
}
