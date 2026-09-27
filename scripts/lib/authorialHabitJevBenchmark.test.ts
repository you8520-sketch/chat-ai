import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  AUTHORIAL_HABIT_JEV_CORPUS,
} from "@/lib/authorialHabitJevCorpus";
import {
  AUTHORIAL_HABIT_JEV_QUESTION_ID,
  assertAuthorialHabitJevStateHasNoPrivateIdentifiers,
  buildAuthorialHabitJevQuestions,
  buildAuthorialHabitJevState,
  evaluateAuthorialHabitCandidate,
  parseAuthorialHabitJevVerdict,
} from "@/lib/authorialHabitJevJudge";
import { JEV_DECISIONS_URL } from "@/lib/jevDecisions";
import {
  OPENROUTER_JEV_BENCHMARK_ENV,
  REAL_JEV_AUTHORIAL_HABIT_PROBE_ENV,
  resolveOptInJevAuthorialHabitBenchmarkApiKey,
  sanitizeAuthorialHabitBenchmarkCredentialText,
  withIsolatedAuthorialHabitBenchmarkOpenRouterKey,
} from "./authorialHabitJevBenchmarkCredential";
import {
  assertAuthorialHabitCandidateLabelBalance,
  runAuthorialHabitJevBenchmark,
  scanAuthorialHabitCorpus,
} from "./authorialHabitJevBenchmark";

let savedFetch: typeof fetch;
let savedProdKey: string | undefined;

beforeEach(() => {
  savedFetch = globalThis.fetch;
  savedProdKey = process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedProdKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedProdKey;
});

describe("authorial habit JEV benchmark corpus", () => {
  it("keeps a balanced scanner-positive corpus across semantic labels", () => {
    const scan = scanAuthorialHabitCorpus();
    const balance = assertAuthorialHabitCandidateLabelBalance();
    assert.equal(AUTHORIAL_HABIT_JEV_CORPUS.length, 24);
    assert.equal(scan.totalFixtures, 24);
    assert.equal(balance.ok, true, balance.detail);
    assert.ok(balance.habitPresent >= 6);
    assert.ok(balance.justified >= 6);
    assert.ok(balance.uncertain >= 3);
  });

  it("uses existing authorialHabitAudit as lexical candidate owner", () => {
    for (const fixture of AUTHORIAL_HABIT_JEV_CORPUS) {
      const evaluated = evaluateAuthorialHabitCandidate(fixture);
      assert.equal(
        evaluated.candidate,
        true,
        `${fixture.id} should be scanner-positive for benchmark refinement`
      );
      assert.ok(evaluated.signals.hitCount > 0);
    }
  });

  it("builds bounded, identifier-free JEV state and strict verdict parsing", () => {
    const fixture = AUTHORIAL_HABIT_JEV_CORPUS[0]!;
    const evaluated = evaluateAuthorialHabitCandidate(fixture);
    const state = buildAuthorialHabitJevState({
      fixture,
      signals: evaluated.signals,
    });
    assert.ok(state.excerpt.length <= 1200);
    assert.deepEqual(
      assertAuthorialHabitJevStateHasNoPrivateIdentifiers(
        state as unknown as Record<string, unknown>
      ),
      []
    );
    const questions = buildAuthorialHabitJevQuestions();
    assert.equal(questions[AUTHORIAL_HABIT_JEV_QUESTION_ID]?.type, "choice");
    assert.equal(
      parseAuthorialHabitJevVerdict({
        [AUTHORIAL_HABIT_JEV_QUESTION_ID]: {
          type: "choice",
          choice: "HABIT_PRESENT",
        },
      }),
      "HABIT_PRESENT"
    );
    assert.equal(
      parseAuthorialHabitJevVerdict({
        [AUTHORIAL_HABIT_JEV_QUESTION_ID]: {
          type: "choice",
          choice: "NOT_REAL",
        },
      }),
      null
    );
  });
});

describe("authorial habit JEV benchmark credential isolation", () => {
  it("requires triple opt-in and never falls back to production key", () => {
    const env = {
      REGULAR_TEST_REAL_PROVIDER_CALLS: "0",
      [REAL_JEV_AUTHORIAL_HABIT_PROBE_ENV]: "1",
      [OPENROUTER_JEV_BENCHMARK_ENV]: "bench-key",
      OPENROUTER_API_KEY: "prod-key-must-not-be-used",
    } as NodeJS.ProcessEnv;
    assert.equal(resolveOptInJevAuthorialHabitBenchmarkApiKey(env), null);
    env.REGULAR_TEST_REAL_PROVIDER_CALLS = "1";
    env[REAL_JEV_AUTHORIAL_HABIT_PROBE_ENV] = "0";
    assert.equal(resolveOptInJevAuthorialHabitBenchmarkApiKey(env), null);
    env[REAL_JEV_AUTHORIAL_HABIT_PROBE_ENV] = "1";
    delete env[OPENROUTER_JEV_BENCHMARK_ENV];
    assert.equal(resolveOptInJevAuthorialHabitBenchmarkApiKey(env), null);
    env[OPENROUTER_JEV_BENCHMARK_ENV] = "bench-key";
    assert.equal(resolveOptInJevAuthorialHabitBenchmarkApiKey(env), "bench-key");
  });

  it("temporarily shadows canonical env and restores previous production value", async () => {
    process.env.OPENROUTER_API_KEY = "prod-process-key";
    const inside = await withIsolatedAuthorialHabitBenchmarkOpenRouterKey(
      "bench-process-key",
      async () => process.env.OPENROUTER_API_KEY
    );
    assert.equal(inside, "bench-process-key");
    assert.equal(process.env.OPENROUTER_API_KEY, "prod-process-key");
  });

  it("redacts both benchmark and production credential forms", () => {
    const text = sanitizeAuthorialHabitBenchmarkCredentialText(
      "OPENROUTER_JEV_BENCHMARK_API_KEY=bench-secret OPENROUTER_API_KEY=prod-secret Bearer token-secret"
    );
    assert.doesNotMatch(text, /bench-secret|prod-secret|token-secret/);
    assert.match(text, /OPENROUTER_JEV_BENCHMARK_API_KEY=\[REDACTED\]/);
    assert.match(text, /OPENROUTER_API_KEY=\[REDACTED\]/);
    assert.match(text, /Bearer \[REDACTED\]/);
  });
});

describe("authorial habit JEV benchmark execution isolation", () => {
  it("missing opt-in returns NOT_RUN with zero HTTP/provider calls", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("fetch must not run");
    }) as typeof fetch;

    const result = await runAuthorialHabitJevBenchmark({
      env: {
        OPENROUTER_API_KEY: "prod-key-must-never-be-used",
      } as NodeJS.ProcessEnv,
      fixtures: [AUTHORIAL_HABIT_JEV_CORPUS[0]!],
      log: () => {},
    });

    assert.equal(result.status, "NOT_RUN");
    assert.equal(result.providerCalls, 0);
    assert.equal(fetchCalls, 0);
  });

  it("full opt-in uses benchmark key on official Decisions endpoint and ledger=null", async () => {
    const seen: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
    process.env.OPENROUTER_API_KEY = "prod-process-key-must-be-restored";
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      seen.push({
        url: String(url),
        auth: headers.Authorization ?? "",
        body,
      });
      return Response.json({
        id: "dec_authorial_fixture",
        model: "typesafe/jev-1.13-20260917",
        answers: {
          [AUTHORIAL_HABIT_JEV_QUESTION_ID]: {
            type: "choice",
            choice: "HABIT_PRESENT",
            probabilities: {
              HABIT_PRESENT: 0.9,
              CONTEXTUALLY_JUSTIFIED: 0.05,
              UNCERTAIN: 0.05,
            },
            confidence: 0.9,
          },
        },
        usage: {
          input_tokens: 42,
          output_tokens: 8,
          cost: 0.00002,
        },
      });
    }) as typeof fetch;

    const result = await runAuthorialHabitJevBenchmark({
      env: {
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        [REAL_JEV_AUTHORIAL_HABIT_PROBE_ENV]: "1",
        [OPENROUTER_JEV_BENCHMARK_ENV]: "benchmark-only-key",
        OPENROUTER_API_KEY: "prod-env-object-key-must-never-be-used",
      } as NodeJS.ProcessEnv,
      fixtures: [AUTHORIAL_HABIT_JEV_CORPUS[0]!],
      log: () => {},
    });

    assert.equal(result.status, "RAN");
    if (result.status !== "RAN") return;
    assert.equal(result.totalProviderCalls, 1);
    assert.equal(result.productionMutationEnabled, false);
    assert.equal(result.runtimeHookEnabled, false);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.url, JEV_DECISIONS_URL);
    assert.equal(seen[0]?.auth, "Bearer benchmark-only-key");
    assert.notEqual(seen[0]?.auth, "Bearer prod-env-object-key-must-never-be-used");
    assert.equal(process.env.OPENROUTER_API_KEY, "prod-process-key-must-be-restored");
  });

  it("does not count a local preflight failure as a provider call", async () => {
    const fixture = AUTHORIAL_HABIT_JEV_CORPUS[0]!;
    const result = await runAuthorialHabitJevBenchmark({
      env: {
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        [REAL_JEV_AUTHORIAL_HABIT_PROBE_ENV]: "1",
        [OPENROUTER_JEV_BENCHMARK_ENV]: "benchmark-only-key",
      } as NodeJS.ProcessEnv,
      fixtures: [fixture],
      log: () => {},
      judgeFixture: async () => ({
        fixtureId: fixture.id,
        expectedVerdict: fixture.expectedVerdict,
        verdict: null,
        malformed: false,
        failure: "jev_state_invariant_violation:state.forbidden",
        latencyMs: 0.1,
        inputTokens: 0,
        outputTokens: 0,
        actualCostUsd: null,
        model: "typesafe/jev-1.13",
        providerCallAttempted: false,
      }),
    });

    assert.equal(result.status, "RAN");
    if (result.status !== "RAN") return;
    assert.equal(result.jev.evaluatedFixtures, 1);
    assert.equal(result.totalProviderCalls, 0);
    assert.equal(result.jev.preflightFailureCount, 1);
    assert.equal(result.jev.failureCount, 1);
    assert.equal(result.jev.malformedCount, 0);
    assert.equal(result.jev.actualProviderCostCoverage, "none");
    assert.equal(result.jev.actualProviderCostUsd, null);
    assert.equal(result.jev.reportedProviderCostUsd, null);
  });

  it("marks partial provider-cost evidence instead of presenting it as complete actual cost", async () => {
    const fixtures = AUTHORIAL_HABIT_JEV_CORPUS.slice(0, 2);
    let callIndex = 0;
    const result = await runAuthorialHabitJevBenchmark({
      env: {
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        [REAL_JEV_AUTHORIAL_HABIT_PROBE_ENV]: "1",
        [OPENROUTER_JEV_BENCHMARK_ENV]: "benchmark-only-key",
      } as NodeJS.ProcessEnv,
      fixtures,
      log: () => {},
      judgeFixture: async ({ fixture }) => {
        const actualCostUsd = callIndex++ === 0 ? 0.0001 : null;
        return {
          fixtureId: fixture.id,
          expectedVerdict: fixture.expectedVerdict,
          verdict: fixture.expectedVerdict,
          malformed: false,
          failure: null,
          latencyMs: 10,
          inputTokens: 20,
          outputTokens: 4,
          actualCostUsd,
          model: "typesafe/jev-1.13",
          providerCallAttempted: true,
        };
      },
    });

    assert.equal(result.status, "RAN");
    if (result.status !== "RAN") return;
    assert.equal(result.totalProviderCalls, 2);
    assert.equal(result.jev.actualProviderCostReportedCalls, 1);
    assert.equal(result.jev.actualProviderCostCoverage, "partial");
    assert.equal(result.jev.actualProviderCostUsd, null);
    assert.equal(result.jev.reportedProviderCostUsd, 0.0001);
  });

  it("separates transport failures from malformed provider responses", async () => {
    const fixture = AUTHORIAL_HABIT_JEV_CORPUS[0]!;
    const env = {
      REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
      [REAL_JEV_AUTHORIAL_HABIT_PROBE_ENV]: "1",
      [OPENROUTER_JEV_BENCHMARK_ENV]: "benchmark-only-key",
    } as NodeJS.ProcessEnv;

    globalThis.fetch = (async () => {
      throw new Error("synthetic transport failure");
    }) as typeof fetch;

    const transport = await runAuthorialHabitJevBenchmark({
      env,
      fixtures: [fixture],
      log: () => {},
    });
    assert.equal(transport.status, "RAN");
    if (transport.status !== "RAN") return;
    assert.equal(transport.totalProviderCalls, 1);
    assert.equal(transport.jev.failureCount, 1);
    assert.equal(transport.jev.malformedCount, 0);

    globalThis.fetch = (async () =>
      new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const malformed = await runAuthorialHabitJevBenchmark({
      env,
      fixtures: [fixture],
      log: () => {},
    });
    assert.equal(malformed.status, "RAN");
    if (malformed.status !== "RAN") return;
    assert.equal(malformed.totalProviderCalls, 1);
    assert.equal(malformed.jev.failureCount, 1);
    assert.equal(malformed.jev.malformedCount, 1);
  });

  it("does not wire authorial benchmark into production /api/chat route", () => {
    const routeSource = readFileSync(
      new URL("../../src/app/api/chat/route.ts", import.meta.url),
      "utf8"
    );
    assert.doesNotMatch(routeSource, /authorialHabitJev/i);
    assert.doesNotMatch(routeSource, /authorial-habit-jev/i);
  });
});
