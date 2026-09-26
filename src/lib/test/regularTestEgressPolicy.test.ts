import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";

/**
 * Regular-test egress policy regression (canonical owner:
 * src/lib/test/regularTestEgressPolicy.ts).
 *
 * Proves via child processes (never the live network):
 * - ambient paid-provider credentials are stripped without opt-in,
 * - explicit live opt-in keeps them for manual probes,
 * - fixture-keyed tests keep working deterministically.
 * Zero live provider calls — children only print env presence.
 */
const POLICY_IMPORT = "./src/lib/test/regularTestEgressPolicy.ts";

function runChild(env: NodeJS.ProcessEnv): { ci: string; or: string; oai: string } {
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
      }))`,
    ],
    { cwd: process.cwd(), env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return JSON.parse(out.trim()) as { ci: string; or: string; oai: string };
}

describe("regular-test egress policy", () => {
  it("strips ambient paid credentials without live opt-in", () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CHEAPER_INFERENCE_API_KEY: "ambient-prod-fixture",
      OPENROUTER_API_KEY: "ambient-or-fixture",
      OPENAI_API_KEY: "ambient-oai-fixture",
    };
    delete env.REGULAR_TEST_REAL_PROVIDER_CALLS;
    const seen = runChild(env);
    assert.equal(seen.ci, null);
    assert.equal(seen.or, null);
    assert.equal(seen.oai, null);
  });

  it("keeps credentials under explicit live opt-in (manual probes)", () => {
    const seen = runChild({
      ...process.env,
      CHEAPER_INFERENCE_API_KEY: "ambient-prod-fixture",
      OPENROUTER_API_KEY: "ambient-or-fixture",
      OPENAI_API_KEY: "ambient-oai-fixture",
      REGULAR_TEST_REAL_PROVIDER_CALLS: "1",
    });
    assert.equal(seen.ci, "ambient-prod-fixture");
    assert.equal(seen.or, "ambient-or-fixture");
    assert.equal(seen.oai, "ambient-oai-fixture");
  });

  it("does not touch the benchmark-only credential", () => {
    const out = execFileSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        "--import",
        POLICY_IMPORT,
        "-e",
        `console.log(process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY ?? "absent")`,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CHEAPER_INFERENCE_BENCHMARK_API_KEY: "bench-fixture",
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    assert.equal(out.trim(), "bench-fixture");
  });
});
