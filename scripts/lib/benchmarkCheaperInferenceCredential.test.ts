import assert from "node:assert/strict";
import test from "node:test";
import {
  BENCHMARK_CHEAPER_INFERENCE_ENV,
  resolveBenchmarkCheaperInferenceApiKey,
  resolveOptInTestCheaperInferenceApiKey,
  sanitizeBenchmarkCredentialText,
} from "./benchmarkCheaperInferenceCredential";

test("A benchmark helper returns null when benchmark and production keys absent", () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  const prevBench = process.env[BENCHMARK_CHEAPER_INFERENCE_ENV];
  delete process.env.CHEAPER_INFERENCE_API_KEY;
  delete process.env[BENCHMARK_CHEAPER_INFERENCE_ENV];
  try {
    assert.equal(resolveBenchmarkCheaperInferenceApiKey(), null);
  } finally {
    if (prevProd === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = prevProd;
    if (prevBench === undefined) delete process.env[BENCHMARK_CHEAPER_INFERENCE_ENV];
    else process.env[BENCHMARK_CHEAPER_INFERENCE_ENV] = prevBench;
  }
});

test("benchmark helper ignores production key when benchmark key absent", () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  const prevBench = process.env[BENCHMARK_CHEAPER_INFERENCE_ENV];
  process.env.CHEAPER_INFERENCE_API_KEY = "prod-key-fixture";
  delete process.env[BENCHMARK_CHEAPER_INFERENCE_ENV];
  try {
    assert.equal(resolveBenchmarkCheaperInferenceApiKey(), null);
  } finally {
    if (prevProd === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = prevProd;
    if (prevBench === undefined) delete process.env[BENCHMARK_CHEAPER_INFERENCE_ENV];
    else process.env[BENCHMARK_CHEAPER_INFERENCE_ENV] = prevBench;
  }
});

test("sanitizer redacts benchmark and production env assignment text", () => {
  const sanitized = sanitizeBenchmarkCredentialText(
    "failed: CHEAPER_INFERENCE_BENCHMARK_API_KEY=secret-bench CHEAPER_INFERENCE_API_KEY=secret-prod"
  );
  assert.match(sanitized, /CHEAPER_INFERENCE_BENCHMARK_API_KEY=\[REDACTED\]/);
  assert.match(sanitized, /CHEAPER_INFERENCE_API_KEY=\[REDACTED\]/);
  assert.doesNotMatch(sanitized, /secret-bench/);
  assert.doesNotMatch(sanitized, /secret-prod/);
});


test("live provider probe requires global opt-in, probe opt-in, and benchmark key", () => {
  const probeFlag = "REAL_PROVIDER_TEST_FIXTURE";
  const env = {
    REGULAR_TEST_REAL_PROVIDER_CALLS: "0",
    [probeFlag]: "1",
    [BENCHMARK_CHEAPER_INFERENCE_ENV]: "bench-key",
    CHEAPER_INFERENCE_API_KEY: "prod-key-must-never-be-used",
  } as NodeJS.ProcessEnv;

  assert.equal(resolveOptInTestCheaperInferenceApiKey(probeFlag, env), null);

  env.REGULAR_TEST_REAL_PROVIDER_CALLS = "1";
  env[probeFlag] = "0";
  assert.equal(resolveOptInTestCheaperInferenceApiKey(probeFlag, env), null);

  env[probeFlag] = "1";
  delete env[BENCHMARK_CHEAPER_INFERENCE_ENV];
  assert.equal(resolveOptInTestCheaperInferenceApiKey(probeFlag, env), null);

  env[BENCHMARK_CHEAPER_INFERENCE_ENV] = "bench-key";
  assert.equal(resolveOptInTestCheaperInferenceApiKey(probeFlag, env), "bench-key");
});
