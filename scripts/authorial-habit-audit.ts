/**
 * AI 서술 습관 감사 (Authorial Habit Audit)
 * Usage:
 *   npm.cmd exec tsx -- scripts/authorial-habit-audit.ts
 *   npm.cmd exec tsx -- scripts/authorial-habit-audit.ts --generate   # fresh 30 if logs insufficient
 */
import "./lib/server-only-mock";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEnvLocal } from "./load-env-local";
import {
  analyzeAuthorialHabits,
  summarizeAuthorialHabits,
  AUTHORIAL_HABIT_PATTERNS,
  habitCategoryLabel,
  type HabitCategory,
} from "@/lib/authorialHabitAudit";

loadEnvLocal();

const OUT_MD = join(process.cwd(), "output", "authorial-habit-audit.md");
const OUT_JSON = join(process.cwd(), "output", "authorial-habit-audit.json");

const LOG_SOURCES = [
  { file: "step72-rp-validation.json", label: "Step 7.2 length recovery" },
  { file: "step55-rp-validation.json", label: "Step 5.5 production" },
  { file: "step7-rp-validation.json", label: "Step 7 compression" },
] as const;

type RawSample = { id: string; text: string; charCount?: number; source: string; sourceLabel: string };

function loadValidationLogs(minChars: number): RawSample[] {
  const out: RawSample[] = [];
  for (const { file, label } of LOG_SOURCES) {
    const p = join(process.cwd(), "output", file);
    if (!existsSync(p)) continue;
    const j = JSON.parse(readFileSync(p, "utf8")) as {
      samples?: { id: string; text: string; charCount?: number }[];
    };
    for (const s of j.samples ?? []) {
      const chars = s.charCount ?? s.text.length;
      if (chars < minChars) continue;
      out.push({
        id: `${label}:${s.id}`,
        text: s.text,
        charCount: chars,
        source: file,
        sourceLabel: label,
      });
    }
  }
  return out;
}

function rankPatterns(summary: ReturnType<typeof summarizeAuthorialHabits>) {
  const ids = AUTHORIAL_HABIT_PATTERNS.map((d) => d.id);
  return ids
    .map((id) => ({
      id,
      label: habitCategoryLabel(id),
      prevalence: summary.samplePrevalence[id],
      density: summary.meanDensityPer1k[id],
      total: summary.totalHits[id],
      score: summary.samplePrevalence[id] * 0.6 + summary.meanDensityPer1k[id] * 4,
    }))
    .sort((a, b) => b.score - a.score);
}

function buildMarkdown(
  allSamples: RawSample[],
  filtered: RawSample[],
  minChars: number,
  generatedFresh: boolean
): string {
  const metrics = filtered.map((s) => analyzeAuthorialHabits(s.id, s.sourceLabel, s.text));
  const summary = summarizeAuthorialHabits(metrics);
  const ranked = rankPatterns(summary);

  const lines: string[] = [
    "# AI 서술 습관 감사 (Authorial Habit Audit)",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Corpus",
    "",
    `- Sources: ${LOG_SOURCES.map((s) => s.file).join(", ")}`,
    `- Total loaded: ${allSamples.length} samples`,
    `- Analyzed (≥${minChars} chars): **${filtered.length}** samples, ${summary.totalChars.toLocaleString()} chars`,
    generatedFresh ? `- Fresh API generation: yes (+30)` : `- Fresh API generation: no (existing logs sufficient)`,
    "",
    "## Top patterns (ranked)",
    "",
    "| rank | pattern | samples w/ hit | mean /1k chars | total hits |",
    "|------|---------|----------------|----------------|------------|",
  ];

  ranked.slice(0, 8).forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${r.label} | ${r.prevalence}% | ${r.density} | ${r.total} |`
    );
  });

  lines.push("", "## Pattern detail", "");
  for (const r of ranked.slice(0, 6)) {
    const def = AUTHORIAL_HABIT_PATTERNS.find((d) => d.id === r.id)!;
    lines.push(`### ${r.label}`, "", def.description, "", `- Sample prevalence: **${r.prevalence}%**`);
    lines.push(`- Mean density: **${r.density}** hits / 1k chars`);
    lines.push(`- Total hits: ${r.total}`, "");
  }

  lines.push("## Turn ending tags (last ~120 chars)", "", "| tag | samples | rate |", "|-----|---------|------|");
  for (const e of summary.topEndingTags.slice(0, 8)) {
    lines.push(`| ${e.tag} | ${e.count} | ${e.sampleRate}% |`);
  }

  lines.push("", "## Repeated phrase lexicon", "", "| phrase | total hits | samples |", "|--------|------------|---------|");
  for (const p of summary.topRepeatedPhrases.slice(0, 12)) {
    lines.push(`| ${p.phrase} | ${p.totalCount} | ${p.sampleCount} |`);
  }

  lines.push("", "## Worst samples (habit density)", "", "| id | score | top habits |", "|----|-------|------------|");
  for (const w of summary.worstSamples) {
    lines.push(`| ${w.id} | ${w.score} | ${w.topHabits.join("; ")} |`);
  }

  lines.push("", "## Source breakdown", "");
  for (const src of LOG_SOURCES) {
    const sub = metrics.filter((m) => m.source === src.label);
    if (sub.length === 0) continue;
    const subSum = summarizeAuthorialHabits(sub);
    const top = rankPatterns(subSum)[0];
    lines.push(
      `- **${src.label}** (n=${sub.length}): top habit = ${top?.label ?? "—"} (${top?.prevalence ?? 0}% samples)`
    );
  }

  lines.push(
    "",
    "## Interpretation",
    "",
    "These are **model habits**, not missing prompt rules. High prevalence + high density = priority targets for few-shot negatives or post-gen trim — not new bullet rules unless a single owner block can absorb.",
    ""
  );

  return lines.join("\n");
}

async function generateFreshSamples(): Promise<RawSample[]> {
  const { callOpenRouterCompletion } = await import("@/lib/openRouterCompletion");
  const { buildContext } = await import("@/services/contextBuilder");
  const { buildProductionContextForScene } = await import("./lib/production-prompt-fixture");
  const { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } = await import("@/lib/chatModels");
  const { resolveDeepSeekTemperatureForTarget } = await import("@/lib/openRouterClient");
  type CharacterGenre = import("@/lib/characterGenres").CharacterGenre;

  const scenes: { id: string; genres: CharacterGenre[]; msg: string }[] = [
    ...(["현대/일상", "로맨스", "판타지/SF", "공포/추리", "코믹/액션", "무협/시대극"] as CharacterGenre[]).flatMap(
      (g, gi) =>
        [0, 1, 2, 3, 4].map((i) => ({
          id: `fresh-${gi}-${i}`,
          genres: [g],
          msg: [
            "…오늘 밤, 잠깐만 같이 걸을래?",
            "…방금 소리, 들었어?",
            "…저 문양, 전설에서 본 것 같은데.",
            "레온, 적이 검을 들어 올린다!",
            "…문 앞에 서 있는 자, 누구냐?",
            "민수: 오늘도 커피 맛있네.",
          ][gi]!,
        }))
    ),
  ].slice(0, 30);

  const out: RawSample[] = [];
  for (const scene of scenes) {
    const built = buildContext(
      buildProductionContextForScene({
        id: scene.id,
        label: scene.id,
        genres: scene.genres,
        currentUserMessage: scene.msg,
        shortTermHistory: [
          { role: "user", content: "…" },
          { role: "assistant", content: `백하율은 잠시 고개를 들었다.\n\n"…알겠습니다."` },
        ],
      })
    );
    console.log(`Generating ${scene.id}…`);
    const res = await callOpenRouterCompletion({
      system: built.systemPrompt,
      history: [...built.history.slice(0, -1), { role: "user", content: scene.msg }],
      model: OPENROUTER_DEEPSEEK_V4_PRO_MODEL,
      temperature: resolveDeepSeekTemperatureForTarget(3200),
      maxTokens: 4096,
      requestKind: "authorial-habit-audit",
    });
    const text = res.text.trim();
    out.push({
      id: scene.id,
      text,
      charCount: text.length,
      source: "fresh-api",
      sourceLabel: "Fresh API (Step 7.3 prompt)",
    });
    await new Promise((r) => setTimeout(r, 1500));
  }
  return out;
}

async function main() {
  const minChars = Number(process.argv.find((a) => a.startsWith("--min-chars="))?.split("=")[1] ?? 1200);
  const doGenerate = process.argv.includes("--generate");

  let all = loadValidationLogs(0);
  let filtered = loadValidationLogs(minChars);
  let generatedFresh = false;

  if (filtered.length < 40 && doGenerate) {
    if (!process.env.OPENROUTER_API_KEY) {
      console.warn("OPENROUTER_API_KEY missing — skipping --generate");
    } else {
      const fresh = await generateFreshSamples();
      all = [...all, ...fresh];
      filtered = [...filtered, ...fresh.filter((s) => (s.charCount ?? s.text.length) >= minChars)];
      generatedFresh = true;
    }
  }

  if (filtered.length === 0) {
    console.error("No samples — lower --min-chars or run with --generate");
    process.exit(1);
  }

  const metrics = filtered.map((s) => analyzeAuthorialHabits(s.id, s.sourceLabel, s.text));
  const summary = summarizeAuthorialHabits(metrics);
  const ranked = rankPatterns(summary);

  mkdirSync(join(process.cwd(), "output"), { recursive: true });
  writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        minChars,
        generatedFresh,
        corpus: { totalLoaded: all.length, analyzed: filtered.length, totalChars: summary.totalChars },
        rankedPatterns: ranked,
        summary,
        samples: metrics,
      },
      null,
      2
    )
  );
  writeFileSync(OUT_MD, buildMarkdown(all, filtered, minChars, generatedFresh));

  console.log(`Analyzed ${filtered.length} samples (≥${minChars} chars)`);
  console.log(`Report: ${OUT_MD}`);
  console.log("\nTop 5 habits:");
  for (const r of ranked.slice(0, 5)) {
    console.log(`  ${r.label}: ${r.prevalence}% samples, ${r.density}/1k`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
