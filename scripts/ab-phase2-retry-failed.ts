/**
 * Retry failed A/B arms to reach 10 samples each, then regenerate full report from jsonl.
 *
 * Usage: npx.cmd tsx scripts/ab-phase2-retry-failed.ts
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
const TARGET_RUNS = 10;
const DELAY_MS = 5000;
const MAX_ATTEMPTS = 3;

const MODELS: Array<{ label: string; id: string }> = [
  { label: "deepseek", id: "deepseek/deepseek-v4-pro" },
  { label: "qwen", id: "qwen/qwen3.7-max" },
  { label: "gemini_25", id: "google/gemini-2.5-pro" },
  { label: "gemini_31", id: "google/gemini-3.1-pro-preview" },
];

type Variant = "BEFORE" | "AFTER";

type TerminalCategory =
  | "dialogue_resolution"
  | "reaction_only"
  | "atmosphere"
  | "internal_state"
  | "tension_shift"
  | "followup_interaction"
  | "other";

type Sample = {
  variant: Variant;
  model: string;
  modelId: string;
  run: number;
  chars: number;
  finishReason: string;
  floorPass: boolean;
  dialogueReactionEnd: boolean;
  observerWaitEnd: boolean;
  sStages: { s1: boolean; s2: boolean; s3: boolean; s4: boolean; s5: boolean; s6: boolean; all: boolean };
  terminalCategory: TerminalCategory;
  terminalStructure: string;
  batch?: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function displayProse(content: string): string {
  let s = content ?? "";
  const i = s.search(/<<<STATUS_VALUES/i);
  if (i >= 0) s = s.slice(0, i);
  const j = s.search(/\{"honorifics"/);
  if (j >= 0) s = s.slice(0, j);
  return s.trim();
}

type StopStructure =
  | "dialogue_resolution"
  | "immediate_reaction"
  | "observer_wait_ending"
  | "atmosphere_block"
  | "tension_continuation"
  | "scene_state_transition"
  | "other";

function classifyBlockStructure(block: string): StopStructure {
  const t = block.trim();
  if (!t) return "other";
  if (
    /[,…]\s*$/.test(t) ||
    /(?:하지만|그런데|아직|더 |이어서|곧|잠시 후|멈추지|끝나지|걸려|파고들)/.test(t.slice(-100))
  )
    return "tension_continuation";
  if (/(?:문이|문을|열리|닫히|나갔|들어|이동|걸어|복도|방으로)/.test(t)) return "scene_state_transition";
  if (
    /(?:공기가|분위기|향기|조명|어둠|달빛|정적|고요|온도|밀폐|실내|주변)/.test(t) &&
    !/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t)
  )
    return "atmosphere_block";
  if (/(?:기다리|지켜보|바라보|응시|말없이|확인하며|시선을 고정|반응을 기다)/.test(t))
    return "observer_wait_ending";
  if (/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t) || /^"[^"]{4,}"$/.test(t)) return "dialogue_resolution";
  if (/(?:눈동자|시선|표정|입꼬리|미소|흔들|떨|당황|긴장|동공|손목|손가락|입술|숨)/.test(t))
    return "immediate_reaction";
  return "other";
}

function mapTerminalCategory(terminal: StopStructure, terminalText: string): TerminalCategory {
  if (terminal === "dialogue_resolution") return "dialogue_resolution";
  if (terminal === "immediate_reaction") return "reaction_only";
  if (terminal === "atmosphere_block") return "atmosphere";
  if (terminal === "tension_continuation") return "tension_shift";
  if (terminal === "scene_state_transition") return "followup_interaction";
  if (/(?:속으로|마음속|생각|의심|욕망|계산|떠올|결심|갈등|충동|속마음)/.test(terminalText))
    return "internal_state";
  return "other";
}

function detectSStages(prose: string) {
  const s1 = /"[^"]{2,}"/.test(prose);
  const s2 = /(?:눈동자|시선|표정|입꼬리|미소|흔들|떨|당황|긴장|동공|손목|손가락|입술|숨|반응|움찔)/.test(prose);
  const s3 = /(?:공기|향기|조명|어둠|달빛|정적|고요|온도|밀폐|실내|주변|엘리베이터|소리|냄새|빛)/.test(prose);
  const s4 = /(?:속으로|마음|생각|의심|욕망|계산|떠올|결심|갈등|충동|속마음|심장)/.test(prose);
  const s5 = /(?:하지만|그런데|아직|더 |이어서|곧|잠시 후|멈추지|끝나지|걸려|파고들|긴장|압박)/.test(prose);
  const tail = prose.slice(Math.floor(prose.length * 0.4));
  const s6 = /(?:한 걸음|다가|손을|뻗|당기|밀|말을|입을|돌아|나아|움직|일어|잡|쥐|키스|안아)/.test(tail);
  return { s1, s2, s3, s4, s5, s6, all: s1 && s2 && s3 && s4 && s5 && s6 };
}

function analyzeSample(
  variant: Variant,
  model: string,
  modelId: string,
  run: number,
  rawText: string,
  finishReason: string,
  batch?: string
): Sample {
  const prose = displayProse(rawText);
  const { terminal } = analyzeStopStructure(prose);
  const paragraphs = prose.split(/\n\n+/).filter((p) => p.trim());
  const terminalText = paragraphs[paragraphs.length - 1] ?? "";
  const sStages = detectSStages(prose);
  return {
    variant,
    model,
    modelId,
    run,
    chars: prose.length,
    finishReason: finishReason.toLowerCase(),
    floorPass: prose.length >= FLOOR,
    dialogueReactionEnd:
      terminal === "immediate_reaction" || terminal === "dialogue_resolution",
    observerWaitEnd: terminal === "observer_wait_ending",
    sStages,
    terminalCategory: mapTerminalCategory(terminal, terminalText),
    terminalStructure: terminal,
    batch,
  };
}

function analyzeStopStructure(prose: string) {
  const paragraphs = prose
    .trim()
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const blocks = paragraphs.map(classifyBlockStructure);
  const terminal = blocks[blocks.length - 1] ?? "other";
  const stopAfter = blocks.length >= 2 ? blocks[blocks.length - 2] : terminal;
  return { blocks, terminal, stopAfter };
}

function pct(n: number, total: number): string {
  return total ? `${((n / total) * 100).toFixed(1)}%` : "0%";
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function aggregate(samples: Sample[]) {
  const chars = samples.map((s) => s.chars);
  const terminalDist: Record<TerminalCategory, number> = {
    dialogue_resolution: 0,
    reaction_only: 0,
    atmosphere: 0,
    internal_state: 0,
    tension_shift: 0,
    followup_interaction: 0,
    other: 0,
  };
  const sRates = { s1: 0, s2: 0, s3: 0, s4: 0, s5: 0, s6: 0, all: 0 };
  for (const s of samples) {
    terminalDist[s.terminalCategory]++;
    if (s.sStages.s1) sRates.s1++;
    if (s.sStages.s2) sRates.s2++;
    if (s.sStages.s3) sRates.s3++;
    if (s.sStages.s4) sRates.s4++;
    if (s.sStages.s5) sRates.s5++;
    if (s.sStages.s6) sRates.s6++;
    if (s.sStages.all) sRates.all++;
  }
  return {
    n: samples.length,
    meanChars: mean(chars),
    medianChars: median(chars),
    floorPassRate: samples.filter((s) => s.floorPass).length / samples.length,
    stopRate: samples.filter((s) => s.finishReason === "stop").length / samples.length,
    dialogueReactionRate: samples.filter((s) => s.dialogueReactionEnd).length / samples.length,
    observerWaitRate: samples.filter((s) => s.observerWaitEnd).length / samples.length,
    sAllRate: samples.filter((s) => s.sStages.all).length / samples.length,
    terminalDist,
    sRates,
  };
}

function deltaNum(after: number, before: number): string {
  const d = after - before;
  return `${d > 0 ? "+" : ""}${d.toFixed(1)}`;
}

function deltaPct(after: number, before: number): string {
  const d = (after - before) * 100;
  return `${d > 0 ? "+" : ""}${d.toFixed(1)}pp`;
}

async function loadPromptVariants() {
  const baseline = JSON.parse(
    fs.readFileSync(path.resolve("output/prompt-baseline-v1.json"), "utf8")
  );
  const after = JSON.parse(fs.readFileSync(path.resolve("output/phase2-verify-after.json"), "utf8"));
  return {
    BEFORE: {
      system: baseline.sections.systemPrompt as string,
      split: baseline.sections.openRouterSplit,
    },
    AFTER: {
      system: after.sections.systemPrompt as string,
      split: after.sections.openRouterSplit,
    },
  };
}

async function buildFixtureHistory() {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { messagesToTurns, rawRecentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");

  const charName = "백하율";
  const personaDisplayName = "렌";
  const chunks = parseCharacterSetting({
    characterId: "ab-retry",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.`,
    world: `# 세계관\n현대 도시 배경.`,
    exampleDialog: `유저: 오늘 밤에도 나가?\n${charName}: …필요하면요.`,
    statusWindowPrompt: "",
  });

  const historyMessages = [
    { role: "user" as const, content: "자동진행" },
    {
      role: "assistant" as const,
      content:
        "백하율은 렌의 손목을 잡은 채 엘리베이터 벽에 등을 댔다. 좁은 공간 안 온도가 뒤섞였다.",
    },
    {
      role: "user" as const,
      content: "정말 고장났나봐.... 나랑 떨어져야되는거아니야??",
    },
  ];
  const turns = messagesToTurns(historyMessages.map((m) => ({ ...m, model: "assistant" })));
  const historyRaw = rawRecentTurnsToHistory(
    turns,
    0,
    resolveRawRecentTurnWindowForHistory("deepseek/deepseek-v4-pro", "openrouter", turns.length)
  );

  const { buildContext } = await import("../src/services/contextBuilder");
  const built = buildContext({
    charName,
    chunks,
    userNickname: personaDisplayName,
    userPersona: formatSelectedPersonaForPrompt(personaDisplayName, "other", "20대 후반. 호기심 많고 직설적."),
    userNote: formatUserNoteForPrompt("검증용 유저 노트", personaDisplayName),
    longTermMemory: "[요약] 엘리베이터에서 긴장된 분위기가 이어졌다.",
    shortTermHistory: historyRaw,
    currentUserMessage: historyMessages[historyMessages.length - 1].content,
    nsfw: true,
    gender: "male",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"acquaintance"}')),
    modelId: "deepseek/deepseek-v4-pro",
    provider: "openrouter",
    personaDisplayName,
    targetResponseChars: 3300,
    completedTurns: 9,
    userPersonaGender: "other",
    statusWidgetActive: false,
  });

  const history = built.history
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  return {
    charName,
    history,
    userMessage: historyMessages[historyMessages.length - 1].content,
  };
}

function loadSamplesFromJsonl(jsonlPath: string): Sample[] {
  if (!fs.existsSync(jsonlPath)) return [];
  const lines = fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean);
  const samples: Sample[] = [];
  for (const line of lines) {
    const row = JSON.parse(line);
    if (row.error || row.chars === undefined) continue;
    if (!row.sStages) continue;
    samples.push(row as Sample);
  }
  return samples;
}

/** Keep last TARGET_RUNS per variant|model */
function capSamples(samples: Sample[]): Sample[] {
  const groups = new Map<string, Sample[]>();
  for (const s of samples) {
    const k = `${s.variant}|${s.model}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(s);
  }
  const out: Sample[] = [];
  for (const arr of groups.values()) {
    out.push(...arr.slice(-TARGET_RUNS));
  }
  return out;
}

function countByArm(samples: Sample[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const s of samples) {
    const k = `${s.variant}|${s.model}`;
    c[k] = (c[k] ?? 0) + 1;
  }
  return c;
}

function writeReport(samples: Sample[], reportPath: string) {
  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push("=".repeat(80));
  push("A/B SCENE COMPLETION — RETRY COMPLETE REPORT");
  push(`generated: ${new Date().toISOString()}`);
  push(`FLOOR=${FLOOR} · target ${TARGET_RUNS} runs per model/variant`);
  push(`total samples in report: ${samples.length}`);
  push("=".repeat(80));

  const arms = countByArm(samples);
  push("", "## Sample counts per arm");
  for (const { label } of MODELS) {
    push(`  ${label}: BEFORE ${arms[`BEFORE|${label}`] ?? 0} · AFTER ${arms[`AFTER|${label}`] ?? 0}`);
  }

  push("", "## Model comparison (BEFORE / AFTER / DELTA)");
  push("| model | metric | BEFORE | AFTER | DELTA |");
  push("|-------|--------|--------|-------|-------|");

  const metrics = [
    { key: "meanChars", label: "mean_chars", fmt: (a: ReturnType<typeof aggregate>) => a.meanChars.toFixed(0) },
    { key: "medianChars", label: "median_chars", fmt: (a: ReturnType<typeof aggregate>) => a.medianChars.toFixed(0) },
    { key: "floorPassRate", label: "floor_pass_rate", fmt: (a: ReturnType<typeof aggregate>) => pct(a.floorPassRate * a.n, a.n) },
    { key: "stopRate", label: "finish_stop_rate", fmt: (a: ReturnType<typeof aggregate>) => pct(a.stopRate * a.n, a.n) },
    { key: "dialogueReactionRate", label: "dialogue+reaction_end", fmt: (a: ReturnType<typeof aggregate>) => pct(a.dialogueReactionRate * a.n, a.n) },
    { key: "observerWaitRate", label: "observer_wait_end", fmt: (a: ReturnType<typeof aggregate>) => pct(a.observerWaitRate * a.n, a.n) },
    { key: "sAllRate", label: "S1-S6_all_rate", fmt: (a: ReturnType<typeof aggregate>) => pct(a.sAllRate * a.n, a.n) },
  ];

  for (const { label } of MODELS) {
    const before = aggregate(samples.filter((s) => s.model === label && s.variant === "BEFORE"));
    const after = aggregate(samples.filter((s) => s.model === label && s.variant === "AFTER"));
    if (before.n === 0 && after.n === 0) continue;
    for (const m of metrics) {
      const bVal = before[m.key as keyof typeof before] as number;
      const aVal = after[m.key as keyof typeof after] as number;
      const delta = m.key.includes("Rate") ? deltaPct(aVal, bVal) : deltaNum(aVal, bVal);
      push(`| ${label} | ${m.label} | ${before.n ? m.fmt(before) : "—"} | ${after.n ? m.fmt(after) : "—"} | ${before.n && after.n ? delta : "—"} |`);
    }
    push("| | | | | |");
  }

  push("", "## Success criteria");
  const check = (name: string, ok: boolean, detail: string) =>
    push(`  ${name}: ${ok ? "PASS" : "FAIL"} — ${detail}`);

  const dsB = aggregate(samples.filter((s) => s.model === "deepseek" && s.variant === "BEFORE"));
  const dsA = aggregate(samples.filter((s) => s.model === "deepseek" && s.variant === "AFTER"));
  if (dsB.n && dsA.n) {
    check("DeepSeek mean↑", dsA.meanChars > dsB.meanChars, `${dsB.meanChars.toFixed(0)} → ${dsA.meanChars.toFixed(0)}`);
    check("DeepSeek FLOOR↑", dsA.floorPassRate > dsB.floorPassRate, `${pct(dsB.floorPassRate * dsB.n, dsB.n)} → ${pct(dsA.floorPassRate * dsA.n, dsA.n)}`);
    check("DeepSeek dre↓", dsA.dialogueReactionRate < dsB.dialogueReactionRate, `${pct(dsB.dialogueReactionRate * dsB.n, dsB.n)} → ${pct(dsA.dialogueReactionRate * dsA.n, dsA.n)}`);
  } else push("  DeepSeek: insufficient paired data");

  for (const gem of ["gemini_25", "gemini_31"] as const) {
    const b = aggregate(samples.filter((s) => s.model === gem && s.variant === "BEFORE"));
    const a = aggregate(samples.filter((s) => s.model === gem && s.variant === "AFTER"));
    if (b.n && a.n) {
      check(`${gem} mean↑`, a.meanChars > b.meanChars, `${b.meanChars.toFixed(0)} → ${a.meanChars.toFixed(0)}`);
      check(`${gem} FLOOR↑`, a.floorPassRate > b.floorPassRate, `${pct(b.floorPassRate * b.n, b.n)} → ${pct(a.floorPassRate * a.n, a.n)}`);
    } else push(`  ${gem}: insufficient paired data (B=${b.n} A=${a.n})`);
  }

  const qwB = aggregate(samples.filter((s) => s.model === "qwen" && s.variant === "BEFORE"));
  const qwA = aggregate(samples.filter((s) => s.model === "qwen" && s.variant === "AFTER"));
  if (qwB.n && qwA.n) {
    check("Qwen FLOOR not down", qwA.floorPassRate >= qwB.floorPassRate, `${pct(qwB.floorPassRate * qwB.n, qwB.n)} → ${pct(qwA.floorPassRate * qwA.n, qwA.n)}`);
  }

  const report = lines.join("\n");
  fs.writeFileSync(reportPath, report, "utf8");
  console.log("\n" + report);
}

async function main() {
  const reportOnly = process.argv.includes("--report-only");
  const outDir = path.resolve("output");
  const jsonlPath = path.join(outDir, "ab-phase2-scene-completion.jsonl");
  const reportPath = path.join(outDir, "ab-phase2-scene-completion-report-v2.txt");
  const batch = `retry-${Date.now()}`;

  if (!reportOnly) {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      console.error("OPENROUTER_API_KEY missing");
      process.exit(2);
    }

    const existing = loadSamplesFromJsonl(jsonlPath);
    const counts = countByArm(existing);
    const prompts = await loadPromptVariants();
    const { charName, history, userMessage } = await buildFixtureHistory();
    const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

    const jobs: Array<{ variant: Variant; label: string; id: string; need: number }> = [];
    for (const variant of ["BEFORE", "AFTER"] as Variant[]) {
      for (const { label, id } of MODELS) {
        const have = counts[`${variant}|${label}`] ?? 0;
        const need = TARGET_RUNS - have;
        if (need > 0) jobs.push({ variant, label, id, need });
      }
    }

    console.log(`Retry jobs: ${jobs.length} arms, ${jobs.reduce((s, j) => s + j.need, 0)} API calls`);

    let runSeq = 1000;
    for (const job of jobs) {
      const { system, split } = prompts[job.variant];
      for (let i = 0; i < job.need; i++) {
        runSeq++;
        process.stdout.write(`${job.variant} ${job.label} retry ${i + 1}/${job.need}…\n`);
        let lastErr = "";
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          await sleep(DELAY_MS);
          try {
            const result = await callOpenRouterAdult(
              system,
              [...history, { role: "user", content: userMessage }],
              job.id,
              3300,
              { charName, systemSplit: split },
              { chargeTurnBudget: false, requestKind: "ab-phase2-retry" }
            );
            const sample = analyzeSample(
              job.variant,
              job.label,
              job.id,
              runSeq,
              result.text,
              result.usage.finishReason ?? "unknown",
              batch
            );
            fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");
            fs.writeFileSync(
              path.join(outDir, `ab-phase2-${job.variant}-${job.label}-run${runSeq}.txt`),
              result.text,
              "utf8"
            );
            console.log(`  ok ${sample.chars}ch floor=${sample.floorPass}`);
            lastErr = "";
            break;
          } catch (e) {
            lastErr = (e as Error).message;
            console.log(`  attempt ${attempt} failed: ${lastErr}`);
            await sleep(DELAY_MS * attempt);
          }
        }
        if (lastErr) {
          fs.appendFileSync(
            jsonlPath,
            JSON.stringify({
              variant: job.variant,
              model: job.label,
              run: runSeq,
              error: lastErr,
              batch,
            }) + "\n",
            "utf8"
          );
        }
      }
    }
  }

  const all = capSamples(loadSamplesFromJsonl(jsonlPath));
  writeReport(all, reportPath);
  console.log(`Wrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
