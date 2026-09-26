import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  OPENROUTER_JEV_BENCHMARK_ENV,
  REAL_JEV_MODERATION_PROBE_ENV,
  resolveOptInJevModerationBenchmarkApiKey,
} from "./benchmarkOpenRouterJevCredential";
import {
  buildCommentModerationArmMetrics,
  runCommentModerationJevBenchmark,
  type FixtureArmOutcome,
} from "./commentModerationJevBenchmark";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCommentSemanticJevQuestions,
  buildCommentSemanticJevState,
  COMMENT_SEMANTIC_JEV_QUESTION_ID,
} from "@/lib/commentSemanticModerationPolicy";

describe("JEV comment moderation benchmark credential isolation", () => {
  it("missing global flag → NOT_RUN / provider calls 0", async () => {
    const result = await runCommentModerationJevBenchmark({
      env: {
        [REAL_JEV_MODERATION_PROBE_ENV]: "1",
        [OPENROUTER_JEV_BENCHMARK_ENV]: "sk-bench",
      } as NodeJS.ProcessEnv,
      log: () => {},
    });
    assert.equal(result.status, "NOT_RUN");
    assert.equal(result.providerCalls, 0);
  });

  it("missing probe flag → NOT_RUN / HTTP 0", async () => {
    const result = await runCommentModerationJevBenchmark({
      env: {
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        [OPENROUTER_JEV_BENCHMARK_ENV]: "sk-bench",
      } as NodeJS.ProcessEnv,
      log: () => {},
    });
    assert.equal(result.status, "NOT_RUN");
    assert.equal(result.providerCalls, 0);
  });

  it("missing dedicated benchmark key → NOT_RUN even if production key present", async () => {
    const result = await runCommentModerationJevBenchmark({
      env: {
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        [REAL_JEV_MODERATION_PROBE_ENV]: "1",
        OPENROUTER_API_KEY: "sk-prod-should-not-be-used",
      } as NodeJS.ProcessEnv,
      log: () => {},
    });
    assert.equal(result.status, "NOT_RUN");
    assert.equal(result.providerCalls, 0);
  });

  it("resolver never returns production OPENROUTER_API_KEY", () => {
    assert.equal(
      resolveOptInJevModerationBenchmarkApiKey({
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        [REAL_JEV_MODERATION_PROBE_ENV]: "1",
        OPENROUTER_API_KEY: "sk-prod",
      } as NodeJS.ProcessEnv),
      null
    );
    assert.equal(
      resolveOptInJevModerationBenchmarkApiKey({
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        [REAL_JEV_MODERATION_PROBE_ENV]: "1",
        [OPENROUTER_JEV_BENCHMARK_ENV]: "  sk-jev-bench  ",
      } as NodeJS.ProcessEnv),
      "sk-jev-bench"
    );
  });
});

describe("JEV comment moderation benchmark request shape", () => {
  it("JEV request state/questions stay bounded (no account identifiers)", () => {
    const state = buildCommentSemanticJevState({
      content: "댓글",
      normalized: "댓글",
      matchedWords: ["욕"],
      trigger: "banned_word",
    });
    const json = JSON.stringify(state);
    assert.doesNotMatch(json, /user_id|authorId|account|points|creatorId|characterId|session|credential/i);
    const questions = buildCommentSemanticJevQuestions();
    assert.deepEqual(Object.keys(questions), [COMMENT_SEMANTIC_JEV_QUESTION_ID]);
    assert.deepEqual(Object.keys(questions[COMMENT_SEMANTIC_JEV_QUESTION_ID]!.criteria).sort(), [
      "ALLOW",
      "BLOCK",
    ]);
  });

  it("no production source imports the live benchmark runner", () => {
    const root = process.cwd();
    const productionPaths = [
      "src/lib/commentSubmit.ts",
      "src/lib/commentModeration.ts",
      "src/lib/commentReports.ts",
      "src/app/api/profile-comments/route.ts",
    ];
    for (const rel of productionPaths) {
      const src = readFileSync(join(root, rel), "utf8");
      assert.doesNotMatch(src, /commentModerationJevBenchmark|benchmark-comment-moderation-jev-live/);
    }
  });

  it("fetch spy stays 0 when opt-in is absent", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      throw new Error("fetch must not be called");
    });
    try {
      const result = await runCommentModerationJevBenchmark({
        env: { OPENROUTER_API_KEY: "sk-prod" } as NodeJS.ProcessEnv,
        log: () => {},
      });
      assert.equal(result.status, "NOT_RUN");
      assert.equal(fetchMock.mock.callCount(), 0);
    } finally {
      fetchMock.mock.restore();
    }
  });
});


describe("JEV comment moderation benchmark metric integrity", () => {
  it("never credits Gemini fail-closed BLOCK as semantic model accuracy", () => {
    const outcomes: FixtureArmOutcome[] = [
      {
        fixtureId: "blocked-by-transport-fallback",
        expected: "BLOCK",
        category: "clear_block",
        clarity: "clear",
        productionTriggered: true,
        providerCallAttempted: true,
        verdict: "BLOCK",
        responseSource: "transport_fail_block",
        latencyMs: 100,
        inputTokens: 0,
        outputTokens: 0,
        actualCostUsd: null,
        failure: "timeout",
      },
      {
        fixtureId: "real-model-allow",
        expected: "ALLOW",
        category: "false_positive",
        clarity: "clear",
        productionTriggered: true,
        providerCallAttempted: true,
        verdict: "ALLOW",
        responseSource: "model",
        latencyMs: 50,
        inputTokens: 10,
        outputTokens: 1,
        actualCostUsd: 0.0001,
        failure: null,
      },
      {
        fixtureId: "policy-probe-only",
        expected: "ALLOW",
        category: "exploratory",
        clarity: "boundary",
        productionTriggered: false,
        providerCallAttempted: true,
        verdict: "ALLOW",
        responseSource: "model",
        latencyMs: 25,
        inputTokens: 10,
        outputTokens: 1,
        actualCostUsd: 0.0001,
        failure: null,
      },
    ];

    const m = buildCommentModerationArmMetrics("gemini", outcomes);
    assert.equal(m.primaryFixtures, 2);
    assert.equal(m.policyProbeFixtures, 1);
    assert.equal(m.modelResponseCount, 1);
    assert.equal(m.modelResponseCoverage, 0.5);
    assert.equal(m.overallAccuracy, 0.5, "fallback BLOCK must count as a semantic miss");
    assert.equal(m.effectiveOutcomeAccuracy, 1, "runtime fallback effect is reported separately");
    assert.equal(m.policyProbeAccuracy, 1);
    assert.equal(m.blockRecall, 0, "fallback BLOCK is not model BLOCK recall");
    assert.equal(m.allowRecall, 1);
    assert.equal(m.failureCount, 1);
    assert.equal(m.providerCalls, 3);
  });

  it("counts fail-closed BLOCK as a real false block on an ALLOW case", () => {
    const outcomes: FixtureArmOutcome[] = [{
      fixtureId: "allow-but-provider-failed",
      expected: "ALLOW",
      category: "false_positive",
      clarity: "clear",
      productionTriggered: true,
      providerCallAttempted: true,
      verdict: "BLOCK",
      responseSource: "transport_fail_block",
      latencyMs: 100,
      inputTokens: 0,
      outputTokens: 0,
      actualCostUsd: null,
      failure: "timeout",
    }];
    const m = buildCommentModerationArmMetrics("gemini", outcomes);
    assert.equal(m.overallAccuracy, 0);
    assert.equal(m.effectiveOutcomeAccuracy, 0);
    assert.equal(m.falseBlockCount, 1);
    assert.equal(m.falseBlockRate, 1);
  });
});
