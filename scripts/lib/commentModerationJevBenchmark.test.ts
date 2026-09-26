import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  OPENROUTER_JEV_BENCHMARK_ENV,
  REAL_JEV_MODERATION_PROBE_ENV,
  resolveOptInJevModerationBenchmarkApiKey,
} from "./benchmarkOpenRouterJevCredential";
import { runCommentModerationJevBenchmark } from "./commentModerationJevBenchmark";
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
