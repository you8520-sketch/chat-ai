/**
 * HEAD 복원 후 Qwen / Gemini 3.1 Pro 출력 길이 검증 (각 3회).
 * Usage: npx.cmd tsx scripts/verify-qwen-gemini-length-head.ts [--runs=2]
 */
import fs from "fs";
import path from "path";
import Module from "module";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import { getDatabasePath } from "../src/lib/dataDir";
import { estimateTokens } from "../src/lib/tokenEstimate";
import {
  OPENROUTER_GEMINI_31_PRO_MODEL,
  OPENROUTER_QWEN_37_MAX_MODEL,
} from "../src/lib/chatModels";

const origLoad = Module._load;
// @ts-expect-error legacy hook
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  // @ts-expect-error legacy
  return origLoad(request, parent, isMain);
};

loadEnvLocal();
process.env.MOCK_MODE = "false";
if (!process.env.NODE_ENV) (process.env as Record<string, string>).NODE_ENV = "development";

const MODELS = [
  { id: OPENROUTER_QWEN_37_MAX_MODEL, label: "Qwen 3.7 Max" },
  { id: OPENROUTER_GEMINI_31_PRO_MODEL, label: "Gemini 3.1 Pro" },
] as const;

const RUNS = (() => {
  const arg = process.argv.find((a) => a.startsWith("--runs="));
  if (arg) return Math.max(1, Number(arg.split("=")[1]) || 3);
  return 3;
})();
const TARGET_CHARS = 3300;
const FLOOR = 3000;
const FIXED_DEPTH = 6;
const DELAY_MS = 5000;
const USER_MESSAGE =
  "정말 고장났나봐.... 나랑 떨어져야되는거아니야?? 렌은 엘리베이터 안에서 숨을 고르며 백하율의 표정을 읽었다.";

type Sample = {
  model: string;
  label: string;
  run: number;
  output_chars: number;
  floor_pass: boolean;
  finish_reason: string;
  completion_tokens: number;
  history_tokens: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function displayProse(c: string): string {
  let s = c ?? "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  return s.trim();
}

function loadHistoryTemplates(): { user: string; assistant: string }[] {
  const db = new Database(getDatabasePath(), { readonly: true });
  const rows = db
    .prepare(
      `SELECT content FROM messages WHERE role='assistant' AND LENGTH(content)>2500 ORDER BY id DESC LIMIT 12`
    )
    .all() as { content: string }[];
  db.close();
  const templates: { user: string; assistant: string }[] = [];
  const userAlts = [
    "자동진행",
    "…여기 오래 갇혀 있었어?",
    "가이드님… 무서워.",
    "손 잡아줄래?",
    "이대로 계속 있어도 괜찮아?",
    "떨어지면 어떡해…",
  ];
  for (let i = 0; i < rows.length && templates.length < 8; i++) {
    let s = rows[i].content;
    const idx = s.search(/<<<STATUS/i);
    if (idx >= 0) s = s.slice(0, idx);
    const prose = s.trim();
    if (prose.length < 800) continue;
    templates.push({
      user: userAlts[templates.length % userAlts.length],
      assistant: prose.slice(0, Math.min(prose.length, 4500)),
    });
  }
  return templates;
}

function buildHistoryMessages(
  templates: { user: string; assistant: string }[],
  modelId: string
) {
  const pairs = FIXED_DEPTH / 2;
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let i = 0; i < pairs; i++) {
    const t = templates[i % templates.length];
    messages.push({ role: "user", content: t.user });
    messages.push({ role: "assistant", content: t.assistant });
  }
  return messages;
}

async function buildFixture(modelId: string) {
  const { messagesToTurns, rawRecentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const templates = loadHistoryTemplates();
  const historyMessages = buildHistoryMessages(templates, modelId);
  const turns = messagesToTurns(
    [...historyMessages, { role: "user", content: USER_MESSAGE, model: "assistant" }].map((m) => ({
      ...m,
      model: "assistant",
    }))
  );
  const historyRaw = rawRecentTurnsToHistory(
    turns,
    0,
    resolveRawRecentTurnWindowForHistory(modelId, "openrouter", turns.length)
  );

  const charName = "백하율";
  const persona = "렌";
  const chunks = parseCharacterSetting({
    characterId: "vg-1",
    characterName: charName,
    gender: "male",
    systemPrompt: `# 성격\n차분.`,
    world: `# 세계관\n현대.`,
    exampleDialog: `유저: hi\n${charName}: …`,
    statusWindowPrompt: "",
  });
  const built = buildContext({
    charName,
    chunks,
    userNickname: persona,
    userPersona: formatSelectedPersonaForPrompt(persona, "other", "20대."),
    userNote: formatUserNoteForPrompt("검증", persona),
    longTermMemory: "[요약] 엘리베이터에서 긴장된 분위기가 이어졌다.",
    shortTermHistory: historyRaw,
    currentUserMessage: USER_MESSAGE,
    nsfw: true,
    gender: "male",
    memoryMeta: formatMemoryMetaForPrompt(parseMemoryMeta('{"relationship":"acquaintance"}')),
    modelId,
    provider: "openrouter",
    personaDisplayName: persona,
    targetResponseChars: TARGET_CHARS,
    completedTurns: FIXED_DEPTH,
    userPersonaGender: "other",
    statusWidgetActive: false,
  });

  const split = built.openRouterSystemSplit!;
  const history = built.history
    .slice(0, -1)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  const audit = built.meta.promptAudit;

  return {
    charName,
    history,
    split,
    historyTokens: audit?.historyTokens ?? 0,
  };
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, `verify-qwen-gemini-length-${RUNS}runs.jsonl`);
  const reportPath = path.join(outDir, `verify-qwen-gemini-length-${RUNS}runs-report.txt`);
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  fs.writeFileSync(jsonlPath, "", "utf8");
  const samples: Sample[] = [];
  const head = await import("child_process").then((cp) =>
    cp.execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim()
  );

  console.log(`HEAD=${head} · models=${MODELS.length} · runs=${RUNS} · floor=${FLOOR}ch`);

  for (const { id: modelId, label } of MODELS) {
    console.log(`\n=== ${label} (${modelId}) ===`);
    const ctx = await buildFixture(modelId);
    const system = [ctx.split.systemRulesBlock, ctx.split.characterSettingsBlock, ctx.split.dynamicBlock]
      .filter(Boolean)
      .join("\n\n");
    console.log(`  history_tokens=${ctx.historyTokens}`);

    for (let run = 1; run <= RUNS; run++) {
      await sleep(DELAY_MS);
      process.stdout.write(`  run ${run}/${RUNS}...`);
      const result = await callOpenRouterAdult(
        system,
        [...ctx.history, { role: "user", content: USER_MESSAGE }],
        modelId,
        TARGET_CHARS,
        { charName: ctx.charName, systemSplit: ctx.split },
        { chargeTurnBudget: false, requestKind: "verify-qwen-gemini-length-head" }
      );
      const prose = displayProse(result.text);
      const sample: Sample = {
        model: modelId,
        label,
        run,
        output_chars: prose.length,
        floor_pass: prose.length >= FLOOR,
        finish_reason: String(result.usage?.finishReason ?? "unknown"),
        completion_tokens: Number(result.usage?.completionTokens ?? 0),
        history_tokens: ctx.historyTokens,
      };
      samples.push(sample);
      fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");
      console.log(
        ` out=${sample.output_chars}ch pass=${sample.floor_pass} finish=${sample.finish_reason} compTok=${sample.completion_tokens}`
      );
    }
  }

  const lines: string[] = [
    "VERIFY QWEN + GEMINI 3.1 LENGTH (HEAD restore)",
    `generated: ${new Date().toISOString()}`,
    `HEAD: ${head}`,
    `floor: ${FLOOR} chars · target: ${TARGET_CHARS} · runs/model: ${RUNS}`,
    "",
  ];

  for (const { id: modelId, label } of MODELS) {
    const sub = samples.filter((s) => s.model === modelId);
    const pass = sub.filter((s) => s.floor_pass).length;
    const mean =
      sub.length ? sub.reduce((a, s) => a + s.output_chars, 0) / sub.length : 0;
    lines.push(`${label} (${modelId})`);
    lines.push(`  runs: ${sub.map((s) => `${s.output_chars}ch`).join(", ")}`);
    lines.push(`  mean=${mean.toFixed(0)}ch · >=${FLOOR}ch: ${pass}/${sub.length}`);
    lines.push("");
  }

  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  console.log("\n" + lines.join("\n"));
  console.log(`Wrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
