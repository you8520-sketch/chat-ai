/**
 * Deterministic isolation + contract tests for Main RP completion-integrity
 * JEV shadow benchmark. No live provider calls; fetch stubbed when opt-in
 * paths are exercised.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { COMPLETION_INTEGRITY_CORPUS } from "@/lib/completionIntegrityCorpus";
import {
  evaluateFixtureCompletionCandidate,
} from "@/lib/completionIntegrityCandidate";
import {
  COMPLETION_INTEGRITY_JEV_QUESTION_ID,
  COMPLETION_INTEGRITY_JEV_VERDICTS,
  assertCompletionIntegrityJevStateHasNoPrivateIdentifiers,
  buildCompletionIntegrityJevQuestions,
  buildCompletionIntegrityJevState,
  parseCompletionIntegrityJevVerdict,
} from "@/lib/completionIntegrityJevJudge";
import { JEV_DECISIONS_URL } from "@/lib/jevDecisions";

import {
  OPENROUTER_JEV_BENCHMARK_ENV,
  REAL_JEV_COMPLETION_INTEGRITY_PROBE_ENV,
  resolveOptInJevCompletionIntegrityBenchmarkApiKey,
  sanitizeJevBenchmarkCredentialText,
} from "./benchmarkOpenRouterJevCredential";
import {
  assertCompletionCandidateLabelBalance,
  runCompletionIntegrityJevBenchmark,
  scanCompletionCorpus,
} from "./completionIntegrityJevBenchmark";

const FULL_OPT_IN = {
  REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
  [REAL_JEV_COMPLETION_INTEGRITY_PROBE_ENV]: "1",
  [OPENROUTER_JEV_BENCHMARK_ENV]: "bench-jev-key-fixture",
  OPENROUTER_API_KEY: "prod-openrouter-key-fixture",
} as NodeJS.ProcessEnv;

let fetchCalls: Array<{ url: string; auth: string; body: unknown }> = [];
let savedFetch: typeof fetch;
let nextChoice: string | null = "COMPLETE";

beforeEach(() => {
  fetchCalls = [];
  nextChoice = "COMPLETE";
  savedFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init?.body ?? "{}"));
    fetchCalls.push({ url: String(_url), auth: headers.Authorization ?? "", body });
    if (nextChoice == null) {
      return Response.json({
        id: "dec_malformed",
        model: "typesafe/jev-1.13-20260917",
        answers: {
          [COMPLETION_INTEGRITY_JEV_QUESTION_ID]: {
            type: "choice",
            choice: "NOT_A_REAL_VERDICT",
            probabilities: { NOT_A_REAL_VERDICT: 1 },
            confidence: 0.1,
          },
        },
        usage: { input_tokens: 10, output_tokens: 5, cost: 0.00001 },
      });
    }
    return Response.json({
      id: "dec_ok",
      model: "typesafe/jev-1.13-20260917",
      answers: {
        [COMPLETION_INTEGRITY_JEV_QUESTION_ID]: {
          type: "choice",
          choice: nextChoice,
          probabilities: { ABRUPT_CUT: 0.1, COMPLETE: 0.8, UNCERTAIN: 0.1 },
          confidence: 0.8,
        },
      },
      usage: { input_tokens: 12, output_tokens: 6, cost: 0.00002 },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = savedFetch;
});

describe("benchmark-only JEV credential owner (triple opt-in)", () => {
  it("any missing leg → null; production OPENROUTER_API_KEY is never used", () => {
    assert.equal(
      resolveOptInJevCompletionIntegrityBenchmarkApiKey({
        ...FULL_OPT_IN,
        REGULAR_TEST_REAL_PROVIDER_CALLS: undefined,
      }),
      null
    );
    assert.equal(
      resolveOptInJevCompletionIntegrityBenchmarkApiKey({
        ...FULL_OPT_IN,
        [REAL_JEV_COMPLETION_INTEGRITY_PROBE_ENV]: "0",
      }),
      null
    );
    assert.equal(
      resolveOptInJevCompletionIntegrityBenchmarkApiKey({
        ...FULL_OPT_IN,
        [OPENROUTER_JEV_BENCHMARK_ENV]: undefined,
      }),
      null
    );
    assert.equal(
      resolveOptInJevCompletionIntegrityBenchmarkApiKey({ ...FULL_OPT_IN }),
      "bench-jev-key-fixture"
    );
  });

  it("redacts credentials from log text", () => {
    const text = sanitizeJevBenchmarkCredentialText(
      "OPENROUTER_JEV_BENCHMARK_API_KEY=abc OPENROUTER_API_KEY=def Bearer ghi"
    );
    assert.doesNotMatch(text, /abc|def|ghi/);
  });
});

describe("completion-integrity JEV semantic contract", () => {
  it("question count = 1 with exact ABRUPT_CUT/COMPLETE/UNCERTAIN choices", () => {
    const questions = buildCompletionIntegrityJevQuestions();
    const ids = Object.keys(questions);
    assert.deepEqual(ids, [COMPLETION_INTEGRITY_JEV_QUESTION_ID]);
    const q = questions[COMPLETION_INTEGRITY_JEV_QUESTION_ID]!;
    assert.equal(q.type, "choice");
    assert.deepEqual(Object.keys(q.criteria as Record<string, string>).sort(), [
      ...COMPLETION_INTEGRITY_JEV_VERDICTS,
    ].sort());
  });

  it("JEV state contains no user/account/billing/private prompt identifiers", () => {
    const fixture = COMPLETION_INTEGRITY_CORPUS[0]!;
    const state = buildCompletionIntegrityJevState({
      fixture,
      candidateReasons: ["endsIncomplete", "tokenLimitFinish"],
    });
    const leaks = assertCompletionIntegrityJevStateHasNoPrivateIdentifiers(
      state as unknown as Record<string, unknown>
    );
    assert.deepEqual(leaks, []);
    const json = JSON.stringify(state);
    assert.doesNotMatch(json, /userId|accountId|billing|personaSecret|OPENROUTER|apiKey|systemPrompt/i);
  });

  it("malformed JEV choice does not parse as a semantic alert verdict", () => {
    assert.equal(
      parseCompletionIntegrityJevVerdict({
        [COMPLETION_INTEGRITY_JEV_QUESTION_ID]: { type: "choice", choice: "RETRY" },
      }),
      null
    );
  });
});

describe("deterministic candidate owner reuse", () => {
  it("corpus expectDeterministicCandidate matches current candidate adapter", () => {
    for (const fixture of COMPLETION_INTEGRITY_CORPUS) {
      const evaled = evaluateFixtureCompletionCandidate(fixture);
      assert.equal(
        evaled.candidate,
        fixture.expectDeterministicCandidate,
        `${fixture.id}: candidate=${evaled.candidate} reasons=${evaled.reasons.join(",")} expect=${fixture.expectDeterministicCandidate}`
      );
    }
  });

  it("candidate-positive corpus label balance gate (ABRUPT>=8 COMPLETE>=6 UNCERTAIN>=3)", () => {
    const balance = assertCompletionCandidateLabelBalance();
    assert.equal(balance.ok, true, balance.detail);
    assert.ok(balance.abrupt >= 8, balance.detail);
    assert.ok(balance.complete >= 6, balance.detail);
    assert.ok(balance.uncertain >= 3, balance.detail);
    const lexical = scanCompletionCorpus();
    const negatives = lexical.rows.filter((r) => !r.candidate).length;
    assert.ok(negatives >= 4, `need scanner-negative fixtures for miss rate; got ${negatives}`);
  });
});

describe("completion-integrity live benchmark runner isolation", () => {
  it("1) missing global live flag → HTTP 0", async () => {
    const result = await runCompletionIntegrityJevBenchmark({
      env: { ...FULL_OPT_IN, REGULAR_TEST_REAL_PROVIDER_CALLS: "0" },
      log: () => {},
    });
    assert.equal(result.status, "NOT_RUN");
    assert.equal(result.providerCalls, 0);
    assert.equal(fetchCalls.length, 0);
  });

  it("2) missing probe flag → HTTP 0", async () => {
    const result = await runCompletionIntegrityJevBenchmark({
      env: { ...FULL_OPT_IN, [REAL_JEV_COMPLETION_INTEGRITY_PROBE_ENV]: undefined },
      log: () => {},
    });
    assert.equal(result.status, "NOT_RUN");
    assert.equal(fetchCalls.length, 0);
  });

  it("3) missing benchmark key → HTTP 0", async () => {
    const result = await runCompletionIntegrityJevBenchmark({
      env: { ...FULL_OPT_IN, [OPENROUTER_JEV_BENCHMARK_ENV]: "" },
      log: () => {},
    });
    assert.equal(result.status, "NOT_RUN");
    assert.equal(fetchCalls.length, 0);
  });

  it("4) production OpenRouter key present but benchmark key absent → HTTP 0", async () => {
    const result = await runCompletionIntegrityJevBenchmark({
      env: {
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        [REAL_JEV_COMPLETION_INTEGRITY_PROBE_ENV]: "1",
        OPENROUTER_API_KEY: "prod-only",
      },
      log: () => {},
    });
    assert.equal(result.status, "NOT_RUN");
    assert.equal(fetchCalls.length, 0);
  });

  it("5) scanner-negative fixture → JEV HTTP 0", async () => {
    const negativeOnly = COMPLETION_INTEGRITY_CORPUS.filter((f) => !f.expectDeterministicCandidate);
    assert.ok(negativeOnly.length > 0);
    const result = await runCompletionIntegrityJevBenchmark({
      env: FULL_OPT_IN,
      fixtures: negativeOnly,
      log: () => {},
    });
    assert.equal(result.status, "RAN");
    if (result.status !== "RAN") return;
    assert.equal(result.totalProviderCalls, 0);
    assert.equal(fetchCalls.length, 0);
  });

  it("9) malformed JEV output is failure, never a semantic alert", async () => {
    nextChoice = null;
    const positive = COMPLETION_INTEGRITY_CORPUS.filter((f) => f.expectDeterministicCandidate).slice(
      0,
      1
    );
    const result = await runCompletionIntegrityJevBenchmark({
      env: FULL_OPT_IN,
      fixtures: positive,
      log: () => {},
    });
    assert.equal(result.status, "RAN");
    if (result.status !== "RAN") return;
    assert.equal(result.jev.malformedCount, 1);
    assert.equal(result.jev.abruptCutCount, 0);
    assert.equal(result.combined.trueAbruptAlerts, 0);
    assert.equal(result.combined.completeFalseAlerts, 0);
  });

  it("10) with opt-in and scanner-positive fixtures: JEV only, benchmark key, no Main RP URL", async () => {
    nextChoice = "ABRUPT_CUT";
    const positive = COMPLETION_INTEGRITY_CORPUS.filter((f) => f.expectDeterministicCandidate).slice(
      0,
      2
    );
    const result = await runCompletionIntegrityJevBenchmark({
      env: FULL_OPT_IN,
      fixtures: positive,
      log: () => {},
    });
    assert.equal(result.status, "RAN");
    if (result.status !== "RAN") return;
    assert.equal(result.totalProviderCalls, positive.length);
    assert.equal(result.jev.physicalAttempts, positive.length);
    assert.equal(result.jev.retries, 0);
    assert.ok(fetchCalls.every((c) => c.url === JEV_DECISIONS_URL));
    assert.ok(fetchCalls.every((c) => c.auth === "Bearer bench-jev-key-fixture"));
    assert.equal(result.productionMutationEnabled, false);
    for (const call of fetchCalls) {
      const body = JSON.stringify(call.body);
      assert.doesNotMatch(body, /openrouter\.ai\/api\/v1\/chat\/completions/i);
      assert.doesNotMatch(body, /prod-openrouter-key-fixture/);
    }
  });

  it("lexical scan issues no provider calls", () => {
    const before = fetchCalls.length;
    const lexical = scanCompletionCorpus();
    assert.equal(fetchCalls.length, before);
    assert.ok(lexical.totalFixtures >= 30);
    assert.ok(lexical.candidateCount > 0);
  });
});

describe("owner / import invariants (no production mutation)", () => {
  it("11–12) responseLength / sentenceCompletion / under-length / billing owners unchanged by package imports", () => {
    const responseLength = fs.readFileSync("src/lib/responseLength.ts", "utf8");
    const sentence = fs.readFileSync("src/lib/sentenceCompletionRecovery.ts", "utf8");
    const underLength = fs.readFileSync("src/lib/serverUnderLengthRecovery.ts", "utf8");
    const billing = fs.readFileSync("src/lib/chatBillingDeliveryIntegrity.test.ts", "utf8");
    assert.match(responseLength, /export function endsIncomplete/);
    assert.match(responseLength, /export function needsResponseLengthFix/);
    assert.match(sentence, /export function/);
    assert.match(underLength, /export /);
    assert.match(billing, /describe/);
    // Benchmark package must not be imported from production chat route.
    const chatRoute = fs.readFileSync("src/app/api/chat/route.ts", "utf8");
    assert.doesNotMatch(chatRoute, /completionIntegrity/);
  });

  it("13) no production source imports the benchmark runner", () => {
    const root = path.resolve("src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === "node_modules" || ent.name === ".next" || ent.name === ".next-dev") continue;
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(ent.name)) continue;
        if (ent.name.includes(".test.")) continue;
        const text = fs.readFileSync(full, "utf8");
        if (
          text.includes("completionIntegrityJevBenchmark") ||
          text.includes("benchmark-completion-integrity-jev-live") ||
          text.includes("completionIntegrityCorpus")
        ) {
          // Candidate/judge may be imported only from tests/scripts — production libs listed here are forbidden.
          if (
            !full.endsWith("completionIntegrityCandidate.ts") &&
            !full.endsWith("completionIntegrityJevJudge.ts") &&
            !full.endsWith("completionIntegrityCorpus.ts")
          ) {
            offenders.push(path.relative(process.cwd(), full));
          }
        }
      }
    };
    walk(root);
    assert.deepEqual(offenders, []);
  });

  it("corpus declares explicit verdicts and stays in 30–36 fixture band", () => {
    assert.ok(COMPLETION_INTEGRITY_CORPUS.length >= 30);
    assert.ok(COMPLETION_INTEGRITY_CORPUS.length <= 36);
    for (const f of COMPLETION_INTEGRITY_CORPUS) {
      assert.ok(["ABRUPT_CUT", "COMPLETE", "UNCERTAIN"].includes(f.expectedVerdict));
      assert.ok(f.rationale.trim().length > 0);
      assert.ok(f.finalProse.trim().length > 0);
      assert.ok(typeof f.expectDeterministicCandidate === "boolean");
      assert.ok(typeof f.localRecoveryApplied === "boolean");
    }
  });

  it("savedText / billing / recovery are not mutated by judge builders", () => {
    const fixture = COMPLETION_INTEGRITY_CORPUS.find((f) => f.expectDeterministicCandidate)!;
    const before = structuredClone(fixture);
    buildCompletionIntegrityJevState({
      fixture,
      candidateReasons: ["endsIncomplete"],
    });
    assert.deepEqual(fixture, before);
  });
});
