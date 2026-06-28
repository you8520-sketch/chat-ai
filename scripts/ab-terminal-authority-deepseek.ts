/**
 * Terminal Authority Ablation — DeepSeek V4 Pro only, max 40 API calls.
 * Usage: npx.cmd tsx scripts/ab-terminal-authority-deepseek.ts
 */
import fs from "fs";
import path from "path";
import Module from "module";
import { loadEnvLocal } from "./load-env-local";

const origLoad = Module._load;
// @ts-expect-error legacy hook
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  // @ts-expect-error legacy
  return origLoad(request, parent, isMain);
};

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const MODEL_ID = "deepseek/deepseek-v4-pro";
const FLOOR = 2200;
const RUNS = 10;
const ARMS = ["A", "B", "C", "D"] as const;
const MAX_CALLS = 40;
const DELAY_MS = 4000;
const MAX_ATTEMPTS = 5;
const TARGET_CHARS = 3300;

type Arm = typeof ARMS[number];
type Split = {
  systemRulesBlock: string;
  characterSettingsBlock: string;
  dynamicBlock: string;
};

type Sample = {
  arm: Arm;
  run: number;
  chars: number;
  floorPass: boolean;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function displayProse(c: string): string {
  let s = c ?? "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  return s.trim();
}

function mean(a: number[]) {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
}

function std(a: number[]) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

function cohensD(a: number[], b: number[]) {
  const pooled = Math.sqrt((std(a) ** 2 + std(b) ** 2) / 2);
  if (!pooled) return 0;
  return (mean(a) - mean(b)) / pooled;
}

function pct(n: number, t: number) {
  return t ? `${((n / t) * 100).toFixed(1)}%` : "0%";
}

function joinSplit(split: Split): string {
  return [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock]
    .filter(Boolean)
    .join("\n\n");
}

function stripBlocks(text: string, blocks: string[]): string {
  let out = text;
  for (const block of blocks) {
    const b = block.trim();
    if (!b) continue;
    if (out.includes(b)) out = out.replace(b, "");
    else {
      const idx = out.indexOf(b.slice(0, 80));
      if (idx >= 0) {
        const end = out.indexOf("\n\n", idx + b.length - 20);
        out = out.slice(0, idx) + (end > idx ? out.slice(end) : "");
      }
    }
  }
  return out.replace(/\n\n\n+/g, "\n\n").trim();
}

async function buildPhase2Fixture() {
  const { messagesToTurns, rawRecentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const {
    buildSceneCompletionControlInstruction,
    buildTerminalSceneTailBlock,
    buildSceneCompletionControlBlock,
    buildLengthBudgetBlock,
  } = await import("../src/lib/sceneCompletionControl");

  const charName = "백하율";
  const persona = "렌";
  const historyMessages = [
    { role: "user" as const, content: "자동진행" },
    {
      role: "assistant" as const,
      content:
        "백하율은 렌의 손목을 잡은 채 엘리베이터 벽에 등을 댔다. 좁은 공간 안 온도가 뒤섞였다.",
    },
    { role: "user" as const, content: "정말 고장났나봐.... 나랑 떨어져야되는거아니야??" },
  ];
  const turns = messagesToTurns(historyMessages.map((m) => ({ ...m, model: "assistant" })));
  const historyRaw = rawRecentTurnsToHistory(
    turns,
    0,
    resolveRawRecentTurnWindowForHistory(MODEL_ID, "openrouter", turns.length)
  );
  const chunks = parseCharacterSetting({
    characterId: "ta-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: hi\n${charName}: …`,
    statusWindowPrompt: "",
  });
  const built = buildContext({
    charName,
    chunks,
    userNickname: persona,
    userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNote: formatUserNoteForPrompt("검증", persona),
    longTermMemory: "[요약] 엘리베이터에서 긴장된 분위기가 이어졌다.",
    shortTermHistory: historyRaw,
    currentUserMessage: historyMessages[2].content,
    nsfw: true,
    gender: "male",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"acquaintance"}')),
    modelId: MODEL_ID,
    provider: "openrouter",
    personaDisplayName: persona,
    targetResponseChars: TARGET_CHARS,
    completedTurns: 9,
    userPersonaGender: "other",
    statusWidgetActive: false,
  });

  const baseSplit = built.openRouterSystemSplit!;
  const sccInstruction = buildSceneCompletionControlInstruction(TARGET_CHARS);
  const terminalTail = buildTerminalSceneTailBlock();
  const checklistOnly = buildSceneCompletionControlBlock();
  const lengthOnly = buildLengthBudgetBlock(TARGET_CHARS);

  const history = built.history
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  function armSplit(arm: Arm): Split {
    if (arm === "A") {
      return {
        systemRulesBlock: baseSplit.systemRulesBlock,
        characterSettingsBlock: baseSplit.characterSettingsBlock,
        dynamicBlock: baseSplit.dynamicBlock,
      };
    }
    const stripped = stripBlocks(baseSplit.dynamicBlock, [sccInstruction, terminalTail]);
    const terminal =
      arm === "B"
        ? lengthOnly
        : arm === "C"
          ? checklistOnly
          : `${checklistOnly}\n\n${lengthOnly}`;
    return {
      systemRulesBlock: baseSplit.systemRulesBlock,
      characterSettingsBlock: baseSplit.characterSettingsBlock,
      dynamicBlock: `${stripped}\n\n${terminal}`,
    };
  }

  return {
    charName,
    history,
    userMessage: historyMessages[2].content,
    armSplit,
  };
}

function loadDone(jsonlPath: string): Set<string> {
  if (!fs.existsSync(jsonlPath)) return new Set();
  const done = new Set<string>();
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    const j = JSON.parse(line) as Sample & { error?: string };
    if (typeof j.chars === "number") done.add(`${j.arm}|${j.run}`);
  }
  return done;
}

function loadSamples(jsonlPath: string): Sample[] {
  const byKey = new Map<string, Sample>();
  if (!fs.existsSync(jsonlPath)) return [];
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    const s = JSON.parse(line) as Sample;
    if (typeof s.chars !== "number") continue;
    byKey.set(`${s.arm}|${s.run}`, s);
  }
  return [...byKey.values()];
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "terminal-authority-ablation.jsonl");
  const reportPath = path.join(outDir, "terminal-authority-ablation-report.txt");

  const done = loadDone(jsonlPath);
  const { charName, history, userMessage, armSplit } = await buildPhase2Fixture();
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  let apiCalls = 0;
  for (const arm of ARMS) {
    const split = armSplit(arm);
    const system = joinSplit(split);
    console.log(`\n=== Arm ${arm} systemChars=${system.length} ===`);
    for (let run = 1; run <= RUNS; run++) {
      const key = `${arm}|${run}`;
      if (done.has(key)) {
        console.log(`Arm ${arm} run ${run}/${RUNS} skip (done)`);
        continue;
      }
      if (apiCalls >= MAX_CALLS) {
        console.error(`MAX_CALLS ${MAX_CALLS} reached — stopping`);
        process.exit(3);
      }
      process.stdout.write(`Arm ${arm} run ${run}/${RUNS}\n`);
      let ok = false;
      for (let att = 1; att <= MAX_ATTEMPTS; att++) {
        await sleep(DELAY_MS);
        apiCalls++;
        try {
          const result = await callOpenRouterAdult(
            system,
            [...history, { role: "user", content: userMessage }],
            MODEL_ID,
            TARGET_CHARS,
            { charName, systemSplit: split },
            { chargeTurnBudget: false, requestKind: "terminal-authority-ablation" }
          );
          const chars = displayProse(result.text).length;
          const sample: Sample = { arm, run, chars, floorPass: chars >= FLOOR };
          fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");
          done.add(key);
          console.log(`  ok ${chars}ch floor=${sample.floorPass}`);
          ok = true;
          break;
        } catch (e) {
          console.log(`  err att${att}: ${(e as Error).message.slice(0, 100)}`);
          await sleep(DELAY_MS * att);
        }
      }
      if (!ok) {
        fs.appendFileSync(jsonlPath, JSON.stringify({ arm, run, error: "failed" }) + "\n", "utf8");
      }
    }
  }

  const samples = loadSamples(jsonlPath);
  const lines: string[] = [
    "TERMINAL AUTHORITY ABLATION — DeepSeek V4 Pro",
    `generated: ${new Date().toISOString()}`,
    `model: ${MODEL_ID} · FLOOR=${FLOOR} · runs=${RUNS} per arm · apiCalls=${apiCalls}`,
    "",
    "Arms:",
    "  A = Phase2 baseline (SCC+LENGTH mid + Korean terminal + TURN_HANDOFF)",
    "  B = terminal bottom LENGTH BUDGET only (mid SCC removed)",
    "  C = terminal bottom S1-S6 checklist only (mid SCC removed)",
    "  D = terminal bottom LENGTH BUDGET + checklist (mid SCC removed)",
    "",
  ];

  const ctrl = samples.filter((s) => s.arm === "A");
  const ctrlChars = ctrl.map((s) => s.chars);
  const ctrlFloor = ctrl.filter((s) => s.floorPass).length / (ctrl.length || 1);

  lines.push(`### Arm A (control)`);
  lines.push(`  mean=${mean(ctrlChars).toFixed(0)}ch  FLOOR=${pct(ctrl.filter((s) => s.floorPass).length, ctrl.length)}  n=${ctrl.length}`);

  for (const arm of ["B", "C", "D"] as const) {
    const sub = samples.filter((s) => s.arm === arm);
    const chars = sub.map((s) => s.chars);
    const floor = sub.filter((s) => s.floorPass).length / (sub.length || 1);
    const dLen = mean(chars) - mean(ctrlChars);
    const dFloor = (floor - ctrlFloor) * 100;
    const d = cohensD(chars, ctrlChars);
    lines.push(
      `### Arm ${arm}`,
      `  mean=${mean(chars).toFixed(0)}ch  FLOOR=${pct(sub.filter((s) => s.floorPass).length, sub.length)}  n=${sub.length}`,
      `  vs A: Δlen=${dLen >= 0 ? "+" : ""}${dLen.toFixed(0)}  Δfloor=${dFloor >= 0 ? "+" : ""}${dFloor.toFixed(1)}pp  Cohen's d=${d.toFixed(2)}`
    );
  }

  const report = lines.join("\n");
  fs.writeFileSync(reportPath, report, "utf8");
  console.log("\n" + report);
  console.log(`Wrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
