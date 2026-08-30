import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  OPENROUTER_GEMINI_31_FLASH_MODEL,
} from "@/lib/chatModels";
import { adaptCheaperInferenceChatBody } from "@/lib/cheaperInferenceConfig";
import {
  adaptTrpgReplySuggestionChatBody,
  buildReplySuggestionPublicContext,
  executeTrpgReplySuggestionProviderRound,
  requestTrpgReplySuggestions,
  resetTrpgReplySuggestionCooldownForTests,
  toTrpgReplySuggestionUserError,
  TRPG_REPLY_SUGGESTION_BACKUP_COMPLETION_MS,
  TRPG_REPLY_SUGGESTION_BACKUP_PROVIDER,
  TRPG_REPLY_SUGGESTION_MAX_TOKENS,
  TRPG_REPLY_SUGGESTION_PRIMARY_COMPLETION_MS,
  TRPG_REPLY_SUGGESTION_PRIMARY_PROVIDER,
  TRPG_REPLY_SUGGESTION_PROVIDER_ATTEMPTS_MAX,
  TRPG_REPLY_SUGGESTION_USER_ERROR,
  resolveTrpgReplySuggestionProviderDeadlines,
} from "./replySuggestions";
import { TRPG_SCENARIO_DRAFT_MODEL } from "./scenarioDraft";
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

function completion(text: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
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

function delayedCompletion(text: string, delayMs: number): Promise<Response> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(completion(text)), delayMs);
  });
}

describe("TRPG reply suggestion provider priority A-H", () => {
  it("A: CheaperInference Luna valid → one provider attempt → success", async () => {
    await withKeys(async () => {
      let fetchCalls = 0;
      const previousFetch = globalThis.fetch;
      globalThis.fetch = (async (input) => {
        fetchCalls += 1;
        assert.match(String(input), /cheaperinference/);
        return delayedCompletion(validJson, 4_800);
      }) as typeof fetch;
      try {
        const result = await executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "priority-a",
          hooks: { now: Date.now },
        });
        assert.equal(fetchCalls, 1);
        assert.equal(result.telemetry.provider_attempt_count, 1);
        assert.equal(result.telemetry.primary_provider, TRPG_REPLY_SUGGESTION_PRIMARY_PROVIDER);
        assert.equal(result.telemetry.fallback_attempted, false);
        assert.equal(result.model, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("B: Luna transport/body failure → OpenRouter DeepSeek attempted once → max attempts = 2", async () => {
    await withKeys(async () => {
      const urls: string[] = [];
      const previousFetch = globalThis.fetch;
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        if (String(input).includes("cheaperinference")) {
          throw Object.assign(new Error("body completion deadline exceeded"), {
            trigger: "body_timeout",
            httpStatus: 200,
          });
        }
        return completion(validJson);
      }) as typeof fetch;
      try {
        const result = await executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "priority-b",
        });
        assert.deepEqual(urls, [CI_URL, OR_URL]);
        assert.equal(result.telemetry.provider_attempt_count, 2);
        assert.equal(result.telemetry.fallback_provider, TRPG_REPLY_SUGGESTION_BACKUP_PROVIDER);
        assert.equal(result.model, OPENROUTER_GEMINI_31_FLASH_MODEL);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("C: Luna semantic malformed_json → OpenRouter fallback once", async () => {
    await withKeys(async () => {
      const urls: string[] = [];
      const previousFetch = globalThis.fetch;
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        if (String(input).includes("cheaperinference")) return completion("{bad-json");
        return completion(validJson);
      }) as typeof fetch;
      try {
        const result = await executeTrpgReplySuggestionProviderRound({
          system: "sys",
          user: "user",
          logicalRequestId: "priority-c",
        });
        assert.deepEqual(urls, [CI_URL, OR_URL]);
        assert.equal(result.telemetry.primary_failure_class, "malformed_json");
        assert.equal(result.telemetry.fallback_success, true);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("D: both fail → sanitized user-facing error and detailed server telemetry preserved", async () => {
    resetTrpgReplySuggestionCooldownForTests();
    const db = new Database(":memory:");
    ensureTrpgTables(db);
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
      gmCall: async () => ({
        text: `<<<NARRATION>>>\n폐역\n<<<DELTA>>>\n{"players":[],"location":"폐역","next_round_context":"기다릴지","campaign_finished":false}`,
      }),
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });

    const providerLogs: Record<string, unknown>[] = [];
    const usageLogs: Record<string, unknown>[] = [];
    const prevInfo = console.info;
    console.info = ((label: unknown, payload: Record<string, unknown>) => {
      if (label === "[trpg-reply-suggestion-provider]") providerLogs.push(payload);
      if (label === "[trpg-reply-suggestion]" && payload.kind === "trpg_reply_suggestion") {
        usageLogs.push(payload);
      }
    }) as typeof console.info;

    const previousFetch = globalThis.fetch;
    await withKeys(async () => {
      globalThis.fetch = (async () => {
        throw Object.assign(new Error("body completion deadline exceeded"), {
          trigger: "body_timeout",
        });
      }) as typeof fetch;
      await assert.rejects(
        () => requestTrpgReplySuggestions(db, { campaignId, userId: 1 }),
        (error: unknown) =>
          error instanceof Error && error.message === TRPG_REPLY_SUGGESTION_USER_ERROR
      );
      assert.equal(toTrpgReplySuggestionUserError(new Error("body completion deadline exceeded")).message, TRPG_REPLY_SUGGESTION_USER_ERROR);
      assert.equal(providerLogs.length, 1);
      assert.equal(providerLogs[0]?.primary_provider, TRPG_REPLY_SUGGESTION_PRIMARY_PROVIDER);
      assert.equal(providerLogs[0]?.provider_attempt_count, 2);
      assert.equal(usageLogs.at(-1)?.success, false);
      assert.match(String(usageLogs.at(-1)?.error), /body completion deadline exceeded/);
    });
    console.info = prevInfo;
    globalThis.fetch = previousFetch;
    db.close();
  });

  it("E: Luna response_format / reasoning-off / schema unchanged", () => {
    const lunaBody = adaptCheaperInferenceChatBody({
      model: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      messages: [{ role: "user", content: "x" }],
      stream: false,
      temperature: 0.7,
      max_tokens: TRPG_REPLY_SUGGESTION_MAX_TOKENS,
      response_format: { type: "json_object" },
    });
    assert.equal(lunaBody.max_tokens, TRPG_REPLY_SUGGESTION_MAX_TOKENS);
    assert.deepEqual(lunaBody.response_format, { type: "json_object" });
    assert.deepEqual(lunaBody.reasoning, { effort: "none" });
    assert.equal(lunaBody.reasoning_effort, "none");
    assert.notDeepEqual(lunaBody.thinking, { type: "disabled" });
    assert.equal("thinking" in lunaBody, false);
    assert.equal(lunaBody.temperature, 0.7);

    const deepSeekAdapter = adaptTrpgReplySuggestionChatBody({
      model: TRPG_SCENARIO_DRAFT_MODEL,
      messages: [{ role: "user", content: "x" }],
      stream: false,
      temperature: 0.7,
      max_tokens: TRPG_REPLY_SUGGESTION_MAX_TOKENS,
      response_format: { type: "json_object" },
      thinking: { type: "enabled" },
      reasoning_effort: "high",
    });
    assert.deepEqual(deepSeekAdapter.thinking, { type: "disabled" });
    assert.equal(deepSeekAdapter.reasoning_effort, "none");

    const prompt = buildReplySuggestionPublicContext({
      scene: "SCENE_MARK",
      persona: { name: "P", description: "PERSONA", speechExamples: "SPEECH" },
      recentActions: [],
      self: null,
      party: [],
    });
    assert.match(prompt.system, /Return exactly 3 suggestions/);
    assert.match(prompt.system, /JSON only/);
  });

  it("F: GM and scenario-draft routing unchanged", () => {
    const gm = fs.readFileSync("src/lib/trpg/gmCall.ts", "utf8");
    const scenarioDraft = fs.readFileSync("src/lib/trpg/scenarioDraft.ts", "utf8");
    assert.doesNotMatch(gm, /executeTrpgReplySuggestionProviderRound/);
    assert.doesNotMatch(scenarioDraft, /executeTrpgReplySuggestionProviderRound/);
    assert.doesNotMatch(gm, /TRPG_REPLY_SUGGESTION_PRIMARY_PROVIDER/);
    assert.doesNotMatch(scenarioDraft, /TRPG_REPLY_SUGGESTION_PRIMARY_PROVIDER/);
  });

  it("policy: CI Luna primary 10s / OpenRouter DeepSeek fallback 30s / max attempts 2", () => {
    const deadlines = resolveTrpgReplySuggestionProviderDeadlines();
    assert.equal(deadlines.primaryCompletionMs, TRPG_REPLY_SUGGESTION_PRIMARY_COMPLETION_MS);
    assert.equal(deadlines.backupCompletionMs, TRPG_REPLY_SUGGESTION_BACKUP_COMPLETION_MS);
    assert.equal(deadlines.primaryCompletionMs, 10_000);
    assert.equal(deadlines.backupCompletionMs, 30_000);
    assert.equal(TRPG_REPLY_SUGGESTION_PROVIDER_ATTEMPTS_MAX, 2);
  });

  it("G: CheaperInference key unavailable → no CI call → OpenRouter once → success", async () => {
    const previousOr = process.env.OPENROUTER_API_KEY;
    const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
    delete process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-or";
    const urls: string[] = [];
    const previousFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        return completion(validJson);
      }) as typeof fetch;
      const result = await executeTrpgReplySuggestionProviderRound({
        system: "sys",
        user: "user",
        logicalRequestId: "priority-g",
      });
      assert.equal(urls.length, 1);
      assert.match(urls[0]!, /openrouter/);
      assert.doesNotMatch(urls.join(","), /cheaperinference/);
      assert.equal(result.telemetry.provider_attempt_count, 2);
      assert.equal(result.telemetry.primary_failure_class, "no_api_key");
      assert.equal(result.telemetry.fallback_attempted, true);
      assert.equal(result.telemetry.fallback_success, true);
      assert.equal(result.model, OPENROUTER_GEMINI_31_FLASH_MODEL);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousOr == null) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOr;
      if (previousCi == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
    }
  });

  it("H: CI unavailable + OpenRouter fails → sanitized user error, internal detail in telemetry only", async () => {
    resetTrpgReplySuggestionCooldownForTests();
    const db = new Database(":memory:");
    ensureTrpgTables(db);
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
      gmCall: async () => ({
        text: `<<<NARRATION>>>\n폐역\n<<<DELTA>>>\n{"players":[],"location":"폐역","next_round_context":"기다릴지","campaign_finished":false}`,
      }),
    };
    await startTrpgCampaign(db, { campaignId, userId: 1, deps });

    const providerLogs: Record<string, unknown>[] = [];
    const usageLogs: Record<string, unknown>[] = [];
    const prevInfo = console.info;
    console.info = ((label: unknown, payload: Record<string, unknown>) => {
      if (label === "[trpg-reply-suggestion-provider]") providerLogs.push(payload);
      if (label === "[trpg-reply-suggestion]" && payload.kind === "trpg_reply_suggestion") {
        usageLogs.push(payload);
      }
    }) as typeof console.info;

    const previousOr = process.env.OPENROUTER_API_KEY;
    const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
    const previousFetch = globalThis.fetch;
    delete process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-or";
    try {
      globalThis.fetch = (async (input) => {
        assert.match(String(input), /openrouter/);
        return new Response("backup failed", { status: 502 });
      }) as typeof fetch;
      await assert.rejects(
        () => requestTrpgReplySuggestions(db, { campaignId, userId: 1 }),
        (error: unknown) =>
          error instanceof Error && error.message === TRPG_REPLY_SUGGESTION_USER_ERROR
      );
      assert.equal(providerLogs.length, 1);
      assert.equal(providerLogs[0]?.primary_failure_class, "no_api_key");
      assert.equal(providerLogs[0]?.provider_attempt_count, 2);
      assert.equal(providerLogs[0]?.fallback_success, false);
      assert.match(String(providerLogs[0]?.backup_failure_class), /http_502/);
      assert.equal(usageLogs.at(-1)?.success, false);
      assert.match(String(usageLogs.at(-1)?.error), /502|backup failed|\[TRPG reply\]/);
      assert.doesNotMatch(String(usageLogs.at(-1)?.error), /NO_CHEAPER_INFERENCE_KEY/);
    } finally {
      console.info = prevInfo;
      globalThis.fetch = previousFetch;
      if (previousOr == null) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOr;
      if (previousCi == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
      db.close();
    }
  });
});
