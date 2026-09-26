import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  OPENROUTER_EMBEDDINGS_BENCHMARK_ENV,
  REAL_EPISODIC_EMBEDDING_PROBE_ENV,
  resolveOptInEpisodicEmbeddingBenchmarkApiKey,
  sanitizeEmbeddingBenchmarkCredentialText,
} from "./benchmarkOpenRouterEmbeddingsCredential";
import { LIVE_EMBEDDING_BENCHMARK_ARMS, runEpisodicEmbeddingLiveBenchmark } from "./episodicEmbeddingLiveBenchmark";

const FULL_OPT_IN = {
  REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
  [REAL_EPISODIC_EMBEDDING_PROBE_ENV]: "1",
  [OPENROUTER_EMBEDDINGS_BENCHMARK_ENV]: "bench-key-fixture",
  OPENROUTER_API_KEY: "prod-key-fixture",
} as NodeJS.ProcessEnv;

let fetchCalls: Array<{ url: string; auth: string; body: { model: string; input: string[] } }> = [];
let savedFetch: typeof fetch;

/** Deterministic pseudo-vector of the requested width — no network. */
function stubVector(text: string, dims: number): number[] {
  const out: number[] = [];
  let seed = createHash("sha256").update(text).digest();
  while (out.length < dims) {
    for (const byte of seed) {
      if (out.length >= dims) break;
      out.push(byte / 255 - 0.5);
    }
    seed = createHash("sha256").update(seed).digest();
  }
  return out;
}

const dimsByModel = new Map(LIVE_EMBEDDING_BENCHMARK_ARMS.map(({ model }) => [model.modelId, model.dimensions]));

beforeEach(() => {
  fetchCalls = [];
  savedFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { model: string; input: string[] };
    const headers = (init?.headers ?? {}) as Record<string, string>;
    fetchCalls.push({ url: String(url), auth: headers.Authorization ?? "", body });
    const dims = dimsByModel.get(body.model) ?? 8;
    return Response.json({
      object: "list",
      model: body.model,
      data: body.input.map((t, index) => ({ object: "embedding", index, embedding: stubVector(t, dims) })),
      usage: { prompt_tokens: body.input.length * 10, total_tokens: body.input.length * 10, cost: body.input.length * 1e-7 },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
});

describe("benchmark-only embedding credential owner (triple opt-in)", () => {
  it("any missing leg → null; production OPENROUTER_API_KEY is never used", () => {
    assert.equal(resolveOptInEpisodicEmbeddingBenchmarkApiKey({ ...FULL_OPT_IN, REGULAR_TEST_REAL_PROVIDER_CALLS: undefined }), null);
    assert.equal(resolveOptInEpisodicEmbeddingBenchmarkApiKey({ ...FULL_OPT_IN, [REAL_EPISODIC_EMBEDDING_PROBE_ENV]: "0" }), null);
    assert.equal(resolveOptInEpisodicEmbeddingBenchmarkApiKey({ ...FULL_OPT_IN, [OPENROUTER_EMBEDDINGS_BENCHMARK_ENV]: undefined }), null);
    assert.equal(resolveOptInEpisodicEmbeddingBenchmarkApiKey({ ...FULL_OPT_IN }), "bench-key-fixture");
  });

  it("redacts credentials from log text", () => {
    const text = sanitizeEmbeddingBenchmarkCredentialText("OPENROUTER_EMBEDDINGS_BENCHMARK_API_KEY=abc OPENROUTER_API_KEY=def Bearer ghi");
    assert.doesNotMatch(text, /abc|def|ghi/);
  });
});

describe("live embedding benchmark runner", () => {
  it("without the triple opt-in: NOT_RUN and 0 provider HTTP, even with a production key present", async () => {
    const lines: string[] = [];
    for (const env of [
      { OPENROUTER_API_KEY: "prod-key-fixture" },
      { ...FULL_OPT_IN, REGULAR_TEST_REAL_PROVIDER_CALLS: "0" },
      { ...FULL_OPT_IN, [REAL_EPISODIC_EMBEDDING_PROBE_ENV]: undefined },
      { ...FULL_OPT_IN, [OPENROUTER_EMBEDDINGS_BENCHMARK_ENV]: "" },
    ] as NodeJS.ProcessEnv[]) {
      const result = await runEpisodicEmbeddingLiveBenchmark({ env, log: (l) => lines.push(l) });
      assert.equal(result.status, "NOT_RUN");
    }
    assert.equal(fetchCalls.length, 0);
    assert.ok(lines.some((l) => l === "provider calls=0"));
  });

  it("with opt-in (fetch stubbed, no network): three arms emit raw metrics using only the benchmark key", async () => {
    const lines: string[] = [];
    const result = await runEpisodicEmbeddingLiveBenchmark({ env: FULL_OPT_IN, log: (l) => lines.push(l) });
    assert.equal(result.status, "RAN");
    if (result.status !== "RAN") return;
    assert.deepEqual(result.arms.map((a) => a.model), ["baai/bge-m3", "qwen/qwen3-embedding-8b", "openai/text-embedding-3-small"]);
    assert.ok(fetchCalls.length > 0);
    assert.ok(fetchCalls.every((c) => c.url === "https://openrouter.ai/api/v1/embeddings"));
    assert.ok(fetchCalls.every((c) => c.auth === "Bearer bench-key-fixture"), "production key never sent");
    for (const arm of result.arms) {
      for (const field of [
        "model", "dimensions", "queryRttMs", "batchRttMs", "candidateRecall", "finalRecall", "falseInjectionRate",
        "staleStateRate", "knownGap", "knownGapSemantic", "milestoneRetention", "milestoneCaseSemantic",
        "providerCalls", "inputTokens", "actualProviderCostUsd", "failureCount", "invariantViolations",
      ]) {
        assert.ok(field in arm, `${arm.model} missing ${field}`);
      }
      assert.equal(arm.failureCount, 0);
      assert.ok(arm.providerCalls > 0 && arm.inputTokens > 0);
      assert.ok((arm.actualProviderCostUsd ?? 0) > 0);
      assert.ok(arm.queryRttMs.count > 0 && arm.batchRttMs.count > 0);
    }
    assert.equal(lines.length, 3);
  });
});
