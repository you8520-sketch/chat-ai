/**
 * Phase 10 — Dynamic prose styling lean audit (9 API calls).
 *
 * Usage:
 *   npx.cmd tsx scripts/audit-dynamic-prose-phase10.ts
 */
import fs from "fs";
import path from "path";
import { loadEnvLocal } from "./load-env-local";
import { analyzeOutput } from "./audit-output-compression-causes";
import { DYNAMIC_PROSE_STYLING_BLOCK } from "../src/lib/writingStylePreset";

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const TURNS = [5] as const;
const MODELS = [
  "google/gemini-2.5-pro",
  "qwen/qwen3.7-max",
  "deepseek/deepseek-v4-pro",
] as const;
const RUNS = 3;

const USER_MSG =
  "밤이 깊었어. 무서워서 손 잡아줄래? …다 알아요, 내 몸이 원하는 거 알아? 천천히 해줘.";

const ENV_CINEMATIC =
  /(?:소음|빛|공기|그림자|문|창|침대|손끝|걸음|시선|결단|주변|환경|침묵|어둠)/;
const EXPLICIT_SENSORY =
  /(?:성기|음경|귀두|질|내벽|항문|젖|유두|클리|보지|자지|마찰|촉각|삽입|절정|신음)/;
const STICKY_PADDING = /(?:체온|호흡|숨결).{0,20}(?:체온|호흡|숨결)/;

type TurnLog = {
  run_index: number;
  turn_number: number;
  model_id: string;
  output_chars: number;
  action_count: number;
  narration_paragraph_count: number;
  finish_reason: string | null;
  env_cinematic_hits: number;
  explicit_sensory_hits: number;
  sticky_padding: boolean;
  text_preview: string;
  timestamp: string;
};

function avg(nums: number[]) {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

function countMatches(text: string, re: RegExp) {
  return (text.match(re) ?? []).length;
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

function buildReport(rows: TurnLog[], logPath: string): string {
  const lines = [
    "# Phase 10 — Dynamic Prose Styling Lean Audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Runs: ${RUNS} · turns 5 · models: ${MODELS.join(", ")}`,
    `Log: ${logPath}`,
    "",
    "## Injected block (exact)",
    "",
    "```",
    DYNAMIC_PROSE_STYLING_BLOCK,
    "```",
    "",
    "## avg chars per model",
    "",
    "| Model | avg chars | actions | narr paras | env/cinematic hits | explicit sensory hits | sticky padding |",
    "|-------|-----------|---------|------------|--------------------|-----------------------|----------------|",
  ];

  for (const model of MODELS) {
    const s = rows.filter((r) => r.model_id === model);
    lines.push(
      `| ${model.split("/").pop()} | ${round1(avg(s.map((r) => r.output_chars)))} | ${round1(avg(s.map((r) => r.action_count)))} | ${round1(avg(s.map((r) => r.narration_paragraph_count)))} | ${round1(avg(s.map((r) => r.env_cinematic_hits)))} | ${round1(avg(s.map((r) => r.explicit_sensory_hits)))} | ${s.filter((r) => r.sticky_padding).length}/${s.length} |`
    );
  }

  lines.push(
    "",
    `Pooled avg chars: ${round1(avg(rows.map((r) => r.output_chars)))}`,
    "",
    "## Qualitative notes",
    "",
    "NSFW fixture user message requests intimacy — outputs should show **explicit sensory** density (mode B) while build-up paragraphs may still use environment/action (mode A).",
    "",
    "Sticky padding = repeated 체온/호흡/숨결 within 20 chars — should be rare with dynamic styling.",
    ""
  );

  for (const model of MODELS) {
    lines.push(`### ${model}`, "");
    for (const r of rows.filter((x) => x.model_id === model)) {
      lines.push(
        `- run ${r.run_index}: ${r.output_chars} chars · env ${r.env_cinematic_hits} · explicit ${r.explicit_sensory_hits} · sticky ${r.sticky_padding}`,
        `  preview: ${r.text_preview.slice(0, 200).replace(/\n/g, " ")}…`,
        ""
      );
    }
  }

  const explicitAvg = avg(rows.map((r) => r.explicit_sensory_hits));
  lines.push(
    explicitAvg >= 2
      ? "Outputs show explicit sensory vocabulary appropriate to NSFW user prompt (mode B engaged)."
      : "Low explicit sensory hit rate — review whether mode B is under-triggered despite NSFW prompt."
  );

  return lines.join("\n");
}

async function main() {
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const { visibleAssistantDisplayCharCount } = await import("../src/lib/chatDisplayLength");
  const { buildContext } = await import("../src/services/contextBuilder");

  const outDir = path.join(process.cwd(), "output");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logPath = path.join(outDir, `dynamic-prose-phase10-lean-${stamp}.jsonl`);
  const reportPath = path.join(outDir, `dynamic-prose-phase10-lean-${stamp}.md`);

  const rows: TurnLog[] = [];
  console.log("API calls:", RUNS * MODELS.length * TURNS.length);
  console.log("Dynamic block in prompt:", DYNAMIC_PROSE_STYLING_BLOCK.slice(0, 80) + "…");

  for (const model_id of MODELS) {
    for (let run_index = 1; run_index <= RUNS; run_index++) {
      for (const turn_number of TURNS) {
        const f = await fixture(turn_number);
        const built = buildContext({
          ...f,
          userNickname: f.personaDisplayName,
          assetTags: undefined,
          modelId: model_id,
          provider: "openrouter",
        });
        console.log(`\n→ run ${run_index}/${RUNS} t=${turn_number} ${model_id}`);
        const result = await callOpenRouterAdult(
          built.systemPrompt,
          [{ role: "user", content: f.currentUserMessage }],
          model_id,
          f.targetResponseChars,
          { charName: f.charName },
          { chargeTurnBudget: false, requestKind: `phase10-r${run_index}` }
        );
        const metrics = analyzeOutput(result.text);
        const row: TurnLog = {
          run_index,
          turn_number,
          model_id,
          output_chars: visibleAssistantDisplayCharCount(result.text),
          action_count: metrics.action_count,
          narration_paragraph_count: metrics.narration_paragraph_count,
          finish_reason: result.usage.finishReason ?? null,
          env_cinematic_hits: countMatches(result.text, ENV_CINEMATIC),
          explicit_sensory_hits: countMatches(result.text, EXPLICIT_SENSORY),
          sticky_padding: STICKY_PADDING.test(result.text),
          text_preview: result.text.slice(0, 600),
          timestamp: new Date().toISOString(),
        };
        rows.push(row);
        fs.appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf8");
        console.log({
          chars: row.output_chars,
          env: row.env_cinematic_hits,
          explicit: row.explicit_sensory_hits,
          sticky: row.sticky_padding,
        });
      }
    }
  }

  fs.writeFileSync(reportPath, buildReport(rows, logPath), "utf8");
  console.log(`\nReport: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
