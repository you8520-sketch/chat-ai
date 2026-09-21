/**
 * Bounded live RP smoke — DeepSeek V4 Pro vs V4.1 Flash (5 paired fixtures).
 * Run: node --conditions=react-server --import tsx scripts/deepseek-v41-integration-rp-ab.ts
 */
import Module from "module";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
  CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
} from "@/lib/chatModels";
import { canonicalizePublishedModelId } from "@/lib/publishedModelAliases";
import { streamOpenRouterAdult } from "@/lib/openRouterAdult";
import { buildContext } from "@/services/contextBuilder";
import type { ChatMsg } from "@/lib/ai";
import type { CharacterChunk } from "@/types";

const OUT_DIR = join(process.cwd(), "docs/audits/deepseek-v41-integration-2026-09-21/rp-ab");

const originalLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  // @ts-expect-error legacy hook
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const BASE_CHUNKS: CharacterChunk[] = [
  {
    id: "c-identity",
    characterId: "13",
    content: "[Identity]\n강이현, 29세, 검은 장미단 부단장.",
    category: "identity",
    importance: "CRITICAL",
    tokenCount: 30,
    keywords: ["강이현"],
  },
  {
    id: "c-lore",
    characterId: "13",
    content:
      "[Lore]\n왕실 수호대 견습 실패 사건 이후 '약한 사람을 지키지 못했다'는 죄책감.",
    category: "lore",
    importance: "HIGH",
    tokenCount: 30,
    keywords: ["견습"],
  },
];

type Fixture = {
  id: string;
  userMessage: string;
  history: ChatMsg[];
  nsfw?: boolean;
  targetChars?: number;
};

const FIXTURES: Fixture[] = [
  { id: "D_lore", userMessage: "…기억하고 싶지 않아.", history: [{ role: "user", content: "말해줘도 돼." }] },
  { id: "F_speech_lock", userMessage: "3200자 분량으로 이어서 써줘.", history: [] },
  {
    id: "G_long_memory",
    userMessage: "우리 전에 얘기했던 그 일 기억해?",
    history: [{ role: "assistant", content: "…그때 네가 말했지." }],
  },
  { id: "H_long_output", userMessage: "장면을 길게 이어서 써줘.", history: [], targetChars: 3500 },
  { id: "J_adult_fixture", userMessage: "조금 더 가까이 와.", history: [], nsfw: true },
];

async function runFixture(fixture: Fixture, modelId: string, blindLabel: "A" | "B") {
  const ctx = buildContext({
    charName: "강이현",
    chunks: BASE_CHUNKS,
    userNickname: "민수",
    shortTermHistory: fixture.history,
    currentUserMessage: fixture.userMessage,
    nsfw: fixture.nsfw ?? false,
    modelId,
    provider: "cheaperinference",
  });

  const targetChars = fixture.targetChars ?? 3200;
  const started = performance.now();
  let ttftMs: number | null = null;
  let firstChunk = true;
  const stream = streamOpenRouterAdult(
    ctx.systemPrompt,
    ctx.history,
    modelId,
    targetChars,
    {
      transportProvider: "cheaperinference",
      allowOpenRouterUnderLengthRecovery: false,
      allowEmptyStreamFallback: false,
    },
    { requestKind: "v41-integration-ab", chargeTurnBudget: false }
  );

  let fullText = "";
  let iter = await stream.next();
  while (!iter.done) {
    if (firstChunk) {
      ttftMs = performance.now() - started;
      firstChunk = false;
    }
    fullText += iter.value;
    iter = await stream.next();
  }
  const usage = iter.value;
  const responseModelId = usage.responseModelId ?? modelId;
  const visible = fullText.replace(/<<<STATUS[\s\S]*/i, "").trim();

  return {
    fixtureId: fixture.id,
    blindLabel,
    requestedModelId: modelId,
    responseModelId,
    canonicalResponseModelId: canonicalizePublishedModelId(responseModelId),
    modelMismatch: responseModelId !== modelId && canonicalizePublishedModelId(responseModelId) !== modelId,
    latencyMs: Math.round(performance.now() - started),
    ttftMs: ttftMs != null ? Math.round(ttftMs) : null,
    outputChars: visible.length,
    finishReason: usage.finishReason ?? null,
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      reasoningTokens: usage.reasoningOutputTokens ?? 0,
    },
    samplePath: `${fixture.id}_Sample_${blindLabel}.txt`,
    sampleText: visible,
  };
}

function assignBlind(seed: string): Record<"pro" | "v41", "A" | "B"> {
  const swap = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 2), 16) % 2 === 0;
  return swap ? { pro: "B", v41: "A" } : { pro: "A", v41: "B" };
}

async function main() {
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(
      join(OUT_DIR, "operational.json"),
      JSON.stringify({ skipped: true, reason: "CHEAPER_INFERENCE_API_KEY missing" }, null, 2)
    );
    console.error("SKIP: no CI key");
    process.exit(0);
  }

  const labels = assignBlind("deepseek-v41-integration-2026-09-21");
  const operational = [];
  const samplesDir = join(OUT_DIR, "samples");
  mkdirSync(samplesDir, { recursive: true });

  for (const fixture of FIXTURES) {
    for (const [kind, modelId] of [
      ["pro", CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL],
      ["v41", CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL],
    ] as const) {
      const blindLabel = labels[kind];
      const row = await runFixture(fixture, modelId, blindLabel);
      operational.push(row);
      writeFileSync(join(samplesDir, row.samplePath), row.sampleText, "utf8");
      const { sampleText: _drop, ...meta } = row;
      operational[operational.length - 1] = meta;
    }
  }

  writeFileSync(join(OUT_DIR, "operational.json"), JSON.stringify({ operational }, null, 2));
  writeFileSync(
    join(OUT_DIR, "model-map.json"),
    JSON.stringify(
      {
        note: "GPT review only",
        A: labels.pro === "A" ? CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL : CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
        B: labels.pro === "B" ? CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL : CHEAPER_INFERENCE_DEEPSEEK_V41_FLASH_MODEL,
      },
      null,
      2
    )
  );
  console.log("Wrote", join(OUT_DIR, "operational.json"), `(${operational.length} calls)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
