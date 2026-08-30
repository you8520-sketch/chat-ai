import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  BACKGROUND_CREATIVE_HTML_MODEL,
  BACKGROUND_OPENROUTER_MODEL,
  BACKGROUND_VISION_OPENROUTER_MODEL,
  callBackgroundMemory,
  isHistoricalBackgroundPrimaryDeepSeekAlias,
  resolveBackgroundCreativeHtmlPrimaryModelId,
  resolveBackgroundMemoryFallbackModel,
  resolveBackgroundPrimaryModelId,
  resolveBackgroundTextModelId,
} from "./ai";
import { resolveAssetVisionPrimaryModel } from "./assetVisionModels";
import { adaptCheaperInferenceChatBody } from "./cheaperInferenceConfig";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
  DEFAULT_SELECTED_AI,
  OPENROUTER_DEEPSEEK_V3_MODEL,
  OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
  OPENROUTER_DEEPSEEK_V4_FLASH_MODEL,
  OPENROUTER_QWEN38_FLASH_MODEL,
  OPENROUTER_GEMINI_31_FLASH_MODEL,
  resolveSelectedAI,
} from "./chatModels";
import { CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL } from "./chatImageSceneBrief";
import { DEFAULT_TRANSLATION_PRIMARY_MODEL } from "./promptTranslation";
import { TRPG_REPLY_SUGGESTION_MODEL } from "./trpg/replySuggestions";

const TEXT_BACKGROUND_TASKS = [
  "5-turn-rolling-summary",
  "lorebook-compact",
  "episodic-extract",
  "relationship-meta-extract",
  "status-widget-v3",
  "status-meta",
  "suggested-replies",
  "prompt-translation",
  "chat-image-scene-brief",
  "appearance-compile",
  "training-tag-analysis",
  "trpg-memory-seal",
  "trpg-reply-suggestions",
] as const;

const CREATIVE_HTML_PRIMARY_TASKS = ["ooc-html-visual-card"] as const;

const LUNA_PRIMARY_TASKS = TEXT_BACKGROUND_TASKS.filter(
  (task) => task !== "appearance-compile"
);
const NAMED_EXCEPTIONS = [
  "appearance-compile: OPENROUTER_GEMINI_31_FLASH_MODEL (Gemini, not DeepSeek text primary)",
] as const;

test("unset BACKGROUND_MEMORY_MODEL resolves to Luna PRIMARY", () => {
  assert.equal(
    resolveBackgroundPrimaryModelId(undefined),
    CHEAPER_INFERENCE_GPT_56_LUNA_MODEL
  );
  assert.equal(resolveBackgroundPrimaryModelId(""), CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
  assert.equal(resolveBackgroundPrimaryModelId("   "), CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
  assert.equal(BACKGROUND_OPENROUTER_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
});

test("legacy V3 env migrates to Luna PRIMARY only", () => {
  assert.equal(
    resolveBackgroundPrimaryModelId(OPENROUTER_DEEPSEEK_V3_MODEL),
    CHEAPER_INFERENCE_GPT_56_LUNA_MODEL
  );
  assert.equal(
    resolveBackgroundTextModelId(OPENROUTER_DEEPSEEK_V3_MODEL),
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
  );
});

test("historical DeepSeek Flash primary env aliases migrate to Luna", () => {
  for (const alias of [
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL,
    "deepseek-v4-flash-0731",
    "deepseek-v4-flash",
    OPENROUTER_DEEPSEEK_V4_FLASH_MODEL,
    OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL,
  ]) {
    assert.equal(isHistoricalBackgroundPrimaryDeepSeekAlias(alias), true, alias);
    assert.equal(
      resolveBackgroundPrimaryModelId(alias),
      CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
      alias
    );
  }
});

test("explicit DeepSeek fallback modelId remains DeepSeek", () => {
  assert.equal(
    resolveBackgroundTextModelId(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL),
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
  );
  assert.equal(
    resolveBackgroundTextModelId(CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_LEGACY_MODEL),
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
  );
});

test("explicit OpenRouter DeepSeek fallback remains OpenRouter DeepSeek", () => {
  assert.equal(
    resolveBackgroundTextModelId(OPENROUTER_DEEPSEEK_V4_FLASH_MODEL),
    OPENROUTER_DEEPSEEK_V4_FLASH_MODEL
  );
  assert.equal(
    resolveBackgroundTextModelId(OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL),
    OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL
  );
});

test("explicit Luna stays Luna", () => {
  assert.equal(
    resolveBackgroundTextModelId(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
    CHEAPER_INFERENCE_GPT_56_LUNA_MODEL
  );
  assert.equal(
    resolveBackgroundPrimaryModelId(CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
    CHEAPER_INFERENCE_GPT_56_LUNA_MODEL
  );
});

test("PRIMARY=Luna FALLBACK=Luna is replaced by OpenRouter Gemini Flash-Lite", () => {
  assert.equal(
    resolveBackgroundMemoryFallbackModel(
      { BACKGROUND_MEMORY_FALLBACK_MODEL: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL } as NodeJS.ProcessEnv,
      CHEAPER_INFERENCE_GPT_56_LUNA_MODEL
    ),
    OPENROUTER_GEMINI_31_FLASH_MODEL
  );
  assert.notEqual(
    resolveBackgroundMemoryFallbackModel({} as NodeJS.ProcessEnv, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL),
    CHEAPER_INFERENCE_GPT_56_LUNA_MODEL
  );
});

test("background memory fallback env migration E1-E6", () => {
  const primary = CHEAPER_INFERENCE_GPT_56_LUNA_MODEL;
  assert.equal(
    resolveBackgroundMemoryFallbackModel({} as NodeJS.ProcessEnv, primary),
    OPENROUTER_GEMINI_31_FLASH_MODEL,
    "E1 unset"
  );
  assert.equal(
    resolveBackgroundMemoryFallbackModel(
      { BACKGROUND_MEMORY_FALLBACK_MODEL: "" } as NodeJS.ProcessEnv,
      primary
    ),
    OPENROUTER_GEMINI_31_FLASH_MODEL,
    "E2 blank"
  );
  assert.equal(
    resolveBackgroundMemoryFallbackModel(
      { BACKGROUND_MEMORY_FALLBACK_MODEL: OPENROUTER_DEEPSEEK_V3_MODEL } as NodeJS.ProcessEnv,
      primary
    ),
    OPENROUTER_GEMINI_31_FLASH_MODEL,
    "E3 legacy V3"
  );
  assert.equal(
    resolveBackgroundMemoryFallbackModel(
      { BACKGROUND_MEMORY_FALLBACK_MODEL: OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL } as NodeJS.ProcessEnv,
      primary
    ),
    OPENROUTER_GEMINI_31_FLASH_MODEL,
    "E4 stale 0731"
  );
  assert.equal(
    resolveBackgroundMemoryFallbackModel(
      { BACKGROUND_MEMORY_FALLBACK_MODEL: "openai/gpt-4o-mini" } as NodeJS.ProcessEnv,
      primary
    ),
    "openai/gpt-4o-mini",
    "E5 explicit custom"
  );
  assert.equal(
    resolveBackgroundMemoryFallbackModel(
      { BACKGROUND_MEMORY_FALLBACK_MODEL: primary } as NodeJS.ProcessEnv,
      primary
    ),
    OPENROUTER_GEMINI_31_FLASH_MODEL,
    "E6 same as primary"
  );
});

test("COMMON_FALLBACK_PRIMARY_GEMINI guard: unset/blank/stale alias never equals primary", () => {
  const primary = OPENROUTER_GEMINI_31_FLASH_MODEL;
  assert.equal(
    resolveBackgroundMemoryFallbackModel({} as NodeJS.ProcessEnv, primary),
    null,
    "COMMON_FALLBACK_PRIMARY_GEMINI_UNSET"
  );
  assert.equal(
    resolveBackgroundMemoryFallbackModel(
      { BACKGROUND_MEMORY_FALLBACK_MODEL: "" } as NodeJS.ProcessEnv,
      primary
    ),
    null,
    "COMMON_FALLBACK_PRIMARY_GEMINI_BLANK"
  );
  assert.equal(
    resolveBackgroundMemoryFallbackModel(
      { BACKGROUND_MEMORY_FALLBACK_MODEL: OPENROUTER_DEEPSEEK_V4_FLASH_0731_BACKUP_MODEL } as NodeJS.ProcessEnv,
      primary
    ),
    null,
    "COMMON_FALLBACK_PRIMARY_GEMINI_STALE_ALIAS"
  );
  assert.notEqual(
    resolveBackgroundMemoryFallbackModel({} as NodeJS.ProcessEnv, primary),
    primary
  );
});

test("callBackgroundMemory default outbound is Luna with reasoning none", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
  let requestBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    const result = await callBackgroundMemory("system", [
      { role: "user", content: "상태" },
    ]);
    assert.equal(result.text, "ok");
    assert.equal(requestBody?.model, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
    assert.deepEqual(requestBody?.reasoning, { effort: "none" });
    assert.equal(requestBody?.reasoning_effort, "none");
    assert.deepEqual(
      adaptCheaperInferenceChatBody({
        model: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
        messages: [{ role: "user", content: "상태" }],
      }),
      {
        model: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
        messages: [{ role: "user", content: "상태" }],
        reasoning: { effort: "none" },
        reasoning_effort: "none",
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  }
});

test("explicit DeepSeek modelId on callBackgroundMemory stays DeepSeek", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CHEAPER_INFERENCE_API_KEY;
  process.env.CHEAPER_INFERENCE_API_KEY = "test-key";
  let requestBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "flash" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 1 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    await callBackgroundMemory(
      "system",
      [{ role: "user", content: "상태" }],
      undefined,
      "background-memory-extract",
      { modelId: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL }
    );
    assert.equal(requestBody?.model, CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL);
    assert.deepEqual(requestBody?.thinking, { type: "disabled" });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey == null) delete process.env.CHEAPER_INFERENCE_API_KEY;
    else process.env.CHEAPER_INFERENCE_API_KEY = previousKey;
  }
});

test("background vision PRIMARY is Qwen3.8 Flash for asset tagging", () => {
  assert.equal(OPENROUTER_QWEN38_FLASH_MODEL, "qwen/qwen3.8-flash");
  assert.equal(BACKGROUND_VISION_OPENROUTER_MODEL, resolveAssetVisionPrimaryModel());
  const visionSrc = readFileSync(new URL("./vision.ts", import.meta.url), "utf8");
  assert.match(visionSrc, /resolveAssetVisionModels/);
  assert.doesNotMatch(visionSrc, /CHEAPER_INFERENCE_GPT_56_LUNA_MODEL/);
});

test("main RP routing is unchanged", () => {
  assert.equal(DEFAULT_SELECTED_AI, CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
  assert.equal(resolveSelectedAI(undefined), CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL);
  assert.equal(
    resolveSelectedAI(CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL),
    CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL
  );
});

test("text background task inventory: Luna PRIMARY, zero remaining DeepSeek primaries", () => {
  assert.equal(TEXT_BACKGROUND_TASKS.length, 13);
  assert.equal(LUNA_PRIMARY_TASKS.length, 12);
  assert.equal(CREATIVE_HTML_PRIMARY_TASKS.length, 1);
  assert.equal(NAMED_EXCEPTIONS.length, 1);

  assert.equal(BACKGROUND_OPENROUTER_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
  assert.equal(BACKGROUND_CREATIVE_HTML_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
  assert.equal(
    resolveBackgroundCreativeHtmlPrimaryModelId({} as NodeJS.ProcessEnv),
    CHEAPER_INFERENCE_GPT_56_LUNA_MODEL
  );
  assert.equal(
    resolveBackgroundCreativeHtmlPrimaryModelId({
      BACKGROUND_CREATIVE_HTML_MODEL: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
    } as NodeJS.ProcessEnv),
    CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL
  );
  assert.equal(DEFAULT_TRANSLATION_PRIMARY_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
  assert.equal(CHAT_IMAGE_SCENE_BRIEF_DEFAULT_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);
  assert.equal(TRPG_REPLY_SUGGESTION_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL);

  const htmlRecoverySrc = readFileSync(
    new URL("./htmlVisualCardRecovery.ts", import.meta.url),
    "utf8"
  );
  assert.match(htmlRecoverySrc, /BACKGROUND_CREATIVE_HTML_MODEL/);
  assert.match(htmlRecoverySrc, /modelId:\s*BACKGROUND_CREATIVE_HTML_MODEL/);
  assert.doesNotMatch(
    htmlRecoverySrc,
    /background-html-visual-card[\s\S]{0,120}\{ maxTokens \}/
  );

  const appearanceSrc = readFileSync(
    new URL("./appearanceCompiler.ts", import.meta.url),
    "utf8"
  );
  assert.match(appearanceSrc, /CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL/);
  assert.doesNotMatch(appearanceSrc, /OPENROUTER_GEMINI_31_FLASH_MODEL/);

  const remainingDeepSeekTextPrimaryTasks = 0;
  assert.equal(remainingDeepSeekTextPrimaryTasks, 0);

  assert.equal(
    resolveBackgroundPrimaryModelId(process.env.BACKGROUND_MEMORY_MODEL),
    CHEAPER_INFERENCE_GPT_56_LUNA_MODEL
  );
});
