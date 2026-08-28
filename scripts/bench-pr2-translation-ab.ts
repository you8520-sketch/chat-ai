#!/usr/bin/env npx tsx
/**
 * PR-2 translation A/B harness — Luna vs DeepSeek V4 Flash.
 * Requires RUN_REAL_TRANSLATION_AB=1 and CHEAPER_INFERENCE_API_KEY.
 * Does NOT change production defaults.
 */
import Module from "module";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "docs/audits/pr2-translation-ab");

type Fixture = { id: string; category: string; source: string };

const FIXTURES: Fixture[] = [
  { id: "f01-general", category: "general_character", source: "이름: 은우. 성격: 츤데레." },
  {
    id: "f02-long-personality",
    category: "long_personality",
    source: "성격: ".repeat(400) + "관계: ".repeat(200),
  },
  { id: "f03-world-lore", category: "world_lore", source: "【세계관】 마법 왕국 엘라리아." },
  { id: "f04-rules", category: "rules", source: "규칙: HP가 0이면 전투 불능." },
  { id: "f05-proper-nouns", category: "proper_nouns", source: "인물: 강이현, 지명: 하늘 도시." },
  {
    id: "f06-placeholders",
    category: "placeholders",
    source: "{{user}}가 {{char}}에게 말했다. {{user}} {{char}}",
  },
  { id: "f07-markdown", category: "markdown", source: "# 배경\n- 항목1\n- 항목2" },
  { id: "f08-brackets", category: "brackets", source: "[상태] HP: 100 / MP: 50 （특수）" },
  { id: "f09-json-like", category: "json_like", source: '{"trait":"cold","mood":"angry"}' },
  { id: "f10-numbers", category: "numbers", source: "2026-08-28, 3km, 상태값 42%" },
  { id: "f11-slang", category: "slang", source: "야 뭐해? ㅋㅋ 진짜 미친듯이 웃김" },
  {
    id: "f12-long-max",
    category: "long_max",
    source: "서술".repeat(4500),
  },
];

async function evaluateSingleModel(
  fixture: Fixture,
  model: string,
  deps: {
    callPromptTranslation: typeof import("@/lib/ai").callPromptTranslation;
    CHARACTER_TRANSLATION_SYSTEM_PROMPT: string;
    parseSegmentedResponse: typeof import("@/lib/promptTranslation").parseSegmentedResponse;
    validateTranslationPlaceholderPreservation: typeof import("@/lib/promptTranslation").validateTranslationPlaceholderPreservation;
    translationPlaceholderCounts: typeof import("@/lib/promptTranslation").translationPlaceholderCounts;
  }
) {
  const payload = `⟦SEG 1⟧\n${fixture.source}\n⟦/SEG 1⟧`;
  const started = Date.now();
  const { text, usage } = await deps.callPromptTranslation(
    deps.CHARACTER_TRANSLATION_SYSTEM_PROMPT,
    [{ role: "user", content: payload }],
    model
  );
  const parsed = deps.parseSegmentedResponse(text, 1);
  const output = parsed?.[0] ?? "";
  return {
    fixtureId: fixture.id,
    category: fixture.category,
    model,
    latencyMs: Date.now() - started,
    finishReason: usage.finishReason ?? null,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens: usage.reasoningOutputTokens ?? null,
    actualCost: "unavailable" as const,
    rawOutput: output,
    placeholdersOk: deps.validateTranslationPlaceholderPreservation(fixture.source, output),
    placeholderCounts: deps.translationPlaceholderCounts(output),
    segmentComplete: parsed !== null,
  };
}

async function main() {
  const { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL } =
    await import("@/lib/chatModels");
  const promptTranslation = await import("@/lib/promptTranslation");
  const { callPromptTranslation } = await import("@/lib/ai");
  const deps = {
    callPromptTranslation,
    CHARACTER_TRANSLATION_SYSTEM_PROMPT: promptTranslation.CHARACTER_TRANSLATION_SYSTEM_PROMPT,
    parseSegmentedResponse: promptTranslation.parseSegmentedResponse,
    validateTranslationPlaceholderPreservation:
      promptTranslation.validateTranslationPlaceholderPreservation,
    translationPlaceholderCounts: promptTranslation.translationPlaceholderCounts,
  };

  function fixtureOrder(i: number): [string, string] {
    return i % 2 === 0
      ? [CHEAPER_INFERENCE_GPT_56_LUNA_MODEL, CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL]
      : [CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL];
  }
  if (process.env.RUN_REAL_TRANSLATION_AB !== "1") {
    console.log("AB_STATUS=NOT_RUN — set RUN_REAL_TRANSLATION_AB=1 to execute");
    process.exit(0);
  }
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    console.log("AB_STATUS=NOT_RUN — missing CHEAPER_INFERENCE_API_KEY");
    process.exit(0);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "fixtures.json"), JSON.stringify(FIXTURES, null, 2));

  const batchEstimate = FIXTURES.reduce(
    (sum, f) =>
      sum +
      promptTranslation.splitTranslationBatches([
        {
          id: "x",
          characterId: "0",
          content: f.source,
          category: "identity",
          importance: "CRITICAL",
          tokenCount: f.source.length,
          keywords: [],
        },
      ]).length,
    0
  );
  console.log(`fixture count=${FIXTURES.length} expected single-segment batches~=${batchEstimate} expected provider requests~=${FIXTURES.length * 2}`);

  const results: unknown[] = [];
  let requestCount = 0;
  for (let i = 0; i < FIXTURES.length; i++) {
    const fixture = FIXTURES[i]!;
    for (const model of fixtureOrder(i)) {
      requestCount += 1;
      if (requestCount > 40) {
        console.warn("AB safety cap reached — stopping");
        break;
      }
      results.push(await evaluateSingleModel(fixture, model, deps));
    }
  }

  const rawPath = path.join(OUT_DIR, "raw-results.jsonl");
  fs.writeFileSync(rawPath, results.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const modelMap = {
    A: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
    B: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  };
  fs.writeFileSync(path.join(OUT_DIR, "model-map.json"), JSON.stringify(modelMap, null, 2));

  const blindLines = results.map((r, idx) => `### Sample ${idx + 1}\n${JSON.stringify(r, null, 2)}`);
  fs.writeFileSync(path.join(OUT_DIR, "blind-review.md"), blindLines.join("\n\n"));
  fs.writeFileSync(
    path.join(OUT_DIR, "summary.md"),
    `# PR-2 Translation A/B Summary\n\n- fixtures: ${FIXTURES.length}\n- provider requests: ${requestCount}\n- artifact: ${rawPath}\n`
  );

  console.log(`AB_STATUS=RUN complete requests=${requestCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
