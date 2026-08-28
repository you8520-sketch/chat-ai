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
import type { CharacterChunk } from "@/types";

const OUT_DIR = path.join(process.cwd(), "docs/audits/pr2-translation-ab");

type Fixture = { id: string; category: string; chunks: CharacterChunk[] };

const LONG_LORE = [
  "【세계관】 엘라리아 왕국은 1247년에 건국되었고 수도는 실버헤이븐이다.",
  "【규칙】 HP 0 시 전투 불능, MP는 하루 1회 전량 회복.",
  "【인물】 왕실 수호대장 카일 드렉스, 암살 길드 마스터 리나 볼트.",
  "【지리】 북쪽은 얼음 협곡, 남쪽은 사막 오아시스 마을 솔렌.",
  "【마법】 원소 4종(불/물/바람/땅), 금기술은 시간 역행.",
  "{{user}}와 {{char}}는 왕궁 지하 수련장에서 첫 대결을 벌인다.",
  "[상태] HP: 100 / MP: 80 / 버프: 가속",
  "# 전투 규칙\n- 선공 판정: d20\n- 크리티컬: 20",
].join("\n\n");

const FIXTURES: Fixture[] = [
  {
    id: "F01",
    category: "general_character",
    chunks: [
      chunk("f01-1", "이름: 은우. 나이: 24. 직업: 대학생.", "identity"),
      chunk("f01-2", "성격: 겉으로는 차갑지만 가까운 사람에게는 다정함.", "personality"),
    ],
  },
  {
    id: "F02",
    category: "dense_personality",
    chunks: [
      chunk("f02-1", "성격: 자존심이 강하고 승부욕이 큼. 약점을 들키면 화를 낸다.", "personality"),
      chunk("f02-2", "관계: {{user}}는 어릴 적부터 알던 소꿉친구. 서로 경쟁하며 자랐다.", "relationship"),
      chunk("f02-3", "트라우마: 과거 실험 사고로 왼손에 화상 흉터가 있다.", "background"),
    ],
  },
  {
    id: "F03",
    category: "world_lore",
    chunks: [chunk("f03-1", "【세계관】 마법 왕국 엘라리아. 달의 신전이 중심지.", "world")],
  },
  {
    id: "F04",
    category: "strict_rules",
    chunks: [
      chunk("f04-1", "규칙: HP가 0이면 전투 불능. 회복 아이템은 전투 중 1회만.", "rules"),
      chunk("f04-2", "금지: OOC 메타 발언, {{user}} 행동 대리.", "rules"),
    ],
  },
  {
    id: "F05",
    category: "korean_proper_nouns",
    chunks: [
      chunk("f05-1", "인물: 강이현, 권태현, 지명: 하늘 도시, 조직: 검은 장미단.", "identity"),
    ],
  },
  {
    id: "F06",
    category: "placeholders",
    chunks: [
      chunk("f06-1", "{{user}}가 {{char}}에게 말했다. \"오늘 어디 갈 거야?\" {{user}} {{char}}", "identity"),
    ],
  },
  {
    id: "F07",
    category: "markdown",
    chunks: [chunk("f07-1", "# 배경\n- 항목1: 폐허 도시\n- 항목2: 마법 학원", "background")],
  },
  {
    id: "F08",
    category: "brackets_status",
    chunks: [chunk("f08-1", "[상태] HP: 100 / MP: 50 （특수） 【버프】가속", "rules")],
  },
  {
    id: "F09",
    category: "json_wpp_like",
    chunks: [
      chunk("f09-1", '{"trait":"cold","mood":"angry","likes":["tea","rain"]}', "personality"),
    ],
  },
  {
    id: "F10",
    category: "numbers_dates_units",
    chunks: [
      chunk("f10-1", "사건 날짜: 2026-08-28. 거리: 3km. 확률: 42%. 온도: -12°C.", "background"),
    ],
  },
  {
    id: "F11",
    category: "slang_crude",
    chunks: [
      chunk("f11-1", "야 뭐해? ㅋㅋ 진짜 미친듯이 웃김. 말 좀 가려 씨.", "speech_style"),
    ],
  },
  {
    id: "F12",
    category: "long_mixed_8k",
    chunks: [
      chunk("f12-1", LONG_LORE, "world"),
      chunk("f12-2", "캐릭터: 은우. 목표: 실버헤이븐 왕실 기록실에 침입.", "identity"),
      chunk("f12-3", "추가 규칙: NPC는 {{user}}의 선택을 존중하되 세계관 일관성 유지.", "rules"),
    ],
  },
];

function chunk(
  id: string,
  content: string,
  category: CharacterChunk["category"]
): CharacterChunk {
  return {
    id,
    characterId: "bench",
    content,
    category,
    importance: "CRITICAL",
    tokenCount: Math.max(1, content.length),
    keywords: [],
  };
}

function countHeadings(text: string): number {
  return (text.match(/^#+\s/mg) ?? []).length;
}

function countBracketBlocks(text: string): number {
  return (text.match(/[\[【]/g) ?? []).length;
}

  const { CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL, CHEAPER_INFERENCE_GPT_56_LUNA_MODEL } =
    await import("@/lib/chatModels");
  const promptTranslation = await import("@/lib/promptTranslation");
  const { callPromptTranslation } = await import("@/lib/ai");

  if (process.env.RUN_REAL_TRANSLATION_AB !== "1") {
    console.log("AB_STATUS=NOT_RUN — set RUN_REAL_TRANSLATION_AB=1 to execute");
    process.exit(0);
  }
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    console.log("AB_STATUS=NOT_RUN — missing CHEAPER_INFERENCE_API_KEY");
    process.exit(0);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "fixtures.json"),
    JSON.stringify(
      FIXTURES.map((f) => ({ id: f.id, category: f.category, source: f.chunks.map((c) => c.content).join("\n\n") })),
      null,
      2
    )
  );

  const logicalChunkCount = FIXTURES.reduce((n, f) => n + f.chunks.length, 0);
  const batchCount = FIXTURES.reduce(
    (n, f) => n + promptTranslation.splitTranslationBatches(f.chunks.filter(promptTranslation.isTranslatableChunk)).length,
    0
  );

  const modelMap = {
    A: CHEAPER_INFERENCE_GPT_56_LUNA_MODEL,
    B: CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL,
  };
  fs.writeFileSync(path.join(OUT_DIR, "model-map.json"), JSON.stringify(modelMap, null, 2));

  type BlindEntry = {
    fixtureId: string;
    label: "A" | "B";
    output: string;
    metrics: Record<string, unknown>;
  };

  const blindByFixture = new Map<string, { source: string; a?: BlindEntry; b?: BlindEntry }>();
  const rawResults: unknown[] = [];
  let providerRequestCount = 0;

  for (let i = 0; i < FIXTURES.length; i++) {
    const fixture = FIXTURES[i]!;
    const translatable = fixture.chunks.filter(promptTranslation.isTranslatableChunk);
    const batches = promptTranslation.splitTranslationBatches(translatable);
    const sourceText = fixture.chunks.map((c) => c.content).join("\n\n");

    blindByFixture.set(fixture.id, { source: sourceText });

    const modelRuns: Array<{ label: "A" | "B"; model: string }> =
      i % 2 === 0
        ? [
            { label: "A", model: modelMap.A },
            { label: "B", model: modelMap.B },
          ]
        : [
            { label: "A", model: modelMap.B },
            { label: "B", model: modelMap.A },
          ];

    for (const run of modelRuns) {
      const translatedParts: string[] = [];
      const started = Date.now();
      let finishReason: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;
      let reasoningTokens: number | null = null;

      for (const batch of batches) {
        providerRequestCount += 1;
        const payload = batch
          .map((c, idx) => `⟦SEG ${idx + 1}⟧\n${c.content}\n⟦/SEG ${idx + 1}⟧`)
          .join("\n\n");
        const { text, usage } = await callPromptTranslation(
          promptTranslation.CHARACTER_TRANSLATION_SYSTEM_PROMPT,
          [{ role: "user", content: payload }],
          run.model
        );
        finishReason = usage.finishReason ?? null;
        inputTokens += usage.inputTokens;
        outputTokens += usage.outputTokens;
        reasoningTokens = (reasoningTokens ?? 0) + (usage.reasoningOutputTokens ?? 0);
        const parsed = promptTranslation.parseSegmentedResponse(text, batch.length);
        if (!parsed) {
          translatedParts.push("");
          continue;
        }
        translatedParts.push(...parsed);
      }

      const output = translatedParts.join("\n\n");
      const latencyMs = Date.now() - started;
      const metrics = {
        segmentComplete: translatedParts.every((p) => p.trim().length > 0),
        placeholdersOk: promptTranslation.validateTranslationPlaceholderPreservation(sourceText, output),
        placeholderCounts: promptTranslation.translationPlaceholderCounts(output),
        numbersPreserved: /\d/.test(sourceText) ? /\d/.test(output) : true,
        headingPreserved: countHeadings(sourceText) <= countHeadings(output) + 1,
        bracketStructurePreserved: countBracketBlocks(sourceText) <= countBracketBlocks(output) + 2,
        outputChars: output.length,
        inputTokens,
        outputTokens,
        reasoningTokens,
        latencyMs,
        finishReason,
        actualCost: "unavailable" as const,
        koreanSourceChars: sourceText.length,
        englishOutputChars: output.length,
      };

      rawResults.push({
        fixtureId: fixture.id,
        category: fixture.category,
        model: run.model,
        label: run.label,
        logicalChunkCount: translatable.length,
        batchCount: batches.length,
        ...metrics,
        rawOutput: output,
      });

      const entry: BlindEntry = { fixtureId: fixture.id, label: run.label, output, metrics };
      const slot = blindByFixture.get(fixture.id)!;
      if (run.label === "A") slot.a = entry;
      else slot.b = entry;
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, "raw-results.jsonl"), rawResults.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const blindLines: string[] = [];
  for (const fixture of FIXTURES) {
    const slot = blindByFixture.get(fixture.id)!;
    blindLines.push(`Fixture ${fixture.id}`);
    blindLines.push("SOURCE:");
    blindLines.push(slot.source);
    blindLines.push("OUTPUT A:");
    blindLines.push(slot.a?.output ?? "(missing)");
    blindLines.push("OUTPUT B:");
    blindLines.push(slot.b?.output ?? "(missing)");
    blindLines.push("");
  }
  fs.writeFileSync(path.join(OUT_DIR, "blind-review.md"), blindLines.join("\n"));

  fs.writeFileSync(
    path.join(OUT_DIR, "summary.md"),
    [
      "# PR-2 Translation A/B Summary",
      "",
      `- fixture_count: ${FIXTURES.length}`,
      `- logical_chunk_count: ${logicalChunkCount}`,
      `- batch_count: ${batchCount}`,
      `- provider_request_count: ${providerRequestCount}`,
      `- AB_HARNESS_REVIEW_READY: fixtures use production batching path; blind-review.md has no model IDs`,
    ].join("\n")
  );

  console.log(
    `fixture_count=${FIXTURES.length} logical_chunk_count=${logicalChunkCount} batch_count=${batchCount} provider_request_count=${providerRequestCount}`
  );
  console.log("AB_STATUS=RUN complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
