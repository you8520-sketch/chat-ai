/**
 * Phase 8 — Fragmentation & Padding Audit under C-full conditions.
 *
 * Measurement only — production prompts unchanged.
 *
 * Compares production A vs C-full to quantify density vs dialogue fragmentation padding.
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-fragmentation.ts --runs=5
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import { analyzeOutput } from "./audit-output-compression-causes";
import { analyzeFragmentation } from "./lib/fragmentation-metrics";
import {
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

const CONDITIONS = ["A", "C-full"] as const;
type Condition = (typeof CONDITIONS)[number];

const USER_MSG =
  "밤이 깊었어. 무서워서 손 잡아줄래? …다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.";

const STRONG_LENGTH_OVERLAY = (aim: number, min80: number) =>
  `[LENGTH TARGET — MANDATORY (Phase 5 overlay C)]
TARGET: ${aim.toLocaleString()} Korean characters. Minimum acceptable before ending: ${min80.toLocaleString()} (80% of target).
Do NOT end before completing multiple meaningful in-scene beats.
Target length is MANDATORY, not aspirational.
Outputs below 80% of target length are INCOMPLETE — continue scene development until target scope is satisfied.`;

type TrackedSection = { id: string; text: string };

function applyLengthOverlay(
  productionLengthText: string,
  condition: Condition
): string {
  if (condition === "A") return productionLengthText;
  const aim = UNIFIED_TIER_AIM_CHARS;
  const min80 = Math.round(aim * 0.8);
  return `${productionLengthText}\n\n${STRONG_LENGTH_OVERLAY(aim, min80)}`;
}

function rebuildSystem(
  sections: TrackedSection[],
  condition: Condition,
  productionLengthText: string
): string {
  return sections
    .map((s) => {
      if (s.id !== "rule-length-control") return s.text;
      return applyLengthOverlay(productionLengthText, condition);
    })
    .join("\n\n");
}

type TurnLog = {
  condition: Condition;
  run_index: number;
  turn_number: number;
  model_id: string;
  output_chars: number;
  action_count: number;
  narration_paragraph_count: number;
  finish_reason: string | null;
  quote_count: number;
  avg_quote_chars: number;
  micro_quote_ratio: number;
  micro_quote_count: number;
  ping_pong_count: number;
  quotes_ge_6: boolean;
  total_quote_chars: number;
  total_narration_chars: number;
  quote_char_ratio: number;
  dense_narration_para_ratio: number;
  avg_narration_chars_per_para: number;
  fragmentation_score: number;
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

function summarize(rows: TurnLog[], condition: Condition, model_id?: string) {
  const subset = rows.filter(
    (r) =>
      r.condition === condition &&
      (model_id == null || r.model_id === model_id)
  );
  return {
    n: subset.length,
    avg_chars: round1(avg(subset.map((r) => r.output_chars))),
    std_chars: round1(stdDev(subset.map((r) => r.output_chars))),
    avg_quote_count: round1(avg(subset.map((r) => r.quote_count))),
    avg_quote_chars: round1(avg(subset.map((r) => r.avg_quote_chars))),
    avg_micro_ratio: round1(avg(subset.map((r) => r.micro_quote_ratio))),
    avg_ping_pong: round1(avg(subset.map((r) => r.ping_pong_count))),
    quotes_ge_6_rate: round1(
      subset.filter((r) => r.quotes_ge_6).length / (subset.length || 1)
    ),
    avg_quote_char_ratio: round1(avg(subset.map((r) => r.quote_char_ratio))),
    avg_dense_para_ratio: round1(avg(subset.map((r) => r.dense_narration_para_ratio))),
    avg_narr_chars_per_para: round1(
      avg(subset.map((r) => r.avg_narration_chars_per_para))
    ),
    avg_fragmentation_score: round1(avg(subset.map((r) => r.fragmentation_score))),
    avg_total_quote_chars: round1(avg(subset.map((r) => r.total_quote_chars))),
    avg_total_narr_chars: round1(avg(subset.map((r) => r.total_narration_chars))),
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
  const aPooled = summarize(rows, "A");
  const cPooled = summarize(rows, "C-full");
  const charGain = cPooled.avg_chars - aPooled.avg_chars;
  const quoteCharGain = cPooled.avg_total_quote_chars - aPooled.avg_total_quote_chars;
  const narrCharGain = cPooled.avg_total_narr_chars - aPooled.avg_total_narr_chars;

  const cFullByModel = MODELS.map((m) => ({
    model: m,
    ...summarize(rows, "C-full", m),
  })).sort((a, b) => b.avg_fragmentation_score - a.avg_fragmentation_score);

  const lines = [
    "# Phase 8 — Fragmentation & Padding Audit (C-full)",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Runs: ${runs} · turns ${TURNS.join("/")} · models: ${MODELS.join(", ")}`,
    `Log: ${logPath}`,
    "",
    "## Goal",
    "",
    "Under C-full (forced ~1400+ chars), how much length gain is dense narration vs dialogue fragmentation padding?",
    "",
    "## Pooled A vs C-full",
    "",
    "| Condition | avg chars | σ | quotes/turn | avg quote len | micro-quote % | ping-pong | ≥6 quotes % | dense para % | fragmentation score |",
    "|-----------|-----------|---|-------------|---------------|---------------|-----------|-------------|--------------|---------------------|",
    `| A | ${aPooled.avg_chars} | ${aPooled.std_chars} | ${aPooled.avg_quote_count} | ${aPooled.avg_quote_chars} | ${round1(aPooled.avg_micro_ratio * 100)}% | ${aPooled.avg_ping_pong} | ${round1(aPooled.quotes_ge_6_rate * 100)}% | ${round1(aPooled.avg_dense_para_ratio * 100)}% | ${aPooled.avg_fragmentation_score} |`,
    `| C-full | ${cPooled.avg_chars} | ${cPooled.std_chars} | ${cPooled.avg_quote_count} | ${cPooled.avg_quote_chars} | ${round1(cPooled.avg_micro_ratio * 100)}% | ${cPooled.avg_ping_pong} | ${round1(cPooled.quotes_ge_6_rate * 100)}% | ${round1(cPooled.avg_dense_para_ratio * 100)}% | ${cPooled.avg_fragmentation_score} |`,
  ];

  const quoteShareOfGain =
    charGain > 0 ? round1((quoteCharGain / charGain) * 100) : 0;
  const narrShareOfGain =
    charGain > 0 ? round1((narrCharGain / charGain) * 100) : 0;

  lines.push(
    "",
    "## Char gain decomposition (pooled A → C-full)",
    "",
    `- **Total char gain:** +${round1(charGain)} (Phase 7 ref ≈ +588)`,
    `- **Quote chars gain:** +${round1(quoteCharGain)} (${quoteShareOfGain}% of char gain)`,
    `- **Narration chars gain:** +${round1(narrCharGain)} (${narrShareOfGain}% of char gain)`,
    `- **Quote count gain:** +${round1(cPooled.avg_quote_count - aPooled.avg_quote_count)} per turn`,
    `- **Avg quote length change:** ${round1(cPooled.avg_quote_chars - aPooled.avg_quote_chars)} chars (shorter = more micro-quotes)`,
    `- **Ping-pong gain:** +${round1(cPooled.avg_ping_pong - aPooled.avg_ping_pong)} cycles/turn`,
    `- **Dense narration para ratio change:** ${round1((cPooled.avg_dense_para_ratio - aPooled.avg_dense_para_ratio) * 100)} pp`,
    "",
    quoteShareOfGain > narrShareOfGain
      ? "Quote character volume accounts for **more** of the C-full gain than narration — fragmentation padding is a **major** component."
      : "Narration character volume accounts for **more** of the C-full gain — gain is **primarily dense prose**, with secondary quote inflation.",
    "",
    "## C-full fragmentation ranking (by model)",
    "",
    "Higher fragmentation score = more reliance on micro-quotes, ping-pong, and quote volume.",
    "",
    "| Rank | Model | avg chars | fragmentation | avg quote len | micro-quote % | ping-pong | quotes/turn | ≥6 quotes % | dense para % |",
    "|------|-------|-----------|---------------|---------------|---------------|-----------|-------------|-------------|--------------|",
  );

  cFullByModel.forEach((m, i) => {
    lines.push(
      `| ${i + 1} | ${m.model.split("/").pop()} | ${m.avg_chars} | ${m.avg_fragmentation_score} | ${m.avg_quote_chars} | ${round1(m.avg_micro_ratio * 100)}% | ${m.avg_ping_pong} | ${m.avg_quote_count} | ${round1(m.quotes_ge_6_rate * 100)}% | ${round1(m.avg_dense_para_ratio * 100)}% |`
    );
  });

  lines.push("", "## Per model A → C-full delta", "");
  for (const model of MODELS) {
    const a = summarize(rows, "A", model);
    const c = summarize(rows, "C-full", model);
    const dChars = c.avg_chars - a.avg_chars;
    const dQuoteChars = c.avg_total_quote_chars - a.avg_total_quote_chars;
    const dNarrChars = c.avg_total_narr_chars - a.avg_total_narr_chars;
    lines.push(
      `### ${model}`,
      "",
      `- chars: ${a.avg_chars} → ${c.avg_chars} (Δ +${round1(dChars)})`,
      `- quote chars: ${a.avg_total_quote_chars} → ${c.avg_total_quote_chars} (${round1((dQuoteChars / (dChars || 1)) * 100)}% of char Δ)`,
      `- narr chars: ${a.avg_total_narr_chars} → ${c.avg_total_narr_chars} (${round1((dNarrChars / (dChars || 1)) * 100)}% of char Δ)`,
      `- quotes/turn: ${a.avg_quote_count} → ${c.avg_quote_count}`,
      `- avg quote len: ${a.avg_quote_chars} → ${c.avg_quote_chars}`,
      `- micro-quote %: ${round1(a.avg_micro_ratio * 100)}% → ${round1(c.avg_micro_ratio * 100)}%`,
      `- ping-pong: ${a.avg_ping_pong} → ${c.avg_ping_pong}`,
      `- fragmentation score: ${a.avg_fragmentation_score} → ${c.avg_fragmentation_score}`,
      "",
    );
  }

  lines.push("## finish_reason", "");
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
  const logPath = path.join(outDir, `fragmentation-audit-${stamp}.jsonl`);
  const reportPath = path.join(outDir, `fragmentation-audit-${stamp}.md`);

  const rows: TurnLog[] = [];
  const totalCalls = runs * CONDITIONS.length * MODELS.length * TURNS.length;

  console.log("=== Phase 8: Fragmentation & Padding Audit ===");
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
          const productionLength = buildLengthInstruction(f.targetResponseChars, lengthOpts);
          const system = rebuildSystem(sections, condition, productionLength);

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
                  requestKind: `phase8-${condition}-r${run_index}`,
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
          const frag = analyzeFragmentation(result.text);
          const row: TurnLog = {
            condition,
            run_index,
            turn_number,
            model_id,
            output_chars: visibleAssistantDisplayCharCount(result.text),
            action_count: metrics.action_count,
            narration_paragraph_count: metrics.narration_paragraph_count,
            finish_reason: result.usage.finishReason ?? null,
            quote_count: frag.quote_count,
            avg_quote_chars: frag.avg_quote_chars,
            micro_quote_ratio: frag.micro_quote_ratio,
            micro_quote_count: frag.micro_quote_count,
            ping_pong_count: frag.ping_pong_count,
            quotes_ge_6: frag.quotes_ge_6,
            total_quote_chars: frag.total_quote_chars,
            total_narration_chars: frag.total_narration_chars,
            quote_char_ratio: frag.quote_char_ratio,
            dense_narration_para_ratio: frag.dense_narration_para_ratio,
            avg_narration_chars_per_para: frag.avg_narration_chars_per_para,
            fragmentation_score: frag.fragmentation_score,
            timestamp: new Date().toISOString(),
          };
          rows.push(row);
          fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
          console.log({
            chars: row.output_chars,
            quotes: row.quote_count,
            avgQuote: row.avg_quote_chars,
            microPct: round1(row.micro_quote_ratio * 100),
            pingPong: row.ping_pong_count,
            fragScore: row.fragmentation_score,
          });
        }
      }
    }
  }

  const report = buildReport(rows, runs, logPath);
  fs.writeFileSync(reportPath, report, "utf8");
  console.log(`\nReport: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
