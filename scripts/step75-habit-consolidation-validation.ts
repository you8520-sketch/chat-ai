/**
 * Step 7.5 — Habit Consolidation validation
 * Usage:
 *   npm.cmd exec tsx -- scripts/step75-habit-consolidation-validation.ts
 *   npm.cmd exec tsx -- scripts/step75-habit-consolidation-validation.ts --generate
 */
import "./lib/server-only-mock";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import type { CharacterGenre } from "@/lib/characterGenres";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";
import { resolveDeepSeekTemperatureForTarget } from "@/lib/openRouterClient";
import { buildAdvancedProseNsfwGuidelines, PROSE_STYLE_SECTION } from "@/lib/advancedProseNsfwGuidelines";
import { buildLengthInstruction } from "@/lib/responseLength";
import { NARRATIVE_DENSITY_BLOCK } from "@/lib/sceneExpansionPolicy";
import { SCENE_CONTINUATION_PRIORITY_BLOCK } from "@/lib/turnHandoffAndPacing";
import { SPEECH_METADATA_INVISIBLE_RULE } from "@/lib/speechMetadataPolicy";
import { analyzeAuthorialHabits } from "@/lib/authorialHabitAudit";
import { evaluateStep73Sample } from "@/lib/registerMetaAudit";
import { analyzeHandTouchAudit } from "./lib/hand-touch-audit-metrics";
import { auditWebnovelStyleText } from "./lib/webnovel-style-audit";
import { evaluateStyleQuality } from "./lib/style-quality-evaluation";
import {
  buildProductionContextForScene,
  type ProductionValidationScene,
} from "./lib/production-prompt-fixture";
import { estimateTokens } from "@/lib/tokenEstimate";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const OUT_MD = join(process.cwd(), "output", "step75-habit-consolidation-validation.md");
const OUT_JSON = join(process.cwd(), "output", "step75-habit-consolidation-validation.json");
const HABIT_BASELINE = join(process.cwd(), "output", "authorial-habit-audit.json");

const OWNER_MAP = [
  { owner: "SENSATION", file: "advancedProseNsfwGuidelines.ts", habits: "hand/touch · channel depth" },
  { owner: "EMOTION", file: "advancedProseNsfwGuidelines.ts", habits: "action·breath·pace (no gaze/silence)" },
  { owner: "WEBNOVEL BREATH", file: "advancedProseNsfwGuidelines.ts", habits: "pause · 여운 · turn-end" },
  { owner: "NARRATIVE DENSITY", file: "sceneExpansionPolicy.ts", habits: "depth + M2M merged" },
  { owner: "SCENE CONTINUATION", file: "turnHandoffAndPacing.ts", habits: "handoff only" },
  { owner: "SPEECH METADATA", file: "speechMetadataPolicy.ts", habits: "register via dialogue" },
  { owner: "few-shot fallback", file: "narrationFewShotTemplates.ts", habits: "space/sound anchors" },
] as const;

const RULE_INVENTORY = [
  { id: "SENSATION-touch-owner", section: "PROSE STYLE", change: "Rewrite" },
  { id: "EMOTION-no-interpret", section: "PROSE STYLE", change: "Rewrite" },
  { id: "BREATH-pause-owner", section: "PROSE STYLE", change: "Rewrite" },
  { id: "DENSITY-merge-m2m", section: "LENGTH", change: "Merge" },
  { id: "CONTINUATION-trim", section: "LENGTH", change: "Removal" },
  { id: "FEWSHOT-space-sound", section: "canon", change: "Rewrite" },
  { id: "GENRE-no-gaze", section: "narrativeStyle", change: "Rewrite" },
] as const;

type Bucket = "romance" | "daily" | "horror" | "action";

type Step75Scene = ProductionValidationScene & { bucket: Bucket };

function buildScenes(): Step75Scene[] {
  const specs: { bucket: Bucket; genres: CharacterGenre[]; msgs: string[] }[] = [
    {
      bucket: "romance",
      genres: ["로맨스"],
      msgs: [
        "현우: …우산, 같이 쓸래?",
        "현우: 오늘 밤, 잠깐만 같이 걸을래?",
        "현우: …손, 괜찮아?",
        "현우: 비 그치면… 커피라도 마실래?",
        "현우: 너 요즘 왜 그렇게 멀리 있는 것 같아?",
      ],
    },
    {
      bucket: "daily",
      genres: ["현대/일상"],
      msgs: [
        "민수: 오늘도 커피 맛있네. 요즘 바쁘지?",
        "민수: 창가 자리 비었네. 앉아도 될까?",
        "민수: …요즘 날씨 참 좋다.",
        "민수: 알바 끝나면 같이 밥 먹을래?",
        "민수: 이 케이크, 너희 시그니처 맞지?",
      ],
    },
    {
      bucket: "horror",
      genres: ["공포/추리"],
      msgs: [
        "…방금 소리, 들었어? 뭔가 따라오는 것 같아.",
        "…저쪽 골목, 불빛이 방금 꺼졌어.",
        "…발소리야. 우리 뒤인 것 같아.",
        "…창문 밖에 누가 서 있는 것 같아.",
        "…핸드폰 신호가 끊겼어. 여기서 나가자.",
      ],
    },
    {
      bucket: "action",
      genres: ["코믹/액션"],
      msgs: [
        "레온, 적이 검을 들어 올린다!",
        "레온, 적이 좌측으로 돌진한다!",
        "레온, 성벽 가장자리까지 밀렸어!",
        "레온, 적 둘이 동시에 달려든다!",
        "레온, 지금이야 — 반격할 타이밍이야!",
      ],
    },
  ];
  const out: Step75Scene[] = [];
  for (const { bucket, genres, msgs } of specs) {
    for (let i = 0; i < 5; i++) {
      out.push({
        id: `${bucket}-${i}`,
        bucket,
        label: bucket,
        genres,
        currentUserMessage: msgs[i]!,
        shortTermHistory: [
          { role: "user", content: "…" },
          { role: "assistant", content: `백하율은 잠시 고개를 들었다.\n\n"…알겠습니다."` },
        ],
      });
    }
  }
  return out;
}

const SCENES = buildScenes();

function styleCoreTokens(): number {
  const prose = buildAdvancedProseNsfwGuidelines({ nsfwEnabled: false });
  const length = buildLengthInstruction(3200, {
    statusWindowEveryTurn: false,
    htmlFlashOwned: true,
    statusWidgetActive: false,
  });
  return estimateTokens(prose + length);
}

async function productionPromptTokens(): Promise<number> {
  const { buildContext } = await import("@/services/contextBuilder");
  const built = buildContext(buildProductionContextForScene(SCENES[0]!));
  return estimateTokens(built.systemPrompt);
}

function measureSample(text: string, genres: CharacterGenre[]) {
  const hand = analyzeHandTouchAudit(text);
  const habits = analyzeAuthorialHabits(`s`, "step75", text);
  const reg = evaluateStep73Sample("s", text, genres);
  const audit = auditWebnovelStyleText(text, { messageId: 0, chatId: 0 });
  const quality = evaluateStyleQuality(text);
  const per1k = text.length / 1000 || 1;
  const simile =
    (habits.hitsByCategory.simile_machi ?? 0) + (habits.hitsByCategory.simile_like ?? 0);
  const explain =
    (habits.hitsByCategory.explain_conclude ?? 0) + (habits.hitsByCategory.interpret_leak ?? 0);
  const silenceEnd = habits.endingTags.includes("침묵/정적") ? 1 : 0;
  const gazeEnd = habits.endingTags.includes("바라봄/시선") ? 1 : 0;
  return {
    handFrequency: hand.handFrequency,
    touchShare: hand.touchShare,
    simileDensity: Math.round((simile / per1k) * 100) / 100,
    explanationChain: explain,
    silenceEnding: silenceEnd,
    eyeContactEnding: gazeEnd,
    dialogueRegister: reg.registerSwitching === "PASS" ? "PASS" : "FAIL",
    metaNarration: reg.metaNarration === "PASS" ? "PASS" : "FAIL",
    humanProxy: quality.scores.humanProxyOverall,
    aiSmell: audit.raw.connectorSpamScore + audit.raw.emotionLabelCount,
  };
}

async function generateSample(scene: Step75Scene, attempt = 1): Promise<string> {
  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const { buildContext } = await import("@/services/contextBuilder");
  const built = buildContext(buildProductionContextForScene(scene));
  try {
    const res = await callOpenRouterCompletion({
      system: built.systemPrompt,
      history: built.history,
      model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      temperature: resolveDeepSeekTemperatureForTarget(3200),
      maxTokens: 4096,
      requestKind: "step75-habit-consolidation",
    });
    return res.text.trim();
  } catch (err) {
    if (attempt >= 3) throw err;
    console.warn(`Retry ${scene.id} (${attempt}/3):`, err instanceof Error ? err.message : err);
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return generateSample(scene, attempt + 1);
  }
}

async function main() {
  const doGenerate = process.argv.includes("--generate");
  const styleTok = styleCoreTokens();
  const prodTok = await productionPromptTokens();

  let baselineHand = 5.17;
  if (existsSync(HABIT_BASELINE)) {
    const b = JSON.parse(readFileSync(HABIT_BASELINE, "utf8")) as {
      rankedPatterns?: { label: string; density: number }[];
    };
    const hand = b.rankedPatterns?.find((r) => r.label.includes("손 anchor"));
    if (hand) baselineHand = hand.density;
  }

  const samples: { id: string; bucket: Bucket; genres: CharacterGenre[]; text: string; m: ReturnType<typeof measureSample> }[] = [];

  if (doGenerate) {
    mkdirSync(join(process.cwd(), "output"), { recursive: true });
    const existingIds = new Set<string>();
    if (existsSync(OUT_JSON)) {
      try {
        const j = JSON.parse(readFileSync(OUT_JSON, "utf8")) as { samples?: typeof samples };
        for (const s of j.samples ?? []) {
          samples.push({ ...s, m: measureSample(s.text, s.genres) });
          existingIds.add(s.id);
        }
      } catch {
        /* fresh run */
      }
    }
    for (const scene of SCENES) {
      if (existingIds.has(scene.id)) {
        console.log(`Skip ${scene.id} (cached)`);
        continue;
      }
      console.log(`Generating ${scene.id}…`);
      const text = await generateSample(scene);
      samples.push({
        id: scene.id,
        bucket: scene.bucket,
        genres: scene.genres,
        text,
        m: measureSample(text, scene.genres),
      });
      writeFileSync(
        OUT_JSON,
        JSON.stringify({ generatedAt: new Date().toISOString(), samples }, null, 2)
      );
      await new Promise((r) => setTimeout(r, 2000));
    }
  } else if (existsSync(OUT_JSON)) {
    const j = JSON.parse(readFileSync(OUT_JSON, "utf8")) as { samples?: typeof samples };
    for (const s of j.samples ?? []) {
      samples.push({ ...s, m: measureSample(s.text, s.genres) });
    }
  }

  const avg = (fn: (m: (typeof samples)[0]["m"]) => number) =>
    samples.length ? samples.reduce((a, s) => a + fn(s.m), 0) / samples.length : 0;

  const handPer1k =
    samples.length > 0
      ? samples.reduce((a, s) => a + s.m.handFrequency / (s.text.length / 1000 || 1), 0) / samples.length
      : 0;
  const explainPer1k =
    samples.length > 0
      ? samples.reduce((a, s) => a + s.m.explanationChain / (s.text.length / 1000 || 1), 0) / samples.length
      : 0;
  const registerPass = samples.filter((s) => s.m.dialogueRegister === "PASS").length;
  const metaPass = samples.filter((s) => s.m.metaNarration === "PASS").length;

  const md = [
    "# Step 7.5 — Habit Consolidation Validation",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Token diff",
    "",
    `- Style core (prose + length): **${styleTok}** tok`,
    `- Full production system prompt: **${prodTok}** tok`,
    "",
    "## Owner map (post-patch)",
    "",
    "| Owner | File | Habits |",
    "|-------|------|--------|",
    ...OWNER_MAP.map((o) => `| ${o.owner} | ${o.file} | ${o.habits} |`),
    "",
    "## Rule inventory",
    "",
    "| ID | Section | Change |",
    "|----|---------|--------|",
    ...RULE_INVENTORY.map((r) => `| ${r.id} | ${r.section} | ${r.change} |`),
    "",
    "## Production snippets",
    "",
    "### SENSATION + EMOTION + BREATH",
    "```",
    PROSE_STYLE_SECTION.match(/\[SENSATION\][\s\S]*?\[MOVEMENT & SPACE\]/)?.[0]
      ?.replace(/\n\[MOVEMENT & SPACE\]$/, "")
      .trim() ?? "",
    "",
    PROSE_STYLE_SECTION.match(/\[WEBNOVEL BREATH\][\s\S]*$/)?.[0]?.trim() ?? "",
    "```",
    "",
    "### NARRATIVE DENSITY (M2M merged)",
    "```",
    NARRATIVE_DENSITY_BLOCK,
    "```",
    "",
    "### SCENE CONTINUATION",
    "```",
    SCENE_CONTINUATION_PRIORITY_BLOCK.trim(),
    "```",
    "",
    "## RP validation (20 samples)",
    "",
    doGenerate || samples.length > 0
      ? [
          samples.length
            ? `| id | hand | touch | simile/1k | explain | silence end | gaze end | register | meta | human | ai smell |`
            : "_Run with --generate_",
          samples.length
            ? `|----|------|-------|-----------|---------|-------------|----------|----------|------|-------|----------|`
            : "",
          ...samples.map(
            (s) =>
              `| ${s.id} | ${s.m.handFrequency.toFixed(2)} | ${s.m.touchShare.toFixed(2)} | ${s.m.simileDensity} | ${s.m.explanationChain} | ${s.m.silenceEnding} | ${s.m.eyeContactEnding} | ${s.m.dialogueRegister} | ${s.m.metaNarration} | ${s.m.humanProxy.toFixed(1)} | ${s.m.aiSmell.toFixed(1)} |`
          ),
          "",
          samples.length
            ? `**Means:** hand ${avg((m) => m.handFrequency).toFixed(2)} (raw) · hand/1k ${handPer1k.toFixed(2)} · touch ${avg((m) => m.touchShare).toFixed(2)} · simile/1k ${avg((m) => m.simileDensity).toFixed(2)} · explain/1k ${explainPer1k.toFixed(2)} · human ${avg((m) => m.humanProxy).toFixed(1)}`
            : "",
          samples.length
            ? `**Register / meta:** ${registerPass}/20 register · ${metaPass}/20 meta · silence-end ${samples.filter((s) => s.m.silenceEnding).length} · gaze-end ${samples.filter((s) => s.m.eyeContactEnding).length}`
            : "",
          samples.length
            ? `**vs habit audit (61 logs):** hand/1k ~5.17 · explain/1k ~2.74 · simile/1k ~2.14 · silence-end 37.7% · gaze-end 52.5%`
            : "",
        ].join("\n")
      : "_No samples — run with `--generate`_",
    "",
  ].join("\n");

  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(OUT_MD, md);
  console.log(`Report: ${OUT_MD}`);
  if (samples.length > 0) {
    console.log(
      `Means: hand=${avg((m) => m.handFrequency).toFixed(2)} touch=${avg((m) => m.touchShare).toFixed(2)} simile/1k=${avg((m) => m.simileDensity).toFixed(2)} human=${avg((m) => m.humanProxy).toFixed(1)}`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
