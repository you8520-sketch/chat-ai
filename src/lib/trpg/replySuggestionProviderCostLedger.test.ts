import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  ensureProviderCostLedgerSchema,
  type ProviderCostLedgerRow,
} from "@/lib/providerCostLedger";
import {
  installIsolatedTestDatabase,
  uninstallIsolatedTestDatabase,
} from "@/lib/test/isolatedTestDatabase";
import {
  callTrpgReplySuggestionModel,
  executeTrpgReplySuggestionProviderRound,
  requestTrpgReplySuggestions,
  resetTrpgReplySuggestionCooldownForTests,
  TRPG_REPLY_SUGGESTION_MAX_TOKENS,
  TRPG_REPLY_SUGGESTION_MODEL,
  TRPG_REPLY_SUGGESTION_REQUEST_KIND,
} from "./replySuggestions";
import { ensureTrpgTables } from "./schema";
import { createTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "./engineCreate";
import { startTrpgCampaign, type TrpgEngineDeps } from "./engineAdvance";
import { fetchDeepSeekNonStreamCompletion } from "@/lib/deepseekProviderFailover";
import { buildTrpgGmStructuredWireText } from "./gmStructuredOutput";

const CI_URL = "https://api.cheaperinference.com/v1/chat/completions";
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

const validJson = JSON.stringify({
  suggestions: [
    { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
    { stance: "neutral", actionType: "investigate", text: "경첩부터 살핀다." },
    { stance: "evil", actionType: "persuade", text: "퇴로를 막고 협박한다." },
  ],
});

function ciSuccess(
  text: string,
  opts?: {
    requestId?: string;
    billedCostUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
  }
): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: "stop" }],
      usage: {
        prompt_tokens: opts?.inputTokens ?? 120,
        completion_tokens: opts?.outputTokens ?? 40,
      },
      cheaper_inference: opts?.billedCostUsd
        ? { billing: { billed_cost_usd: opts.billedCostUsd } }
        : undefined,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...(opts?.requestId ? { "x-request-id": opts.requestId } : {}),
      },
    }
  );
}

function orSuccess(text: string, requestId?: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 90, completion_tokens: 35 },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...(requestId ? { "x-openrouter-request-id": requestId } : {}),
      },
    }
  );
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

function buildFetchMock(
  handler: (url: string, body: Record<string, unknown>) => Response | Promise<Response>
): typeof fetchDeepSeekNonStreamCompletion {
  return async (opts) => {
    const started = Date.now();
    const body =
      typeof opts.request.body === "string"
        ? (JSON.parse(opts.request.body) as Record<string, unknown>)
        : (opts.request.body as Record<string, unknown>);
    const response = await handler(opts.request.endpoint, body);
    return { response, latencyMs: Math.max(1, Date.now() - started) };
  };
}

function gmText(): string {
  return buildTrpgGmStructuredWireText("폐역에 찬 바람이 돈다.", {
    players: [],
    location: "폐역",
    next_round_context: "기다릴지",
    campaign_finished: false,
  });
}

let getDb: typeof import("@/lib/db").getDb;

function listLedgerRows(): ProviderCostLedgerRow[] {
  return getDb()
    .prepare("SELECT * FROM api_cost_ledger ORDER BY id ASC")
    .all() as ProviderCostLedgerRow[];
}

describe("trpg reply suggestion provider cost ledger", () => {
  before(async () => {
    process.env.NODE_TEST_CONTEXT = "1";
    installIsolatedTestDatabase();
    ({ getDb: getDb } = await import("@/lib/db"));
    ensureTrpgTables(getDb());
    ensureProviderCostLedgerSchema(getDb());
    getDb().exec(`
      INSERT OR IGNORE INTO users (id, email, nickname, pw_hash) VALUES (1, 'u1@test', 'u1', 'x');
    `);
  });

  after(() => {
    delete process.env.NODE_TEST_CONTEXT;
    uninstallIsolatedTestDatabase();
  });

  beforeEach(() => {
    resetTrpgReplySuggestionCooldownForTests();
    getDb().exec("DELETE FROM api_cost_ledger");
  });

  it("A: CI Luna primary success records one physical ledger event with canonical metadata", async () => {
    const requestId = `trpg-reply-${randomUUID()}`;
    let capturedMaxTokens: number | undefined;
    const fetchMock = buildFetchMock((url, body) => {
      capturedMaxTokens = Number(body.max_tokens);
      assert.equal(url, CI_URL);
      assert.equal(body.model, TRPG_REPLY_SUGGESTION_MODEL);
      return ciSuccess(validJson, { requestId, billedCostUsd: 0.0012, inputTokens: 120, outputTokens: 40 });
    });

    await withKeys(async () => {
      await executeTrpgReplySuggestionProviderRound({
        system: "sys",
        user: "user",
        logicalRequestId: "logical-a",
        deps: { fetchCompletion: fetchMock },
      });
    });

    const rows = listLedgerRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.provider, "cheaperinference");
    assert.equal(rows[0]!.model, TRPG_REPLY_SUGGESTION_MODEL);
    assert.equal(rows[0]!.request_kind, TRPG_REPLY_SUGGESTION_REQUEST_KIND);
    assert.equal(rows[0]!.cost_center, "trpg");
    assert.equal(rows[0]!.provider_request_id, requestId);
    assert.equal(rows[0]!.input_tokens, 120);
    assert.equal(rows[0]!.output_tokens, 40);
    assert.equal(rows[0]!.event_status, "settled");
    assert.ok(Math.abs((rows[0]!.actual_cost_usd ?? 0) - 0.0012) < 1e-9);
    assert.equal(capturedMaxTokens, TRPG_REPLY_SUGGESTION_MAX_TOKENS);
  });

  it("B: CI primary failure + OR fallback success records two attempts without double-counting success", async () => {
    const fallbackRequestId = `or-ok-${randomUUID()}`;
    let calls = 0;
    const fetchMock = buildFetchMock((url) => {
      calls += 1;
      if (url === CI_URL) {
        return new Response("upstream down", { status: 503 });
      }
      assert.equal(url, OR_URL);
      return orSuccess(validJson, fallbackRequestId);
    });

    await withKeys(async () => {
      await executeTrpgReplySuggestionProviderRound({
        system: "sys",
        user: "user",
        logicalRequestId: "logical-b",
        deps: { fetchCompletion: fetchMock },
      });
    });

    assert.equal(calls, 2);
    const rows = listLedgerRows();
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.provider, "cheaperinference");
    assert.equal(rows[0]!.event_status, "failed_without_usage");
    assert.equal(rows[0]!.attempt_ordinal, 1);
    assert.equal(rows[1]!.provider, "openrouter");
    assert.equal(rows[1]!.event_status, "completed_without_exact_cost");
    assert.equal(rows[1]!.provider_request_id, fallbackRequestId);
    assert.equal(rows[1]!.attempt_ordinal, 2);
  });

  it("C: primary timeout before usage records fail-closed failed_without_usage", async () => {
    const fetchMock: typeof fetchDeepSeekNonStreamCompletion = async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      });
    };

    await withKeys(async () => {
      await assert.rejects(() =>
        executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "logical-c",
          deps: { fetchCompletion: fetchMock },
        })
      );
    });

    const rows = listLedgerRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.provider, "cheaperinference");
    assert.equal(rows[0]!.event_status, "failed_without_usage");
    assert.equal(rows[0]!.attempt_ordinal, 1);
  });

  it("D: provider response with billed cost preserves exact cost fields", async () => {
    const fetchMock = buildFetchMock(() =>
      ciSuccess(validJson, { requestId: `cost-${randomUUID()}`, billedCostUsd: 0.00456 })
    );

    await withKeys(async () => {
      await executeTrpgReplySuggestionProviderRound({
        system: "sys",
        user: "user",
        logicalRequestId: "logical-d",
        deps: { fetchCompletion: fetchMock },
      });
    });

    const row = listLedgerRows()[0]!;
    assert.ok(Math.abs((row.actual_cost_usd ?? 0) - 0.00456) < 1e-9);
    assert.equal(row.actual_cost_source, "cheaper_inference_billed");
  });

  it("E: cached suggestion path performs no provider HTTP and writes no ledger rows", async () => {
    const db = getDb();
    const campaignId = createTrpgCampaign(db, {
      hostUserId: 1,
      hostNickname: "렌",
      viewerUserId: 1,
      hostPersona: {
        personaId: 9,
        name: "렌",
        description: "차갑고 짧게 말한다.",
        gender: "other",
        speechExamples: "됐어. 내가 볼게.",
      },
    });
    saveTrpgSheet(db, { campaignId, userId: 1, name: "렌", stats: EVEN_STATS });
    const deps: TrpgEngineDeps = {
      skipBilling: true,
      gmCall: async () => ({ text: gmText() }),
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });

    let providerCalls = 0;
    await withKeys(async () => {
      await requestTrpgReplySuggestions(db, {
        campaignId,
        userId: 1,
        complete: async (prompt) => {
          providerCalls += 1;
          return { text: validJson, model: TRPG_REPLY_SUGGESTION_MODEL };
        },
      });
      await requestTrpgReplySuggestions(db, {
        campaignId,
        userId: 1,
        complete: async (prompt) => {
          providerCalls += 1;
          return { text: validJson, model: TRPG_REPLY_SUGGESTION_MODEL };
        },
      });
    });

    assert.equal(providerCalls, 1);
    assert.equal(listLedgerRows().length, 0);
  });

  it("F: mock mode performs no provider HTTP and writes no ledger rows", async () => {
    const previousMock = process.env.MOCK_MODE;
    process.env.MOCK_MODE = "1";
    let fetchCalls = 0;
    const fetchMock = buildFetchMock(() => {
      fetchCalls += 1;
      return ciSuccess(validJson);
    });
    try {
      await callTrpgReplySuggestionModel({
        system: "sys",
        user: "user",
        logicalRequestId: "logical-f",
        hooks: {},
      });
    } finally {
      if (previousMock == null) delete process.env.MOCK_MODE;
      else process.env.MOCK_MODE = previousMock;
    }
    assert.equal(fetchCalls, 0);
    assert.equal(listLedgerRows().length, 0);
  });

  it("G: duplicate provider_request_id replay does not mint a second settled cost row", async () => {
    const requestId = `dedupe-${randomUUID()}`;
    const fetchMock = buildFetchMock(() => ciSuccess(validJson, { requestId, billedCostUsd: 0.001 }));

    await withKeys(async () => {
      await executeTrpgReplySuggestionProviderRound({
        system: "sys",
        user: "user",
        logicalRequestId: "logical-g1",
        deps: { fetchCompletion: fetchMock },
      });
      await executeTrpgReplySuggestionProviderRound({
        system: "sys",
        user: "user",
        logicalRequestId: "logical-g2",
        deps: { fetchCompletion: fetchMock },
      });
    });

    const rows = listLedgerRows();
    assert.equal(rows.length, 1);
    assert.ok(Math.abs((rows[0]!.actual_cost_usd ?? 0) - 0.001) < 1e-9);
  });

  it("H: output parsing remains unchanged for successful provider completion", async () => {
    const fetchMock = buildFetchMock(() => ciSuccess(validJson, { requestId: randomUUID() }));
    const result = await withKeys(() =>
      executeTrpgReplySuggestionProviderRound({
        system: "sys",
        user: "user",
        logicalRequestId: "logical-h",
        deps: { fetchCompletion: fetchMock },
      })
    );
    assert.match(result.text, /"stance":"good"/);
    assert.equal(result.model, TRPG_REPLY_SUGGESTION_MODEL);
  });
});
