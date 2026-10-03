import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL, CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL } from "@/lib/chatModels";
import { streamOpenRouterAdult } from "@/lib/openRouterAdult";
import {
  callOpenRouterCompletion,
  CompatibleCompletionError,
  readCompatibleCompletionProviderRequestId,
} from "@/lib/openRouterCompletion";

const CDN_RAY = "8a1b2c3d4e5f6g7h-ICN";
const CI_HEADER_ID = "5dd1cc86-d8cf-4606-a6a3-61c63ac9d788";
const OR_HEADER_ID = "or-req-9f3c1a20-4b6e-4d11-9a77-0c1e8b2d4f60";

function completionResponse(opts: {
  status?: number;
  content?: string;
  headers?: Record<string, string>;
  requestId?: number | string | Record<string, unknown> | null;
  usage?: { prompt_tokens: number; completion_tokens: number } | null;
}): Response {
  const body: Record<string, unknown> = {
    choices: [
      {
        message: { content: opts.content ?? "OK" },
        finish_reason: "stop",
      },
    ],
  };
  if (opts.usage !== null) {
    body.usage = opts.usage ?? { prompt_tokens: 12, completion_tokens: 4 };
  }
  if (opts.requestId !== undefined) {
    body.cheaper_inference = { request_id: opts.requestId };
  }
  return new Response(JSON.stringify(body), {
    status: opts.status ?? 200,
    headers: { "Content-Type": "application/json", ...opts.headers },
  });
}

function sseResponse(chunks: string[], headers: Record<string, string> = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...headers },
  });
}

async function withFetch<T>(
  keys: { ci?: string; or?: string },
  fetchImpl: typeof fetch,
  fn: () => Promise<T>
): Promise<T> {
  const previousFetch = globalThis.fetch;
  const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
  const previousOr = process.env.OPENROUTER_API_KEY;
  if (keys.ci != null) process.env.CHEAPER_INFERENCE_API_KEY = keys.ci;
  if (keys.or != null) process.env.OPENROUTER_API_KEY = keys.or;
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCi == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
    if (previousOr == null) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousOr;
  }
}

async function collectStream(headers: Record<string, string>, events: unknown[]) {
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello." } }] })}\n\n`,
    ...events.map((event) => `data: ${JSON.stringify(event)}\n\n`),
    "data: [DONE]\n\n",
  ];
  return withFetch({ ci: "test-ci" }, (async () => sseResponse(chunks, headers)) as typeof fetch, async () => {
    const gen = streamOpenRouterAdult(
      "system",
      [{ role: "user", content: "hello" }],
      CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL,
      800,
      {
        allowOpenRouterUnderLengthRecovery: false,
        skipAssistantPrefill: true,
        transportProvider: "cheaperinference",
      }
    );
    let usage = { inputTokens: 0, outputTokens: 0, estimated: true as boolean, providerRequestId: undefined as string | undefined };
    while (true) {
      const step = await gen.next();
      if (step.done) {
        usage = step.value;
        break;
      }
    }
    return usage;
  });
}

describe("CheaperInference billing request id", () => {
  it("prefers the documented CI header over the alias, body, generic headers, and cf-ray", () => {
    const headers = new Headers({
      "x-ci-request-id": `  ${CI_HEADER_ID}  `,
      "x-cheaper-inference-request-id": "alias-id",
      "x-request-id": "generic-id",
      "x-openrouter-request-id": OR_HEADER_ID,
      "cf-ray": CDN_RAY,
    });
    const first = readCompatibleCompletionProviderRequestId({
      provider: "cheaperinference",
      headers,
      body: { cheaper_inference: { request_id: 4812 } },
    });
    const second = readCompatibleCompletionProviderRequestId({
      provider: "cheaperinference",
      headers,
      body: { cheaper_inference: { request_id: 4812 } },
    });
    assert.equal(first, CI_HEADER_ID);
    assert.equal(second, first);
  });

  it("uses a numeric cheaper_inference.request_id only when CI headers are absent", () => {
    const id = readCompatibleCompletionProviderRequestId({
      provider: "cheaperinference",
      headers: new Headers({ "x-request-id": "not-the-ci-ledger-id", "cf-ray": CDN_RAY }),
      body: { cheaper_inference: { request_id: 4812 } },
    });
    assert.equal(id, "4812");
    assert.equal(
      readCompatibleCompletionProviderRequestId({
        provider: "cheaperinference",
        headers: new Headers({ "x-ci-request-id": "   ", "x-cheaper-inference-request-id": "alias-id" }),
        body: { cheaper_inference: { request_id: 99 } },
      }),
      "alias-id"
    );
  });

  it("does not invent an id for malformed, empty, non-positive, or CDN-shaped values", () => {
    const cases: Array<{ headers?: Record<string, string>; body?: unknown }> = [
      { body: { cheaper_inference: { request_id: { bad: true } } } },
      { body: {} },
      { headers: { "cf-ray": CDN_RAY } },
      { headers: { "x-ci-request-id": CDN_RAY }, body: { cheaper_inference: { request_id: 4812.5 } } },
      { body: { cheaper_inference: { request_id: 0 } } },
      { body: { cheaper_inference: { request_id: -4 } } },
      { body: { cheaper_inference: { request_id: "4812.5" } } },
      { headers: { "x-ci-request-id": "   " }, body: { id: "chatcmpl-not-billing" } },
    ];
    for (const sample of cases) {
      assert.equal(
        readCompatibleCompletionProviderRequestId({
          provider: "cheaperinference",
          headers: new Headers(sample.headers),
          body: sample.body,
        }),
        null
      );
    }
  });

  it("keeps OpenRouter ids on OpenRouter headers only", () => {
    const headers = new Headers({
      "x-ci-request-id": CI_HEADER_ID,
      "x-request-id": OR_HEADER_ID,
      "cf-ray": CDN_RAY,
    });
    assert.equal(
      readCompatibleCompletionProviderRequestId({
        provider: "openrouter",
        headers,
        body: { cheaper_inference: { request_id: 4812 }, id: "chatcmpl-not-billing" },
      }),
      OR_HEADER_ID
    );
  });

  it("persists a CI-only header through non-streaming completion finalization", async () => {
    const result = await withFetch(
      { ci: "test-ci" },
      (async () =>
        completionResponse({
          headers: {
            "x-ci-request-id": CI_HEADER_ID,
            "x-request-id": "generic-not-billing",
            "cf-ray": CDN_RAY,
          },
        })) as typeof fetch,
      () =>
        callOpenRouterCompletion({
          model: CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL,
          system: "system",
          history: [{ role: "user", content: "hello" }],
          maxTokens: 32,
        })
    );
    assert.equal(result.usage.providerRequestId, CI_HEADER_ID);
  });

  it("persists a body-only numeric CI request id on a successful non-streaming call", async () => {
    const result = await withFetch(
      { ci: "test-ci" },
      (async () => completionResponse({ requestId: 4812, headers: { "cf-ray": CDN_RAY } })) as typeof fetch,
      () =>
        callOpenRouterCompletion({
          model: CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL,
          system: "system",
          history: [{ role: "user", content: "hello" }],
          maxTokens: 32,
        })
    );
    assert.equal(result.usage.providerRequestId, "4812");
  });

  it("keeps the CI request id on an empty completion that still reported usage", async () => {
    await withFetch(
      { ci: "test-ci" },
      (async () =>
        completionResponse({
          content: "   ",
          headers: { "x-ci-request-id": CI_HEADER_ID },
          usage: { prompt_tokens: 20, completion_tokens: 4 },
        })) as typeof fetch,
      async () => {
        await assert.rejects(
          () =>
            callOpenRouterCompletion({
              model: CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL,
              system: "system",
              history: [{ role: "user", content: "hello" }],
              maxTokens: 32,
            }),
          (error: unknown) => {
            assert.ok(error instanceof CompatibleCompletionError);
            assert.equal(error.usage?.providerRequestId, CI_HEADER_ID);
            assert.equal(error.usage?.estimated, false);
            return true;
          }
        );
      }
    );
  });

  it("does not store a generic or CDN id when the CI response has no billing id", async () => {
    const result = await withFetch(
      { ci: "test-ci" },
      (async () =>
        completionResponse({
          headers: { "x-request-id": "generic-not-billing", "cf-ray": CDN_RAY },
          requestId: { bad: true },
        })) as typeof fetch,
      () =>
        callOpenRouterCompletion({
          model: CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL,
          system: "system",
          history: [{ role: "user", content: "hello" }],
          maxTokens: 32,
        })
    );
    assert.equal(result.usage.providerRequestId, undefined);
  });

  it("stores the OpenRouter id for an OpenRouter completion and ignores CI headers", async () => {
    const result = await withFetch(
      { or: "test-or" },
      (async () =>
        completionResponse({
          headers: {
            "x-ci-request-id": CI_HEADER_ID,
            "x-request-id": OR_HEADER_ID,
            "cf-ray": CDN_RAY,
          },
          requestId: 4812,
        })) as typeof fetch,
      () =>
        callOpenRouterCompletion({
          model: "deepseek/deepseek-v4-flash",
          system: "system",
          history: [{ role: "user", content: "hello" }],
          maxTokens: 32,
        })
    );
    assert.equal(result.usage.providerRequestId, OR_HEADER_ID);
  });

  it("stamps the delivered OpenRouter attempt id after a CheaperInference failover", async () => {
    let calls = 0;
    const result = await withFetch(
      { ci: "test-ci", or: "test-or" },
      (async () => {
        calls += 1;
        if (calls === 1) {
          return completionResponse({
            status: 503,
            content: "",
            headers: { "x-ci-request-id": CI_HEADER_ID },
            usage: null,
          });
        }
        return completionResponse({
          headers: {
            "x-ci-request-id": "stale-primary-id",
            "x-request-id": OR_HEADER_ID,
            "cf-ray": CDN_RAY,
          },
          requestId: 4812,
        });
      }) as typeof fetch,
      () =>
        callOpenRouterCompletion({
          model: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
          system: "system",
          history: [{ role: "user", content: "hello" }],
          maxTokens: 32,
          requestKind: "background-memory-extract",
        })
    );
    assert.equal(calls, 2);
    assert.equal(result.usage.providerRequestId, OR_HEADER_ID);
  });

  it("keeps a streaming CI header ahead of cf-ray and the final body id", async () => {
    const usage = await collectStream(
      {
        "x-ci-request-id": CI_HEADER_ID,
        "x-request-id": "generic-not-billing",
        "cf-ray": CDN_RAY,
      },
      [
        {
          id: "chatcmpl-not-billing",
          choices: [],
          usage: { prompt_tokens: 8, completion_tokens: 2 },
          cheaper_inference: { request_id: 4812 },
        },
      ]
    );
    assert.equal(usage.providerRequestId, CI_HEADER_ID);
  });

  it("reads a numeric streaming body id and never stores cf-ray or json.id", async () => {
    const withBody = await collectStream({ "cf-ray": CDN_RAY }, [
      {
        id: "chatcmpl-not-billing",
        choices: [],
        usage: { prompt_tokens: 8, completion_tokens: 2 },
        cheaper_inference: { request_id: 4812 },
      },
    ]);
    assert.equal(withBody.providerRequestId, "4812");

    const rayOnly = await collectStream({ "cf-ray": CDN_RAY }, [
      {
        id: "chatcmpl-not-billing",
        choices: [],
        usage: { prompt_tokens: 8, completion_tokens: 2 },
      },
    ]);
    assert.equal(rayOnly.providerRequestId, undefined);
  });
});
