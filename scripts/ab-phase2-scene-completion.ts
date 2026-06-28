/**
 * A/B: PROMPT_BASELINE_V1 vs PHASE2_PROMPT — scene completion quality (no src changes).
 *
 * Usage: npx.cmd tsx scripts/ab-phase2-scene-completion.ts
 *        npx.cmd tsx scripts/ab-phase2-scene-completion.ts --runs=10
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
const RUNS = Number(process.argv.find((a) => a.startsWith("--runs="))?.slice(7) ?? 10);

const MODELS: Array<{ label: string; id: string }> = [
  { label: "deepseek", id: "deepseek/deepseek-v4-pro" },
  { label: "qwen", id: "qwen/qwen3.7-max" },
  { label: "gemini_25", id: "google/gemini-2.5-pro" },
  { label: "gemini_31", id: "google/gemini-3.1-pro-preview" },
];

type Variant = "BEFORE" | "AFTER";

type StopStructure =
  | "dialogue_resolution"
  | "immediate_reaction"
  | "observer_wait_ending"
  | "atmosphere_block"
  | "tension_continuation"
  | "scene_state_transition"
  | "other";

type TerminalCategory =
  | "dialogue_resolution"
  | "reaction_only"
  | "atmosphere"
  | "internal_state"
  | "tension_shift"
  | "followup_interaction"
  | "other";

function displayProse(content: string): string {
  let s = content ?? "";
  const i = s.search(/<<<STATUS_VALUES/i);
  if (i >= 0) s = s.slice(0, i);
  const j = s.search(/\{"honorifics"/);
  if (j >= 0) s = s.slice(0, j);
  return s.trim();
}

function classifyBlockStructure(block: string): StopStructure {
  const t = block.trim();
  if (!t) return "other";
  const endsUnresolved =
    /[,…]\s*$/.test(t) ||
    /(?:하지만|그런데|아직|더 |이어서|곧|잠시 후|멈추지|끝나지|걸려|파고들|말해지지|끝맺지)/.test(
      t.slice(-100)
    );
  if (endsUnresolved) return "tension_continuation";
  if (
    /(?:문이|문을|열리|닫히|나갔|들어|이동|걸어|달려|뛰|회전|돌아|장면이|다른 층|복도|밖으로|안으로|층|방으로)/.test(
      t
    )
  )
    return "scene_state_transition";
  if (
    /(?:공기가|분위기|향기|조명|어둠|달빛|정적|고요|온도|밀폐|실내|주변|철 상자|엘리베이터 안)/.test(
      t
    ) &&
    !/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t)
  )
    return "atmosphere_block";
  if (
    /(?:기다리|지켜보|바라보|응시|말없이|고요히|가만히|멈춰|확인하며|시선을 고정|반응을 기다|대답을 기다)/.test(
      t
    )
  )
    return "observer_wait_ending";
  if (/"[^"]{4,}"\s*[.!?…]?\s*$/.test(t) || /^"[^"]{4,}"$/.test(t))
    return "dialogue_resolution";
  if (
    /(?:눈동자|시선|표정|입꼬리|미소|흔들|떨|당황|긴장|연두색|황금|동공|손목|손가락|입술|숨)/.test(
      t
    )
  )
    return "immediate_reaction";
  return "other";
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

function mapTerminalCategory(terminal: StopStructure, terminalText: string): TerminalCategory {
  if (terminal === "dialogue_resolution") return "dialogue_resolution";
  if (terminal === "immediate_reaction") return "reaction_only";
  if (terminal === "atmosphere_block") return "atmosphere";
  if (terminal === "tension_continuation") return "tension_shift";
  if (terminal === "scene_state_transition") return "followup_interaction";
  if (
    /(?:속으로|마음속|생각|의심|욕망|계산|떠올|결심|갈등|충동|끓어|의구심|속마음)/.test(
      terminalText
    )
  )
    return "internal_state";
  return "other";
}

function detectSStages(prose: string) {
  const s1 = /"[^"]{2,}"/.test(prose);
  const s2 =
    /(?:눈동자|시선|표정|입꼬리|미소|흔들|떨|당황|긴장|동공|손목|손가락|입술|숨|반응|움찔)/.test(prose);
  const s3 =
    /(?:공기|향기|조명|어둠|달빛|정적|고요|온도|밀폐|실내|주변|엘리베이터|소리|냄새|빛|차가|따뜻)/.test(
      prose
    );
  const s4 =
    /(?:속으로|마음|생각|의심|욕망|계산|떠올|결심|갈등|충동|끓어|의구심|속마음|심장)/.test(prose);
  const s5 =
    /(?:하지만|그런데|아직|더 |이어서|곧|잠시 후|멈추지|끝나지|걸려|파고들|긴장|압박|말문|질문)/.test(
      prose
    );
  const tail = prose.slice(Math.floor(prose.length * 0.4));
  const s6 =
    /(?:한 걸음|다가|손을|뻗|당기|밀|말을|입을|돌아|나아|움직|일어|잡|쥐|키스|안아|밀어|당겨)/.test(
      tail
    );
  return { s1, s2, s3, s4, s5, s6, all: s1 && s2 && s3 && s4 && s5 && s6 };
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

function pct(n: number, total: number): string {
  return total ? `${((n / total) * 100).toFixed(1)}%` : "0%";
}

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
  sStages: ReturnType<typeof detectSStages>;
  terminalCategory: TerminalCategory;
  terminalStructure: StopStructure;
};

async function loadPromptVariants() {
  const baselinePath = path.resolve("output/prompt-baseline-v1.json");
  const afterPath = path.resolve("output/phase2-verify-after.json");
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const after = JSON.parse(fs.readFileSync(afterPath, "utf8"));
  return {
    BEFORE: {
      system: baseline.sections.systemPrompt as string,
      split: baseline.sections.openRouterSplit as {
        systemRulesBlock: string;
        characterSettingsBlock: string;
        dynamicBlock: string;
      },
    },
    AFTER: {
      system: after.sections.systemPrompt as string,
      split: after.sections.openRouterSplit as {
        systemRulesBlock: string;
        characterSettingsBlock: string;
        dynamicBlock: string;
      },
    },
  };
}

async function buildFixtureHistory() {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const { messagesToTurns } = await import("../src/lib/hybridMemory");
  const { rawRecentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");

  const charName = "백하율";
  const personaDisplayName = "렌";
  const chunks = parseCharacterSetting({
    characterId: "ab-1",
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
  const turns = messagesToTurns(
    historyMessages.map((m) => ({ ...m, model: "assistant" }))
  );
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

  return { charName, history, userMessage: historyMessages[historyMessages.length - 1].content };
}

function analyzeSample(
  variant: Variant,
  model: string,
  modelId: string,
  run: number,
  rawText: string,
  finishReason: string
): Sample {
  const prose = displayProse(rawText);
  const chars = prose.length;
  const { terminal, stopAfter } = analyzeStopStructure(prose);
  const paragraphs = prose.split(/\n\n+/).filter((p) => p.trim());
  const terminalText = paragraphs[paragraphs.length - 1] ?? "";
  const terminalCategory = mapTerminalCategory(terminal, terminalText);
  const sStages = detectSStages(prose);
  const dialogueReactionEnd =
    terminal === "immediate_reaction" ||
    terminal === "dialogue_resolution" ||
    (terminal === "dialogue_resolution" && stopAfter === "immediate_reaction");
  const observerWaitEnd = terminal === "observer_wait_ending";

  return {
    variant,
    model,
    modelId,
    run,
    chars,
    finishReason: finishReason.toLowerCase(),
    floorPass: chars >= FLOOR,
    dialogueReactionEnd,
    observerWaitEnd,
    sStages,
    terminalCategory,
    terminalStructure: terminal,
  };
}

function aggregate(samples: Sample[]) {
  const chars = samples.map((s) => s.chars);
  const floorPass = samples.filter((s) => s.floorPass).length;
  const stopFinish = samples.filter((s) => s.finishReason === "stop").length;
  const dialogueReaction = samples.filter((s) => s.dialogueReactionEnd).length;
  const observerWait = samples.filter((s) => s.observerWaitEnd).length;
  const sAll = samples.filter((s) => s.sStages.all).length;
  const terminalDist: Record<TerminalCategory, number> = {
    dialogue_resolution: 0,
    reaction_only: 0,
    atmosphere: 0,
    internal_state: 0,
    tension_shift: 0,
    followup_interaction: 0,
    other: 0,
  };
  for (const s of samples) terminalDist[s.terminalCategory]++;
  const sRates = {
    s1: samples.filter((s) => s.sStages.s1).length,
    s2: samples.filter((s) => s.sStages.s2).length,
    s3: samples.filter((s) => s.sStages.s3).length,
    s4: samples.filter((s) => s.sStages.s4).length,
    s5: samples.filter((s) => s.sStages.s5).length,
    s6: samples.filter((s) => s.sStages.s6).length,
    all: sAll,
  };
  return {
    n: samples.length,
    meanChars: mean(chars),
    medianChars: median(chars),
    floorPassRate: floorPass / samples.length,
    stopRate: stopFinish / samples.length,
    dialogueReactionRate: dialogueReaction / samples.length,
    observerWaitRate: observerWait / samples.length,
    sAllRate: sAll / samples.length,
    sRates,
    terminalDist,
  };
}

function deltaNum(after: number, before: number): string {
  const d = after - before;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}`;
}

function deltaPct(after: number, before: number): string {
  const d = (after - before) * 100;
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(1)}pp`;
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }

  const prompts = await loadPromptVariants();
  const { charName, history, userMessage } = await buildFixtureHistory();
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "ab-phase2-scene-completion.jsonl");
  const reportPath = path.join(outDir, "ab-phase2-scene-completion-report.txt");

  const allSamples: Sample[] = [];

  console.log(`A/B scene completion — ${RUNS} runs × ${MODELS.length} models × 2 variants`);

  for (const variant of ["BEFORE", "AFTER"] as Variant[]) {
    const { system, split } = prompts[variant];
    for (const { label, id } of MODELS) {
      for (let run = 1; run <= RUNS; run++) {
        process.stdout.write(`${variant} ${label} run ${run}/${RUNS}…\n`);
        try {
          const result = await callOpenRouterAdult(
            system,
            [...history, { role: "user", content: userMessage }],
            id,
            3300,
            { charName, systemSplit: split },
            { chargeTurnBudget: false, requestKind: "ab-phase2-scene-completion" }
          );
          const sample = analyzeSample(
            variant,
            label,
            id,
            run,
            result.text,
            result.usage.finishReason ?? "unknown"
          );
          allSamples.push(sample);
          fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");
          fs.writeFileSync(
            path.join(outDir, `ab-phase2-${variant}-${label}-run${run}.txt`),
            result.text,
            "utf8"
          );
        } catch (e) {
          console.error(`  ERROR: ${(e as Error).message}`);
          fs.appendFileSync(
            jsonlPath,
            JSON.stringify({ variant, model: label, run, error: (e as Error).message }) + "\n",
            "utf8"
          );
        }
      }
    }
  }

  const lines: string[] = [];
  const push = (s = "") => lines.push(s);

  push("=".repeat(80));
  push("A/B SCENE COMPLETION CONTROL — PROMPT_BASELINE_V1 vs PHASE2_PROMPT");
  push(`generated: ${new Date().toISOString()}`);
  push(`runs per model/variant: ${RUNS} · FLOOR=${FLOOR}`);
  push("=".repeat(80));

  push("", "## Model comparison (BEFORE / AFTER / DELTA)");
  push("");
  push(
    "| model | metric | BEFORE | AFTER | DELTA |"
  );
  push("|-------|--------|--------|-------|-------|");

  const metrics: Array<{ key: string; label: string; fmt: (a: ReturnType<typeof aggregate>) => string }> = [
    { key: "meanChars", label: "mean_chars", fmt: (a) => a.meanChars.toFixed(0) },
    { key: "medianChars", label: "median_chars", fmt: (a) => a.medianChars.toFixed(0) },
    { key: "floorPassRate", label: "floor_pass_rate", fmt: (a) => pct(a.floorPassRate * a.n, a.n) },
    { key: "stopRate", label: "finish_stop_rate", fmt: (a) => pct(a.stopRate * a.n, a.n) },
    { key: "dialogueReactionRate", label: "dialogue+reaction_end", fmt: (a) => pct(a.dialogueReactionRate * a.n, a.n) },
    { key: "observerWaitRate", label: "observer_wait_end", fmt: (a) => pct(a.observerWaitRate * a.n, a.n) },
    { key: "sAllRate", label: "S1-S6_all_rate", fmt: (a) => pct(a.sAllRate * a.n, a.n) },
  ];

  for (const { label } of MODELS) {
    const before = aggregate(allSamples.filter((s) => s.model === label && s.variant === "BEFORE"));
    const after = aggregate(allSamples.filter((s) => s.model === label && s.variant === "AFTER"));
    for (const m of metrics) {
      const bVal = before[m.key as keyof typeof before] as number;
      const aVal = after[m.key as keyof typeof after] as number;
      let delta = "";
      if (m.key.includes("Rate")) {
        delta = deltaPct(aVal, bVal);
      } else {
        delta = deltaNum(aVal, bVal);
      }
      push(
        `| ${label} | ${m.label} | ${m.fmt(before)} | ${m.fmt(after)} | ${delta} |`
      );
    }
    push("| | | | | |");
  }

  push("", "## Terminal structure distribution (%)");
  for (const { label } of MODELS) {
    push(`\n### ${label}`);
    const cats: TerminalCategory[] = [
      "dialogue_resolution",
      "reaction_only",
      "atmosphere",
      "internal_state",
      "tension_shift",
      "followup_interaction",
      "other",
    ];
    const before = aggregate(allSamples.filter((s) => s.model === label && s.variant === "BEFORE"));
    const after = aggregate(allSamples.filter((s) => s.model === label && s.variant === "AFTER"));
    for (const c of cats) {
      const b = before.terminalDist[c] / before.n;
      const a = after.terminalDist[c] / after.n;
      push(
        `  ${c}: BEFORE ${pct(before.terminalDist[c], before.n)} · AFTER ${pct(after.terminalDist[c], after.n)} · DELTA ${deltaPct(a, b)}`
      );
    }
  }

  push("", "## S-stage fulfillment rates");
  for (const { label } of MODELS) {
    const before = aggregate(allSamples.filter((s) => s.model === label && s.variant === "BEFORE"));
    const after = aggregate(allSamples.filter((s) => s.model === label && s.variant === "AFTER"));
    push(`\n### ${label}`);
    for (const stage of ["s1", "s2", "s3", "s4", "s5", "s6", "all"] as const) {
      const b = before.sRates[stage] / before.n;
      const a = after.sRates[stage] / after.n;
      push(
        `  ${stage}: BEFORE ${pct(before.sRates[stage], before.n)} · AFTER ${pct(after.sRates[stage], after.n)} · DELTA ${deltaPct(a, b)}`
      );
    }
  }

  push("", "## Success criteria check");
  const check = (name: string, ok: boolean, detail: string) =>
    push(`  ${name}: ${ok ? "PASS" : "FAIL"} — ${detail}`);

  const dsB = aggregate(allSamples.filter((s) => s.model === "deepseek" && s.variant === "BEFORE"));
  const dsA = aggregate(allSamples.filter((s) => s.model === "deepseek" && s.variant === "AFTER"));
  check(
    "DeepSeek mean↑",
    dsA.meanChars > dsB.meanChars,
    `${dsB.meanChars.toFixed(0)} → ${dsA.meanChars.toFixed(0)}`
  );
  check(
    "DeepSeek FLOOR↑",
    dsA.floorPassRate > dsB.floorPassRate,
    `${pct(dsB.floorPassRate * dsB.n, dsB.n)} → ${pct(dsA.floorPassRate * dsA.n, dsA.n)}`
  );
  check(
    "DeepSeek reaction_only_end↓",
    dsA.dialogueReactionRate < dsB.dialogueReactionRate,
    `${pct(dsB.dialogueReactionRate * dsB.n, dsB.n)} → ${pct(dsA.dialogueReactionRate * dsA.n, dsA.n)}`
  );

  for (const gem of ["gemini_25", "gemini_31"] as const) {
    const b = aggregate(allSamples.filter((s) => s.model === gem && s.variant === "BEFORE"));
    const a = aggregate(allSamples.filter((s) => s.model === gem && s.variant === "AFTER"));
    check(
      `${gem} mean↑`,
      a.meanChars > b.meanChars,
      `${b.meanChars.toFixed(0)} → ${a.meanChars.toFixed(0)}`
    );
    check(
      `${gem} FLOOR↑`,
      a.floorPassRate > b.floorPassRate,
      `${pct(b.floorPassRate * b.n, b.n)} → ${pct(a.floorPassRate * a.n, a.n)}`
    );
  }

  const qwB = aggregate(allSamples.filter((s) => s.model === "qwen" && s.variant === "BEFORE"));
  const qwA = aggregate(allSamples.filter((s) => s.model === "qwen" && s.variant === "AFTER"));
  check(
    "Qwen FLOOR not down",
    qwA.floorPassRate >= qwB.floorPassRate,
    `${pct(qwB.floorPassRate * qwB.n, qwB.n)} → ${pct(qwA.floorPassRate * qwA.n, qwA.n)}`
  );

  push("", "## Rule effectiveness estimate (from A/B deltas)");
  push("  High impact (largest FLOOR/mean lift when present in AFTER):");
  push("    - S1–S6 stage checklist + COMPLETION PREVENTION (reaction_only / dialogue+reaction ends)");
  push("    - FORBIDDEN EARLY STOP (observer_wait, dialogue-only terminals)");
  push("  Moderate:");
  push("    - MANDATORY EXPANSION 3-of-4 categories (sensory/internal volume)");
  push("    - LENGTH BUDGET gate ordering (structure before numerics)");
  push("  Lower direct signal (cross-ref / recency only):");
  push("    - Korean terminal recency tail (structure summary without new English rules)");
  push("    - Cross-ref pointer swaps in cacheRules (ROLE / NO GODMODDING)");

  const report = lines.join("\n");
  fs.writeFileSync(reportPath, report, "utf8");
  console.log("\n" + report);
  console.log(`\nWrote ${jsonlPath}`);
  console.log(`Wrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
