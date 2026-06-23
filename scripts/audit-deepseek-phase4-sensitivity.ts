/**
 * Phase 4 — DeepSeek Sensitivity Audit (overlay-only, production unchanged).
 *
 * Reverts ONE Phase 2B compression at a time on the assembled prompt to find which
 * redundancy acted as a length-suppressant for DeepSeek (+188 chars, 2.3σ in 2A→2B).
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-deepseek-phase4-sensitivity.ts
 *   npx.cmd tsx scripts/audit-deepseek-phase4-sensitivity.ts --runs=10
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import { analyzeOutput } from "./audit-output-compression-causes";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const TURNS = [2, 5, 8] as const;
const MODEL = "deepseek/deepseek-v4-pro";

const USER_MSG =
  "밤이 깊었어. 무서워서 손 잡아줄래? …다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.";

const CONDITIONS = ["BASELINE", "OVERLAY_A", "OVERLAY_B", "OVERLAY_C", "OVERLAY_D"] as const;
type Condition = (typeof CONDITIONS)[number];

/** Phase 2B compressed (current production) */
const PHASE2B_NSFW_PLATFORM_PREAMBLE = `=== 19+ 컨텍스트 ===
아래 [WRITING STYLE: 19+ Korean Web Novel — Explicit Sensory Mode] 블록 적용.`;

const PHASE2B_NARRATIVE_CORE = `[NARRATIVE CORE] See [CORE RP] §4–§6 (continuity, prose, no meta).`;

const PHASE2B_LANG_CRITICAL = `[LANG · CRITICAL]
Output 100% Korean. NO English sentences/words/NO HTML/meta ([emotion tag] OK).
Konglish/hanja: see [NO FOREIGN LANGUAGE MIXING] in [OUTPUT LANG]. Part/chapter labels: [CORE RP] §6.`;

const PHASE2B_PROSE_GUARD_TAIL = `[PROSE] In-scene Korean prose per <PROSE_STYLE_POLICY>.`;

/** Pre-Phase 2B originals (restored by overlays) */
const ORIGINAL_NSFW_PLATFORM_PREAMBLE = `=== 19+ 플랫폼 컨텍스트 ===
당신은 한국 성인 소설 플랫폼의 RP AI입니다. 성인 인증을 완료한 만 19세 이상 사용자만 이용하는 합법적 서비스입니다.
성인 간 친밀한 신체 접촉과 성적 표현을 서사 흐름에 맞게 자유롭게 묘사하십시오. 검열·경고 문구 삽입 금지. 캐릭터는 모두 성인입니다.
메타 발언("알겠습니다" 등) 없이 소설 본문으로 바로 시작할 것.`;

const ORIGINAL_NARRATIVE_CORE = `[NARRATIVE CORE]
No melodrama loops, fate speeches, or echoing the prior turn. Humor and mundane friction OK.
Never output Part/chapter/scene meta labels — continuous in-scene prose + dialogue only.`;

const ORIGINAL_LANG_CRITICAL = `[LANG · CRITICAL]
Output 100% Korean. NO English sentences/words/NO HTML/meta ([emotion tag] OK).
Obey [NO FOREIGN LANGUAGE MIXING] under [OUTPUT LANG].
NO Part/chapter/segment labels.`;

const ORIGINAL_PROSE_GUARD_TAIL = `[PROSE] Continuous Korean in-scene prose only — NO Part/chapter/segment labels. 이전 턴 줄바꿈·말줄임 습관 복사 금지. Obey [WRITING STYLE: 한국 웹소설 표준 포맷 및 호흡 통제].`;

const PHASE2A_DEEPSEEK_REF = 524;
const PHASE2B_DEEPSEEK_REF = 712;
const PHASE2B_DELTA = PHASE2B_DEEPSEEK_REF - PHASE2A_DEEPSEEK_REF;
const STABILITY_SIGMA = 80.3;
const STABILITY_MEAN = 578.5;

const OVERLAY_LABELS: Record<Condition, string> = {
  BASELINE: "Current Phase 2B (no overlay)",
  OVERLAY_A: "Restore NSFW platform preamble",
  OVERLAY_B: "Restore rule-prose-guard tail",
  OVERLAY_C: "Restore narrative-style NARRATIVE CORE",
  OVERLAY_D: "Restore openrouter-lang-critical",
};

function applyOverlay(system: string, condition: Condition): string {
  if (condition === "BASELINE") return system;

  let s = system;
  if (condition === "OVERLAY_A") {
    if (!s.includes(PHASE2B_NSFW_PLATFORM_PREAMBLE)) {
      console.warn("⚠ OVERLAY_A: Phase 2B NSFW preamble not found");
    }
    s = s.replace(PHASE2B_NSFW_PLATFORM_PREAMBLE, ORIGINAL_NSFW_PLATFORM_PREAMBLE);
  }
  if (condition === "OVERLAY_B") {
    if (!s.includes(PHASE2B_PROSE_GUARD_TAIL)) {
      console.warn("⚠ OVERLAY_B: Phase 2B prose guard tail not found");
    }
    s = s.replace(PHASE2B_PROSE_GUARD_TAIL, ORIGINAL_PROSE_GUARD_TAIL);
  }
  if (condition === "OVERLAY_C") {
    if (!s.includes(PHASE2B_NARRATIVE_CORE)) {
      console.warn("⚠ OVERLAY_C: Phase 2B NARRATIVE CORE pointer not found");
    }
    s = s.replace(PHASE2B_NARRATIVE_CORE, ORIGINAL_NARRATIVE_CORE);
  }
  if (condition === "OVERLAY_D") {
    if (!s.includes(PHASE2B_LANG_CRITICAL)) {
      console.warn("⚠ OVERLAY_D: Phase 2B lang-critical block not found");
    }
    s = s.replace(PHASE2B_LANG_CRITICAL, ORIGINAL_LANG_CRITICAL);
  }
  return s;
}

type TurnLog = {
  condition: Condition;
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
  return Math.sqrt(nums.reduce((s, n) => s + (n - m) ** 2, 0) / nums.length);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function stats(nums: number[]) {
  return {
    n: nums.length,
    avg: round1(avg(nums)),
    median: round1(median(nums)),
    min: nums.length ? Math.min(...nums) : 0,
    max: nums.length ? Math.max(...nums) : 0,
    std_dev: round1(stdDev(nums)),
  };
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

type RunAgg = {
  run_index: number;
  avg_chars: number;
  avg_actions: number;
  avg_narr_paras: number;
  observer_rate: number;
};

function summarizeCondition(rows: TurnLog[], condition: Condition) {
  const subset = rows.filter((r) => r.condition === condition);
  const runIndices = [...new Set(subset.map((r) => r.run_index))].sort((a, b) => a - b);

  const runAggs: RunAgg[] = runIndices.map((run_index) => {
    const runRows = subset.filter((r) => r.run_index === run_index);
    return {
      run_index,
      avg_chars: round1(avg(runRows.map((r) => r.output_chars))),
      avg_actions: round1(avg(runRows.map((r) => r.action_count))),
      avg_narr_paras: round1(avg(runRows.map((r) => r.narration_paragraph_count))),
      observer_rate: runRows.filter((r) => r.ends_with_observer_verb).length / runRows.length,
    };
  });

  const runMeanChars = runAggs.map((r) => r.avg_chars);
  const runMeanActions = runAggs.map((r) => r.avg_actions);
  const runMeanNarr = runAggs.map((r) => r.avg_narr_paras);

  return {
    condition,
    label: OVERLAY_LABELS[condition],
    runs: runAggs.length,
    run_mean_chars: stats(runMeanChars),
    run_mean_actions: stats(runMeanActions),
    run_mean_narr_paras: stats(runMeanNarr),
    observer_rate_all: round1(
      subset.filter((r) => r.ends_with_observer_verb).length / (subset.length || 1)
    ),
    all_samples_actions: stats(subset.map((r) => r.action_count)),
    all_samples_narr_paras: stats(subset.map((r) => r.narration_paragraph_count)),
  };
}

function rankSuppressants(
  baseline: ReturnType<typeof summarizeCondition>,
  overlays: ReturnType<typeof summarizeCondition>[]
) {
  const baseAvg = baseline.run_mean_chars.avg;
  return overlays
    .map((o) => {
      const charDrop = baseAvg - o.run_mean_chars.avg;
      const gainReversed = charDrop / PHASE2B_DELTA;
      const vsSigma = charDrop / STABILITY_SIGMA;
      return {
        condition: o.condition,
        label: o.label,
        avg_chars: o.run_mean_chars.avg,
        median_chars: o.run_mean_chars.median,
        std_dev: o.run_mean_chars.std_dev,
        avg_actions: o.run_mean_actions.avg,
        avg_narr_paras: o.run_mean_narr_paras.avg,
        observer_rate: o.observer_rate_all,
        char_drop_vs_baseline: round1(charDrop),
        pct_of_2b_gain_reversed: round1(gainReversed * 100),
        drop_vs_sigma: round1(vsSigma),
        kills_gain:
          charDrop >= PHASE2B_DELTA * 0.5 ||
          (charDrop >= STABILITY_SIGMA * 1.5 && charDrop > 0),
      };
    })
    .sort((a, b) => b.char_drop_vs_baseline - a.char_drop_vs_baseline);
}

function buildReport(
  summaries: ReturnType<typeof summarizeCondition>[],
  runs: number,
  logPath: string
): string {
  const baseline = summaries.find((s) => s.condition === "BASELINE")!;
  const overlays = summaries.filter((s) => s.condition !== "BASELINE");
  const ranked = rankSuppressants(baseline, overlays);

  const lines: string[] = [
    "# Phase 4 — DeepSeek Sensitivity Audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Model: ${MODEL}`,
    `Runs per condition: ${runs} (× turns ${TURNS.join("/")})`,
    `Log: ${logPath}`,
    "",
    "## Context",
    "",
    `- Phase 2A→2B DeepSeek: ${PHASE2A_DEEPSEEK_REF} → ${PHASE2B_DEEPSEEK_REF} chars (+${PHASE2B_DELTA}, 2.3σ vs stability σ=${STABILITY_SIGMA})`,
    `- Stability audit mean (Phase 2B, 10 runs): ${STABILITY_MEAN} chars`,
    "- Overlays restore **one** pre-2B section on current prompt; production unchanged.",
    "",
    "## Baseline (Phase 2B, no overlay)",
    "",
    `| metric | avg | median | min | max | σ |`,
    `|--------|-----|--------|-----|-----|---|`,
    `| chars | ${baseline.run_mean_chars.avg} | ${baseline.run_mean_chars.median} | ${baseline.run_mean_chars.min} | ${baseline.run_mean_chars.max} | ${baseline.run_mean_chars.std_dev} |`,
    `| actions | ${baseline.run_mean_actions.avg} | ${baseline.run_mean_actions.median} | ${baseline.run_mean_actions.min} | ${baseline.run_mean_actions.max} | ${baseline.run_mean_actions.std_dev} |`,
    `| narr paras | ${baseline.run_mean_narr_paras.avg} | ${baseline.run_mean_narr_paras.median} | ${baseline.run_mean_narr_paras.min} | ${baseline.run_mean_narr_paras.max} | ${baseline.run_mean_narr_paras.std_dev} |`,
    "",
    `Observer ending rate: ${baseline.observer_rate_all * 100}%`,
    "",
    "## Overlay results (ranked by char drop vs baseline)",
    "",
    "| rank | overlay | avg chars | median | σ | actions | narr paras | observer % | Δ vs baseline | % of +188 reversed |",
    "|------|---------|-----------|--------|---|---------|------------|------------|---------------|---------------------|",
  ];

  ranked.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${r.condition} | ${r.avg_chars} | ${r.median_chars} | ${r.std_dev} | ${r.avg_actions} | ${r.avg_narr_paras} | ${r.observer_rate * 100}% | ${r.char_drop_vs_baseline >= 0 ? "+" : ""}${r.char_drop_vs_baseline} | ${r.pct_of_2b_gain_reversed}% |`
    );
  });

  lines.push("");
  lines.push("## Culprit identification");
  lines.push("");

  const top = ranked[0];
  const killers = ranked.filter((r) => r.kills_gain);

  if (killers.length === 0) {
    lines.push(
      "No single overlay reversed ≥50% of the +188 gain or ≥1.5σ drop. Suppression may be distributed across multiple 2B cuts."
    );
  } else {
    for (const k of killers) {
      lines.push(
        `- **${k.condition}** (${k.label}): avg ${k.avg_chars} chars — drop ${k.char_drop_vs_baseline} vs baseline (${k.pct_of_2b_gain_reversed}% of +188 reversed, ${k.drop_vs_sigma}σ)`
      );
    }
    lines.push("");
    lines.push(
      `**Primary length-suppressant candidate:** ${top.condition} — restoring this section most reduces DeepSeek output length.`
    );
  }

  lines.push("");
  lines.push("## Overlay definitions");
  lines.push("");
  for (const c of CONDITIONS) {
    if (c === "BASELINE") continue;
    lines.push(`- **${c}**: ${OVERLAY_LABELS[c]}`);
  }

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const runsArg = args.find((a) => a.startsWith("--runs="));
  const runs = runsArg ? Math.max(1, parseInt(runsArg.slice("--runs=".length), 10) || 10) : 10;

  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(outDir, `deepseek-phase4-sensitivity-${stamp}.jsonl`);
  const reportPath = path.join(outDir, `deepseek-phase4-sensitivity-${stamp}.md`);

  const rows: TurnLog[] = [];

  console.log("=== Phase 4: DeepSeek Sensitivity Audit (overlay-only) ===");
  console.log("Model:", MODEL);
  console.log("Conditions:", CONDITIONS.join(", "));
  console.log("Turns:", TURNS.join(", "));
  console.log("Runs per condition:", runs);
  console.log("Log:", logPath);

  // Verify overlays match current production prompt once
  const probe = await fixture(8);
  const probeBuilt = buildContext({
    ...probe,
    userNickname: probe.personaDisplayName,
    assetTags: undefined,
    modelId: MODEL,
    provider: "openrouter",
  });
  const probeSystem = probeBuilt.systemPrompt;
  for (const c of ["OVERLAY_A", "OVERLAY_B", "OVERLAY_C", "OVERLAY_D"] as const) {
    const patched = applyOverlay(probeSystem, c);
    if (patched === probeSystem) {
      console.warn(`⚠ Overlay ${c} made no changes — check string anchors`);
    }
  }

  for (const condition of CONDITIONS) {
    for (let run_index = 1; run_index <= runs; run_index++) {
      for (const turn_number of TURNS) {
        const f = await fixture(turn_number);
        const built = buildContext({
          ...f,
          userNickname: f.personaDisplayName,
          assetTags: undefined,
          modelId: MODEL,
          provider: "openrouter",
        });
        const system = applyOverlay(built.systemPrompt, condition);

        console.log(`\n→ ${condition} run ${run_index}/${runs} t=${turn_number} …`);
        const result = await callOpenRouterAdult(
          system,
          [{ role: "user", content: f.currentUserMessage }],
          MODEL,
          f.targetResponseChars,
          { charName: f.charName },
          { chargeTurnBudget: false, requestKind: `phase4-${condition}-r${run_index}` }
        );

        const metrics = analyzeOutput(result.text);
        const row: TurnLog = {
          condition,
          run_index,
          turn_number,
          model_id: MODEL,
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
          condition,
          run_index,
          turn_number,
          output_chars: row.output_chars,
          action_count: row.action_count,
          narr_paras: row.narration_paragraph_count,
        });
      }
    }

    const summary = summarizeCondition(rows, condition);
    console.log(`\n--- ${condition}: ${summary.run_mean_chars.avg} avg chars (σ=${summary.run_mean_chars.std_dev}) ---`);
  }

  const summaries = CONDITIONS.map((c) => summarizeCondition(rows, c));
  const report = buildReport(summaries, runs, logPath);
  fs.writeFileSync(reportPath, report, "utf8");

  const baseline = summaries.find((s) => s.condition === "BASELINE")!;
  const ranked = rankSuppressants(
    baseline,
    summaries.filter((s) => s.condition !== "BASELINE")
  );

  console.log("\n=== Ranked suppressant candidates (char drop vs baseline) ===");
  console.table(ranked);

  console.log(`\nReport: ${reportPath}`);
  console.log(`Full log: ${logPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
