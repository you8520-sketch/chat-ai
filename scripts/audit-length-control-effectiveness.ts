/**
 * Phase 5 — LENGTH CONTROL EFFECTIVENESS AUDIT (overlay-only, production unchanged).
 *
 * Safety: section-id overlay on trackedSections — no regex deletion on full prompt.
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-length-control-effectiveness.ts --safety-only
 *   npx.cmd tsx scripts/audit-length-control-effectiveness.ts --runs=5
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import { estimateTokens } from "../src/lib/tokenEstimate";
import { analyzeOutput } from "./audit-output-compression-causes";
import { NO_INPUT_ECHO_RULE } from "../src/lib/sceneExpansionPolicy";
import {
  resolveResponseLengthTarget,
  UNIFIED_TIER_AIM_CHARS,
  buildLengthInstruction,
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

const CONDITIONS = ["A", "B", "C", "D"] as const;
type Condition = (typeof CONDITIONS)[number];

const TURN_HANDOFF_REFERENCE =
  "Turn-end handoff beats and observer-ending bans: strictly obey <TURN_HANDOFF_AND_PACING>.";

const LENGTH_VS_AGENCY = `LENGTH vs AGENCY:
- Stay in-scene per this block and <TURN_HANDOFF_AND_PACING> — godmodding [B] is NEVER acceptable. ([A] = AI character · [B] = user character)`;

const STRONG_LENGTH_OVERLAY = (aim: number, min80: number) =>
  `[LENGTH TARGET — MANDATORY (Phase 5 overlay C)]
TARGET: ${aim.toLocaleString()} Korean characters. Minimum acceptable before ending: ${min80.toLocaleString()} (80% of target).
Do NOT end before completing multiple meaningful in-scene beats.
Target length is MANDATORY, not aspirational.
Outputs below 80% of target length are INCOMPLETE — continue scene development until target scope is satisfied.`;

const EXTREME_LENGTH_OVERLAY = `[MINIMUM SCENE DEVELOPMENT — MANDATORY (Phase 5 overlay D)]
- Minimum 5 distinct in-scene beats (action, dialogue, sensation, or environment change) before turn end.
- Minimum 3 narration paragraphs with substantive development before yielding to [B].
- Do NOT complete the turn after a single [A] reaction, one micro-gesture, or one dialogue line.
- Early completion immediately after one action/reaction is FORBIDDEN — expand the scene first.`;

type TrackedSection = { id: string; text: string; label?: string; tokens?: number };

/** B — strip length-targeting only; keep NO_INPUT_ECHO, handoff ref, agency line */
function buildLengthBlockNoTargeting(): string {
  return `[LENGTH CONTROL & SCENE EXPANSION]
Generate ONE continuous response in a single pass (no split output across loads).

${NO_INPUT_ECHO_RULE}

${TURN_HANDOFF_REFERENCE}

${LENGTH_VS_AGENCY}`;
}

function applyLengthOverlay(
  productionLengthText: string,
  condition: Condition,
  targetResponseChars: number
): string {
  if (condition === "A") return productionLengthText;

  const t = resolveResponseLengthTarget(targetResponseChars);
  const aim = UNIFIED_TIER_AIM_CHARS;
  const min80 = Math.round(aim * 0.8);

  if (condition === "B") return buildLengthBlockNoTargeting();

  const base = productionLengthText;
  if (condition === "C") {
    return `${base}\n\n${STRONG_LENGTH_OVERLAY(aim, min80)}`;
  }
  return `${base}\n\n${STRONG_LENGTH_OVERLAY(aim, min80)}\n\n${EXTREME_LENGTH_OVERLAY}`;
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
      return applyLengthOverlay(productionLengthText, condition, targetResponseChars);
    })
    .join("\n\n");
}

// --- Beat / stopping analysis (from audit-beat-completion / audit-ending-behavior) ---
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
  const natural = stop_after === "D_consequence" || stop_after === "E_true_pause";
  const omitted_beats = natural ? estimateRemaining(stop_after) : estimateRemaining(stop_after);
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
  dialogue_count: number;
  narration_paragraph_count: number;
  ending_type: string;
  finish_reason: string | null;
  ends_with_observer_verb: boolean;
  omitted_beats: number;
  total_beats: number;
  first_stopping_opportunity: string;
  stop_after: string;
  target_response_chars: number;
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

async function buildFixtureContext(turn_number: number, model_id: string) {
  const f = await fixture(turn_number);
  const { buildContext } = await import("../src/services/contextBuilder");
  const built = buildContext({
    ...f,
    userNickname: f.personaDisplayName,
    assetTags: undefined,
    modelId: model_id,
    provider: "openrouter",
  });
  return { f, built };
}

function summarize(rows: TurnLog[], condition: Condition, model_id: string) {
  const subset = rows.filter((r) => r.condition === condition && r.model_id === model_id);
  const chars = subset.map((r) => r.output_chars);
  return {
    n: subset.length,
    avg_chars: round1(avg(chars)),
    std_dev_chars: round1(stdDev(chars)),
    avg_actions: round1(avg(subset.map((r) => r.action_count))),
    avg_narr_paras: round1(avg(subset.map((r) => r.narration_paragraph_count))),
    avg_dialogue: round1(avg(subset.map((r) => r.dialogue_count))),
    observer_rate: round1(
      subset.filter((r) => r.ends_with_observer_verb).length / (subset.length || 1)
    ),
    avg_omitted_beats: round1(avg(subset.map((r) => r.omitted_beats))),
    avg_total_beats: round1(avg(subset.map((r) => r.total_beats))),
    first_stop_dist: Object.fromEntries(
      [...new Set(subset.map((r) => r.first_stopping_opportunity))].map((k) => [
        k,
        subset.filter((r) => r.first_stopping_opportunity === k).length,
      ])
    ),
    finish_reasons: Object.fromEntries(
      [...new Set(subset.map((r) => r.finish_reason ?? "null"))].map((k) => [
        k,
        subset.filter((r) => (r.finish_reason ?? "null") === k).length,
      ])
    ),
    ending_types: Object.fromEntries(
      [...new Set(subset.map((r) => r.ending_type))].map((k) => [
        k,
        subset.filter((r) => r.ending_type === k).length,
      ])
    ),
  };
}

async function runSafetyCheck() {
  console.log("=== SAFETY CHECK: A vs B prompt assembly (t=8, DeepSeek) ===\n");

  const { built } = await buildFixtureContext(8, MODELS[2]);
  const sections = built.meta.trackedSections ?? [];
  const lengthSection = sections.find((s) => s.id === "rule-length-control");
  if (!lengthSection) {
    console.error("FAIL: rule-length-control section not found");
    process.exit(1);
  }

  const productionLength = lengthSection.text;
  const systemA = rebuildSystem(sections, "A", productionLength, 2500);
  const systemB = rebuildSystem(sections, "B", productionLength, 2500);

  const charDiff = systemA.length - systemB.length;
  const bLengthText = buildLengthBlockNoTargeting();
  const sectionDiff = productionLength.length - bLengthText.length;

  const turnHandoff = sections.find((s) => s.id === "turn-handoff-and-pacing");
  const handoffInA = turnHandoff ? systemA.includes(turnHandoff.text.slice(0, 80)) : false;
  const handoffInB = turnHandoff ? systemB.includes(turnHandoff.text.slice(0, 80)) : false;

  console.log({
    systemA_chars: systemA.length,
    systemB_chars: systemB.length,
    char_diff_A_minus_B: charDiff,
    production_length_section_chars: productionLength.length,
    B_length_section_chars: bLengthText.length,
    section_char_diff: sectionDiff,
    char_diff_matches_section_diff: charDiff === sectionDiff,
    production_length_section_tokens: estimateTokens(productionLength),
    B_length_section_tokens: estimateTokens(bLengthText),
    token_diff: estimateTokens(productionLength) - estimateTokens(bLengthText),
  });

  console.log("\nCross-section integrity:");
  console.log("  TURN_HANDOFF block present in A:", handoffInA);
  console.log("  TURN_HANDOFF block present in B:", handoffInB);
  console.log("  NO_INPUT_ECHO in A:", systemA.includes("[NO INPUT ECHO — STRICT]"));
  console.log("  NO_INPUT_ECHO in B:", systemB.includes("[NO INPUT ECHO — STRICT]"));
  console.log("  CEILING in A:", /CEILING:\s*[\d,]+/.test(systemA));
  console.log("  CEILING in B:", /CEILING:\s*[\d,]+/.test(systemB));
  console.log(
    "  noGodmodding LENGTH ref (cross-ref, not deleted):",
    systemA.includes("LENGTH CONTROL & SCENE EXPANSION") &&
      systemB.includes("LENGTH CONTROL & SCENE EXPANSION")
  );

  const otherSectionIds = sections.map((s) => s.id).filter((id) => id !== "rule-length-control");
  let otherSectionsIdentical = true;
  for (const id of otherSectionIds) {
    const sec = sections.find((s) => s.id === id)!;
    const inA = systemA.includes(sec.text.slice(0, Math.min(60, sec.text.length)));
    const inB = systemB.includes(sec.text.slice(0, Math.min(60, sec.text.length)));
    if (inA !== inB) {
      console.warn(`  ⚠ section ${id} presence mismatch A=${inA} B=${inB}`);
      otherSectionsIdentical = false;
    }
  }
  console.log("  built.systemPrompt vs rebuild A:", built.systemPrompt.length, systemA.length);
  console.log("  All non-length sections present in both:", otherSectionsIdentical);

  if (charDiff !== sectionDiff) {
    console.error("\nFAIL: System char diff does not match length-section diff only!");
    process.exit(1);
  }
  if (!systemB.includes("[NO INPUT ECHO — STRICT]")) {
    console.error("\nFAIL: B missing NO_INPUT_ECHO");
    process.exit(1);
  }
  if (/CEILING:\s*[\d,]+/.test(systemB)) {
    console.error("\nFAIL: B still contains CEILING length target");
    process.exit(1);
  }

  console.log("\nSAFETY CHECK PASSED — diff is isolated to length-targeting lines in rule-length-control.\n");
}

function buildReport(
  rows: TurnLog[],
  runs: number,
  logPath: string,
  safetySummary: string
): string {
  const lines: string[] = [
    "# Phase 5 — LENGTH CONTROL Effectiveness Audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Runs per condition: ${runs} · turns ${TURNS.join("/")} · models: ${MODELS.join(", ")}`,
    `Log: ${logPath}`,
    "",
    "## Primary question",
    "",
    "**Does changing LENGTH CONTROL materially change output length?**",
    "",
    "## Safety check (A vs B assembly)",
    "",
    safetySummary,
    "",
    "## Conditions",
    "",
    "- **A** — Current production `rule-length-control` (baseline)",
    "- **B** — Length-targeting removed (no SOFT_LENGTH_GUIDELINE, no CEILING); NO_INPUT_ECHO + agency kept",
    "- **C** — A + mandatory target overlay (80% minimum, incomplete if short)",
    "- **D** — C + minimum beat/paragraph requirements + anti-early-completion",
    "",
    "## Summary by condition (all models pooled)",
    "",
    "| Condition | avg chars | σ chars | actions | narr paras | observer % | omitted beats | n |",
    "|-----------|-----------|---------|---------|------------|------------|---------------|---|",
  ];

  for (const cond of CONDITIONS) {
    const subset = rows.filter((r) => r.condition === cond);
    const chars = subset.map((r) => r.output_chars);
    lines.push(
      `| ${cond} | ${round1(avg(chars))} | ${round1(stdDev(chars))} | ${round1(avg(subset.map((r) => r.action_count)))} | ${round1(avg(subset.map((r) => r.narration_paragraph_count)))} | ${round1(subset.filter((r) => r.ends_with_observer_verb).length / (subset.length || 1) * 100)}% | ${round1(avg(subset.map((r) => r.omitted_beats)))} | ${subset.length} |`
    );
  }

  lines.push("", "## Per model × condition (avg chars)", "", "| Model | A | B | C | D | B−A | C−A | D−A |", "|-------|---|---|---|---|-----|-----|-----|");

  for (const model of MODELS) {
    const a = summarize(rows, "A", model).avg_chars;
    const b = summarize(rows, "B", model).avg_chars;
    const c = summarize(rows, "C", model).avg_chars;
    const d = summarize(rows, "D", model).avg_chars;
    lines.push(
      `| ${model.split("/").pop()} | ${a} | ${b} | ${c} | ${d} | ${round1(b - a)} | ${round1(c - a)} | ${round1(d - a)} |`
    );
  }

  lines.push("", "## Causality interpretation", "");

  const allA = avg(rows.filter((r) => r.condition === "A").map((r) => r.output_chars));
  const allB = avg(rows.filter((r) => r.condition === "B").map((r) => r.output_chars));
  const allC = avg(rows.filter((r) => r.condition === "C").map((r) => r.output_chars));
  const allD = avg(rows.filter((r) => r.condition === "D").map((r) => r.output_chars));
  const spread = Math.max(allA, allB, allC, allD) - Math.min(allA, allB, allC, allD);
  const sigmaA = stdDev(rows.filter((r) => r.condition === "A").map((r) => r.output_chars));

  if (spread < sigmaA * 0.5) {
    lines.push(
      `Pooled means A=${round1(allA)} B=${round1(allB)} C=${round1(allC)} D=${round1(allD)} — spread ${round1(spread)} vs A σ ${round1(sigmaA)} → **LENGTH CONTROL variants do not materially change length** (models likely ignore or handoff dominates).`
    );
  } else if (allC > allA + sigmaA * 0.5 || allD > allA + sigmaA * 0.5) {
    lines.push(
      `C/D exceed A by >0.5σ (A=${round1(allA)}, C=${round1(allC)}, D=${round1(allD)}) → **stronger LENGTH CONTROL is causal** — worth optimizing length instructions.`
    );
  } else if (Math.abs(allB - allA) > sigmaA * 0.5) {
    lines.push(
      `Removing length targeting (B vs A) shifts output by ${round1(allB - allA)} chars → partial sensitivity to length block presence.`
    );
  } else {
    lines.push(`Mixed results — see per-model table; sampling σ may dominate condition deltas.`);
  }

  lines.push("", "## Detail per model", "");

  for (const model of MODELS) {
    lines.push(`### ${model}`, "");
    for (const cond of CONDITIONS) {
      const s = summarize(rows, cond, model);
      lines.push(
        `**${cond}**: chars ${s.avg_chars} (σ ${s.std_dev_chars}) · actions ${s.avg_actions} · narr ${s.avg_narr_paras} · dialogue ${s.avg_dialogue} · observer ${s.observer_rate} · omitted beats ${s.avg_omitted_beats} · finish ${JSON.stringify(s.finish_reasons)} · endings ${JSON.stringify(s.ending_types)} · first_stop ${JSON.stringify(s.first_stop_dist)}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const runsArg = args.find((a) => a.startsWith("--runs="));
  const runs = runsArg ? Math.max(1, parseInt(runsArg.slice("--runs=".length), 10) || 5) : 5;
  const safetyOnly = args.includes("--safety-only");

  await runSafetyCheck();
  if (safetyOnly) return;

  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(outDir, `length-control-effectiveness-${stamp}.jsonl`);
  const reportPath = path.join(outDir, `length-control-effectiveness-${stamp}.md`);

  const rows: TurnLog[] = [];
  const safetySummary = "See console — section-overlay only; char diff matches rule-length-control section diff.";

  console.log("=== Phase 5: LENGTH CONTROL Effectiveness Audit ===");
  console.log("Runs per condition:", runs);
  console.log("Total API calls:", runs * CONDITIONS.length * MODELS.length * TURNS.length);

  for (const model_id of MODELS) {
    for (const condition of CONDITIONS) {
      for (let run_index = 1; run_index <= runs; run_index++) {
        for (const turn_number of TURNS) {
          const { f, built } = await buildFixtureContext(turn_number, model_id);
          const sections = built.meta.trackedSections ?? [];
          const lengthSec = sections.find((s) => s.id === "rule-length-control");
          const productionLength = lengthSec?.text ?? buildLengthInstruction(f.targetResponseChars);
          const system = rebuildSystem(sections, condition, productionLength, f.targetResponseChars);

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
                { chargeTurnBudget: false, requestKind: `length-audit-${condition}-r${run_index}` }
              );
              break;
            } catch (err) {
              console.warn(`  attempt ${attempt}/3 failed:`, err instanceof Error ? err.message : err);
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
            dialogue_count: metrics.dialogue_count,
            narration_paragraph_count: metrics.narration_paragraph_count,
            ending_type: metrics.ending_type,
            finish_reason: result.usage.finishReason ?? null,
            ends_with_observer_verb: metrics.ends_with_observer_verb,
            omitted_beats: beat.omitted_beats,
            total_beats: beat.total_beats,
            first_stopping_opportunity: beat.first_stopping_opportunity,
            stop_after: beat.stop_after,
            target_response_chars: f.targetResponseChars,
            timestamp: new Date().toISOString(),
          };
          rows.push(row);
          fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
          console.log({
            output_chars: row.output_chars,
            omitted_beats: row.omitted_beats,
            stop_after: row.stop_after,
          });
        }
      }
    }
  }

  const report = buildReport(rows, runs, logPath, safetySummary);
  fs.writeFileSync(reportPath, report, "utf8");

  console.log("\n=== Pooled by condition ===");
  for (const cond of CONDITIONS) {
    const subset = rows.filter((r) => r.condition === cond);
    console.log(cond, {
      avg_chars: round1(avg(subset.map((r) => r.output_chars))),
      std: round1(stdDev(subset.map((r) => r.output_chars))),
    });
  }

  console.log(`\nReport: ${reportPath}`);
  console.log(`Log: ${logPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
