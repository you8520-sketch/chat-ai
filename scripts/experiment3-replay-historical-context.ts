/**
 * Experiment 3: Replay 2026-06-14 historical context with CURRENT builder + DeepSeek
 *
 * For a chosen historical long turn (e.g. id 333 = 4492ch peak),
 * we reconstruct the build inputs *as they were then*:
 *   - the exact sequence of messages up to the triggering user message
 *   - the targetResponseChars that was recorded for that turn
 *   - completedTurns
 *
 * Then we build with the *current* ContextBuilder (no prompt changes)
 * and call DeepSeek.
 *
 * If we get ~3000-4500ch again, it strongly suggests the difference was in
 * the *inputs* the builder received in 2026-06-14 (history composition,
 * anchoring from previous long turns, widget presence in history, target, etc.)
 * rather than later changes to the prompt rules themselves.
 *
 * Usage:
 *   npx.cmd tsx scripts/experiment3-replay-historical-context.ts --ids=333,331,410 --reps=2
 *
 * It now runs widget (on/off) × promptVariant (historical / current) for each historical context.
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
const DELAY = 4500;

type PromptVariant = "current" | "historical";

type ReplayResult = {
  historicalId: number;
  historicalChars: number;
  targetUsed: number;
  promptVariant: PromptVariant;
  widget: boolean;
  run: number;
  outputChars: number;
  outputTokens: number;
  beats: number;
  hasWidgetTail: boolean;
  finish: string;
  // new goal metrics
  goalCount: number;
  exchangeCount: number;
  goalDepth: number;
};

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function displayProse(t: string) {
  let s = t || "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  return s.trim();
}

/** Lighter "historical" (pre-full Phase2) style instruction — less mandatory multi-beat chaining */
const HISTORICAL_LIGHT_LENGTH_BLOCK = `[LENGTH & COMPLETION — historical style]
Generate a complete scene segment in one pass.
Do not end immediately after a single dialogue + reaction.
Meet the TARGET length. Avoid observer endings (pure waiting for [B]) when possible.
Continue at least through one clear action or internal development before handoff.`;

/** Simple goal / exchange / depth estimator */
function estimateGoalMetrics(prose: string) {
  const paras = prose.trim().split(/\n\n+/).map(p => p.trim()).filter(Boolean);

  // Exchange: dialogue quote followed reasonably soon by visible reaction
  let exchanges = 0;
  for (let i = 0; i < paras.length - 1; i++) {
    if (/"[^"]{4,}"/.test(paras[i])) {
      const next = (paras[i+1] + " " + (paras[i+2] || "")).toLowerCase();
      if (/눈|표정|손|몸|숨|동공|시선|반응|움직|가까|물러|다가/.test(next)) exchanges++;
    }
  }

  // Thematic goal clusters
  const clusters: string[] = [];
  const text = prose.toLowerCase();
  if (/(위험|보호|막|숨|안전|경보|피해)/.test(text)) clusters.push("protect");
  if (/(괜찮|안심|진정|위로|걱정|무서)/.test(text)) clusters.push("reassure");
  if (/(더 가까|손|허리|입술|숨결|밀착|키스|뜨거|벗|스치|욕망)/.test(text)) clusters.push("intimacy");
  if (/(왜|하지만|아직|뭐|어떻게|진심)/.test(text)) clusters.push("question");
  if (/(움직|들어|다가|밀|당기|일어서|잡|안아)/.test(text)) clusters.push("action");

  const goalCount = Math.max(1, clusters.length);

  // Goal depth: how many "progression / continuation" steps
  let depth = 1;
  const progressionMarkers = /(그리고|이어서|그 말과 동시에|더|한층|곧바로|다시|이어|그러자|그 순간)/g;
  const matches = prose.match(progressionMarkers) || [];
  depth = Math.min(6, 1 + Math.floor(matches.length / 3)); // rough chaining

  return {
    goalCount,
    exchangeCount: Math.max(1, exchanges),
    goalDepth: depth
  };
}

async function main() {
  const arg = process.argv.find(a => a.startsWith("--ids="));
  const ids = arg ? arg.split("=")[1].split(",").map(Number) : [333, 331, 410];
  const reps = parseInt(process.argv.find(a => a.startsWith("--reps="))?.split("=")[1] || "2", 10);

  const db = new Database(getDatabasePath(), { readonly: true });

  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { splitProseAndStatusWidgetValuesDeepSeek } = await import("../src/lib/statusWidget/deepseekCapture");

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonl = path.join(outDir, "experiment3-replay-historical-context.jsonl");
  const reportPath = path.join(outDir, "experiment3-replay-historical-context-report.txt");

  const results: ReplayResult[] = [];

  for (const histId of ids) {
    // Load generation record for target + chat
    const gen = db.prepare("SELECT chat_id, context_json, input_tokens, output_tokens FROM message_generations WHERE message_id = ? LIMIT 1").get(histId) as any;
    if (!gen) { console.log("no gen for", histId); continue; }

    const ctx = JSON.parse(gen.context_json || "{}");
    const target = ctx.targetResponseChars ?? 3000;
    const completed = ctx.completedTurns ?? 5;
    const chatId = gen.chat_id;

    // Load all messages up to (but not including) this assistant
    const rawMsgs = db.prepare(`
      SELECT role, content
      FROM messages
      WHERE chat_id = ? AND id < ?
      ORDER BY id ASC
    `).all(chatId, histId) as Array<{role: string; content: string}>;

    if (rawMsgs.length < 2) { console.log("not enough history for", histId); continue; }

    // The last message must be the user turn
    const currentUser = rawMsgs[rawMsgs.length - 1];
    const shortTermHistory = rawMsgs.slice(0, -1).map(m => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const charName = "백하율";
    const persona = "렌";

    const chunks = parseCharacterSetting({
      characterId: "bc-replay",
      characterName: charName,
      gender: "male",
      systemPrompt: `# 성격\n차분하고 집요하다.`,
      world: `# 세계관\n현대 밀폐 공간.`,
      exampleDialog: "",
      statusWindowPrompt: "",
    });

    const promptVariants: PromptVariant[] = ["current", "historical"];

    for (const widgetMode of [false, true] as const) {
      for (const promptVariant of promptVariants) {
        for (let r = 1; r <= reps; r++) {
          const built = buildContext({
            charName,
            chunks,
            userNickname: persona,
            userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
            userNote: formatUserNoteForPrompt("검증", persona),
            longTermMemory: "[요약] chat25 burst period reconstruction",
            shortTermHistory,
            currentUserMessage: currentUser.content,
            nsfw: true,
            gender: "male",
            memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"tense"}')),
            modelId: MODEL_ID,
            provider: "openrouter",
            personaDisplayName: persona,
            targetResponseChars: target,
            completedTurns: completed,
            userPersonaGender: "other",
            statusWidgetActive: widgetMode,
          });

          let system = [built.openRouterSystemSplit!.systemRulesBlock, built.openRouterSystemSplit!.characterSettingsBlock, built.openRouterSystemSplit!.dynamicBlock]
            .filter(Boolean).join("\n\n");

          // Simulate "Historical Prompt" by replacing heavy Phase2 checklist with lighter rules
          if (promptVariant === "historical") {
            // Remove or weaken the full S1-S6 mandatory expansion and strong EXCHANGE_COMPLETE forbid
            system = system.replace(/\[SCENE COMPLETION CONTROL\][\s\S]*?(?=\n\n\[|$)/, HISTORICAL_LIGHT_LENGTH_BLOCK + "\n\n");
            system = system.replace(/<TURN_HANDOFF_AND_PACING>[\s\S]*?<\/TURN_HANDOFF_AND_PACING>/, "<TURN_HANDOFF_AND_PACING>\nHandoff after reasonable scene development and length target. Avoid pure observer endings.\n</TURN_HANDOFF_AND_PACING>");
          }

          const apiHist = built.history.slice(0, -1).map(m => ({ role: m.role as "user"|"assistant", content: m.content }));

          console.log(`\n[exp3] histId=${histId} widget=${widgetMode} prompt=${promptVariant} run ${r}/${reps} target=${target}`);
          await sleep(DELAY);

          const res = await callOpenRouterAdult(system, [...apiHist, { role: "user", content: currentUser.content }], MODEL_ID, target, { charName }, { chargeTurnBudget: false, requestKind: "exp3-replay-historical" });

          const raw = res.text || "";
          const { prose, hadTail } = (() => {
            const sp = splitProseAndStatusWidgetValuesDeepSeek(raw);
            const p = sp.prose || raw;
            return { prose: displayProse(p), hadTail: !!(sp.values && (sp.values.character || sp.values.user)) };
          })();

          const beats = prose.split(/\n\n+/).filter(Boolean).length;
          const metrics = estimateGoalMetrics(prose);

          const sample: ReplayResult = {
            historicalId: histId,
            historicalChars: 0,
            targetUsed: target,
            promptVariant,
            widget: widgetMode,
            run: r,
            outputChars: prose.length,
            outputTokens: (res.usage as any)?.outputTokens ?? 0,
            beats,
            hasWidgetTail: hadTail,
            finish: String((res.usage as any)?.finishReason ?? "unknown"),
            goalCount: metrics.goalCount,
            exchangeCount: metrics.exchangeCount,
            goalDepth: metrics.goalDepth,
          };

          const histLenRow = db.prepare("SELECT length(content) as chars FROM messages WHERE id = ?").get(histId) as any;
          sample.historicalChars = histLenRow?.chars ?? 0;

          results.push(sample);
          fs.appendFileSync(jsonl, JSON.stringify(sample) + "\n", "utf8");
          console.log(`  replayed ${sample.outputChars}ch (hist ${sample.historicalChars}ch) goals=${metrics.goalCount} exch=${metrics.exchangeCount} depth=${metrics.goalDepth} widgetTail=${hadTail}`);
        }
      }
    }
  }

  db.close();

  // Report with prompt variant + goal metrics
  const lines: string[] = [];
  lines.push("=== Experiment 3: Historical Context Replay ===");
  lines.push(`ids: ${ids.join(", ")}`);
  lines.push("Grid: widget (on/off) × promptVariant (historical / current)");

  for (const hid of ids) {
    const histChars = results.find(r => r.historicalId === hid)?.historicalChars ?? 0;
    lines.push(`\n--- historical id ${hid} (recorded ~${histChars}ch) ---`);

    for (const pv of ["historical", "current"] as PromptVariant[]) {
      for (const w of [false, true]) {
        const subset = results.filter(r => r.historicalId === hid && r.promptVariant === pv && r.widget === w);
        if (!subset.length) continue;
        const mChars = mean(subset.map(x=>x.outputChars));
        const mGoals = mean(subset.map(x=>x.goalCount));
        const mExch = mean(subset.map(x=>x.exchangeCount));
        const mDepth = mean(subset.map(x=>x.goalDepth));
        const wLabel = w ? "ON" : "OFF";
        lines.push(`  prompt=${pv} widget=${wLabel} : mean ${mChars.toFixed(0)}ch | goals≈${mGoals.toFixed(1)} exch≈${mExch.toFixed(1)} depth≈${mDepth.toFixed(1)} (n=${subset.length})`);
      }
    }
  }

  lines.push("\nInterpretation:");
  lines.push("- If Historical Context + Historical Prompt → long output, but Historical Context + Current Prompt → short: the prompt rule change (S1-S6 etc.) is the main killer of chaining.");
  lines.push("- If both are short: the historical *inputs* (long prev assistant in history + anchoring + target at the time) were critical.");
  lines.push("- GoalCount / Depth help distinguish 'more goals activated' vs 'one goal described longer'.");
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log("Wrote", jsonl);
  console.log("Wrote", reportPath);
}

function mean(a: number[]) { return a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0; }

main().catch(e => { console.error(e); process.exit(1); });
