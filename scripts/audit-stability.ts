/**
 * Stability Audit — measure run-to-run variance vs Phase 2 compression deltas.
 *
 * Runs the standard NSFW fixture (t=2/5/8, 백하율/렌) N times per model with the
 * current production prompt (no overlays). Compares sampling variance to observed
 * Phase 2A / Phase 2B length shifts.
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-stability.ts
 *   npx.cmd tsx scripts/audit-stability.ts --runs=10
 *   npx.cmd tsx scripts/audit-stability.ts --runs=3 --models=google/gemini-2.5-pro
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import { analyzeOutput } from "./audit-output-compression-causes";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const TURNS = [2, 5, 8] as const;
const DEFAULT_MODELS = [
  "google/gemini-2.5-pro",
  "qwen/qwen3.7-max",
  "deepseek/deepseek-v4-pro",
];

const USER_MSG =
  "밤이 깊었어. 무서워서 손 잡아줄래? …다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.";

/** Prior single-run audit logs (condition A, avg chars across t=2/5/8). */
const PHASE_REFERENCE = {
  pre_phase2: {
    label: "Pre-Phase-2 (post initial compression)",
    log: "compression-audit-2026-06-20T14-55-42.jsonl",
    chars: { "google/gemini-2.5-pro": 879, "qwen/qwen3.7-max": 1161, "deepseek/deepseek-v4-pro": 528 },
  },
  phase2a: {
    label: "Phase 2A",
    log: "compression-audit-2026-06-20T15-31-12.jsonl",
    chars: { "google/gemini-2.5-pro": 1072, "qwen/qwen3.7-max": 885, "deepseek/deepseek-v4-pro": 524 },
  },
  phase2b: {
    label: "Phase 2B (current)",
    log: "compression-audit-2026-06-20T15-37-23.jsonl",
    chars: { "google/gemini-2.5-pro": 1079, "qwen/qwen3.7-max": 775, "deepseek/deepseek-v4-pro": 712 },
  },
} as const;

type TurnLog = {
  run_index: number;
  turn_number: number;
  model_id: string;
  output_chars: number;
  action_count: number;
  dialogue_count: number;
  narration_paragraph_count: number;
  ends_with_observer_verb: boolean;
  ending_type: string;
  finish_reason: string | null;
  timestamp: string;
};

function avg(nums: number[]) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(nums: number[]) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdDev(nums: number[]) {
  if (nums.length < 2) return 0;
  const m = avg(nums);
  const variance = nums.reduce((s, n) => s + (n - m) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function loadAvgCharsFromLog(logFile: string, model: string): number | null {
  const full = path.join(process.cwd(), "output", logFile);
  if (!fs.existsSync(full)) return null;
  const lines = fs.readFileSync(full, "utf8").trim().split("\n").filter(Boolean);
  const chars: number[] = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line) as { condition?: string; model_id: string; output_chars: number };
      if (row.model_id !== model) continue;
      if (row.condition && row.condition !== "A") continue;
      chars.push(row.output_chars);
    } catch {
      /* skip */
    }
  }
  if (chars.length === 0) return null;
  return round1(avg(chars));
}

async function fixture(t: number) {
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");
  const charName = "백하율";
  const persona = "렌";
  const chunks = parseCharacterSetting({
    characterId: "mock-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분하고 관찰력이 뛰어나며.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: hi\n${charName}: …`,
    statusWindowPrompt: "",
  });
  return {
    charName,
    personaDisplayName: persona,
    chunks,
    userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNotePrompt: formatUserNoteForPrompt(""),
    longTermMemory: "",
    memoryMeta: formatMemoryMetaForPrompt(
      parseMemoryMeta(JSON.stringify({ affection: 40, trust: 35 }))
    ),
    shortTermHistory: [] as { role: "user" | "assistant"; content: string }[],
    currentUserMessage: USER_MSG,
    nsfw: true,
    gender: "male" as const,
    userPersonaGender: "other" as const,
    userImpersonation: false,
    novelModeEnabled: false,
    targetResponseChars: 2500,
    completedTurns: t,
    genres: ["공포/추리"] as import("../src/lib/characterGenres").CharacterGenre[],
  };
}

type MetricStats = {
  n: number;
  avg: number;
  median: number;
  min: number;
  max: number;
  std_dev: number;
};

function stats(nums: number[]): MetricStats {
  return {
    n: nums.length,
    avg: round1(avg(nums)),
    median: round1(median(nums)),
    min: nums.length ? Math.min(...nums) : 0,
    max: nums.length ? Math.max(...nums) : 0,
    std_dev: round1(stdDev(nums)),
  };
}

type RunAggregate = {
  run_index: number;
  avg_chars: number;
  avg_actions: number;
  avg_narr_paras: number;
  observer_rate: number;
};

function summarizeModel(rows: TurnLog[], model: string) {
  const subset = rows.filter((r) => r.model_id === model);
  const runIndices = [...new Set(subset.map((r) => r.run_index))].sort((a, b) => a - b);

  const runAggregates: RunAggregate[] = runIndices.map((run_index) => {
    const runRows = subset.filter((r) => r.run_index === run_index);
    return {
      run_index,
      avg_chars: round1(avg(runRows.map((r) => r.output_chars))),
      avg_actions: round1(avg(runRows.map((r) => r.action_count))),
      avg_narr_paras: round1(avg(runRows.map((r) => r.narration_paragraph_count))),
      observer_rate: runRows.filter((r) => r.ends_with_observer_verb).length / runRows.length,
    };
  });

  const allChars = subset.map((r) => r.output_chars);
  const allActions = subset.map((r) => r.action_count);
  const allNarr = subset.map((r) => r.narration_paragraph_count);

  const perTurn = TURNS.map((t) => {
    const turnRows = subset.filter((r) => r.turn_number === t);
    return {
      turn_number: t,
      chars: stats(turnRows.map((r) => r.output_chars)),
      actions: stats(turnRows.map((r) => r.action_count)),
      narr_paras: stats(turnRows.map((r) => r.narration_paragraph_count)),
      observer_rate: round1(
        turnRows.filter((r) => r.ends_with_observer_verb).length / (turnRows.length || 1)
      ),
    };
  });

  return {
    model_id: model,
    runs: runAggregates.length,
    /** Per-run mean across t=2/5/8 — matches prior audit reporting. */
    run_mean_chars: stats(runAggregates.map((r) => r.avg_chars)),
    run_mean_actions: stats(runAggregates.map((r) => r.avg_actions)),
    run_mean_narr_paras: stats(runAggregates.map((r) => r.avg_narr_paras)),
    observer_rate_all: round1(
      subset.filter((r) => r.ends_with_observer_verb).length / (subset.length || 1)
    ),
    observer_rate_per_run: stats(runAggregates.map((r) => r.observer_rate * 100)),
    all_samples_chars: stats(allChars),
    all_samples_actions: stats(allActions),
    all_samples_narr_paras: stats(allNarr),
    per_turn: perTurn,
    run_aggregates: runAggregates,
  };
}

function shortModel(model: string) {
  if (model.includes("gemini")) return "Gemini";
  if (model.includes("qwen")) return "Qwen";
  if (model.includes("deepseek")) return "DeepSeek";
  return model;
}

function buildReport(
  summaries: ReturnType<typeof summarizeModel>[],
  runs: number,
  logPath: string
): string {
  const lines: string[] = [
    "# Stability Audit Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Runs per model: ${runs} (× turns ${TURNS.join("/")} = ${runs * TURNS.length} samples/model)`,
    `Log: ${logPath}`,
    "",
    "## Question",
    "",
    "**Are the remaining length differences larger than normal sampling variance?**",
    "",
  ];

  for (const s of summaries) {
    const m = shortModel(s.model_id);
    lines.push(`## ${m} (${s.model_id})`);
    lines.push("");
    lines.push("### Run-mean chars (avg across t=2/5/8 per run)");
    lines.push("");
    lines.push(
      `| metric | avg | median | min | max | std dev |`,
      `|--------|-----|--------|-----|-----|---------|`,
      `| chars | ${s.run_mean_chars.avg} | ${s.run_mean_chars.median} | ${s.run_mean_chars.min} | ${s.run_mean_chars.max} | ${s.run_mean_chars.std_dev} |`,
      `| actions | ${s.run_mean_actions.avg} | ${s.run_mean_actions.median} | ${s.run_mean_actions.min} | ${s.run_mean_actions.max} | ${s.run_mean_actions.std_dev} |`,
      `| narr paras | ${s.run_mean_narr_paras.avg} | ${s.run_mean_narr_paras.median} | ${s.run_mean_narr_paras.min} | ${s.run_mean_narr_paras.max} | ${s.run_mean_narr_paras.std_dev} |`
    );
    lines.push("");
    lines.push(`Observer ending rate (all samples): ${s.observer_rate_all * 100}%`);
    lines.push("");
    lines.push("### Per-turn char spread (10 runs each)");
    lines.push("");
    lines.push("| turn | avg | median | min | max | std dev | observer % |");
    lines.push("|------|-----|--------|-----|-----|---------|------------|");
    for (const pt of s.per_turn) {
      lines.push(
        `| t=${pt.turn_number} | ${pt.chars.avg} | ${pt.chars.median} | ${pt.chars.min} | ${pt.chars.max} | ${pt.chars.std_dev} | ${pt.observer_rate * 100}% |`
      );
    }
    lines.push("");
  }

  lines.push("## Comparison vs Phase 2 compression deltas");
  lines.push("");
  lines.push(
    "Phase audits reported **one run** per model (mean chars across t=2/5/8). Stability audit compares those point deltas to **std dev of run-means** from repeated sampling."
  );
  lines.push("");
  lines.push("| Model | sampling σ (run-mean chars) | 2A→2B Δ | 2A→2B vs σ | pre-2→2B Δ | pre-2→2B vs σ | verdict |");
  lines.push("|-------|---------------------------|---------|------------|------------|---------------|---------|");

  for (const s of summaries) {
    const model = s.model_id;
    const sigma = s.run_mean_chars.std_dev;
    const ref2a = PHASE_REFERENCE.phase2a.chars[model as keyof typeof PHASE_REFERENCE.phase2a.chars];
    const ref2b = PHASE_REFERENCE.phase2b.chars[model as keyof typeof PHASE_REFERENCE.phase2b.chars];
    const refPre =
      PHASE_REFERENCE.pre_phase2.chars[model as keyof typeof PHASE_REFERENCE.pre_phase2.chars];
    const delta2a2b = ref2b - ref2a;
    const deltaPre2b = ref2b - refPre;
    const ratio2a = sigma > 0 ? round1(delta2a2b / sigma) : null;
    const ratioPre = sigma > 0 ? round1(deltaPre2b / sigma) : null;

    let verdict = "within noise";
    if (Math.abs(delta2a2b) > sigma * 1.5 || Math.abs(deltaPre2b) > sigma * 1.5) {
      verdict = "likely prompt-driven (Δ > 1.5σ)";
    } else if (Math.abs(delta2a2b) > sigma || Math.abs(deltaPre2b) > sigma) {
      verdict = "borderline (Δ > 1σ)";
    }

    lines.push(
      `| ${shortModel(model)} | ${sigma} | ${delta2a2b >= 0 ? "+" : ""}${delta2a2b} | ${ratio2a ?? "—"}σ | ${deltaPre2b >= 0 ? "+" : ""}${deltaPre2b} | ${ratioPre ?? "—"}σ | ${verdict} |`
    );
  }

  lines.push("");
  lines.push("## Reference baselines (single-run audits, condition A)");
  lines.push("");
  for (const [key, ref] of Object.entries(PHASE_REFERENCE)) {
    lines.push(`- **${ref.label}** (${ref.log}):`);
    for (const model of DEFAULT_MODELS) {
      const fromLog = loadAvgCharsFromLog(ref.log, model);
      const stored = ref.chars[model as keyof typeof ref.chars];
      lines.push(
        `  - ${shortModel(model)}: ${fromLog ?? stored} chars (stored ref ${stored})`
      );
    }
  }

  lines.push("");
  lines.push("## Interpretation notes");
  lines.push("");
  lines.push(
    "- σ on **run-means** (3 turns pooled) is the right comparator for Phase 2 point estimates."
  );
  lines.push(
    "- σ on **individual turns** is often larger — turn number itself drives length (t=2 vs t=8)."
  );
  lines.push(
    "- Observer rate is binary per sample; low counts make rate comparisons noisy."
  );
  lines.push(
    "- If |Phase Δ| ≤ 1σ, treat the compression shift as indistinguishable from resampling."
  );
  lines.push(
    "- If |Phase Δ| > 1.5σ, the prompt change likely moved the distribution, not just RNG."
  );

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const runsArg = args.find((a) => a.startsWith("--runs="));
  const runs = runsArg ? Math.max(1, parseInt(runsArg.slice("--runs=".length), 10) || 10) : 10;
  const modelsArg = args.find((a) => a.startsWith("--models="));
  const models = modelsArg
    ? modelsArg.slice("--models=".length).split(",").map((m) => m.trim()).filter(Boolean)
    : DEFAULT_MODELS;

  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(outDir, `stability-audit-${stamp}.jsonl`);
  const reportPath = path.join(outDir, `stability-audit-${stamp}.md`);

  const rows: TurnLog[] = [];

  console.log("=== Stability Audit (current Phase 2B prompt, no modifications) ===");
  console.log("Models:", models.join(", "));
  console.log("Turns:", TURNS.join(", "));
  console.log("Runs per model:", runs);
  console.log("Log:", logPath);

  for (const model_id of models) {
    for (let run_index = 1; run_index <= runs; run_index++) {
      for (const turn_number of TURNS) {
        const f = await fixture(turn_number);
        const built = buildContext({
          ...f,
          userNickname: f.personaDisplayName,
          assetTags: undefined,
          modelId: model_id,
          provider: "openrouter",
        });
        const system = built.systemPrompt;

        console.log(`\n→ run ${run_index}/${runs} t=${turn_number} ${model_id} …`);
        const result = await callOpenRouterAdult(
          system,
          [{ role: "user", content: f.currentUserMessage }],
          model_id,
          f.targetResponseChars,
          { charName: f.charName },
          { chargeTurnBudget: false, requestKind: `stability-audit-r${run_index}` }
        );

        const metrics = analyzeOutput(result.text);
        const row: TurnLog = {
          run_index,
          turn_number,
          model_id,
          output_chars: visibleAssistantDisplayCharCount(result.text),
          action_count: metrics.action_count,
          dialogue_count: metrics.dialogue_count,
          narration_paragraph_count: metrics.narration_paragraph_count,
          ends_with_observer_verb: metrics.ends_with_observer_verb,
          ending_type: metrics.ending_type,
          finish_reason: result.usage.finishReason ?? null,
          timestamp: new Date().toISOString(),
        };
        rows.push(row);
        fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
        console.log({
          run_index,
          turn_number,
          model_id,
          output_chars: row.output_chars,
          action_count: row.action_count,
          narration_paragraph_count: row.narration_paragraph_count,
          observer: row.ends_with_observer_verb,
          ending_type: row.ending_type,
        });
      }
    }

    const summary = summarizeModel(rows, model_id);
    console.log(`\n--- Summary: ${model_id} ---`);
    console.log({
      run_mean_chars: summary.run_mean_chars,
      observer_rate: summary.observer_rate_all,
      run_mean_actions: summary.run_mean_actions,
      run_mean_narr_paras: summary.run_mean_narr_paras,
    });
  }

  const summaries = models.map((m) => summarizeModel(rows, m));
  const report = buildReport(summaries, runs, logPath);
  fs.writeFileSync(reportPath, report, "utf8");

  console.log("\n=== Phase 2 delta vs sampling σ ===");
  for (const s of summaries) {
    const model = s.model_id;
    const sigma = s.run_mean_chars.std_dev;
    const ref2a = PHASE_REFERENCE.phase2a.chars[model as keyof typeof PHASE_REFERENCE.phase2a.chars];
    const ref2b = PHASE_REFERENCE.phase2b.chars[model as keyof typeof PHASE_REFERENCE.phase2b.chars];
    const refPre =
      PHASE_REFERENCE.pre_phase2.chars[model as keyof typeof PHASE_REFERENCE.pre_phase2.chars];
    console.log({
      model: shortModel(model),
      stability_mean_chars: s.run_mean_chars.avg,
      stability_sigma: sigma,
      phase2a_ref: ref2a,
      phase2b_ref: ref2b,
      "2A→2B_delta": ref2b - ref2a,
      "2A→2B_vs_sigma": sigma > 0 ? round1((ref2b - ref2a) / sigma) : null,
      pre2_ref: refPre,
      "pre2→2B_delta": ref2b - refPre,
      "pre2→2B_vs_sigma": sigma > 0 ? round1((ref2b - refPre) / sigma) : null,
    });
  }

  console.log(`\nReport: ${reportPath}`);
  console.log(`Full log: ${logPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
