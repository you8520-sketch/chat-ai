import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  isCheaperInferenceModel,
} from "@/lib/chatModels";
import type { CharacterChunk } from "@/types";
import {
  PROMPT_TRANSLATION_REQUEST_KIND,
  TRANSLATION_MAX_INPUT_TOKENS,
  TRANSLATION_MAX_OUTPUT_TOKENS,
  resolveBackgroundMaxInputTokens,
  resolveBackgroundMaxOutputTokens,
} from "@/lib/ai";
import {
  classifyEnglishLayer,
  DEFAULT_TRANSLATION_FALLBACK_MODEL,
  DEFAULT_TRANSLATION_PRIMARY_MODEL,
  ENGLISH_BACKFILL_FAILURE_COOLDOWN_MS,
  hashKoreanChunks,
  koreanChunksTranslationFingerprint,
  hasPromptTranslationTransport,
  isTranslatableChunk,
  loadEnglishChunks,
  parseSegmentedResponse,
  resetEnglishBackfillStateForTests,
  resolveTranslationModels,
  canScheduleEnglishBackfill,
  markEnglishBackfillFailureForTests,
  splitTranslationBatches,
  translateChunksToEnglish,
  translationModelIdentity,
  TRANSLATION_BATCH_MAX_CHUNKS,
} from "@/lib/promptTranslation";

function chunk(
  id: string,
  content: string,
  category: CharacterChunk["category"] = "identity"
): CharacterChunk {
  return {
    id,
    characterId: "1",
    content,
    category,
    importance: "CRITICAL",
    tokenCount: Math.max(1, content.length),
    keywords: [],
  };
}

afterEach(() => {
  resetEnglishBackfillStateForTests();
});

describe("translation model chain", () => {
  it("uses translation-only 20k/15k caps and does not change RP max_tokens", () => {
    assert.equal(TRANSLATION_MAX_INPUT_TOKENS, 20_000);
    assert.equal(TRANSLATION_MAX_OUTPUT_TOKENS, 15_000);
    assert.equal(
      resolveBackgroundMaxInputTokens(PROMPT_TRANSLATION_REQUEST_KIND),
      20_000
    );
    assert.equal(
      resolveBackgroundMaxOutputTokens(PROMPT_TRANSLATION_REQUEST_KIND),
      15_000
    );
    assert.equal(resolveBackgroundMaxInputTokens("generateContent"), 12_000);
    assert.equal(resolveBackgroundMaxOutputTokens("generateContent"), 3072);
  });

  it("T1 defaults to distinct CI Luna primary and CI Gemini 3.1 Flash-Lite fallback", () => {
    const prevPrimary = process.env.PROMPT_TRANSLATION_MODEL;
    const prevFallback = process.env.PROMPT_TRANSLATION_FALLBACK_MODELS;
    const prevBg = process.env.BACKGROUND_MEMORY_MODEL;
    delete process.env.PROMPT_TRANSLATION_MODEL;
    delete process.env.PROMPT_TRANSLATION_FALLBACK_MODELS;
    process.env.BACKGROUND_MEMORY_MODEL = CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL;
    try {
      const models = resolveTranslationModels();
      assert.deepEqual(models, [
        CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
        CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL,
      ]);
      assert.equal(models.length, 2);
      assert.equal(
        DEFAULT_TRANSLATION_PRIMARY_MODEL,
        CHEAPER_INFERENCE_GPT_56_LUNA_MODEL
      );
      assert.equal(
        DEFAULT_TRANSLATION_FALLBACK_MODEL,
        CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL
      );
      assert.notEqual(
        translationModelIdentity(models[0]!),
        translationModelIdentity(models[1]!)
      );
    } finally {
      if (prevPrimary === undefined) delete process.env.PROMPT_TRANSLATION_MODEL;
      else process.env.PROMPT_TRANSLATION_MODEL = prevPrimary;
      if (prevFallback === undefined) delete process.env.PROMPT_TRANSLATION_FALLBACK_MODELS;
      else process.env.PROMPT_TRANSLATION_FALLBACK_MODELS = prevFallback;
      if (prevBg === undefined) delete process.env.BACKGROUND_MEMORY_MODEL;
      else process.env.BACKGROUND_MEMORY_MODEL = prevBg;
    }
  });

  it("T2 translationModelIdentity uses CheaperInference for Luna and Gemini Flash-Lite", () => {
    assert.equal(
      translationModelIdentity(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
      "cheaperinference:gpt-5.6-luna"
    );
    assert.equal(
      translationModelIdentity(CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL),
      "cheaperinference:gemini-3.1-flash-lite"
    );
    assert.equal(isCheaperInferenceModel(CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL), true);
    assert.equal(isCheaperInferenceModel("google/gemini-3.1-flash-lite"), false);
  });

  it("T3 hasPromptTranslationTransport with CI key only and no OpenRouter key", () => {
    assert.equal(
      hasPromptTranslationTransport({
        CHEAPER_INFERENCE_API_KEY: "test",
        OPENROUTER_API_KEY: "",
      } as NodeJS.ProcessEnv),
      true
    );
  });

  it("migrates stale Flash primary env to Luna and keeps explicit Flash fallback", () => {
    const models = resolveTranslationModels({
      PROMPT_TRANSLATION_MODEL: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
      PROMPT_TRANSLATION_FALLBACK_MODELS: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
    } as NodeJS.ProcessEnv);
    assert.deepEqual(models, [
      CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
    ]);
  });

  it("T7 explicit env override replaces default Gemini fallback", () => {
    const models = resolveTranslationModels({
      PROMPT_TRANSLATION_FALLBACK_MODELS: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
    } as NodeJS.ProcessEnv);
    assert.deepEqual(models, [
      CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
    ]);
  });

  it("T8 does not treat the same resolved Luna model as a fallback", () => {
    const models = resolveTranslationModels({
      PROMPT_TRANSLATION_MODEL: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      PROMPT_TRANSLATION_FALLBACK_MODELS: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
    } as NodeJS.ProcessEnv);
    assert.deepEqual(models, [CHEAPER_INFERENCE_GPT_56_LUNA_MODEL]);
  });

  it("requires a CI key for the default CI-only translation chain", () => {
    assert.equal(hasPromptTranslationTransport({} as NodeJS.ProcessEnv), false);
    assert.equal(
      hasPromptTranslationTransport({
        CHEAPER_INFERENCE_API_KEY: "ci",
      } as NodeJS.ProcessEnv),
      true
    );
    assert.equal(
      hasPromptTranslationTransport({
        OPENROUTER_API_KEY: "or",
      } as NodeJS.ProcessEnv),
      false
    );
    assert.equal(
      hasPromptTranslationTransport({
        OPENROUTER_API_KEY: "or",
        PROMPT_TRANSLATION_MODEL: "deepseek/deepseek-v4-flash",
      } as NodeJS.ProcessEnv),
      false
    );
    assert.equal(
      hasPromptTranslationTransport({
        OPENROUTER_API_KEY: "or",
        PROMPT_TRANSLATION_MODEL: "openai/gpt-4o-mini",
      } as NodeJS.ProcessEnv),
      true
    );
  });
});

describe("translation batching and parser", () => {
  it("splits large chunk sets into bounded batches", () => {
    const targets = Array.from({ length: 10 }, (_, i) =>
      chunk(`c-${i}`, "가".repeat(800), "background")
    );
    const batches = splitTranslationBatches(targets);
    assert.ok(batches.length >= 4);
    for (const batch of batches) {
      assert.ok(batch.length <= TRANSLATION_BATCH_MAX_CHUNKS);
    }
    assert.equal(batches.flat().length, 10);
  });

  it("rejects incomplete segment sets and does not guess bodies", () => {
    const text = "⟦SEG 1⟧\nHello\n⟦/SEG 1⟧\n⟦SEG 2⟧\npartial";
    assert.equal(parseSegmentedResponse(text, 2), null);
    assert.equal(parseSegmentedResponse("⟦SEG 1⟧\n\n⟦/SEG 1⟧", 1), null);
    assert.deepEqual(parseSegmentedResponse("⟦SEG 1⟧\nHello\n⟦/SEG 1⟧", 1), ["Hello"]);
  });

  it("keeps speech chunks out of the translation target set", () => {
    const chunks = [
      chunk("c-1", "정체성 설명", "identity"),
      chunk("c-2", "말투는 반말", "speech"),
    ];
    assert.deepEqual(
      chunks.filter(isTranslatableChunk).map((c) => c.id),
      ["c-1"]
    );
  });
});

describe("english layer status and stale load", () => {
  it("returns null for stale hash and classifies STALE vs MISSING", () => {
    const korean = [chunk("c-1", "최신 한국어")];
    const currentHash = koreanChunksTranslationFingerprint(korean);
    const stale = loadEnglishChunks(
      {
        setting_chunks_en: JSON.stringify([
          { ...korean[0], content: "stale english" },
        ]),
        prompt_translation_hash: "old-hash",
      },
      korean
    );
    assert.equal(stale, null);
    assert.equal(
      classifyEnglishLayer({
        koreanChunks: korean,
        settingChunksEn: JSON.stringify([{ ...korean[0], content: "stale english" }]),
        promptTranslationHash: "old-hash",
      }),
      "STALE"
    );
    assert.equal(
      classifyEnglishLayer({
        koreanChunks: korean,
        settingChunksEn: "",
        promptTranslationHash: "",
      }),
      "MISSING"
    );
    assert.equal(
      classifyEnglishLayer({
        koreanChunks: korean,
        settingChunksEn: JSON.stringify([{ ...korean[0], content: "English identity" }]),
        promptTranslationHash: currentHash,
      }),
      "CURRENT"
    );
    assert.equal(
      classifyEnglishLayer({
        koreanChunks: [chunk("c-s", "반말만", "speech")],
      }),
      "NO_TRANSLATABLE_CONTENT"
    );
  });
});

describe("translation fallback semantics", () => {
  function installCiFetchMock(
    handler: (requestedModel: string, callIndex: number) => Response | "throw"
  ): { modelsCalled: string[]; restore: () => void } {
    const modelsCalled: string[] = [];
    let callIndex = 0;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      const requestedModel = String(body.model ?? "");
      modelsCalled.push(requestedModel);
      callIndex += 1;
      const outcome = handler(requestedModel, callIndex);
      if (outcome === "throw") {
        throw new Error(`mock transport failure for ${requestedModel}`);
      }
      return outcome;
    }) as typeof fetch;
    return {
      modelsCalled,
      restore() {
        globalThis.fetch = previousFetch;
      },
    };
  }

  function successResponse(content: string): Response {
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: { content },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  it("T4 primary Luna succeeds without calling Gemini fallback", async () => {
    const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
    const previousOr = process.env.OPENROUTER_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-ci";
    delete process.env.OPENROUTER_API_KEY;
    const mock = installCiFetchMock((requestedModel) => {
      assert.equal(requestedModel, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
      return successResponse("⟦SEG 1⟧\nHello\n⟦/SEG 1⟧");
    });
    try {
      const result = await translateChunksToEnglish([chunk("c-1", "안녕")]);
      assert.equal(result?.[0]?.content, "Hello");
      assert.deepEqual(mock.modelsCalled, [CHEAPER_INFERENCE_GPT_56_LUNA_MODEL]);
    } finally {
      mock.restore();
      if (previousCi === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
      if (previousOr === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOr;
    }
  });

  it("T5 Luna failure then Gemini fallback succeeds with exact CI model id", async () => {
    const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
    const previousOr = process.env.OPENROUTER_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-ci";
    delete process.env.OPENROUTER_API_KEY;
    const mock = installCiFetchMock((requestedModel) => {
      if (requestedModel === CHEAPER_INFERENCE_GPT_56_LUNA_MODEL) {
        return successResponse("not segmented");
      }
      assert.equal(requestedModel, CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL);
      return successResponse("⟦SEG 1⟧\nGemini hello\n⟦/SEG 1⟧");
    });
    try {
      const result = await translateChunksToEnglish([chunk("c-1", "안녕")]);
      assert.equal(result?.[0]?.content, "Gemini hello");
      assert.deepEqual(mock.modelsCalled, [
        CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
        CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL,
      ]);
    } finally {
      mock.restore();
      if (previousCi === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
      if (previousOr === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOr;
    }
  });

  it("T6 Luna and Gemini both fail returns null (Korean fallback remains authoritative)", async () => {
    const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
    const previousOr = process.env.OPENROUTER_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-ci";
    delete process.env.OPENROUTER_API_KEY;
    const mock = installCiFetchMock((requestedModel) => {
      if (requestedModel === CHEAPER_INFERENCE_GPT_56_LUNA_MODEL) {
        return "throw";
      }
      assert.equal(requestedModel, CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL);
      return successResponse("not segmented");
    });
    try {
      const result = await translateChunksToEnglish([chunk("c-1", "안녕")]);
      assert.equal(result, null);
      assert.deepEqual(mock.modelsCalled, [
        CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
        CHEAPER_INFERENCE_GEMINI_31_FLASH_LITE_MODEL,
      ]);
    } finally {
      mock.restore();
      if (previousCi === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
      if (previousOr === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOr;
    }
  });
});

describe("atomic translate + save", () => {
  it("returns null for the whole job when a later batch fails — no partial set", async () => {
    const previousFetch = globalThis.fetch;
    const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
    const previousOr = process.env.OPENROUTER_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-ci";
    process.env.OPENROUTER_API_KEY = "test-or";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: { content: "⟦SEG 1⟧\nOne\n⟦/SEG 1⟧" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 4 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "not segmented" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const chunks = [
      chunk("c-1", "가".repeat(2000), "identity"),
      chunk("c-2", "나".repeat(2000), "background"),
    ];
    try {
      const result = await translateChunksToEnglish(chunks);
      assert.equal(result, null);
      assert.ok(calls >= 2);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousCi === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
      if (previousOr === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOr;
    }
  });

  it("sends the 15k translation output cap on the provider request", async () => {
    const previousFetch = globalThis.fetch;
    const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-ci";
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-or";
    let requestedMaxTokens: number | undefined;
    globalThis.fetch = (async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { max_tokens?: number };
      requestedMaxTokens = body.max_tokens;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "⟦SEG 1⟧\nHello\n⟦/SEG 1⟧" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    try {
      const result = await translateChunksToEnglish([chunk("c-1", "안녕")]);
      assert.equal(result?.[0]?.content, "Hello");
      assert.equal(requestedMaxTokens, 15_000);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousCi === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
    }
  });

  it("rejects finish=length even when some text is returned", async () => {
    const previousFetch = globalThis.fetch;
    const previousCi = process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-ci";
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "test-or";
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: "⟦SEG 1⟧\nHello\n⟦/SEG 1⟧" },
              finish_reason: "length",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 4096 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;
    try {
      const result = await translateChunksToEnglish([chunk("c-1", "안녕")]);
      assert.equal(result, null);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousCi === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = previousCi;
    }
  });
});

describe("backfill durable enqueue", () => {
  it("can schedule backfill when CI transport is available", () => {
    const prevCi = process.env.CHEAPER_INFERENCE_API_KEY;
    process.env.CHEAPER_INFERENCE_API_KEY = "test-ci";
    try {
      assert.equal(canScheduleEnglishBackfill(9), true);
    } finally {
      if (prevCi === undefined) delete process.env.CHEAPER_INFERENCE_API_KEY;
      else process.env.CHEAPER_INFERENCE_API_KEY = prevCi;
    }
  });
});
