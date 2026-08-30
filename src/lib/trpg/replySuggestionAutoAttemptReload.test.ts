import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import Database from "better-sqlite3";
import { createTrpgCampaign, saveTrpgSheet, EVEN_STATS } from "./engineCreate";
import { startTrpgCampaign } from "./engineAdvance";
import { ensureTrpgTables } from "./schema";
import {
  TRPG_ACTION_SUGGESTION_ATTEMPT_PREFIX,
  clearTrpgActionSuggestionAttempt,
  loadTrpgActionSuggestionAttempt,
  saveTrpgActionSuggestionAttempt,
  shouldAutoRequestTrpgActionSuggestions,
} from "./displayPrefs";
import {
  TRPG_REPLY_SUGGESTION_USER_ERROR,
  normalizeTrpgReplySuggestionClientError,
  shouldPersistTrpgActionSuggestionAttemptFailed,
} from "./replySuggestionShared";
import {
  callTrpgReplySuggestionModel,
  executeTrpgReplySuggestionProviderRound,
  requestTrpgReplySuggestions,
  resetTrpgReplySuggestionCooldownForTests,
  toTrpgReplySuggestionUserError,
  type TrpgReplySuggestionRouteTelemetry,
} from "./replySuggestions";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const validJson = JSON.stringify({
  suggestions: [
    { stance: "good", actionType: "support", text: "부상자를 뒤로 물린다." },
    { stance: "neutral", actionType: "investigate", text: "경첩부터 살핀다." },
    { stance: "evil", actionType: "persuade", text: "퇴로를 막고 협박한다." },
  ],
});

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

function withLocalStorage<T>(store: MemoryStorage, fn: () => T): T {
  const g = globalThis as typeof globalThis & {
    window?: unknown;
    localStorage?: Storage;
  };
  const prevWindow = g.window;
  const prevStorage = g.localStorage;
  g.window = g;
  g.localStorage = store as unknown as Storage;
  try {
    return fn();
  } finally {
    if (prevWindow === undefined) delete g.window;
    else g.window = prevWindow;
    if (prevStorage === undefined) delete g.localStorage;
    else g.localStorage = prevStorage;
  }
}

function memoryDb(): Database.Database {
  const db = new Database(":memory:");
  ensureTrpgTables(db);
  return db;
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
  await startTrpgCampaign(db, {
    campaignId,
    userId: 1,
    deps: {
      skipBilling: true,
      gmCall: async () => ({
        text: `<<<NARRATION>>>\n폐역\n<<<DELTA>>>\n{"players":[],"location":"폐역","next_round_context":"기다릴지","campaign_finished":false}`,
      }),
    },
  });
  return campaignId;
}

describe("TRPG reply suggestion auto-attempt reload + error sanitization", () => {
  beforeEach(() => {
    resetTrpgReplySuggestionCooldownForTests();
  });

  it("A. auto failure same session — requestedRound suppresses auto re-request", () => {
    assert.equal(
      shouldAutoRequestTrpgActionSuggestions({
        enabled: true,
        phase: "ACTION_INPUT",
        hasDraft: true,
        locked: false,
        requestedRound: 3,
        roundNumber: 3,
      }),
      false
    );
  });

  it("B. auto failure + reload — failed marker blocks automatic provider request", () => {
    const store = new MemoryStorage();
    withLocalStorage(store, () => {
      saveTrpgActionSuggestionAttempt(42, 3, "failed");
      assert.equal(loadTrpgActionSuggestionAttempt(42, 3), "failed");
      assert.equal(
        shouldAutoRequestTrpgActionSuggestions({
          enabled: true,
          phase: "ACTION_INPUT",
          hasDraft: true,
          locked: false,
          requestedRound: null,
          roundNumber: 3,
          autoAttemptFailed: true,
        }),
        false
      );
      assert.match(store.getItem(`${TRPG_ACTION_SUGGESTION_ATTEMPT_PREFIX}42`) ?? "", /"state":"failed"/);
    });
  });

  it("C. manual retry after reload — pending marker allows one logical request", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    let providerCalls = 0;
    await assert.rejects(
      () =>
        requestTrpgReplySuggestions(db, {
          campaignId,
          userId: 1,
          complete: async () => {
            providerCalls += 1;
            throw new Error("completion deadline exceeded");
          },
        }),
      /다시 시도/
    );
    resetTrpgReplySuggestionCooldownForTests();
    const retried = await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => {
        providerCalls += 1;
        return { text: validJson, model: "deepseek-v4-flash-0731" };
      },
    });
    assert.equal(providerCalls, 2);
    assert.equal(retried.suggestions.length, 3);
    db.close();
  });

  it("D. success clears attempt marker owner in favor of result cache", () => {
    const store = new MemoryStorage();
    withLocalStorage(store, () => {
      saveTrpgActionSuggestionAttempt(7, 2, "pending");
      clearTrpgActionSuggestionAttempt(7);
      assert.equal(loadTrpgActionSuggestionAttempt(7, 2), null);
    });
  });

  it("K1. definitive server failure — non-2xx persists failed marker eligibility", () => {
    assert.equal(shouldPersistTrpgActionSuggestionAttemptFailed(new Response(null, { status: 400 })), true);
    assert.equal(
      shouldPersistTrpgActionSuggestionAttemptFailed(
        new Response(JSON.stringify({ error: TRPG_REPLY_SUGGESTION_USER_ERROR }), { status: 400 })
      ),
      true
    );
  });

  it("K2. network / abort / timeout — ambiguous transport keeps pending (no failed marker)", () => {
    assert.equal(shouldPersistTrpgActionSuggestionAttemptFailed(null), false);
    assert.equal(
      shouldPersistTrpgActionSuggestionAttemptFailed(new Response(JSON.stringify({ ok: true }), { status: 200 })),
      false
    );
  });

  it("K3. server success + response lost — pending marker, reload durable DB recovery, provider 0", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    let providerCalls = 0;
    const first = await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => {
        providerCalls += 1;
        return { text: validJson, model: "deepseek-v4-flash-0731" };
      },
    });
    assert.equal(providerCalls, 1);
    assert.equal(first.suggestions.length, 3);

    const store = new MemoryStorage();
    withLocalStorage(store, () => {
      saveTrpgActionSuggestionAttempt(campaignId, 1, "pending");
      assert.equal(loadTrpgActionSuggestionAttempt(campaignId, 1), "pending");
      assert.notEqual(loadTrpgActionSuggestionAttempt(campaignId, 1), "failed");
    });

    resetTrpgReplySuggestionCooldownForTests();
    providerCalls = 0;
    const recovered = await requestTrpgReplySuggestions(db, {
      campaignId,
      userId: 1,
      complete: async () => {
        providerCalls += 1;
        return { text: validJson, model: "deepseek-v4-flash-0731" };
      },
    });
    assert.equal(providerCalls, 0);
    assert.deepEqual(
      recovered.suggestions.map((row) => row.text),
      first.suggestions.map((row) => row.text)
    );
    db.close();
  });

  it("K4. pending reload after ambiguous failure can still reach definitive server failure", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    const store = new MemoryStorage();
    withLocalStorage(store, () => {
      saveTrpgActionSuggestionAttempt(campaignId, 1, "pending");
    });
    let providerCalls = 0;
    await assert.rejects(
      () =>
        requestTrpgReplySuggestions(db, {
          campaignId,
          userId: 1,
          complete: async () => {
            providerCalls += 1;
            throw new Error("completion deadline exceeded");
          },
        }),
      /다시 시도/
    );
    assert.equal(providerCalls, 1);
    db.close();
  });

  it("K5. concurrent telemetry isolation — route logs never borrow another request telemetry", async () => {
    const db = memoryDb();
    const campaignA = await startedCampaign(db);
    const campaignB = createTrpgCampaign(db, {
      hostUserId: 2,
      hostNickname: "이안",
      viewerUserId: 2,
      hostPersona: {
        personaId: 10,
        name: "이안",
        description: "조용하다.",
        gender: "other",
        speechExamples: "…",
      },
    });
    saveTrpgSheet(db, { campaignId: campaignB, userId: 2, name: "이안", stats: EVEN_STATS });
    await startTrpgCampaign(db, {
      campaignId: campaignB,
      userId: 2,
      deps: {
        skipBilling: true,
        gmCall: async () => ({
          text: `<<<NARRATION>>>\n항구\n<<<DELTA>>>\n{"players":[],"location":"항구","next_round_context":"출항","campaign_finished":false}`,
        }),
      },
    });
    assert.notEqual(campaignA, campaignB);

    const routeLogs: Array<Record<string, unknown>> = [];
    const prevInfo = console.info;
    console.info = ((label: unknown, payload: Record<string, unknown>) => {
      if (label === "[trpg-reply-suggestion]" && payload.kind === "trpg_reply_suggestion_route") {
        routeLogs.push(payload);
      }
    }) as typeof console.info;

    const makeTelemetry = (logicalRequestId: string) => ({
      logical_request_id: logicalRequestId,
      round_id: 1,
      primary_provider: "cheaperinference",
      primary_model: "gpt-5.6-luna",
      primary_status: null,
      primary_latency_ms: 100,
      primary_failure_class: "body_timeout",
      semantic_failure_class: null,
      fallback_attempted: true,
      fallback_provider: "openrouter",
      fallback_model: "google/gemini-3.1-flash-lite",
      fallback_latency_ms: 50,
      fallback_success: false,
      backup_failure_class: "body_timeout",
      provider_attempt_count: 2,
    });

    try {
      await Promise.allSettled([
        requestTrpgReplySuggestions(db, {
          campaignId: campaignA,
          userId: 1,
          complete: async () => {
            throw Object.assign(new Error("provider fail A"), {
              telemetry: makeTelemetry("req-a"),
            });
          },
        }),
        requestTrpgReplySuggestions(db, {
          campaignId: campaignB,
          userId: 2,
          complete: async () => {
            throw Object.assign(new Error("provider fail B"), {
              telemetry: makeTelemetry("req-b"),
            });
          },
        }),
      ]);

      const failures = routeLogs.filter(
        (log) => log.success === false && log.cache_source === "provider"
      );
      assert.equal(failures.length, 2);
      const ids = failures.map((log) => log.logical_request_id).sort();
      assert.deepEqual(ids, ["req-a", "req-b"]);
    } finally {
      console.info = prevInfo;
      db.close();
    }
  });

  it("K6. global last telemetry fallback absent from source", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "replySuggestions.ts"), "utf8");
    assert.doesNotMatch(source, /lastLoggedReplySuggestionProviderTelemetry/);
    assert.doesNotMatch(source, /peekLastReplySuggestionProviderTelemetryForRoute/);
  });

  it("E. pending reload recovery — one API logical request joins inflight without duplicate provider", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    let providerCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const complete = async () => {
      providerCalls += 1;
      await gate;
      return { text: validJson, model: "deepseek-v4-flash-0731" };
    };
    const first = requestTrpgReplySuggestions(db, { campaignId, userId: 1, complete });
    await new Promise((r) => setTimeout(r, 20));
    const second = requestTrpgReplySuggestions(db, { campaignId, userId: 1, complete });
    release();
    await Promise.all([first, second]);
    assert.equal(providerCalls, 1);
    db.close();
  });

  it("F. new round — previous failed marker does not block auto request", () => {
    const store = new MemoryStorage();
    withLocalStorage(store, () => {
      saveTrpgActionSuggestionAttempt(9, 2, "failed");
      assert.equal(loadTrpgActionSuggestionAttempt(9, 3), null);
      assert.equal(
        shouldAutoRequestTrpgActionSuggestions({
          enabled: true,
          phase: "ACTION_INPUT",
          hasDraft: true,
          locked: false,
          requestedRound: null,
          roundNumber: 3,
        }),
        true
      );
    });
  });

  it("G. raw timeout sanitization — provider deadline strings never reach user response", () => {
    for (const raw of [
      "completion deadline exceeded",
      "body completion deadline exceeded",
      "headers deadline exceeded",
    ]) {
      assert.equal(normalizeTrpgReplySuggestionClientError(new Error(raw)), TRPG_REPLY_SUGGESTION_USER_ERROR);
      assert.equal(toTrpgReplySuggestionUserError(new Error(raw)).message, TRPG_REPLY_SUGGESTION_USER_ERROR);
    }
    assert.equal(
      normalizeTrpgReplySuggestionClientError(new Error("캠페인을 찾을 수 없습니다.")),
      "캠페인을 찾을 수 없습니다."
    );
  });

  it("H. primary timeout → backup success failover preserved", async () => {
    const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
    const previousOr = process.env.OPENROUTER_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-ci";
    process.env.OPENROUTER_API_KEY = "test-or";
    const previousFetch = globalThis.fetch;
    let calls = 0;
    try {
      globalThis.fetch = (async (input) => {
        calls += 1;
        if (String(input).includes("cheaperinference")) {
          throw Object.assign(new Error("body completion deadline exceeded"), { trigger: "body_timeout" });
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: validJson }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200 }
        );
      }) as typeof fetch;
      const result = await executeTrpgReplySuggestionProviderRound({
        system: "sys",
        user: "user",
        logicalRequestId: "reload-h",
      });
      assert.equal(calls, 2);
      assert.equal(result.telemetry.fallback_attempted, true);
      assert.equal(result.telemetry.fallback_success, true);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousCi == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
      if (previousOr == null) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOr;
    }
  });

  it("I. primary + backup timeout — user sees only product error", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    await assert.rejects(
      () =>
        requestTrpgReplySuggestions(db, {
          campaignId,
          userId: 1,
          complete: async () => {
            throw new Error("completion deadline exceeded");
          },
        }),
      (error: unknown) =>
        error instanceof Error && error.message === TRPG_REPLY_SUGGESTION_USER_ERROR
    );
    db.close();
  });

  it("J. failure telemetry — thrown provider round still records timing + attempts", async () => {
    const db = memoryDb();
    const campaignId = await startedCampaign(db);
    const routeLogs: TrpgReplySuggestionRouteTelemetry[] = [];
    const providerLogs: Record<string, unknown>[] = [];
    const prevInfo = console.info;
    console.info = ((label: unknown, payload: Record<string, unknown>) => {
      if (label === "[trpg-reply-suggestion-provider]") providerLogs.push(payload);
      if (label === "[trpg-reply-suggestion]" && payload.kind === "trpg_reply_suggestion_route") {
        routeLogs.push(payload as TrpgReplySuggestionRouteTelemetry);
      }
    }) as typeof console.info;
    const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
    const previousOr = process.env.OPENROUTER_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-ci";
    process.env.OPENROUTER_API_KEY = "test-or";
    const previousFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        throw Object.assign(new Error("completion deadline exceeded"), { trigger: "body_timeout" });
      }) as typeof fetch;
      await assert.rejects(
        () => requestTrpgReplySuggestions(db, { campaignId, userId: 1 }),
        /다시 시도/
      );
      const providerFailure = providerLogs.find(
        (row) => row.provider_attempt_count === 2 && row.fallback_attempted === true
      );
      assert.ok(providerFailure, "expected provider failure telemetry");
      assert.equal(providerFailure?.primary_failure_class, "body_timeout");
      assert.equal(providerFailure?.backup_failure_class, "body_timeout");
      const routeFailure = routeLogs.find(
        (log) => log.success === false && log.cache_source === "provider"
      ) as
        | (TrpgReplySuggestionRouteTelemetry & {
            provider_attempt_count?: number;
            fallback_attempted?: boolean;
            primary_failure_class?: string | null;
            backup_failure_class?: string | null;
          })
        | undefined;
      assert.ok(routeFailure, "expected provider failure route log");
      // Route logs flatten provider fields at the top level (see logTrpgReplySuggestionRouteTelemetry).
      assert.equal(routeFailure?.provider_attempt_count, 2);
      assert.equal(routeFailure?.fallback_attempted, true);
      assert.equal(routeFailure?.primary_failure_class, "body_timeout");
      assert.equal(routeFailure?.backup_failure_class, "body_timeout");
    } finally {
      console.info = prevInfo;
      globalThis.fetch = previousFetch;
      if (previousCi == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
      if (previousOr == null) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOr;
      db.close();
    }
  });

  it("callTrpgReplySuggestionModel invokes onProviderTelemetry when provider round throws", async () => {
    const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
    const previousOr = process.env.OPENROUTER_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-ci";
    process.env.OPENROUTER_API_KEY = "test-or";
    const previousFetch = globalThis.fetch;
    let captured: unknown = null;
    try {
      globalThis.fetch = (async () => {
        throw Object.assign(new Error("completion deadline exceeded"), { trigger: "body_timeout" });
      }) as typeof fetch;
      await assert.rejects(
        () =>
          callTrpgReplySuggestionModel({
            system: "sys",
            user: "user",
            onProviderTelemetry: (telemetry) => {
              captured = telemetry;
            },
          }),
        /completion deadline exceeded|\[TRPG reply\]/
      );
      assert.ok(captured);
      assert.equal((captured as { provider_attempt_count?: number }).provider_attempt_count, 2);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousCi == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
      if (previousOr == null) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOr;
    }
  });
});
