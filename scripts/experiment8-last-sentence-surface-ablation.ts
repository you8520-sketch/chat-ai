/**
 * Experiment 8: Last Sentence Surface Form Ablation
 *
 * Goal: Determine if DeepSeek is anchoring on the *exact text* (surface form / state token)
 * or on the *meaning* of the final sentence of the previous assistant turn.
 *
 * Base: The most effective "last sentence" cue from the successful historical turn (id 331 tail).
 *
 * Variants (all injected as the sole previous assistant content, everything else fixed):
 *
 * A - original
 * B - synonym (동의어)
 * C - grammar/structure only (remove modifiers)
 * D - action removed
 * E - subject removed
 * F - punctuation removed (no period)
 * G - whitespace / newline normalized (already single line)
 * H - word order lightly changed (within sentence)
 *
 * Metrics: outputChars, goalCount, exchangeCount, goalDepth
 *
 * Interpretation:
 * - Only "original" produces strong chaining → treats exact text as state token.
 * - Synonyms / structure-preserving versions also work → carries semantic momentum.
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
const REPS = 3;
const TARGET_CHARS = 3000;
const COMPLETED = 7;

// The distinctive last-sentence cue that was powerful in Exp7 short fragments
const ORIGINAL = "새끼들. 내 가이드님 체리 먹는 거 방해한 죄, 몸으로 갚아라.";

type VariantKey =
  | "A_original"
  | "B_synonym"
  | "C_grammar_only"
  | "D_action_removed"
  | "E_subject_removed"
  | "F_no_period"
  | "G_normalized"
  | "H_reordered";

const VARIANTS: Record<VariantKey, string> = {
  A_original: ORIGINAL,
  B_synonym: "녀석들. 내 가이드의 체리 먹는 걸 방해한 죄, 몸으로 치러라.",
  C_grammar_only: "새끼들. 가이드님 체리 먹는 거 방해한 죄, 몸으로 갚아라.",
  D_action_removed: "새끼들. 내 가이드님 체리 먹는 거 방해한 죄.",
  E_subject_removed: "체리 먹는 거 방해한 죄, 몸으로 갚아라.",
  F_no_period: "새끼들. 내 가이드님 체리 먹는 거 방해한 죄, 몸으로 갚아라",
  G_normalized: ORIGINAL.replace(/\s+/g, " ").trim(),
  H_reordered: "몸으로 갚아라. 새끼들. 내 가이드님 체리 먹는 거 방해한 죄.",
};

type Sample = {
  variant: VariantKey;
  run: number;
  injected: string;
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

function estimateGoalMetrics(prose: string) {
  const paras = prose.trim().split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  let exchanges = 0;
  for (let i = 0; i < paras.length - 1; i++) {
    if (/["「『“”]/.test(paras[i])) {
      const next = (paras[i + 1] + " " + (paras[i + 2] || "")).toLowerCase();
      if (/눈|표정|손|몸|숨|동공|시선|반응|움직|가까|다가|밀|당기|베|찌|공격/.test(next)) exchanges++;
    }
  }
  const text = prose.toLowerCase();
  const clusters: string[] = [];
  if (/(위험|보호|안전|막|피해)/.test(text)) clusters.push("protect");
  if (/(괜찮|안심|진정|걱정|무서)/.test(text)) clusters.push("reassure");
  if (/(더 가까|손|체온|밀착|접촉|스치|욕망)/.test(text)) clusters.push("intimacy");
  if (/(왜|하지만|아직|어떻게|계획|다음)/.test(text)) clusters.push("question");
  if (/(움직|다가|밀|당기|잡|베|찌|공격|추적|도망)/.test(text)) clusters.push("action");
  const goalCount = Math.max(1, clusters.length);
  const prog = prose.match(/(그리고|이어서|더 |곧바로|다시|이어|그러자|그 순간|계속|이제|목표)/g) || [];
  const goalDepth = Math.min(6, 1 + Math.floor(prog.length / 2.3));
  return { goalCount, exchangeCount: Math.max(1, exchanges), goalDepth };
}

function classifyTerminal(prose: string): string {
  const last = (prose.trim().split(/\n\n+/).pop() || "").trim();
  if (/[,…]$/.test(last) || /(하지만|그런데|아직|더 |이어서|곧)/.test(last.slice(-60))) return "tension_continuation";
  if (/["「『“”]/.test(last)) return "dialogue_resolution";
  if (/(기다리|지켜보|바라보|멈춰|확인하며)/.test(last)) return "observer_wait";
  return "other";
}

function hasOpenEnding(prose: string): boolean {
  const last = (prose.trim().split(/\n\n+/).pop() || "").trim();
  return /[,…]$/.test(last) || /(하지만|그런데|아직|더 |이어서|곧|...)/.test(last.slice(-70));
}

async function main() {
  // Dynamic imports after the server-only shim to avoid client/server module errors
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  const charName = "백하율";
  const persona = "렌";

  const chunks = parseCharacterSetting({
    characterId: "bc-exp8",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하다.`,
    world: `# 세계관\n현대 능력자, 번화가/밀폐 공간.`,
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonl = path.join(outDir, "experiment8-last-sentence-surface.jsonl");
  const report = path.join(outDir, "experiment8-last-sentence-surface-report.txt");

  const samples: Sample[] = [];
  const variantKeys = Object.keys(VARIANTS) as VariantKey[];

  for (const key of variantKeys) {
    const sent = VARIANTS[key];
    for (let r = 1; r <= REPS; r++) {
      // Minimal history: one previous assistant = this variant sentence
      const shortTermHistory = [
        { role: "assistant" as const, content: sent },
        { role: "user" as const, content: "자동진행" },
      ];

      const built = buildContext({
        charName,
        chunks,
        userNickname: persona,
        userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
        userNote: formatUserNoteForPrompt("검증", persona),
        longTermMemory: "[요약] last-sentence surface ablation",
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

      console.log(`[exp8] ${key} run ${r}/${REPS}`);
      await sleep(DELAY_MS);

      const res = await callOpenRouterAdult(
        system,
        [...apiHist, { role: "user", content: "자동진행" }],
        MODEL_ID,
        TARGET_CHARS,
        { charName },
        { chargeTurnBudget: false, requestKind: "exp8-last-sentence-surface" }
      );

      const prose = displayProse(res.text || "");
      const m = estimateGoalMetrics(prose);

      const sample: Sample = {
        variant: key,
        run: r,
        injected: sent,
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
  lines.push("=== Experiment 8: Last Sentence Surface Form Ablation ===");
  lines.push(`Original sentence: "${ORIGINAL}"`);
  lines.push("All other variables fixed. Only the injected previous assistant sentence changes.");
  lines.push("");

  function avg(arr: number[]) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }

  lines.push("--- Summary (mean over reps) ---");
  for (const key of variantKeys) {
    const arm = samples.filter(s => s.variant === key);
    const ch = avg(arm.map(s => s.outputChars));
    const g = avg(arm.map(s => s.goalCount));
    const x = avg(arm.map(s => s.exchangeCount));
    const d = avg(arm.map(s => s.goalDepth));
    lines.push(`${key.padEnd(16)} chars=${ch.toFixed(0)}  goal=${g.toFixed(1)}  exch=${x.toFixed(1)}  depth=${d.toFixed(1)}`);
  }
  lines.push("");

  lines.push("=== Interpretation ===");
  lines.push("If only A_original is strong on exchangeCount + goalDepth,");
  lines.push("DeepSeek is using the *exact surface string* as a continuation / state cue.");
  lines.push("If B_synonym and C_grammar_only are close to A, it is carrying semantic momentum.");
  lines.push("F/G/H test whether superficial formatting (punctuation, order, whitespace) matters.");

  fs.writeFileSync(report, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log("Wrote", jsonl);
  console.log("Wrote", report);
}

main().catch(e => { console.error(e); process.exit(1); });
