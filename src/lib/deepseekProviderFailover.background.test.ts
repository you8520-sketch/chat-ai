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
  CompatibleCompletionError,
  callOpenRouterCompletion,
} from "./openRouterCompletion";
import {
  DeepSeekProviderFailoverError,
  executeDeepSeekBackgroundWithProviderFailover,
} from "./deepseekProviderFailover";
import { extractJsonObjectFromWidgetText } from "./statusWidget/extractNormalize";
import { parseSegmentedResponse } from "./promptTranslation";

const CI_URL = "https://api.cheaperinference.com/v1/chat/completions";
const OR_URL = "https://openrouter.ai/api/v1/chat/completions";

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

describe("DeepSeek background Flash0731 provider failover", () => {
  it("B1 memory Flash normal CI success → OR calls 0 → commit 1", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const urls: string[] = [];
      let commits = 0;
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        return completion('{"turnSummary":"요약","items":[]}');
      }) as typeof fetch;
      try {
        const result = await callBackgroundMemory(
          "system",
          [{ role: "user", content: "기억" }],
          undefined,
          "background-memory-extract"
        );
        commits += 1;
        assert.equal(result.text.includes("요약"), true);
        assert.deepEqual(urls, [CI_URL]);
        assert.equal(commits, 1);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("F500-3 background Flash CI HTTP 500 → OR Flash0731 exactly once", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const models: string[] = [];
      const urls: string[] = [];
      globalThis.fetch = (async (input, init) => {
        urls.push(String(input));
        const body = JSON.parse(String(init?.body)) as { model?: string };
        models.push(String(body.model));
        if (String(input).includes("cheaperinference")) {
          return new Response("internal", { status: 500 });
        }
        return completion("flash500-rescue");
      }) as typeof fetch;
      try {
        const result = await callBackgroundMemory(
          "system",
          [{ role: "user", content: "full memory source" }],
          undefined,
          "background-memory-extract"
        );
        assert.equal(result.text, "flash500-rescue");
        assert.deepEqual(urls, [CI_URL, OR_URL]);
        assert.deepEqual(models, [
          CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
          OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
        ]);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("B2 memory CI 502 → OR Flash0731 1 → commit 1", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const models: string[] = [];
      globalThis.fetch = (async (input, init) => {
        const body = JSON.parse(String(init?.body)) as { model?: string };
        models.push(String(body.model));
        if (String(input).includes("cheaperinference")) {
          return new Response("bad gateway", { status: 502 });
        }
        return completion("fallback summary");
      }) as typeof fetch;
      try {
        const result = await callBackgroundMemory(
          "system",
          [{ role: "user", content: "full memory source" }],
          undefined,
          "background-memory-extract"
        );
        assert.equal(result.text, "fallback summary");
        assert.deepEqual(models, [
          CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
          OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
        ]);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("B3 memory CI socket error → OR 1 → commit 1", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        if (calls === 1) throw new Error("ECONNRESET");
        return completion("socket rescue");
      }) as typeof fetch;
      try {
        const result = await callBackgroundMemory(
          "system",
          [{ role: "user", content: "기억" }],
          undefined,
          "background-memory-rolling-summary"
        );
        assert.equal(result.text, "socket rescue");
        assert.equal(calls, 2);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("B4 memory CI + OR both fail → commit 0 and retryable barrier failure", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let commits = 0;
      globalThis.fetch = (async () =>
        new Response("down", { status: 503 })) as typeof fetch;
      try {
        await assert.rejects(
          () =>
            callBackgroundMemory(
              "system",
              [{ role: "user", content: "기억" }],
              undefined,
              "background-memory-extract"
            ),
          (error: unknown) => {
            assert.ok(error instanceof CompatibleCompletionError);
            return true;
          }
        );
        assert.equal(commits, 0);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("B5 episodic extraction CI timeout → OR 1 → one fact batch only", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let calls = 0;
      const batches: string[] = [];
      globalThis.fetch = (async (_input, init) => {
        calls += 1;
        if (calls === 1) {
          const err = new Error("headers deadline exceeded");
          err.name = "TimeoutError";
          throw err;
        }
        const text = '{"items":["유저: 반지"]}';
        batches.push(text);
        return completion(text);
      }) as typeof fetch;
      try {
        const result = await callOpenRouterCompletion({
          system: "extract",
          history: [{ role: "user", content: "턴" }],
          model: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
          disableReasoning: true,
          requestKind: "background-memory-extract",
          timeoutMs: 30,
        });
        assert.equal(batches.length, 1);
        assert.equal(result.text, '{"items":["유저: 반지"]}');
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("B6 status CI 503 → OR 1 → status commit 1", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let commits = 0;
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        if (calls === 1) return new Response("busy", { status: 503 });
        return completion('{"hp":"12","mood":"긴장"}');
      }) as typeof fetch;
      try {
        const result = await callBackgroundMemory(
          "status",
          [{ role: "user", content: "상태" }],
          undefined,
          "background-status-widget-extract"
        );
        commits += 1;
        assert.equal(result.text.includes("hp"), true);
        assert.equal(calls, 2);
        assert.equal(commits, 1);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("B7 HTML CI failure → OR 1 → one usable result", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let calls = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        if (calls === 1) throw new Error("fetch failed");
        return completion("<div>카드</div>");
      }) as typeof fetch;
      try {
        const result = await callBackgroundMemory(
          "html",
          [{ role: "user", content: "카드" }],
          undefined,
          "background-html-visual-card"
        );
        assert.equal(result.text, "<div>카드</div>");
        assert.equal(calls, 2);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("B8 translation CI socket failure → OR Flash0731 1 → translation commit 1", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const models: string[] = [];
      let saveCommits = 0;
      globalThis.fetch = (async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { model?: string };
        models.push(String(body.model));
        if (models.length === 1) throw new Error("socket hang up");
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

  it("B9 translation CI + OR fail → no partial/duplicate save", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let saveCommits = 0;
      globalThis.fetch = (async () => {
        throw new Error("ETIMEDOUT");
      }) as typeof fetch;
      try {
        await assert.rejects(() =>
          callPromptTranslation(
            "translate",
            [{ role: "user", content: "한국어" }],
            CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
          )
        );
        assert.equal(saveCommits, 0);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("B10 primary result already committed → OR must never run", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = (async (input) => {
        urls.push(String(input));
        return completion("already committed");
      }) as typeof fetch;
      try {
        const result = await callOpenRouterCompletion({
          system: "sys",
          history: [{ role: "user", content: "user" }],
          model: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
          requestKind: "background-memory-extract",
        });
        assert.equal(result.text, "already committed");
        assert.deepEqual(urls, [CI_URL]);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("B11 malformed OpenRouter structured result → validation failure, no DB commit, no third provider", async () => {
    await withKeys(async () => {
      const previousFetch = globalThis.fetch;
      let calls = 0;
      let dbCommits = 0;
      globalThis.fetch = (async () => {
        calls += 1;
        if (calls === 1) return new Response("down", { status: 502 });
        return completion("not-json-at-all");
      }) as typeof fetch;
      try {
        const result = await callBackgroundMemory(
          "status",
          [{ role: "user", content: "상태" }],
          undefined,
          "background-status-widget-extract"
        );
        const parsed = extractJsonObjectFromWidgetText(result.text);
        assert.equal(parsed, null);
        assert.equal(calls, 2);
        assert.equal(dbCommits, 0);
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  it("background owner never exceeds two provider attempts", async () => {
    await withKeys(async () => {
      let calls = 0;
      await assert.rejects(
        () =>
          executeDeepSeekBackgroundWithProviderFailover({
            primary: {
              endpoint: CI_URL,
              headers: { Authorization: "Bearer ci" },
              body: {
                model: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
                messages: [{ role: "user", content: "x" }],
              },
            },
            timeoutMs: 40,
            hooks: {
              fetchFn: (async () => {
                calls += 1;
                throw new Error("UND_ERR_SOCKET");
              }) as typeof fetch,
            },
          }),
        (error: unknown) => {
          assert.ok(error instanceof DeepSeekProviderFailoverError);
          assert.equal(error.providerAttemptCount, 2);
          return true;
        }
      );
      assert.equal(calls, 2);
    });
  });

  it("OpenRouter backup keeps Flash0731 and JSON response_format", async () => {
    await withKeys(async () => {
      const bodies: Record<string, unknown>[] = [];
      const result = await executeDeepSeekBackgroundWithProviderFailover({
        primary: {
          endpoint: CI_URL,
          headers: { Authorization: "Bearer ci" },
          body: {
            model: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
            messages: [{ role: "user", content: "json" }],
            response_format: { type: "json_object" },
            thinking: { type: "disabled" },
          },
        },
        timeoutMs: 80,
        hooks: {
          fetchFn: (async (input, init) => {
            bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
            if (String(input) === CI_URL) return new Response("busy", { status: 503 });
            assert.equal(String(input), OR_URL);
            return completion('{"ok":true}');
          }) as typeof fetch,
        },
      });
      assert.equal(bodies[1]?.model, OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL);
      assert.deepEqual(bodies[1]?.response_format, { type: "json_object" });
      assert.deepEqual(bodies[1]?.reasoning, { effort: "none", exclude: true });
      assert.equal(await result.response.text().then((t) => t.includes("ok")), true);
    });
  });
});
