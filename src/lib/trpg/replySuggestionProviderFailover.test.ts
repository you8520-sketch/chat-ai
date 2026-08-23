import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL,
  OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
} from "@/lib/chatModels";
import {
  callTrpgReplySuggestionModel,
  executeTrpgReplySuggestionProviderRound,
  requestTrpgReplySuggestions,
  resetTrpgReplySuggestionCooldownForTests,
  TRPG_REPLY_SUGGESTION_OR_RETRY_COUNT,
  TRPG_REPLY_SUGGESTION_CI_RETRY_COUNT,
  TRPG_REPLY_SUGGESTION_PROVIDER_ATTEMPTS_MAX,
} from "./replySuggestions";
import { createTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "./engineCreate";
import { startTrpgCampaign, type TrpgEngineDeps } from "./engineAdvance";
import { ensureTrpgTables } from "./schema";
import Database from "better-sqlite3";

const CI_URL = "https://api.cheaperinference.com/v1/chat/completions";
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

const validJson = JSON.stringify({
  suggestions: [
    { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
    { stance: "neutral", actionType: "investigate", text: "경첩부터 살핀다." },
    { stance: "evil", actionType: "persuade", text: "퇴로를 막고 협박한다." },
  ],
});

const recoverableJson = JSON.stringify({
  suggestions: [
    { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
    { stance: "neutral", action_type: "investigate", text: "경첩부터 살핀다." },
    { stance: "evil", actionType: "설득", text: "퇴로를 막고 협박한다." },
  ],
});

function completion(text: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function emptyCompletion(status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 0 },
    }),
    { status, headers: { "Content-Type": "application/json" } }
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

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
}

function gmText(narration = "폐역에 찬 바람이 돈다."): string {
  return `<<<NARRATION>>>
${narration}
<<<DELTA>>>
{"players":[],"location":"폐역","next_round_context":"기다릴지","campaign_finished":false}`;
}

async function startedCampaign(db: Database.Database): Promise<number> {
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
  const deps: TrpgEngineDeps = { skipBilling: true, gmCall: async () => ({ text: gmText() }) };
  await startTrpgCampaign(db, { campaignId, userId: 1, deps });
  return campaignId;
}

describe("TRPG reply suggestion provider failover A-N", () => {
  it("A: CI valid 200 JSON → OR calls = 0", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        return completion(validJson);
      }) as typeof fetch;
      try {
        const result = await executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "req-a",
        });
        assert.equal(result.text, validJson);
        assert.deepEqual(urls, [CI_URL]);
        assert.equal(result.telemetry.provider_attempt_count, 1);
        assert.equal(result.telemetry.fallback_attempted, false);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("B: CI network failure → OR calls = 1", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        if (String(input).includes("cheaperinference")) throw new Error("ECONNRESET");
        return completion(validJson);
      }) as typeof fetch;
      try {
        const result = await executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "req-b",
        });
        assert.equal(result.text, validJson);
        assert.deepEqual(urls, [CI_URL, OR_URL]);
        assert.equal(result.telemetry.provider_attempt_count, 2);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("C: CI timeout → OR calls = 1", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        if (String(input).includes("cheaperinference")) {
          const error = new Error("completion deadline exceeded");
          error.name = "TimeoutError";
          throw error;
        }
        return completion(validJson);
      }) as typeof fetch;
      try {
        const result = await executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "req-c",
        });
        assert.equal(result.text, validJson);
        assert.deepEqual(urls, [CI_URL, OR_URL]);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("D: CI 503 → OR calls = 1", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        if (String(input).includes("cheaperinference")) {
          return new Response("unavailable", { status: 503 });
        }
        return completion(validJson);
      }) as typeof fetch;
      try {
        const result = await executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "req-d",
        });
        assert.equal(result.text, validJson);
        assert.deepEqual(urls, [CI_URL, OR_URL]);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("E: CI 429 → OR calls = 1", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        if (String(input).includes("cheaperinference")) {
          return new Response("rate limited", { status: 429 });
        }
        return completion(validJson);
      }) as typeof fetch;
      try {
        const result = await executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "req-e",
        });
        assert.equal(result.text, validJson);
        assert.deepEqual(urls, [CI_URL, OR_URL]);
        assert.equal(result.telemetry.primary_failure_class, "http_429");
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("F: CI 200 + empty completion → OR calls = 1", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        if (String(input).includes("cheaperinference")) return emptyCompletion();
        return completion(validJson);
      }) as typeof fetch;
      try {
        const result = await executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "req-f",
        });
        assert.equal(result.text, validJson);
        assert.deepEqual(urls, [CI_URL, OR_URL]);
        assert.equal(result.telemetry.semantic_failure_class, "empty_completion");
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("G: CI 200 + malformed JSON not recoverable → OR calls = 1", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        if (String(input).includes("cheaperinference")) return completion("not-json-at-all");
        return completion(validJson);
      }) as typeof fetch;
      try {
        const result = await executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "req-g",
        });
        assert.equal(result.text, validJson);
        assert.deepEqual(urls, [CI_URL, OR_URL]);
        assert.equal(result.telemetry.semantic_failure_class, "malformed_json");
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("H: CI 200 + recoverable imperfect JSON → OR calls = 0", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        return completion(recoverableJson);
      }) as typeof fetch;
      try {
        const result = await executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "req-h",
        });
        assert.equal(result.text, recoverableJson);
        assert.deepEqual(urls, [CI_URL]);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("I: CI invalid suggestions count/schema → OR calls = 1", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const urls: string[] = [];
      const invalidCount = JSON.stringify({
        suggestions: [
          { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
          { stance: "evil", actionType: "persuade", text: "퇴로를 막고 협박한다." },
        ],
      });
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        if (String(input).includes("cheaperinference")) return completion(invalidCount);
        return completion(validJson);
      }) as typeof fetch;
      try {
        const result = await executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "req-i",
        });
        assert.equal(result.text, validJson);
        assert.deepEqual(urls, [CI_URL, OR_URL]);
        assert.equal(result.telemetry.semantic_failure_class, "invalid_suggestion_count");
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("J: CI 400 deterministic request failure → OR calls = 0", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        return new Response("bad request", { status: 400 });
      }) as typeof fetch;
      try {
        await assert.rejects(
          () =>
            executeTrpgReplySuggestionProviderRound({
              system: "sys",
              user: "user",
              logicalRequestId: "req-j",
            }),
          /400/
        );
        assert.deepEqual(urls, [CI_URL]);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("K: CI fails + OR succeeds → one suggestion result, provider attempts = 2", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const models: string[] = [];
      globalThis.fetch = (async (input, init) => {
        const body = JSON.parse(String(init?.body)) as { model?: string };
        models.push(String(body.model));
        if (String(input).includes("cheaperinference")) {
          return new Response("upstream", { status: 502 });
        }
        return completion(validJson);
      }) as typeof fetch;
      try {
        const result = await callTrpgReplySuggestionModel({ system: "sys", user: "user" });
        assert.equal(result.model, OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL);
        assert.deepEqual(models, [
          CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_0731_MODEL,
          OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
        ]);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("L: CI fails + OR fails → stable failure, provider attempts = 2, no automatic retry", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let fetchCalls = 0;
      globalThis.fetch = (async (input) => {
        fetchCalls += 1;
        if (String(input).includes("cheaperinference")) {
          return new Response("upstream", { status: 503 });
        }
        return new Response("backup failed", { status: 502 });
      }) as typeof fetch;
      try {
        await assert.rejects(
          () => callTrpgReplySuggestionModel({ system: "sys", user: "user" }),
          /502/
        );
        assert.equal(fetchCalls, 2);
        await assert.rejects(
          () => callTrpgReplySuggestionModel({ system: "sys", user: "user" }),
          /502/
        );
        assert.equal(fetchCalls, 4, "each logical request makes exactly two provider calls");
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("M: refresh during inflight joins same logical promise → duplicate provider calls = 0", async () => {
    resetTrpgReplySuggestionCooldownForTests();
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    let fetchCalls = 0;
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previousFetch = globalThis.fetch;
    await withKeys(async () => {
      globalThis.fetch = (async (input) => {
        fetchCalls += 1;
        await hold;
        return completion(validJson);
      }) as typeof fetch;
      const first = requestTrpgReplySuggestions(db, { campaignId, userId: 1 });
      const refreshed = requestTrpgReplySuggestions(db, { campaignId, userId: 1 });
      assert.equal(fetchCalls, 1);
      release();
      const [a, b] = await Promise.all([first, refreshed]);
      assert.deepEqual(a.suggestions, b.suggestions);
      assert.equal(fetchCalls, 1);
    });
    globalThis.fetch = previousFetch;
    db.close();
  });

  it("N: failed round polling does not add provider calls until manual retry", async () => {
    resetTrpgReplySuggestionCooldownForTests();
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    let fetchCalls = 0;
    const previousFetch = globalThis.fetch;
    await withKeys(async () => {
      globalThis.fetch = (async (input) => {
        fetchCalls += 1;
        if (String(input).includes("cheaperinference")) {
          return new Response("upstream", { status: 503 });
        }
        return new Response("backup failed", { status: 502 });
      }) as typeof fetch;
      await assert.rejects(
        () => requestTrpgReplySuggestions(db, { campaignId, userId: 1 }),
        /502/
      );
      assert.equal(fetchCalls, 2);
      await assert.rejects(
        () => requestTrpgReplySuggestions(db, { campaignId, userId: 1 }),
        /잠시 후/
      );
      assert.equal(fetchCalls, 2);
    });
    globalThis.fetch = previousFetch;
    db.close();
  });

  it("policy constants: no provider retries within a logical request", () => {
    assert.equal(TRPG_REPLY_SUGGESTION_CI_RETRY_COUNT, 0);
    assert.equal(TRPG_REPLY_SUGGESTION_OR_RETRY_COUNT, 0);
    assert.equal(TRPG_REPLY_SUGGESTION_PROVIDER_ATTEMPTS_MAX, 2);
  });
});
