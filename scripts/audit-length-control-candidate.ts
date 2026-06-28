/**
 * Phase 6 — Production length-control candidate vs current production.
 *
 * Overlay-only audit: swaps rule-length-control section text only.
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-length-control-candidate.ts --runs=5
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import { estimateTokens } from "../src/lib/tokenEstimate";
import { analyzeOutput } from "./audit-output-compression-causes";
import {
  buildLengthInstruction,
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

const CONDITIONS = ["PRODUCTION", "CANDIDATE"] as const;
type Condition = (typeof CONDITIONS)[number];

type TrackedSection = { id: string; text: string };

function rebuildSystem(
  sections: TrackedSection[],
  condition: Condition,
  targetResponseChars: number,
  lengthOpts: LengthInstructionOpts
): string {
  return sections
    .map((s) => {
      if (s.id !== "rule-length-control") return s.text;
      if (condition === "PRODUCTION") {
        return buildLengthInstruction(targetResponseChars, lengthOpts);
      }
      return buildLengthInstruction(targetResponseChars, lengthOpts);
    })
    .join("\n\n");
}

// Beat analysis (subset from audit-length-control-effectiveness)
type StopAfter =
  | "A_initiation"
  | "B_reaction"
  | "C_follow_through"
  | "D_consequence"
  | "E_true_pause";

const PAUSE_PATTERN =
  /(?:기다리|반응을 기다|대답을 기다|말을 기다|선택을 기다|확인하며|지켜보|바라보|응시하며)/;

function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?…]["']?)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function analyzeBeats(text: string) {
  const paragraphs = text.trim().split(/\n\n+/).filter((p) => p.trim());
  let beatCount = 0;
  for (const para of paragraphs) {
    const quotes = (para.match(/"[^"]*"/g) ?? []).length;
    beatCount += quotes;
    const narr = para.replace(/"[^"]*"/g, " ");
    beatCount += splitSentences(narr).length;
  }
  if (beatCount === 0) {
    return { total_beats: 0, omitted_beats: 4, stop_after: "A_initiation" as StopAfter };
  }
  const tail = text.slice(-400);
  const stop_after: StopAfter = PAUSE_PATTERN.test(tail) ? "E_true_pause" : "C_follow_through";
  const omitted =
    stop_after === "A_initiation" ? 4 : stop_after === "E_true_pause" ? 0 : 2;
  return { total_beats: beatCount, omitted_beats: omitted, stop_after };
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
  stop_after: string;
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

function summarize(rows: TurnLog[], condition: Condition, model_id: string) {
  const subset = rows.filter((r) => r.condition === condition && r.model_id === model_id);
  const chars = subset.map((r) => r.output_chars);
  return {
    n: subset.length,
    avg_chars: round1(avg(chars)),
    std_dev: round1(stdDev(chars)),
    observer_rate: round1(
      subset.filter((r) => r.ends_with_observer_verb).length / (subset.length || 1)
    ),
    avg_omitted_beats: round1(avg(subset.map((r) => r.omitted_beats))),
    finish_reasons: Object.fromEntries(
      [...new Set(subset.map((r) => r.finish_reason ?? "null"))].map((k) => [
        k,
        subset.filter((r) => (r.finish_reason ?? "null") === k).length,
      ])
    ),
  };
}

function buildReport(rows: TurnLog[], runs: number, logPath: string): string {
  const prodAll = rows.filter((r) => r.condition === "PRODUCTION");
  const candAll = rows.filter((r) => r.condition === "CANDIDATE");
  const prodChars = avg(prodAll.map((r) => r.output_chars));
  const candChars = avg(candAll.map((r) => r.output_chars));

  const lines = [
    "# Phase 6 — Production Length-Control Candidate Audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Runs per condition: ${runs} · turns ${TURNS.join("/")} · models: ${MODELS.join(", ")}`,
    `Log: ${logPath}`,
    "",
    "## Goal",
    "",
    "Does production-safe mandatory wording capture most of Phase 5 C-condition gains (~831→~1496) without regressions?",
    "",
    "## Candidate wording (soft layer only)",
    "",
    "- `buildLengthInstruction()` in `responseLength.ts`",
    "- Replaces advisory soft guideline with mandatory scene-completion scope",
    "- No numeric min chars, beat quotas, or paragraph quotas",
    "- NO_INPUT_ECHO, agency, handoff, CEILING unchanged",
    "",
    "## Pooled summary",
    "",
    "| Condition | avg chars | σ | observer % | omitted beats | n |",
    "|-----------|-----------|---|------------|---------------|---|",
    `| PRODUCTION | ${round1(prodChars)} | ${round1(stdDev(prodAll.map((r) => r.output_chars)))} | ${round1(prodAll.filter((r) => r.ends_with_observer_verb).length / (prodAll.length || 1) * 100)}% | ${round1(avg(prodAll.map((r) => r.omitted_beats)))} | ${prodAll.length} |`,
    `| CANDIDATE | ${round1(candChars)} | ${round1(stdDev(candAll.map((r) => r.output_chars)))} | ${round1(candAll.filter((r) => r.ends_with_observer_verb).length / (candAll.length || 1) * 100)}% | ${round1(avg(candAll.map((r) => r.omitted_beats)))} | ${candAll.length} |`,
    "",
    `**Δ candidate − production:** ${round1(candChars - prodChars)} chars (${round1(((candChars - prodChars) / prodChars) * 100)}%)`,
    "",
    "Phase 5 reference: production A ≈ 831, overlay C ≈ 1496 (+665, ~80%).",
    "",
    "## Per model",
    "",
    "| Model | PRODUCTION | CANDIDATE | Δ | observer prod | observer cand |",
    "|-------|------------|-----------|---|---------------|---------------|",
  ];

  for (const model of MODELS) {
    const p = summarize(rows, "PRODUCTION", model);
    const c = summarize(rows, "CANDIDATE", model);
    lines.push(
      `| ${model.split("/").pop()} | ${p.avg_chars} | ${c.avg_chars} | ${round1(c.avg_chars - p.avg_chars)} | ${p.observer_rate * 100}% | ${c.observer_rate * 100}% |`
    );
  }

  lines.push("", "## finish_reason", "");
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

  const captureRatio =
    prodChars > 0 ? round1(((candChars - prodChars) / (1496 - 831)) * 100) : 0;
  lines.push("", "## Interpretation", "");
  if (candChars - prodChars < 100) {
    lines.push(
      "Candidate delta is small vs production — mandatory wording alone may not replicate Phase 5 C overlay gains."
    );
  } else if (captureRatio >= 50) {
    lines.push(
      `Candidate captures ~${captureRatio}% of Phase 5 C gain vs production baseline — strong candidate for production merge.`
    );
  } else {
    lines.push(
      `Candidate captures ~${captureRatio}% of Phase 5 C overlay gain — partial improvement; may need tuning or model-specific branches.`
    );
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

  const prodBlock = buildLengthInstruction(2500, lengthOpts);
  const candBlock = buildLengthInstruction(2500, lengthOpts);
  console.log("=== Phase 6 length block diff ===");
  console.log({
    production_chars: prodBlock.length,
    candidate_chars: candBlock.length,
    char_diff: candBlock.length - prodBlock.length,
    production_tokens: estimateTokens(prodBlock),
    candidate_tokens: estimateTokens(candBlock),
    token_diff: estimateTokens(candBlock) - estimateTokens(prodBlock),
  });

  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");
  const { buildContext } = await import("../src/services/contextBuilder");

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(outDir, `length-control-candidate-${stamp}.jsonl`);
  const reportPath = path.join(outDir, `length-control-candidate-${stamp}.md`);

  const rows: TurnLog[] = [];

  console.log("\n=== Phase 6: Production vs Candidate ===");
  console.log("API calls:", runs * CONDITIONS.length * MODELS.length * TURNS.length);

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
          const system = rebuildSystem(sections, condition, f.targetResponseChars, lengthOpts);

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
                  requestKind: `phase6-${condition}-r${run_index}`,
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
            stop_after: beat.stop_after,
            timestamp: new Date().toISOString(),
          };
          rows.push(row);
          fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
          console.log({ chars: row.output_chars, observer: row.ends_with_observer_verb });
        }
      }
    }
  }

  const report = buildReport(rows, runs, logPath);
  fs.writeFileSync(reportPath, report, "utf8");

  console.log("\n=== Pooled ===");
  for (const cond of CONDITIONS) {
    const subset = rows.filter((r) => r.condition === cond);
    console.log(cond, {
      avg: round1(avg(subset.map((r) => r.output_chars))),
      std: round1(stdDev(subset.map((r) => r.output_chars))),
    });
  }
  console.log(`\nReport: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
