/**
 * Gemini 3.1 Pro — reasoning.effort:low RP turn verification (real buildContext + history).
 * Usage: npx.cmd tsx scripts/verify-gemini31-effort-low-rp.ts [--runs=8]
 */
import fs from "fs";
import path from "path";
import Module from "module";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import { getDatabasePath } from "../src/lib/dataDir";
import { OPENROUTER_GEMINI_31_PRO_MODEL } from "../src/lib/chatModels";

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

const MODEL = OPENROUTER_GEMINI_31_PRO_MODEL;
const RUNS = (() => {
  const arg = process.argv.find((a) => a.startsWith("--runs="));
  if (arg) return Math.max(5, Math.min(10, Number(arg.split("=")[1]) || 8));
  return 8;
})();
const TARGET_CHARS = 3300;
const FIXED_DEPTH = 6;
const DELAY_MS = 6000;
const USER_MESSAGE =
  "정말 고장났나봐.... 나랑 떨어져야되는거아니야?? 렌은 엘리베이터 안에서 숨을 고르며 백하율의 표정을 읽었다.";

type Sample = {
  run: number;
  output_chars: number;
  finish_reason: string;
  completion_tokens: number;
  reasoning_tokens: number;
  billable_output_tokens: number;
  cost_points: number;
  max_tokens_sent: number;
  reasoning_sent: unknown;
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
    "백하율… 괜찮아?",
    "조금만 더 기다려보자.",
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

async function buildFixture() {
  const { messagesToTurns, rawRecentTurnsToHistory } = await import("../src/lib/hybridMemory");
  const { resolveRawRecentTurnWindowForHistory } = await import("../src/lib/contextTrack");
  const { buildContext } = await import("../src/services/contextBuilder");
  const { parseCharacterSetting } = await import("../src/utils/characterParser");
  const { formatSelectedPersonaForPrompt } = await import("../src/lib/userPersonas");
  const { formatUserNoteForPrompt } = await import("../src/lib/persona");
  const { formatMemoryMetaForPrompt, parseMemoryMeta } = await import("../src/lib/chatMemory");

  const templates = loadHistoryTemplates();
  const historyMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (let i = 0; i < FIXED_DEPTH / 2; i++) {
    const t = templates[i % templates.length];
    historyMessages.push({ role: "user", content: t.user });
    historyMessages.push({ role: "assistant", content: t.assistant });
  }

  const turns = messagesToTurns(
    [...historyMessages, { role: "user", content: USER_MESSAGE }].map((m) => ({
      ...m,
      model: "assistant",
    }))
  );
  const historyRaw = rawRecentTurnsToHistory(
    turns,
    0,
    resolveRawRecentTurnWindowForHistory(MODEL, "openrouter", turns.length)
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
    modelId: MODEL,
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

  return {
    charName,
    history,
    split,
    system: [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock]
      .filter(Boolean)
      .join("\n\n"),
  };
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }

  const { buildOpenRouterRequestBody } = await import("../src/lib/openRouterClient");
  const { resolveMaxOutputTokensForTarget } = await import("../src/lib/responseLength");
  const { billableOpenRouterOutputTokens, computeTurnBilling } = await import("../src/lib/points");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");
  const ctx = await buildFixture();
  const expectedMax = resolveMaxOutputTokensForTarget(TARGET_CHARS, MODEL);
  const probeBody = buildOpenRouterRequestBody(
    MODEL,
    [{ role: "user", content: "probe" }],
    false,
    TARGET_CHARS,
    "verify-effort-low"
  ) as Record<string, unknown>;

  console.log("REQUEST PROBE", {
    model: probeBody.model,
    max_tokens: probeBody.max_tokens,
    reasoning: probeBody.reasoning,
    include_reasoning: probeBody.include_reasoning,
  });

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlPath = path.join(outDir, "verify-gemini31-effort-low-rp.jsonl");
  fs.writeFileSync(jsonlPath, "", "utf8");

  const samples: Sample[] = [];

  for (let run = 1; run <= RUNS; run++) {
    await sleep(DELAY_MS);
    process.stdout.write(`run ${run}/${RUNS}...`);
    const result = await callOpenRouterAdult(
      ctx.system,
      [...ctx.history, { role: "user", content: USER_MESSAGE }],
      MODEL,
      TARGET_CHARS,
      { charName: ctx.charName, systemSplit: ctx.split },
      { chargeTurnBudget: false, requestKind: "verify-gemini31-effort-low-rp" }
    );

    const prose = displayProse(result.text);
    const completionTokens = Number(result.usage?.outputTokens ?? 0);
    const reasoningTokens = Number(result.usage?.reasoningOutputTokens ?? 0);
    const billableOut = billableOpenRouterOutputTokens(
      MODEL,
      completionTokens,
      reasoningTokens
    );
    const billing = computeTurnBilling({
      provider: "openrouter",
      openRouterModelId: MODEL,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: billableOut,
      cacheReadTokens: result.usage?.cacheReadTokens,
      cacheWriteTokens: result.usage?.cacheWriteTokens,
      savedTextChars: prose.length,
      upstreamCostUsd: result.usage?.upstreamCostUsd,
      apiPromptTokens: result.usage?.apiReportedInputTokens ?? result.usage?.inputTokens,
      apiCompletionTokens: completionTokens,
      modelLabel: "Gemini 3.1 Pro",
      completedTurnsBeforeRequest: FIXED_DEPTH,
    });

    const sample: Sample = {
      run,
      output_chars: prose.length,
      finish_reason: String(result.usage?.finishReason ?? "unknown"),
      completion_tokens: completionTokens,
      reasoning_tokens: reasoningTokens,
      billable_output_tokens: billableOut,
      cost_points: billing.total,
      max_tokens_sent: expectedMax,
      reasoning_sent: probeBody.reasoning,
    };
    samples.push(sample);
    fs.appendFileSync(jsonlPath, JSON.stringify(sample) + "\n", "utf8");
    console.log(
      ` chars=${sample.output_chars} finish=${sample.finish_reason} comp=${sample.completion_tokens} reason=${sample.reasoning_tokens} cost=${sample.cost_points}P`
    );
  }

  const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const summary = {
    runs: RUNS,
    max_tokens: expectedMax,
    reasoning_config: probeBody.reasoning,
    mean_output_chars: Math.round(mean(samples.map((s) => s.output_chars))),
    mean_reasoning_tokens: Math.round(mean(samples.map((s) => s.reasoning_tokens))),
    mean_completion_tokens: Math.round(mean(samples.map((s) => s.completion_tokens))),
    mean_cost_points: Math.round(mean(samples.map((s) => s.cost_points) ) * 10) / 10,
    finish_stop: samples.filter((s) => s.finish_reason.toLowerCase() === "stop").length,
    finish_length: samples.filter((s) => s.finish_reason.toLowerCase() === "length").length,
    baseline_cost_points: 138.4,
    baseline_reasoning_tokens: 4634,
  };

  const reportPath = path.join(outDir, "verify-gemini31-effort-low-rp-report.json");
  fs.writeFileSync(reportPath, JSON.stringify({ summary, samples }, null, 2), "utf8");
  console.log("\nSUMMARY", JSON.stringify(summary, null, 2));
  console.log(`Wrote ${jsonlPath}\nWrote ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
