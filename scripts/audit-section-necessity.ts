/**
 * Phase 3 — Rule Necessity Audit (overlay removal, production unchanged).
 *
 * For each candidate section: baseline vs that section fully removed from assembled prompt.
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-section-necessity.ts
 *   npx.cmd tsx scripts/audit-section-necessity.ts --candidates=narrative-style,rule-prose-guard
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import { estimateTokens } from "../src/lib/tokenEstimate";
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

/** trackedSections ids — one removed per overlay variant */
const REMOVAL_CANDIDATES = [
  { id: "narrative-style", label: "narrative-style" },
  { id: "rule-prose-guard", label: "rule-prose-guard" },
  { id: "openrouter-lang-critical", label: "openrouter-lang-critical" },
  { id: "user-persona-narration-rules", label: "user-persona-narration" },
  { id: "user-persona-speech-guard", label: "user-persona-speech-guard" },
] as const;

type Condition = "BASELINE" | `MINUS_${string}`;

type TurnLog = {
  condition: Condition;
  removed_section_id: string | null;
  turn_number: number;
  model_id: string;
  output_chars: number;
  action_count: number;
  dialogue_count: number;
  narration_paragraph_count: number;
  ending_type: string;
  finish_reason: string | null;
  ends_with_observer_verb: boolean;
  section_tokens_removed: number;
  timestamp: string;
};

function avg(nums: number[]) {
  if (nums.length === 0) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
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

function rebuildSystemWithoutSection(
  sections: { id: string; text: string }[],
  excludeId: string | null
): string {
  return sections
    .filter((s) => excludeId == null || s.id !== excludeId)
    .map((s) => s.text)
    .join("\n\n");
}

function sectionTokens(sections: { id: string; text: string }[], id: string): number {
  const s = sections.find((x) => x.id === id);
  return s ? estimateTokens(s.text) : 0;
}

function summarize(rows: TurnLog[], condition: Condition, model: string) {
  const subset = rows.filter((r) => r.condition === condition && r.model_id === model);
  return {
    condition,
    model_id: model,
    n: subset.length,
    avg_output_chars: avg(subset.map((r) => r.output_chars)),
    avg_action_count: avg(subset.map((r) => r.action_count)),
    avg_dialogue_count: avg(subset.map((r) => r.dialogue_count)),
    avg_narration_paragraph_count: avg(subset.map((r) => r.narration_paragraph_count)),
    observer_ending_rate: subset.filter((r) => r.ends_with_observer_verb).length / (subset.length || 1),
    ending_types: Object.fromEntries(
      [...new Set(subset.map((r) => r.ending_type))].map((t) => [
        t,
        subset.filter((r) => r.ending_type === t).length,
      ])
    ),
    finish_reasons: Object.fromEntries(
      [...new Set(subset.map((r) => r.finish_reason ?? "null"))].map((t) => [
        t,
        subset.filter((r) => (r.finish_reason ?? "null") === t).length,
      ])
    ),
  };
}

type NecessityClass = "A" | "B" | "C";

function classifyRemoval(
  baseline: ReturnType<typeof summarize>,
  minus: ReturnType<typeof summarize>,
  tokensSaved: number
): { cls: NecessityClass; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const charDelta = minus.avg_output_chars - baseline.avg_output_chars;
  const actionDelta = minus.avg_action_count - baseline.avg_action_count;
  const dlgDelta = minus.avg_dialogue_count - baseline.avg_dialogue_count;
  const narrDelta = minus.avg_narration_paragraph_count - baseline.avg_narration_paragraph_count;

  if (minus.observer_ending_rate > baseline.observer_ending_rate) {
    score += 3;
    reasons.push(`observer endings ${baseline.observer_ending_rate}→${minus.observer_ending_rate}`);
  }
  if (Math.abs(charDelta) >= 120) {
    score += 2;
    reasons.push(`chars Δ${charDelta >= 0 ? "+" : ""}${charDelta.toFixed(0)}`);
  } else if (Math.abs(charDelta) >= 60) {
    score += 1;
    reasons.push(`chars Δ${charDelta >= 0 ? "+" : ""}${charDelta.toFixed(0)} (moderate)`);
  }
  if (Math.abs(actionDelta) >= 5) {
    score += 1;
    reasons.push(`actions Δ${actionDelta >= 0 ? "+" : ""}${actionDelta.toFixed(1)}`);
  }
  if (Math.abs(dlgDelta) >= 1.5) {
    score += 1;
    reasons.push(`dialogue Δ${dlgDelta >= 0 ? "+" : ""}${dlgDelta.toFixed(1)}`);
  }
  if (Math.abs(narrDelta) >= 1.5) {
    score += 1;
    reasons.push(`narr paras Δ${narrDelta >= 0 ? "+" : ""}${narrDelta.toFixed(1)}`);
  }

  const endingChanged =
    Object.keys(baseline.ending_types).sort().join() !==
    Object.keys(minus.ending_types).sort().join();
  if (endingChanged) {
    score += 1;
    reasons.push("ending_type mix shifted");
  }

  let cls: NecessityClass;
  if (score >= 3) cls = "A";
  else if (score >= 1) cls = "B";
  else cls = "C";

  if (reasons.length === 0) reasons.push("metrics within audit noise band");

  return { cls, reasons };
}

function aggregateClass(perModel: NecessityClass[]): NecessityClass {
  if (perModel.includes("A")) return "A";
  if (perModel.includes("B")) return "B";
  return "C";
}

async function main() {
  const args = process.argv.slice(2);
  const modelsArg = args.find((a) => a.startsWith("--models="));
  const candidatesArg = args.find((a) => a.startsWith("--candidates="));
  const models = modelsArg
    ? modelsArg.slice("--models=".length).split(",").map((m) => m.trim()).filter(Boolean)
    : DEFAULT_MODELS;

  let candidates = [...REMOVAL_CANDIDATES];
  if (candidatesArg) {
    const ids = new Set(candidatesArg.slice("--candidates=".length).split(",").map((s) => s.trim()));
    candidates = REMOVAL_CANDIDATES.filter((c) => ids.has(c.id) || ids.has(c.label));
  }

  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(outDir, `section-necessity-audit-${stamp}.jsonl`);
  const reportPath = path.join(outDir, `section-necessity-audit-${stamp}.md`);

  const rows: TurnLog[] = [];
  const conditions: { condition: Condition; removeId: string | null }[] = [
    { condition: "BASELINE", removeId: null },
    ...candidates.map((c) => ({
      condition: `MINUS_${c.id}` as Condition,
      removeId: c.id,
    })),
  ];

  console.log("=== Phase 3: Rule Necessity Audit (section removal overlay) ===");
  console.log("Models:", models.join(", "));
  console.log("Turns:", TURNS.join(", "));
  console.log("Candidates:", candidates.map((c) => c.id).join(", "));
  console.log("Log:", logPath);

  for (const model_id of models) {
    for (const { condition, removeId } of conditions) {
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
        const system = rebuildSystemWithoutSection(sections, removeId);
        const removedTok = removeId ? sectionTokens(sections, removeId) : 0;

        if (removeId && !sections.some((s) => s.id === removeId)) {
          console.warn(`⚠ section ${removeId} not in prompt for t=${turn_number}`);
        }

        console.log(`\n→ ${condition} t=${turn_number} ${model_id} (−${removedTok} tok) …`);
        const result = await callOpenRouterAdult(
          system,
          [{ role: "user", content: f.currentUserMessage }],
          model_id,
          f.targetResponseChars,
          { charName: f.charName },
          { chargeTurnBudget: false, requestKind: `section-necessity-${condition}` }
        );

        const metrics = analyzeOutput(result.text);
        const row: TurnLog = {
          condition,
          removed_section_id: removeId,
          turn_number,
          model_id,
          output_chars: visibleAssistantDisplayCharCount(result.text),
          action_count: metrics.action_count,
          dialogue_count: metrics.dialogue_count,
          narration_paragraph_count: metrics.narration_paragraph_count,
          ending_type: metrics.ending_type,
          finish_reason: result.usage.finishReason ?? null,
          ends_with_observer_verb: metrics.ends_with_observer_verb,
          section_tokens_removed: removedTok,
          timestamp: new Date().toISOString(),
        };
        rows.push(row);
        fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
        console.log(row);
      }
    }
  }

  const baselineRows = rows.filter((r) => r.condition === "BASELINE");
  const baselineSystemTok = avg(
    [...new Set(baselineRows.map((r) => `${r.model_id}:${r.turn_number}`))].map((key) => {
      const [model_id, turnStr] = key.split(":");
      const turn_number = Number(turnStr);
      return rows.find(
        (r) => r.condition === "BASELINE" && r.model_id === model_id && r.turn_number === turn_number
      )?.output_chars ?? 0;
    })
  );

  void baselineSystemTok;

  console.log("\n=== Per-section summary (aggregated across models) ===\n");

  type RankRow = {
    section_id: string;
    label: string;
    tokens_saved: number;
    aggregate_class: NecessityClass;
    per_model: Record<
      string,
      {
        class: NecessityClass;
        reasons: string[];
        baseline: ReturnType<typeof summarize>;
        minus: ReturnType<typeof summarize>;
        char_delta: number;
      }
    >;
    avg_char_delta_all_models: number;
    max_abs_char_delta: number;
  };

  const rankings: RankRow[] = [];

  for (const cand of candidates) {
    const cond = `MINUS_${cand.id}` as Condition;
    const tokSample = rows.find((r) => r.condition === cond)?.section_tokens_removed ?? 0;

    const perModel: RankRow["per_model"] = {};
    const charDeltas: number[] = [];

    for (const model_id of models) {
      const base = summarize(rows, "BASELINE", model_id);
      const minus = summarize(rows, cond, model_id);
      const { cls, reasons } = classifyRemoval(base, minus, tokSample);
      const charDelta = minus.avg_output_chars - base.avg_output_chars;
      charDeltas.push(charDelta);
      perModel[model_id] = {
        class: cls,
        reasons,
        baseline: base,
        minus,
        char_delta: charDelta,
      };
      console.log(`--- ${cand.id} · ${model_id} ---`);
      console.log("BASELINE:", base);
      console.log("MINUS:", minus);
      console.log(`Class: ${cls} — ${reasons.join("; ")}`);
    }

    const aggregate_class = aggregateClass(Object.values(perModel).map((p) => p.class));
    rankings.push({
      section_id: cand.id,
      label: cand.label,
      tokens_saved: tokSample,
      aggregate_class,
      per_model: perModel,
      avg_char_delta_all_models: avg(charDeltas),
      max_abs_char_delta: Math.max(...charDeltas.map((d) => Math.abs(d)), 0),
    });
  }

  rankings.sort((a, b) => {
    const impactA = a.aggregate_class === "A" ? 3 : a.aggregate_class === "B" ? 2 : 1;
    const impactB = b.aggregate_class === "A" ? 3 : b.aggregate_class === "B" ? 2 : 1;
    if (impactA !== impactB) return impactA - impactB;
    return b.tokens_saved - a.tokens_saved;
  });

  console.log("\n=== Ranked: tokens saved vs behavior impact (best removal candidates first) ===\n");
  for (const r of rankings) {
    console.log(
      `${r.aggregate_class} | −${r.tokens_saved} tok | ${r.section_id} | avg chars Δ${r.avg_char_delta_all_models >= 0 ? "+" : ""}${r.avg_char_delta_all_models} | max |Δchars| ${r.max_abs_char_delta}`
    );
  }

  const md: string[] = [
    `# Phase 3 — Rule Necessity Audit`,
    ``,
    `> Generated: ${new Date().toISOString()}`,
    `> Fixture: mock 백하율/렌 NSFW t=2/5/8 · models: ${models.join(", ")}`,
    `> Log: \`${path.basename(logPath)}\``,
    ``,
    `## Classification`,
    `- **A** = behavior-critical (do not remove)`,
    `- **B** = useful but redundant (optional trim)`,
    `- **C** = removable (safe to drop section entirely)`,
    ``,
    `## Ranked by removal priority (C first, high tokens, low impact)`,
    ``,
    `| Rank | Section | Tokens saved | Class | Avg Δ chars (all models) | Max |Δchars| |`,
    `|------|---------|--------------|-------|--------------------------|---------------|`,
  ];

  rankings.forEach((r, i) => {
    md.push(
      `| ${i + 1} | \`${r.section_id}\` | ~${r.tokens_saved} | **${r.aggregate_class}** | ${r.avg_char_delta_all_models >= 0 ? "+" : ""}${r.avg_char_delta_all_models} | ${r.max_abs_char_delta} |`
    );
  });

  md.push(``, `## Detail per section`, ``);

  for (const r of rankings) {
    md.push(`### ${r.section_id} (${r.aggregate_class})`, ``);
    md.push(`Estimated tokens if removed: **~${r.tokens_saved}**`, ``);
    for (const model_id of models) {
      const p = r.per_model[model_id];
      md.push(`#### ${model_id}`, ``);
      md.push(`| Metric | BASELINE | MINUS | Δ |`);
      md.push(`|--------|----------|-------|---|`);
      md.push(
        `| avg chars | ${p.baseline.avg_output_chars} | ${p.minus.avg_output_chars} | ${p.char_delta >= 0 ? "+" : ""}${p.char_delta} |`
      );
      md.push(
        `| actions | ${p.baseline.avg_action_count} | ${p.minus.avg_action_count} | ${(p.minus.avg_action_count - p.baseline.avg_action_count).toFixed(1)} |`
      );
      md.push(
        `| dialogue | ${p.baseline.avg_dialogue_count} | ${p.minus.avg_dialogue_count} | ${(p.minus.avg_dialogue_count - p.baseline.avg_dialogue_count).toFixed(1)} |`
      );
      md.push(
        `| narr paras | ${p.baseline.avg_narration_paragraph_count} | ${p.minus.avg_narration_paragraph_count} | ${(p.minus.avg_narration_paragraph_count - p.baseline.avg_narration_paragraph_count).toFixed(1)} |`
      );
      md.push(
        `| observer rate | ${p.baseline.observer_ending_rate} | ${p.minus.observer_ending_rate} | |`
      );
      md.push(`| ending types | ${JSON.stringify(p.baseline.ending_types)} | ${JSON.stringify(p.minus.ending_types)} | |`);
      md.push(`| finish | ${JSON.stringify(p.baseline.finish_reasons)} | ${JSON.stringify(p.minus.finish_reasons)} | |`);
      md.push(``, `Per-model class: **${p.class}** — ${p.reasons.join("; ")}`, ``);
    }
  }

  fs.writeFileSync(reportPath, md.join("\n"), "utf8");
  console.log(`\nReport: ${reportPath}`);
  console.log(`Full log: ${logPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
