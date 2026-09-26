import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import Database from "better-sqlite3";
import {
  callOpenRouterEmbeddings,
  OPENROUTER_EMBEDDINGS_MAX_INPUTS,
  OPENROUTER_EMBEDDINGS_URL,
  OpenRouterEmbeddingsError,
} from "./openRouterEmbeddings";
import { resolveLedgerCostCenter } from "./providerCostLedger";
import { EPISODIC_SEMANTIC_EMBEDDING_REQUEST_KIND } from "./memory/memory-episodic-semantic-config";

type FetchCall = { url: string; init: RequestInit };

const MODEL = "baai/bge-m3";
const DIMS = 3;

function okBody(overrides: Record<string, unknown> = {}) {
  return {
    object: "list",
    model: MODEL,
    data: [
      { object: "embedding", index: 1, embedding: [0, 1, 0] },
      { object: "embedding", index: 0, embedding: [1, 0, 0] },
    ],
    usage: { prompt_tokens: 12, total_tokens: 12, cost: 0.00000012 },
    ...overrides,
  };
}

let calls: FetchCall[] = [];
let savedFetch: typeof fetch;
let savedKey: string | undefined;

function stub(handler: () => Response | Promise<Response>) {
  globalThis.fetch = (async (url: unknown, init?: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return handler();
  }) as typeof fetch;
}

function request(overrides: Partial<Parameters<typeof callOpenRouterEmbeddings>[0]> = {}) {
  return callOpenRouterEmbeddings({
    model: MODEL,
    inputs: ["a", "b"],
    dimensions: DIMS,
    requestKind: EPISODIC_SEMANTIC_EMBEDDING_REQUEST_KIND,
    timeoutMs: 1_000,
    ledger: null,
    ...overrides,
  });
}

beforeEach(() => {
  calls = [];
  savedFetch = globalThis.fetch;
  savedKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-dummy-key-not-real";
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
  else delete process.env.OPENROUTER_API_KEY;
});

describe("OpenRouter embeddings transport — official wire contract", () => {
  it("posts the official body with enforced ZDR + data_collection deny", async () => {
    stub(() => Response.json(okBody()));
    await request();
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, OPENROUTER_EMBEDDINGS_URL);
    assert.equal(OPENROUTER_EMBEDDINGS_URL, "https://openrouter.ai/api/v1/embeddings");
    const body = JSON.parse(String(calls[0]!.init.body));
    assert.deepEqual(body, {
      model: MODEL,
      input: ["a", "b"],
      encoding_format: "float",
      provider: { zdr: true, data_collection: "deny" },
    });
    const headers = calls[0]!.init.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer test-dummy-key-not-real");
  });

  it("sends `dimensions` only when the config requests it", async () => {
    stub(() => Response.json(okBody()));
    await request({ requestDimensions: DIMS });
    assert.equal(JSON.parse(String(calls[0]!.init.body)).dimensions, DIMS);
  });

  it("reorders vectors by index and parses usage", async () => {
    stub(() => Response.json(okBody()));
    const out = await request();
    assert.deepEqual(out.vectors, [[1, 0, 0], [0, 1, 0]]);
    assert.equal(out.usage.inputTokens, 12);
    assert.equal(out.responseModel, MODEL);
  });

  it("accepts a dated served-model pin of the requested model", async () => {
    stub(() => Response.json(okBody({ model: `${MODEL}-20251117` })));
    assert.equal((await request()).responseModel, `${MODEL}-20251117`);
  });
});

describe("fail-closed validation", () => {
  const cases: Array<[string, () => Response, OpenRouterEmbeddingsError["code"]]> = [
    ["429", () => new Response("slow down", { status: 429 }), "http_error"],
    ["4xx", () => new Response("bad", { status: 400 }), "http_error"],
    ["5xx", () => new Response("down", { status: 502 }), "http_error"],
    ["malformed JSON", () => new Response("{nope", { status: 200 }), "invalid_response"],
    ["missing data", () => Response.json({ object: "list", model: MODEL }), "invalid_response"],
    ["wrong count", () => Response.json(okBody({ data: [{ object: "embedding", index: 0, embedding: [1, 0, 0] }] })), "invalid_response"],
    ["wrong dimensions", () => Response.json(okBody({ data: [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [0, 1] }] })), "invalid_response"],
    ["non-finite", () => new Response(`{"object":"list","model":"${MODEL}","data":[{"index":0,"embedding":[1e999,0,0]},{"index":1,"embedding":[0,1,0]}],"usage":{"prompt_tokens":2,"total_tokens":2}}`, { status: 200 }), "invalid_response"],
    ["string (base64) embedding", () => Response.json(okBody({ data: [{ index: 0, embedding: "AAAA" }, { index: 1, embedding: "AAAA" }] })), "invalid_response"],
    ["duplicate index", () => Response.json(okBody({ data: [{ index: 0, embedding: [1, 0, 0] }, { index: 0, embedding: [0, 1, 0] }] })), "invalid_response"],
    ["model mismatch", () => Response.json(okBody({ model: "openai/text-embedding-3-small" })), "invalid_response"],
    ["missing usage", () => Response.json(okBody({ usage: undefined })), "invalid_response"],
  ];
  for (const [label, respond, code] of cases) {
    it(`${label} → ${code}`, async () => {
      stub(respond);
      await assert.rejects(request(), (e: unknown) => e instanceof OpenRouterEmbeddingsError && e.code === code);
    });
  }

  it("network/timeout → transport_error", async () => {
    globalThis.fetch = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as typeof fetch;
    await assert.rejects(request(), (e: unknown) => e instanceof OpenRouterEmbeddingsError && e.code === "transport_error");
  });

  it("missing key → missing_key with zero HTTP", async () => {
    delete process.env.OPENROUTER_API_KEY;
    stub(() => Response.json(okBody()));
    await assert.rejects(request(), (e: unknown) => e instanceof OpenRouterEmbeddingsError && e.code === "missing_key");
    assert.equal(calls.length, 0);
  });

  it("invalid request bounds → invalid_request with zero HTTP", async () => {
    stub(() => Response.json(okBody()));
    for (const inputs of [[], [""], new Array(OPENROUTER_EMBEDDINGS_MAX_INPUTS + 1).fill("x")]) {
      await assert.rejects(request({ inputs }), (e: unknown) => e instanceof OpenRouterEmbeddingsError && e.code === "invalid_request");
    }
    assert.equal(calls.length, 0);
  });
});

describe("canonical cost ledger reuse", () => {
  it("success records one memory-center row with provider-reported cost; failure records failed_without_usage", async () => {
    const db = new Database(":memory:");
    try {
      stub(() => Response.json(okBody()));
      await request({ ledger: { db, persistInTests: true } });
      stub(() => new Response("down", { status: 503 }));
      await assert.rejects(request({ ledger: { db, persistInTests: true } }));
      const rows = db
        .prepare("SELECT provider, model, request_kind, cost_center, event_status, actual_cost_usd FROM api_cost_ledger ORDER BY rowid")
        .all() as Array<{ provider: string; model: string; request_kind: string; cost_center: string; event_status: string; actual_cost_usd: number | null }>;
      assert.equal(rows.length, 2);
      assert.equal(rows[0]!.provider, "openrouter");
      assert.equal(rows[0]!.model, MODEL);
      assert.equal(rows[0]!.request_kind, EPISODIC_SEMANTIC_EMBEDDING_REQUEST_KIND);
      assert.equal(rows[0]!.cost_center, "memory");
      assert.equal(rows[0]!.actual_cost_usd, 0.00000012);
      assert.equal(rows[1]!.event_status, "failed_without_usage");
      assert.equal(resolveLedgerCostCenter({ family: "background", request_kind: EPISODIC_SEMANTIC_EMBEDDING_REQUEST_KIND }), "memory");
    } finally {
      db.close();
    }
  });
});
