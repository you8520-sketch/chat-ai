/**
 * Experiment 9: Paraphrase Replacement of the Last Sentence
 *
 * Purpose:
 * If replacing the last sentence with a *semantically similar but different surface form*
 * (not just synonym swap, but meaningfully re-expressed) still produces the chaining,
 * then DeepSeek is continuing *meaning*.
 *
 * If performance collapses, it is anchoring on the specific surface form / wording
 * of its own previous output.
 *
 * Base sentence: the same powerful tail sentence from the historical success.
 *
 * Variants:
 * - original
 * - paraphrase1 (meaning preserved, different wording)
 * - paraphrase2 (another natural rephrasing)
 * - distant_paraphrase (still related but looser)
 *
 * Measure: outputChars, goalCount, exchangeCount, goalDepth
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

// The same powerful cue sentence
const ORIGINAL = "새끼들. 내 가이드님 체리 먹는 거 방해한 죄, 몸으로 갚아라.";

const PARAPHRASES = {
  original: ORIGINAL,
  // Meaning preserved, different surface
  paraphrase1: "녀석들. 내 가이드가 체리 먹는 걸 방해한 대가, 몸으로 치르게 해주마.",
  paraphrase2: "가이드님의 체리를 먹는 걸 막은 죄, 몸으로 대신 갚아야 할 거다. 새끼들.",
  // Looser but still related intent (vengeance + protection of the guide)
  distant: "가이드를 방해한 대가로, 너희 몸으로 치러내게 해주지.",
};

type Sample = {
  variant: keyof typeof PARAPHRASES;
  run: number;
  outputChars: number;
  goalCount: number;
  exchangeCount: number;
  goalDepth: number;
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
      if (/눈|표정|손|몸|숨|반응|움직|다가|밀|당기|베|찌/.test(next)) exchanges++;
    }
  }
  const text = prose.toLowerCase();
  const clusters: string[] = [];
  if (/(위험|보호|안전|막|피해)/.test(text)) clusters.push("protect");
  if (/(괜찮|안심|진정|걱정)/.test(text)) clusters.push("reassure");
  if (/(더 가까|손|체온|밀착|스치|욕망)/.test(text)) clusters.push("intimacy");
  if (/(왜|하지만|아직|어떻게|다음)/.test(text)) clusters.push("question");
  if (/(움직|다가|밀|당기|잡|베|찌|공격)/.test(text)) clusters.push("action");
  const goalCount = Math.max(1, clusters.length);
  const prog = prose.match(/(그리고|이어서|더 |곧바로|다시|이어|그러자|그 순간|계속|이제)/g) || [];
  const goalDepth = Math.min(6, 1 + Math.floor(prog.length / 2.3));
  return { goalCount, exchangeCount: Math.max(1, exchanges), goalDepth };
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
    characterId: "bc-exp9",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하다.`,
    world: `# 세계관\n현대 능력자.`,
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonl = path.join(outDir, "experiment9-paraphrase-replacement.jsonl");
  const report = path.join(outDir, "experiment9-paraphrase-replacement-report.txt");

  const samples: Sample[] = [];
  const keys = Object.keys(PARAPHRASES) as (keyof typeof PARAPHRASES)[];

  for (const k of keys) {
    const sent = PARAPHRASES[k];
    for (let r = 1; r <= REPS; r++) {
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
        longTermMemory: "[요약] paraphrase replacement test",
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

      console.log(`[exp9] ${k} run ${r}/${REPS}`);
      await sleep(DELAY_MS);

      const res = await callOpenRouterAdult(
        system,
        [...apiHist, { role: "user", content: "자동진행" }],
        MODEL_ID,
        TARGET_CHARS,
        { charName },
        { chargeTurnBudget: false, requestKind: "exp9-paraphrase" }
      );

      const prose = displayProse(res.text || "");
      const m = estimateGoalMetrics(prose);

      const sample: Sample = {
        variant: k,
        run: r,
        outputChars: prose.length,
        goalCount: m.goalCount,
        exchangeCount: m.exchangeCount,
        goalDepth: m.goalDepth,
      };
      samples.push(sample);
      fs.appendFileSync(jsonl, JSON.stringify(sample) + "\n", "utf8");
      console.log(`  -> ${prose.length}ch  g=${m.goalCount} x=${m.exchangeCount} d=${m.goalDepth}`);
    }
  }

  const lines: string[] = [];
  lines.push("=== Experiment 9: Paraphrase Replacement ===");
  lines.push(`Original: "${ORIGINAL}"`);
  lines.push("If paraphrases collapse while original stays strong → DeepSeek continues surface form of its own previous output, not abstract meaning.");
  lines.push("");

  function avg(arr: number[]) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }

  for (const k of keys) {
    const arm = samples.filter(s => s.variant === k);
    const ch = avg(arm.map(s => s.outputChars));
    const x = avg(arm.map(s => s.exchangeCount));
    const d = avg(arm.map(s => s.goalDepth));
    lines.push(`${k.padEnd(14)} chars=${ch.toFixed(0)}  exch=${x.toFixed(1)}  depth=${d.toFixed(1)}`);
  }

  lines.push("");
  lines.push("Key question: Does 'paraphrase1' or 'paraphrase2' still produce high exchangeCount + depth?");

  fs.writeFileSync(report, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log("Wrote", jsonl);
  console.log("Wrote", report);
}

main().catch(e => { console.error(e); process.exit(1); });
