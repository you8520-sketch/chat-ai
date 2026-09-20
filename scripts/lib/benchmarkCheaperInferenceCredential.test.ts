import assert from "node:assert/strict";
import test from "node:test";
import {
  BENCHMARK_CHEAPER_INFERENCE_ENV,
  resolveBenchmarkCheaperInferenceApiKey,
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
