/**
 * Forensic: how server called DeepSeek — DB/metadata only, no API.
 *
 * Usage: npx.cmd tsx scripts/forensic-deepseek-call-params.ts
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getDatabasePath } from "../src/lib/dataDir";
import { OPENROUTER_DEEPSEEK_V4_PRO_MODEL } from "../src/lib/chatModels";
import {
  buildOpenRouterRequestBody,
  openRouterGenerationParams,
  resolveOpenRouterMaxTokens,
} from "../src/lib/openRouterClient";

const MODEL = OPENROUTER_DEEPSEEK_V4_PRO_MODEL;
const LONG_START = "2026-06-14";
const LONG_END = "2026-06-21 23:59:59";
const LONG_MIN = 3000;
const LONG_MAX = 5000;
const SHORT_MIN = 700;
const SHORT_MAX = 1200;

type Row = {
  message_id: number;
  chat_id: number;
  created_at: string;
  content: string;
  usage: string | null;
  context_json: string;
  prompt_hash: string;
  input_tokens: number;
  output_tokens: number;
  target_response_chars: number;
};

function displayProse(c: string): string {
  let s = c ?? "";
  const i = s.search(/<<<STATUS/i);
  if (i >= 0) s = s.slice(0, i);
  return s.trim();
}

function parseJson(s: string | null): Record<string, unknown> {
  if (!s) return {};
  try {
    return JSON.parse(s) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function collectKeys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [];
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    keys.push(p);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      keys.push(...collectKeys(v, p));
    }
  }
  return keys;
}

function generationParamsFromCode(targetChars: number, stream: boolean) {
  const body = buildOpenRouterRequestBody(MODEL, [], stream, targetChars);
  const genOnly: Record<string, unknown> = {};
  for (const k of [
    "model",
    "stream",
    "temperature",
    "max_tokens",
    "top_p",
    "frequency_penalty",
    "presence_penalty",
    "repetition_penalty",
    "reasoning",
    "include_reasoning",
    "reasoning_effort",
    "stop",
    "stop_sequences",
    "seed",
    "provider",
    "transforms",
    "route",
    "session_id",
    "stream_options",
  ]) {
    if (k in body) genOnly[k] = body[k];
  }
  return genOnly;
}

function stableJson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj, Object.keys(obj).sort(), 2);
}

function diffGenParams(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): string[] {
  const lines: string[] = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of [...keys].sort()) {
    const va = JSON.stringify(a[k]);
    const vb = JSON.stringify(b[k]);
    if (va !== vb) lines.push(`  ${k}: prod=${va} vs fixture=${vb}`);
  }
  return lines;
}

function extractUsageFields(usage: Record<string, unknown>) {
  const stages = Array.isArray(usage.stages) ? usage.stages : [];
  const primary = (stages[0] as Record<string, unknown>) ?? {};
  return {
    usage_top_keys: Object.keys(usage),
    provider: usage.provider,
    route: usage.route,
    model: usage.model,
    input: usage.input,
    output: usage.output,
    apiInputTokens: usage.apiInputTokens,
    apiOutputTokens: usage.apiOutputTokens,
    apiReasoningOutputTokens: usage.apiReasoningOutputTokens,
    finishReason: primary.finishReason ?? usage.finishReason,
    stage_finishReason: primary.finishReason,
    truncated: primary.truncated,
    loopAborted: primary.loopAborted,
    degenerationAborted: primary.degenerationAborted,
    lengthRecoveryPasses: primary.lengthRecoveryPasses ?? usage.lengthRecoveryPasses,
    cacheReadTokens: primary.cacheReadTokens ?? usage.cacheReadTokens,
    cacheWriteTokens: primary.cacheWriteTokens ?? usage.cacheWriteTokens,
    upstreamCostUsd: primary.upstreamCostUsd ?? usage.upstreamCostUsd,
    has_raw_usage: Boolean(
      usage.debugRawUsage || primary.debugRawUsage || usage.raw_usage
    ),
    provider_name: usage.provider_name ?? primary.provider_name,
    provider_route: usage.provider_route ?? primary.provider_route,
    provider_latency: usage.provider_latency ?? primary.provider_latency,
    candidate_count: usage.candidate_count ?? primary.candidate_count,
  };
}

function main() {
  const db = new Database(getDatabasePath(), { readonly: true });
  const rows = db
    .prepare(
      `
    SELECT m.id AS message_id, m.chat_id, m.content, m.usage, m.created_at,
           COALESCE(mg.context_json, '{}') AS context_json,
           COALESCE(mg.prompt_hash, '') AS prompt_hash,
           COALESCE(mg.input_tokens, 0) AS input_tokens,
           COALESCE(mg.output_tokens, 0) AS output_tokens
    FROM messages m
    LEFT JOIN message_generations mg ON mg.message_id = m.id
    WHERE m.role = 'assistant' AND m.model LIKE '%deepseek%' AND m.model != 'greeting'
    ORDER BY m.created_at ASC
  `
    )
    .all() as Row[];

  const enriched = rows.map((r) => {
    const prose = displayProse(r.content);
    const ctx = parseJson(r.context_json);
    const usage = parseJson(r.usage);
    const target = Number(ctx.targetResponseChars ?? 0);
    return {
      ...r,
      prose_len: prose.length,
      target_response_chars: target,
      usage,
      usage_extract: extractUsageFields(usage),
    };
  });

  const longPool = enriched.filter(
    (r) =>
      r.created_at >= LONG_START &&
      r.created_at <= LONG_END &&
      r.prose_len >= LONG_MIN &&
      r.prose_len <= LONG_MAX
  );

  const shortPool = enriched
    .filter((r) => r.prose_len >= SHORT_MIN && r.prose_len <= SHORT_MAX)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const lines: string[] = [
    "DEEPSEEK SERVER CALL FORENSIC — request/response metadata (DB only)",
    `generated: ${new Date().toISOString()}`,
    `db: ${getDatabasePath()}`,
    "",
    "## Storage audit — what exists in production DB?",
    "",
    "### messages.usage (billing receipt JSON)",
    "  STORED: input, output, model, provider, route, cost, breakdown, stages[],",
    "          apiInputTokens, apiOutputTokens, apiReasoningOutputTokens, cacheRead/Write,",
    "          upstreamCostUsd, savedOutputChars, lengthRecoveryPasses (top or stage)",
    "  stages[0] MAY INCLUDE: finishReason, truncated, loopAborted, apiOutputTokens, cache*",
    "  NOT STORED in usage: temperature, max_tokens, top_p, penalties, stream, stop, seed,",
    "          reasoning flags, OpenRouter transforms, provider_name/route/latency,",
    "          raw OpenRouter response body, request payload",
    "",
    "### message_generations.context_json",
    "  STORED: targetResponseChars, completedTurns, promptAudit (token breakdown),",
    "          model, provider, route, nsfw, writingStyle, regenerate flags",
    "  NOT STORED: generation parameters, request payload, response metadata",
    "",
    "### prompt debug dumps (output/prompt-debug/)",
    `  PROMPT_DEBUG=1 only — ${fs.existsSync(path.resolve("output/prompt-debug")) ? "dir exists" : "no dir / not enabled for June prod"}`,
    "",
    "### Application logs",
    "  Console-only at request time ([OUTPUT TOKEN CONFIG], [OPENROUTER REQUEST] summary);",
    "  not persisted to DB for historical turns.",
    "",
  ];

  // Union of usage keys
  const allUsageKeys = new Set<string>();
  for (const r of enriched) {
    for (const k of collectKeys(r.usage)) allUsageKeys.add(k);
  }
  lines.push("## All usage JSON keys observed (deepseek messages)");
  lines.push(`  ${[...allUsageKeys].sort().join(", ")}`);
  lines.push("");

  // OpenRouter response fields check
  const orFields = [
    "provider_name",
    "provider_route",
    "provider_latency",
    "candidate_count",
    "debugRawUsage",
    "raw_usage",
    "finishReason",
    "completion_tokens",
  ];
  lines.push("## OpenRouter response fields in DB?");
  for (const f of orFields) {
    const n = enriched.filter((r) => {
      const u = r.usage;
      const st = Array.isArray(u.stages) ? (u.stages[0] as Record<string, unknown>) : {};
      return f in u || f in st;
    }).length;
    lines.push(`  ${f}: ${n}/${enriched.length} messages`);
  }
  lines.push("");

  lines.push(`## 1. Long pool ${LONG_START}~${LONG_END} prose ${LONG_MIN}-${LONG_MAX}ch (n=${longPool.length})`);
  for (const r of longPool) {
    const u = r.usage_extract;
    lines.push(
      `  id=${r.message_id} ${r.created_at} prose=${r.prose_len}ch target=${r.target_response_chars} hash=${r.prompt_hash}`
    );
    lines.push(
      `    usage: in=${u.input} out=${u.output} apiIn=${u.apiInputTokens} apiOut=${u.apiOutputTokens} reasoningOut=${u.apiReasoningOutputTokens}`
    );
    lines.push(
      `    finishReason=${u.finishReason} truncated=${u.truncated} loop=${u.loopAborted} recovery=${u.lengthRecoveryPasses}`
    );
    lines.push(
      `    provider_name=${u.provider_name} provider_route=${u.provider_route} latency=${u.provider_latency} candidates=${u.candidate_count}`
    );
    lines.push(`    mg output_tokens=${r.output_tokens} input_tokens=${r.input_tokens}`);
  }
  lines.push("");

  lines.push(`## 2. Short pool ${SHORT_MIN}-${SHORT_MAX}ch recent (n=${shortPool.length})`);
  for (const r of shortPool) {
    const u = r.usage_extract;
    lines.push(
      `  id=${r.message_id} ${r.created_at} prose=${r.prose_len}ch target=${r.target_response_chars} finish=${u.finishReason}`
    );
    lines.push(`    apiOut=${u.apiOutputTokens} apiIn=${u.apiInputTokens} recovery=${u.lengthRecoveryPasses}`);
  }
  lines.push("");

  // finish_reason groups
  const finishGroups = { length: [] as typeof enriched, stop: [] as typeof enriched, unknown: [] as typeof enriched, other: [] as typeof enriched };
  for (const r of enriched) {
    const fr = String(r.usage_extract.finishReason ?? "unknown").toLowerCase();
    if (fr === "length" || fr === "max_tokens") finishGroups.length.push(r);
    else if (fr === "stop" || fr === "end_turn") finishGroups.stop.push(r);
    else if (fr === "unknown" || !r.usage_extract.finishReason) finishGroups.unknown.push(r);
    else finishGroups.other.push(r);
  }

  lines.push("## 3. finish_reason groups — response metadata available");
  for (const [label, group] of Object.entries(finishGroups)) {
    if (!group.length) continue;
    lines.push(`  ${label} (n=${group.length}):`);
    const apiOut = group.map((g) => Number(g.usage_extract.apiOutputTokens ?? 0));
    const prose = group.map((g) => g.prose_len);
    const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
    lines.push(`    mean prose=${mean(prose).toFixed(0)}ch mean apiOut=${mean(apiOut).toFixed(0)}`);
    lines.push(
      `    truncated rate=${(group.filter((g) => g.usage_extract.truncated).length / group.length * 100).toFixed(0)}%`
    );
    lines.push(
      `    recovery passes>0=${group.filter((g) => Number(g.usage_extract.lengthRecoveryPasses ?? 0) > 0).length}`
    );
  }
  lines.push("");

  // Code-derived generation params — production path vs experiment fixture
  const prodTarget = 3300;
  const prodGen = generationParamsFromCode(prodTarget, true);
  const labGen = generationParamsFromCode(prodTarget, false);
  const prodTarget3000 = generationParamsFromCode(3000, true);
  const prodTarget2000 = generationParamsFromCode(2000, true);

  lines.push("## 5. Generation params — CURRENT code (not historical DB)");
  lines.push("  Production chat route: stream=true, buildOpenRouterRequestBody(..., stream=true)");
  lines.push("  Lab scripts: callOpenRouterAdult → stream=false");
  lines.push("");
  lines.push("  prod fixture target=3300 stream=true:");
  lines.push(stableJson(prodGen));
  lines.push("");
  lines.push("  lab fixture target=3300 stream=false:");
  lines.push(stableJson(labGen));
  lines.push("");
  lines.push("  diff (generation fields only):");
  lines.push(...diffGenParams(prodGen, labGen));
  lines.push("");
  lines.push(`  max_tokens target=3000: ${resolveOpenRouterMaxTokens(3000, undefined, MODEL)}`);
  lines.push(`  max_tokens target=2000: ${resolveOpenRouterMaxTokens(2000, undefined, MODEL)}`);
  lines.push(`  max_tokens target=3300: ${resolveOpenRouterMaxTokens(3300, undefined, MODEL)}`);
  lines.push("");
  lines.push("  openRouterGenerationParams(3300):");
  lines.push(stableJson(openRouterGenerationParams(3300, MODEL) as Record<string, unknown>));
  lines.push("");

  // Target chars variance in long pool
  const targets = [...new Set(longPool.map((r) => r.target_response_chars))].sort();
  lines.push("## targetResponseChars in long pool (context_json):");
  lines.push(`  unique: ${targets.join(", ")}`);
  lines.push("");

  lines.push("## VERDICT — 호출 옵션 vs Prompt");
  lines.push(
    "  REQUEST PAYLOAD: NOT persisted for any production turn. Cannot byte-compare historical prod vs lab from DB."
  );
  lines.push(
    "  GENERATION PARAMS in DB: NOT stored. Only targetResponseChars (affects max_tokens via code)."
  );
  lines.push(
    "  CONFIRMED structural call diff (current code): production stream=true vs lab stream=false."
  );
  lines.push(
    "  CONFIRMED same DeepSeek gen params in code for both paths when target matches:"
  );
  lines.push(
    `    temperature=${prodGen.temperature} top_p=${prodGen.top_p} freq=${prodGen.frequency_penalty} pres=${prodGen.presence_penalty} reasoning=${JSON.stringify(prodGen.reasoning ?? prodGen.include_reasoning ?? "off")}`
  );
  lines.push(
    "  finish_reason: stored ONLY in usage.stages[0].finishReason when present; many June samples show unknown/missing."
  );
  lines.push(
    "  OpenRouter provider metadata (provider_name, route, latency, raw): NOT in DB."
  );
  lines.push(
    "  IF June long vs recent short differ in output length, DB evidence points to targetResponseChars + session context,"
  );
  lines.push(
    "  NOT retrievable temperature/max_tokens/penalty changes — those fields are not logged per turn."
  );
  lines.push(
    "  Cannot rule out code changes between 06-14 and now without git history at deploy time; only current code reconstructed."
  );

  const outDir = path.resolve("output");
  fs.mkdirSync(outDir, { recursive: true });
  const reportPath = path.join(outDir, "forensic-deepseek-call-params-report.txt");
  const jsonPath = path.join(outDir, "forensic-deepseek-call-params.json");
  fs.writeFileSync(reportPath, lines.join("\n"), "utf8");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        longPool: longPool.map((r) => ({
          message_id: r.message_id,
          created_at: r.created_at,
          prose_len: r.prose_len,
          target_response_chars: r.target_response_chars,
          usage_extract: r.usage_extract,
          prompt_hash: r.prompt_hash,
        })),
        shortPool: shortPool.map((r) => ({
          message_id: r.message_id,
          created_at: r.created_at,
          prose_len: r.prose_len,
          target_response_chars: r.target_response_chars,
          usage_extract: r.usage_extract,
        })),
        code_gen_prod_stream: prodGen,
        code_gen_lab_nostream: labGen,
        finishGroups: Object.fromEntries(
          Object.entries(finishGroups).map(([k, v]) => [k, v.map((r) => r.message_id)])
        ),
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(lines.join("\n"));
  console.log(`Wrote ${reportPath}`);
}

main();
