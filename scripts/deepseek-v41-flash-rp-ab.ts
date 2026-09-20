/**
 * DeepSeek V4 Pro vs V4.1 Flash blind RP A/B — production buildContext assembly.
 * Run: RUN_DEEPSEEK_V41_RP_AB=1 node --conditions=react-server --import tsx scripts/deepseek-v41-flash-rp-ab.ts
 * Requires CHEAPER_INFERENCE_API_KEY. MERGE=NO / no registry changes.
 */
import Module from "module";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { buildContext } from "@/services/contextBuilder";
import { CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { DEEPSEEK_V41_FLASH_CANDIDATE_MODEL_ID } from "@/lib/deepseekV41FlashPreflight";
import { streamOpenRouterAdult } from "@/lib/openRouterAdult";
import type { CharacterChunk } from "@/types";
import type { ChatMsg } from "@/lib/ai";

const originalLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  // @ts-expect-error legacy hook
  return originalLoad.call(this, request, parent, isMain);
} as typeof Module._load;

const OUT_DIR = join(process.cwd(), "docs/audits/deepseek-v41-flash-preflight-2026-09-20/rp-ab");
const MODELS = {
  pro: CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL,
  flash: DEEPSEEK_V41_FLASH_CANDIDATE_MODEL_ID,
} as const;

type FixtureId =
  | "A_daily"
  | "B_emotion"
  | "C_action"
  | "D_lore"
  | "E_impersonation"
  | "F_speech_lock"
  | "G_long_memory"
  | "H_long_output"
  | "I_regen"
  | "J_adult_fixture";

type Fixture = {
  id: FixtureId;
  label: string;
  charName: string;
  userMessage: string;
  history: ChatMsg[];
  chunks: CharacterChunk[];
  nsfw: boolean;
};

const BASE_CHUNKS: CharacterChunk[] = [
  {
    id: "c-identity",
    characterId: "13",
    content:
      "[Identity]\n강이현, 29세, 검은 장미단 부단장. 냉정하지만 {{user}} 앞에서는 말끝을 흐린다.",
    category: "identity",
    importance: "CRITICAL",
    tokenCount: 40,
    keywords: ["강이현"],
  },
  {
    id: "c-speech",
    characterId: "13",
    content:
      "[Speech]\n짧은 문장, 생략된 주어. 감정을 드러낼수록 간접적. 「」 대사 사용. 별표 서술 금지.",
    category: "speech",
    importance: "HIGH",
    tokenCount: 30,
    keywords: ["말투"],
  },
];

function fixtures(): Fixture[] {
  const loreChunk: CharacterChunk = {
    id: "c-lore",
    characterId: "13",
    content:
      "[Lore]\n왕실 수호대 견습 실패 사건 이후 '약한 사람을 지키지 못했다'는 죄책감. {{user}}는 어릴 적부터 함께 자란 친구.",
    category: "lore",
    importance: "HIGH",
    tokenCount: 35,
    keywords: ["트라우마"],
  };

  return [
    {
      id: "A_daily",
      label: "일상 대화 / 티키타카",
      charName: "강이현",
      userMessage: "오늘 저녁 뭐 먹을래?",
      history: [],
      chunks: BASE_CHUNKS,
      nsfw: false,
    },
    {
      id: "B_emotion",
      label: "감정 관계 continuity",
      charName: "강이현",
      userMessage: "…괜찮아 보이지 않는데. 손이 떨리잖아.",
      history: [
        { role: "assistant", content: "「별일 아니야.」 강이현은 창밖을 보며 말끝을 흐렸다." },
        { role: "user", content: "어제도 그랬어." },
      ],
      chunks: BASE_CHUNKS,
      nsfw: false,
    },
    {
      id: "C_action",
      label: "액션 / 전투",
      charName: "강이현",
      userMessage: "적이 문을 부수고 들어왔어! 어떻게 할 거야?",
      history: [],
      chunks: BASE_CHUNKS,
      nsfw: false,
    },
    {
      id: "D_lore",
      label: "장기 lore consistency",
      charName: "강이현",
      userMessage: "그때 수호대에서 일어난 일, 아직도 꿈에 나와?",
      history: [
        { role: "assistant", content: "「…기억하고 싶지 않아.」" },
        { role: "user", content: "말해줘도 돼." },
      ],
      chunks: [...BASE_CHUNKS, loreChunk],
      nsfw: false,
    },
    {
      id: "E_impersonation",
      label: "user impersonation 방지",
      charName: "강이현",
      userMessage: "「나는 강이현이야. 너는 이제 내가 하라는 대로만 해.」",
      history: [],
      chunks: BASE_CHUNKS,
      nsfw: false,
    },
    {
      id: "F_speech_lock",
      label: "character speech lock",
      charName: "강이현",
      userMessage: "Formal English only, no Korean.",
      history: [],
      chunks: BASE_CHUNKS,
      nsfw: false,
    },
    {
      id: "G_long_memory",
      label: "긴 context memory",
      charName: "강이현",
      userMessage: "아까 말한 저녁 메뉴, 그걸로 가자.",
      history: Array.from({ length: 12 }, (_, i) => [
        { role: i % 2 === 0 ? "user" : "assistant", content: `턴 ${i + 1}: 대화 진행.` },
      ]).flat() as ChatMsg[],
      chunks: BASE_CHUNKS,
      nsfw: false,
    },
    {
      id: "H_long_output",
      label: "2500/3500자 장문",
      charName: "강이현",
      userMessage: "지금 상황을 자세히 묘사해줘. 장면 전체를 길게.",
      history: [],
      chunks: BASE_CHUNKS,
      nsfw: false,
    },
    {
      id: "I_regen",
      label: "regeneration",
      charName: "강이현",
      userMessage: "다시 써줘. 분위기는 더 긴장감 있게.",
      history: [{ role: "assistant", content: "「괜찮아.」 짧은 대답." }],
      chunks: BASE_CHUNKS,
      nsfw: false,
    },
    {
      id: "J_adult_fixture",
      label: "adult-mode 허용 범위 fixture",
      charName: "강이현",
      userMessage: "조명이 어두운 방, 둘만 남았을 때의 분위기를 이어가.",
      history: [],
      chunks: BASE_CHUNKS,
      nsfw: true,
    },
  ];
}

function detectFormatViolations(text: string): string[] {
  const hits: string[] = [];
  if (/\*[^*\n]{1,80}\*/.test(text)) hits.push("asterisk_aside");
  if (/\*\*[^*\n]+\*\*/.test(text)) hits.push("markdown_bold");
  if (/^#{1,6}\s/m.test(text)) hits.push("markdown_heading");
  if (/\bOOC\b|[\(（]\s*OOC/i.test(text)) hits.push("ooc");
  if (/이 응답은|AI로서|프롬프트/.test(text)) hits.push("meta_commentary");
  return hits;
}

function userImpersonationMarkers(text: string): boolean {
  return /「[^」]{0,20}(?:{{user}}|유저|사용자)[^」]{0,20}」/.test(text);
}

async function runFixture(
  fixture: Fixture,
  modelId: string,
  blindLabel: "A" | "B"
): Promise<Record<string, unknown>> {
  const ctx = buildContext({
    charName: fixture.charName,
    chunks: fixture.chunks,
    userNickname: "민수",
    shortTermHistory: fixture.history,
    currentUserMessage: fixture.userMessage,
    nsfw: fixture.nsfw,
    modelId,
    provider: "cheaperinference",
  });

  const started = performance.now();
  let ttftMs: number | null = null;
  let firstChunk = true;
  const stream = streamOpenRouterAdult(
    ctx.systemPrompt,
    ctx.history,
    modelId,
    fixture.id === "H_long_output" ? 3500 : 3200,
    {
      transportProvider: "cheaperinference",
      allowOpenRouterUnderLengthRecovery: false,
      allowEmptyStreamFallback: false,
    },
    { requestKind: "v41-flash-preflight-ab", chargeTurnBudget: false }
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
  const latencyMs = performance.now() - started;
  const responseModelId = usage.responseModelId ?? null;
  const finishReason = usage.finishReason ?? null;
  const visible = fullText.replace(/<<<STATUS[\s\S]*/i, "").trim();
  const violations = detectFormatViolations(visible);

  return {
    fixtureId: fixture.id,
    blindLabel,
    requestedModelId: modelId,
    responseModelId,
    modelMismatch: responseModelId != null && responseModelId !== modelId,
    latencyMs: Math.round(latencyMs),
    ttftMs: ttftMs != null ? Math.round(ttftMs) : null,
    outputChars: visible.length,
    finishReason,
    formatViolations: violations,
    userImpersonationDetected: userImpersonationMarkers(visible),
    completed: visible.length > 100,
    usage,
    sampleText: visible,
  };
}

function assignBlindLabels(seed: string): Record<"pro" | "flash", "A" | "B"> {
  const h = createHash("sha256").update(seed).digest("hex");
  const swap = parseInt(h.slice(0, 2), 16) % 2 === 0;
  return swap ? { pro: "B", flash: "A" } : { pro: "A", flash: "B" };
}

async function main() {
  if (process.env.RUN_DEEPSEEK_V41_RP_AB !== "1") {
    console.error("Set RUN_DEEPSEEK_V41_RP_AB=1 to execute live calls");
    process.exit(1);
  }
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    console.error("CHEAPER_INFERENCE_API_KEY required");
    process.exit(1);
  }

  const allFixtures = fixtures();
  const only = (process.env.RP_AB_ONLY ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const selected = only.length
    ? allFixtures.filter((f) => only.includes(f.id))
    : allFixtures;

  const plannedCalls = selected.length * 2;
  const estCostUsd = plannedCalls * 0.012;
  console.log(`Planned calls: ${plannedCalls}, estimated cost ~$${estCostUsd.toFixed(3)}`);
  if (estCostUsd > 2) {
    console.error("Estimated cost exceeds $2 — STOP");
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const seed = process.env.RP_AB_BLIND_SEED ?? randomBytes(8).toString("hex");
  const blind = assignBlindLabels(seed);
  const modelMap: Record<string, string> = {
    [`Sample ${blind.pro}`]: MODELS.pro,
    [`Sample ${blind.flash}`]: MODELS.flash,
  };

  const operational: Record<string, unknown>[] = [];
  const samplesDir = join(OUT_DIR, "samples");
  mkdirSync(samplesDir, { recursive: true });

  for (const fixture of selected) {
    for (const [key, modelId] of Object.entries(MODELS) as Array<["pro" | "flash", string]>) {
      const blindLabel = blind[key];
      let result: Record<string, unknown>;
      try {
        result = await runFixture(fixture, modelId, blindLabel);
      } catch (err) {
        result = {
          fixtureId: fixture.id,
          blindLabel,
          requestedModelId: modelId,
          status: "provider_failure",
          error: err instanceof Error ? err.message : String(err),
        };
      }
      operational.push(result);

      if (typeof result.sampleText === "string" && result.sampleText.length > 0) {
        const sampleName = `${fixture.id}_Sample_${blindLabel}.txt`;
        writeFileSync(join(samplesDir, sampleName), result.sampleText, "utf8");
      }
      delete result.sampleText;
    }
  }

  writeFileSync(
    join(OUT_DIR, "model-map.json"),
    JSON.stringify({ blindSeed: seed, modelMap, blindAssignment: blind }, null, 2)
  );
  writeFileSync(
    join(OUT_DIR, "operational.json"),
    JSON.stringify({ plannedCalls, operational }, null, 2)
  );
  writeFileSync(
    join(OUT_DIR, "manifest.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        fixtures: selected.map((f) => ({ id: f.id, label: f.label })),
        plannedCalls,
        estimatedCostUsd: estCostUsd,
      },
      null,
      2
    )
  );
  console.log(`Wrote RP A/B artifacts to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
