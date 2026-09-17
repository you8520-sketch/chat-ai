import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "./chatModels";
import {
  CHEAPER_INFERENCE_HEADERS_DEADLINE_MS,
  DeepSeekProviderFailoverError,
  MAIN_RP_STARTUP_DEADLINE_MS,
  MAX_MAIN_RP_EXTERNAL_PROVIDER_ATTEMPTS,
  adaptOpenRouterDeepSeekBackupBody,
  computeRemainingStartupBudgetMs,
  executeDeepSeekBackgroundWithProviderFailover,
  executeDeepSeekWithProviderFailover,
  resolveMainRpStreamingStartupDeadlines,
  type DeepSeekAssembledRequest,
} from "./deepseekProviderFailover";

const CI_URL = "https://api.cheaperinference.com/v1/chat/completions";
const encoder = new TextEncoder();

/** Scale production incident timings down for fast deterministic CI. */
const TIMING_SCALE = 0.01;
const scaled = (ms: number) => Math.max(1, Math.round(ms * TIMING_SCALE));

/** Production incident (2026-09-17) — CheaperInference DeepSeek V4 Pro Main RP. */
export const PRODUCTION_INCIDENT_HEADERS_MS = 14_969;
export const PRODUCTION_INCIDENT_FIRST_VISIBLE_MS = 14_972;

function sseChunk(json: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(json)}\n\n`);
}

function primaryRequest(): DeepSeekAssembledRequest {
  return {
    endpoint: CI_URL,
    headers: { Authorization: "Bearer ci" },
    body: {
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      stream: true,
      thinking: { type: "disabled" },
    },
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("The operation was aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

function createDelayedStreamFetch(opts: {
  headersDelayMs: number;
  firstVisibleDelayMs: number;
  content?: string;
}): typeof fetch {
  return (async (_input, init) => {
    await delay(opts.headersDelayMs, init?.signal);
    const afterHeadersMs = Math.max(0, opts.firstVisibleDelayMs - opts.headersDelayMs);
    const content = opts.content ?? "장면에맞는본문출력값입니다";
    return new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          await delay(afterHeadersMs, init?.signal);
          controller.enqueue(sseChunk({ choices: [{ delta: { content } }] }));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
  }) as typeof fetch;
}

function hangUntilAbort(_input: unknown, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(new DOMException("The operation was aborted", "AbortError"));
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        reject(new DOMException("The operation was aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

function emptyReasoningSse(hang = true): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(sseChunk({ choices: [{ delta: { reasoning: "hidden" } }] }));
        if (!hang) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } }
  );
}

async function runMainRpStream(opts: {
  fetchFn: typeof fetch;
  deadlines?: { headersMs?: number; firstVisibleMs?: number };
  routeKind?: "native_pro" | "native_flash" | "adult_handoff";
}): Promise<{
  telemetry: import("./deepseekProviderFailover").DeepSeekFailoverTelemetry;
  text: string;
  calls: number;
}> {
  let calls = 0;
  let telemetry: import("./deepseekProviderFailover").DeepSeekFailoverTelemetry | null = null;
  const primary = primaryRequest();
  const result = await executeDeepSeekWithProviderFailover({
    routeKind: opts.routeKind ?? "native_pro",
    logicalModel: "pro",
    primary,
    backupBody: adaptOpenRouterDeepSeekBackupBody(primary.body, "openrouter/deepseek-v4-pro-0813"),
    stream: true,
    deadlines: opts.deadlines,
    hooks: {
      fetchFn: (async (input, init) => {
        calls += 1;
        return opts.fetchFn(input, init);
      }) as typeof fetch,
      onTelemetry: (next) => {
        telemetry = next;
      },
    },
  });
  const text = await result.response.text();
  assert.ok(telemetry);
  return { telemetry, text, calls };
}

async function expectMainRpFail(opts: Parameters<typeof runMainRpStream>[0]): Promise<{
  telemetry: import("./deepseekProviderFailover").DeepSeekFailoverTelemetry;
  calls: number;
}> {
  let calls = 0;
  try {
    await runMainRpStream({
      ...opts,
      fetchFn: (async (input, init) => {
        calls += 1;
        return opts.fetchFn(input, init);
      }) as typeof fetch,
    });
  } catch (error) {
    assert.ok(error instanceof DeepSeekProviderFailoverError);
    return { telemetry: error.telemetry, calls };
  }
  assert.fail("expected DeepSeekProviderFailoverError");
}

describe("Main RP startup deadline owner", () => {
  it("canonical startup budget is 20s with unified header/first-visible owners", () => {
    assert.equal(MAIN_RP_STARTUP_DEADLINE_MS, 20_000);
    const resolved = resolveMainRpStreamingStartupDeadlines();
    assert.equal(resolved.headersMs, MAIN_RP_STARTUP_DEADLINE_MS);
    assert.equal(resolved.firstVisibleMs, MAIN_RP_STARTUP_DEADLINE_MS);
  });

  it("remaining startup budget is measured from request start", () => {
    const startedAt = 1_000;
    assert.equal(
      computeRemainingStartupBudgetMs({
        startupDeadlineMs: MAIN_RP_STARTUP_DEADLINE_MS,
        startedAt,
        now: () => 1_000 + PRODUCTION_INCIDENT_HEADERS_MS,
      }),
      MAIN_RP_STARTUP_DEADLINE_MS - PRODUCTION_INCIDENT_HEADERS_MS
    );
  });

  it("T3 BEFORE: production timing fails legacy 8s headers owner", async () => {
    const headersDelay = scaled(PRODUCTION_INCIDENT_HEADERS_MS);
    const visibleDelay = scaled(PRODUCTION_INCIDENT_FIRST_VISIBLE_MS);
    const legacyHeaders = scaled(CHEAPER_INFERENCE_HEADERS_DEADLINE_MS);
    const result = await expectMainRpFail({
      deadlines: {
        headersMs: legacyHeaders,
        firstVisibleMs: scaled(12_000),
      },
      fetchFn: createDelayedStreamFetch({
        headersDelayMs: headersDelay,
        firstVisibleDelayMs: visibleDelay,
      }),
    });
    assert.equal(result.telemetry.primary_failure_class, "headers_timeout");
    assert.equal(result.telemetry.primary_http_status, null);
    assert.equal(result.telemetry.primary_first_visible_ms, null);
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(result.calls, 1);
    assert.ok(
      (result.telemetry.primary_headers_ms ?? 0) >= legacyHeaders - 5,
      "aborts near legacy headers deadline, before provider headers would arrive"
    );
  });

  it("T3 AFTER: production timing passes unified 20s startup budget", async () => {
    const headersDelay = scaled(PRODUCTION_INCIDENT_HEADERS_MS);
    const visibleDelay = scaled(PRODUCTION_INCIDENT_FIRST_VISIBLE_MS);
    const result = await runMainRpStream({
      fetchFn: createDelayedStreamFetch({
        headersDelayMs: headersDelay,
        firstVisibleDelayMs: visibleDelay,
      }),
    });
    assert.equal(result.telemetry.primary_failure_class, null);
    assert.equal(result.telemetry.primary_http_status, 200);
    assert.ok((result.telemetry.primary_headers_ms ?? 0) >= headersDelay - 5);
    assert.ok((result.telemetry.primary_first_visible_ms ?? 0) >= visibleDelay - 5);
    assert.match(result.text, /장면에맞는본문출력값입니다/);
    assert.equal(result.calls, 1);
  });

  it("T1: fast headers + visible within startup budget → PASS", async () => {
    const startup = scaled(MAIN_RP_STARTUP_DEADLINE_MS);
    const result = await runMainRpStream({
      fetchFn: createDelayedStreamFetch({
        headersDelayMs: scaled(4_000),
        firstVisibleDelayMs: scaled(4_100),
      }),
    });
    assert.equal(result.telemetry.primary_failure_class, null);
    assert.ok((result.telemetry.primary_headers_ms ?? 0) < startup);
    assert.equal(result.calls, 1);
  });

  it("T2: headers 7.9s / visible 8.0s scaled → PASS under 20s budget", async () => {
    const result = await runMainRpStream({
      fetchFn: createDelayedStreamFetch({
        headersDelayMs: scaled(7_900),
        firstVisibleDelayMs: scaled(8_000),
      }),
    });
    assert.equal(result.telemetry.primary_failure_class, null);
    assert.equal(result.calls, 1);
  });

  it("T5: headers within budget but first visible after startup → first_visible_timeout", async () => {
    const startup = scaled(MAIN_RP_STARTUP_DEADLINE_MS);
    const result = await expectMainRpFail({
      deadlines: { headersMs: startup, firstVisibleMs: startup },
      fetchFn: async () => {
        return emptyReasoningSse(true);
      },
    });
    assert.match(
      result.telemetry.primary_failure_class ?? "",
      /first_visible_timeout|reasoning_only_until_visible_deadline/
    );
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(result.calls, 1);
  });

  it("T6: no headers before startup budget → headers_timeout", async () => {
    const startup = scaled(MAIN_RP_STARTUP_DEADLINE_MS);
    const result = await expectMainRpFail({
      deadlines: { headersMs: startup, firstVisibleMs: startup },
      fetchFn: hangUntilAbort,
    });
    assert.equal(result.telemetry.primary_failure_class, "headers_timeout");
    assert.equal(result.telemetry.primary_http_status, null);
    assert.equal(result.calls, 1);
  });

  it("T7: HTTP 400 before deadline → immediate deterministic failure", async () => {
    await assert.rejects(
      () =>
        executeDeepSeekWithProviderFailover({
          routeKind: "native_pro",
          logicalModel: "pro",
          primary: primaryRequest(),
          backupBody: { model: "x", messages: [] },
          stream: true,
          hooks: {
            fetchFn: (async () => new Response("bad", { status: 400 })) as typeof fetch,
          },
        }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.notEqual(error.constructor.name, "DeepSeekProviderFailoverError");
        return true;
      }
    );
  });

  it("T8: startup timeout abort ends in-flight fetch before unbounded wait", async () => {
    const startup = scaled(MAIN_RP_STARTUP_DEADLINE_MS);
    const startedAt = Date.now();
    await expectMainRpFail({
      deadlines: { headersMs: startup, firstVisibleMs: startup },
      fetchFn: (async (_input, init) => {
        await delay(startup * 4, init?.signal);
        return emptyReasoningSse(false);
      }) as typeof fetch,
    });
    const elapsed = Date.now() - startedAt;
    assert.ok(
      elapsed < startup * 2,
      "timeout abort must stop the fetch before the unbounded provider wait completes"
    );
  });

  it("T9/T10: exactly one external provider attempt on success and failure", async () => {
    assert.equal(MAX_MAIN_RP_EXTERNAL_PROVIDER_ATTEMPTS, 1);
    const pass = await runMainRpStream({
      fetchFn: createDelayedStreamFetch({
        headersDelayMs: scaled(1_000),
        firstVisibleDelayMs: scaled(1_050),
      }),
    });
    assert.equal(pass.telemetry.provider_attempt_count, 1);
    assert.equal(pass.telemetry.backup_provider, null);
    const fail = await expectMainRpFail({
      deadlines: { headersMs: scaled(50), firstVisibleMs: scaled(50) },
      fetchFn: hangUntilAbort,
    });
    assert.equal(fail.telemetry.provider_attempt_count, 1);
    assert.equal(fail.telemetry.backup_provider, null);
  });

  it("T12: regen-equivalent native_pro path uses same startup owner defaults", async () => {
    const resolved = resolveMainRpStreamingStartupDeadlines();
    assert.equal(resolved.headersMs, MAIN_RP_STARTUP_DEADLINE_MS);
    const result = await runMainRpStream({
      routeKind: "native_pro",
      fetchFn: createDelayedStreamFetch({
        headersDelayMs: scaled(PRODUCTION_INCIDENT_HEADERS_MS),
        firstVisibleDelayMs: scaled(PRODUCTION_INCIDENT_FIRST_VISIBLE_MS),
      }),
    });
    assert.equal(result.telemetry.route_kind, "native_pro");
    assert.equal(result.telemetry.primary_failure_class, null);
  });

  it("T13: background_flash keeps independent completion deadline policy", async () => {
    let calls = 0;
    const result = await executeDeepSeekBackgroundWithProviderFailover({
      primary: {
        endpoint: CI_URL,
        headers: { Authorization: "Bearer ci" },
        body: {
          model: "deepseek-v4-flash-0731",
          messages: [{ role: "user", content: "x" }],
          stream: false,
        },
      },
      timeoutMs: 5_000,
      hooks: {
        fetchFn: (async () => {
          calls += 1;
          return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }) as typeof fetch,
      },
    });
    assert.equal(result.telemetry.route_kind, "background_flash");
    assert.equal(result.telemetry.provider_attempt_count, 1);
    assert.equal(calls, 1);
  });
});
