/**
 * Experiment 12: Attention Window Mapping (Last N Tokens of Previous Assistant)
 *
 * Goal: Determine how far back into the recent assistant turn DeepSeek actually
 * looks for continuation / Goal-activation cues.
 *
 * Method:
 * - Start with a strong previous assistant context (authentic tail from the
 *   successful historical turn that produced long multi-goal output).
 * - For each test, keep ONLY the last N tokens (approximate) of that previous
 *   assistant and discard everything before it.
 * - Windows tested: 0 (no previous), 8, 16, 32, 64, 128 tokens.
 * - Everything else fixed (current prompt, builder, model, target length, widget OFF).
 *
 * Measure: outputChars, goalCount, exchangeCount, goalDepth.
 *
 * Interpretation:
 * - If performance stays high even at 16-32 tokens → the model mostly looks at
 *   a very recent "tail window".
 * - If it needs 64-128+ tokens → it uses a wider recent context.
 * - This tells us the minimal "state" we need to preserve or inject.
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

// A strong previous assistant tail (last ~450-550 chars of a historically successful turn)
// ending with the known powerful cue. This gives realistic context + the trigger.
const STRONG_TAIL = `
두 번째 비스트를 향해 몸을 날리는 그의 궤적이 하늘 위로 푸른 호를 그렸다.
도심 한복판에서 청염의 지옥이 펼쳐지기 시작했다.
그는 착지하며 낮게 중얼거렸다.
"새끼들. 내 가이드님 체리 먹는 거 방해한 죄, 몸으로 갚아라."
`.trim();

// Windows in approximate tokens (Korean ~2.7-2.9 chars per token is our rough estimate)
const WINDOWS = [0, 8, 16, 32, 64, 128];

type Sample = {
  window: number;
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
  return Math.max(0, Math.round(s.length / 2.75));
}

/** Keep only the suffix that roughly corresponds to N tokens */
function lastNTokens(text: string, n: number): string {
  if (n <= 0) return "";
  const approxChars = Math.max(1, Math.round(n * 2.75));
  // Take from the end, try to cut at a reasonable boundary (space or punctuation)
  let suffix = text.slice(-approxChars).trim();
  // If we cut in the middle of a word, back up a bit
  if (suffix.length > 3 && !/[\s。.!?…\n]/.test(suffix[0])) {
    const back = suffix.search(/[\s。.!?…\n]/);
    if (back > 0 && back < suffix.length * 0.6) {
      suffix = suffix.slice(back).trim();
    }
  }
  return suffix;
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
  if (/(기다리|지켜보|바라보|멈춰|확인하며)/.test(last)) return "observer_wait";
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
    characterId: "bc-exp12",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하다.`,
    world: `# 세계관\n현대 능력자.`,
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonl = path.join(outDir, "experiment12-attention-window-mapping.jsonl");
  const report = path.join(outDir, "experiment12-attention-window-mapping-report.txt");

  const samples: Sample[] = [];

  for (const win of WINDOWS) {
    for (let r = 1; r <= REPS; r++) {
      const injected = lastNTokens(STRONG_TAIL, win);
      const tok = roughTokens(injected);

      // Build history: previous assistant = the windowed suffix (or nothing if win=0)
      const shortTermHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
      if (injected) {
        shortTermHistory.push({ role: "assistant", content: injected });
      }
      shortTermHistory.push({ role: "user", content: "자동진행" });

      const built = buildContext({
        charName,
        chunks,
        userNickname: persona,
        userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
        userNote: formatUserNoteForPrompt("검증", persona),
        longTermMemory: "[요약] attention window mapping",
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

      console.log(`[exp12] last_${win}_tokens run ${r}/${REPS}  (injected ~${tok}tok)`);
      await sleep(DELAY_MS);

      const res = await callOpenRouterAdult(
        system,
        [...apiHist, { role: "user", content: "자동진행" }],
        MODEL_ID,
        TARGET_CHARS,
        { charName },
        { chargeTurnBudget: false, requestKind: "exp12-attention-window" }
      );

      const prose = displayProse(res.text || "");
      const m = estimateGoalMetrics(prose);

      const sample: Sample = {
        window: win,
        run: r,
        injected,
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
  lines.push("=== Experiment 12: Attention Window Mapping ===");
  lines.push("We keep only the last N approximate tokens of a strong previous assistant.");
  lines.push(`Base tail length: ~${roughTokens(STRONG_TAIL)} tokens`);
  lines.push("Windows tested: " + WINDOWS.join(", "));
  lines.push("");

  function avg(arr: number[]) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }

  lines.push("--- Performance by window size (mean) ---");
  for (const win of WINDOWS) {
    const arm = samples.filter(s => s.window === win);
    if (!arm.length) continue;
    const ch = avg(arm.map(s => s.outputChars));
    const g = avg(arm.map(s => s.goalCount));
    const x = avg(arm.map(s => s.exchangeCount));
    const d = avg(arm.map(s => s.goalDepth));
    const tok = avg(arm.map(s => s.injectedRoughTokens));
    lines.push(`last_${String(win).padStart(3)} tokens  tok~${tok.toFixed(0)}  chars=${ch.toFixed(0)}  g=${g.toFixed(1)}  x=${x.toFixed(1)}  d=${d.toFixed(1)}`);
  }
  lines.push("");

  lines.push("=== Key Question ===");
  lines.push("At which window size does exchangeCount + goalDepth collapse toward baseline?");
  lines.push("This tells us the effective 'recent tail' the model actually attends to for continuation.");

  fs.writeFileSync(report, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log("Wrote", jsonl);
  console.log("Wrote", report);
}

main().catch(e => { console.error(e); process.exit(1); });
