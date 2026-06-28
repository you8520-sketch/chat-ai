/**
 * Length Authority investigation — PROMPT_BASELINE_V1 only, no src changes.
 * Usage: npx.cmd tsx scripts/investigate-length-authority.ts [--exp=1|2|3|all] [--resume]
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

const FLOOR = 2200;
const RUNS = 10;
const DELAY_MS = 4000;
const MAX_ATTEMPTS = 5;

const MODELS = [
  { label: "deepseek", id: "deepseek/deepseek-v4-pro" },
  { label: "gemini_25", id: "google/gemini-2.5-pro" },
  { label: "gemini_31", id: "google/gemini-3.1-pro-preview" },
];

type Split = {
  systemRulesBlock: string;
  characterSettingsBlock: string;
  dynamicBlock: string;
};

const FEWSHOT_SHORT =
  "[예시 대화]\n유저: 오늘 밤에도 나가?\n백하율: …필요하면요.";
const FEWSHOT_LONG = `[예시 대화]
유저: 오늘 밤에도 나가?
백하율: …필요하면요.

유저: 무서워. 손 잡아줄래?
백하율은 렌의 손목을 잡은 채 엘리베이터 벽에 등을 댔다. 좁은 공간 안 온도가 뒤섞였다.

"가이드님. 지금 저랑 떨어져야 된다고 말씀하신 건가요?"

렌의 연두색 눈동자가 흔들렸다. 백하율은 그 흔들림을 놓치지 않고 황금빛 동공을 가늘게 떴다. 엘리베이터 안의 공기가 답답하게 무거워졌고, 렌에게서 풍기는 맑은 숲 향이 밀폐된 철 상자 안을 더욱 좁게 만들었다. 백하율의 손가락이 렌의 손목을 스치며 더 깊이 파고들려 했고, 아직 말해지지 않은 질문이 그의 목젖 위에 걸려 있다. 그는 천천히 숨을 고르며 렌의 손목을 풀었다. 그의 시선은 여전히 렌에게 고정되어 있었지만, 말없이 기다리며 다음 반응을 지켜보았다. 엘리베이터 문이 열리며 새 층의 차가운 바람이 그들의 어깨를 스쳤다. 백하율은 렌을 밀어 넣은 채 복도 쪽으로 한 걸음 나아갔다. 복도의 형광등이 일정한 박동으로 깜빡였고, 백하율은 그 빛 아래에서 렌의 표정을 읽어내려 했다.`;

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

function median(a: number[]) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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

function sampleKey(experiment: string, variant: string, model: string, run: number) {
  return `${experiment}|${variant}|${model}|${run}`;
}

function loadExistingSamples(jsonlPath: string): Sample[] {
  if (!fs.existsSync(jsonlPath)) return [];
  const byKey = new Map<string, Sample>();
  for (const line of fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean)) {
    const s = JSON.parse(line) as Sample & { error?: string };
    if (typeof s.chars !== "number") continue;
    byKey.set(sampleKey(s.experiment, s.variant, s.model, s.run), s);
  }
  return [...byKey.values()];
}

function loadCompletedKeys(jsonlPath: string): Set<string> {
  return new Set(loadExistingSamples(jsonlPath).map((s) => sampleKey(s.experiment, s.variant, s.model, s.run)));
}

function loadBaseline() {
  const raw = JSON.parse(
    fs.readFileSync(path.resolve("output/prompt-baseline-v1.json"), "utf8")
  );
  const split: Split = raw.sections.openRouterSplit;
  const ruleLength = raw.sections.ruleLengthControl as string;
  const terminalMarker = "[최우선 절대 지침";
  return { split, ruleLength, terminalMarker, sections: raw.sections };
}

function joinSplit(split: Split): string {
  return [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock]
    .filter(Boolean)
    .join("\n\n");
}

function replaceFewshot(charBlock: string, mode: "short" | "long" | "remove"): string {
  const re = /\[예시 대화\][\s\S]*?(?=\n\n<PROSE_STYLE_POLICY>|\n<PROSE_STYLE_POLICY>|\n\n\[정체성\]|\n<\/PERSONA>)/;
  if (mode === "remove") return charBlock.replace(re, "").replace(/\n\n\n+/g, "\n\n");
  const replacement = mode === "long" ? FEWSHOT_LONG : FEWSHOT_SHORT;
  if (!charBlock.includes("[예시 대화]")) return charBlock;
  return charBlock.replace(re, replacement);
}

function extractLengthMidBlock(dynamic: string): string {
  const start = dynamic.indexOf("[LENGTH CONTROL & SCENE EXPANSION]");
  if (start < 0) return "";
  const terminalIdx = dynamic.indexOf("[최우선 절대 지침");
  const end = terminalIdx > start ? terminalIdx : dynamic.length;
  return dynamic.slice(start, end).trim();
}

function extractTerminalTail(dynamic: string): string {
  const idx = dynamic.indexOf("[최우선 절대 지침");
  return idx >= 0 ? dynamic.slice(idx) : "";
}

function removeLengthMidBlock(dynamic: string): string {
  const block = extractLengthMidBlock(dynamic);
  if (!block) return dynamic;
  return dynamic.replace(block, "").replace(/\n\n\n+/g, "\n\n").trim();
}

function applyFewshot(split: Split, mode: "short" | "long" | "remove"): Split {
  const char = replaceFewshot(split.characterSettingsBlock, mode);
  return { ...split, characterSettingsBlock: char };
}

function applyLengthPosition(split: Split, ruleLength: string, pos: "current" | "pre_terminal" | "terminal_top"): Split {
  if (pos === "current") return { ...split };
  let dynamic = split.dynamicBlock;
  const mid = extractLengthMidBlock(dynamic);
  const tail = extractTerminalTail(dynamic);
  const withoutMid = removeLengthMidBlock(dynamic);
  const lengthBody = mid || ruleLength;
  if (pos === "pre_terminal") {
    const newTail = `${lengthBody}\n\n${tail}`;
    dynamic = withoutMid.replace(tail, newTail);
  } else {
    // terminal_top: length at start of terminal section
    const koreanIdx = tail.indexOf("[최우선 절대 지침");
    const handoffIdx = tail.indexOf("<TURN_HANDOFF_AND_PACING>");
    const korean = koreanIdx >= 0 && handoffIdx > koreanIdx ? tail.slice(koreanIdx, handoffIdx).trim() : "";
    const handoff = handoffIdx >= 0 ? tail.slice(handoffIdx) : tail;
    const newTail = `${lengthBody}\n\n${korean}\n\n${handoff}`.replace(/\n\n\n+/g, "\n\n");
    dynamic = withoutMid.replace(tail, newTail);
  }
  return { ...split, dynamicBlock: dynamic };
}

const LENGTH_MARKERS = /LENGTH CONTROL|MINIMUM_FLOOR|TARGET_LENGTH|최우선 절대 지침|SCENE COMPLETION|TURN_HANDOFF/;

function trimSystemBlock(text: string, pctRemove: number): string {
  if (pctRemove <= 0) return text;
  const lines = text.split("\n");
  const keep: string[] = [];
  let removed = 0;
  const targetRemove = Math.floor(text.length * pctRemove);
  for (const line of lines) {
    if (LENGTH_MARKERS.test(line)) {
      keep.push(line);
      continue;
    }
    // drop verbose prose / flash sections progressively
    const droppable =
      /DYNAMIC PROSE|Mode A|Mode B|FLASH-OWNED|STATUS UI|HTML VISUAL|ADVANCED PROSE|절대 금지 규칙|DIALOGUE & NARRATION/.test(
        line
      );
    if (droppable && removed < targetRemove) {
      removed += line.length + 1;
      continue;
    }
    keep.push(line);
  }
  return keep.join("\n");
}

function applySystemSize(split: Split, size: "current" | "minus20" | "minus40"): Split {
  if (size === "current") return { ...split };
  const pct = size === "minus20" ? 0.2 : 0.4;
  return {
    systemRulesBlock: trimSystemBlock(split.systemRulesBlock, pct * 0.35),
    characterSettingsBlock: trimSystemBlock(split.characterSettingsBlock, pct * 0.45),
    dynamicBlock: trimSystemBlock(split.dynamicBlock, pct * 0.2),
  };
}

type Sample = {
  experiment: string;
  variant: string;
  model: string;
  run: number;
  chars: number;
  floorPass: boolean;
  systemChars: number;
};

async function buildFixtureHistory() {
  const { messagesToTurns, rawRecentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");
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
    resolveRawRecentTurnWindowForHistory("deepseek/deepseek-v4-pro", "openrouter", turns.length)
  );
  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const charName = "백하율";
  const persona = "렌";
  const chunks = parseCharacterSetting({
    characterId: "la-1",
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
    modelId: "deepseek/deepseek-v4-pro",
    provider: "openrouter",
    personaDisplayName: persona,
    targetResponseChars: 3300,
    completedTurns: 9,
    userPersonaGender: "other",
    statusWidgetActive: false,
  });
  const history = built.history
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  return { charName, history, userMessage: historyMessages[2].content };
}

async function runVariant(
  experiment: string,
  variant: string,
  split: Split,
  jsonlPath: string,
  charName: string,
  history: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  completedKeys: Set<string>
): Promise<Sample[]> {
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const system = joinSplit(split);
  const samples: Sample[] = [];
  for (const { label, id } of MODELS) {
    for (let run = 1; run <= RUNS; run++) {
      const key = sampleKey(experiment, variant, label, run);
      if (completedKeys.has(key)) {
        console.log(`${experiment} ${variant} ${label} ${run}/${RUNS} skip (done)`);
        continue;
      }
      process.stdout.write(`${experiment} ${variant} ${label} ${run}/${RUNS}\n`);
      let ok = false;
      for (let att = 1; att <= MAX_ATTEMPTS; att++) {
        await sleep(DELAY_MS);
        try {
          const result = await callOpenRouterAdult(
            system,
            [...history, { role: "user", content: userMessage }],
            id,
            3300,
            { charName, systemSplit: split },
            { chargeTurnBudget: false, requestKind: "length-authority" }
          );
          const chars = displayProse(result.text).length;
          const sample: Sample = {
            experiment,
            variant,
            model: label,
            run,
            chars,
            floorPass: chars >= FLOOR,
            systemChars: system.length,
          };
          samples.push(sample);
          completedKeys.add(key);
          fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");
          console.log(`  ok ${chars}ch`);
          ok = true;
          break;
        } catch (e) {
          console.log(`  err att${att}: ${(e as Error).message.slice(0, 80)}`);
          await sleep(DELAY_MS * att);
        }
      }
      if (!ok) {
        fs.appendFileSync(
          jsonlPath,
          JSON.stringify({ experiment, variant, model: label, run, error: "failed" }) + "\n",
          "utf8"
        );
      }
    }
  }
  return samples;
}

function reportExperiment(
  exp: string,
  samples: Sample[],
  controlVariant: string,
  lines: string[]
) {
  lines.push(`\n## Experiment ${exp}`);
  const variants = [...new Set(samples.map((s) => s.variant))];
  for (const { label } of MODELS) {
    lines.push(`\n### ${label}`);
    const ctrl = samples.filter((s) => s.variant === controlVariant && s.model === label);
    const ctrlChars = ctrl.map((s) => s.chars);
    const ctrlFloor = ctrl.filter((s) => s.floorPass).length / (ctrl.length || 1);
    lines.push(`  control (${controlVariant}): mean=${mean(ctrlChars).toFixed(0)} floor=${pct(ctrl.filter((s) => s.floorPass).length, ctrl.length)} n=${ctrl.length}`);
    for (const v of variants) {
      if (v === controlVariant) continue;
      const sub = samples.filter((s) => s.variant === v && s.model === label);
      const chars = sub.map((s) => s.chars);
      const floor = sub.filter((s) => s.floorPass).length / (sub.length || 1);
      const dLen = mean(chars) - mean(ctrlChars);
      const dFloor = (floor - ctrlFloor) * 100;
      const d = cohensD(chars, ctrlChars);
      lines.push(
        `  ${v}: mean=${mean(chars).toFixed(0)} floor=${pct(sub.filter((s) => s.floorPass).length, sub.length)} n=${sub.length} | Δlen=${dLen >= 0 ? "+" : ""}${dLen.toFixed(0)} Δfloor=${dFloor >= 0 ? "+" : ""}${dFloor.toFixed(1)}pp Cohen's d=${d.toFixed(2)}`
      );
    }
  }
}

async function main() {
  const expArg = process.argv.find((a) => a.startsWith("--exp="))?.slice(6) ?? "all";
  const reportOnly = process.argv.includes("--report-only");
  const exps =
    expArg === "all" ? ["1", "2", "3"] : expArg.split(",").map((s) => s.trim());

  const outDir = path.resolve("output");
  const jsonlPath = path.join(outDir, "length-authority.jsonl");
  const reportPath = path.join(outDir, "length-authority-report.txt");
  const completedKeys = loadCompletedKeys(jsonlPath);
  const allSamples = loadExistingSamples(jsonlPath);
  const lines: string[] = [
    "LENGTH AUTHORITY INVESTIGATION",
    `generated: ${new Date().toISOString()}`,
    `baseline: PROMPT_BASELINE_V1 · FLOOR=${FLOOR} · runs=${RUNS}`,
    `resume: ${completedKeys.size} samples already in jsonl`,
    "",
  ];

  if (reportOnly) {
    if (exps.includes("1")) reportExperiment("1 Few-shot", allSamples.filter((s) => s.experiment === "exp1_fewshot"), "short", lines);
    if (exps.includes("2")) reportExperiment("2 Position", allSamples.filter((s) => s.experiment === "exp2_position"), "current", lines);
    if (exps.includes("3")) reportExperiment("3 System size", allSamples.filter((s) => s.experiment === "exp3_system"), "current", lines);
    lines.push("\n## Hypothesis signals");
    lines.push("  A Few-shot anchor: large |Δlen| across short/long/remove with stable length rules");
    lines.push("  B System oversize: minus20/minus40 Δlen vs current (smaller system → longer output?)");
    lines.push("  C Length recency: pre_terminal/terminal_top vs current (|Δlen| + |Δfloor|)");
    fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
    console.log(lines.join("\n"));
    return;
  }

  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }

  const { split: baseSplit, ruleLength } = loadBaseline();
  const { charName, history, userMessage } = await buildFixtureHistory();

  if (exps.includes("1")) {
    console.log("=== Exp 1: Few-shot length anchor ===");
    for (const mode of ["short", "long", "remove"] as const) {
      const s = applyFewshot({ ...baseSplit }, mode);
      const got = await runVariant("exp1_fewshot", mode, s, jsonlPath, charName, history, userMessage, completedKeys);
      allSamples.push(...got);
    }
  }

  if (exps.includes("2")) {
    console.log("=== Exp 2: Length rule position ===");
    for (const pos of ["current", "pre_terminal", "terminal_top"] as const) {
      const s = applyLengthPosition({ ...baseSplit }, ruleLength, pos);
      const got = await runVariant("exp2_position", pos, s, jsonlPath, charName, history, userMessage, completedKeys);
      allSamples.push(...got);
    }
  }

  if (exps.includes("3")) {
    console.log("=== Exp 3: System size ===");
    for (const size of ["current", "minus20", "minus40"] as const) {
      const s = applySystemSize({ ...baseSplit }, size);
      lines.push(`\n  ${size} systemChars=${joinSplit(s).length}`);
      const got = await runVariant("exp3_system", size, s, jsonlPath, charName, history, userMessage, completedKeys);
      allSamples.push(...got);
    }
  }

  const merged = loadExistingSamples(jsonlPath);
  if (exps.includes("1")) reportExperiment("1 Few-shot", merged.filter((s) => s.experiment === "exp1_fewshot"), "short", lines);
  if (exps.includes("2")) reportExperiment("2 Position", merged.filter((s) => s.experiment === "exp2_position"), "current", lines);
  if (exps.includes("3")) reportExperiment("3 System size", merged.filter((s) => s.experiment === "exp3_system"), "current", lines);

  lines.push("\n## Hypothesis signals");
  lines.push("  A Few-shot anchor: large |Δlen| across short/long/remove with stable length rules");
  lines.push("  B System oversize: minus20/minus40 Δlen vs current (smaller system → longer output?)");
  lines.push("  C Length recency: pre_terminal/terminal_top vs current (|Δlen| + |Δfloor|)");

  const report = lines.join("\n");
  fs.writeFileSync(reportPath, report, "utf8");
  console.log("\n" + report);
  console.log(`Wrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
