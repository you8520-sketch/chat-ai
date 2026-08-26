import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  callBackgroundMemory,
  callPromptTranslation,
} from "./ai";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
} from "./chatModels";
import {
  BACKGROUND_BACKUP_COMPLETION_MS,
  BACKGROUND_PRIMARY_COMPLETION_MS,
  DEEPSEEK_TRANSIENT_HTTP_STATUSES,
  DEEPSEEK_TRANSIENT_NETWORK_CLASSES,
  DeepSeekProviderFailoverError,
  executeDeepSeekBackgroundWithProviderFailover,
  resolveBackgroundFlashProviderDeadlines,
} from "./deepseekProviderFailover";
import { extractJsonObjectFromWidgetText } from "./statusWidget/extractNormalize";
import { parseSegmentedResponse } from "./promptTranslation";

const CI_URL = "https://api.cheaperinference.com/v1/chat/completions";
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";
const encoder = new TextEncoder();

function completion(text: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: text }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

function hangingBodyAfterHeaders(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start() {
        /* headers only — body never completes */
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function bodySocketCloseAfterHeaders(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"choices":[{"message":{"content":"par'));
        controller.error(new Error("UND_ERR_SOCKET"));
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
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

function flashPrimary(bodyExtra?: Record<string, unknown>) {
  return {
    endpoint: CI_URL,
    headers: { Authorization: "Bearer ci" },
    body: {
      model: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
      messages: [{ role: "user", content: "x" }],
      ...bodyExtra,
    },
  };
}

describe("background complete-body ownership", () => {
  it("policy: memory extract uses longForm 45s/45s; short tasks 20s/30s; TRPG reply unchanged", () => {
    assert.deepEqual(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: "background-memory-extract",
      }),
      {
        primaryCompletionMs: BACKGROUND_PRIMARY_COMPLETION_MS.longForm,
        backupCompletionMs: BACKGROUND_BACKUP_COMPLETION_MS.longForm,
      }
    );
    assert.deepEqual(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: "background-memory-extract-retry",
      }),
      {
        primaryCompletionMs: BACKGROUND_PRIMARY_COMPLETION_MS.longForm,
        backupCompletionMs: BACKGROUND_BACKUP_COMPLETION_MS.longForm,
      }
    );
    for (const requestKind of [
      "background-memory-rolling-summary",
      "background-memory-episodic",
      "background-lorebook-compact",
      "background-status-widget-extract",
      "background-status-meta-extract",
      "background-prompt-translation",
      "background-chat-image-scene-brief",
      "background-suggested-replies-extract",
    ]) {
      assert.deepEqual(
        resolveBackgroundFlashProviderDeadlines({ requestKind }),
        {
          primaryCompletionMs: BACKGROUND_PRIMARY_COMPLETION_MS.short,
          backupCompletionMs: BACKGROUND_BACKUP_COMPLETION_MS.short,
        },
        requestKind
      );
    }
    assert.deepEqual(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: "trpg-reply-suggestions",
        existingTimeoutMs: 45_000,
      }),
      { primaryCompletionMs: 15_000, backupCompletionMs: 25_000 }
    );
    assert.deepEqual(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: "trpg-mechanics-referee",
        existingTimeoutMs: 20_000,
      }),
      { primaryCompletionMs: 20_000, backupCompletionMs: 20_000 }
    );
    assert.deepEqual(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: "background-html-visual-card",
        existingTimeoutMs: 240_000,
      }),
      { primaryCompletionMs: 45_000, backupCompletionMs: 45_000 }
    );
    assert.deepEqual(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: "trpg-scenario-draft",
        existingTimeoutMs: 120_000,
      }),
      { primaryCompletionMs: 45_000, backupCompletionMs: 45_000 }
    );
    assert.equal(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: "background-memory-extract",
        existingTimeoutMs: 40,
      }).primaryCompletionMs,
      40
    );
    assert.ok(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: "background-memory-extract",
      }).primaryCompletionMs <
        120_000,
      "failover completion deadline still caps below generic OpenRouter 120s"
    );
    assert.ok(
      resolveBackgroundFlashProviderDeadlines({
        requestKind: "background-memory-extract",
      }).primaryCompletionMs >
        BACKGROUND_PRIMARY_COMPLETION_MS.short,
      "memory extract no longer uses short 20s primary deadline"
    );
    assert.deepEqual([...DEEPSEEK_TRANSIENT_HTTP_STATUSES], [500, 502, 503, 504]);
    assert.deepEqual(
      [...DEEPSEEK_TRANSIENT_NETWORK_CLASSES],
      [
        "UND_ERR_SOCKET",
        "ECONNRESET",
        "ETIMEDOUT",
        "socket hang up",
        "fetch failed",
        "EAI_AGAIN",
        "ENOTFOUND",
      ]
    );
  });

  it("NB1 primary HTTP200 headers then body socket close → OpenRouter exactly once", async () => {
    await withKeys(async () => {
      const urls: string[] = [];
      const result = await executeDeepSeekBackgroundWithProviderFailover({
        primary: flashPrimary(),
        timeoutMs: 80,
        requestKind: "background-memory-extract",
        hooks: {
          fetchFn: (async (input) => {
            urls.push(String(input));
            if (String(input) === CI_URL) return bodySocketCloseAfterHeaders();
            return completion('{"ok":true}');
          }) as typeof fetch,
        },
      });
      assert.deepEqual(urls, [CI_URL, OR_URL]);
      assert.equal(result.usedProvider, "openrouter");
      assert.equal(result.telemetry.provider_attempt_count, 2);
      assert.equal(result.telemetry.primary_http_status, 200);
      assert.equal(await result.response.text().then((text) => text.includes("ok")), true);
    });
  });

  it("NB2 primary HTTP200 headers then body hang → primary aborted → OpenRouter exactly once", async () => {
    await withKeys(async () => {
      const urls: string[] = [];
      const result = await executeDeepSeekBackgroundWithProviderFailover({
        primary: flashPrimary(),
        timeoutMs: 40,
        requestKind: "background-memory-extract",
        hooks: {
          fetchFn: (async (input) => {
            urls.push(String(input));
            if (String(input) === CI_URL) return hangingBodyAfterHeaders();
            return completion("backup-body");
          }) as typeof fetch,
        },
      });
      assert.deepEqual(urls, [CI_URL, OR_URL]);
      assert.equal(result.usedProvider, "openrouter");
      assert.equal(result.telemetry.failover_trigger, "body_timeout");
      assert.equal(result.telemetry.provider_attempt_count, 2);
      assert.equal(await result.response.text().then((text) => text.includes("backup-body")), true);
    });
  });

  it("NB3 primary full body completes at 19s → OpenRouter 0", async () => {
    await withKeys(async () => {
      let nowMs = 0;
      const urls: string[] = [];
      const result = await executeDeepSeekBackgroundWithProviderFailover({
        primary: flashPrimary(),
        timeoutMs: 20_000,
        requestKind: "background-memory-extract",
        deadlines: { completionMs: 20_000, backupCompletionMs: 30_000 },
        hooks: {
          now: () => nowMs,
          fetchFn: (async (input) => {
            urls.push(String(input));
            nowMs = 19_000;
            return completion("on-time");
          }) as typeof fetch,
        },
      });
      assert.deepEqual(urls, [CI_URL]);
      assert.equal(result.usedProvider, "cheaperinference");
      assert.equal(result.telemetry.provider_attempt_count, 1);
      assert.equal(result.telemetry.failover_trigger, null);
      assert.equal(await result.response.text().then((text) => text.includes("on-time")), true);
    });
  });

  it("NB4 OpenRouter headers then backup body socket close → no third provider", async () => {
    await withKeys(async () => {
      let calls = 0;
      await assert.rejects(
        () =>
          executeDeepSeekBackgroundWithProviderFailover({
            primary: flashPrimary(),
            timeoutMs: 80,
            requestKind: "background-memory-extract",
            hooks: {
              fetchFn: (async (input) => {
                calls += 1;
                if (String(input) === CI_URL) return bodySocketCloseAfterHeaders();
                return bodySocketCloseAfterHeaders();
              }) as typeof fetch,
            },
          }),
        (error: unknown) => {
          assert.ok(error instanceof DeepSeekProviderFailoverError);
          assert.equal(error.providerAttemptCount, 2);
          assert.equal(error.telemetry.backup_success, false);
          return true;
        }
      );
      assert.equal(calls, 2);
    });
  });

  it("NB5 OpenRouter complete-body deadline exceeded → no third provider", async () => {
    await withKeys(async () => {
      let calls = 0;
      await assert.rejects(
        () =>
          executeDeepSeekBackgroundWithProviderFailover({
            primary: flashPrimary(),
            timeoutMs: 40,
            requestKind: "background-memory-extract",
            hooks: {
              fetchFn: (async (input) => {
                calls += 1;
                if (String(input) === CI_URL) return bodySocketCloseAfterHeaders();
                return hangingBodyAfterHeaders();
              }) as typeof fetch,
            },
          }),
        (error: unknown) => {
          assert.ok(error instanceof DeepSeekProviderFailoverError);
          assert.equal(error.providerAttemptCount, 2);
          assert.equal(error.telemetry.backup_success, false);
          return true;
        }
      );
      assert.equal(calls, 2);
    });
  });

  it("NB6 memory primary body failure after HTTP200 → OR succeeds → memory commit 1", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const models: string[] = [];
      let commits = 0;
      globalThis.fetch = (async (input, init) => {
        const body = JSON.parse(String(init?.body)) as { model?: string };
        models.push(String(body.model));
        if (String(input).includes("cheaperinference")) {
          return bodySocketCloseAfterHeaders();
        }
        return completion('{"turnSummary":"복구","items":[]}');
      }) as typeof fetch;
      try {
        const result = await callBackgroundMemory(
          "system",
          [{ role: "user", content: "기억" }],
          undefined,
          "background-memory-extract"
        );
        commits += 1;
        assert.equal(result.text.includes("복구"), true);
        assert.deepEqual(models, [
          CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
          OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
        ]);
        assert.equal(commits, 1);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("NB7 translation primary body failure after HTTP200 → OR succeeds → character save 1", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const models: string[] = [];
      let saveCommits = 0;
      globalThis.fetch = (async (input, init) => {
        const body = JSON.parse(String(init?.body)) as { model?: string };
        models.push(String(body.model));
        if (String(input).includes("cheaperinference")) {
          return bodySocketCloseAfterHeaders();
        }
        return completion("⟦SEG 1⟧\nEnglish setting\n⟦/SEG 1⟧");
      }) as typeof fetch;
      try {
        const result = await callPromptTranslation(
          "translate",
          [{ role: "user", content: "⟦SEG 1⟧\n한국어\n⟦/SEG 1⟧" }],
          CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
        );
        const parsed = parseSegmentedResponse(result.text, 1);
        saveCommits += 1;
        assert.deepEqual(parsed, ["English setting"]);
        assert.deepEqual(models, [
          CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
          OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
        ]);
        assert.equal(saveCommits, 1);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("NB8 status primary body failure after HTTP200 → OR succeeds → parser gets one complete response", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let calls = 0;
      let parsedBodies = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        if (calls === 1) return bodySocketCloseAfterHeaders();
        parsedBodies += 1;
        return completion('{"hp":"12","mood":"긴장"}');
      }) as typeof fetch;
      try {
        const result = await callBackgroundMemory(
          "status",
          [{ role: "user", content: "상태" }],
          undefined,
          "background-status-widget-extract"
        );
        const parsed = extractJsonObjectFromWidgetText(result.text);
        assert.deepEqual(parsed, { hp: "12", mood: "긴장" });
        assert.equal(calls, 2);
        assert.equal(parsedBodies, 1);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("NB9 malformed but completely delivered JSON stays with the parser — no third provider", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        return completion("{not-valid-json");
      }) as typeof fetch;
      try {
        const result = await callBackgroundMemory(
          "status",
          [{ role: "user", content: "상태" }],
          undefined,
          "background-status-widget-extract"
        );
        assert.equal(extractJsonObjectFromWidgetText(result.text), null);
        assert.equal(calls, 1);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("NB10 completion timeout covers full response body, not only headers", async () => {
    await withKeys(async () => {
      const result = await executeDeepSeekBackgroundWithProviderFailover({
        primary: flashPrimary(),
        timeoutMs: 40,
        requestKind: "background-memory-extract",
        hooks: {
          fetchFn: (async (input) => {
            if (String(input) === CI_URL) return hangingBodyAfterHeaders();
            return completion("after-body-timeout");
          }) as typeof fetch,
        },
      });
      assert.equal(result.telemetry.failover_trigger, "body_timeout");
      assert.notEqual(result.telemetry.failover_trigger, "headers_timeout");
      assert.equal(result.telemetry.primary_http_status, 200);
      assert.equal(result.usedProvider, "openrouter");
      assert.equal(result.telemetry.provider_attempt_count, 2);
    });
  });
});
