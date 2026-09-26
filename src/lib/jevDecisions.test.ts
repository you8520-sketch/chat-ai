import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import Database from "better-sqlite3";

/**
 * BEFORE-fix reproduction: the Jev Decisions canonical transport does not
 * exist on main. This suite MUST fail before the fix and pass after it.
 * Zero live provider calls — fetch is stubbed in every test.
 */
describe("jev decisions contract reproduction (must fail before fix)", () => {
  it("exposes the pinned decisions contract owner", async () => {
    const mod = await import("./jevDecisions");
    assert.equal(mod.JEV_DECISIONS_MODEL, "typesafe/jev-1.13");
    assert.equal(mod.JEV_DECISIONS_URL, "https://openrouter.ai/api/alpha/decisions");
    assert.equal(typeof mod.callJevDecisions, "function");
  });
});

describe("jev decisions wire contract", () => {
  type FetchCall = { url: string; init: RequestInit };
  let calls: FetchCall[];
  let savedFetch: typeof fetch | undefined;
  let savedKey: string | undefined;

  const stubFetch = (handler: (call: FetchCall) => Response) => {
    calls = [];
    (globalThis as Record<string, unknown>).fetch = async (url: unknown, init?: unknown) => {
      const call = { url: String(url), init: (init ?? {}) as RequestInit };
      calls.push(call);
      return handler(call);
    };
  };
  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "x-request-id": "or-test-1" },
    });

  const decisionBody = () => ({
    answers: [
      { question_id: "q1", primitive: "choice", choice: "attack" },
      { question_id: "q2", primitive: "noul", choice: "lawful" },
      { question_id: "q3", primitive: "score", score: 0.82 },
    ],
    usage: { prompt_tokens: 120, completion_tokens: 8, cost: 0.00042 },
  });

  const questions = () => [
    { id: "q1", primitive: "choice" as const, question: "What to do?", options: ["attack", "flee"] },
    { id: "q2", primitive: "noul" as const, question: "Alignment?" },
    { id: "q3", primitive: "score" as const, question: "Confidence?" },
  ];

  it("missing OPENROUTER_API_KEY fails before any HTTP call", async () => {
    const { callJevDecisions } = await import("./jevDecisions");
    savedFetch = globalThis.fetch;
    savedKey = process.env.OPENROUTER_API_KEY;
    try {
      delete process.env.OPENROUTER_API_KEY;
      stubFetch(() => jsonResponse(decisionBody()));
      await assert.rejects(
        () =>
          callJevDecisions({
            state: { round: 3 },
            questions: questions(),
            ledger: null,
          }),
        /NO_OPENROUTER_KEY/
      );
      assert.equal(calls.length, 0, "no HTTP without a key");
    } finally {
      globalThis.fetch = savedFetch!;
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
    }
  });

  it("posts model+state+questions to the decisions endpoint with bearer auth", async () => {
    const { callJevDecisions } = await import("./jevDecisions");
    savedFetch = globalThis.fetch;
    savedKey = process.env.OPENROUTER_API_KEY;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      stubFetch(() => jsonResponse(decisionBody()));
      const result = await callJevDecisions({
        state: { round: 3 },
        questions: questions(),
        ledger: null,
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.url, "https://openrouter.ai/api/alpha/decisions");
      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(headers.Authorization, "Bearer test-key");
      assert.equal(headers["Content-Type"], "application/json");
      const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
      assert.equal(body.model, "typesafe/jev-1.13");
      assert.deepEqual(body.state, { round: 3 });
      assert.equal((body.questions as unknown[]).length, 3);
      assert.equal(result.answers.length, 3);
      assert.equal(result.answers[0]!.choice, "attack");
      assert.equal(result.answers[1]!.choice, "lawful");
      assert.equal(result.answers[2]!.score, 0.82);
    } finally {
      globalThis.fetch = savedFetch!;
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("preserves usage provenance without the completion contract", async () => {
    const { callJevDecisions } = await import("./jevDecisions");
    savedFetch = globalThis.fetch;
    savedKey = process.env.OPENROUTER_API_KEY;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      stubFetch(() => jsonResponse(decisionBody()));
      const result = await callJevDecisions({
        state: {},
        questions: questions(),
        ledger: null,
      });
      assert.equal(result.usage.inputTokens, 120);
      assert.equal(result.usage.outputTokens, 8);
      assert.equal(result.usage.upstreamCostUsd, 0.00042);
      assert.equal(result.usage.estimated, false);
    } finally {
      globalThis.fetch = savedFetch!;
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("malformed responses fail deterministically", async () => {
    const { callJevDecisions, JevDecisionsError } = await import("./jevDecisions");
    savedFetch = globalThis.fetch;
    savedKey = process.env.OPENROUTER_API_KEY;
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      stubFetch(() => jsonResponse({ usage: {} }));
      await assert.rejects(
        () => callJevDecisions({ state: {}, questions: questions(), ledger: null }),
        JevDecisionsError
      );
      stubFetch(() => jsonResponse({ error: "bad" }, 400));
      const err = await callJevDecisions({
        state: {},
        questions: questions(),
        ledger: null,
      }).then(
        () => null,
        (e: unknown) => e
      );
      assert.ok(err instanceof JevDecisionsError);
      assert.equal((err as { httpStatus: number }).httpStatus, 400);
    } finally {
      globalThis.fetch = savedFetch!;
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("records exactly one canonical ledger row per successful call", async () => {
    const { callJevDecisions } = await import("./jevDecisions");
    savedFetch = globalThis.fetch;
    savedKey = process.env.OPENROUTER_API_KEY;
    const db = new Database(":memory:");
    try {
      process.env.OPENROUTER_API_KEY = "test-key";
      stubFetch(() => jsonResponse(decisionBody()));
      await callJevDecisions({
        state: {},
        questions: questions(),
        ledger: { db, persistInTests: true },
      });
      const rows = db
        .prepare("SELECT provider, model, request_kind FROM api_cost_ledger")
        .all() as { provider: string; model: string; request_kind: string }[];
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.provider, "openrouter");
      assert.equal(rows[0]!.model, "typesafe/jev-1.13");
      assert.match(rows[0]!.request_kind, /jev/i);
    } finally {
      db.close();
      globalThis.fetch = savedFetch!;
      if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
      else delete process.env.OPENROUTER_API_KEY;
    }
  });
});

describe("jev decisions regression gates", () => {
  it("chat completion helper is unchanged (no jev special-case)", () => {
    const src = fs.readFileSync("src/lib/openRouterCompletion.ts", "utf8");
    assert.doesNotMatch(src, /jev/i);
    assert.doesNotMatch(src, /typesafe/i);
    assert.doesNotMatch(src, /decisions/i);
  });

  it("main RP registry and detectors are unchanged", () => {
    const models = fs.readFileSync("src/lib/chatModels.ts", "utf8");
    assert.doesNotMatch(models, /jev/i);
    assert.doesNotMatch(models, /typesafe/i);
    assert.doesNotMatch(models, /decisions/i);
    const ci = fs.readFileSync("src/lib/cheaperInferenceConfig.ts", "utf8");
    assert.doesNotMatch(ci, /jev/i);
    assert.doesNotMatch(ci, /typesafe/i);
  });

  it("existing canonical owners are untouched", () => {
    const config = fs.readFileSync("src/lib/openRouterConfig.ts", "utf8");
    assert.match(config, /OPENROUTER_CHAT_COMPLETIONS_URL/);
    const ledger = fs.readFileSync("src/lib/providerCostLedger.ts", "utf8");
    assert.doesNotMatch(ledger, /jev/i);
    const provenance = fs.readFileSync("src/lib/auxProviderProvenance.ts", "utf8");
    assert.doesNotMatch(provenance, /jev/i);
  });

  it("decisions transport only reuses allow-listed owners", () => {
    const src = fs.readFileSync("src/lib/jevDecisions.ts", "utf8");
    assert.match(src, /from "@\/lib\/openRouterConfig"/);
    assert.doesNotMatch(src, /openRouterCompletion/);
    assert.doesNotMatch(src, /chatModels/);
    assert.doesNotMatch(src, /cheaperInferenceConfig/);
    assert.doesNotMatch(src, /choices\[\]\.message\.content|message\.content/);
    assert.doesNotMatch(src, /assertOpenRouterEndpoint/);
  });
});
