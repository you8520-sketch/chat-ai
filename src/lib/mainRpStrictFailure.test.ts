import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { streamOpenRouterAdult, OpenRouterApiError } from "./openRouterAdult";
import {
  DeepSeekProviderFailoverError,
  executeDeepSeekWithProviderFailover,
} from "./deepseekProviderFailover";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "./chatModels";

const CI_URL = "https://api.cheaperinference.com/v1/chat/completions";

const encoder = new TextEncoder();

function emptySseResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
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

async function withKeys<T>(fn: () => Promise<T>): Promise<T> {
  const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
  const previousOr = process.env.OPENROUTER_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-ci";
  process.env.OPENROUTER_API_KEY = "test-or";
  try {
    return await fn();
  } finally {
    if (previousCi == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
    if (previousOr == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOr;
  }
}

describe("P0-5 — Main RP failure terminates canonically (one external attempt, no synthetic Usage)", () => {
  it("empty SSE stream → strict single attempt, canonical error, no success Usage", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return emptySseResponse();
      }) as typeof fetch;
      try {
        await assert.rejects(
          () =>
            streamOpenRouterAdult(
              "sys",
              [{ role: "user", content: "hi" }],
              CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
              400,
              {
                transportProvider: "cheaperinference",
                allowOpenRouterUnderLengthRecovery: false,
                skipAssistantPrefill: true,
              },
              { requestKind: "cheaperinference-primary-stream" }
            ).next(),
          (error: unknown) => {
            assert.ok(error instanceof OpenRouterApiError);
            return true;
          }
        );
        assert.equal(calls, 1, "exactly one external request");
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("DeepSeek primary HTTP 502 → OpenRouterApiError 502 (not a Usage)", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return new Response("bad gateway", { status: 502 });
      }) as typeof fetch;
      try {
        await assert.rejects(
          () =>
            streamOpenRouterAdult(
              "sys",
              [{ role: "user", content: "hi" }],
              CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
              400,
              {
                transportProvider: "cheaperinference",
                allowOpenRouterUnderLengthRecovery: false,
                skipAssistantPrefill: true,
              },
              { requestKind: "cheaperinference-primary-stream" }
            ).next(),
          (error: unknown) => {
            assert.ok(error instanceof OpenRouterApiError);
            assert.equal((error as OpenRouterApiError).status, 502);
            return true;
          }
        );
        assert.equal(calls, 1);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("DeepSeek headers timeout → OpenRouterApiError 503 (no http status → 503)", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = (async (input, init) => {
        calls += 1;
        return hangUntilAbort(input, init);
      }) as typeof fetch;
      try {
        await assert.rejects(
          () =>
            streamOpenRouterAdult(
              "sys",
              [{ role: "user", content: "hi" }],
              CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
              400,
              {
                transportProvider: "cheaperinference",
                allowOpenRouterUnderLengthRecovery: false,
                skipAssistantPrefill: true,
              },
              { requestKind: "cheaperinference-primary-stream" }
            ).next(),
          (error: unknown) => {
            assert.ok(error instanceof OpenRouterApiError);
            assert.equal((error as OpenRouterApiError).status, 503);
            return true;
          }
        );
        assert.equal(calls, 1);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("DeepSeek socket failure → strict single attempt, canonical failure", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        throw new Error("ECONNRESET");
      }) as typeof fetch;
      try {
        await assert.rejects(
          () =>
            streamOpenRouterAdult(
              "sys",
              [{ role: "user", content: "hi" }],
              CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
              400,
              {
                transportProvider: "cheaperinference",
                allowOpenRouterUnderLengthRecovery: false,
                skipAssistantPrefill: true,
              },
              { requestKind: "cheaperinference-primary-stream" }
            ).next(),
          (error: unknown) => {
            assert.ok(error instanceof OpenRouterApiError);
            return true;
          }
        );
        assert.equal(calls, 1);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("OpenRouter non-DeepSeek empty stream → OpenRouterApiError, single fetch", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return emptySseResponse();
      }) as typeof fetch;
      try {
        await assert.rejects(
          () =>
            streamOpenRouterAdult(
              "sys",
              [{ role: "user", content: "hi" }],
              "gemini-3.6-flash",
              400,
              {
                allowOpenRouterUnderLengthRecovery: false,
                skipAssistantPrefill: true,
              },
              { requestKind: "openrouter-primary-stream" }
            ).next(),
          (error: unknown) => {
            assert.ok(error instanceof OpenRouterApiError);
            assert.match((error as OpenRouterApiError).message, /502|empty response/);
            return true;
          }
        );
        assert.equal(calls, 1);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("failover wrapper — every terminal failure class is exactly one external request", async () => {
    await withKeys(async () => {
      const cases: Array<{
        name: string;
        fetchFn: typeof fetch;
        expectedClass: string;
      }> = [
        { name: "http_500", fetchFn: async () => new Response("x", { status: 500 }), expectedClass: "http_500" },
        { name: "http_502", fetchFn: async () => new Response("x", { status: 502 }), expectedClass: "http_502" },
        { name: "http_503", fetchFn: async () => new Response("x", { status: 503 }), expectedClass: "http_503" },
        { name: "http_504", fetchFn: async () => new Response("x", { status: 504 }), expectedClass: "http_504" },
        {
          name: "headers_timeout",
          fetchFn: (async (_i, init) => hangUntilAbort(_i, init)) as typeof fetch,
          expectedClass: "headers_timeout",
        },
        {
          name: "first_visible_timeout",
          fetchFn: (async () => emptySseResponse()) as typeof fetch,
          expectedClass: "first_visible_timeout",
        },
        {
          name: "socket_failure",
          fetchFn: (async () => {
            throw new Error("ECONNRESET");
          }) as typeof fetch,
          expectedClass: "ECONNRESET",
        },
      ];
      for (const c of cases) {
        let calls = 0;
        await assert.rejects(
          () =>
            executeDeepSeekWithProviderFailover({
              routeKind: "native_pro",
              logicalModel: "pro",
              primary: {
                endpoint: CI_URL,
                headers: { Authorization: "Bearer ci" },
                body: {
                  model: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
                  messages: [{ role: "user", content: "x" }],
                  stream: true,
                },
              },
              backupBody: { model: "openrouter/deepseek-v4-pro-0813", messages: [] },
              stream: true,
              deadlines: {
                headersMs: 80,
                firstVisibleMs: 25,
                backupFirstVisibleMs: 80,
              },
              hooks: {
                fetchFn: (async (input, init) => {
                  calls += 1;
                  return c.fetchFn(input, init);
                }) as typeof fetch,
              },
            }),
          (error: unknown) => {
            assert.ok(error instanceof DeepSeekProviderFailoverError, c.name);
            assert.equal(
              (error as DeepSeekProviderFailoverError).providerAttemptCount,
              1,
              `${c.name} — one external attempt`
            );
            assert.equal(
              (error as DeepSeekProviderFailoverError).telemetry.primary_failure_class,
              c.expectedClass,
              c.name
            );
            assert.equal(
              (error as DeepSeekProviderFailoverError).telemetry.backup_success,
              false
            );
            return true;
          }
        );
        assert.equal(calls, 1, `${c.name} — no second external request`);
      }
    });
  });

  it("failure path in route.ts performs no settlement (no synthetic Usage / no synthetic 0P)", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/api/chat/route.ts"),
      "utf8"
    );
    // Exactly one settlement call exists and it lives on the success path.
    assert.equal((source.match(/settleChatTurnBillingExactlyOnce\(/g) ?? []).length, 1);
    // Failure paths explicitly skip billing and mark the assistant failed.
    assert.match(source, /generation failure — billing skipped/);
    assert.ok((source.match(/billing skipped/g) ?? []).length >= 4);
    assert.ok((source.match(/markAssistantFailed\(/g) ?? []).length >= 3);
  });
});