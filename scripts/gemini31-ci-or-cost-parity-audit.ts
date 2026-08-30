/**
 * Gemini 3.1 Pro — CI vs OR (Vertex-backed) transport cost parity audit.
 * Same frozen RP fixture as verify-gemini31-effort-low-rp (3300 chars, depth 6).
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-ci-or-cost-parity-audit.ts
 *   node --conditions=react-server --import tsx scripts/gemini31-ci-or-cost-parity-audit.ts --runs=12
 *   node --conditions=react-server --import tsx scripts/gemini31-ci-or-cost-parity-audit.ts --analyze-only
 */
import fs from "node:fs";
import path from "node:path";
import Module from "module";
import Database from "better-sqlite3";
import { loadEnvLocal } from "./load-env-local";
import { getDatabasePath } from "../src/lib/dataDir";
import {
  CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
  OPENROUTER_GEMINI_31_PRO_MODEL,
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

const OUT_DIR = process.env.G31_COST_AUDIT_OUT ?? "/opt/cursor/artifacts/gemini31-ci-or-cost-audit";
const TARGET_CHARS = 3300;
const FIXED_DEPTH = 6;
const DELAY_MS = 6000;
const USER_MESSAGE =
  "정말 고장났나봐.... 나랑 떨어져야되는거아니야?? 렌은 엘리베이터 안에서 숨을 고르며 백하율의 표정을 읽었다.";

const RUNS = (() => {
  const arg = process.argv.find((a) => a.startsWith("--runs="));
  if (arg) return Math.max(5, Math.min(20, Number(arg.split("=")[1]) || 12));
  return 12;
})();
const ANALYZE_ONLY = process.argv.includes("--analyze-only");

type TransportPath = "ci" | "or_vertex";

type RawRunRow = {
  path: TransportPath;
  run: number;
  prompt_tokens: number;
  uncached_input_tokens: number;
  cached_input_tokens: number;
  cache_write_tokens: number;
  completion_tokens: number;
  visible_output_tokens: number;
  reasoning_tokens: number;
  billable_output_tokens: number;
  output_chars: number;
  finish_reason: string;
  billed_cost_usd: number | null;
  cheaper_inference_billed_usd: number | null;
  upstream_cost_usd: number | null;
  billed_cost_points: number;
  latency_ms: number;
};

type TokenVector = {
  prompt_tokens: number;
  uncached_input_tokens: number;
  cached_input_tokens: number;
  cache_write_tokens: number;
  visible_output_tokens: number;
  reasoning_tokens: number;
  billable_output_tokens: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function roundUsd(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function displayProse(c: string): string {
  let s = c ?? "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  return s.trim();
}

function loadFrozenAssistantFixture(turn: number): string {
  const p = path.join(process.cwd(), `docs/audits/gemini-37-flash-pricing/t${turn}-raw.txt`);
  return fs.readFileSync(p, "utf8").trim();
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
  if (templates.length >= FIXED_DEPTH / 2) return templates;

  const frozenUser = [
    "나는 렌이라고… 본 기억이 안 나는데… 나 알아?",
    "같이 갈래? *두리번*",
    "어디로 가? 안내해줘.",
  ];
  for (let i = 0; templates.length < FIXED_DEPTH / 2; i += 1) {
    templates.push({
      user: frozenUser[i % frozenUser.length]!,
      assistant: loadFrozenAssistantFixture(i + 1).slice(0, 4500),
    });
  }
  return templates;
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

  return {
    charName,
    history,
    split,
    system: [split.systemRulesBlock, split.characterSettingsBlock, split.dynamicBlock]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function pathConfig(path: TransportPath) {
  if (path === "ci") {
    return {
      label: "CI (CheaperInference)",
      modelId: CHEAPER_INFERENCE_GEMINI_31_PRO_PREVIEW_MODEL,
      provider: "cheaperinference" as const,
      transportProvider: "cheaperinference" as const,
    };
  }
  return {
    label: "OR Vertex (OpenRouter google/gemini-3.1-pro-preview)",
    modelId: OPENROUTER_GEMINI_31_PRO_MODEL,
    provider: "openrouter" as const,
    transportProvider: "openrouter" as const,
  };
}

async function runPath(transportPath: TransportPath, runs: number, ctx: Awaited<ReturnType<typeof buildFixture>>) {
  const cfg = pathConfig(transportPath);
  const { billableOpenRouterOutputTokens, computeTurnBilling } = await import("../src/lib/points");
  const { callOpenRouterAdult } = await import("../src/lib/openRouterAdult");

  const jsonlPath = path.join(OUT_DIR, `raw-${transportPath}.jsonl`);
  if (!ANALYZE_ONLY) {
    fs.writeFileSync(jsonlPath, "", "utf8");
  }

  const rows: RawRunRow[] = [];

  for (let run = 1; run <= runs; run++) {
    if (!ANALYZE_ONLY) {
      if (run > 1) await sleep(DELAY_MS);
      process.stdout.write(`[${transportPath}] run ${run}/${runs}...`);
      const started = Date.now();
      const result = await callOpenRouterAdult(
        ctx.system,
        [...ctx.history, { role: "user", content: USER_MESSAGE }],
        cfg.modelId,
        TARGET_CHARS,
        { charName: ctx.charName, systemSplit: ctx.split, transportProvider: cfg.transportProvider },
        { chargeTurnBudget: false, requestKind: `g31-cost-audit-${transportPath}` }
      );

      const prose = displayProse(result.text);
      const promptTokens = Number(result.usage?.inputTokens ?? 0);
      const cacheRead = Number(result.usage?.cacheReadTokens ?? 0);
      const cacheWrite = Number(result.usage?.cacheWriteTokens ?? 0);
      const completionTokens = Number(result.usage?.outputTokens ?? 0);
      const reasoningTokens = Number(result.usage?.reasoningOutputTokens ?? 0);
      const billableOut = billableOpenRouterOutputTokens(cfg.modelId, completionTokens, reasoningTokens);
      const visibleOut = billableOut;
      const uncached = Math.max(0, promptTokens - cacheRead - cacheWrite);

      const billing = computeTurnBilling({
        provider: cfg.provider,
        openRouterModelId: cfg.modelId,
        inputTokens: promptTokens,
        outputTokens: billableOut,
        reasoningTokens,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        savedTextChars: prose.length,
        upstreamCostUsd: result.usage?.upstreamCostUsd,
        apiPromptTokens: result.usage?.apiReportedInputTokens ?? promptTokens,
        apiCompletionTokens: completionTokens,
        modelLabel: "Gemini 3.1 Pro",
        completedTurnsBeforeRequest: FIXED_DEPTH,
      });

      const ciBilled = result.usage?.cheaperInferenceBilledCostUsd ?? null;
      const upstream = result.usage?.upstreamCostUsd ?? null;
      const billedUsd =
        ciBilled != null && ciBilled > 0 ? ciBilled : upstream != null && upstream > 0 ? upstream : null;

      const row: RawRunRow = {
        path: transportPath,
        run,
        prompt_tokens: promptTokens,
        uncached_input_tokens: uncached,
        cached_input_tokens: cacheRead,
        cache_write_tokens: cacheWrite,
        completion_tokens: completionTokens,
        visible_output_tokens: visibleOut,
        reasoning_tokens: reasoningTokens,
        billable_output_tokens: billableOut,
        output_chars: prose.length,
        finish_reason: String(result.usage?.finishReason ?? "unknown"),
        billed_cost_usd: billedUsd,
        cheaper_inference_billed_usd: ciBilled,
        upstream_cost_usd: upstream,
        billed_cost_points: billing.total,
        latency_ms: Date.now() - started,
      };
      rows.push(row);
      fs.appendFileSync(jsonlPath, JSON.stringify(row) + "\n", "utf8");
      console.log(
        ` uncached=${uncached} cached=${cacheRead} visible=${visibleOut} reason=${reasoningTokens} ${billing.total}P`
      );
    } else {
      const lines = fs.readFileSync(jsonlPath, "utf8").trim().split("\n").filter(Boolean);
      for (const line of lines) {
        rows.push(JSON.parse(line) as RawRunRow);
      }
      break;
    }
  }

  return rows;
}

function toVector(row: RawRunRow): TokenVector {
  return {
    prompt_tokens: row.prompt_tokens,
    uncached_input_tokens: row.uncached_input_tokens,
    cached_input_tokens: row.cached_input_tokens,
    cache_write_tokens: row.cache_write_tokens,
    visible_output_tokens: row.visible_output_tokens,
    reasoning_tokens: row.reasoning_tokens,
    billable_output_tokens: row.billable_output_tokens,
  };
}

function meanVector(rows: RawRunRow[]): TokenVector {
  const keys = [
    "prompt_tokens",
    "uncached_input_tokens",
    "cached_input_tokens",
    "cache_write_tokens",
    "visible_output_tokens",
    "reasoning_tokens",
    "billable_output_tokens",
  ] as const;
  const out = {} as TokenVector;
  for (const key of keys) {
    out[key] = Math.round(mean(rows.map((r) => r[key])));
  }
  return out;
}

async function hypotheticalPoints(
  path: TransportPath,
  vector: TokenVector,
  outputChars: number
): Promise<number> {
  const cfg = pathConfig(path);
  const { computeTurnBilling } = await import("../src/lib/points");
  const billing = computeTurnBilling({
    provider: cfg.provider,
    openRouterModelId: cfg.modelId,
    inputTokens: vector.prompt_tokens,
    outputTokens: vector.billable_output_tokens,
    reasoningTokens: vector.reasoning_tokens,
    cacheReadTokens: vector.cached_input_tokens,
    cacheWriteTokens: vector.cache_write_tokens,
    savedTextChars: outputChars,
    modelLabel: "Gemini 3.1 Pro",
    completedTurnsBeforeRequest: FIXED_DEPTH,
  });
  return billing.total;
}

function formatRowTable(rows: RawRunRow[]): string {
  const header =
    "| run | uncached_in | cached_in | cache_write | visible_out | reasoning | billed_usd | billed_pts | out_chars |";
  const sep = "|---:|---:|---:|---:|---:|---:|---:|---:|---:|";
  const body = rows
    .map(
      (r) =>
        `| ${r.run} | ${r.uncached_input_tokens} | ${r.cached_input_tokens} | ${r.cache_write_tokens} | ${r.visible_output_tokens} | ${r.reasoning_tokens} | ${r.billed_cost_usd?.toFixed(6) ?? "n/a"} | ${r.billed_cost_points} | ${r.output_chars} |`
    )
    .join("\n");
  return [header, sep, body].join("\n");
}

async function analyze(ciRows: RawRunRow[], orRows: RawRunRow[]) {
  const ciFirst5 = ciRows.slice(0, 5);
  const orFirst5 = orRows.slice(0, 5);
  const ciAll = ciRows;
  const orAll = orRows;

  const ciMeanVec = meanVector(ciAll);
  const orMeanVec = meanVector(orAll);
  const pooledMeanVec = meanVector([...ciAll, ...orAll]);
  const meanOutputChars = Math.round(mean([...ciAll, ...orAll].map((r) => r.output_chars)));

  const actual = {
    ci: {
      cohort_n: ciAll.length,
      first5_mean_points: round1(mean(ciFirst5.map((r) => r.billed_cost_points))),
      all_mean_points: round1(mean(ciAll.map((r) => r.billed_cost_points))),
      all_mean_billed_usd: roundUsd(mean(ciAll.map((r) => r.billed_cost_usd ?? 0))),
      all_mean_upstream_usd: roundUsd(mean(ciAll.map((r) => r.upstream_cost_usd ?? 0))),
      mean_uncached: Math.round(mean(ciAll.map((r) => r.uncached_input_tokens))),
      mean_cached: Math.round(mean(ciAll.map((r) => r.cached_input_tokens))),
      mean_visible: Math.round(mean(ciAll.map((r) => r.visible_output_tokens))),
      mean_reasoning: Math.round(mean(ciAll.map((r) => r.reasoning_tokens))),
    },
    or_vertex: {
      cohort_n: orAll.length,
      first5_mean_points: round1(mean(orFirst5.map((r) => r.billed_cost_points))),
      all_mean_points: round1(mean(orAll.map((r) => r.billed_cost_points))),
      all_mean_billed_usd: roundUsd(mean(orAll.map((r) => r.billed_cost_usd ?? 0))),
      all_mean_upstream_usd: roundUsd(mean(orAll.map((r) => r.upstream_cost_usd ?? 0))),
      mean_uncached: Math.round(mean(orAll.map((r) => r.uncached_input_tokens))),
      mean_cached: Math.round(mean(orAll.map((r) => r.cached_input_tokens))),
      mean_visible: Math.round(mean(orAll.map((r) => r.visible_output_tokens))),
      mean_reasoning: Math.round(mean(orAll.map((r) => r.reasoning_tokens))),
    },
  };

  const normalized = {
    reference_vectors: {
      ci_path_mean: ciMeanVec,
      or_path_mean: orMeanVec,
      pooled_mean: pooledMeanVec,
    },
    hypothetical_at_pooled_mean_vector: {
      ci_rate_card_points: await hypotheticalPoints("ci", pooledMeanVec, meanOutputChars),
      or_rate_card_points: await hypotheticalPoints("or_vertex", pooledMeanVec, meanOutputChars),
    },
    hypothetical_at_ci_mean_vector: {
      ci_rate_card_points: await hypotheticalPoints("ci", ciMeanVec, meanOutputChars),
      or_rate_card_points: await hypotheticalPoints("or_vertex", ciMeanVec, meanOutputChars),
    },
    hypothetical_at_or_mean_vector: {
      ci_rate_card_points: await hypotheticalPoints("ci", orMeanVec, meanOutputChars),
      or_rate_card_points: await hypotheticalPoints("or_vertex", orMeanVec, meanOutputChars),
    },
  };

  const report = {
    generatedAt: new Date().toISOString(),
    fixture: {
      target_response_chars: TARGET_CHARS,
      fixed_depth: FIXED_DEPTH,
      user_message: USER_MESSAGE,
      rp_policy: "unchanged — same as verify-gemini31-effort-low-rp",
    },
    cohorts: {
      baseline_first5: { ci: ciFirst5.length, or_vertex: orFirst5.length },
      extended_total: { ci: ciAll.length, or_vertex: orAll.length },
    },
    raw: { ci: ciAll, or_vertex: orAll },
    actual_average_turn_cost: actual,
    normalized_hypothetical: normalized,
    note:
      "Do not compare reported median costs across paths. Use actual_mean per path for observed cost, and normalized hypothetical for same-token-vector rate-card comparison.",
  };

  const md = [
    "# Gemini 3.1 Pro — CI vs OR Vertex cost parity",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Fixture (unchanged RP policy)",
    `- targetResponseChars: ${TARGET_CHARS}`,
    `- history depth: ${FIXED_DEPTH}`,
    "",
    "## Raw — CI (CheaperInference)",
    formatRowTable(ciAll),
    "",
    "## Raw — OR Vertex (OpenRouter)",
    formatRowTable(orAll),
    "",
    "## Actual average turn cost (each path's own runs)",
    "",
    "| path | n | mean pts (all) | mean pts (first 5) | mean billed USD | mean upstream USD | mean uncached | mean cached | mean visible | mean reasoning |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    `| CI | ${actual.ci.cohort_n} | ${actual.ci.all_mean_points} | ${actual.ci.first5_mean_points} | ${actual.ci.all_mean_billed_usd} | ${actual.ci.all_mean_upstream_usd} | ${actual.ci.mean_uncached} | ${actual.ci.mean_cached} | ${actual.ci.mean_visible} | ${actual.ci.mean_reasoning} |`,
    `| OR Vertex | ${actual.or_vertex.cohort_n} | ${actual.or_vertex.all_mean_points} | ${actual.or_vertex.first5_mean_points} | ${actual.or_vertex.all_mean_billed_usd} | ${actual.or_vertex.all_mean_upstream_usd} | ${actual.or_vertex.mean_uncached} | ${actual.or_vertex.mean_cached} | ${actual.or_vertex.mean_visible} | ${actual.or_vertex.mean_reasoning} |`,
    "",
    "## Normalized hypothetical (same token vector → both rate cards)",
    "",
    "### Pooled mean vector (all runs)",
    "```json",
    JSON.stringify(pooledMeanVec, null, 2),
    "```",
    "",
    `| rate card applied to pooled vector | points |`,
    `| CI catalog formula | ${normalized.hypothetical_at_pooled_mean_vector.ci_rate_card_points} |`,
    `| OR/Vertex catalog formula | ${normalized.hypothetical_at_pooled_mean_vector.or_rate_card_points} |`,
    "",
    "### CI-path mean vector",
    `| CI @ CI-mean vector | ${normalized.hypothetical_at_ci_mean_vector.ci_rate_card_points} |`,
    `| OR @ CI-mean vector | ${normalized.hypothetical_at_ci_mean_vector.or_rate_card_points} |`,
    "",
    "### OR-path mean vector",
    `| CI @ OR-mean vector | ${normalized.hypothetical_at_or_mean_vector.ci_rate_card_points} |`,
    `| OR @ OR-mean vector | ${normalized.hypothetical_at_or_mean_vector.or_rate_card_points} |`,
    "",
    report.note,
  ].join("\n");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "REPORT.md"), md, "utf8");
  console.log("\n" + md);
  console.log(`\nWrote ${OUT_DIR}/report.json and REPORT.md`);
}

async function main() {
  if (!process.env.CHEAPER_INFERENCE_API_KEY?.trim()) {
    console.error("CHEAPER_INFERENCE_API_KEY missing");
    process.exit(2);
  }
  if (!process.env.OPENROUTER_API_KEY?.trim()) {
    console.error("OPENROUTER_API_KEY missing");
    process.exit(2);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ctx = await buildFixture(OPENROUTER_GEMINI_31_PRO_MODEL);

  console.log(`OUT_DIR=${OUT_DIR} RUNS=${RUNS} ANALYZE_ONLY=${ANALYZE_ONLY}`);

  const ciRows = await runPath("ci", RUNS, ctx);
  const orRows = await runPath("or_vertex", RUNS, ctx);
  await analyze(ciRows, orRows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
