import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import Database from "better-sqlite3";

/**
 * Official Decisions wire-contract correction pass.
 * Fixtures are structurally shaped like OpenRouter's published raw HTTP
 * examples: questions/answers are OBJECTS keyed by question ID, answer
 * discriminator is `type`, noul carries a numeric `noul`, usage carries
 * input_tokens/output_tokens/cost. Zero live provider calls — fetch stubbed.
 */
describe("jev decisions official wire contract", () => {
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
  const restoreEnv = () => {
    globalThis.fetch = savedFetch!;
    if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
    else delete process.env.OPENROUTER_API_KEY;
  };
  const withKey = () => {
    savedFetch = globalThis.fetch;
    savedKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-key";
  };

  /** Official-shaped request questions object. */
  const questions = () => ({
    attack_plan: {
      type: "choice" as const,
      instructions: "Choose the party action for this round.",
      criteria: { attack: "Strike the gate guard now.", flee: "Retreat to the alley." },
    },
    moral_stance: {
      type: "noul" as const,
      instructions: "Is the act lawful?",
      criteria: { true: "Follows the city code.", false: "Breaks the city code." },
    },
    risk: {
      type: "score" as const,
      instructions: "Rate the risk of the chosen plan.",
      criteria: ["low", "medium", "high"],
    },
  });

  /** Official-shaped raw response (dated served snapshot, object answers). */
  const decisionBody = () => ({
    model: "typesafe/jev-1.13-20260920",
    answers: {
      attack_plan: {
        type: "choice",
        choice: "attack",
        probabilities: { attack: 0.7, flee: 0.3 },
        confidence: 0.82,
      },
      moral_stance: { type: "noul", noul: 0.99 },
      risk: {
        type: "score",
        score: 0.6,
        legend: { low: "Minor setback.", medium: "Serious cost.", high: "Party wipe risk." },
        probabilities: { low: 0.2, medium: 0.5, high: 0.3 },
        confidence: 0.77,
      },
    },
    usage: { input_tokens: 120, output_tokens: 8, cost: 0.00042 },
    id: "gen-abc123",
    provider: "typesafe",
  });

  it("C1 choice request wire: questions object with type/instructions/criteria", async () => {
    const { callJevDecisions } = await import("./jevDecisions");
    withKey();
    try {
      stubFetch(() => jsonResponse(decisionBody()));
      await callJevDecisions({ state: { round: 3 }, questions: questions(), ledger: null });
      assert.equal(calls.length, 1);
      assert.equal(calls[0]!.url, "https://openrouter.ai/api/alpha/decisions");
      const headers = calls[0]!.init.headers as Record<string, string>;
      assert.equal(headers.Authorization, "Bearer test-key");
      assert.equal(headers["Content-Type"], "application/json");
      const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
      assert.equal(body.model, "typesafe/jev-1.13");
      assert.deepEqual(body.state, { round: 3 });
      const wireQuestions = body.questions as Record<string, Record<string, unknown>>;
      assert.equal(Array.isArray(wireQuestions), false, "questions must be an object, not an array");
      assert.deepEqual(wireQuestions.attack_plan, {
        type: "choice",
        instructions: "Choose the party action for this round.",
        criteria: { attack: "Strike the gate guard now.", flee: "Retreat to the alley." },
      });
    } finally {
      restoreEnv();
    }
  });

  it("C2 choice response preserves choice/probabilities/confidence", async () => {
    const { callJevDecisions } = await import("./jevDecisions");
    withKey();
    try {
      stubFetch(() => jsonResponse(decisionBody()));
      const result = await callJevDecisions({
        state: { round: 3 },
        questions: questions(),
        ledger: null,
      });
      const answer = result.answers.attack_plan!;
      assert.equal(answer.type, "choice");
      if (answer.type !== "choice") throw new Error("narrow");
      assert.equal(answer.choice, "attack");
      assert.deepEqual(answer.probabilities, { attack: 0.7, flee: 0.3 });
      assert.equal(answer.confidence, 0.82);
    } finally {
      restoreEnv();
    }
  });

  it("C3 noul parses numeric noul with no fake choice field", async () => {
    const { callJevDecisions } = await import("./jevDecisions");
    withKey();
    try {
      stubFetch(() => jsonResponse(decisionBody()));
      const result = await callJevDecisions({
        state: {},
        questions: questions(),
        ledger: null,
      });
      const answer = result.answers.moral_stance!;
      assert.equal(answer.type, "noul");
      if (answer.type !== "noul") throw new Error("narrow");
      assert.equal(answer.noul, 0.99);
      assert.ok(!("choice" in answer), "noul answers must not synthesize a choice field");
    } finally {
      restoreEnv();
    }
  });

  it("C4 noul boundaries: 0 and 1 valid, outside [0,1] rejected", async () => {
    const { callJevDecisions, JevDecisionsError } = await import("./jevDecisions");
    withKey();
    try {
      const single = () => ({
        moral_stance: {
          type: "noul" as const,
          instructions: "Is the act lawful?",
        },
      });
      for (const valid of [0, 1]) {
        stubFetch(() =>
          jsonResponse({
            model: "typesafe/jev-1.13",
            answers: { moral_stance: { type: "noul", noul: valid } },
            usage: { input_tokens: 1, output_tokens: 1, cost: 0.00001 },
          })
        );
        const result = await callJevDecisions({ state: {}, questions: single(), ledger: null });
        const answer = result.answers.moral_stance!;
        assert.equal(answer.type, "noul");
      }
      for (const invalid of [-0.1, 1.1, Number.NaN, "0.5"]) {
        stubFetch(() =>
          jsonResponse({
            model: "typesafe/jev-1.13",
            answers: { moral_stance: { type: "noul", noul: invalid } },
            usage: { input_tokens: 1, output_tokens: 1, cost: 0.00001 },
          })
        );
        await assert.rejects(
          () => callJevDecisions({ state: {}, questions: single(), ledger: null }),
          JevDecisionsError
        );
      }
    } finally {
      restoreEnv();
    }
  });

  it("C5 score preserves score/legend/probabilities/confidence", async () => {
    const { callJevDecisions } = await import("./jevDecisions");
    withKey();
    try {
      stubFetch(() => jsonResponse(decisionBody()));
      const result = await callJevDecisions({
        state: {},
        questions: questions(),
        ledger: null,
      });
      const answer = result.answers.risk!;
      assert.equal(answer.type, "score");
      if (answer.type !== "score") throw new Error("narrow");
      assert.equal(answer.score, 0.6);
      assert.deepEqual(answer.legend, {
        low: "Minor setback.",
        medium: "Serious cost.",
        high: "Party wipe risk.",
      });
      assert.deepEqual(answer.probabilities, { low: 0.2, medium: 0.5, high: 0.3 });
      assert.equal(answer.confidence, 0.77);
    } finally {
      restoreEnv();
    }
  });

  it("C6 combined choice+noul+score in one request, C7 answers keyed by same IDs", async () => {
    const { callJevDecisions } = await import("./jevDecisions");
    withKey();
    try {
      stubFetch(() => jsonResponse(decisionBody()));
      const result = await callJevDecisions({
        state: "round three",
        questions: questions(),
        ledger: null,
      });
      assert.deepEqual(Object.keys(result.answers).sort(), ["attack_plan", "moral_stance", "risk"]);
      assert.equal(result.answers.attack_plan!.type, "choice");
      assert.equal(result.answers.moral_stance!.type, "noul");
      assert.equal(result.answers.risk!.type, "score");
    } finally {
      restoreEnv();
    }
  });

  it("C8 unknown returned question id rejected", async () => {
    const { callJevDecisions, JevDecisionsError } = await import("./jevDecisions");
    withKey();
    try {
      const body = decisionBody() as unknown as {
        answers: Record<string, unknown>;
      };
      body.answers.ghost = { type: "noul", noul: 0.5 };
      stubFetch(() => jsonResponse(body));
      await assert.rejects(
        () => callJevDecisions({ state: {}, questions: questions(), ledger: null }),
        JevDecisionsError
      );
    } finally {
      restoreEnv();
    }
  });

  it("C9 missing requested answer is fail-closed invalid_response", async () => {
    const { callJevDecisions, JevDecisionsError } = await import("./jevDecisions");
    withKey();
    try {
      const body = decisionBody() as unknown as {
        answers: Record<string, unknown>;
      };
      delete body.answers.risk;
      stubFetch(() => jsonResponse(body));
      await assert.rejects(
        () => callJevDecisions({ state: {}, questions: questions(), ledger: null }),
        (e: unknown) =>
          e instanceof JevDecisionsError &&
          e.code === "invalid_response" &&
          /fail-closed/.test(e.message)
      );
    } finally {
      restoreEnv();
    }
  });

  it("C10 answer type mismatch rejected", async () => {
    const { callJevDecisions, JevDecisionsError } = await import("./jevDecisions");
    withKey();
    try {
      const body = decisionBody() as unknown as {
        answers: Record<string, unknown>;
      };
      body.answers.risk = { type: "noul", noul: 0.5 };
      stubFetch(() => jsonResponse(body));
      await assert.rejects(
        () => callJevDecisions({ state: {}, questions: questions(), ledger: null }),
        JevDecisionsError
      );
    } finally {
      restoreEnv();
    }
  });

  it("C11 malformed confidence/probabilities fail deterministically", async () => {
    const { callJevDecisions, JevDecisionsError } = await import("./jevDecisions");
    withKey();
    try {
      const variants: unknown[] = [
        { type: "choice", choice: "attack", probabilities: { attack: 0.7 }, confidence: 1.5 },
        { type: "choice", choice: "attack", probabilities: {}, confidence: 0.5 },
        { type: "choice", choice: "attack", probabilities: { attack: "high" }, confidence: 0.5 },
        { type: "choice", probabilities: { attack: 1 }, confidence: 0.5 },
      ];
      for (const bad of variants) {
        const body = decisionBody() as unknown as {
          answers: Record<string, unknown>;
        };
        body.answers.attack_plan = bad;
        stubFetch(() => jsonResponse(body));
        await assert.rejects(
          () => callJevDecisions({ state: {}, questions: questions(), ledger: null }),
          JevDecisionsError
        );
      }
    } finally {
      restoreEnv();
    }
  });

  it("C12 actual usage shape proves inputTokens/outputTokens/upstreamCostUsd, estimated=false", async () => {
    const { callJevDecisions } = await import("./jevDecisions");
    withKey();
    try {
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
      restoreEnv();
    }
  });

  it("C13 one success records one canonical ledger row with provider-reported exact cost", async () => {
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
        .prepare(
          "SELECT provider, model, request_kind, actual_cost_usd, actual_cost_source FROM api_cost_ledger"
        )
        .all() as {
        provider: string;
        model: string;
        request_kind: string;
        actual_cost_usd: number | null;
        actual_cost_source: string | null;
      }[];
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.provider, "openrouter");
      assert.equal(rows[0]!.model, "typesafe/jev-1.13");
      assert.match(rows[0]!.request_kind, /jev/i);
      assert.equal(rows[0]!.actual_cost_usd, 0.00042);
      assert.equal(rows[0]!.actual_cost_source, "provider_reported");
    } finally {
      db.close();
      restoreEnv();
    }
  });

  it("C14 auth missing performs HTTP 0", async () => {
    const { callJevDecisions } = await import("./jevDecisions");
    savedFetch = globalThis.fetch;
    savedKey = process.env.OPENROUTER_API_KEY;
    try {
      delete process.env.OPENROUTER_API_KEY;
      stubFetch(() => jsonResponse(decisionBody()));
      await assert.rejects(
        () => callJevDecisions({ state: {}, questions: questions(), ledger: null }),
        /NO_OPENROUTER_KEY/
      );
      assert.equal(calls.length, 0, "no HTTP without a key");
    } finally {
      restoreEnv();
    }
  });

  it("C15 HTTP error is a deterministic JevDecisionsError", async () => {
    const { callJevDecisions, JevDecisionsError } = await import("./jevDecisions");
    withKey();
    try {
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
      assert.equal((err as JevDecisionsError).code, "http_error");
      assert.equal((err as JevDecisionsError).httpStatus, 400);
    } finally {
      restoreEnv();
    }
  });

  it("C16 non-JSON is a deterministic error", async () => {
    const { callJevDecisions, JevDecisionsError } = await import("./jevDecisions");
    withKey();
    try {
      stubFetch(
        () =>
          new Response("not json", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          })
      );
      await assert.rejects(
        () => callJevDecisions({ state: {}, questions: questions(), ledger: null }),
        JevDecisionsError
      );
    } finally {
      restoreEnv();
    }
  });

  it("C17 official request bounds reject >255 choice options, score outside 2..10 levels, and non-string state arrays", async () => {
    const { callJevDecisions, JevDecisionsError } = await import("./jevDecisions");

    const tooManyChoiceOptions = Object.fromEntries(
      Array.from({ length: 256 }, (_, i) => [`option_${i}`, `Description ${i}`])
    );
    await assert.rejects(
      () =>
        callJevDecisions({
          state: {},
          questions: {
            route: {
              type: "choice",
              instructions: "Choose one route.",
              criteria: tooManyChoiceOptions,
            },
          },
          ledger: null,
        }),
      JevDecisionsError
    );

    for (const levels of [
      ["only-one"],
      Array.from({ length: 11 }, (_, i) => `level-${i}`),
    ]) {
      await assert.rejects(
        () =>
          callJevDecisions({
            state: {},
            questions: {
              severity: {
                type: "score",
                instructions: "Rate severity.",
                criteria: levels,
              },
            },
            ledger: null,
          }),
        JevDecisionsError
      );
    }

    await assert.rejects(
      () =>
        callJevDecisions({
          state: ["valid", { invalid: true }] as unknown as string[],
          questions: {
            check: { type: "noul", instructions: "Is this valid?" },
          },
          ledger: null,
        }),
      JevDecisionsError
    );
  });

  it("C18 dated served model snapshot is accepted, array answers rejected", async () => {
    const { callJevDecisions, JevDecisionsError } = await import("./jevDecisions");
    withKey();
    try {
      stubFetch(() => jsonResponse(decisionBody()));
      const result = await callJevDecisions({
        state: {},
        questions: questions(),
        ledger: null,
      });
      assert.equal(result.responseModel, "typesafe/jev-1.13-20260920");
      stubFetch(() =>
        jsonResponse({
          model: "typesafe/jev-1.13",
          answers: [{ type: "noul", noul: 0.5 }],
          usage: { input_tokens: 1, output_tokens: 1, cost: 0.00001 },
        })
      );
      await assert.rejects(
        () =>
          callJevDecisions({
            state: {},
            questions: {
              moral_stance: { type: "noul", instructions: "Lawful?" },
            },
            ledger: null,
          }),
        JevDecisionsError
      );
    } finally {
      restoreEnv();
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
    const usage = fs.readFileSync("src/lib/openRouterUsage.ts", "utf8");
    assert.doesNotMatch(usage, /jev/i);
  });

  it("decisions transport only reuses allow-listed owners", () => {
    const src = fs.readFileSync("src/lib/jevDecisions.ts", "utf8");
    assert.match(src, /from "@\/lib\/openRouterConfig"/);
    assert.match(src, /from "@\/lib\/openRouterUsage"/);
    assert.match(src, /from "@\/lib\/providerCostLedger"/);
    assert.match(src, /from "@\/lib\/auxProviderProvenance"/);
    assert.doesNotMatch(src, /openRouterCompletion/);
    assert.doesNotMatch(src, /cheaperInferenceConfig/);
    assert.doesNotMatch(src, /choices\[\]\.message\.content|message\.content/);
    assert.doesNotMatch(src, /assertOpenRouterEndpoint/);
    // Old invented schema used `primitive` as a field/discriminator — the
    // official contract uses `type`. (Plain-English comment uses excluded.)
    assert.doesNotMatch(src, /\.primitive\b/);
    assert.doesNotMatch(src, /JevDecisionPrimitive/);
    assert.doesNotMatch(src, /["']primitive["']/);
  });
});
