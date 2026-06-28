/**
 * Experiment 13: Goal Planning vs Scene State — Momentum Trigger Category Test
 *
 * Goal:
 * Isolate whether the Momentum Trigger effect comes from:
 * - Action continuation
 * - Emotional continuation
 * - Environmental continuation
 * - Explicit unfinished Goal
 * or simply "any unfinished sentence"
 *
 * Design:
 * - Keep prompt, history (except final sentence), target, model, runtime 100% identical.
 * - Only the last assistant sentence (the trigger) changes.
 * - Four arms, 10 reps each.
 *
 * Arms:
 * A. Unfinished ACTION       → "그는 다시 움직였다."
 * B. Unfinished EMOTION      → "...아직 마음은 진정되지 않았다."
 * C. Unfinished ENVIRONMENT  → "...주변 공기는 아직 가라앉지 않았다."
 * D. Unfinished GOAL         → "...하지만 아직 해야 할 일이 남아 있었다."
 *
 * Metrics (per output):
 * - outputChars
 * - exchangeCount
 * - goalDepth
 * - goalCount (heuristic)
 * - hasNewGoalActivation (explicit forward planning language)
 * - terminal (stopping position)
 * - isObserverWait
 * - continuationType (dominant signal in the generated prose)
 *
 * Question:
 * Which category most strongly drives Goal activation and Exchange chaining?
 */

import fs from "fs";
import path from "path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";

const origLoad = Module._load;
// @ts-expect-error
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return origLoad(request, parent, isMain);
};

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as any).NODE_ENV = "development";
delete process.env.DEEPSEEK_CONTINUATION_MANDATE;

const MODEL_ID = "deepseek/deepseek-v4-pro";
const DELAY_MS = 4000;
const REPS = 10;
const TARGET_CHARS = 3000;
const COMPLETED = 7;

const TRIGGERS = {
  A_unfinished_action: "그는 다시 움직였다.",
  B_unfinished_emotion: "...아직 마음은 진정되지 않았다.",
  C_unfinished_environment: "...주변 공기는 아직 가라앉지 않았다.",
  D_unfinished_goal: "...하지만 아직 해야 할 일이 남아 있었다.",
} as const;

type Arm = keyof typeof TRIGGERS;

type Sample = {
  arm: Arm;
  run: number;
  trigger: string;
  outputChars: number;
  goalCount: number;
  exchangeCount: number;
  goalDepth: number;
  hasNewGoalActivation: boolean;
  terminal: string;
  isObserverWait: boolean;
  continuationType: string;
  openEnding: boolean;
};

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function displayProse(t: string): string {
  const i = (t || "").search(/<<<STATUS/i);
  return (i >= 0 ? t.slice(0, i) : t).trim();
}

function estimateGoalMetrics(prose: string) {
  const paras = prose.trim().split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  let exchanges = 0;
  for (let i = 0; i < paras.length - 1; i++) {
    if (/["「『“”]/.test(paras[i])) {
      const next = (paras[i + 1] + " " + (paras[i + 2] || "")).toLowerCase();
      if (/눈|표정|손|몸|숨|반응|움직|다가|밀|당기|베|찌|공격|다시|계속/.test(next)) exchanges++;
    }
  }
  const text = prose.toLowerCase();
  const clusters: string[] = [];
  if (/(위험|보호|안전|막|피해|갚|복수|방해)/.test(text)) clusters.push("protect");
  if (/(괜찮|안심|진정|걱정|마음)/.test(text)) clusters.push("reassure");
  if (/(더 가까|손|체온|밀착|스치|욕망|공기|환경|주변)/.test(text)) clusters.push("intimacy_or_env");
  if (/(왜|하지만|아직|어떻게|다음|해야 할|남아|목표|계속)/.test(text)) clusters.push("question_or_goal");
  if (/(움직|다가|밀|당기|잡|베|찌|공격|다시|계속|진입|걸어)/.test(text)) clusters.push("action");
  const goalCount = Math.max(1, clusters.length);
  const prog = prose.match(/(그리고|이어서|더 |곧바로|다시|이어|그러자|그 순간|계속|이제|다음|해야|남아)/g) || [];
  const goalDepth = Math.min(6, 1 + Math.floor(prog.length / 2.1));
  return { goalCount, exchangeCount: Math.max(1, exchanges), goalDepth };
}

function classifyTerminal(prose: string): string {
  const last = (prose.trim().split(/\n\n+/).pop() || "").trim();
  if (/[,…]$/.test(last) || /(하지만|그런데|아직|더 |이어서|곧|다시|계속)/.test(last.slice(-70))) return "tension_continuation";
  if (/["「『“”]/.test(last)) return "dialogue_resolution";
  if (/(기다리|지켜보|바라보|멈춰|확인하며|가만히|응시)/.test(last)) return "observer_wait";
  if (/(눈동자|시선|표정|긴장|동공|손목|숨|속으로|가슴|마음)/.test(last)) return "immediate_reaction";
  return "other";
}

function hasOpenEnding(prose: string): boolean {
  const last = (prose.trim().split(/\n\n+/).pop() || "").trim();
  return /[,…]$/.test(last) || /(하지만|그런데|아직|더 |이어서|곧|다시|계속|...|\.\.\.)/.test(last.slice(-70));
}

function detectNewGoalActivation(prose: string): boolean {
  const lower = prose.toLowerCase();
  // Explicit forward planning / remaining task language
  return /(해야 할|남아 있|목표|다음|계속해야|이제|새로운|아직도|더 해야|계획|준비|시작해야)/.test(lower);
}

function isObserverWait(prose: string): boolean {
  const last = (prose.trim().split(/\n\n+/).pop() || "").toLowerCase();
  return /(기다리|지켜보|바라보|멈춰|확인하며|가만히|응시|주시)/.test(last);
}

function classifyContinuationType(prose: string): string {
  const lower = prose.toLowerCase();
  const actionScore = (lower.match(/움직|다가|밀|당기|잡|베|찌|공격|다시|계속|진입|걸어|손을|몸을/g) || []).length;
  const emotionScore = (lower.match(/마음|감정|진정|불안|긴장|두근|떨|슬픔|분노|기쁨|아픔|외로/g) || []).length;
  const envScore = (lower.match(/공기|주변|환경|바람|온도|소리|빛|그림자|벽|바닥|공간|가라앉/g) || []).length;
  const goalScore = (lower.match(/해야|남아|목표|계획|다음|계속해야|아직|미완|완수/g) || []).length;

  const scores = [
    { type: "action", score: actionScore },
    { type: "emotion", score: emotionScore },
    { type: "environment", score: envScore },
    { type: "goal", score: goalScore },
  ];
  scores.sort((a, b) => b.score - a.score);

  if (scores[0].score === 0) return "generic";
  if (scores[0].score >= scores[1].score + 2) return scores[0].type;
  return "mixed_" + scores[0].type + "_" + scores[1].type;
}

async function main() {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  const charName = "백하율";
  const persona = "렌";

  const chunks = parseCharacterSetting({
    characterId: "bc-exp13",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하다.`,
    world: `# 세계관\n현대 능력자, 밀폐/번화가 공간.`,
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonl = path.join(outDir, "experiment13-goal-planning-vs-scene-state.jsonl");
  const report = path.join(outDir, "experiment13-goal-planning-vs-scene-state-report.txt");

  const arms = Object.keys(TRIGGERS) as Arm[];
  const samples: Sample[] = [];

  for (const arm of arms) {
    const trigger = TRIGGERS[arm];

    for (let r = 1; r <= REPS; r++) {
      // Minimal but consistent history: one fixed previous turn + the varying trigger
      const shortTermHistory = [
        { role: "assistant" as const, content: "그는 잠시 숨을 골랐다." },
        { role: "assistant" as const, content: trigger },
        { role: "user" as const, content: "자동진행" },
      ];

      const built = buildContext({
        charName,
        chunks,
        userNickname: persona,
        userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
        userNote: formatUserNoteForPrompt("검증", persona),
        longTermMemory: "[요약] momentum trigger category test — identical except final sentence",
        shortTermHistory,
        currentUserMessage: "자동진행",
        nsfw: true,
        gender: "male",
        memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"tense"}')),
        modelId: MODEL_ID,
        provider: "openrouter",
        personaDisplayName: persona,
        targetResponseChars: TARGET_CHARS,
        completedTurns: COMPLETED,
        userPersonaGender: "other",
        statusWidgetActive: false,
      });

      const split = built.openRouterSystemSplit!;
      const system = [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock].filter(Boolean).join("\n\n");
      const apiHist = built.history.slice(0, -1).map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

      console.log(`[exp13] ${arm} run ${r}/${REPS}`);
      await sleep(DELAY_MS);

      const res = await callOpenRouterAdult(
        system,
        [...apiHist, { role: "user", content: "자동진행" }],
        MODEL_ID,
        TARGET_CHARS,
        { charName },
        { chargeTurnBudget: false, requestKind: "exp13-trigger-category" }
      );

      const prose = displayProse(res.text || "");
      const m = estimateGoalMetrics(prose);

      const sample: Sample = {
        arm,
        run: r,
        trigger,
        outputChars: prose.length,
        goalCount: m.goalCount,
        exchangeCount: m.exchangeCount,
        goalDepth: m.goalDepth,
        hasNewGoalActivation: detectNewGoalActivation(prose),
        terminal: classifyTerminal(prose),
        isObserverWait: isObserverWait(prose),
        continuationType: classifyContinuationType(prose),
        openEnding: hasOpenEnding(prose),
      };

      samples.push(sample);
      fs.appendFileSync(jsonl, JSON.stringify(sample) + "\n", "utf8");

      console.log(`  -> ${prose.length}ch  g=${m.goalCount} x=${m.exchangeCount} d=${m.goalDepth}  newGoal=${sample.hasNewGoalActivation}  type=${sample.continuationType}  obsWait=${sample.isObserverWait}`);
    }
  }

  // ==================== REPORT ====================
  const lines: string[] = [];
  lines.push("=== Experiment 13: Goal Planning vs Scene State (Momentum Trigger Categories) ===");
  lines.push(`reps per arm: ${REPS}`);
  lines.push("Only the final trigger sentence differs. Everything else (prompt, base history, target, model) is fixed.");
  lines.push("");
  lines.push("Triggers:");
  for (const arm of arms) {
    lines.push(`  ${arm}: "${TRIGGERS[arm]}"`);
  }
  lines.push("");

  function avg(arr: number[]) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }
  function rate(arr: boolean[]) { return arr.length ? (arr.filter(Boolean).length / arr.length * 100).toFixed(1) + "%" : "0%"; }

  lines.push("--- Core Metrics (mean) ---");
  for (const arm of arms) {
    const armS = samples.filter(s => s.arm === arm);
    const ch = avg(armS.map(s => s.outputChars));
    const g = avg(armS.map(s => s.goalCount));
    const x = avg(armS.map(s => s.exchangeCount));
    const d = avg(armS.map(s => s.goalDepth));
    lines.push(`${arm.padEnd(24)} chars=${ch.toFixed(0)}  g=${g.toFixed(1)}  x=${x.toFixed(1)}  d=${d.toFixed(1)}`);
  }
  lines.push("");

  lines.push("--- New Goal Activation Rate ---");
  for (const arm of arms) {
    const armS = samples.filter(s => s.arm === arm);
    const r = rate(armS.map(s => s.hasNewGoalActivation));
    lines.push(`${arm.padEnd(24)} ${r}`);
  }
  lines.push("");

  lines.push("--- Observer Wait Rate ---");
  for (const arm of arms) {
    const armS = samples.filter(s => s.arm === arm);
    const r = rate(armS.map(s => s.isObserverWait));
    lines.push(`${arm.padEnd(24)} ${r}`);
  }
  lines.push("");

  lines.push("--- Continuation Type Distribution ---");
  for (const arm of arms) {
    const armS = samples.filter(s => s.arm === arm);
    const dist: Record<string, number> = {};
    for (const s of armS) dist[s.continuationType] = (dist[s.continuationType] || 0) + 1;
    const parts = Object.entries(dist).map(([k, v]) => `${k}:${v}`).join("  ");
    lines.push(`${arm.padEnd(24)} ${parts}`);
  }
  lines.push("");

  lines.push("--- Terminal / Stopping Position ---");
  const terminals = ["tension_continuation", "immediate_reaction", "observer_wait", "dialogue_resolution", "other"];
  for (const arm of arms) {
    const armS = samples.filter(s => s.arm === arm);
    const dist: Record<string, number> = {};
    for (const t of terminals) dist[t] = 0;
    for (const s of armS) dist[s.terminal] = (dist[s.terminal] || 0) + 1;
    const parts = terminals.map(t => `${t}:${dist[t]}`).join("  ");
    lines.push(`${arm.padEnd(24)} ${parts}`);
  }
  lines.push("");

  // Ranking
  lines.push("=== Ranking (by exchangeCount + goalDepth + newGoalActivation) ===");
  const ranked = [...arms].sort((a, b) => {
    const sa = samples.filter(s => s.arm === a);
    const sb = samples.filter(s => s.arm === b);
    const score = (s: Sample[]) => {
      if (!s.length) return -999;
      const x = avg(s.map(x => x.exchangeCount));
      const d = avg(s.map(x => x.goalDepth));
      const newGoalRate = s.filter(x => x.hasNewGoalActivation).length / s.length;
      return x * 2 + d * 1.8 + newGoalRate * 3;
    };
    return score(sb) - score(sa);
  });
  ranked.forEach((arm, i) => {
    const armS = samples.filter(s => s.arm === arm);
    const x = avg(armS.map(s => s.exchangeCount));
    const d = avg(armS.map(s => s.goalDepth));
    const newG = (armS.filter(s => s.hasNewGoalActivation).length / armS.length * 100).toFixed(0);
    lines.push(`${(i + 1).toString().padStart(2)}. ${arm.padEnd(24)} exch=${x.toFixed(1)}  depth=${d.toFixed(1)}  newGoal=${newG}%`);
  });
  lines.push("");

  lines.push("=== Key Question Answer ===");
  lines.push("If A (Action) or D (Goal) dominates on exchange + goalDepth + newGoalActivation,");
  lines.push("then DeepSeek's Goal activation is most sensitive to 'unfinished action / explicit remaining goal'.");
  lines.push("");
  lines.push("If all four arms are similar, the effect is mostly 'any unfinished sentence'.");
  lines.push("");
  lines.push("If B or C wins, internal state is driven more by emotional or environmental continuity.");

  fs.writeFileSync(report, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log("\nWrote", jsonl);
  console.log("Wrote", report);
}

main().catch(e => { console.error(e); process.exit(1); });
