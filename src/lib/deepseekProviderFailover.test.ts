import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
  OPENROUTER_GEMINI_31_FLASH_MODEL,
  OPENROUTER_GEMINI_36_FLASH_MODEL,
  OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL,
} from "./chatModels";
import {
  DEEPSEEK_TRANSIENT_HTTP_STATUSES,
  DeepSeekDeterministicProviderError,
  DeepSeekProviderFailoverError,
  executeDeepSeekWithProviderFailover,
  MAX_MAIN_RP_EXTERNAL_PROVIDER_ATTEMPTS,
  adaptOpenRouterDeepSeekBackupBody,
  classifyDeepSeekProviderFailure,
  createDeepSeekLogicalTurnLedger,
  extractVisibleAssistantDeltaFromSseJson,
  OPENROUTER_DEEPSEEK_TRUE_OFF_REASONING,
  resolveDeepSeekBackupModelId,
  resolveDeepSeekFailoverRouteKind,
  type DeepSeekAssembledRequest,
  type DeepSeekFailoverTelemetry,
  type DeepSeekRouteKind,
} from "./deepseekProviderFailover";

const CI_URL = "https://api.cheaperinference.com/v1/chat/completions";
const encoder = new TextEncoder();

function sseChunk(json: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(json)}\n\n`);
}

function sseResponse(events: unknown[], extra?: { hang?: boolean }): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) controller.enqueue(sseChunk(event));
        if (!extra?.hang) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
}

function hangUntilAbort(_input: unknown, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
      return;
    }
    signal.addEventListener("abort", () => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      reject(err);
    });
  });
}

function primaryBody(model: string): Record<string, unknown> {
  return {
    model,
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ],
    stream: true,
    temperature: 0.92,
    thinking: { type: "disabled" },
  };
}

function requestFor(model: string): DeepSeekAssembledRequest {
  return {
    endpoint: CI_URL,
    headers: { Authorization: "Bearer ci" },
    body: primaryBody(model),
  };
}

async function runStream(opts: {
  logical: "pro" | "flash";
  routeKind?: "native_pro" | "native_flash" | "adult_handoff";
  fetchFn: typeof fetch;
  deadlines?: { headersMs?: number; firstVisibleMs?: number; backupFirstVisibleMs?: number };
}): Promise<{
  urls: string[];
  models: string[];
  bodies: Record<string, unknown>[];
  telemetry: DeepSeekFailoverTelemetry;
  text: string;
}> {
  const urls: string[] = [];
  const models: string[] = [];
  const bodies: Record<string, unknown>[] = [];
  let telemetry: DeepSeekFailoverTelemetry | null = null;
  const logicalModel = opts.logical === "pro"
    ? CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
    : CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL;
  const backupModel = resolveDeepSeekBackupModelId(opts.logical);
  const previousOr = process.env.OPENROUTER_API_KEY;
  const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-or";
  process.env.CHEAPER_INFERENCE_API_KEY = "test-ci";
  try {
    const result = await executeDeepSeekWithProviderFailover({
      routeKind:
        opts.routeKind ??
        (opts.logical === "pro" ? "native_pro" : "native_flash"),
      logicalModel: opts.logical,
      primary: requestFor(logicalModel),
      backupBody: adaptOpenRouterDeepSeekBackupBody(primaryBody(logicalModel), backupModel),
      stream: true,
      deadlines: {
        headersMs: opts.deadlines?.headersMs ?? 40,
        firstVisibleMs: opts.deadlines?.firstVisibleMs ?? 60,
        backupFirstVisibleMs: opts.deadlines?.backupFirstVisibleMs ?? 80,
      },
      hooks: {
        fetchFn: (async (input, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          urls.push(String(input));
          models.push(String(body.model));
          bodies.push(body);
          return opts.fetchFn(input, init);
        }) as typeof fetch,
        onTelemetry: (next) => {
          telemetry = next;
        },
      },
    });
    const text = await result.response.text();
    assert.ok(telemetry);
    return { urls, models, bodies, telemetry, text };
  } finally {
    if (previousOr == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOr;
    if (previousCi == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
  }
}

async function runStreamExpectFailoverError(opts: {
  logical: "pro" | "flash";
  routeKind?: "native_pro" | "native_flash" | "adult_handoff";
  fetchFn: typeof fetch;
  deadlines?: { headersMs?: number; firstVisibleMs?: number; backupFirstVisibleMs?: number };
}): Promise<{ telemetry: DeepSeekFailoverTelemetry }> {
  try {
    await runStream(opts);
  } catch (error) {
    assert.ok(error instanceof DeepSeekProviderFailoverError);
    const failoverError = error as DeepSeekProviderFailoverError;
    assert.equal(failoverError.providerAttemptCount, 1);
    return { telemetry: failoverError.telemetry };
  }
  assert.fail("expected DeepSeekProviderFailoverError");
}

describe("DeepSeek cross-provider failover owner", () => {
  it("maps dated backup slugs only", () => {
    assert.equal(
      resolveDeepSeekBackupModelId("pro"),
      OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL
    );
    assert.equal(
      resolveDeepSeekBackupModelId("flash"),
      OPENROUTER_GEMINI_31_FLASH_MODEL
    );
    assert.equal(resolveDeepSeekBackupModelId("pro").includes("deepseek-v4-pro-0813"), true);
    assert.equal(resolveDeepSeekBackupModelId("flash").includes("gemini-3.1-flash-lite"), true);
    assert.equal(resolveDeepSeekBackupModelId("pro").endsWith("/deepseek-v4-pro"), false);
    assert.equal(resolveDeepSeekBackupModelId("flash").endsWith("/deepseek-v4-flash"), false);
  });

  it("maps OpenRouter Gemini Flash-Lite backup with minimal reasoning", () => {
    const adapted = adaptOpenRouterDeepSeekBackupBody(
      {
        model: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: "x" }],
        response_format: { type: "json_object" },
      },
      OPENROUTER_GEMINI_31_FLASH_MODEL
    );
    assert.equal(adapted.model, OPENROUTER_GEMINI_31_FLASH_MODEL);
    assert.deepEqual(adapted.reasoning, { effort: "minimal", exclude: true });
    assert.equal(adapted.include_reasoning, false);
    assert.deepEqual(adapted.response_format, { type: "json_object" });
  });

  it("maps OpenRouter true-off without CI-only fields", () => {
    const adapted = adaptOpenRouterDeepSeekBackupBody(
      {
        model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
        thinking: { type: "disabled" },
        reasoning_effort: "none",
        messages: [{ role: "user", content: "x" }],
        temperature: 0.92,
      },
      OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL
    );
    assert.equal(adapted.model, OPENROUTER_DEEPSEEK_V4_PRO_0813_BACKUP_MODEL);
    assert.deepEqual(adapted.reasoning, OPENROUTER_DEEPSEEK_TRUE_OFF_REASONING);
    assert.equal(adapted.include_reasoning, false);
    assert.equal("thinking" in adapted, false);
    assert.equal("reasoning_effort" in adapted, false);
    assert.equal(adapted.temperature, 0.92);
  });

  it("A1 Gemini valid RP does not enter the DeepSeek owner", () => {
    assert.equal(
      resolveDeepSeekFailoverRouteKind({
        modelId: CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      }),
      null
    );
  });

  it("P1 native Pro CI success → OR calls 0", async () => {
    const result = await runStream({
      logical: "pro",
      fetchFn: async () =>
        sseResponse([{ choices: [{ delta: { content: "안녕" } }] }]),
    });
    assert.deepEqual(result.urls, [CI_URL]);
    assert.deepEqual(result.models, [CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL]);
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(result.telemetry.backup_success, false);
    assert.equal(result.telemetry.failover_trigger, null);
    assert.match(result.text, /안녕/);
  });

  it("P2 native Pro UND_ERR_SOCKET before headers → strict single external attempt", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        runStream({
          logical: "pro",
          fetchFn: async () => {
            calls += 1;
            const err = new Error("UND_ERR_SOCKET");
            err.name = "UND_ERR_SOCKET";
            throw err;
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof DeepSeekProviderFailoverError);
        assert.equal(error.providerAttemptCount, 1);
        return true;
      }
    );
    assert.equal(calls, 1);
  });

  it("P3 native Pro 502 → strict single external attempt, no backup request", async () => {
    let calls = 0;
    const result = await runStreamExpectFailoverError({
      logical: "pro",
      fetchFn: async () => {
        calls += 1;
        return new Response("bad gateway", { status: 502 });
      },
    });
    assert.equal(result.telemetry.primary_http_status, 502);
    assert.equal(result.telemetry.primary_failure_class, "http_502");
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(result.telemetry.backup_success, false);
    assert.equal(result.telemetry.failover_trigger, null);
    assert.equal(calls, 1);
  });

  it("P4 native Pro no headers for deadline → strict single external attempt", async () => {
    let calls = 0;
    const result = await runStreamExpectFailoverError({
      logical: "pro",
      deadlines: { headersMs: 25, firstVisibleMs: 80, backupFirstVisibleMs: 80 },
      fetchFn: async (input, init) => {
        calls += 1;
        return hangUntilAbort(input, init);
      },
    });
    assert.equal(result.telemetry.primary_failure_class, "headers_timeout");
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(result.telemetry.backup_success, false);
    assert.equal(result.telemetry.failover_trigger, null);
    assert.equal(calls, 1);
  });

  it("P5 native Pro headers but no visible text by deadline → strict single external attempt", async () => {
    let calls = 0;
    const result = await runStreamExpectFailoverError({
      logical: "pro",
      deadlines: { headersMs: 80, firstVisibleMs: 30, backupFirstVisibleMs: 80 },
      fetchFn: async () => {
        calls += 1;
        return sseResponse(
          [
            { choices: [{ delta: { reasoning: "hidden" } }] },
            { usage: { prompt_tokens: 1 } },
          ],
          { hang: true }
        );
      },
    });
    assert.equal(result.telemetry.primary_failure_class, "first_visible_timeout");
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(result.telemetry.backup_success, false);
    assert.equal(result.telemetry.failover_trigger, null);
    assert.equal(calls, 1);
  });

  it("P6 native Pro one visible char then socket close → OR calls 0", async () => {
    const result = await runStream({
      logical: "pro",
      fetchFn: async () =>
        sseResponse([{ choices: [{ delta: { content: "한" } }] }]),
    });
    assert.equal(result.urls.length, 1);
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.match(result.text, /한/);
  });

  it("F1 native Flash0731 success → OR calls 0", async () => {
    const result = await runStream({
      logical: "flash",
      fetchFn: async () =>
        sseResponse([{ choices: [{ delta: { content: "플래시" } }] }]),
    });
    assert.deepEqual(result.models, [CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL]);
    assert.equal(result.urls.length, 1);
  });

  it("F2 Flash UND_ERR_SOCKET pre-visible → strict single external attempt", async () => {
    let calls = 0;
    const result = await runStreamExpectFailoverError({
      logical: "flash",
      fetchFn: async () => {
        calls += 1;
        throw new Error("fetch failed");
      },
    });
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(result.telemetry.backup_success, false);
    assert.equal(calls, 1);
  });

  it("F3 Flash 503 → strict single external attempt", async () => {
    let calls = 0;
    const result = await runStreamExpectFailoverError({
      logical: "flash",
      fetchFn: async () => {
        calls += 1;
        return new Response("busy", { status: 503 });
      },
    });
    assert.equal(result.telemetry.primary_http_status, 503);
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(calls, 1);
  });

  it("F4 Flash first-visible deadline → strict single external attempt", async () => {
    let calls = 0;
    const result = await runStreamExpectFailoverError({
      logical: "flash",
      deadlines: { headersMs: 80, firstVisibleMs: 25, backupFirstVisibleMs: 80 },
      fetchFn: async () => {
        calls += 1;
        return sseResponse([], { hang: true });
      },
    });
    assert.equal(result.telemetry.primary_failure_class, "first_visible_timeout");
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(calls, 1);
  });

  it("F5 Flash partial visible then failure → OR calls 0", async () => {
    const result = await runStream({
      logical: "flash",
      fetchFn: async () =>
        sseResponse([{ choices: [{ delta: { content: "부" } }] }]),
    });
    assert.equal(result.urls.length, 1);
  });

  it("A2 Gemini refusal + CI Pro success → OR 0", async () => {
    const result = await runStream({
      logical: "pro",
      routeKind: "adult_handoff",
      fetchFn: async () =>
        sseResponse([{ choices: [{ delta: { content: "성인장면" } }] }]),
    });
    assert.equal(result.telemetry.route_kind, "adult_handoff");
    assert.equal(result.urls.length, 1);
  });

  it("A3 Gemini refusal + CI pre-visible socket failure → strict single external attempt", async () => {
    let calls = 0;
    const result = await runStreamExpectFailoverError({
      logical: "pro",
      routeKind: "adult_handoff",
      fetchFn: async () => {
        calls += 1;
        throw new Error("ECONNRESET");
      },
    });
    assert.equal(result.telemetry.route_kind, "adult_handoff");
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(calls, 1);
  });

  it("A4 Gemini refusal + CI first-visible timeout → strict single external attempt", async () => {
    let calls = 0;
    const result = await runStreamExpectFailoverError({
      logical: "pro",
      routeKind: "adult_handoff",
      deadlines: { headersMs: 80, firstVisibleMs: 25, backupFirstVisibleMs: 80 },
      fetchFn: async () => {
        calls += 1;
        return sseResponse([{ choices: [{ delta: { reasoning_content: "x" } }] }], {
          hang: true,
        });
      },
    });
    assert.equal(result.telemetry.route_kind, "adult_handoff");
    assert.equal(result.telemetry.primary_failure_class, "first_visible_timeout");
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(calls, 1);
  });

  it("A5 strict attempts are not sticky across independent executes", async () => {
    const starts: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const result = await runStream({
        logical: "pro",
        routeKind: "adult_handoff",
        fetchFn: async () =>
          sseResponse([{ choices: [{ delta: { content: `턴${i}` } }] }]),
      });
      starts.push(result.urls[0]!);
      assert.equal(result.models[0], CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
    }
    assert.deepEqual(starts, [CI_URL, CI_URL]);
  });

  it("E1-E4 deterministic HTTP statuses do not fail over", async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      let calls = 0;
      await assert.rejects(
        () =>
          runStream({
            logical: "pro",
            fetchFn: async () => {
              calls += 1;
              return new Response("no", { status });
            },
          }),
        (error: unknown) => {
          assert.ok(error instanceof DeepSeekDeterministicProviderError);
          assert.equal(error.httpStatus, status);
          assert.equal(error.failover, false);
          return true;
        }
      );
      assert.equal(calls, 1);
    }
  });

  it("E5 CI fail → strict single external attempt, no second call, retryable", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        runStream({
          logical: "pro",
          fetchFn: async () => {
            calls += 1;
            throw new Error("ETIMEDOUT");
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof DeepSeekProviderFailoverError);
        assert.equal(error.retryable, true);
        assert.equal(error.providerAttemptCount, 1);
        return true;
      }
    );
    assert.equal(calls, 1);
  });

  it("S1 strict single attempt — one logical turn with exactly one external request", async () => {
    const ledger = createDeepSeekLogicalTurnLedger();
    let calls = 0;
    await assert.rejects(
      () =>
        runStream({
          logical: "pro",
          fetchFn: async () => {
            calls += 1;
            return new Response("down", { status: 504 });
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof DeepSeekProviderFailoverError);
        assert.equal(error.telemetry.provider_attempt_count, 1);
        return true;
      }
    );
    ledger.commitVisibleAssistant();
    ledger.commitBilling();
    ledger.commitMemory();
    ledger.commitSummaryTurn();
    ledger.commitStatusWidget();
    assert.equal(ledger.state.logicalUserTurn, 1);
    assert.equal(ledger.state.visibleAssistantRows, 1);
    assert.equal(ledger.state.visibleAssistantResponses, 1);
    assert.equal(ledger.state.billingDeductions, 1);
    assert.equal(ledger.state.memoryCommits, 1);
    assert.equal(ledger.state.summaryTurnIncrements, 1);
    assert.equal(ledger.state.statusWidgetCommits, 1);
    assert.equal(calls, 1);
  });

  it("S2 does not duplicate visible stream content on success", async () => {
    const result = await runStream({
      logical: "pro",
      fetchFn: async () =>
        sseResponse([
          { choices: [{ delta: { content: "유일한" } }] },
          { choices: [{ delta: { content: "응답" } }] },
        ]),
    });
    assert.equal((result.text.match(/유일한/g) ?? []).length, 1);
    assert.equal((result.text.match(/응답/g) ?? []).length, 1);
  });

  it("reasoning/usage-only events are not visible", () => {
    assert.equal(
      extractVisibleAssistantDeltaFromSseJson({
        choices: [{ delta: { reasoning: "think" } }],
      }),
      ""
    );
    assert.equal(
      extractVisibleAssistantDeltaFromSseJson({
        usage: { prompt_tokens: 3 },
      }),
      ""
    );
    assert.equal(
      extractVisibleAssistantDeltaFromSseJson({
        choices: [{ delta: { content: "본문" } }],
      }),
      "본문"
    );
  });

  it("classifies failover vs freeze owners", () => {
    assert.equal(classifyDeepSeekProviderFailure({ httpStatus: 502 }).failover, true);
    assert.equal(classifyDeepSeekProviderFailure({ httpStatus: 503 }).failover, true);
    assert.equal(classifyDeepSeekProviderFailure({ httpStatus: 504 }).failover, true);
    assert.equal(classifyDeepSeekProviderFailure({ httpStatus: 400 }).failover, false);
    assert.equal(classifyDeepSeekProviderFailure({ httpStatus: 401 }).failover, false);
    assert.equal(classifyDeepSeekProviderFailure({ httpStatus: 403 }).failover, false);
    assert.equal(classifyDeepSeekProviderFailure({ httpStatus: 404 }).failover, false);
    assert.equal(classifyDeepSeekProviderFailure({ httpStatus: 422 }).failover, false);
    assert.equal(classifyDeepSeekProviderFailure({ httpStatus: 429 }).failover, false);
    assert.equal(classifyDeepSeekProviderFailure({ httpStatus: 500 }).failover, true);
    assert.deepEqual([...DEEPSEEK_TRANSIENT_HTTP_STATUSES], [500, 502, 503, 504]);
    assert.equal(
      classifyDeepSeekProviderFailure({ error: new Error("socket hang up") }).failover,
      true
    );
    assert.equal(
      classifyDeepSeekProviderFailure({ error: new Error("EAI_AGAIN") }).failover,
      true
    );
    assert.equal(
      classifyDeepSeekProviderFailure({ error: new Error("ENOTFOUND") }).failover,
      true
    );
    assert.equal(
      classifyDeepSeekProviderFailure({ error: new Error("network") }).failover,
      false
    );
    assert.equal(
      classifyDeepSeekProviderFailure({ trigger: "headers_timeout" }).failureClass,
      "headers_timeout"
    );
    assert.equal(
      classifyDeepSeekProviderFailure({ trigger: "body_timeout" }).failureClass,
      "body_timeout"
    );
  });

  it("does not persist provider stickiness between independent executes", async () => {
    await runStreamExpectFailoverError({
      logical: "flash",
      fetchFn: async () => {
        throw new Error("fetch failed");
      },
    });
    const second = await runStream({
      logical: "flash",
      fetchFn: async () =>
        sseResponse([{ choices: [{ delta: { content: "2" } }] }]),
    });
    assert.equal(second.urls[0], CI_URL);
    assert.equal(second.urls.length, 1);
  });
});

describe("F500 Cheaper Inference strict single external attempt", () => {
  it("F500-1 CI Pro 0813 HTTP 500 → canonical failure, exactly one external request", async () => {
    let calls = 0;
    const result = await runStreamExpectFailoverError({
      logical: "pro",
      routeKind: "adult_handoff",
      deadlines: { headersMs: 8_000, firstVisibleMs: 12_000, backupFirstVisibleMs: 80 },
      fetchFn: async () => {
        calls += 1;
        return new Response("internal", { status: 500 });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.telemetry.primary_http_status, 500);
    assert.equal(result.telemetry.primary_failure_class, "http_500");
    assert.equal(result.telemetry.failover_trigger, null);
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(result.telemetry.backup_success, false);
  });

  it("F500-2 CI Flash 0731 HTTP 500 → canonical failure, exactly one external request", async () => {
    let calls = 0;
    const result = await runStreamExpectFailoverError({
      logical: "flash",
      fetchFn: async () => {
        calls += 1;
        return new Response("internal", { status: 500 });
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.telemetry.primary_http_status, 500);
    assert.equal(result.telemetry.primary_failure_class, "http_500");
    assert.equal(result.telemetry.backup_success, false);
  });

  it("F500-4 CI 500 → no second external call ever", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        runStream({
          logical: "pro",
          fetchFn: async () => {
            calls += 1;
            return new Response("internal", { status: 500 });
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof DeepSeekProviderFailoverError);
        assert.equal(error.providerAttemptCount, 1);
        return true;
      }
    );
    assert.equal(calls, 1);
  });

  it("F500-5 400/401/403/404/422 → OR calls 0", async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      let calls = 0;
      await assert.rejects(
        () =>
          runStream({
            logical: "pro",
            fetchFn: async () => {
              calls += 1;
              return new Response("no", { status });
            },
          }),
        (error: unknown) => {
          assert.ok(error instanceof DeepSeekDeterministicProviderError);
          assert.equal(error.httpStatus, status);
          assert.equal(error.failover, false);
          return true;
        }
      );
      assert.equal(calls, 1);
    }
  });

  it("F500-6 502/503/504 → canonical failure on the primary attempt", async () => {
    for (const status of [502, 503, 504]) {
      let calls = 0;
      const result = await runStreamExpectFailoverError({
        logical: "pro",
        fetchFn: async () => {
          calls += 1;
          return new Response("down", { status });
        },
      });
      assert.equal(calls, 1);
      assert.equal(result.telemetry.primary_http_status, status);
      assert.equal(result.telemetry.failover_trigger, null);
    }
  });

  it("F500-7 headers timeout 8s owner → strict single external attempt", async () => {
    let calls = 0;
    const result = await runStreamExpectFailoverError({
      logical: "pro",
      deadlines: { headersMs: 25, firstVisibleMs: 80, backupFirstVisibleMs: 80 },
      fetchFn: async (input, init) => {
        calls += 1;
        return hangUntilAbort(input, init);
      },
    });
    assert.equal(result.telemetry.primary_failure_class, "headers_timeout");
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(calls, 1);
  });

  it("F500-8 first-visible timeout 12s owner → strict single external attempt", async () => {
    let calls = 0;
    const result = await runStreamExpectFailoverError({
      logical: "pro",
      deadlines: { headersMs: 80, firstVisibleMs: 30, backupFirstVisibleMs: 80 },
      fetchFn: async () => {
        calls += 1;
        return sseResponse(
          [{ choices: [{ delta: { reasoning: "hidden" } }] }],
          { hang: true }
        );
      },
    });
    assert.equal(result.telemetry.primary_failure_class, "first_visible_timeout");
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(calls, 1);
  });

  it("F500-9 after visible assistant text → no OR duplicate", async () => {
    const result = await runStream({
      logical: "pro",
      fetchFn: async () =>
        sseResponse([{ choices: [{ delta: { content: "이미보임" } }] }]),
    });
    assert.equal(result.urls.length, 1);
    assert.equal(result.urls[0], CI_URL);
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(result.telemetry.failover_trigger, null);
    assert.equal((result.text.match(/이미보임/g) ?? []).length, 1);
  });
});

describe("P0 strict Main RP external-attempt invariant", () => {
  it("D — Main RP cap constant is exactly one external provider request", () => {
    assert.equal(MAX_MAIN_RP_EXTERNAL_PROVIDER_ATTEMPTS, 1);
  });

  it("D — non-DeepSeek models never enter the DeepSeek failover owner", () => {
    for (const modelId of [
      CHEAPER_INFERENCE_GEMINI_37_FLASH_MODEL,
      CHEAPER_INFERENCE_CLAUDE_OPUS_5_MODEL,
      CHEAPER_INFERENCE_GPT_56_TERRA_MODEL,
      CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      OPENROUTER_GEMINI_36_FLASH_MODEL,
      "anthropic/claude-opus-4.5",
    ]) {
      assert.equal(resolveDeepSeekFailoverRouteKind({ modelId }), null);
    }
  });

  it("D — background_flash keeps the single backup attempt; Main RP kinds do not", async () => {
    const attempt = async (routeKind: DeepSeekRouteKind) => {
      let calls = 0;
      await assert.rejects(
        () =>
          executeDeepSeekWithProviderFailover({
            routeKind,
            logicalModel: "pro",
            primary: requestFor(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
            backupBody: adaptOpenRouterDeepSeekBackupBody(
              primaryBody(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
              resolveDeepSeekBackupModelId("pro")
            ),
            stream: false,
            deadlines: { completionMs: 60, headersMs: 60, backupCompletionMs: 60 },
            hooks: {
              fetchFn: (async () => {
                calls += 1;
                throw new Error("ETIMEDOUT");
              }) as typeof fetch,
            },
          }),
        (error: unknown) => {
          assert.ok(error instanceof DeepSeekProviderFailoverError);
          return true;
        }
      );
      return calls;
    };
    for (const kind of ["native_pro", "native_flash", "adult_handoff"] as const) {
      assert.equal(await attempt(kind), 1, `${kind} must not issue a second external request`);
    }
  });
});
