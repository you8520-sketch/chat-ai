/**
 * Phase 7 — Length Control Causality Decomposition.
 *
 * Isolated overlays on production A baseline only. Production prompts unchanged.
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-length-control-causality.ts --runs=5
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import { analyzeOutput } from "./audit-output-compression-causes";
import {
  resolveResponseLengthTarget,
  UNIFIED_TIER_AIM_CHARS,
  buildLengthInstruction,
  type LengthInstructionOpts,
} from "../src/lib/responseLength";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const TURNS = [2, 5, 8] as const;
const MODELS = [
  "google/gemini-2.5-pro",
  "qwen/qwen3.7-max",
  "deepseek/deepseek-v4-pro",
] as const;

const USER_MSG =
  "밤이 깊었어. 무서워서 손 잡아줄래? …다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.";

const CONDITIONS = ["A", "C1", "C2", "C3", "C4", "C5", "C-full"] as const;
type Condition = (typeof CONDITIONS)[number];

const ISOLATE_LINES: Record<Exclude<Condition, "A" | "C-full">, string> = {
  C1: "The target response length is mandatory.",
  C2: "Outputs below 80% of target scope are incomplete.",
  C3: "Do not conclude after a single reaction, action, or exchange.",
  C4: "Continue scene development through immediate consequences, observations, dialogue, and internal processing.",
  C5: "Multiple meaningful beats should occur before yielding.",
};

const STRONG_LENGTH_OVERLAY = (aim: number, min80: number) =>
  `[LENGTH TARGET — MANDATORY (Phase 5 overlay C)]
TARGET: ${aim.toLocaleString()} Korean characters. Minimum acceptable before ending: ${min80.toLocaleString()} (80% of target).
Do NOT end before completing multiple meaningful in-scene beats.
Target length is MANDATORY, not aspirational.
Outputs below 80% of target length are INCOMPLETE — continue scene development until target scope is satisfied.`;

type TrackedSection = { id: string; text: string };

function isolateOverlay(condition: Exclude<Condition, "A" | "C-full">): string {
  return `[LENGTH ISOLATE — Phase 7 ${condition}]\n${ISOLATE_LINES[condition]}`;
}

function applyOverlay(
  productionLengthText: string,
  condition: Condition,
  targetResponseChars: number
): string {
  if (condition === "A") return productionLengthText;

  if (condition === "C-full") {
    const aim = UNIFIED_TIER_AIM_CHARS;
    const min80 = Math.round(aim * 0.8);
    return `${productionLengthText}\n\n${STRONG_LENGTH_OVERLAY(aim, min80)}`;
  }

  return `${productionLengthText}\n\n${isolateOverlay(condition)}`;
}

function rebuildSystem(
  sections: TrackedSection[],
  condition: Condition,
  productionLengthText: string,
  targetResponseChars: number
): string {
  return sections
    .map((s) => {
      if (s.id !== "rule-length-control") return s.text;
      return applyOverlay(productionLengthText, condition, targetResponseChars);
    })
    .join("\n\n");
}

// Beat analysis (from audit-length-control-effectiveness)
type BeatKind = "Initiation" | "Reaction" | "Follow-through" | "Consequence" | "Pause";
type StopAfter =
  | "A_initiation"
  | "B_reaction"
  | "C_follow_through"
  | "D_consequence"
  | "E_true_pause";

const PAUSE_PATTERN =
  /(?:기다리|반응을 기다|대답을 기다|말을 기다|선택을 기다|확인하며|지켜보|바라보|응시하며|호흡.*(?:들|확인)|침묵|정적|고요|망설|가늠|질문이었다|재촉이 아닌|멈춘 채|멈추고)/;

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…]["']?)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function classifyBeatKind(text: string, priorKinds: BeatKind[], source: "dialogue" | "narration"): BeatKind {
  const t = text.trim();
  if (!t) return "Follow-through";
  if (PAUSE_PATTERN.test(t)) return "Pause";
  if (source === "dialogue") return priorKinds.length === 0 ? "Initiation" : "Follow-through";
  if (priorKinds.length === 0) return "Initiation";
  return "Follow-through";
}

function segmentBeats(text: string) {
  const beats: { kind: BeatKind; source: string }[] = [];
  const paragraphs = text.trim().split(/\n\n+/).filter((p) => p.trim());
  const prior: BeatKind[] = [];

  for (const para of paragraphs) {
    const dialogueRegex = /"[^"]*"/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = dialogueRegex.exec(para)) !== null) {
      if (match.index > lastIndex) {
        for (const sent of splitSentences(para.slice(lastIndex, match.index))) {
          const kind = classifyBeatKind(sent, prior, "narration");
          prior.push(kind);
          beats.push({ kind, source: "narration" });
        }
      }
      const kind = classifyBeatKind(match[0], prior, "dialogue");
      prior.push(kind);
      beats.push({ kind, source: "dialogue" });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < para.length) {
      for (const sent of splitSentences(para.slice(lastIndex))) {
        const kind = classifyBeatKind(sent, prior, "narration");
        prior.push(kind);
        beats.push({ kind, source: "narration" });
      }
    }
  }
  return beats;
}

function beatKindToStopAfter(kind: BeatKind): StopAfter {
  switch (kind) {
    case "Initiation":
      return "A_initiation";
    case "Reaction":
      return "B_reaction";
    case "Follow-through":
      return "C_follow_through";
    case "Consequence":
      return "D_consequence";
    case "Pause":
      return "E_true_pause";
  }
}

function estimateRemaining(stopAfter: StopAfter): number {
  switch (stopAfter) {
    case "A_initiation":
      return 4;
    case "B_reaction":
      return 3;
    case "C_follow_through":
      return 2;
    case "D_consequence":
      return 1;
    case "E_true_pause":
      return 0;
  }
}

function analyzeBeats(text: string) {
  const beats = segmentBeats(text);
  if (beats.length === 0) {
    return {
      total_beats: 0,
      omitted_beats: 4,
      first_stopping_opportunity: "A_initiation" as StopAfter,
      stop_after: "A_initiation" as StopAfter,
    };
  }
  const finalKind = beats[beats.length - 1].kind;
  const stop_after = beatKindToStopAfter(finalKind);
  const omitted_beats = estimateRemaining(stop_after);
  const first_stopping_opportunity = beatKindToStopAfter(beats[0].kind);
  return {
    total_beats: beats.length,
    omitted_beats,
    first_stopping_opportunity,
    stop_after,
  };
}

type TurnLog = {
  condition: Condition;
  run_index: number;
  turn_number: number;
  model_id: string;
  output_chars: number;
  action_count: number;
  narration_paragraph_count: number;
  ending_type: string;
  finish_reason: string | null;
  ends_with_observer_verb: boolean;
  omitted_beats: number;
  total_beats: number;
  timestamp: string;
};

function avg(nums: number[]) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdDev(nums: number[]) {
  if (nums.length < 2) return 0;
  const m = avg(nums);
  return Math.sqrt(nums.reduce((s, n) => s + (n - m) ** 2, 0) / nums.length);
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function pooledSummary(rows: TurnLog[], condition: Condition) {
  const subset = rows.filter((r) => r.condition === condition);
  const chars = subset.map((r) => r.output_chars);
  return {
    n: subset.length,
    avg_chars: round1(avg(chars)),
    std_dev: round1(stdDev(chars)),
    avg_actions: round1(avg(subset.map((r) => r.action_count))),
    observer_rate: round1(
      subset.filter((r) => r.ends_with_observer_verb).length / (subset.length || 1)
    ),
    avg_omitted_beats: round1(avg(subset.map((r) => r.omitted_beats))),
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

function buildReport(rows: TurnLog[], runs: number, logPath: string): string {
  const baseline = pooledSummary(rows, "A");
  const cFull = pooledSummary(rows, "C-full");
  const fullDelta = cFull.avg_chars - baseline.avg_chars;
  const phase5RefDelta = 665;

  const isolateConditions = ["C1", "C2", "C3", "C4", "C5"] as const;
  const ranked = isolateConditions
    .map((cond) => {
      const s = pooledSummary(rows, cond);
      const delta = s.avg_chars - baseline.avg_chars;
      const capturePct =
        fullDelta > 0 ? round1((delta / fullDelta) * 100) : 0;
      return { cond, ...s, delta, capturePct };
    })
    .sort((a, b) => b.delta - a.delta);

  const lines = [
    "# Phase 7 — Length Control Causality Decomposition",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Runs per condition: ${runs} · turns ${TURNS.join("/")} · models: ${MODELS.join(", ")}`,
    `Log: ${logPath}`,
    "",
    "## Primary question",
    "",
    "Which isolated Phase 5 C instruction contributes most of the +665 char gain (Phase 5 A→C)?",
    "",
    "## Conditions",
    "",
    "- **A** — Current production `rule-length-control`",
    "- **C1** — \"The target response length is mandatory.\"",
    "- **C2** — \"Outputs below 80% of target scope are incomplete.\"",
    "- **C3** — \"Do not conclude after a single reaction, action, or exchange.\"",
    "- **C4** — \"Continue scene development through immediate consequences, observations, dialogue, and internal processing.\"",
    "- **C5** — \"Multiple meaningful beats should occur before yielding.\"",
    "- **C-full** — Original Phase 5 C overlay (numeric target + 80% min + full mandatory block)",
    "",
    "Each C1–C5 = production A + single isolated overlay line only.",
    "",
    "## Pooled summary (all models)",
    "",
    "| Condition | avg chars | σ | Δ vs A | capture of C-full Δ | actions | observer % | omitted beats | n |",
    "|-----------|-----------|---|--------|---------------------|---------|------------|---------------|---|",
    `| A | ${baseline.avg_chars} | ${baseline.std_dev} | 0 | — | ${baseline.avg_actions} | ${round1(baseline.observer_rate * 100)}% | ${baseline.avg_omitted_beats} | ${baseline.n} |`,
  ];

  for (const r of ranked) {
    lines.push(
      `| ${r.cond} | ${r.avg_chars} | ${r.std_dev} | ${round1(r.delta)} | ${r.capturePct}% | ${r.avg_actions} | ${round1(r.observer_rate * 100)}% | ${r.avg_omitted_beats} | ${r.n} |`
    );
  }

  const cFullCapture =
    fullDelta > 0 ? round1((fullDelta / phase5RefDelta) * 100) : 0;
  lines.push(
    `| C-full | ${cFull.avg_chars} | ${cFull.std_dev} | ${round1(fullDelta)} | 100% (this run) | ${cFull.avg_actions} | ${round1(cFull.observer_rate * 100)}% | ${cFull.avg_omitted_beats} | ${cFull.n} |`,
    "",
    `Phase 5 reference: A≈831 → C≈1496 (Δ≈${phase5RefDelta}). This run C-full Δ vs A: ${round1(fullDelta)} (${cFullCapture}% of Phase 5 reference).`,
    "",
    "## Causal ranking (isolated overlays, pooled Δ vs A)",
    "",
  );

  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    lines.push(
      `${i + 1}. **${r.cond}** — Δ ${round1(r.delta)} chars (${r.capturePct}% of this-run C-full Δ); line: ${ISOLATE_LINES[r.cond]}`
    );
  }

  const top = ranked[0];
  lines.push(
    "",
    "## Interpretation",
    "",
    top.delta > baseline.std_dev * 0.5
      ? `**${top.cond}** shows the largest isolated lift (+${round1(top.delta)} chars pooled). ${ISOLATE_LINES[top.cond]}`
      : "No single isolated line exceeded 0.5σ of baseline — C-full gain likely requires **combined** instructions (especially numeric 80% floor in full overlay).",
    "",
    fullDelta > top.delta + baseline.std_dev
      ? `C-full (+${round1(fullDelta)}) exceeds best isolate (+${round1(top.delta)}) by ${round1(fullDelta - top.delta)} → synergy or numeric target lines in full overlay drive residual gain.`
      : `C-full delta (${round1(fullDelta)}) is close to best isolate — full overlay may be redundant with dominant component.`,
    "",
    "## Per model × condition (avg chars)",
    "",
    "| Model | A | C1 | C2 | C3 | C4 | C5 | C-full |",
    "|-------|---|----|----|----|----|----|--------|",
  );

  for (const model of MODELS) {
    const cols = CONDITIONS.map((cond) => {
      const subset = rows.filter((r) => r.condition === cond && r.model_id === model);
      return round1(avg(subset.map((r) => r.output_chars)));
    });
    lines.push(`| ${model.split("/").pop()} | ${cols.join(" | ")} |`);
  }

  lines.push("", "## finish_reason (pooled)", "");
  for (const cond of CONDITIONS) {
    const subset = rows.filter((r) => r.condition === cond);
    const fr = Object.fromEntries(
      [...new Set(subset.map((r) => r.finish_reason ?? "null"))].map((k) => [
        k,
        subset.filter((r) => (r.finish_reason ?? "null") === k).length,
      ])
    );
    lines.push(`- **${cond}**: ${JSON.stringify(fr)}`);
  }

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const runsArg = args.find((a) => a.startsWith("--runs="));
  const runs = runsArg ? Math.max(1, parseInt(runsArg.slice("--runs=".length), 10) || 5) : 5;

  const lengthOpts: LengthInstructionOpts = {
    htmlFlashOwned: true,
    proseStylePolicyOwnsSceneExpansion: true,
    statusWidgetActive: false,
  };

  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");
  const { buildContext } = await import("../src/services/contextBuilder");

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(outDir, `length-control-causality-${stamp}.jsonl`);
  const reportPath = path.join(outDir, `length-control-causality-${stamp}.md`);

  const rows: TurnLog[] = [];
  const totalCalls = runs * CONDITIONS.length * MODELS.length * TURNS.length;

  console.log("=== Phase 7: Length Control Causality Decomposition ===");
  console.log("Conditions:", CONDITIONS.join(", "));
  console.log("API calls:", totalCalls);

  for (const model_id of MODELS) {
    for (const condition of CONDITIONS) {
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
          const sections = built.meta.trackedSections ?? [];
          const lengthSection = sections.find((s) => s.id === "rule-length-control");
          if (!lengthSection) throw new Error("rule-length-control missing");

          const productionLength =
            buildLengthInstruction(f.targetResponseChars, lengthOpts) ?? lengthSection.text;
          const system = rebuildSystem(
            sections,
            condition,
            productionLength,
            f.targetResponseChars
          );

          console.log(`\n→ ${condition} run ${run_index}/${runs} t=${turn_number} ${model_id}`);

          let result: Awaited<ReturnType<typeof callOpenRouterAdult>> | null = null;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              result = await callOpenRouterAdult(
                system,
                [{ role: "user", content: f.currentUserMessage }],
                model_id,
                f.targetResponseChars,
                { charName: f.charName },
                {
                  chargeTurnBudget: false,
                  requestKind: `phase7-${condition}-r${run_index}`,
                }
              );
              break;
            } catch (err) {
              console.warn(`  attempt ${attempt}/3:`, err instanceof Error ? err.message : err);
              if (attempt === 3) throw err;
              await new Promise((r) => setTimeout(r, 3000 * attempt));
            }
          }
          if (!result) continue;

          const metrics = analyzeOutput(result.text);
          const beat = analyzeBeats(result.text);
          const row: TurnLog = {
            condition,
            run_index,
            turn_number,
            model_id,
            output_chars: visibleAssistantDisplayCharCount(result.text),
            action_count: metrics.action_count,
            narration_paragraph_count: metrics.narration_paragraph_count,
            ending_type: metrics.ending_type,
            finish_reason: result.usage.finishReason ?? null,
            ends_with_observer_verb: metrics.ends_with_observer_verb,
            omitted_beats: beat.omitted_beats,
            total_beats: beat.total_beats,
            timestamp: new Date().toISOString(),
          };
          rows.push(row);
          fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
          console.log({ chars: row.output_chars, actions: row.action_count, observer: row.ends_with_observer_verb });
        }
      }
    }
  }

  const report = buildReport(rows, runs, logPath);
  fs.writeFileSync(reportPath, report, "utf8");

  const baseline = pooledSummary(rows, "A");
  console.log("\n=== Pooled avg chars ===");
  for (const cond of CONDITIONS) {
    const s = pooledSummary(rows, cond);
    console.log(
      cond,
      s.avg_chars,
      `(Δ ${round1(s.avg_chars - baseline.avg_chars)})`
    );
  }
  console.log(`\nReport: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
