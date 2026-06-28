/**
 * Experiment 6: Carry-over Momentum Injection (synthetic, minimal context)
 *
 * Hypothesis from Exp5: The key driver is *unresolved carry-over momentum*,
 * not raw history length or full previous context.
 *
 * Method:
 * - Keep Prompt / Runtime / Builder / model / short base history *fixed*.
 * - Only inject a short synthetic "previous assistant" summary (carry-over)
 *   immediately before the current user turn.
 * - Arms:
 *   1. no_carry          : base history + user (no extra momentum)
 *   2. minimal_carry     : 40-80 token unresolved tension summary
 *   3. rich_carry        : fuller unresolved tension + sensory + internal
 *   4. goal_summary      : explicit next-goal progression, no emotional language
 *
 * Metrics (on the *new* output):
 * - outputChars
 * - goalCount
 * - exchangeCount
 * - goalDepth
 * - stopLocation (terminal type + open-ending flag)
 *
 * Prediction to validate:
 * If minimal_carry ≈ rich_carry >> no_carry on exchangeCount + goalDepth + length,
 * then unresolved momentum (not long context) is the causal lever.
 *
 * Goal Summary vs Tension variants isolates "explicit goal state" vs "emotional open loop".
 *
 * Usage:
 *   npx.cmd tsx scripts/experiment6-carryover-momentum.ts --reps=5
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
const REPS_DEFAULT = 5;
const TARGET_CHARS = 3000;
const COMPLETED_TURNS = 7;

type Arm = "no_carry" | "minimal_carry" | "rich_carry" | "goal_summary";

type Sample = {
  arm: Arm;
  run: number;
  injectedChars: number;
  injectedRoughTokens: number;
  outputChars: number;
  outputTokens: number;
  beats: number;
  goalCount: number;
  exchangeCount: number;
  goalDepth: number;
  terminal: string;
  openEnding: boolean;
  finish: string;
};

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function displayProse(t: string): string {
  let s = t || "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  return s.trim();
}

/** Same heuristic as previous experiments */
function estimateGoalMetrics(prose: string) {
  const paras = prose.trim().split(/\n\n+/).map(p => p.trim()).filter(Boolean);

  let exchanges = 0;
  for (let i = 0; i < paras.length - 1; i++) {
    if (/"[^"]{4,}"/.test(paras[i])) {
      const next = (paras[i + 1] + " " + (paras[i + 2] || "")).toLowerCase();
      if (/눈|표정|손|몸|숨|동공|시선|반응|움직|가까|물러|다가|밀|당기/.test(next)) exchanges++;
    }
  }

  const text = prose.toLowerCase();
  const clusters: string[] = [];
  if (/(위험|보호|막|숨|안전|경보|피해|가로막)/.test(text)) clusters.push("protect");
  if (/(괜찮|안심|진정|위로|걱정|무서|떨)/.test(text)) clusters.push("reassure");
  if (/(더 가까|손|허리|입술|숨결|밀착|키스|뜨거|벗|스치|욕망|파고)/.test(text)) clusters.push("intimacy");
  if (/(왜|하지만|아직|뭐|어떻게|진심|의심)/.test(text)) clusters.push("question");
  if (/(움직|들어|다가|밀|당기|일어서|잡|안아|걸어|향해)/.test(text)) clusters.push("action");

  const goalCount = Math.max(1, clusters.length);

  const progressionMarkers = /(그리고|이어서|그 말과 동시에|더 |한층|곧바로|다시|이어|그러자|그 순간|계속|이제|목표)/g;
  const matches = prose.match(progressionMarkers) || [];
  const goalDepth = Math.min(6, 1 + Math.floor(matches.length / 2.5));

  return { goalCount, exchangeCount: Math.max(1, exchanges), goalDepth };
}

function classifyTerminal(prose: string): string {
  const last = prose.trim().split(/\n\n+/).pop() || "";
  if (/[,…]\s*$/.test(last) || /(?:하지만|그런데|아직|더 |이어서|곧)/.test(last.slice(-60))) return "tension_continuation";
  if (/"[^"]{4,}"\s*[.!?…]?\s*$/.test(last)) return "dialogue_resolution";
  if (/(?:기다리|지켜보|바라보|응시|멈춰|확인하며)/.test(last)) return "observer_wait";
  if (/(?:눈동자|시선|표정|긴장|동공|손목|숨|속으로)/.test(last)) return "immediate_reaction";
  return "other";
}

function hasOpenEnding(prose: string): boolean {
  const last = (prose.trim().split(/\n\n+/).pop() || "").trim();
  if (!last) return false;
  // dangling comma, ellipsis, or classic openers at end
  if (/[,…]$/.test(last)) return true;
  const tail = last.slice(-80).toLowerCase();
  return /(하지만|그런데|아직|더 |이어서|곧|말을|손을|눈을|숨을|...|\.\.\.)/.test(tail);
}

function roughKoreanTokens(s: string): number {
  // Very rough: Korean prose ~2.5-3 chars per token for these models
  return Math.max(1, Math.round(s.length / 2.7));
}

// ------------------------------------------------------------------
// Fixed minimal short history (unchanged across arms)
// ------------------------------------------------------------------
const BASE_SHORT_HISTORY: Array<{ role: "user" | "assistant"; content: string }> = [
  { role: "user", content: "이 안에 갇힌 거야?" },
  { role: "assistant", content: "그는 고개를 끄덕였다. 말은 아끼고 있었다." }
];

const CURRENT_USER_MESSAGE = "자동진행";

// ------------------------------------------------------------------
// Synthetic carry-over summaries (injected as the last assistant turn)
// ------------------------------------------------------------------

// ~50-70 tokens, pure unresolved tension / carry-over
const MINIMAL_CARRY = `그녀의 손이 그의 소매를 놓지 않았다. 말은 없었지만, 그 침묵이 무언가를 요구했다. 엘리베이터 안의 공기가 아직 무거웠다. 끝나지 않은 질문이 두 사람 사이에 남아 있었다.`;

// Richer version: multiple beats, sensory + internal + physical dangling
const RICH_CARRY = `그의 움직임이 멈췄다. 그녀의 체온이 손끝으로 전해졌다. 그는 방금 전의 말을 삼켰다. "..." 하고 싶은 말이 목에 걸려 있었지만, 대신 그녀의 반응을 기다렸다. 엘리베이터의 미세한 진동이 계속되었고, 형광등 불빛 아래 두 사람의 그림자가 겹쳐졌다. 아직 그녀를 보내고 싶지 않았다. 그 사실이 그를 붙들었다.`;

// Goal-progression only, minimal emotional language
const GOAL_SUMMARY = `지난 턴에서 '즉각적 보호' 목표는 1차 달성되었다. 그러나 '상대방의 의도 확인'과 '물리적 접근' 목표는 여전히 미완으로 남아 있다. 주인공은 다음 구체적 행동을 개시하지 않은 채 대기 중이다.`;

const ARMS: Arm[] = ["no_carry", "minimal_carry", "rich_carry", "goal_summary"];

function getCarryText(arm: Arm): string {
  if (arm === "minimal_carry") return MINIMAL_CARRY;
  if (arm === "rich_carry") return RICH_CARRY;
  if (arm === "goal_summary") return GOAL_SUMMARY;
  return "";
}

async function main() {
  const repsArg = process.argv.find(a => a.startsWith("--reps="));
  const reps = repsArg ? parseInt(repsArg.split("=")[1], 10) : REPS_DEFAULT;

  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  const charName = "백하율";
  const persona = "렌";

  const chunks = parseCharacterSetting({
    characterId: "bc-exp6",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하다.`,
    world: `# 세계관\n현대 밀폐 공간 (엘리베이터).`,
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "experiment6-carryover-momentum.jsonl");
  const reportPath = path.join(outDir, "experiment6-carryover-momentum-report.txt");

  const samples: Sample[] = [];

  for (const arm of ARMS) {
    const carryText = getCarryText(arm);
    const injectedChars = carryText.length;
    const injectedTok = carryText ? roughKoreanTokens(carryText) : 0;

    for (let r = 1; r <= reps; r++) {
      // Build shortTermHistory: fixed base + (optional carry) + current user
      const shortTermHistory = [...BASE_SHORT_HISTORY];
      if (arm !== "no_carry") {
        shortTermHistory.push({ role: "assistant", content: carryText });
      }
      shortTermHistory.push({ role: "user", content: CURRENT_USER_MESSAGE });

      const built = buildContext({
        charName,
        chunks,
        userNickname: persona,
        userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
        userNote: formatUserNoteForPrompt("검증", persona),
        longTermMemory: "[요약] carry-over momentum isolation test",
        shortTermHistory,
        currentUserMessage: CURRENT_USER_MESSAGE,
        nsfw: true,
        gender: "male",
        memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"tense"}')),
        modelId: MODEL_ID,
        provider: "openrouter",
        personaDisplayName: persona,
        targetResponseChars: TARGET_CHARS,
        completedTurns: COMPLETED_TURNS,
        userPersonaGender: "other",
        statusWidgetActive: false,
      });

      const split = built.openRouterSystemSplit!;
      const system = [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock].filter(Boolean).join("\n\n");
      const apiHist = built.history.slice(0, -1).map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

      console.log(`\n[exp6] ${arm} run ${r}/${reps}  (injected≈${injectedTok}tok)`);
      await sleep(DELAY_MS);

      const res = await callOpenRouterAdult(
        system,
        [...apiHist, { role: "user", content: CURRENT_USER_MESSAGE }],
        MODEL_ID,
        TARGET_CHARS,
        { charName },
        { chargeTurnBudget: false, requestKind: "exp6-carryover-momentum" }
      );

      const prose = displayProse(res.text || "");
      const beats = prose.split(/\n\n+/).filter(Boolean).length;
      const metrics = estimateGoalMetrics(prose);
      const term = classifyTerminal(prose);
      const open = hasOpenEnding(prose);

      const sample: Sample = {
        arm,
        run: r,
        injectedChars,
        injectedRoughTokens: injectedTok,
        outputChars: prose.length,
        outputTokens: (res.usage as any)?.outputTokens ?? 0,
        beats,
        goalCount: metrics.goalCount,
        exchangeCount: metrics.exchangeCount,
        goalDepth: metrics.goalDepth,
        terminal: term,
        openEnding: open,
        finish: String((res.usage as any)?.finishReason ?? "unknown"),
      };
      samples.push(sample);
      fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");

      console.log(`  -> ${sample.outputChars}ch  g=${metrics.goalCount} x=${metrics.exchangeCount} d=${metrics.goalDepth}  term=${term} open=${open}`);
    }
  }

  // ---------------- Report ----------------
  const lines: string[] = [];
  lines.push("=== Experiment 6: Carry-over Momentum (synthetic injection) ===");
  lines.push(`reps per arm: ${reps}`);
  lines.push("All variables fixed except the single injected assistant summary before current user.");
  lines.push(`Base short history: ${BASE_SHORT_HISTORY.length} turns (unchanged).`);
  lines.push(`Target: ${TARGET_CHARS} chars | Widget: OFF | Mandate: OFF`);
  lines.push("");

  // Injected sizes
  lines.push("--- Injected summary sizes ---");
  for (const arm of ARMS) {
    const t = getCarryText(arm);
    lines.push(`${arm.padEnd(16)} chars=${t.length}  roughTokens≈${t ? roughKoreanTokens(t) : 0}`);
  }
  lines.push("");

  function stats(arr: number[]) {
    if (!arr.length) return { mean: 0, med: 0, p90: 0, std: 0, min: 0, max: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const p90 = sorted[Math.ceil(sorted.length * 0.9) - 1];
    const m = mean;
    const variance = arr.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, arr.length - 1);
    const std = Math.sqrt(variance);
    return {
      mean: +mean.toFixed(1),
      med: +med.toFixed(1),
      p90: +p90.toFixed(1),
      std: +std.toFixed(1),
      min: sorted[0],
      max: sorted[sorted.length - 1]
    };
  }

  const metrics = ["outputChars", "goalCount", "exchangeCount", "goalDepth"] as const;

  for (const m of metrics) {
    lines.push(`--- ${m} ---`);
    for (const arm of ARMS) {
      const arr = samples.filter(s => s.arm === arm).map(s => (s as any)[m] as number);
      const st = stats(arr);
      lines.push(`${arm.padEnd(16)} mean=${st.mean} med=${st.med} p90=${st.p90} std=${st.std} (n=${arr.length})  [${st.min}-${st.max}]`);
    }
    lines.push("");
  }

  // Open ending rate per arm
  lines.push("--- Open-ending rate (hasOpenEnding) ---");
  for (const arm of ARMS) {
    const armSamples = samples.filter(s => s.arm === arm);
    const openCount = armSamples.filter(s => s.openEnding).length;
    const rate = armSamples.length ? (openCount / armSamples.length * 100).toFixed(0) : "0";
    lines.push(`${arm.padEnd(16)} ${openCount}/${armSamples.length}  (${rate}%)`);
  }
  lines.push("");

  // Terminal distribution
  lines.push("--- Terminal type distribution ---");
  const terminals = ["tension_continuation", "immediate_reaction", "dialogue_resolution", "observer_wait", "other"];
  for (const arm of ARMS) {
    const armSamples = samples.filter(s => s.arm === arm);
    const dist: Record<string, number> = {};
    for (const t of terminals) dist[t] = 0;
    for (const s of armSamples) dist[s.terminal] = (dist[s.terminal] || 0) + 1;
    const parts = terminals.map(t => `${t}:${dist[t]}`).join("  ");
    lines.push(`${arm.padEnd(16)} ${parts}`);
  }
  lines.push("");

  function meanOf(a: number[]) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }

  // Delta vs no_carry
  lines.push("--- Delta vs no_carry (mean) ---");
  const noCarrySamples = samples.filter(s => s.arm === "no_carry");
  const base = {
    outputChars: meanOf(noCarrySamples.map(s => s.outputChars)),
    goalCount: meanOf(noCarrySamples.map(s => s.goalCount)),
    exchangeCount: meanOf(noCarrySamples.map(s => s.exchangeCount)),
    goalDepth: meanOf(noCarrySamples.map(s => s.goalDepth)),
  };

  for (const arm of ["minimal_carry", "rich_carry", "goal_summary"] as const) {
    const armS = samples.filter(s => s.arm === arm);
    if (!armS.length) continue;
    const cur = {
      outputChars: meanOf(armS.map(s => s.outputChars)),
      goalCount: meanOf(armS.map(s => s.goalCount)),
      exchangeCount: meanOf(armS.map(s => s.exchangeCount)),
      goalDepth: meanOf(armS.map(s => s.goalDepth)),
    };
    const dCh = ((cur.outputChars - base.outputChars) / Math.max(1, base.outputChars) * 100).toFixed(1);
    const dX = (cur.exchangeCount - base.exchangeCount).toFixed(2);
    const dD = (cur.goalDepth - base.goalDepth).toFixed(2);
    const xSign = (parseFloat(dX) > 0 ? "+" : "");
    const dSign = (parseFloat(dD) > 0 ? "+" : "");
    lines.push(`${arm.padEnd(16)} chars +${dCh}%   exch ${xSign}${dX}   depth ${dSign}${dD}`);
  }
  lines.push("");

  // Hypothesis section
  lines.push("=== Hypothesis Check ===");
  lines.push("If minimal_carry reproduces most of the exchangeCount / goalDepth gains of rich_carry (and both >> no_carry),");
  lines.push("then *unresolved carry-over momentum* (not long historical context) is the dominant driver.");
  lines.push("");
  lines.push("Emotional open-loop (minimal/rich) vs explicit goal state (goal_summary) isolates the nature of the momentum.");
  lines.push("");
  lines.push("Key signals to watch in results:");
  lines.push("- exchangeCount and goalDepth jump when a short unresolved summary is injected");
  lines.push("- minimal_carry ≈ rich_carry on chaining metrics (length efficiency)");
  lines.push("- goal_summary improves goalDepth but may underperform on raw exchange / tension continuation");
  lines.push("- openEnding rate should be markedly higher with carry arms");

  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log("\nWrote", jsonlPath);
  console.log("Wrote", reportPath);
}

main().catch(e => { console.error(e); process.exit(1); });
