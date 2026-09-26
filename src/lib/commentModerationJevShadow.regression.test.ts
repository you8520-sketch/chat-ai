import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMENT_REPORT_BLIND_THRESHOLD } from "@/lib/commentModerationPolicy";

describe("comment moderation production invariants (shadow PR)", () => {
  it("submitProfileComment still uses Gemini moderateCommentWithAi only (no JEV import)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/commentSubmit.ts"), "utf8");
    assert.match(src, /moderateCommentWithAi/);
    assert.doesNotMatch(src, /callJevDecisions|jevDecisions|commentModerationJevBenchmark/);
  });

  it("report-threshold path remains deterministic blind (no AI/JEV)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/commentReports.ts"), "utf8");
    assert.match(src, /COMMENT_REPORT_BLIND_THRESHOLD/);
    assert.doesNotMatch(src, /moderateCommentWithAi|callJevDecisions/);
    assert.equal(COMMENT_REPORT_BLIND_THRESHOLD, 10);
  });

  it("non-AI banned-word path remains instant block without Gemini/JEV", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/commentSubmit.ts"), "utf8");
    assert.match(src, /금지어 \(AI 미검사\)/);
    assert.match(src, /requiresAi/);
  });

  it("production openRouterCompletion callers for comment moderation omit benchmark credential overrides", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/commentModeration.ts"), "utf8");
    // Production submit path does not pass openRouterApiKey — only optional param exists.
    const submit = readFileSync(join(process.cwd(), "src/lib/commentSubmit.ts"), "utf8");
    assert.doesNotMatch(submit, /openRouterApiKey|OPENROUTER_JEV_BENCHMARK/);
    assert.match(src, /openRouterApiKeyOverride: input\.openRouterApiKey/);
  });
});

describe("credential override seams do not invent env fallbacks", () => {
  it("callJevDecisions uses explicit apiKey when provided (fetch Authorization)", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.Authorization, "Bearer sk-explicit-jev");
      return new Response(
        JSON.stringify({
          model: "typesafe/jev-1.13",
          answers: {
            moderation_verdict: {
              type: "choice",
              choice: "ALLOW",
              probabilities: { ALLOW: 0.9, BLOCK: 0.1 },
              confidence: 0.9,
            },
          },
          usage: { input_tokens: 1, output_tokens: 1, cost: 0 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    });
    try {
      const { callJevDecisions } = await import("@/lib/jevDecisions");
      const { buildCommentSemanticJevQuestions, buildCommentSemanticJevState } = await import(
        "@/lib/commentSemanticModerationPolicy"
      );
      await callJevDecisions({
        state: buildCommentSemanticJevState({
          content: "x",
          normalized: "x",
          matchedWords: [],
          trigger: "banned_word",
        }),
        questions: buildCommentSemanticJevQuestions(),
        apiKey: "sk-explicit-jev",
        ledger: null,
      });
      assert.equal(fetchMock.mock.callCount(), 1);
    } finally {
      fetchMock.mock.restore();
    }
  });

  it("callJevDecisions without apiKey still requires production resolver (no benchmark env fallback)", async () => {
    const prevBench = process.env.OPENROUTER_JEV_BENCHMARK_API_KEY;
    const prevProd = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_JEV_BENCHMARK_API_KEY = "sk-bench-must-not-be-used";
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      throw new Error("fetch must not run without production key");
    });
    try {
      const { callJevDecisions } = await import("@/lib/jevDecisions");
      await assert.rejects(
        () =>
          callJevDecisions({
            state: {},
            questions: {
              q: { type: "choice", instructions: "x", criteria: { A: "a", B: "b" } },
            },
            ledger: null,
          }),
        /NO_OPENROUTER_KEY/
      );
      assert.equal(fetchMock.mock.callCount(), 0);
    } finally {
      fetchMock.mock.restore();
      if (prevBench === undefined) delete process.env.OPENROUTER_JEV_BENCHMARK_API_KEY;
      else process.env.OPENROUTER_JEV_BENCHMARK_API_KEY = prevBench;
      if (prevProd === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = prevProd;
    }
  });
});
