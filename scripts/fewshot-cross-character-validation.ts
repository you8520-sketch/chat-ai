/**
 * Cross-character few-shot ablation — same structural template, 3 speech tones.
 * 3 profiles × 4 scenes × 3 runs × 2 = 72 API (screening: --runs=3)
 */
import "./lib/server-only-mock";

import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import { PROSE_VARIATION_SCENES } from "./lib/prose-variation-metrics";
import {
  HAND_TOUCH_METRIC_DEFS,
  analyzeHandTouchAudit,
  handTouchMetricValue,
} from "./lib/hand-touch-audit-metrics";
import {
  countHandLexInText,
  countSpaceSoundLexInText,
  proseSceneToFewShotScene,
} from "./lib/fewshot-hand-ablation-fixture";
import {
  buildHandHeavyFewShot,
  buildSpaceSoundFewShot,
  NARRATION_FEWSHOT_PROFILES,
  type NarrationFewShotProfile,
} from "@/lib/narrationFewShotTemplates";
import { parseCharacterSetting } from "@/utils/characterParser";
import { buildPairedMetricReport, type PairedMetricReport } from "./lib/paired-comparison-stats";
import { improvementDelta, isAfterBetter } from "./lib/prose-variation-metrics";
import { formatSelectedPersonaForPrompt } from "@/lib/userPersonas";
import { formatUserNoteForPrompt } from "@/lib/persona";
import { formatMemoryMetaForPrompt, parseMemoryMeta } from "@/lib/chatMemory";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "@/lib/chatModels";

loadEnvLocal();
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const TEMPERATURE = 0.85;
const DEFAULT_RUNS = 3;

type PairRecord = {
  profileId: string;
  profileLabel: string;
  sceneId: string;
  sceneLabel: string;
  runIndex: number;
  before: { text: string; metrics: ReturnType<typeof analyzeHandTouchAudit> };
  after: { text: string; metrics: ReturnType<typeof analyzeHandTouchAudit> };
};

function parseRunsArg(): number {
  const arg = process.argv.find((a) => a.startsWith("--runs="));
  if (!arg) return DEFAULT_RUNS;
  const n = Number.parseInt(arg.split("=")[1] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RUNS;
}

function pairKey(profileId: string, sceneId: string, runIndex: number): string {
  return `${profileId}#${sceneId}#${runIndex}`;
}

function profileSystemPrompt(p: NarrationFewShotProfile): string {
  if (p.id === "formal") {
    return `# 성격\n냉정하고 규율적이다.\n\n# 말투\n- 평소: "~습니다", "~요" 존댓말\n- 긴장: 문장 단축`;
  }
  if (p.id === "casual") {
    return `# 성격\n다정하고 관찰력이 있다.\n\n# 말투\n- 평소: "~요", "~네" 부드러운 존댓말`;
  }
  return `# 성격\n냉철하고 직설적이다.\n\n# 말투\n- 평소: 반말, 짧은 문장`;
}

function buildChunks(profile: NarrationFewShotProfile, handHeavy: boolean) {
  const exampleDialog = handHeavy
    ? buildHandHeavyFewShot(profile)
    : buildSpaceSoundFewShot(profile);
  return parseCharacterSetting({
    characterId: `cross-${profile.id}`,
    characterName: profile.charName,
    gender: profile.id === "casual" ? "female" : "other",
    systemPrompt: profileSystemPrompt(profile),
    world: `# 세계관\n현대·판타지 혼합 도시.`,
    exampleDialog,
    statusWindowPrompt: "",
  });
}

async function main() {
  const fresh = process.argv.includes("--fresh");
  const dryRun = process.argv.includes("--dry-run");
  const runsPerScene = parseRunsArg();
  const outDir = join(process.cwd(), "output");
  mkdirSync(outDir, { recursive: true });
  const checkpointPath = join(outDir, "fewshot-cross-character-checkpoint.json");
  const resultPath = join(outDir, "fewshot-cross-character-validation.json");

  const { buildContext } = await import("@/services/contextBuilder");
  const personaDisplayName = "렌";
  const shared = {
    userPersona: formatSelectedPersonaForPrompt(personaDisplayName, "other", "20대."),
    userNote: formatUserNoteForPrompt("지인."),
    longTermMemory: "",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta("{}")),
    nsfw: true,
    userPersonaGender: "other" as const,
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 3200,
    completedTurns: 6,
    provider: "openrouter" as const,
    modelId: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
  };

  function systemFor(profile: NarrationFewShotProfile, sceneId: string, handHeavy: boolean): string {
    const proseScene = PROSE_VARIATION_SCENES.find((s) => s.id === sceneId)!;
    const scene = proseSceneToFewShotScene(proseScene);
    return buildContext({
      charName: profile.charName,
      personaDisplayName,
      userNickname: personaDisplayName,
      chunks: buildChunks(profile, handHeavy),
      ...shared,
      gender: profile.id === "casual" ? "female" : "male",
      shortTermHistory: scene.shortTermHistory,
      currentUserMessage: scene.currentUserMessage,
      genres: scene.genres,
    }).systemPrompt;
  }

  const totalPairs =
    NARRATION_FEWSHOT_PROFILES.length * PROSE_VARIATION_SCENES.length * runsPerScene;
  console.log("=== Cross-Character Few-shot Structure Validation ===");
  console.log(`Profiles: ${NARRATION_FEWSHOT_PROFILES.map((p) => p.label).join(" | ")}`);
  console.log(`Runs/scene: ${runsPerScene} | Paired jobs: ${totalPairs} | API: ${totalPairs * 2}`);

  for (const p of NARRATION_FEWSHOT_PROFILES) {
    const handEx = buildHandHeavyFewShot(p);
    const spaceEx = buildSpaceSoundFewShot(p);
    console.log(
      `[${p.id}] hand-lex ${countHandLexInText(handEx)} → space-lex ${countSpaceSoundLexInText(spaceEx)} (space hand-lex ${countHandLexInText(spaceEx)})`
    );
  }

  if (dryRun) return;

  if (fresh && existsSync(checkpointPath)) unlinkSync(checkpointPath);

  type Checkpoint = { pairs: PairRecord[]; model: string; runsPerScene: number };
  let checkpoint: Checkpoint = existsSync(checkpointPath)
    ? (JSON.parse(readFileSync(checkpointPath, "utf8")) as Checkpoint)
    : { pairs: [], model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL, runsPerScene };

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY required");
    process.exit(1);
  }

  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const done = new Set(checkpoint.pairs.map((p) => pairKey(p.profileId, p.sceneId, p.runIndex)));
  let n = done.size;
  const total = totalPairs;

  for (const profile of NARRATION_FEWSHOT_PROFILES) {
    for (const scene of PROSE_VARIATION_SCENES) {
      const userContent = `${scene.setup}\n\n${scene.user}`;
      for (let runIndex = 0; runIndex < runsPerScene; runIndex++) {
        const key = pairKey(profile.id, scene.id, runIndex);
        if (done.has(key)) continue;
        console.log(`[${++n}/${total}] ${profile.label} · ${scene.label} run ${runIndex + 1}`);

        const sysBefore = systemFor(profile, scene.id, true);
        const sysAfter = systemFor(profile, scene.id, false);

        for (let attempt = 0; attempt < 6; attempt++) {
          try {
            const beforeRes = await callOpenRouterCompletion({
              system: sysBefore,
              history: [{ role: "user", content: userContent }],
              model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
              temperature: TEMPERATURE,
              maxTokens: 4096,
              requestKind: "fewshot-cross-character",
            });
            const afterRes = await callOpenRouterCompletion({
              system: sysAfter,
              history: [{ role: "user", content: userContent }],
              model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
              temperature: TEMPERATURE,
              maxTokens: 4096,
              requestKind: "fewshot-cross-character",
            });
            const beforeText = beforeRes.text.trim();
            const afterText = afterRes.text.trim();
            if (beforeText.length < 200 || afterText.length < 200) throw new Error("short");

            checkpoint.pairs.push({
              profileId: profile.id,
              profileLabel: profile.label,
              sceneId: scene.id,
              sceneLabel: scene.label,
              runIndex,
              before: { text: beforeText, metrics: analyzeHandTouchAudit(beforeText) },
              after: { text: afterText, metrics: analyzeHandTouchAudit(afterText) },
            });
            done.add(key);
            writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), "utf8");
            break;
          } catch (e) {
            if (attempt === 5) throw e;
            await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
          }
        }
      }
    }
  }

  const reports: PairedMetricReport[] = HAND_TOUCH_METRIC_DEFS.map((def) => {
    const beforeValues: number[] = [];
    const afterValues: number[] = [];
    const improvements: number[] = [];
    let wins = 0;
    let ties = 0;
    for (const pair of checkpoint.pairs) {
      const b = handTouchMetricValue(pair.before.metrics, def.key);
      const a = handTouchMetricValue(pair.after.metrics, def.key);
      beforeValues.push(b);
      afterValues.push(a);
      const imp = improvementDelta(b, a, def.higherIsBetter);
      improvements.push(imp);
      if (b === a) ties++;
      else if (isAfterBetter(b, a, def.higherIsBetter)) wins++;
    }
    return buildPairedMetricReport({
      metricKey: def.key,
      label: def.label,
      higherIsBetter: def.higherIsBetter,
      beforeValues,
      afterValues,
      improvements,
      wins,
      ties,
    });
  });

  const perProfile = NARRATION_FEWSHOT_PROFILES.map((profile) => {
    const subset = checkpoint.pairs.filter((p) => p.profileId === profile.id);
    const touch = subset.map((p) => ({
      b: p.before.metrics.touchShare,
      a: p.after.metrics.touchShare,
    }));
    const hand = subset.map((p) => ({
      b: p.before.metrics.handFrequency,
      a: p.after.metrics.handFrequency,
    }));
    const touchWins = touch.filter((x) => x.a < x.b).length;
    const handWins = hand.filter((x) => x.a < x.b).length;
    return {
      profileId: profile.id,
      label: profile.label,
      n: subset.length,
      touchShareMeanBefore: touch.reduce((s, x) => s + x.b, 0) / (touch.length || 1),
      touchShareMeanAfter: touch.reduce((s, x) => s + x.a, 0) / (touch.length || 1),
      touchWinRate: touchWins / (touch.length || 1),
      handFreqWinRate: handWins / (hand.length || 1),
    };
  });

  const allProfilesTouchImproved = perProfile.every((p) => p.touchWinRate >= 0.5);
  const pooledTouch = reports.find((r) => r.metricKey === "touchShare");
  const rolloutRecommended =
    pooledTouch?.significantAt95 &&
    pooledTouch.verdict === "improved" &&
    perProfile.filter((p) => p.touchWinRate >= 0.5).length >= 2;

  const result = {
    test: "fewshot-cross-character-structure",
    runsPerScene,
    pairedSamples: checkpoint.pairs.length,
    metrics: reports,
    perProfile,
    rolloutRecommended,
    pairs: checkpoint.pairs,
  };
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");

  console.log("\n=== Pooled metrics ===");
  for (const r of reports) {
    console.log(
      `${r.label}: before=${r.before.mean} after=${r.after.mean} winRate=${(r.winRate * 100).toFixed(0)}% ${r.verdict}${r.significantAt95 ? " *" : ""}`
    );
  }
  console.log("\n=== Per profile (touch share) ===");
  for (const p of perProfile) {
    console.log(
      `${p.label}: touch ${p.touchShareMeanBefore.toFixed(3)}→${p.touchShareMeanAfter.toFixed(3)} winRate=${(p.touchWinRate * 100).toFixed(0)}%`
    );
  }
  console.log(`\nRollout recommended: ${rolloutRecommended}`);
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
