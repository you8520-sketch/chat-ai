import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { TextEncoder } from "node:util";

import { ensureProviderCostLedgerSchema, type ProviderCostLedgerRow } from "@/lib/providerCostLedger";
import { mockReadableStreamFromText } from "@/lib/mockApiMode";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";
import { callTrpgBot, callTrpgGm } from "./gmCall";

const GM_TEXT = buildTrpgGmStructuredWireText("문이 열린다.", {
  players: [],
  location: "문턱",
  next_round_context: "들어갈지",
  campaign_finished: false,
});

const previousFetch = globalThis.fetch;
const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
const previousMock = process.env.MOCK_MODE;
const previousTestContext = process.env.NODE_TEST_CONTEXT;

let getDb: typeof import("@/lib/db").getDb;

function ledgerRows(): ProviderCostLedgerRow[] {
  return getDb()
    .prepare("SELECT * FROM api_cost_ledger ORDER BY id ASC")
    .all() as ProviderCostLedgerRow[];
}

function sseResponse(
  events: unknown[],
  headers?: Record<string, string>
): Response {
  const chunks = [
    ...events.map((event) => `data: ${JSON.stringify(event)}\n\n`),
    "data: [DONE]\n\n",
  ];
  return new Response(mockReadableStreamFromText(chunks), {
    status: 200,
    headers: { "Content-Type": "text/event-stream", ...headers },
  });
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function installFetch(handler: (call: number) => Response): { calls: number } {
  const state = { calls: 0 };
  globalThis.fetch = (async () => {
    state.calls += 1;
    return handler(state.calls);
  }) as typeof fetch;
  return state;
}

describe("TRPG provider billing request id ledger", () => {
  before(async () => {
    process.env.NODE_TEST_CONTEXT = "1";
    delete process.env.MOCK_MODE;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-trpg-ledger";
    installIsolatedTestDatabase();
    ({ getDb } = await import("@/lib/db"));
    ensureProviderCostLedgerSchema(getDb());
  });

  after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
    if (previousMock === undefined) delete process.env.MOCK_MODE;
    else process.env.MOCK_MODE = previousMock;
    if (previousTestContext === undefined) delete process.env.NODE_TEST_CONTEXT;
    else process.env.NODE_TEST_CONTEXT = previousTestContext;
    uninstallIsolatedTestDatabase();
  });

  beforeEach(() => {
    getDb().exec("DELETE FROM api_cost_ledger");
  });

  afterEach(() => {
    globalThis.fetch = previousFetch;
  });

  it("keeps the GM SSE billing id when it arrives after usage", async () => {
    installFetch(() =>
      sseResponse([
        {
          choices: [{ delta: { content: GM_TEXT }, finish_reason: null }],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        },
        { choices: [{ delta: {} }], cheaper_inference: { request_id: "gm-late-id" } },
      ])
    );
    await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000, persistProviderCostInTests: true });
    const rows = ledgerRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.provider_request_id, "gm-late-id");
    assert.equal(rows[0]!.request_kind, "background-trpg-gm");
    assert.equal(rows[0]!.input_tokens, 11);
    assert.equal(rows[0]!.output_tokens, 7);
    assert.equal(rows[0]!.event_status, "completed_without_exact_cost");
    assert.equal(rows[0]!.actual_cost_source, "unavailable");
    assert.equal(rows[0]!.actual_cost_usd, null);
    assert.equal(rows[0]!.attempt_ordinal, 1);
  });

  it("keeps the GM SSE billing id when it arrives before usage and prefers the header", async () => {
    installFetch(() =>
      sseResponse(
        [
          {
            choices: [{ delta: { content: GM_TEXT }, finish_reason: null }],
            cheaper_inference: { request_id: "gm-body-id" },
          },
          { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 4, completion_tokens: 3 } },
        ],
        { "x-ci-request-id": "gm-header-id" }
      )
    );
    await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000, persistProviderCostInTests: true });
    const rows = ledgerRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.provider_request_id, "gm-header-id");
    assert.equal(rows[0]!.input_tokens, 4);
  });

  it("keeps a billing id when the response has no usage", async () => {
    installFetch(() =>
      sseResponse([
        {
          choices: [{ delta: { content: GM_TEXT }, finish_reason: "stop" }],
          cheaper_inference: { request_id: "gm-id-only" },
        },
      ])
    );
    await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000, persistProviderCostInTests: true });
    const rows = ledgerRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.provider_request_id, "gm-id-only");
    assert.equal(rows[0]!.event_status, "completed_without_exact_cost");
    assert.equal(rows[0]!.actual_cost_source, "unavailable");
    assert.equal(rows[0]!.input_tokens, 0);
  });

  it("does not invent a billing id from a completion id or a CDN ray", async () => {
    installFetch(() =>
      jsonResponse({
        id: "chatcmpl-not-billing",
        choices: [{ message: { content: "먼저 나가지 마." } }],
        usage: { prompt_tokens: 8, completion_tokens: 2 },
      })
    );
    await callTrpgBot({ system: "sys", user: "행동", timeoutMs: 5_000, persistProviderCostInTests: true });
    let rows = ledgerRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.provider_request_id, null);
    assert.equal(rows[0]!.request_kind, "background-trpg-bot");

    getDb().exec("DELETE FROM api_cost_ledger");
    installFetch(() =>
      jsonResponse(
        { id: "chatcmpl-not-billing", choices: [{ message: { content: "먼저 나가지 마." } }] },
        200,
        { "x-ci-request-id": "abcd1234-ICN" }
      )
    );
    await callTrpgBot({ system: "sys", user: "행동", timeoutMs: 5_000, persistProviderCostInTests: true });
    rows = ledgerRows();
    assert.equal(rows.length, 0);
  });

  it("stores the Bot JSON billing id from the body when the header is absent", async () => {
    installFetch(() =>
      jsonResponse({
        id: "chatcmpl-ignored",
        choices: [{ message: { content: "먼저 나가지 마." } }],
        usage: { prompt_tokens: 9, completion_tokens: 2 },
        cheaper_inference: { request_id: "bot-body-id" },
      })
    );
    await callTrpgBot({ system: "sys", user: "행동", timeoutMs: 5_000, persistProviderCostInTests: true });
    const rows = ledgerRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.provider_request_id, "bot-body-id");
    assert.equal(rows[0]!.event_status, "completed_without_exact_cost");
  });

  it("records one row when the same provider request id is persisted twice", async () => {
    installFetch(() =>
      jsonResponse(
        {
          choices: [{ message: { content: "먼저 나가지 마." } }],
          usage: { prompt_tokens: 9, completion_tokens: 2 },
        },
        200,
        { "x-ci-request-id": "bot-same-id" }
      )
    );
    await callTrpgBot({ system: "sys", user: "행동", timeoutMs: 5_000, persistProviderCostInTests: true });
    await callTrpgBot({ system: "sys", user: "행동", timeoutMs: 5_000, persistProviderCostInTests: true });
    const rows = ledgerRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.provider_request_id, "bot-same-id");
    assert.equal(rows[0]!.actual_cost_usd, null);
  });

  it("keeps separate ids for a GM 5xx attempt and the successful retry", async () => {
    const seen = installFetch((call) => {
      if (call === 1) {
        return jsonResponse({ cheaper_inference: { request_id: "gm-fail-1" } }, 502);
      }
      return sseResponse(
        [
          { choices: [{ delta: { content: GM_TEXT } }], cheaper_inference: { request_id: "gm-body-ignored" } },
          { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 4 } },
        ],
        { "x-ci-request-id": "gm-ok-2" }
      );
    });
    await callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000, persistProviderCostInTests: true });
    assert.equal(seen.calls, 2);
    const rows = ledgerRows();
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.provider_request_id, "gm-fail-1");
    assert.equal(rows[0]!.event_status, "failed_without_usage");
    assert.equal(rows[0]!.attempt_ordinal, 1);
    assert.equal(rows[0]!.actual_cost_source, "unavailable");
    assert.equal(rows[1]!.provider_request_id, "gm-ok-2");
    assert.equal(rows[1]!.event_status, "completed_without_exact_cost");
    assert.equal(rows[1]!.attempt_ordinal, 2);
    assert.equal(rows[1]!.input_tokens, 5);
  });

  it("does not retry a Bot failure and still keeps that attempt id", async () => {
    const seen = installFetch(() =>
      jsonResponse({ cheaper_inference: { request_id: "bot-fail-1" } }, 500, {
        "x-ci-request-id": "bot-fail-header",
      })
    );
    await assert.rejects(
      () => callTrpgBot({ system: "sys", user: "행동", timeoutMs: 5_000, persistProviderCostInTests: true }),
      /500/
    );
    assert.equal(seen.calls, 1);
    const rows = ledgerRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.provider_request_id, "bot-fail-header");
    assert.equal(rows[0]!.event_status, "failed_without_usage");
    assert.equal(rows[0]!.attempt_ordinal, 1);
  });

  it("keeps an id captured before an empty or aborted GM stream", async () => {
    installFetch(() =>
      sseResponse(
        [{ choices: [{ delta: { content: "   " } }], usage: { prompt_tokens: 2, completion_tokens: 1 } }],
        { "x-ci-request-id": "gm-empty-id" }
      )
    );
    await assert.rejects(
      () => callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000, persistProviderCostInTests: true }),
      /empty completion/
    );
    let rows = ledgerRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.provider_request_id, "gm-empty-id");
    assert.equal(rows[0]!.event_status, "failed_with_usage");
    assert.equal(rows[0]!.actual_cost_source, "unavailable");

    getDb().exec("DELETE FROM api_cost_ledger");
    installFetch(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("stream aborted"));
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream", "x-ci-request-id": "gm-abort-header" } }
        )
    );
    await assert.rejects(
      () => callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000, persistProviderCostInTests: true })
    );
    rows = ledgerRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.provider_request_id, "gm-abort-header");
    assert.equal(rows[0]!.event_status, "failed_without_usage");

    getDb().exec("DELETE FROM api_cost_ledger");
    const encoder = new TextEncoder();
    let pulled = false;
    installFetch(
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              if (!pulled) {
                pulled = true;
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      choices: [{ delta: { content: "문" } }],
                      cheaper_inference: { request_id: "gm-abort-body" },
                    })}\n\n`
                  )
                );
                return;
              }
              controller.error(new Error("stream aborted"));
            },
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        )
    );
    await assert.rejects(
      () => callTrpgGm({ system: "sys", user: "장면", timeoutMs: 5_000, persistProviderCostInTests: true })
    );
    rows = ledgerRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.provider_request_id, "gm-abort-body");
    assert.equal(rows[0]!.event_status, "failed_without_usage");
  });
});
