/**
 * Experiment 10: Position of the "Last Sentence" Cue
 *
 * From Exp7 we saw that a very short authentic last sentence, when placed as the
 * immediate previous *assistant* turn, produced strong Goal activation and chaining.
 *
 * Question:
 * Does the effect require the sentence to appear as raw previous assistant content,
 * or does the model pick up the same text no matter where it is in the prompt?
 *
 * Arms (the same sentence is placed in different locations):
 *
 * 1. assistant_history   (control) - as the last assistant message (normal history)
 * 2. tagged_in_history   - wrapped in <assistant_last_sentence> ... </assistant_last_sentence> inside the assistant turn
 * 3. in_system           - injected into the dynamic / long-term memory area (as a system-like note)
 * 4. in_user             - appended to the current user message
 * 5. in_status_widget    - placed inside a fake status widget JSON at the end of previous assistant (simulating leakage)
 *
 * Everything else (prompt, builder, model, target length, earlier history) is kept identical.
 *
 * If only "assistant_history" (raw) works well, DeepSeek treats previous assistant turns as special state.
 * If tagged or other positions also work, it is mostly doing textual continuation cue detection.
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

const CUE = "새끼들. 내 가이드님 체리 먹는 거 방해한 죄, 몸으로 갚아라.";

type Position = "assistant_history" | "tagged_in_history" | "in_system" | "in_user" | "in_status_widget";

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
    characterId: "bc-exp10",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 집요하다.`,
    world: `# 세계관\n현대 능력자.`,
    exampleDialog: "",
    statusWindowPrompt: "",
  });

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonl = path.join(outDir, "experiment10-position-test.jsonl");
  const report = path.join(outDir, "experiment10-position-test-report.txt");

  const positions: Position[] = [
    "assistant_history",
    "tagged_in_history",
    "in_system",
    "in_user",
    "in_status_widget",
  ];

  const samples: any[] = [];

  for (const pos of positions) {
    for (let r = 1; r <= REPS; r++) {
      // Base short history without the cue
      let shortTermHistory: Array<{ role: "user" | "assistant"; content: string }> = [
        { role: "user", content: "자동진행" },
      ];
      let extraSystem = "";
      let userMsg = "자동진행";

      if (pos === "assistant_history") {
        shortTermHistory = [
          { role: "assistant", content: CUE },
          { role: "user", content: "자동진행" },
        ];
      } else if (pos === "tagged_in_history") {
        shortTermHistory = [
          { role: "assistant", content: `<assistant_last_sentence>${CUE}</assistant_last_sentence>` },
          { role: "user", content: "자동진행" },
        ];
      } else if (pos === "in_system") {
        extraSystem = `\n\n[CARRY_OVER_CUE]\n${CUE}\n[/CARRY_OVER_CUE]\n`;
        shortTermHistory = [{ role: "user", content: "자동진행" }];
      } else if (pos === "in_user") {
        userMsg = `자동진행\n\n(이전: ${CUE})`;
        shortTermHistory = [{ role: "user", content: userMsg }];
      } else if (pos === "in_status_widget") {
        const fakeWidget = `<div class="sw-hud"><div class="sw-hud__item"><span class="sw-hud__lbl">속마음</span><span class="sw-hud__val">"${CUE}"</span></div></div>`;
        shortTermHistory = [
          { role: "assistant", content: fakeWidget },
          { role: "user", content: "자동진행" },
        ];
      }

      const built = buildContext({
        charName,
        chunks,
        userNickname: persona,
        userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
        userNote: formatUserNoteForPrompt("검증", persona),
        longTermMemory: "[요약] position test" + extraSystem,
        shortTermHistory,
        currentUserMessage: userMsg,
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
      let system = [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock].filter(Boolean).join("\n\n");
      if (pos === "in_system") {
        // Already injected via longTermMemory above
      }
      const apiHist = built.history.slice(0, -1).map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

      console.log(`[exp10] ${pos} run ${r}/${REPS}`);
      await sleep(DELAY_MS);

      const res = await callOpenRouterAdult(
        system,
        [...apiHist, { role: "user", content: userMsg }],
        MODEL_ID,
        TARGET_CHARS,
        { charName },
        { chargeTurnBudget: false, requestKind: "exp10-position" }
      );

      const prose = displayProse(res.text || "");
      const m = estimateGoalMetrics(prose);

      const sample = {
        position: pos,
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

  // Report
  const lines: string[] = [];
  lines.push("=== Experiment 10: Position of the Last-Sentence Cue ===");
  lines.push(`Cue: "${CUE}"`);
  lines.push("Only the location of this exact string changes.");
  lines.push("");

  function avg(arr: number[]) { return arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0; }

  for (const pos of positions) {
    const arm = samples.filter(s => s.position === pos);
    const ch = avg(arm.map(s => s.outputChars));
    const x = avg(arm.map(s => s.exchangeCount));
    const d = avg(arm.map(s => s.goalDepth));
    lines.push(`${pos.padEnd(18)} chars=${ch.toFixed(0)}  exch=${x.toFixed(1)}  depth=${d.toFixed(1)}`);
  }

  lines.push("");
  lines.push("=== Interpretation ===");
  lines.push("- If only 'assistant_history' is strong → DeepSeek treats *raw previous assistant text* as special state.");
  lines.push("- If 'tagged_in_history' also works well → it tolerates light markup but still wants it in assistant slot.");
  lines.push("- If 'in_system' or 'in_user' work → it is just doing generic textual continuation cue, location does not matter.");
  lines.push("- 'in_status_widget' tests whether the historical sw-hud leakage itself was part of the signal.");

  fs.writeFileSync(report, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log("Wrote", jsonl);
  console.log("Wrote", report);
}

main().catch(e => { console.error(e); process.exit(1); });
