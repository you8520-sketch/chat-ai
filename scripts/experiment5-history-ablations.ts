/**
 * Experiment 5: History Component Ablations
 *
 * Goal: Isolate which signals inside the historical context are responsible
 * for restoring Goal activation budget (goalCount, exchangeCount, goalDepth).
 *
 * We start from real historical messages leading to a long turn (e.g. id 333).
 * Then we create controlled variants of the *previous assistant* turns by
 * selectively preserving or stripping specific features.
 *
 * Ablation arms (applied to previous assistant content(s)):
 * - full_historical          : original (control)
 * - length_only              : same length, neutral filler prose only
 * - goal_transitions         : keep/amplify Goal1→Goal2→Goal3 chaining cues
 * - exchange_structure       : keep dialogue + visible reaction exchange skeleton
 * - unfinished_tension       : keep carry-over, open questions, dangling tension
 * - meta_only                : very short placeholders (number of turns preserved)
 * - scene_continuity         : keep location, physical state, sensory, time continuity
 * - minimal                  : almost no prior assistant content
 *
 * For each arm we measure on the *current* output:
 * - outputChars
 * - goalCount (thematic clusters)
 * - exchangeCount (dialogue+reaction pairs)
 * - goalDepth (progression chaining)
 *
 * All other things fixed:
 * - Current Phase2 prompt + builder + runtime
 * - Same target, same triggering user message
 * - statusWidgetActive = false (isolate history content)
 * - Mandate OFF
 *
 * Usage:
 *   npx.cmd tsx scripts/experiment5-history-ablations.ts --targetId=333 --reps=3
 */

import fs from "fs";
import path from "path";
import Module from "module";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import { getDatabasePath } from "../src/lib/dataDir";

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
const DEFAULT_TARGET_ID = 333;
const DELAY_MS = 4200;
const REPS_DEFAULT = 3;

type Ablation =
  | "full_historical"
  | "length_only"
  | "goal_transitions"
  | "exchange_structure"
  | "unfinished_tension"
  | "meta_only"
  | "scene_continuity"
  | "minimal";

type Sample = {
  ablation: Ablation;
  run: number;
  outputChars: number;
  outputTokens: number;
  beats: number;
  goalCount: number;
  exchangeCount: number;
  goalDepth: number;
  terminal: string;
  finish: string;
};

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function displayProse(t: string): string {
  let s = t || "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  return s.trim();
}

/** Goal / exchange / depth estimator (reused logic) */
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

  return {
    goalCount,
    exchangeCount: Math.max(1, exchanges),
    goalDepth
  };
}

function classifyTerminal(prose: string): string {
  const last = prose.trim().split(/\n\n+/).pop() || "";
  if (/[,…]\s*$/.test(last) || /(?:하지만|그런데|아직|더 |이어서|곧)/.test(last.slice(-60))) return "tension_continuation";
  if (/"[^"]{4,}"\s*[.!?…]?\s*$/.test(last)) return "dialogue_resolution";
  if (/(?:기다리|지켜보|바라보|응시|멈춰|확인하며)/.test(last)) return "observer_wait";
  if (/(?:눈동자|시선|표정|긴장|동공|손목|숨|속으로)/.test(last)) return "immediate_reaction";
  return "other";
}

/** Load previous N assistant turns before targetId in the same chat */
function loadPreviousAssistants(db: Database.Database, targetId: number, n = 2): string[] {
  const row = db.prepare("SELECT chat_id FROM messages WHERE id = ?").get(targetId) as any;
  if (!row) throw new Error(`No message for id ${targetId}`);

  const prevs = db.prepare(`
    SELECT content
    FROM messages
    WHERE chat_id = ? AND id < ? AND role = 'assistant'
    ORDER BY id DESC
    LIMIT ?
  `).all(row.chat_id, targetId, n) as Array<{content: string}>;

  return prevs.map(p => p.content).reverse(); // chronological
}

/** Load the user message that triggered the target assistant */
function loadTriggeringUser(db: Database.Database, targetId: number): string {
  const row = db.prepare("SELECT chat_id FROM messages WHERE id = ?").get(targetId) as any;
  const userRow = db.prepare(`
    SELECT content
    FROM messages
    WHERE chat_id = ? AND id < ? AND role = 'user'
    ORDER BY id DESC
    LIMIT 1
  `).get(row.chat_id, targetId) as any;
  return userRow?.content || "자동진행";
}

/** Ablation functions — operate on a single previous assistant text */

function ablateLengthOnly(text: string): string {
  const len = Math.max(50, text.length);
  const base = "이전 장면의 행동이 이어졌다. 상황은 여전히 진행 중이었다. ";
  let out = "";
  while (out.length < len) out += base;
  return out.slice(0, len);
}

function ablateGoalTransitions(text: string): string {
  // Keep lines that contain chaining / progression language, plus some connectors
  const lines = text.split(/\n+/);
  const keep: string[] = [];
  for (const line of lines) {
    if (/(그리고|이어서|더 |한층|곧바로|다시|이어|그러자|그 순간|계속|이제|목표|다음|진행|이동)/.test(line)) {
      keep.push(line.trim());
    }
  }
  if (keep.length === 0) {
    // fallback: create minimal transition skeleton
    return "그는 이전 목표를 마무리하고 다음 행동으로 이어갔다. 상황이 한 단계 더 진행되었다.";
  }
  let joined = keep.join(" ");
  // pad a bit to keep some volume
  const target = Math.max(200, Math.floor(text.length * 0.6));
  while (joined.length < target) joined += " 그리고 상황은 이어졌다.";
  return joined;
}

function ablateExchangeStructure(text: string): string {
  // Try to preserve "dialogue" + "visible reaction" pattern
  const paras = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
  const skeleton: string[] = [];
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i];
    if (/"[^"]{4,}"/.test(p)) {
      skeleton.push('"..."');
      if (i + 1 < paras.length) {
        // turn next para into a generic reaction
        skeleton.push("그의 표정이 미세하게 변했다. 손끝에 힘이 들어갔다.");
        i++; // skip one
      }
    } else if (/눈|표정|손|몸|숨|동공|시선|반응|움직/.test(p)) {
      skeleton.push("그는 즉시 반응했다.");
    }
  }
  if (skeleton.length < 3) {
    skeleton.push('"..."', "그녀는 대답 대신 몸을 돌렸다.", '"더 가까이."', "그의 손이 움직였다.");
  }
  return skeleton.join("\n\n");
}

function ablateUnfinishedTension(text: string): string {
  const lines = text.split(/\n+/);
  const keep: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/(하지만|그런데|아직|더 |이어서|곧|멈추지|끝나지|걸려|파고들|말해지지|...|…|\?)/.test(t)) {
      keep.push(t);
    }
  }
  if (keep.length === 0) {
    return "아직 끝나지 않았다. 하지만 그는 움직이지 않았다...";
  }
  let joined = keep.join(" ");
  const target = Math.max(150, Math.floor(text.length * 0.5));
  while (joined.length < target) joined += " 아직...";
  return joined;
}

function ablateMetaOnly(text: string, turnIndex: number): string {
  // Very short, almost no content. The "meta" is the existence and order of the turn.
  const shorts = [
    "계속되었다.",
    "상황은 변하지 않았다.",
    "그는 가만히 있었다.",
    "시간이 흘렀다."
  ];
  return shorts[turnIndex % shorts.length];
}

function ablateSceneContinuity(text: string): string {
  // Keep location, physical contact, sensory, atmosphere cues
  const lines = text.split(/\n+/);
  const keep: string[] = [];
  for (const line of lines) {
    if (/(엘리베이터|벽|복도|형광등|공기|온도|밀폐|철|손목|손|눈동자|동공|숨결|체온|가까이|밀착|벽 쪽|바닥|천장|불빛)/.test(line)) {
      keep.push(line.trim());
    }
  }
  if (keep.length === 0) {
    return "엘리베이터 안의 공기가 무거웠다. 형광등이 깜빡였다. 그의 손이 벽 쪽에 닿아 있었다.";
  }
  let joined = keep.join(" ");
  const target = Math.max(200, Math.floor(text.length * 0.55));
  while (joined.length < target) joined += " 주변은 여전히 엘리베이터였다.";
  return joined;
}

function ablateMinimal(): string {
  return "...";
}

function applyAblation(originals: string[], ablation: Ablation): string[] {
  return originals.map((text, idx) => {
    switch (ablation) {
      case "full_historical": return text;
      case "length_only": return ablateLengthOnly(text);
      case "goal_transitions": return ablateGoalTransitions(text);
      case "exchange_structure": return ablateExchangeStructure(text);
      case "unfinished_tension": return ablateUnfinishedTension(text);
      case "meta_only": return ablateMetaOnly(text, idx);
      case "scene_continuity": return ablateSceneContinuity(text);
      case "minimal": return ablateMinimal();
      default: return text;
    }
  });
}

async function main() {
  const targetArg = process.argv.find(a => a.startsWith("--targetId="));
  const targetId = targetArg ? parseInt(targetArg.split("=")[1], 10) : DEFAULT_TARGET_ID;
  const reps = parseInt(process.argv.find(a => a.startsWith("--reps="))?.split("=")[1] || String(REPS_DEFAULT), 10);

  const db = new Database(getDatabasePath(), { readonly: true });

  const prevAssistants = loadPreviousAssistants(db, targetId, 2);
  if (prevAssistants.length === 0) throw new Error("No previous assistants found");

  const triggerUser = loadTriggeringUser(db, targetId);

  // Get historical target + completed for context
  const genRow = db.prepare("SELECT context_json FROM message_generations WHERE message_id = ? LIMIT 1").get(targetId) as any;
  const ctx = JSON.parse(genRow?.context_json || "{}");
  const target = ctx.targetResponseChars ?? 3000;
  const completed = ctx.completedTurns ?? 5;

  db.close();

  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  const charName = "백하율";
  const persona = "렌";

  const chunks = parseCharacterSetting({
    characterId: "bc-exp5",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하다.`,
    world: `# 세계관\n현대 밀폐 공간.`,
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const ablations: Ablation[] = [
    "full_historical",
    "length_only",
    "goal_transitions",
    "exchange_structure",
    "unfinished_tension",
    "meta_only",
    "scene_continuity",
    "minimal"
  ];

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonl = path.join(outDir, `experiment5-history-ablations-${targetId}.jsonl`);
  const report = path.join(outDir, `experiment5-history-ablations-${targetId}-report.txt`);

  const samples: Sample[] = [];

  for (const ablation of ablations) {
    const ablatedPrev = applyAblation(prevAssistants, ablation);

    for (let r = 1; r <= reps; r++) {
      // Build shortTermHistory with ablated previous assistants + the triggering user
      const shortTermHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
      // We assume the original sequence alternated. For simplicity we put the ablated assistants in order.
      // To be more faithful we interleave with the original user messages between them, but for ablation focus we keep the assistant signals.
      // Simpler: put the ablated assistants as consecutive previous turns (the model mainly cares about recent assistant behavior).
      for (const c of ablatedPrev) {
        shortTermHistory.push({ role: "assistant", content: c });
      }
      // final user
      shortTermHistory.push({ role: "user", content: triggerUser });

      const built = buildContext({
        charName,
        chunks,
        userNickname: persona,
        userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
        userNote: formatUserNoteForPrompt("검증", persona),
        longTermMemory: "[요약] ablation test",
        shortTermHistory,
        currentUserMessage: triggerUser,
        nsfw: true,
        gender: "male",
        memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"tense"}')),
        modelId: MODEL_ID,
        provider: "openrouter",
        personaDisplayName: persona,
        targetResponseChars: target,
        completedTurns: completed,
        userPersonaGender: "other",
        statusWidgetActive: false,
      });

      const split = built.openRouterSystemSplit!;
      const system = [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock].filter(Boolean).join("\n\n");
      const apiHist = built.history.slice(0, -1).map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

      console.log(`\n[exp5] ${ablation} run ${r}/${reps} (targetId=${targetId})`);
      await sleep(DELAY_MS);

      const res = await callOpenRouterAdult(system, [...apiHist, { role: "user", content: triggerUser }], MODEL_ID, target, { charName }, { chargeTurnBudget: false, requestKind: "exp5-history-ablation" });

      const prose = displayProse(res.text || "");
      const beats = prose.split(/\n\n+/).filter(Boolean).length;
      const metrics = estimateGoalMetrics(prose);
      const term = classifyTerminal(prose);

      const sample: Sample = {
        ablation,
        run: r,
        outputChars: prose.length,
        outputTokens: (res.usage as any)?.outputTokens ?? 0,
        beats,
        goalCount: metrics.goalCount,
        exchangeCount: metrics.exchangeCount,
        goalDepth: metrics.goalDepth,
        terminal: term,
        finish: String((res.usage as any)?.finishReason ?? "unknown"),
      };
      samples.push(sample);
      fs.appendFileSync(jsonl, JSON.stringify(sample) + "\n", "utf8");
      console.log(`  -> ${sample.outputChars}ch goals=${metrics.goalCount} exch=${metrics.exchangeCount} depth=${metrics.goalDepth}`);
    }
  }

  // Report
  const lines: string[] = [];
  lines.push(`=== Experiment 5: History Ablations (target historical id ${targetId}) ===`);
  lines.push(`reps per arm: ${reps}`);
  lines.push("All other variables fixed to current Phase2 stack (widget OFF for isolation).");
  lines.push("");

  function stats(arr: number[]) {
    if (!arr.length) return { mean: 0, med: 0, p90: 0, std: 0 };
    const sorted = [...arr].sort((a, b) => a - b);
    const mean = arr.reduce((s, x) => s + x, 0) / arr.length;
    const med = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const p90 = sorted[Math.ceil(sorted.length * 0.9) - 1];
    const m = mean;
    const std = Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
    return { mean: +mean.toFixed(1), med: +med.toFixed(1), p90: +p90.toFixed(1), std: +std.toFixed(1) };
  }

  const metrics = ["outputChars", "goalCount", "exchangeCount", "goalDepth"] as const;

  for (const m of metrics) {
    lines.push(`--- ${m} ---`);
    for (const ab of ablations) {
      const arr = samples.filter(s => s.ablation === ab).map(s => (s as any)[m] as number);
      const st = stats(arr);
      lines.push(`${ab.padEnd(20)} mean=${st.mean} med=${st.med} p90=${st.p90} std=${st.std} (n=${arr.length})`);
    }
    lines.push("");
  }

  lines.push("Interpretation guide:");
  lines.push("- length_only high  → raw token volume / recency bias matters");
  lines.push("- goal_transitions high → explicit chaining language is the signal");
  lines.push("- exchange_structure high → dialogue-reaction rhythm drives continuation");
  lines.push("- unfinished_tension high → open loops / carry-over pressure the model to continue");
  lines.push("- scene_continuity high → physical/scene grounding enables longer coherent development");
  lines.push("- meta_only low → just turn count / completedTurns is not enough");
  lines.push("- minimal → baseline without prior momentum");

  fs.writeFileSync(report, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log("Wrote", jsonl);
  console.log("Wrote", report);
}

main().catch(e => { console.error(e); process.exit(1); });
