/**
 * Causality variant audit — test-only prompt overlays (no production changes).
 *
 * BASE = current production prompts (reference)
 * A    = longer dialogue only
 * B    = denser narration paragraphs only
 * C    = continue past first stopping opportunity only
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-causality-variants.ts
 *   npx.cmd tsx scripts/audit-causality-variants.ts --variants=A,B,C
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import { analyzeOutput } from "./audit-output-compression-causes";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const TURNS = [2, 5, 8] as const;
const MODELS = [
  "google/gemini-2.5-pro",
  "qwen/qwen3.7-max",
  "deepseek/deepseek-v4-pro",
] as const;

const CONDITIONS = ["BASE", "A", "B", "C"] as const;
type Condition = (typeof CONDITIONS)[number];

const USER_MSG =
  "밤이 깊었어. 무서워서 손 잡아줄래? …다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.";

const VARIANT_A_LONG_DIALOGUE = `[TEST VARIANT A — LONGER DIALOGUE ONLY]
- When [A] speaks, each quoted utterance must be a developed line (~35+ characters of spoken content): subtext, tone, qualification — not a one-word tag.
- Do NOT add extra dialogue exchanges beyond what the scene needs.
- Do NOT lengthen narration blocks or add extra narration paragraphs to compensate.
- Handoff timing and paragraph density stay normal.`;

const VARIANT_B_DENSE_NARRATION = `[TEST VARIANT B — DENSE NARRATION PARAGRAPHS ONLY]
- Each narration block between dialogue must carry 4–6 complete sentences developing one coherent beat (action, sensation, internal read).
- Do NOT lengthen individual dialogue lines or add extra dialogue exchanges.
- Do NOT change when you end the turn — handoff and pause timing stay normal.`;

const VARIANT_C_CONTINUE_PAST_STOP = `[TEST VARIANT C — CONTINUE PAST FIRST STOPPING OPPORTUNITY ONLY]
- After the first natural pause point (first complete gesture, first handoff pause, first observer beat, or first spoken line), continue with at least two more in-scene beats before ending.
- Do NOT inflate dialogue line length or pack extra sentences into each narration paragraph — only extend the scene past the first stop opportunity.
- Still return agency to [B] eventually; no epilogue or time-skip.`;

function applyCondition(system: string, condition: Condition): string {
  if (condition === "BASE") return system;
  const supplement =
    condition === "A"
      ? VARIANT_A_LONG_DIALOGUE
      : condition === "B"
        ? VARIANT_B_DENSE_NARRATION
        : VARIANT_C_CONTINUE_PAST_STOP;
  return `${system.trim()}\n\n${supplement}`;
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
    userPersonaPrompt: formatSelectedPersonaForPrompt(persona, "other", "20대."),
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

type TurnLog = {
  condition: Condition;
  turn_number: number;
  model_id: string;
  action_count: number;
  dialogue_count: number;
  narration_paragraph_count: number;
  finish_reason: string | null;
  output_chars: number;
  paragraphs_total: number;
  ends_with_observer_verb: boolean;
  ending_type: string;
  last_line_preview: string;
  target_response_chars: number;
  timestamp: string;
};

function avg(nums: number[]) {
  if (!nums.length) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
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

function buildReport(rows: TurnLog[], conditions: Condition[]): string {
  const lines: string[] = [
    "=".repeat(72),
    "CAUSALITY VARIANT AUDIT REPORT",
    `generated: ${new Date().toISOString()}`,
    `samples: ${rows.length}`,
    "=".repeat(72),
    "",
    "BASE = production prompts | A = longer dialogue | B = dense narration | C = continue past first stop",
    "",
  ];

  const baseCond = conditions.includes("BASE") ? "BASE" : conditions[0];

  for (const model of MODELS) {
    lines.push(`## ${model}`);
    lines.push("");
    lines.push(
      "| Cond | avg chars | actions | dialogue | narr paras | finish_reason | ending_types |"
    );
    lines.push("|------|-----------|---------|----------|------------|---------------|--------------|");

    for (const c of conditions) {
      const s = summarize(rows, c, model);
      lines.push(
        `| ${c} | ${s.avg_output_chars} | ${s.avg_action_count} | ${s.avg_dialogue_count} | ${s.avg_narration_paragraph_count} | ${JSON.stringify(s.finish_reasons)} | ${JSON.stringify(s.ending_types)} |`
      );
    }

    if (conditions.includes("BASE")) {
      const base = summarize(rows, "BASE", model);
      for (const v of ["A", "B", "C"] as Condition[]) {
        if (!conditions.includes(v)) continue;
        const s = summarize(rows, v, model);
        lines.push(
          `  ${v}−BASE: chars ${s.avg_output_chars - base.avg_output_chars}, dlg ${s.avg_dialogue_count - base.avg_dialogue_count}, narr_paras ${s.avg_narration_paragraph_count - base.avg_narration_paragraph_count}, actions ${s.avg_action_count - base.avg_action_count}`
        );
      }
    }
    lines.push("");
  }

  lines.push("## Global averages (all models)");
  lines.push("");
  for (const c of conditions) {
    const subset = rows.filter((r) => r.condition === c);
    lines.push(
      `${c}: chars=${avg(subset.map((r) => r.output_chars))} actions=${avg(subset.map((r) => r.action_count))} dialogue=${avg(subset.map((r) => r.dialogue_count))} narr_paras=${avg(subset.map((r) => r.narration_paragraph_count))}`
    );
  }

  if (conditions.includes("BASE")) {
    lines.push("");
    lines.push("## Causality ranking (global Δ vs BASE)");
    const baseRows = rows.filter((r) => r.condition === "BASE");
    const baseChars = avg(baseRows.map((r) => r.output_chars));
    const deltas = (["A", "B", "C"] as Condition[])
      .filter((v) => conditions.includes(v))
      .map((v) => {
        const subset = rows.filter((r) => r.condition === v);
        return {
          variant: v,
          charDelta: avg(subset.map((r) => r.output_chars)) - baseChars,
          dlgDelta: avg(subset.map((r) => r.dialogue_count)) - avg(baseRows.map((r) => r.dialogue_count)),
          narrDelta:
            avg(subset.map((r) => r.narration_paragraph_count)) -
            avg(baseRows.map((r) => r.narration_paragraph_count)),
          actionDelta: avg(subset.map((r) => r.action_count)) - avg(baseRows.map((r) => r.action_count)),
        };
      })
      .sort((a, b) => b.charDelta - a.charDelta);

    for (const d of deltas) {
      lines.push(
        `  ${d.variant}: Δchars=${d.charDelta.toFixed(1)} Δdialogue=${d.dlgDelta.toFixed(1)} Δnarr_paras=${d.narrDelta.toFixed(1)} Δactions=${d.actionDelta.toFixed(1)}`
      );
    }
    const winner = deltas[0];
    if (winner) {
      lines.push("");
      lines.push(
        `Most causal for length: Variant ${winner.variant} (+${winner.charDelta.toFixed(0)} chars vs BASE)`
      );
      if (winner.variant === "A")
        lines.push("→ Longer dialogue lines appear causal for output length.");
      else if (winner.variant === "B")
        lines.push("→ Dense narration paragraphs appear causal for output length.");
      else if (winner.variant === "C")
        lines.push("→ Continuing past first stop opportunity appears causal for output length.");
    }
  }

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const variantsArg = args.find((a) => a.startsWith("--variants="));
  const conditions: Condition[] = variantsArg
    ? variantsArg
        .slice("--variants=".length)
        .split(",")
        .map((v) => v.trim().toUpperCase())
        .filter((v): v is Condition => CONDITIONS.includes(v as Condition))
    : [...CONDITIONS];

  const { buildContext } = await import("../src/services/contextBuilder");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(outDir, `causality-variant-audit-${stamp}.jsonl`);
  const reportPath = path.join(outDir, `causality-variant-audit-${stamp}.txt`);

  const rows: TurnLog[] = [];

  console.log("=== Causality variant audit ===");
  console.log("Models:", MODELS.join(", "));
  console.log("Conditions:", conditions.join(", "));
  console.log("Log:", logPath);

  for (const model_id of MODELS) {
    for (const condition of conditions) {
      for (const turn_number of TURNS) {
        const f = await fixture(turn_number);
        const built = buildContext({
          ...f,
          userNickname: f.personaDisplayName,
          assetTags: undefined,
          modelId: model_id,
          provider: "openrouter",
        });
        const system = applyCondition(built.systemPrompt, condition);

        console.log(`→ ${condition} t=${turn_number} ${model_id} …`);
        const result = await callOpenRouterAdult(
          system,
          [{ role: "user", content: f.currentUserMessage }],
          model_id,
          f.targetResponseChars,
          { charName: f.charName },
          { chargeTurnBudget: false, requestKind: `causality-audit-${condition}` }
        );

        const metrics = analyzeOutput(result.text);
        const displayChars = visibleAssistantDisplayCharCount(result.text);

        const row: TurnLog = {
          condition,
          turn_number,
          model_id,
          action_count: metrics.action_count,
          dialogue_count: metrics.dialogue_count,
          narration_paragraph_count: metrics.narration_paragraph_count,
          finish_reason: result.usage.finishReason ?? null,
          output_chars: displayChars,
          paragraphs_total: metrics.paragraphs_total,
          ends_with_observer_verb: metrics.ends_with_observer_verb,
          ending_type: metrics.ending_type,
          last_line_preview: metrics.last_line_preview,
          target_response_chars: f.targetResponseChars,
          timestamp: new Date().toISOString(),
        };
        rows.push(row);
        fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");

        console.log({
          condition,
          turn_number,
          output_chars: displayChars,
          action_count: metrics.action_count,
          dialogue_count: metrics.dialogue_count,
          narration_paragraph_count: metrics.narration_paragraph_count,
          finish_reason: row.finish_reason,
          ending_type: metrics.ending_type,
        });
      }
    }

    console.log(`\n--- Summary: ${model_id} ---`);
    for (const condition of conditions) {
      console.log(summarize(rows, condition, model_id));
    }
  }

  const report = buildReport(rows, conditions);
  fs.writeFileSync(reportPath, report, "utf8");
  console.log("\n" + report);
  console.log(`\nReport: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
