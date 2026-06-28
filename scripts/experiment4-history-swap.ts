/**
 * Experiment 4: Current Prompt + Current Builder + Current Model
 * Only the *history* content is swapped between:
 *   - Historical (long previous assistant turns from 2026-06-14 burst, e.g. ~3500-4000ch prev)
 *   - Current (short/recent style previous turns)
 *
 * All other things identical (prompt, runtime, target, widget policy, etc.).
 *
 * Metrics:
 * - output length
 * - estimated Goal Count, Exchange Count, Goal Depth
 *
 * This isolates whether feeding the model a long previous assistant in history
 * is enough (even with today's strict prompt) to produce longer / deeper goal chaining.
 *
 * Usage:
 *   npx.cmd tsx scripts/experiment4-history-swap.ts --reps=5
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
const TARGET = 3000;
const DELAY = 4200;
const REPS_DEFAULT = 5;

type Arm = "historical-history" | "current-history";

type Sample = {
  arm: Arm;
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

function displayProse(t: string) {
  let s = t || "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  return s.trim();
}

/** Goal / exchange / depth estimation (same heuristic as exp3) */
function estimateGoalMetrics(prose: string) {
  const paras = prose.trim().split(/\n\n+/).map(p => p.trim()).filter(Boolean);

  let exchanges = 0;
  for (let i = 0; i < paras.length - 1; i++) {
    if (/"[^"]{4,}"/.test(paras[i])) {
      const next = (paras[i+1] + " " + (paras[i+2] || "")).toLowerCase();
      if (/눈|표정|손|몸|숨|동공|시선|반응|움직|가까|물러|다가/.test(next)) exchanges++;
    }
  }

  const text = prose.toLowerCase();
  const clusters: string[] = [];
  if (/(위험|보호|막|숨|안전|경보|피해)/.test(text)) clusters.push("protect");
  if (/(괜찮|안심|진정|위로|걱정|무서)/.test(text)) clusters.push("reassure");
  if (/(더 가까|손|허리|입술|숨결|밀착|키스|뜨거|벗|스치|욕망)/.test(text)) clusters.push("intimacy");
  if (/(왜|하지만|아직|뭐|어떻게|진심)/.test(text)) clusters.push("question");
  if (/(움직|들어|다가|밀|당기|일어서|잡|안아)/.test(text)) clusters.push("action");

  const goalCount = Math.max(1, clusters.length);

  const progressionMarkers = /(그리고|이어서|그 말과 동시에|더|한층|곧바로|다시|이어|그러자|그 순간)/g;
  const matches = prose.match(progressionMarkers) || [];
  const goalDepth = Math.min(6, 1 + Math.floor(matches.length / 3));

  return { goalCount, exchangeCount: Math.max(1, exchanges), goalDepth };
}

function classifyTerminal(prose: string): string {
  const last = prose.trim().split(/\n\n+/).pop() || "";
  if (/[,…]\s*$/.test(last) || /(?:하지만|그런데|아직|더 |이어서|곧)/.test(last.slice(-60))) return "tension_continuation";
  if (/"[^"]{4,}"\s*[.!?…]?\s*$/.test(last)) return "dialogue_resolution";
  if (/(?:기다리|지켜보|바라보|응시|멈춰)/.test(last)) return "observer_wait";
  if (/(?:눈동자|시선|표정|긴장|동공|손목|숨)/.test(last)) return "immediate_reaction";
  return "other";
}

async function main() {
  const reps = parseInt(process.argv.find(a => a.startsWith("--reps="))?.split("=")[1] || String(REPS_DEFAULT), 10);

  const db = new Database(getDatabasePath(), { readonly: true });

  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  const charName = "백하율";
  const persona = "렌";

  // Use a consistent user message (similar to burst period)
  const userMessage = "정말 고장났나봐.... 나랑 떨어져야되는거아니야??";

  // Historical long previous assistant (from chat25 burst, e.g. around id 329-331 area)
  // We pull a real long assistant from DB for authenticity
  const longPrevRow = db.prepare(`
    SELECT content FROM messages 
    WHERE chat_id=25 AND role='assistant' AND length(content) > 3000 
    ORDER BY id ASC LIMIT 1
  `).get() as any;

  const HISTORICAL_LONG_PREV = longPrevRow?.content || "백하율은 렌을 벽에 밀고 오랫동안 시선을 고정했다. 여러 감정과 계산이 교차했다. 그는 한 걸음 더 들어가며 상황을 주도했다... (fallback)";

  // Short "current style" previous assistant (typical short turn)
  const SHORT_CURRENT_PREV = `백하율은 렌의 말을 듣고 잠시 눈을 가늘게 떴다. "그래?" 그는 낮게 답했다. 손에 힘이 들어갔다.`;

  const chunks = parseCharacterSetting({
    characterId: "bc-exp4",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하다.`,
    world: `# 세계관\n현대. 밀폐 공간 긴장.`,
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonl = path.join(outDir, "experiment4-history-swap.jsonl");
  const report = path.join(outDir, "experiment4-history-swap-report.txt");

  const samples: Sample[] = [];

  for (let r = 1; r <= reps; r++) {
    for (const arm of ["historical-history", "current-history"] as Arm[]) {
      const prevAssistant = arm === "historical-history" ? HISTORICAL_LONG_PREV : SHORT_CURRENT_PREV;

      const shortTermHistory = [
        { role: "user" as const, content: "자동진행" },
        { role: "assistant" as const, content: prevAssistant },
      ];

      const built = buildContext({
        charName,
        chunks,
        userNickname: persona,
        userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
        userNote: formatUserNoteForPrompt("검증", persona),
        longTermMemory: "[요약] 긴장 상태 재현",
        shortTermHistory,
        currentUserMessage: userMessage,
        nsfw: true,
        gender: "male",
        memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"tense"}')),
        modelId: MODEL_ID,
        provider: "openrouter",
        personaDisplayName: persona,
        targetResponseChars: TARGET,
        completedTurns: 6,
        userPersonaGender: "other",
        statusWidgetActive: false, // keep consistent, widget off for clean isolation
      });

      const split = built.openRouterSystemSplit!;
      const system = [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock].filter(Boolean).join("\n\n");
      const apiHist = built.history.slice(0, -1).map(m => ({ role: m.role as "user"|"assistant", content: m.content }));

      console.log(`\n[exp4] ${arm} run ${r}/${reps} prevLen=${prevAssistant.length}`);
      await sleep(DELAY);

      const res = await callOpenRouterAdult(system, [...apiHist, { role: "user", content: userMessage }], MODEL_ID, TARGET, { charName }, { chargeTurnBudget: false, requestKind: "exp4-history-swap" });

      const prose = displayProse(res.text || "");
      const beats = prose.split(/\n\n+/).filter(Boolean).length;
      const m = estimateGoalMetrics(prose);
      const term = classifyTerminal(prose);

      const sample: Sample = {
        arm,
        run: r,
        outputChars: prose.length,
        outputTokens: (res.usage as any)?.outputTokens ?? 0,
        beats,
        goalCount: m.goalCount,
        exchangeCount: m.exchangeCount,
        goalDepth: m.goalDepth,
        terminal: term,
        finish: String((res.usage as any)?.finishReason ?? "unknown"),
      };
      samples.push(sample);
      fs.appendFileSync(jsonl, JSON.stringify(sample) + "\n", "utf8");
      console.log(`  -> ${sample.outputChars}ch goals=${m.goalCount} exch=${m.exchangeCount} depth=${m.goalDepth} term=${term}`);
    }
  }

  db.close();

  // Stats
  function mean(a: number[]){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0;}
  function median(a: number[]){ if(!a.length)return 0; const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }
  function p90(a: number[]){ if(!a.length)return 0; const s=[...a].sort((x,y)=>x-y); return s[Math.ceil(s.length*0.9)-1]; }
  function std(a: number[]){ if(a.length<2)return 0; const m=mean(a); return Math.sqrt(a.reduce((sum,x)=>sum+(x-m)**2,0)/(a.length-1)); }

  const h = samples.filter(s=>s.arm==="historical-history");
  const c = samples.filter(s=>s.arm==="current-history");

  const lines: string[] = [];
  lines.push("=== Experiment 4: Current Prompt + Builder + Model, History only swapped ===");
  lines.push(`reps=${reps}`);
  lines.push("");

  const fields = ["outputChars", "goalCount", "exchangeCount", "goalDepth"] as const;
  for (const f of fields) {
    const ha = h.map(s=> (s as any)[f]);
    const ca = c.map(s=> (s as any)[f]);
    lines.push(`--- ${f} ---`);
    lines.push(`historical-history : mean=${mean(ha).toFixed(1)} med=${median(ha).toFixed(1)} p90=${p90(ha).toFixed(1)} std=${std(ha).toFixed(1)}`);
    lines.push(`current-history    : mean=${mean(ca).toFixed(1)} med=${median(ca).toFixed(1)} p90=${p90(ca).toFixed(1)} std=${std(ca).toFixed(1)}`);
  }

  lines.push("\nIf historical-history produces higher goalCount + goalDepth (not just longer prose on one goal), then long previous context enables deeper goal chaining even under current strict prompt.");
  fs.writeFileSync(report, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log("Wrote", jsonl);
  console.log("Wrote", report);
}

main().catch(e => { console.error(e); process.exit(1); });
