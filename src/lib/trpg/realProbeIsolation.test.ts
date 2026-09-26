import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { resolveOptInTestCheaperInferenceApiKey } from "../../../scripts/lib/benchmarkCheaperInferenceCredential";

/**
 * PR #1069 follow-up audit — MANUAL live-provider probe isolation only.
 *
 * These gates prove that known INTENTIONAL live probes run exclusively
 * through the canonical benchmark triple opt-in owner, never on a
 * production credential alone. They do NOT prove a global regular-test
 * no-egress invariant: a separate full-suite blocker audit found ~31
 * accidental background egress attempts (derived-cache /
 * relationship-meta / rolling-summary / lorebook / postTurn / statusMeta /
 * translation) that need their own architecture audit + fix as follow-up.
 *
 * Deterministic only — injected env, fake keys, static execution-path
 * probes. Zero live provider calls.
 */
describe("manual live-provider probe isolation gates", () => {
  const withEnv = (patch: Record<string, string | undefined>, run: () => void) => {
    const saved: Record<string, string | undefined> = {};
    for (const key of Object.keys(patch)) saved[key] = process.env[key];
    try {
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      run();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };

  it("production key only => manual probe not eligible", () => {
    withEnv(
      {
        CHEAPER_INFERENCE_API_KEY: "prod-key-fixture",
        REGULAR_TEST_REAL_PROVIDER_CALLS: undefined,
        REAL_TRPG_GM_PROVIDER_PROBE: undefined,
        REAL_GM_COMPLETION_PROBE: undefined,
        CHEAPER_INFERENCE_BENCHMARK_API_KEY: undefined,
      },
      () => {
        assert.equal(resolveOptInTestCheaperInferenceApiKey("REAL_TRPG_GM_PROVIDER_PROBE"), null);
        assert.equal(resolveOptInTestCheaperInferenceApiKey("REAL_GM_COMPLETION_PROBE"), null);
      }
    );
  });

  it("global opt-in OFF => manual probe not eligible", () => {
    withEnv(
      {
        CHEAPER_INFERENCE_API_KEY: "prod-key-fixture",
        REGULAR_TEST_REAL_PROVIDER_CALLS: "0",
        REAL_TRPG_GM_PROVIDER_PROBE: "1",
        CHEAPER_INFERENCE_BENCHMARK_API_KEY: "bench-key-fixture",
      },
      () => {
        assert.equal(resolveOptInTestCheaperInferenceApiKey("REAL_TRPG_GM_PROVIDER_PROBE"), null);
      }
    );
  });

  it("probe-specific opt-in OFF => manual probe not eligible", () => {
    withEnv(
      {
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        REAL_TRPG_GM_PROVIDER_PROBE: "0",
        CHEAPER_INFERENCE_BENCHMARK_API_KEY: "bench-key-fixture",
      },
      () => {
        assert.equal(resolveOptInTestCheaperInferenceApiKey("REAL_TRPG_GM_PROVIDER_PROBE"), null);
      }
    );
  });

  it("benchmark key absent => manual probe not eligible", () => {
    withEnv(
      {
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        REAL_TRPG_GM_PROVIDER_PROBE: "1",
        CHEAPER_INFERENCE_BENCHMARK_API_KEY: undefined,
      },
      () => {
        assert.equal(resolveOptInTestCheaperInferenceApiKey("REAL_TRPG_GM_PROVIDER_PROBE"), null);
      }
    );
  });

  it("explicit triple opt-in resolves the benchmark key for the manual probe, never the production key", () => {
    withEnv(
      {
        CHEAPER_INFERENCE_API_KEY: "prod-key-fixture",
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        REAL_TRPG_GM_PROVIDER_PROBE: "1",
        CHEAPER_INFERENCE_BENCHMARK_API_KEY: "bench-key-fixture",
      },
      () => {
        assert.equal(
          resolveOptInTestCheaperInferenceApiKey("REAL_TRPG_GM_PROVIDER_PROBE"),
          "bench-key-fixture"
        );
      }
    );
  });

  it("gmCompletionIntegrity probe is triple-gated on the benchmark credential", () => {
    const src = fs.readFileSync("src/lib/trpg/gmCompletionIntegrity.test.ts", "utf8");
    assert.match(src, /resolveOptInTestCheaperInferenceApiKey\(REAL_GM_COMPLETION_PROBE\)/);
    assert.match(src, /cheaperInferenceApiKeyOverride: benchmarkKey/);
    assert.doesNotMatch(src, /startsWith\("your_"\)/);
  });

  it("gmResolutionRealProbe pins exactly 6 Gemini fixtures behind triple opt-in", () => {
    const src = fs.readFileSync("src/lib/trpg/gmResolutionRealProbe.test.ts", "utf8");
    const ids = src.match(/id: "F\d+"/g) ?? [];
    assert.deepEqual(ids, ['id: "F1"', 'id: "F2"', 'id: "F3"', 'id: "F4"', 'id: "F5"', 'id: "F6"']);
    assert.match(
      src,
      /requires REGULAR_TEST_REAL_PROVIDER_CALLS=1 \+ REAL_TRPG_GM_PROVIDER_PROBE=1 \+ CHEAPER_INFERENCE_BENCHMARK_API_KEY/
    );
    assert.match(src, /cheaperInferenceApiKeyOverride: benchmarkKey/);
  });

  it("only known manual probe flags exist (single benchmark opt-in owner, no parallel manual activation owner)", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".next") continue;
          walk(full);
        } else if (/\.test\.ts$/.test(entry.name)) {
          const src = fs.readFileSync(full, "utf8");
          if (/REAL_[A-Z_]*PROBE/.test(src)) hits.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.join(process.cwd(), "src"));
    for (const file of hits) {
      assert.match(
        file,
        /gmResolutionRealProbe|gmCompletionIntegrity|realProbeIsolation|schemaProviderProbe|regularTestEgressPolicy/,
        `unexpected manual probe flag owner: ${file}`
      );
    }
    assert.ok(hits.length >= 3, "expected the known manual probe flag files to be found");
  });

  it("playwright regression server cannot inherit provider credentials (Luna-safe greeting)", () => {
    const config = fs.readFileSync("playwright.config.ts", "utf8");
    for (const key of [
      "CHEAPER_INFERENCE_API_KEY",
      "CHEAPER_INFERENCE_BENCHMARK_API_KEY",
      "OPENROUTER_API_KEY",
      "OPENAI_API_KEY",
    ]) {
      assert.match(config, new RegExp(`${key}: ""`));
    }
    assert.match(config, /REGULAR_TEST_REAL_PROVIDER_CALLS: "0"/);
    assert.match(config, /REAL_TRPG_GM_PROVIDER_PROBE: "0"/);
  });

  it("production runtime credential resolution is unchanged", () => {
    const boundary = fs.readFileSync("src/lib/cheaperInferenceConfig.ts", "utf8");
    assert.match(boundary, /resolveCheaperInferenceApiKey/);
    assert.doesNotMatch(boundary, /REGULAR_TEST_REAL_PROVIDER_CALLS/);
    assert.doesNotMatch(boundary, /BENCHMARK/);
  });
});
