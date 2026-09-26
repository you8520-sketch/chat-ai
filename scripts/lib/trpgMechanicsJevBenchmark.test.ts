import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, mock } from "node:test";
import {
  BENCHMARK_CHEAPER_INFERENCE_ENV,
  resolveOptInTestCheaperInferenceApiKey,
} from "./benchmarkCheaperInferenceCredential";
import {
  OPENROUTER_JEV_BENCHMARK_ENV,
  REAL_JEV_TRPG_MECHANICS_PROBE_ENV,
  resolveOptInJevTrpgMechanicsBenchmarkApiKey,
  sanitizeJevBenchmarkCredentialText,
} from "./benchmarkOpenRouterJevCredential";
import {
  runTrpgMechanicsJevBenchmark,
  TRPG_MECHANICS_JEV_PROBE_FLAG,
} from "./trpgMechanicsJevBenchmark";
import { MECHANICS_REFEREE_BENCHMARK_CORPUS } from "@/lib/trpg/mechanicsRefereeBenchmarkCorpus";
import {
  assertMechanicsJevStateIsPreGmOnly,
  buildMechanicsRefereeJevQuestions,
  buildMechanicsRefereeJevState,
  jevAnswersToFlashActorEffect,
} from "@/lib/trpg/mechanicsRefereeJevPolicy";
import { isTrpgMechanicsRefereeEnabled } from "@/lib/trpg/mechanicsTypes";
import { parseFlashOrEmpty, resolveRoundMechanics } from "@/lib/trpg/mechanicsResolve";

const FULL_OPT_IN = {
  REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
  [REAL_JEV_TRPG_MECHANICS_PROBE_ENV]: "1",
  [BENCHMARK_CHEAPER_INFERENCE_ENV]: "ci-bench-key",
  [OPENROUTER_JEV_BENCHMARK_ENV]: "or-jev-bench-key",
  OPENROUTER_API_KEY: "prod-or-should-not-be-used",
  CHEAPER_INFERENCE_API_KEY: "prod-ci-should-not-be-used",
} as NodeJS.ProcessEnv;

describe("TRPG mechanics JEV benchmark credential isolation", () => {
  it("missing global live flag → NOT_RUN / HTTP 0", async () => {
    const result = await runTrpgMechanicsJevBenchmark({
      env: { ...FULL_OPT_IN, REGULAR_TEST_REAL_PROVIDER_CALLS: undefined } as NodeJS.ProcessEnv,
      log: () => {},
    });
    assert.equal(result.status, "NOT_RUN");
    assert.equal(result.providerCalls, 0);
  });

  it("missing probe flag → NOT_RUN / HTTP 0", async () => {
    const result = await runTrpgMechanicsJevBenchmark({
      env: { ...FULL_OPT_IN, [REAL_JEV_TRPG_MECHANICS_PROBE_ENV]: "0" } as NodeJS.ProcessEnv,
      log: () => {},
    });
    assert.equal(result.status, "NOT_RUN");
    assert.equal(result.providerCalls, 0);
  });

  it("missing benchmark keys → NOT_RUN even if production keys present", async () => {
    const result = await runTrpgMechanicsJevBenchmark({
      env: {
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        [REAL_JEV_TRPG_MECHANICS_PROBE_ENV]: "1",
        OPENROUTER_API_KEY: "sk-prod",
        CHEAPER_INFERENCE_API_KEY: "ci-prod",
      } as NodeJS.ProcessEnv,
      log: () => {},
    });
    assert.equal(result.status, "NOT_RUN");
    assert.equal(result.providerCalls, 0);
  });

  it("resolvers never return production keys", () => {
    assert.equal(
      resolveOptInJevTrpgMechanicsBenchmarkApiKey({
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        [REAL_JEV_TRPG_MECHANICS_PROBE_ENV]: "1",
        OPENROUTER_API_KEY: "sk-prod",
      } as NodeJS.ProcessEnv),
      null
    );
    assert.equal(
      resolveOptInTestCheaperInferenceApiKey(TRPG_MECHANICS_JEV_PROBE_FLAG, {
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        [TRPG_MECHANICS_JEV_PROBE_FLAG]: "1",
        CHEAPER_INFERENCE_API_KEY: "ci-prod",
      } as NodeJS.ProcessEnv),
      null
    );
    assert.equal(
      resolveOptInJevTrpgMechanicsBenchmarkApiKey({
        ...FULL_OPT_IN,
      }),
      "or-jev-bench-key"
    );
  });

  it("redacts credentials from log text", () => {
    const text = sanitizeJevBenchmarkCredentialText(
      "OPENROUTER_JEV_BENCHMARK_API_KEY=abc CHEAPER_INFERENCE_API_KEY=def Bearer ghi"
    );
    assert.doesNotMatch(text, /abc|def|ghi/);
  });

  it("fetch stays 0 when opt-in absent even with production keys", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      throw new Error("fetch must not be called");
    });
    try {
      const result = await runTrpgMechanicsJevBenchmark({
        env: {
          OPENROUTER_API_KEY: "sk-prod",
          CHEAPER_INFERENCE_API_KEY: "ci-prod",
        } as NodeJS.ProcessEnv,
        log: () => {},
      });
      assert.equal(result.status, "NOT_RUN");
      assert.equal(fetchMock.mock.callCount(), 0);
    } finally {
      fetchMock.mock.restore();
    }
  });
});

describe("TRPG mechanics JEV policy bounds", () => {
  it("JEV state has no hidden GM data and no current GM result", () => {
    for (const fixture of MECHANICS_REFEREE_BENCHMARK_CORPUS) {
      const state = buildMechanicsRefereeJevState(fixture);
      assert.deepEqual(assertMechanicsJevStateIsPreGmOnly(state), []);
      assert.equal(state.currentGmResultAvailable, false);
      assert.equal(state.timing, "PRE_GM");
      const json = JSON.stringify(state);
      assert.doesNotMatch(json, /"endingCandidates"|"directorState"|"hiddenGm"|"gmSecret"/i);
      assert.equal("currentGmResult" in state, false);
    }
  });

  it("JEV cannot specify numeric damage and cannot change d20/tier", () => {
    const fixture = MECHANICS_REFEREE_BENCHMARK_CORPUS[0]!;
    const effect = jevAnswersToFlashActorEffect({
      fixture,
      answers: {
        direct_effect: {
          type: "choice",
          choice: "HARM",
          probabilities: { HARM: 1, NONE: 0, HEAL: 0 },
          confidence: 1,
        },
        direct_class: {
          type: "choice",
          choice: "LIGHT",
          probabilities: { LIGHT: 1 },
          confidence: 1,
        },
        cause: {
          type: "choice",
          choice: "ENEMY_COUNTER",
          probabilities: { ENEMY_COUNTER: 1 },
          confidence: 1,
        },
        ongoing_kind: {
          type: "choice",
          choice: "NONE",
          probabilities: { NONE: 1 },
          confidence: 1,
        },
        duration: {
          type: "choice",
          choice: "NONE",
          probabilities: { NONE: 1 },
          confidence: 1,
        },
        treatment: {
          type: "choice",
          choice: "NONE",
          probabilities: { NONE: 1 },
          confidence: 1,
        },
        target: {
          type: "choice",
          choice: "P1",
          probabilities: { P1: 1 },
          confidence: 1,
        },
        consume_item: {
          type: "choice",
          choice: "NONE",
          probabilities: { NONE: 1 },
          confidence: 1,
        },
      },
    });
    assert.ok(effect);
    assert.equal(effect!.directEffect, "harm");
    assert.equal(effect!.directClass, "LIGHT");
    const json = JSON.stringify(effect);
    assert.doesNotMatch(json, /"amount"|"hpDelta"|"damage":\s*\d|"heal":\s*\d/);
    assert.equal(fixture.actor.d20, 5);
    assert.equal(fixture.actor.tier, "FAILURE");
  });

  it("target options are bounded to fixture participants", () => {
    const fixture = MECHANICS_REFEREE_BENCHMARK_CORPUS.find((f) => f.id === "PRE_D1_existing_poison_treatment")!;
    const questions = buildMechanicsRefereeJevQuestions(fixture);
    const targetKeys = Object.keys(questions.target!.criteria as Record<string, string>).sort();
    assert.deepEqual(targetKeys, ["P1", "P2"]);
    const invented = jevAnswersToFlashActorEffect({
      fixture,
      answers: {
        direct_effect: { type: "choice", choice: "NONE", probabilities: { NONE: 1 }, confidence: 1 },
        direct_class: { type: "choice", choice: "NONE", probabilities: { NONE: 1 }, confidence: 1 },
        cause: { type: "choice", choice: "NONE", probabilities: { NONE: 1 }, confidence: 1 },
        ongoing_kind: { type: "choice", choice: "NONE", probabilities: { NONE: 1 }, confidence: 1 },
        duration: { type: "choice", choice: "NONE", probabilities: { NONE: 1 }, confidence: 1 },
        treatment: { type: "choice", choice: "NONE", probabilities: { NONE: 1 }, confidence: 1 },
        target: { type: "choice", choice: "P99", probabilities: { P99: 1 }, confidence: 1 },
        consume_item: { type: "choice", choice: "NONE", probabilities: { NONE: 1 }, confidence: 1 },
      },
    });
    assert.equal(invented, null);
  });

  it("invalid JEV output fails closed to empty effects via same parse path", () => {
    const fixture = MECHANICS_REFEREE_BENCHMARK_CORPUS[0]!;
    const effect = jevAnswersToFlashActorEffect({
      fixture,
      answers: {
        direct_effect: { type: "choice", choice: "BOGUS", probabilities: { BOGUS: 1 }, confidence: 1 },
      },
    });
    assert.equal(effect, null);
    const parsed = parseFlashOrEmpty(JSON.stringify({ effects: [] }));
    assert.deepEqual(parsed.effects, []);
  });

  it("same server validator accepts mapped Flash structure", () => {
    const fixture = MECHANICS_REFEREE_BENCHMARK_CORPUS[0]!;
    const effect = jevAnswersToFlashActorEffect({
      fixture,
      answers: {
        direct_effect: { type: "choice", choice: "HARM", probabilities: { HARM: 1 }, confidence: 1 },
        direct_class: { type: "choice", choice: "LIGHT", probabilities: { LIGHT: 1 }, confidence: 1 },
        cause: { type: "choice", choice: "ENEMY_COUNTER", probabilities: { ENEMY_COUNTER: 1 }, confidence: 1 },
        ongoing_kind: { type: "choice", choice: "NONE", probabilities: { NONE: 1 }, confidence: 1 },
        duration: { type: "choice", choice: "NONE", probabilities: { NONE: 1 }, confidence: 1 },
        treatment: { type: "choice", choice: "NONE", probabilities: { NONE: 1 }, confidence: 1 },
        target: { type: "choice", choice: "P1", probabilities: { P1: 1 }, confidence: 1 },
        consume_item: { type: "choice", choice: "NONE", probabilities: { NONE: 1 }, confidence: 1 },
      },
    });
    assert.ok(effect);
    const resolution = resolveRoundMechanics({
      campaignId: 1,
      roundId: 1,
      roundNumber: 6,
      sheets: fixture.sheets,
      effects: fixture.effects,
      actors: [fixture.actor],
      flash: { effects: [effect!] },
      flashRaw: null,
      fallback: "none",
      calledFlash: true,
      model: "typesafe/jev-1.13",
      latencyMs: 1,
      baseDc: 12,
      scene: fixture.previousScene,
      rng: () => 3,
      recoveryRng: () => 1,
    });
    assert.ok(resolution.actors.length >= 1);
    assert.ok(["ok", "downgraded", "rejected_partial"].includes(resolution.validation));
  });

  it("corpus declares expected labels explicitly and stays PRE-GM sized", () => {
    assert.ok(MECHANICS_REFEREE_BENCHMARK_CORPUS.length >= 18);
    for (const fixture of MECHANICS_REFEREE_BENCHMARK_CORPUS) {
      assert.ok(fixture.expected);
      assert.ok(fixture.rationale.length > 0);
      assert.ok(fixture.previousScene.length > 0);
      assert.doesNotMatch(fixture.previousScene, /독니가 팔에 박혀|이미 중독되었다가 해독됨/);
    }
  });
});

describe("TRPG mechanics JEV benchmark production boundaries", () => {
  it("benchmark does not mutate campaign DB (no store imports in runner)", () => {
    const src = readFileSync(join(process.cwd(), "scripts/lib/trpgMechanicsJevBenchmark.ts"), "utf8");
    assert.doesNotMatch(src, /mechanicsStore|applyPersistedMechanicsEffects|persistSheets|getDb\(/);
  });

  it("referee production flag remains default OFF", () => {
    assert.equal(isTrpgMechanicsRefereeEnabled({} as NodeJS.ProcessEnv), false);
    assert.equal(
      isTrpgMechanicsRefereeEnabled({ TRPG_MECHANICS_REFEREE_ENABLED: undefined } as NodeJS.ProcessEnv),
      false
    );
  });

  it("no benchmark runner imported by runtime source", () => {
    const productionPaths = [
      "src/lib/trpg/engineAdvance.ts",
      "src/lib/trpg/mechanicsRound.ts",
      "src/lib/trpg/mechanicsReferee.ts",
      "src/lib/trpg/mechanicsResolve.ts",
      "src/lib/jevDecisions.ts",
    ];
    for (const rel of productionPaths) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      assert.doesNotMatch(src, /trpgMechanicsJevBenchmark|benchmark-trpg-mechanics-jev-live/);
    }
  });

  it("narrow credential seams exist; production callers omit overrides", () => {
    const referee = readFileSync(join(process.cwd(), "src/lib/trpg/mechanicsReferee.ts"), "utf8");
    assert.match(referee, /cheaperInferenceApiKeyOverride/);
    assert.match(referee, /opts\.cheaperInferenceApiKeyOverride\?\.trim\(\) \|\| resolveCheaperInferenceApiKey\(\)/);
    const round = readFileSync(join(process.cwd(), "src/lib/trpg/mechanicsRound.ts"), "utf8");
    assert.doesNotMatch(round, /cheaperInferenceApiKeyOverride/);
    const jev = readFileSync(join(process.cwd(), "src/lib/jevDecisions.ts"), "utf8");
    assert.match(jev, /apiKey\?: string/);
    assert.match(jev, /opts\.apiKey\?\.trim\(\) \|\| resolveOpenRouterApiKey\(\)/);
  });

  it("retry/GM failure and double-damage invariants remain declared", () => {
    const types = readFileSync(join(process.cwd(), "src/lib/trpg/mechanicsTypes.ts"), "utf8");
    assert.match(types, /NO_DOUBLE_DAMAGE = true/);
    assert.match(types, /NO_DOUBLE_ITEM_CONSUME = true/);
    const round = readFileSync(join(process.cwd(), "src/lib/trpg/mechanicsRound.ts"), "utf8");
    assert.match(round, /flash_failure/);
  });
});
