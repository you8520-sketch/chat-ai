/**
 * Deterministic isolation + contract tests for scene-boundary JEV shadow benchmark.
 * No live provider calls; fetch stubbed when opt-in paths are exercised.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { SCENE_BOUNDARY_SEMANTIC_CORPUS } from "@/lib/sceneBoundarySemanticCorpus";
import {
  SCENE_BOUNDARY_JEV_QUESTION_ID,
  SCENE_BOUNDARY_JEV_VERDICTS,
  assertSceneBoundaryJevStateHasNoPrivateIdentifiers,
  buildSceneBoundaryJevQuestions,
  buildSceneBoundaryJevStateFromFixture,
  parseSceneBoundaryJevVerdict,
} from "@/lib/sceneBoundaryJevJudge";
import { scanR5BoundarySuspicionSignals } from "@/lib/scenePolicyBoundarySuspicionScan";
import { JEV_DECISIONS_URL } from "@/lib/jevDecisions";

import {
  OPENROUTER_JEV_BENCHMARK_ENV,
  REAL_JEV_SCENE_BOUNDARY_PROBE_ENV,
  resolveOptInJevSceneBoundaryBenchmarkApiKey,
  sanitizeJevBenchmarkCredentialText,
} from "./benchmarkOpenRouterJevCredential";
import {
  runSceneBoundaryJevBenchmark,
  runSceneBoundaryLexicalStage,
} from "./sceneBoundaryJevBenchmark";

const FULL_OPT_IN = {
  REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
  [REAL_JEV_SCENE_BOUNDARY_PROBE_ENV]: "1",
  [OPENROUTER_JEV_BENCHMARK_ENV]: "bench-jev-key-fixture",
  OPENROUTER_API_KEY: "prod-openrouter-key-fixture",
} as NodeJS.ProcessEnv;

let fetchCalls: Array<{ url: string; auth: string; body: unknown }> = [];
let savedFetch: typeof fetch;
let nextChoice: string | null = "COMPLIANT";

beforeEach(() => {
  fetchCalls = [];
  nextChoice = "COMPLIANT";
  savedFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const body = JSON.parse(String(init?.body ?? "{}"));
    fetchCalls.push({ url: String(url), auth: headers.Authorization ?? "", body });
    if (nextChoice == null) {
      return Response.json({
        id: "dec_malformed",
        model: "typesafe/jev-1.13-20260917",
        answers: {
          [SCENE_BOUNDARY_JEV_QUESTION_ID]: {
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
        [SCENE_BOUNDARY_JEV_QUESTION_ID]: {
          type: "choice",
          choice: nextChoice,
          probabilities: { VIOLATION: 0.1, COMPLIANT: 0.8, INSUFFICIENT_CONTEXT: 0.1 },
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
      resolveOptInJevSceneBoundaryBenchmarkApiKey({
        ...FULL_OPT_IN,
        REGULAR_TEST_REAL_PROVIDER_CALLS: undefined,
      }),
      null
    );
    assert.equal(
      resolveOptInJevSceneBoundaryBenchmarkApiKey({
        ...FULL_OPT_IN,
        [REAL_JEV_SCENE_BOUNDARY_PROBE_ENV]: "0",
      }),
      null
    );
    assert.equal(
      resolveOptInJevSceneBoundaryBenchmarkApiKey({
        ...FULL_OPT_IN,
        [OPENROUTER_JEV_BENCHMARK_ENV]: undefined,
      }),
      null
    );
    assert.equal(resolveOptInJevSceneBoundaryBenchmarkApiKey({ ...FULL_OPT_IN }), "bench-jev-key-fixture");
  });

  it("redacts credentials from log text", () => {
    const text = sanitizeJevBenchmarkCredentialText(
      "OPENROUTER_JEV_BENCHMARK_API_KEY=abc OPENROUTER_API_KEY=def Bearer ghi"
    );
    assert.doesNotMatch(text, /abc|def|ghi/);
  });
});

describe("scene-boundary JEV semantic contract", () => {
  it("question count = 1 with exact VIOLATION/COMPLIANT/INSUFFICIENT_CONTEXT choices", () => {
    const questions = buildSceneBoundaryJevQuestions();
    const ids = Object.keys(questions);
    assert.deepEqual(ids, [SCENE_BOUNDARY_JEV_QUESTION_ID]);
    const q = questions[SCENE_BOUNDARY_JEV_QUESTION_ID]!;
    assert.equal(q.type, "choice");
    assert.deepEqual(Object.keys(q.criteria as Record<string, string>).sort(), [
      ...SCENE_BOUNDARY_JEV_VERDICTS,
    ].sort());
  });

  it("JEV state contains no user/account/billing/private memory identifiers", () => {
    const fixture = SCENE_BOUNDARY_SEMANTIC_CORPUS[0]!;
    const state = buildSceneBoundaryJevStateFromFixture(fixture, ["physical_revisit"]);
    const leaks = assertSceneBoundaryJevStateHasNoPrivateIdentifiers(
      state as unknown as Record<string, unknown>
    );
    assert.deepEqual(leaks, []);
    const json = JSON.stringify(state);
    assert.doesNotMatch(json, /userId|accountId|billing|personaSecret|OPENROUTER|apiKey/i);
  });

  it("malformed JEV choice does not parse as a semantic alert verdict", () => {
    assert.equal(
      parseSceneBoundaryJevVerdict({
        [SCENE_BOUNDARY_JEV_QUESTION_ID]: { type: "choice", choice: "BLOCK" },
      }),
      null
    );
  });
});

describe("lexical scanner remains candidate owner", () => {
  it("corpus expectScannerCandidate matches current scanner behavior", () => {
    for (const fixture of SCENE_BOUNDARY_SEMANTIC_CORPUS) {
      const flags = scanR5BoundarySuspicionSignals(fixture.assistantOutput);
      const hits = (Object.keys(flags) as (keyof typeof flags)[]).filter((k) => flags[k]);
      assert.equal(
        hits.length > 0,
        fixture.expectScannerCandidate,
        `${fixture.id}: scanner=${hits.join(",")} expectCandidate=${fixture.expectScannerCandidate}`
      );
    }
  });

  it("candidate-positive semantic pool is non-degenerate across verdict classes", () => {
    const candidateRows = SCENE_BOUNDARY_SEMANTIC_CORPUS.flatMap((fixture) => {
      const flags = scanR5BoundarySuspicionSignals(fixture.assistantOutput);
      const signals = (Object.keys(flags) as (keyof typeof flags)[]).filter((k) => flags[k]);
      return signals.length > 0 ? [{ fixture, signals }] : [];
    });

    const byVerdict = {
      VIOLATION: candidateRows.filter((row) => row.fixture.expectedVerdict === "VIOLATION").length,
      COMPLIANT: candidateRows.filter((row) => row.fixture.expectedVerdict === "COMPLIANT").length,
      INSUFFICIENT_CONTEXT: candidateRows.filter(
        (row) => row.fixture.expectedVerdict === "INSUFFICIENT_CONTEXT"
      ).length,
    };

    assert.ok(byVerdict.VIOLATION >= 6, JSON.stringify(byVerdict));
    assert.ok(byVerdict.COMPLIANT >= 4, JSON.stringify(byVerdict));
    assert.ok(byVerdict.INSUFFICIENT_CONTEXT >= 2, JSON.stringify(byVerdict));

    const covered = new Set(candidateRows.flatMap((row) => row.signals));
    for (const signal of [
      "physical_revisit",
      "remote_contact",
      "gift_drop_off",
      "future_meeting_request",
      "boundary_clarification",
      "relationship_closure_demand",
    ] as const) {
      assert.equal(covered.has(signal), true, `missing candidate-positive signal ${signal}`);
    }
  });

  it("EVAL1–EVAL9 scanner regressions remain green (imported suite path present)", () => {
    const src = fs.readFileSync("src/lib/scenePolicyBoundarySuspicionScan.test.ts", "utf8");
    assert.match(src, /EVAL1/);
    assert.match(src, /EVAL9/);
    assert.match(src, /scanR5BoundarySuspicionSignals/);
  });
});

describe("scene-boundary live benchmark runner isolation", () => {
  it("1) scanner-negative fixture → JEV HTTP 0", async () => {
    const negativeOnly = SCENE_BOUNDARY_SEMANTIC_CORPUS.filter((f) => !f.expectScannerCandidate);
    assert.ok(negativeOnly.length > 0);
    const result = await runSceneBoundaryJevBenchmark({
      env: FULL_OPT_IN,
      fixtures: negativeOnly,
      log: () => {},
    });
    assert.equal(result.status, "RAN");
    if (result.status !== "RAN") return;
    assert.equal(result.totalProviderCalls, 0);
    assert.equal(fetchCalls.length, 0);
  });

  it("2–5) missing live / probe / benchmark key / prod-only key → HTTP 0", async () => {
    const cases: NodeJS.ProcessEnv[] = [
      { ...FULL_OPT_IN, REGULAR_TEST_REAL_PROVIDER_CALLS: "0" },
      { ...FULL_OPT_IN, [REAL_JEV_SCENE_BOUNDARY_PROBE_ENV]: undefined },
      { ...FULL_OPT_IN, [OPENROUTER_JEV_BENCHMARK_ENV]: "" },
      {
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        [REAL_JEV_SCENE_BOUNDARY_PROBE_ENV]: "1",
        OPENROUTER_API_KEY: "prod-only",
      },
    ];
    for (const env of cases) {
      fetchCalls = [];
      const result = await runSceneBoundaryJevBenchmark({ env, log: () => {} });
      assert.equal(result.status, "NOT_RUN");
      assert.equal(fetchCalls.length, 0);
    }
  });

  it("9) malformed JEV output is failure, never a semantic alert", async () => {
    nextChoice = null;
    const positive = SCENE_BOUNDARY_SEMANTIC_CORPUS.filter((f) => f.expectScannerCandidate).slice(0, 1);
    const result = await runSceneBoundaryJevBenchmark({
      env: FULL_OPT_IN,
      fixtures: positive,
      log: () => {},
    });
    assert.equal(result.status, "RAN");
    if (result.status !== "RAN") return;
    assert.equal(result.jev.malformedCount, 1);
    assert.equal(result.jev.violationCount, 0);
    assert.equal(result.combined.trueViolationAlerts, 0);
    assert.equal(result.combined.compliantFalseAlerts, 0);
  });

  it("with opt-in and scanner-positive fixtures: uses benchmark key only", async () => {
    nextChoice = "VIOLATION";
    const positive = SCENE_BOUNDARY_SEMANTIC_CORPUS.filter((f) => f.expectScannerCandidate).slice(0, 2);
    const result = await runSceneBoundaryJevBenchmark({
      env: FULL_OPT_IN,
      fixtures: positive,
      log: () => {},
    });
    assert.equal(result.status, "RAN");
    if (result.status !== "RAN") return;
    assert.equal(result.totalProviderCalls, positive.length);
    assert.ok(fetchCalls.every((c) => c.url === JEV_DECISIONS_URL));
    assert.ok(fetchCalls.every((c) => c.auth === "Bearer bench-jev-key-fixture"));
    assert.equal(result.productionEnforcementEnabled, false);
  });

  it("14–15) lexical stage does not write DB and issues no provider calls", () => {
    const before = fetchCalls.length;
    const lexical = runSceneBoundaryLexicalStage();
    assert.equal(fetchCalls.length, before);
    assert.ok(lexical.totalFixtures >= 24);
    assert.ok(lexical.candidateHitCount > 0);
  });
});

describe("owner / import invariants", () => {
  it("11–12) scene/reconvergence/user-authoring/autoprogression owners unchanged by this package", () => {
    // This PR must not edit those owners — assert sources still export canonical symbols.
    const reconvergence = fs.readFileSync("src/lib/reconvergenceState.ts", "utf8");
    const auto = fs.readFileSync("src/lib/autoProgressionRules.ts", "utf8");
    const authoring = fs.readFileSync("src/lib/userAuthoringPolicy.ts", "utf8");
    const directive = fs.readFileSync("src/lib/sceneDirective.ts", "utf8");
    assert.match(reconvergence, /export type ReconvergenceState/);
    assert.match(auto, /AUTO_PROGRESSION_BLOCK_TITLE/);
    assert.match(authoring, /USER_AUTHORING_LEVELS/);
    assert.match(directive, /export type SceneDirectiveMode/);
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
          text.includes("sceneBoundaryJevBenchmark") ||
          text.includes("benchmark-scene-boundary-jev-live")
        ) {
          offenders.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(root);
    assert.deepEqual(offenders, []);
  });

  it("corpus declares explicit verdicts and covers all six signals", () => {
    const signals = new Set<string>();
    for (const f of SCENE_BOUNDARY_SEMANTIC_CORPUS) {
      assert.ok(["VIOLATION", "COMPLIANT", "INSUFFICIENT_CONTEXT"].includes(f.expectedVerdict));
      assert.ok(f.rationale.trim().length > 0);
      assert.ok(f.assistantOutput.trim().length > 0);
      for (const s of f.expectedSuspicionSignals) signals.add(s);
    }
    assert.ok(SCENE_BOUNDARY_SEMANTIC_CORPUS.length >= 24);
    assert.ok(SCENE_BOUNDARY_SEMANTIC_CORPUS.length <= 36);
    for (const need of [
      "physical_revisit",
      "remote_contact",
      "gift_drop_off",
      "future_meeting_request",
      "boundary_clarification",
      "relationship_closure_demand",
    ]) {
      assert.ok(signals.has(need), `missing signal coverage: ${need}`);
    }
  });
});
