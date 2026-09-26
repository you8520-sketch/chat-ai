import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";

/**
 * Regular-test egress policy regression (canonical owner:
 * src/lib/test/regularTestEgressPolicy.ts).
 *
 * Deterministic subprocess matrix — zero live provider calls.
 * Children only print env / resolver results after the policy `--import`.
 */
const POLICY_IMPORT = "./src/lib/test/regularTestEgressPolicy.ts";
const RESOLVER_IMPORT =
  "./scripts/lib/benchmarkCheaperInferenceCredential.ts";

function runEnvChild(env: NodeJS.ProcessEnv): {
  ci: string | null;
  or: string | null;
  oai: string | null;
  bench: string | null;
} {
  const out = execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--import",
      POLICY_IMPORT,
      "-e",
      `console.log(JSON.stringify({
        ci: process.env.CHEAPER_INFERENCE_API_KEY ?? null,
        or: process.env.OPENROUTER_API_KEY ?? null,
        oai: process.env.OPENAI_API_KEY ?? null,
        bench: process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY ?? null,
      }))`,
    ],
    { cwd: process.cwd(), env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return JSON.parse(out.trim()) as {
    ci: string | null;
    or: string | null;
    oai: string | null;
    bench: string | null;
  };
}

function runResolverChild(
  env: NodeJS.ProcessEnv,
  probeFlag: string
): string | null {
  const out = execFileSync(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "--import",
      POLICY_IMPORT,
      "-e",
      `import { resolveOptInTestCheaperInferenceApiKey } from ${JSON.stringify(
        RESOLVER_IMPORT
      )};
       console.log(JSON.stringify(
         resolveOptInTestCheaperInferenceApiKey(${JSON.stringify(probeFlag)})
       ));`,
    ],
    { cwd: process.cwd(), env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return JSON.parse(out.trim()) as string | null;
}

describe("regular-test egress policy matrix", () => {
  it("A: strips prod keys when REGULAR_TEST_REAL_PROVIDER_CALLS absent", () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CHEAPER_INFERENCE_API_KEY: "ambient-prod-fixture",
      OPENROUTER_API_KEY: "ambient-or-fixture",
      OPENAI_API_KEY: "ambient-oai-fixture",
    };
    delete env.REGULAR_TEST_REAL_PROVIDER_CALLS;
    const seen = runEnvChild(env);
    assert.equal(seen.ci, null);
    assert.equal(seen.or, null);
    assert.equal(seen.oai, null);
  });

  it("B: still strips prod keys when REGULAR_TEST_REAL_PROVIDER_CALLS=1", () => {
    const seen = runEnvChild({
      ...process.env,
      CHEAPER_INFERENCE_API_KEY: "ambient-prod-fixture",
      OPENROUTER_API_KEY: "ambient-or-fixture",
      OPENAI_API_KEY: "ambient-oai-fixture",
      REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
    });
    assert.equal(seen.ci, null);
    assert.equal(seen.or, null);
    assert.equal(seen.oai, null);
  });

  it("C: leaves benchmark key untouched", () => {
    const seen = runEnvChild({
      ...process.env,
      CHEAPER_INFERENCE_BENCHMARK_API_KEY: "bench-fixture",
    });
    assert.equal(seen.bench, "bench-fixture");
  });

  it("D: global=1 + probe=1 + benchmark key => resolver returns benchmark key", () => {
    const resolved = runResolverChild(
      {
        ...process.env,
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        REAL_TRPG_GM_PROVIDER_PROBE: "1",
        CHEAPER_INFERENCE_BENCHMARK_API_KEY: "bench-eligible",
        CHEAPER_INFERENCE_API_KEY: "prod-must-not-resurface",
      },
      "REAL_TRPG_GM_PROVIDER_PROBE"
    );
    assert.equal(resolved, "bench-eligible");
  });

  it("E: production key only => manual probe resolver returns null", () => {
    const resolved = runResolverChild(
      {
        ...process.env,
        REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
        REAL_TRPG_GM_PROVIDER_PROBE: "1",
        CHEAPER_INFERENCE_API_KEY: "prod-only-fixture",
      },
      "REAL_TRPG_GM_PROVIDER_PROBE"
    );
    assert.equal(resolved, null);
  });

  it("F: prod + benchmark together => resolver uses benchmark only", () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
      REAL_TRPG_GM_PROVIDER_PROBE: "1",
      CHEAPER_INFERENCE_API_KEY: "prod-must-not-win",
      CHEAPER_INFERENCE_BENCHMARK_API_KEY: "bench-only-winner",
      OPENROUTER_API_KEY: "or-must-be-stripped",
      OPENAI_API_KEY: "oai-must-be-stripped",
    };
    const seen = runEnvChild(env);
    assert.equal(seen.ci, null);
    assert.equal(seen.or, null);
    assert.equal(seen.oai, null);
    assert.equal(seen.bench, "bench-only-winner");
    const resolved = runResolverChild(env, "REAL_TRPG_GM_PROVIDER_PROBE");
    assert.equal(resolved, "bench-only-winner");
  });
});
