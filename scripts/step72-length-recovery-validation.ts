/**
 * Step 7.2 — Length Regression Recovery validation
 * Usage:
 *   npx.cmd tsx scripts/step72-length-recovery-validation.ts --compression-only
 *   npx.cmd tsx scripts/step72-length-recovery-validation.ts --generate
 *   npx.cmd tsx scripts/step72-length-recovery-validation.ts --report
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import type { CharacterGenre } from "@/lib/characterGenres";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { resolveDeepSeekTemperatureForTarget } from "@/lib/openRouterClient";
import {
  buildProductionContextForScene,
  type ProductionValidationScene,
} from "./lib/production-prompt-fixture";
import { auditWebnovelStyleText } from "./lib/webnovel-style-audit";
import { evaluateStyleQuality } from "./lib/style-quality-evaluation";
import { estimateTokens } from "@/lib/tokenEstimate";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_JSON = join(process.cwd(), "output", "step72-rp-validation.json");
const OUT_MD = join(process.cwd(), "output", "step72-length-recovery-report.md");
const OUT_COMP = join(process.cwd(), "output", "step72-compression.json");
const STEP7_JSON = join(process.cwd(), "output", "step7-rp-validation.json");

const RESTORED_TOP4 = [
  "Never end immediately after a seemingly complete moment.",
  "Continue through: emotional aftermath / body language / atmosphere change / new interaction",
  "대사마다 행동·반응·감각·분위기가 자연스럽게 따라붙게 한다.",
  "중요한 순간을 요약하지 마라.",
] as const;

type Step7Bucket = "daily" | "romance" | "fantasy" | "action" | "horror" | "mystery";

type Step7Scene = ProductionValidationScene & { bucket: Step7Bucket };

type SampleRecord = {
  id: string;
  bucket: Step7Bucket;
  genres: CharacterGenre[];
  userMessage: string;
  text: string;
  charCount: number;
  metrics: {
    aiSmell: number;
    webnovelLikeness: number;
    sentenceRhythm: number;
    immersion: number;
    repetition: number;
    handTouch: number;
    narrationWall: number;
    dialogueRhythm: number;
    humanProxy: number;
    overallScore: number;
  };
};

const STEP7_SCENES: Step7Scene[] = [
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `daily-${i}`,
    bucket: "daily" as const,
    label: "Daily",
    genres: ["현대/일상"] as CharacterGenre[],
    currentUserMessage: [
      "민수: 오늘도 커피 맛있네. 요즘 바쁘지?",
      "민수: 창가 자리 비었네. 앉아도 될까?",
      "민수: …요즘 날씨 참 좋다. 산책이라도 할까?",
      "민수: 알바 끝나면 같이 밥 먹을래?",
      "민수: 이 케이크, 너희 가게 시그니처 맞지?",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "아메리카노 하나 주세요." },
      { role: "assistant" as const, content: `서연은 메뉴판에서 시선을 들어 올렸다.\n\n"네, 잠시만요."` },
    ],
  })),
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `romance-${i}`,
    bucket: "romance" as const,
    label: "Romance",
    genres: ["로맨스"] as CharacterGenre[],
    currentUserMessage: [
      "현우: …우산, 같이 쓸래?",
      "현우: 오늘 밤, 잠깐만 같이 걸을래?",
      "현우: …손, 괜찮아?",
      "현우: 너 요즘 왜 그렇게 멀리 있는 것 같아?",
      "현우: 비 그치면… 커피라도 마실래?",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "비가 갑자기 내리네." },
      { role: "assistant" as const, content: `지우는 현관 처마 아래 서서 하늘을 올려다봤다.\n\n"…갑자기 오네."` },
    ],
  })),
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `fantasy-${i}`,
    bucket: "fantasy" as const,
    label: "Fantasy",
    genres: ["판타지/SF"] as CharacterGenre[],
    currentUserMessage: [
      "…저 문양, 전설에서 본 것 같은데.",
      "…마법진이 갑자기 빛나기 시작했어.",
      "…저 수정, 손대도 될까?",
      "…성벽 너머에서 뭔가 움직였어.",
      "…계약의 문구, 다시 읽어봐야 할 것 같아.",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "…여기까지 온 게 맞나?" },
      { role: "assistant" as const, content: `엘라는 지도를 펼쳤다.\n\n"…표식은 맞아."` },
    ],
  })),
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `action-${i}`,
    bucket: "action" as const,
    label: "Action",
    genres: ["액션/스릴러"] as CharacterGenre[],
    currentUserMessage: [
      "…적이 온다. 준비해.",
      "…문이 열린다. 숨죽여.",
      "…지금이야. 뛰어!",
      "…총알이 떨어진다. 일어나!",
      "…뒤를 돌아봐. 누군가 있어.",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "…엄폐물 뒤로." },
      { role: "assistant" as const, content: `레온은 벽에 등을 붙였다.\n\n"…알겠어."` },
    ],
  })),
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `horror-${i}`,
    bucket: "horror" as const,
    label: "Horror",
    genres: ["공포/추리"] as CharacterGenre[],
    currentUserMessage: [
      "…방금, 뭐가 움직였어?",
      "…불이 꺼졌어. 손 잡아.",
      "…저 문, 닫혀 있었는데.",
      "…뒤에서 숨소리가 들려.",
      "…거울에 내가 아닌 게 보여.",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "…이 복도, 너무 길다." },
      { role: "assistant" as const, content: `백하율은 손전등을 들어 올렸다.\n\n"…조금만 더."` },
    ],
  })),
  ...([0, 1, 2, 3, 4] as const).map((i) => ({
    id: `mystery-${i}`,
    bucket: "mystery" as const,
    label: "Mystery",
    genres: ["공포/추리"] as CharacterGenre[],
    currentUserMessage: [
      "…이 편지, 누가 보낸 거야?",
      "…알리바이가 맞지 않아.",
      "…현장에 네 지문이 있었어.",
      "…거짓말하고 있지?",
      "…진실을 말할 시간이야.",
    ][i]!,
    shortTermHistory: [
      { role: "user" as const, content: "…사건 파일, 다시 봐야겠어." },
      { role: "assistant" as const, content: `형사는 사진을 펼쳤다.\n\n"…흥미롭군."` },
    ],
  })),
];

function sampleMetrics(text: string): SampleRecord["metrics"] {
  const audit = auditWebnovelStyleText(text, { messageId: 0, chatId: 0 });
  const quality = evaluateStyleQuality(text);
  const raw = audit.raw;
  const aiSmell =
    Math.round(
      Math.max(
        0,
        10 -
          (raw.connectorSpamScore / 4 +
            raw.emotionLabelCount * 0.8 +
            Math.max(0, raw.maxConsecutiveSameStart - 2) * 0.4)
      ) * 10
    ) / 10;

  return {
    aiSmell,
    webnovelLikeness: quality.scores.webnovelLikeness,
    sentenceRhythm: quality.scores.sentenceRhythm,
    immersion: quality.scores.immersion,
    repetition: quality.scores.repetition,
    handTouch: quality.scores.handTouch,
    narrationWall: raw.maxConsecutiveNarrationBlocks,
    dialogueRhythm: Math.round(raw.dialogueCharShare * 1000) / 1000,
    humanProxy: quality.scores.humanProxyOverall,
    overallScore: audit.overallScore,
  };
}

async function buildCompressionReport() {
  const { buildContext } = await import("@/services/contextBuilder");
  const scene = STEP7_SCENES.find((s) => s.id === "horror-0")!;
  const built = buildContext(buildProductionContextForScene(scene));
  const afterTok = estimateTokens(built.systemPrompt);

  let step7Tok = 5517;
  const step7Path = STEP7_JSON;
  if (existsSync(step7Path)) {
    try {
      const step7 = JSON.parse(readFileSync(step7Path, "utf8")) as {
        compression?: { afterTokens?: number };
      };
      step7Tok = step7.compression?.afterTokens ?? step7Tok;
    } catch {
      /* default */
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    step7Tokens: step7Tok,
    step72Tokens: afterTok,
    addedTokens: afterTok - step7Tok,
    restoredRules: [...RESTORED_TOP4],
    handoffBlockPresent: built.systemPrompt.includes("<TURN_HANDOFF_AND_PACING>"),
    lengthBlockHasExpandBullet: built.systemPrompt.includes(
      "대사마다 행동·반응·감각·분위기가 자연스럽게 따라붙게 한다"
    ),
    narrativeDensityHasNoSummary: built.systemPrompt.includes("중요한 순간을 요약하지 마라"),
  };

  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(OUT_COMP, JSON.stringify(payload, null, 2));
  console.log(`Tokens: Step7 ${step7Tok} → Step7.2 ${afterTok} (+${payload.addedTokens})`);
  return payload;
}

async function generateSample(
  scene: Step7Scene,
  callOpenRouterCompletion: typeof import("@/lib/openRouterCompletion").callOpenRouterCompletion
): Promise<SampleRecord> {
  const { buildContext } = await import("@/services/contextBuilder");
  const built = buildContext(buildProductionContextForScene(scene));
  const history = built.history.slice(0, -1);
  const last = built.history[built.history.length - 1];
  const userContent = last?.role === "user" ? last.content : scene.currentUserMessage;
  const model = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;
  const temperature = resolveDeepSeekTemperatureForTarget(3200);

  let text = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await callOpenRouterCompletion({
        system: built.systemPrompt,
        history: [...history, { role: "user", content: userContent }],
        model,
        temperature,
        maxTokens: 4096,
        requestKind: "step72-length-recovery-validation",
      });
      text = res.text.trim();
      if (text.length >= 800) break;
    } catch (err) {
      if (attempt === 4) throw err;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  if (text.length < 300) {
    throw new Error(`${scene.id}: completion too short (${text.length}) after retries`);
  }

  return {
    id: scene.id,
    bucket: scene.bucket,
    genres: scene.genres,
    userMessage: userContent,
    text,
    charCount: text.length,
    metrics: sampleMetrics(text),
  };
}

async function runGeneration() {
  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : STEP7_SCENES.length;
  const scenes = STEP7_SCENES.slice(0, limit);

  let existing: { samples?: SampleRecord[] } = {};
  if (existsSync(OUT_JSON)) {
    try {
      existing = JSON.parse(readFileSync(OUT_JSON, "utf8"));
    } catch {
      existing = {};
    }
  }
  const done = new Set((existing.samples ?? []).map((s) => s.id));
  const samples: SampleRecord[] = [...(existing.samples ?? [])];

  for (const scene of scenes) {
    if (done.has(scene.id)) {
      console.log(`skip ${scene.id} (cached)`);
      continue;
    }
    console.log(`generate ${scene.id}…`);
    try {
      const sample = await generateSample(scene, callOpenRouterCompletion);
      samples.push(sample);
      writeFileSync(
        OUT_JSON,
        JSON.stringify({ generatedAt: new Date().toISOString(), samples }, null, 2)
      );
      console.log(`  ${sample.charCount} chars · human=${sample.metrics.humanProxy}`);
    } catch (err) {
      console.error(`  FAILED ${scene.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return samples;
}

function avgMetric(samples: SampleRecord[], key: keyof SampleRecord["metrics"]): number {
  if (samples.length === 0) return 0;
  return Math.round((samples.reduce((a, s) => a + s.metrics[key], 0) / samples.length) * 100) / 100;
}

function avgChars(samples: SampleRecord[]): number {
  if (samples.length === 0) return 0;
  return Math.round(samples.reduce((a, s) => a + s.charCount, 0) / samples.length);
}

function loadStep7Samples(): SampleRecord[] {
  if (!existsSync(STEP7_JSON)) return [];
  const parsed = JSON.parse(readFileSync(STEP7_JSON, "utf8")) as { samples?: SampleRecord[] };
  return parsed.samples ?? [];
}

function adoptionVerdict(step7: SampleRecord[], step72: SampleRecord[]): string {
  const lenDelta = avgChars(step72) - avgChars(step7);
  const humanDelta = avgMetric(step72, "humanProxy") - avgMetric(step7, "humanProxy");
  const aiDelta = avgMetric(step72, "aiSmell") - avgMetric(step7, "aiSmell");
  const wallDelta = avgMetric(step72, "narrationWall") - avgMetric(step7, "narrationWall");

  const lengthRecovered = lenDelta >= 400;
  const styleMaintained = humanDelta >= -0.3 && aiDelta >= -0.5 && wallDelta <= 0.8;

  if (lengthRecovered && styleMaintained) {
    return "**ADOPT Step 7.2** — meaningful length gain with style scores maintained vs Step 7.";
  }
  if (!lengthRecovered) {
    return "**REJECT (no length recovery)** — Top-4 restore insufficient; no further restoration per Step 7.2 protocol.";
  }
  return "**REJECT (style regression)** — length improved but human proxy / AI smell / narration wall degraded.";
}

async function writeReport() {
  const comp = existsSync(OUT_COMP)
    ? JSON.parse(readFileSync(OUT_COMP, "utf8"))
    : await buildCompressionReport();
  if (!existsSync(OUT_JSON)) {
    throw new Error("Missing output/step72-rp-validation.json — run --generate first");
  }
  const step72Samples = (JSON.parse(readFileSync(OUT_JSON, "utf8")) as { samples: SampleRecord[] })
    .samples;
  const step7Samples = loadStep7Samples();

  const md = [
    "# Step 7.2 — Length Regression Recovery",
    "",
    "## Restored (Top-4 only)",
    ...RESTORED_TOP4.map((r) => `- ${r}`),
    "",
    "## Prompt tokens vs Step 7",
    "",
    "| | tokens |",
    "|---|---:|",
    `| Step 7 | ${comp.step7Tokens} |`,
    `| Step 7.2 | ${comp.step72Tokens} |`,
    `| Delta | +${comp.addedTokens} |`,
    "",
    "## Output length & style (30 RP, DeepSeek V4 Pro)",
    "",
    "| metric | Step 7 | Step 7.2 | delta |",
    "|---|---:|---:|---:|",
    `| avg chars | ${avgChars(step7Samples)} | ${avgChars(step72Samples)} | ${avgChars(step72Samples) - avgChars(step7Samples) >= 0 ? "+" : ""}${avgChars(step72Samples) - avgChars(step7Samples)} |`,
    `| humanProxy | ${avgMetric(step7Samples, "humanProxy")} | ${avgMetric(step72Samples, "humanProxy")} | ${(avgMetric(step72Samples, "humanProxy") - avgMetric(step7Samples, "humanProxy")).toFixed(2)} |`,
    `| aiSmell | ${avgMetric(step7Samples, "aiSmell")} | ${avgMetric(step72Samples, "aiSmell")} | ${(avgMetric(step72Samples, "aiSmell") - avgMetric(step7Samples, "aiSmell")).toFixed(2)} |`,
    `| narrationWall | ${avgMetric(step7Samples, "narrationWall")} | ${avgMetric(step72Samples, "narrationWall")} | ${(avgMetric(step72Samples, "narrationWall") - avgMetric(step7Samples, "narrationWall")).toFixed(2)} |`,
    "",
    "## Verdict",
    "",
    adoptionVerdict(step7Samples, step72Samples),
    "",
    step7Samples.length === 0
      ? "_Warning: step7-rp-validation.json missing — style comparison incomplete._"
      : "",
  ].join("\n");

  writeFileSync(OUT_MD, md);
  console.log(`\nWrote ${OUT_MD}`);
  console.log(adoptionVerdict(step7Samples, step72Samples));
}

async function main() {
  const mode = process.argv[2] ?? "--report";
  if (mode === "--compression-only") {
    await buildCompressionReport();
    return;
  }
  if (mode === "--generate") {
    await runGeneration();
    return;
  }
  if (mode === "--report") {
    await writeReport();
    return;
  }
  console.error("Usage: --compression-only | --generate | --report");
  process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
