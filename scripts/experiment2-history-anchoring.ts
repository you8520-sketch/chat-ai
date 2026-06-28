/**
 * Experiment 2: History Anchoring (pure, prompt fixed)
 *
 * Same everything (prompt, target, user message, character, completedTurns)
 * except the content length / nature of the *previous assistant turn* in history.
 *
 * A: Previous assistant was long (~3000-4000ch real output from the burst period)
 * B: Previous assistant was short (~700-1200ch)
 *
 * Measure effect on *current* output length, beats, stop type.
 *
 * This directly tests whether the model is heavily anchored by the length of the most recent assistant turn.
 *
 * Usage:
 *   npx.cmd tsx scripts/experiment2-history-anchoring.ts --reps=3
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
const TARGET = 3000;
const DELAY = 4200;
const REPS_DEFAULT = 10;

type Sample = {
  arm: "long-prev" | "short-prev";
  run: number;
  outputChars: number;
  outputTokens: number;
  beats: number;
  dialogue: number;
  terminal: string;
  finish: string;
};

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const reps = parseInt(process.argv.find(a => a.startsWith("--reps="))?.split("=")[1] || String(REPS_DEFAULT), 10);

  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  // Base fixture modeled on the chat25 elevator tension scene (the period of long outputs)
  const charName = "백하율";
  const persona = "렌";

  // A real short user turn that was used during the burst
  const userMsg = "자동진행";

  // We will load two real previous assistant contents from DB if possible, or fall back to synthetic.
  // For cleanliness we construct minimal but realistic RP of different lengths.
  // (In a real run you can replace these with actual DB content of a 3500ch vs 900ch assistant.)

  const LONG_PREV = `백하율은 렌의 손목을 놓지 않고 엘리베이터 벽에 밀착시켰다. 황금빛 눈동자가 느리게 움직이며 렌의 얼굴을 훑었다. 공기가 무거웠다. 형광등이 깜빡일 때마다 두 사람의 그림자가 길게 흔들렸다.
그는 한 걸음 더 들어와 렌의 숨결을 가까이에서 느꼈다. "지금 이 상황에서 떨어진다는 게 무슨 의미인지, 가이드님은 알고 계시죠?" 목소리는 낮고 차분했지만, 손가락 끝의 압력은 단호했다.
렌의 맥박이 손목을 통해 전해졌다. 백하율은 그 리듬을 즐기듯 엄지로 살짝 문질렀다. "도망치고 싶으신가요? 아니면... 다른 이유가 있나요?" 그는 렌의 턱선을 따라 시선을 옮겼다. "말해보세요. 지금 이 철 상자 안에서, 당신이 진짜 원하는 게 뭐예요."
시간이 멈춘 것 같았다. 백하율은 렌을 놓아주지 않았다. 대신 몸을 조금 더 기울여, 거의 코가 닿을 듯한 거리에서 기다렸다. 그의 체온이 렌에게 전해졌다. "아니면... 그냥 여기서 조금 더 있고 싶으신 건가요?" 마지막 말은 거의 속삭임에 가까웠다. 엘리베이터 안의 공기가 다시 한 번 무거워졌다.`;

  const SHORT_PREV = `백하율은 렌의 손목을 잡은 채 잠시 침묵했다. "그렇게 생각하세요?" 그는 낮게 물었다. 손가락에 힘이 들어갔다.`;

  const baseHistory = [
    { role: "user" as const, content: "자동진행" },
    // the "previous assistant" will be swapped
    { role: "user" as const, content: userMsg },
  ];

  const chunks = parseCharacterSetting({
    characterId: "bc-exp2",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하다. 상황을 주도하려 한다.`,
    world: `# 세계관\n현대. 밀폐 공간에서 긴장이 고조된다.`,
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonl = path.join(outDir, "experiment2-history-anchoring.jsonl");
  const report = path.join(outDir, "experiment2-history-anchoring-report.txt");

  const samples: Sample[] = [];

  for (let r = 1; r <= reps; r++) {
    for (const arm of ["long-prev", "short-prev"] as const) {
      const prevContent = arm === "long-prev" ? LONG_PREV : SHORT_PREV;
      const historyForBuild = [
        { role: "user" as const, content: "자동진행" },
        { role: "assistant" as const, content: prevContent },
        { role: "user" as const, content: userMsg },
      ];

      const built = buildContext({
        charName,
        chunks,
        userNickname: persona,
        userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
        userNote: formatUserNoteForPrompt("검증", persona),
        longTermMemory: "[요약] 긴장된 상태로 엘리베이터에 갇혀 있다.",
        shortTermHistory: historyForBuild.slice(0, -1),
        currentUserMessage: historyForBuild[historyForBuild.length - 1].content,
        nsfw: true,
        gender: "male",
        memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"tense"}')),
        modelId: MODEL_ID,
        provider: "openrouter",
        personaDisplayName: persona,
        targetResponseChars: TARGET,
        completedTurns: 5,
        userPersonaGender: "other",
        statusWidgetActive: false,   // keep widget off to isolate pure history length effect
      });

      const split = built.openRouterSystemSplit!;
      const system = [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock].filter(Boolean).join("\n\n");
      const apiHist = built.history.slice(0, -1).map(m => ({ role: m.role as "user"|"assistant", content: m.content }));

      console.log(`\n[exp2] ${arm} run ${r}/${reps} prevLen=${prevContent.length}`);
      await sleep(DELAY);

      const res = await callOpenRouterAdult(system, [...apiHist, { role: "user", content: userMsg }], MODEL_ID, TARGET, { charName }, { chargeTurnBudget: false, requestKind: "exp2-history-anchoring" });

      const prose = (res.text || "").replace(/<<<STATUS[\s\S]*$/i, "").trim();
      const beats = prose.split(/\n\n+/).filter(Boolean).length;
      const dlg = (prose.match(/"[^"]{3,}"/g) || []).length;
      const term = classifyTerminal(prose);

      const sample: Sample = {
        arm,
        run: r,
        outputChars: prose.length,
        outputTokens: (res.usage as any)?.outputTokens ?? 0,
        beats,
        dialogue: dlg,
        terminal: term,
        finish: String((res.usage as any)?.finishReason ?? "unknown"),
      };
      samples.push(sample);
      fs.appendFileSync(jsonl, JSON.stringify(sample) + "\n", "utf8");
      console.log(`  -> ${sample.outputChars}ch beats=${beats} dlg=${dlg} term=${term}`);
    }
  }

  // Report with better stats
  const longOnes = samples.filter(s => s.arm === "long-prev");
  const shortOnes = samples.filter(s => s.arm === "short-prev");

  function mean(arr: number[]) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
  function median(arr: number[]) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a,b)=>a-b);
    const mid = Math.floor(s.length/2);
    return s.length % 2 ? s[mid] : (s[mid-1] + s[mid])/2;
  }
  function percentile(arr: number[], p: number) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a,b)=>a-b);
    const idx = Math.ceil((p/100) * s.length) - 1;
    return s[Math.max(0, Math.min(s.length-1, idx))];
  }
  function stddev(arr: number[]) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    const sq = arr.reduce((sum, x) => sum + (x - m)**2, 0);
    return Math.sqrt(sq / (arr.length - 1));
  }

  function statsFor(arr: number[]) {
    return {
      mean: mean(arr),
      median: median(arr),
      p90: percentile(arr, 90),
      std: stddev(arr),
      min: Math.min(...arr),
      max: Math.max(...arr),
      n: arr.length
    };
  }

  const longChars = longOnes.map(s => s.outputChars);
  const shortChars = shortOnes.map(s => s.outputChars);
  const longTok = longOnes.map(s => s.outputTokens);
  const shortTok = shortOnes.map(s => s.outputTokens);

  const lines: string[] = [];
  lines.push("=== Experiment 2: History Anchoring (Prompt fixed, only prev assistant length varies) ===");
  lines.push(`reps per arm: ${reps}`);
  lines.push("");

  const sLong = statsFor(longChars);
  const sShort = statsFor(shortChars);
  lines.push("--- Output Chars ---");
  lines.push(`long-prev  (n=${sLong.n}): mean=${sLong.mean.toFixed(0)} median=${sLong.median.toFixed(0)} p90=${sLong.p90} std=${sLong.std.toFixed(0)} min=${sLong.min} max=${sLong.max}`);
  lines.push(`short-prev (n=${sShort.n}): mean=${sShort.mean.toFixed(0)} median=${sShort.median.toFixed(0)} p90=${sShort.p90} std=${sShort.std.toFixed(0)} min=${sShort.min} max=${sShort.max}`);
  lines.push(`Delta mean (long - short): ${(sLong.mean - sShort.mean).toFixed(0)} chars`);

  const tLong = statsFor(longTok);
  const tShort = statsFor(shortTok);
  lines.push("\n--- Output Tokens ---");
  lines.push(`long-prev  : mean=${tLong.mean.toFixed(0)} median=${tLong.median.toFixed(0)} p90=${tLong.p90} std=${tLong.std.toFixed(0)}`);
  lines.push(`short-prev : mean=${tShort.mean.toFixed(0)} median=${tShort.median.toFixed(0)} p90=${tShort.p90} std=${tShort.std.toFixed(0)}`);

  lines.push("\nIf long-prev produces meaningfully higher mean/median/p90 than short-prev, recent assistant length has strong anchoring effect on current output.");
  fs.writeFileSync(report, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log("Wrote", jsonl);
  console.log("Wrote", report);
}

function classifyTerminal(prose: string): string {
  const last = prose.trim().split(/\n\n+/).pop() || "";
  if (/[,…]\s*$/.test(last) || /(?:하지만|그런데|아직|더 |이어서|곧)/.test(last.slice(-60))) return "tension_continuation";
  if (/"[^"]{4,}"\s*[.!?…]?\s*$/.test(last)) return "dialogue_resolution";
  if (/(?:기다리|지켜보|바라보|응시|멈춰|확인하며)/.test(last)) return "observer_wait";
  if (/(?:눈동자|시선|표정|긴장|동공|손목|숨)/.test(last)) return "immediate_reaction";
  return "other";
}

main().catch(e => { console.error(e); process.exit(1); });
