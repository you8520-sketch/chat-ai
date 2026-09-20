import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { callOpenRouterCompletion } from "./openRouterCompletion";
import { callPromptTranslation } from "./ai";

const PROD_FIXTURE = "prod-key-fixture";
const BENCHMARK_FIXTURE = "benchmark-key-fixture";
const CI_MODEL = "deepseek-v4-flash";
const OR_MODEL = "google/gemini-2.0-flash-001";

function mockFetchCaptureAuth(): {
  restore: () => void;
  authHeader: () => string | null;
  callCount: () => number;
} {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  let lastAuth: string | null = null;
  globalThis.fetch = (async (_input, init) => {
    calls += 1;
    const headers = init?.headers;
    if (headers instanceof Headers) {
      lastAuth = headers.get("Authorization");
    } else if (headers && typeof headers === "object") {
      lastAuth = String((headers as Record<string, string>).Authorization ?? "");
    }
    return new Response(
      JSON.stringify({
        model: CI_MODEL,
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = previousFetch;
    },
    authHeader: () => lastAuth,
    callCount: () => calls,
  };
}

function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

test("E production call without override resolves CHEAPER_INFERENCE_API_KEY", async () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  const prevBench = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = PROD_FIXTURE;
  delete process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY;
  const mock = mockFetchCaptureAuth();
  try {
    await callOpenRouterCompletion({
      model: CI_MODEL,
      system: "system",
      history: [{ role: "user", content: "hello" }],
      maxTokens: 32,
    });
    assert.equal(mock.authHeader(), `Bearer ${PROD_FIXTURE}`);
  } finally {
    mock.restore();
    restoreEnv("CHEAPER_INFERENCE_API_KEY", prevProd);
    restoreEnv("CHEAPER_INFERENCE_BENCHMARK_API_KEY", prevBench);
  }
});

test("F explicit override uses override and not production resolver", async () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = PROD_FIXTURE;
  const mock = mockFetchCaptureAuth();
  try {
    await callOpenRouterCompletion({
      model: CI_MODEL,
      system: "system",
      history: [{ role: "user", content: "hello" }],
      maxTokens: 32,
      cheaperInferenceApiKeyOverride: BENCHMARK_FIXTURE,
    });
    assert.equal(mock.authHeader(), `Bearer ${BENCHMARK_FIXTURE}`);
    assert.notEqual(mock.authHeader(), `Bearer ${PROD_FIXTURE}`);
  } finally {
    mock.restore();
    restoreEnv("CHEAPER_INFERENCE_API_KEY", prevProd);
  }
});

test("C benchmark override works when production key is absent", async () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  delete process.env.CHEAPER_INFERENCE_API_KEY;
  const mock = mockFetchCaptureAuth();
  try {
    await callOpenRouterCompletion({
      model: CI_MODEL,
      system: "system",
      history: [{ role: "user", content: "hello" }],
      maxTokens: 32,
      cheaperInferenceApiKeyOverride: BENCHMARK_FIXTURE,
    });
    assert.equal(mock.authHeader(), `Bearer ${BENCHMARK_FIXTURE}`);
  } finally {
    mock.restore();
    restoreEnv("CHEAPER_INFERENCE_API_KEY", prevProd);
  }
});

test("D when both keys exist explicit override uses benchmark fixture only", async () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  const prevBench = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = PROD_FIXTURE;
  process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY = BENCHMARK_FIXTURE;
  const mock = mockFetchCaptureAuth();
  try {
    await callPromptTranslation("system", [{ role: "user", content: "hi" }], CI_MODEL, {
      cheaperInferenceApiKeyOverride: BENCHMARK_FIXTURE,
    });
    assert.equal(mock.authHeader(), `Bearer ${BENCHMARK_FIXTURE}`);
  } finally {
    mock.restore();
    restoreEnv("CHEAPER_INFERENCE_API_KEY", prevProd);
    restoreEnv("CHEAPER_INFERENCE_BENCHMARK_API_KEY", prevBench);
  }
});

test("G OpenRouter model path ignores CheaperInference override", async () => {
  const prevOr = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "openrouter-fixture";
  const mock = mockFetchCaptureAuth();
  try {
    await callOpenRouterCompletion({
      model: OR_MODEL,
      system: "system",
      history: [{ role: "user", content: "hello" }],
      maxTokens: 32,
      cheaperInferenceApiKeyOverride: BENCHMARK_FIXTURE,
    });
    assert.equal(mock.authHeader(), "Bearer openrouter-fixture");
  } finally {
    mock.restore();
    restoreEnv("OPENROUTER_API_KEY", prevOr);
  }
});

test("B manual translation bench: production key present, benchmark absent => provider HTTP 0", () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  const prevBench = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY;
  const prevRun = process.env.RUN_REAL_TRANSLATION_AB;
  process.env.CHEAPER_INFERENCE_API_KEY = PROD_FIXTURE;
  delete process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY;
  process.env.RUN_REAL_TRANSLATION_AB = "1";
  const result = spawnSync(
    "npx",
    ["tsx", "scripts/bench-pr2-translation-ab.ts"],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      timeout: 120_000,
    }
  );
  try {
    assert.equal(result.status, 0);
    const out = `${result.stdout}\n${result.stderr}`;
    assert.match(out, /AB_STATUS=NOT_RUN/);
    assert.match(out, /CHEAPER_INFERENCE_BENCHMARK_API_KEY/);
    assert.match(out, /provider calls=0/);
    assert.doesNotMatch(out, new RegExp(PROD_FIXTURE));
    assert.doesNotMatch(out, /Bearer/);
  } finally {
    restoreEnv("CHEAPER_INFERENCE_API_KEY", prevProd);
    restoreEnv("CHEAPER_INFERENCE_BENCHMARK_API_KEY", prevBench);
    restoreEnv("RUN_REAL_TRANSLATION_AB", prevRun);
  }
});

test("H missing benchmark key exits NOT_RUN before transport for luna micro bench", () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  const prevBench = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY;
  const prevRun = process.env.RUN_REAL_LUNA_GEMINI_MICRO;
  process.env.CHEAPER_INFERENCE_API_KEY = PROD_FIXTURE;
  delete process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY;
  process.env.RUN_REAL_LUNA_GEMINI_MICRO = "1";
  const result = spawnSync(
    "npx",
    ["tsx", "scripts/bench-luna-vs-gemini31-flash-lite.ts"],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      timeout: 120_000,
    }
  );
  try {
    assert.equal(result.status, 0);
    const out = `${result.stdout}\n${result.stderr}`;
    assert.match(out, /MICRO_STATUS=NOT_RUN/);
    assert.match(out, /REAL_PROVIDER_CALLS=0/);
    assert.doesNotMatch(out, new RegExp(PROD_FIXTURE));
  } finally {
    restoreEnv("CHEAPER_INFERENCE_API_KEY", prevProd);
    restoreEnv("CHEAPER_INFERENCE_BENCHMARK_API_KEY", prevBench);
    restoreEnv("RUN_REAL_LUNA_GEMINI_MICRO", prevRun);
  }
});

test("J manual Main RP harness: production key present, benchmark absent => provider HTTP 0", () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  const prevBench = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY;
  const prevAllow = process.env.LUNA_MINIMAL_CORE_V1_ALLOW_API;
  process.env.CHEAPER_INFERENCE_API_KEY = PROD_FIXTURE;
  delete process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY;
  process.env.LUNA_MINIMAL_CORE_V1_ALLOW_API = "1";
  const result = spawnSync(
    "node",
    ["--conditions=react-server", "--import", "tsx", "scripts/luna-minimal-core-v1-gate.ts"],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      timeout: 120_000,
    }
  );
  try {
    assert.equal(result.status, 0);
    const out = `${result.stdout}\n${result.stderr}`;
    assert.match(out, /NOT_RUN.*CHEAPER_INFERENCE_BENCHMARK_API_KEY/);
    assert.match(out, /provider calls=0/);
    assert.doesNotMatch(out, new RegExp(PROD_FIXTURE));
  } finally {
    restoreEnv("CHEAPER_INFERENCE_API_KEY", prevProd);
    restoreEnv("CHEAPER_INFERENCE_BENCHMARK_API_KEY", prevBench);
    restoreEnv("LUNA_MINIMAL_CORE_V1_ALLOW_API", prevAllow);
  }
});

async function loadStreamOpenRouterAdultModule() {
  const Module = await import("module");
  const originalLoad = (Module.default as unknown as { _load: typeof Module._load })._load;
  (Module.default as unknown as { _load: typeof Module._load })._load = function (
    request: string,
    parent: NodeModule,
    isMain: boolean
  ) {
    if (request === "server-only") return {};
    return originalLoad.call(this, request, parent, isMain);
  } as typeof Module._load;
  return import("./openRouterAdult");
}

function mockStreamFetchCaptureAuth(): {
  restore: () => void;
  authHeaders: () => string[];
} {
  const previousFetch = globalThis.fetch;
  const headers: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    const h = init?.headers;
    if (h instanceof Headers) headers.push(h.get("Authorization") ?? "");
    else if (h && typeof h === "object") {
      headers.push(String((h as Record<string, string>).Authorization ?? ""));
    }
    const sse = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';
    return new Response(sse, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = previousFetch;
    },
    authHeaders: () => headers,
  };
}

test("K explicit CI override on compatible streaming transport uses benchmark Authorization", async () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = PROD_FIXTURE;
  const mock = mockStreamFetchCaptureAuth();
  try {
    const { streamOpenRouterAdult } = await loadStreamOpenRouterAdultModule();
    const stream = streamOpenRouterAdult(
      "system",
      [{ role: "user", content: "hello" }],
      "deepseek-v4-pro-0813",
      800,
      {
        transportProvider: "cheaperinference",
        cheaperInferenceApiKeyOverride: BENCHMARK_FIXTURE,
        allowOpenRouterUnderLengthRecovery: false,
      },
      { requestKind: "credential-boundary-k", chargeTurnBudget: false }
    );
    for await (const _chunk of stream) {
      /* drain */
    }
    const providerAuths = mock.authHeaders().filter((h) => h.startsWith("Bearer "));
    assert.ok(providerAuths.length >= 1);
    assert.equal(providerAuths[0], `Bearer ${BENCHMARK_FIXTURE}`);
  } finally {
    mock.restore();
    restoreEnv("CHEAPER_INFERENCE_API_KEY", prevProd);
  }
});

test("L production compatible streaming transport without override uses production resolver", async () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = PROD_FIXTURE;
  const mock = mockStreamFetchCaptureAuth();
  try {
    const { streamOpenRouterAdult } = await loadStreamOpenRouterAdultModule();
    const stream = streamOpenRouterAdult(
      "system",
      [{ role: "user", content: "hello" }],
      "deepseek-v4-pro-0813",
      800,
      {
        transportProvider: "cheaperinference",
        allowOpenRouterUnderLengthRecovery: false,
      },
      { requestKind: "credential-boundary-l", chargeTurnBudget: false }
    );
    for await (const _chunk of stream) {
      /* drain */
    }
    const providerAuths = mock.authHeaders().filter((h) => h.startsWith("Bearer "));
    assert.ok(providerAuths.length >= 1);
    assert.equal(providerAuths[0], `Bearer ${PROD_FIXTURE}`);
  } finally {
    mock.restore();
    restoreEnv("CHEAPER_INFERENCE_API_KEY", prevProd);
  }
});

test("M CI primary explicit override with OpenRouter failover keeps backup on OPENROUTER_API_KEY", async () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  const prevOr = process.env.OPENROUTER_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = PROD_FIXTURE;
  process.env.OPENROUTER_API_KEY = "openrouter-fixture";
  const auths: string[] = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const h = init?.headers;
    if (h instanceof Headers) auths.push(h.get("Authorization") ?? "");
    else if (h && typeof h === "object") {
      auths.push(String((h as Record<string, string>).Authorization ?? ""));
    }
    if (auths.length === 1) {
      return new Response("upstream error", { status: 503 });
    }
    return new Response(
      JSON.stringify({
        model: "deepseek/deepseek-v4-pro",
        choices: [{ message: { content: "backup ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  try {
    const { executeDeepSeekWithProviderFailover } = await import("./deepseekProviderFailover");
    const result = await executeDeepSeekWithProviderFailover({
      routeKind: "background_flash",
      logicalModel: "deepseek-v4-pro-0813",
      primary: {
        endpoint: "https://api.cheaperinference.com/v1/chat/completions",
        headers: { Authorization: `Bearer ${BENCHMARK_FIXTURE}`, "Content-Type": "application/json" },
        body: { model: "deepseek-v4-pro-0813", messages: [{ role: "user", content: "hi" }] },
      },
      backupBody: {
        model: "deepseek/deepseek-v4-pro",
        messages: [{ role: "user", content: "hi" }],
      },
      stream: false,
    });
    assert.equal(result.usedProvider, "openrouter");
    assert.equal(auths[0], `Bearer ${BENCHMARK_FIXTURE}`);
    assert.equal(auths[1], "Bearer openrouter-fixture");
    assert.notEqual(auths[1], `Bearer ${BENCHMARK_FIXTURE}`);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("CHEAPER_INFERENCE_API_KEY", prevProd);
    restoreEnv("OPENROUTER_API_KEY", prevOr);
  }
});

test("N direct diagnostic script: production key present, benchmark absent => provider HTTP 0", () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  const prevBench = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = PROD_FIXTURE;
  delete process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY;
  const result = spawnSync(
    "node",
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/diagnose-opus-fresh-cache-t789.ts",
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_TEST_CONTEXT: "1" },
      encoding: "utf8",
      timeout: 120_000,
    }
  );
  try {
    assert.equal(result.status, 0);
    const out = `${result.stdout}\n${result.stderr}`;
    assert.match(out, /DIAG_STATUS.*CHEAPER_INFERENCE_BENCHMARK_API_KEY/);
    assert.match(out, /provider calls=0/);
    assert.doesNotMatch(out, new RegExp(PROD_FIXTURE));
  } finally {
    restoreEnv("CHEAPER_INFERENCE_API_KEY", prevProd);
    restoreEnv("CHEAPER_INFERENCE_BENCHMARK_API_KEY", prevBench);
  }
});

test("O Luna/Terra harness: production key present, benchmark absent => provider HTTP 0", () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  const prevBench = process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY;
  const prevAllow = process.env.WORLD_MOTION_V1_1_ALLOW_API;
  process.env.CHEAPER_INFERENCE_API_KEY = PROD_FIXTURE;
  delete process.env.CHEAPER_INFERENCE_BENCHMARK_API_KEY;
  process.env.WORLD_MOTION_V1_1_ALLOW_API = "1";
  const result = spawnSync(
    "node",
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      "scripts/world-motion-v1_1-weighted-rotation-gate.ts",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      timeout: 120_000,
    }
  );
  try {
    assert.equal(result.status, 0);
    const out = `${result.stdout}\n${result.stderr}`;
    assert.match(out, /NOT_RUN.*CHEAPER_INFERENCE_BENCHMARK_API_KEY/);
    assert.match(out, /provider calls=0/);
    assert.doesNotMatch(out, new RegExp(PROD_FIXTURE));
  } finally {
    restoreEnv("CHEAPER_INFERENCE_API_KEY", prevProd);
    restoreEnv("CHEAPER_INFERENCE_BENCHMARK_API_KEY", prevBench);
    restoreEnv("WORLD_MOTION_V1_1_ALLOW_API", prevAllow);
  }
});

test("I transport errors do not echo credential fixture values", async () => {
  const prevProd = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = PROD_FIXTURE;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: "unauthorized" } }), {
      status: 401,
    })) as typeof fetch;
  try {
    await assert.rejects(
      () =>
        callOpenRouterCompletion({
          model: CI_MODEL,
          system: "system",
          history: [{ role: "user", content: "hello" }],
          maxTokens: 32,
        }),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        assert.doesNotMatch(message, new RegExp(PROD_FIXTURE));
        return true;
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("CHEAPER_INFERENCE_API_KEY", prevProd);
  }
});
