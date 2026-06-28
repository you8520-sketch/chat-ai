/**
 * Experiment 7: Minimum Authentic Historical Fragment
 *
 * Goal: Find the smallest piece of *real* previous assistant output (from the
 * successful long turn at id 333) that is still sufficient to drive long,
 * multi-goal, high-exchange chaining on the next turn.
 *
 * Method:
 * - Load the *exact* historical assistant message(s) that preceded the long
 *   output at message id 333 (raw content, no summarization).
 * - Use the most recent previous assistant (id 331) as the variable fragment.
 * - Keep everything else identical:
 *     - Current Phase2 prompt + ContextBuilder + DeepSeek V4 Pro
 *     - Same targetResponseChars / completedTurns as the original generation
 *     - statusWidgetActive = false
 *     - No DeepSeek Continuation Mandate
 *     - Fixed earlier history (if any) + the ablated fragment + the original trigger user
 *
 * Ablations:
 *
 * Truncation from the end (progressive):
 *   full
 *   last_2_paragraphs
 *   last_1_paragraph
 *   last_5_sentences
 *   last_3_sentences
 *   last_1_sentence
 *
 * Content-type slices (applied to the full previous assistant):
 *   dialogue_only
 *   narrative_only
 *   emotional_only
 *   action_only
 *
 * Metrics on the generated output:
 *   outputChars, goalCount, exchangeCount, goalDepth, terminal, openEnding
 *
 * Objective:
 *   Identify the minimum authentic fragment that still reproduces the
 *   long-output + high Goal activation / Exchange chaining effect.
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
const DELAY_MS = 4000;
const REPS_DEFAULT = 3;

type Ablation =
  | "full"
  | "last_2_paragraphs"
  | "last_1_paragraph"
  | "last_5_sentences"
  | "last_3_sentences"
  | "last_1_sentence"
  | "dialogue_only"
  | "narrative_only"
  | "emotional_only"
  | "action_only";

type Sample = {
  ablation: Ablation;
  run: number;
  fragmentChars: number;
  fragmentRoughTokens: number;
  outputChars: number;
  outputTokens: number;
  beats: number;
  goalCount: number;
  exchangeCount: number;
  goalDepth: number;
  terminal: string;
  openEnding: boolean;
  finish: string;
  // Store a short preview of what fragment was actually injected
  fragmentPreview: string;
};

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function displayProse(t: string): string {
  let s = t || "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  return s.trim();
}

function estimateGoalMetrics(prose: string) {
  const paras = prose.trim().split(/\n\n+/).map(p => p.trim()).filter(Boolean);

  let exchanges = 0;
  for (let i = 0; i < paras.length - 1; i++) {
    if (/"[^"]{4,}"/.test(paras[i]) || /[「『“”]/.test(paras[i])) {
      const next = (paras[i + 1] + " " + (paras[i + 2] || "")).toLowerCase();
      if (/눈|표정|손|몸|숨|동공|시선|반응|움직|가까|물러|다가|밀|당기|베|찌|공격|뛰/.test(next)) exchanges++;
    }
  }

  const text = prose.toLowerCase();
  const clusters: string[] = [];
  if (/(위험|보호|막|숨|안전|경보|피해|가로막|리스크)/.test(text)) clusters.push("protect");
  if (/(괜찮|안심|진정|위로|걱정|무서|떨|불안)/.test(text)) clusters.push("reassure");
  if (/(더 가까|손|허리|입술|숨결|밀착|키스|뜨거|벗|스치|욕망|파고|체온|접촉)/.test(text)) clusters.push("intimacy");
  if (/(왜|하지만|아직|뭐|어떻게|진심|의심|계획|다음)/.test(text)) clusters.push("question");
  if (/(움직|들어|다가|밀|당기|일어서|잡|안아|걸어|향해|베|찌|공격|도망|추적)/.test(text)) clusters.push("action");

  const goalCount = Math.max(1, clusters.length);

  const progressionMarkers = /(그리고|이어서|그 말과 동시에|더 |한층|곧바로|다시|이어|그러자|그 순간|계속|이제|목표|다음|진행)/g;
  const matches = prose.match(progressionMarkers) || [];
  const goalDepth = Math.min(6, 1 + Math.floor(matches.length / 2.3));

  return { goalCount, exchangeCount: Math.max(1, exchanges), goalDepth };
}

function classifyTerminal(prose: string): string {
  const last = prose.trim().split(/\n\n+/).pop() || "";
  if (/[,…]\s*$/.test(last) || /(?:하지만|그런데|아직|더 |이어서|곧|말을|손을)/.test(last.slice(-70))) return "tension_continuation";
  if (/"[^"]{4,}"\s*[.!?…]?\s*$/.test(last) || /[」』”]/.test(last)) return "dialogue_resolution";
  if (/(?:기다리|지켜보|바라보|응시|멈춰|확인하며|가만히)/.test(last)) return "observer_wait";
  if (/(?:눈동자|시선|표정|긴장|동공|손목|숨|속으로|가슴)/.test(last)) return "immediate_reaction";
  return "other";
}

function hasOpenEnding(prose: string): boolean {
  const last = (prose.trim().split(/\n\n+/).pop() || "").trim();
  if (!last) return false;
  if (/[,…]$/.test(last)) return true;
  const tail = last.slice(-90).toLowerCase();
  return /(하지만|그런데|아직|더 |이어서|곧|말을|손을|눈을|숨을|...|\.\.\.|계속|미완)/.test(tail);
}

function roughTokens(s: string): number {
  return Math.max(1, Math.round(s.length / 2.7));
}

/** Paragraph / sentence helpers */
function splitParagraphs(text: string): string[] {
  return text.trim().split(/\n\n+/).map(p => p.trim()).filter(Boolean);
}

function getLastNParagraphs(text: string, n: number): string {
  const p = splitParagraphs(text);
  return p.slice(-n).join("\n\n");
}

function splitSentences(text: string): string[] {
  // Split keeping terminators
  const parts = text.split(/([.!?…。！？]+)/g);
  const sents: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = (parts[i] || "").trim();
    const term = parts[i + 1] || "";
    if (body) sents.push((body + term).trim());
  }
  return sents.filter(Boolean);
}

function getLastNSentences(text: string, n: number): string {
  const s = splitSentences(text);
  return s.slice(-n).join(" ");
}

/** Content type extractors (heuristic, on full previous assistant) */
function extractDialogue(text: string): string {
  const paras = splitParagraphs(text);
  const kept = paras.filter(p =>
    /["「『“”‘’]/.test(p) ||
    /".{3,}"/.test(p) ||
    /…/.test(p) && p.length < 120
  );
  if (kept.length === 0) {
    // fallback: last ~400 chars which often contain speech
    return text.trim().slice(-450);
  }
  return kept.join("\n\n");
}

function extractNarrative(text: string): string {
  const paras = splitParagraphs(text);
  const kept = paras.filter(p =>
    !/["「『“”‘’]/.test(p) && !/".{3,}"/.test(p)
  );
  if (kept.length === 0) return text.trim().slice(-600);
  return kept.join("\n\n");
}

const EMO_KEYWORDS = /(속으로|생각|느낌|두근|떨림?|긴장|불안|욕망|가슴|심장|미안|죄책|후회|설렘|무서|걱정|외로|외로움|그리움|애틋|뜨거운|차가운|아픔|아파|설레)/;
function extractEmotional(text: string): string {
  const paras = splitParagraphs(text);
  const kept = paras.filter(p => EMO_KEYWORDS.test(p));
  if (kept.length === 0) {
    // fallback to any internal-state heavy tail
    return text.trim().slice(-500);
  }
  return kept.join("\n\n");
}

const ACTION_KEYWORDS = /(움직|손을|손끝|발|발걸음|몸을|달리|뛰|베|찌|공격|도망|추적|잡|안아|밀|당기|돌아|향해|걸어|일어서|쓰러|피하|막|방어|진입|착지|비행|돌진|휘두|검|총|스킬|마력|기어|출력)/;
function extractAction(text: string): string {
  const paras = splitParagraphs(text);
  const kept = paras.filter(p => ACTION_KEYWORDS.test(p));
  if (kept.length === 0) return text.trim().slice(-500);
  return kept.join("\n\n");
}

function applyAblation(fullPrevAssistant: string, ablation: Ablation): { text: string; preview: string } {
  let out = fullPrevAssistant;
  switch (ablation) {
    case "full":
      break;
    case "last_2_paragraphs":
      out = getLastNParagraphs(fullPrevAssistant, 2);
      break;
    case "last_1_paragraph":
      out = getLastNParagraphs(fullPrevAssistant, 1);
      break;
    case "last_5_sentences":
      out = getLastNSentences(fullPrevAssistant, 5);
      break;
    case "last_3_sentences":
      out = getLastNSentences(fullPrevAssistant, 3);
      break;
    case "last_1_sentence":
      out = getLastNSentences(fullPrevAssistant, 1);
      break;
    case "dialogue_only":
      out = extractDialogue(fullPrevAssistant);
      break;
    case "narrative_only":
      out = extractNarrative(fullPrevAssistant);
      break;
    case "emotional_only":
      out = extractEmotional(fullPrevAssistant);
      break;
    case "action_only":
      out = extractAction(fullPrevAssistant);
      break;
  }
  // Make sure we never feed completely empty
  if (!out || out.trim().length < 10) {
    out = fullPrevAssistant.trim().slice(-180);
  }
  const preview = out.trim().slice(0, 180).replace(/\s+/g, " ");
  return { text: out, preview };
}

async function main() {
  const targetArg = process.argv.find(a => a.startsWith("--targetId="));
  const targetId = targetArg ? parseInt(targetArg.split("=")[1], 10) : DEFAULT_TARGET_ID;
  const reps = parseInt(process.argv.find(a => a.startsWith("--reps="))?.split("=")[1] || String(REPS_DEFAULT), 10);

  const db = new Database(getDatabasePath(), { readonly: true });

  // Load the previous assistants that were in history for the long turn 333
  const chatRow = db.prepare("SELECT chat_id FROM messages WHERE id = ?").get(targetId) as any;
  const chatId = chatRow.chat_id;

  const prevAssts = db.prepare(`
    SELECT id, content, length(content) as len
    FROM messages
    WHERE chat_id = ? AND id < ? AND role = 'assistant'
    ORDER BY id DESC
    LIMIT 2
  `).all(chatId, targetId) as Array<{id: number; content: string; len: number}>;

  // We expect two: older (e.g. 329) + most recent (e.g. 331)
  // The one we will ablate is the most recent previous assistant.
  const sorted = [...prevAssts].sort((a, b) => a.id - b.id); // oldest first
  const earlierAssistant = sorted.length > 1 ? sorted[0] : null;
  const lastAssistant = sorted[sorted.length - 1];

  if (!lastAssistant) throw new Error("No previous assistant found before target " + targetId);

  const fullLastAssistantText = lastAssistant.content;

  // Get the triggering user message (usually "자동진행")
  const triggerRow = db.prepare(`
    SELECT content FROM messages
    WHERE chat_id = ? AND id < ? AND role = 'user'
    ORDER BY id DESC LIMIT 1
  `).get(chatId, targetId) as any;
  const triggerUser = triggerRow?.content || "자동진행";

  // Original generation parameters for fidelity
  const genRow = db.prepare("SELECT context_json FROM message_generations WHERE message_id = ? LIMIT 1").get(targetId) as any;
  const ctx = JSON.parse(genRow?.context_json || "{}");
  const targetChars = ctx.targetResponseChars ?? 3000;
  const completedTurns = ctx.completedTurns ?? 6;

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
    characterId: "bc-exp7",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하다.`,
    world: `# 세계관\n현대, 능력자, 밀폐/도시 공간.`,
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const ablations: Ablation[] = [
    "full",
    "last_2_paragraphs",
    "last_1_paragraph",
    "last_5_sentences",
    "last_3_sentences",
    "last_1_sentence",
    "dialogue_only",
    "narrative_only",
    "emotional_only",
    "action_only",
  ];

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonl = path.join(outDir, `experiment7-fragment-ablation-${targetId}.jsonl`);
  const report = path.join(outDir, `experiment7-fragment-ablation-${targetId}-report.txt`);

  const samples: Sample[] = [];

  for (const ablation of ablations) {
    const { text: fragText, preview } = applyAblation(fullLastAssistantText, ablation);
    const fragChars = fragText.length;
    const fragTok = roughTokens(fragText);

    for (let r = 1; r <= reps; r++) {
      // Build shortTermHistory:
      // [earlier full assistant (if exists)] + [ablated last assistant] + [trigger user]
      const shortTermHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

      if (earlierAssistant) {
        shortTermHistory.push({ role: "assistant", content: earlierAssistant.content });
      }
      shortTermHistory.push({ role: "assistant", content: fragText });
      shortTermHistory.push({ role: "user", content: triggerUser });

      const built = buildContext({
        charName,
        chunks,
        userNickname: persona,
        userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
        userNote: formatUserNoteForPrompt("검증", persona),
        longTermMemory: "[요약] fragment ablation test - exact historical slice",
        shortTermHistory,
        currentUserMessage: triggerUser,
        nsfw: true,
        gender: "male",
        memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"tense","context":"historical-success"}')),
        modelId: MODEL_ID,
        provider: "openrouter",
        personaDisplayName: persona,
        targetResponseChars: targetChars,
        completedTurns: completedTurns,
        userPersonaGender: "other",
        statusWidgetActive: false,
      });

      const split = built.openRouterSystemSplit!;
      const system = [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock].filter(Boolean).join("\n\n");
      const apiHist = built.history.slice(0, -1).map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

      console.log(`\n[exp7] ${ablation} run ${r}/${reps}  (frag ${fragChars}ch ~${fragTok}tok)`);
      await sleep(DELAY_MS);

      const res = await callOpenRouterAdult(
        system,
        [...apiHist, { role: "user", content: triggerUser }],
        MODEL_ID,
        targetChars,
        { charName },
        { chargeTurnBudget: false, requestKind: "exp7-fragment-ablation" }
      );

      const prose = displayProse(res.text || "");
      const beats = prose.split(/\n\n+/).filter(Boolean).length;
      const metrics = estimateGoalMetrics(prose);
      const term = classifyTerminal(prose);
      const open = hasOpenEnding(prose);

      const sample: Sample = {
        ablation,
        run: r,
        fragmentChars: fragChars,
        fragmentRoughTokens: fragTok,
        outputChars: prose.length,
        outputTokens: (res.usage as any)?.outputTokens ?? 0,
        beats,
        goalCount: metrics.goalCount,
        exchangeCount: metrics.exchangeCount,
        goalDepth: metrics.goalDepth,
        terminal: term,
        openEnding: open,
        finish: String((res.usage as any)?.finishReason ?? "unknown"),
        fragmentPreview: preview,
      };
      samples.push(sample);
      fs.appendFileSync(jsonl, JSON.stringify(sample) + "\n", "utf8");

      console.log(`  -> out=${sample.outputChars}ch  g=${metrics.goalCount} x=${metrics.exchangeCount} d=${metrics.goalDepth}  term=${term} open=${open}`);
    }
  }

  // ==================== REPORT ====================
  const lines: string[] = [];
  lines.push(`=== Experiment 7: Minimum Authentic Historical Fragment (target id ${targetId}) ===`);
  lines.push(`reps per arm: ${reps}`);
  lines.push("All other variables fixed to the production Phase2 stack at the time of the original long turn.");
  lines.push(`Base earlier assistant kept full (if present). Only the most recent previous assistant was sliced.`);
  lines.push(`Original targetChars=${targetChars}  completedTurns=${completedTurns}`);
  lines.push(`Widget: OFF | Mandate: OFF`);
  lines.push("");

  lines.push("--- Full previous assistant used as source (id " + (lastAssistant?.id ?? "?") + ") ---");
  lines.push(`original chars: ${fullLastAssistantText.length}  roughTokens≈${roughTokens(fullLastAssistantText)}`);
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
    return { mean: +mean.toFixed(1), med: +med.toFixed(1), p90: +p90.toFixed(1), std: +std.toFixed(1), min: sorted[0], max: sorted[sorted.length - 1] };
  }

  const metrics = ["outputChars", "goalCount", "exchangeCount", "goalDepth"] as const;

  for (const m of metrics) {
    lines.push(`--- ${m} ---`);
    for (const ab of ablations) {
      const arr = samples.filter(s => s.ablation === ab).map(s => (s as any)[m] as number);
      const st = stats(arr);
      lines.push(`${ab.padEnd(18)} mean=${st.mean} med=${st.med} p90=${st.p90} std=${st.std} (n=${arr.length}) [${st.min}-${st.max}]`);
    }
    lines.push("");
  }

  // Fragment size vs performance
  lines.push("--- Fragment size vs performance (mean) ---");
  for (const ab of ablations) {
    const armS = samples.filter(s => s.ablation === ab);
    if (!armS.length) continue;
    const avgFrag = (armS.reduce((s, x) => s + x.fragmentChars, 0) / armS.length).toFixed(0);
    const avgOut = (armS.reduce((s, x) => s + x.outputChars, 0) / armS.length).toFixed(0);
    const avgEx = (armS.reduce((s, x) => s + x.exchangeCount, 0) / armS.length).toFixed(2);
    const avgDp = (armS.reduce((s, x) => s + x.goalDepth, 0) / armS.length).toFixed(2);
    lines.push(`${ab.padEnd(18)} frag=${avgFrag}ch  out=${avgOut}ch  exch=${avgEx}  depth=${avgDp}`);
  }
  lines.push("");

  // Open ending & terminal
  lines.push("--- Open-ending rate ---");
  for (const ab of ablations) {
    const armS = samples.filter(s => s.ablation === ab);
    const open = armS.filter(s => s.openEnding).length;
    const rate = armS.length ? ((open / armS.length) * 100).toFixed(0) : "0";
    lines.push(`${ab.padEnd(18)} ${open}/${armS.length} (${rate}%)`);
  }
  lines.push("");

  // Best fragments
  lines.push("=== Ranking (by exchangeCount + goalDepth + outputChars composite) ===");
  const ranked = [...ablations].sort((a, b) => {
    const sa = samples.filter(s => s.ablation === a);
    const sb = samples.filter(s => s.ablation === b);
    const score = (s: Sample[]) => {
      if (!s.length) return -999;
      const ex = s.reduce((t, x) => t + x.exchangeCount, 0) / s.length;
      const dp = s.reduce((t, x) => t + x.goalDepth, 0) / s.length;
      const ch = s.reduce((t, x) => t + x.outputChars, 0) / s.length;
      return ex * 2 + dp * 1.5 + (ch / 800);
    };
    return score(sb) - score(sa);
  });
  ranked.forEach((ab, idx) => {
    const armS = samples.filter(s => s.ablation === ab);
    if (!armS.length) return;
    const ex = (armS.reduce((t, x) => t + x.exchangeCount, 0) / armS.length).toFixed(2);
    const dp = (armS.reduce((t, x) => t + x.goalDepth, 0) / armS.length).toFixed(2);
    const ch = (armS.reduce((t, x) => t + x.outputChars, 0) / armS.length).toFixed(0);
    lines.push(`${(idx + 1).toString().padStart(2)}. ${ab.padEnd(18)} exch=${ex} depth=${dp} chars=${ch}`);
  });
  lines.push("");

  lines.push("=== Key question answer ===");
  lines.push("Which is the smallest authentic slice that still produces high exchangeCount + goalDepth?");
  lines.push("Look for arms where performance stays close to 'full' while fragmentChars is much smaller.");
  lines.push("Dialogue-only and last-N-sentences are especially informative for 'minimum sufficient signal'.");
  lines.push("");
  lines.push("If 'last_1_sentence' or 'dialogue_only' still yield high chaining, the model is extremely");
  lines.push("sensitive to the *presence* of certain authentic dialogue/tension anchors rather than volume.");

  fs.writeFileSync(report, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log("\nWrote", jsonl);
  console.log("Wrote", report);
}

main().catch(e => { console.error(e); process.exit(1); });
