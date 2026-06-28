/**
 * Experiment 11: Momentum Trigger Token Isolation
 *
 * Goal: Slice a powerful historical sentence into tiny fragments to isolate
 * exactly which micro-signals (words, phrases, connectors, ellipses, etc.)
 * DeepSeek actually uses as continuation / Goal-activation cues.
 *
 * Strategy:
 * - Start from a known strong cue sentence that worked in previous experiments.
 * - Create 12-20 micro-fragments by cutting the sentence in different ways:
 *     - full sentence
 *     - major clauses
 *     - key noun phrases
 *     - verbs / actions
 *     - connectors ("하지만", "그리고", "아직", "...")
 *     - single powerful words
 *     - common continuation openers
 *
 * For each fragment, inject it as the *only* previous assistant content
 * (minimal history), then measure on the next output:
 *   - outputChars
 *   - goalCount
 *   - exchangeCount
 *   - goalDepth
 *
 * If we can find 15-40 token fragments that still produce high exchange + depth,
 * it proves we can create lightweight "Momentum Triggers" instead of dumping
 * thousands of tokens of history.
 *
 * Base cue (proven strong in Exp7/8):
 * "새끼들. 내 가이드님 체리 먹는 거 방해한 죄, 몸으로 갚아라."
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
const DELAY_MS = 3800;
const REPS = 3;
const TARGET_CHARS = 3000;
const COMPLETED = 7;

// The strong cue sentence we repeatedly used
const BASE = "새끼들. 내 가이드님 체리 먹는 거 방해한 죄, 몸으로 갚아라.";

// Systematic micro-fragments (roughly 10-20 pieces)
// We include:
// - full
// - major semantic chunks
// - action / threat verbs
// - connectors and openers
// - minimal triggers
const FRAGMENTS: Array<{ name: string; text: string }> = [
  { name: "full",                    text: BASE },
  { name: "A_subject_threat",        text: "새끼들." },
  { name: "B_guide_cherry",          text: "내 가이드님 체리 먹는 거" },
  { name: "C_interference",          text: "방해한 죄" },
  { name: "D_body_payment",          text: "몸으로 갚아라." },
  { name: "E_threat_verb",           text: "몸으로 갚아라" },
  { name: "F_but_yet",               text: "하지만 아직 끝난 게 아니었다." },
  { name: "G_yet_not_finished",      text: "아직 끝난 게 아니었다." },
  { name: "H_yet",                   text: "아직." },
  { name: "I_not_finished",          text: "끝난 게 아니었다." },
  { name: "J_but",                   text: "하지만." },
  { name: "K_ellipsis",              text: "..." },
  { name: "L_next_moment",           text: "다음 순간," },
  { name: "M_and_then",              text: "그리고" },
  { name: "N_however",               text: "그러나" },
  { name: "O_he_moved_again",        text: "그는 다시 움직였다." },
  { name: "P_again_moved",           text: "다시 움직였다." },
  { name: "Q_soon",                  text: "곧" },
  { name: "R_continue",              text: "계속" },
  { name: "S_threat_only",           text: "갚아라." },
];

type Sample = {
  fragment: string;
  run: number;
  injected: string;
  injectedRoughTokens: number;
  outputChars: number;
  goalCount: number;
  exchangeCount: number;
  goalDepth: number;
  terminal: string;
  openEnding: boolean;
};

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function displayProse(t: string): string {
  const i = (t || "").search(/<<<STATUS/i);
  return (i >= 0 ? t.slice(0, i) : t).trim();
}

function roughTokens(s: string): number {
  return Math.max(1, Math.round(s.length / 2.7));
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
  if (/(괜찮|안심|진정|걱정)/.test(text)) clusters.push("reassure");
  if (/(더 가까|손|체온|밀착|스치|욕망|체리)/.test(text)) clusters.push("intimacy");
  if (/(왜|하지만|아직|어떻게|다음|계속)/.test(text)) clusters.push("question");
  if (/(움직|다가|밀|당기|잡|베|찌|공격|다시|계속|진입)/.test(text)) clusters.push("action");
  const goalCount = Math.max(1, clusters.length);
  const prog = prose.match(/(그리고|이어서|더 |곧바로|다시|이어|그러자|그 순간|계속|이제|다음)/g) || [];
  const goalDepth = Math.min(6, 1 + Math.floor(prog.length / 2.2));
  return { goalCount, exchangeCount: Math.max(1, exchanges), goalDepth };
}

function classifyTerminal(prose: string): string {
  const last = (prose.trim().split(/\n\n+/).pop() || "").trim();
  if (/[,…]$/.test(last) || /(하지만|그런데|아직|더 |이어서|곧|다시)/.test(last.slice(-70))) return "tension_continuation";
  if (/["「『“”]/.test(last)) return "dialogue_resolution";
  if (/(기다리|지켜보|바라보|멈춰|확인하며|가만히)/.test(last)) return "observer_wait";
  return "other";
}

function hasOpenEnding(prose: string): boolean {
  const last = (prose.trim().split(/\n\n+/).pop() || "").trim();
  return /[,…]$/.test(last) || /(하지만|그런데|아직|더 |이어서|곧|다시|...|\.\.\.)/.test(last.slice(-70));
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
    characterId: "bc-exp11",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하다.`,
    world: `# 세계관\n현대 능력자, 밀폐/번화가 공간.`,
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonl = path.join(outDir, "experiment11-momentum-trigger-isolation.jsonl");
  const report = path.join(outDir, "experiment11-momentum-trigger-isolation-report.txt");

  const samples: Sample[] = [];

  for (const frag of FRAGMENTS) {
    const inj = frag.text;
    const tok = roughTokens(inj);

    for (let r = 1; r <= REPS; r++) {
      const shortTermHistory = [
        { role: "assistant" as const, content: inj },
        { role: "user" as const, content: "자동진행" },
      ];

      const built = buildContext({
        charName,
        chunks,
        userNickname: persona,
        userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
        userNote: formatUserNoteForPrompt("검증", persona),
        longTermMemory: "[요약] momentum trigger isolation",
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

      console.log(`[exp11] ${frag.name} run ${r}/${REPS}  (~${tok}tok)`);
      await sleep(DELAY_MS);

      const res = await callOpenRouterAdult(
        system,
        [...apiHist, { role: "user", content: "자동진행" }],
        MODEL_ID,
        TARGET_CHARS,
        { charName },
        { chargeTurnBudget: false, requestKind: "exp11-momentum-trigger" }
      );

      const prose = displayProse(res.text || "");
      const m = estimateGoalMetrics(prose);

      const sample: Sample = {
        fragment: frag.name,
        run: r,
        injected: inj,
        injectedRoughTokens: tok,
        outputChars: prose.length,
        goalCount: m.goalCount,
        exchangeCount: m.exchangeCount,
        goalDepth: m.goalDepth,
        terminal: classifyTerminal(prose),
        openEnding: hasOpenEnding(prose),
      };
      samples.push(sample);
      fs.appendFileSync(jsonl, JSON.stringify(sample) + "\n", "utf8");
      console.log(`  -> ${prose.length}ch  g=${m.goalCount} x=${m.exchangeCount} d=${m.goalDepth}`);
    }
  }

  // Report
  const lines: string[] = [];
  lines.push("=== Experiment 11: Momentum Trigger Token Isolation ===");
  lines.push(`Base sentence: "${BASE}"`);
  lines.push("Each fragment injected as the sole previous assistant turn.");
  lines.push("");

  function avg(arr: number[]) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }

  lines.push("--- Per-fragment performance (mean) ---");
  for (const frag of FRAGMENTS) {
    const arm = samples.filter(s => s.fragment === frag.name);
    if (!arm.length) continue;
    const ch = avg(arm.map(s => s.outputChars));
    const g = avg(arm.map(s => s.goalCount));
    const x = avg(arm.map(s => s.exchangeCount));
    const d = avg(arm.map(s => s.goalDepth));
    const tok = avg(arm.map(s => s.injectedRoughTokens));
    lines.push(`${frag.name.padEnd(20)} tok~${tok.toFixed(0)}  chars=${ch.toFixed(0)}  g=${g.toFixed(1)}  x=${x.toFixed(1)}  d=${d.toFixed(1)}`);
  }
  lines.push("");

  lines.push("--- Top triggers by exchangeCount + goalDepth ---");
  const ranked = [...FRAGMENTS].sort((a, b) => {
    const sa = samples.filter(s => s.fragment === a.name);
    const sb = samples.filter(s => s.fragment === b.name);
    const score = (s: Sample[]) => {
      if (!s.length) return -999;
      return (avg(s.map(x => x.exchangeCount)) * 2) + (avg(s.map(x => x.goalDepth)) * 1.5) + (avg(s.map(x => x.outputChars)) / 1000);
    };
    return score(sb) - score(sa);
  });
  ranked.slice(0, 8).forEach((f, i) => {
    const arm = samples.filter(s => s.fragment === f.name);
    const x = avg(arm.map(s => s.exchangeCount));
    const d = avg(arm.map(s => s.goalDepth));
    lines.push(`${(i+1).toString().padStart(2)}. ${f.name.padEnd(20)} exch=${x.toFixed(1)} depth=${d.toFixed(1)}`);
  });
  lines.push("");

  lines.push("=== Interpretation ===");
  lines.push("Look for fragments with high exchangeCount + goalDepth even at very low token count.");
  lines.push("Connectors like '하지만', '아직', '...', '다시', action verbs ('움직였다', '갚아라') are candidates for cheap Momentum Triggers.");
  lines.push("If any 15-40 token piece approaches full-sentence performance, we have a viable lightweight trigger.");

  fs.writeFileSync(report, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log("Wrote", jsonl);
  console.log("Wrote", report);
}

main().catch(e => { console.error(e); process.exit(1); });
