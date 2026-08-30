/**
 * Phase D.2 §4 — CI usage API discovery + D.1 reconciliation.
 *
 *   node --conditions=react-server --import tsx scripts/gemini31-phase-d2-usage-reconcile.ts
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnvLocal } from "./load-env-local";
import {
  classifyCacheField,
  closestTtftTarget,
  fetchCiUsageRequests,
  fetchAllCiUsageInWindow,
  indexUsageByRequestId,
  joinUsageToRun,
  loadD1CiRuns,
  pickRequestId,
  usageFieldPresent,
} from "./lib/gemini31PhaseD2Usage";
import {
  assemblePrimaryRpRequest,
} from "../src/lib/openRouterAdult";
import { PHASE_D_MINIMAL_SYSTEM, PHASE_D_USER_TURNS } from "./lib/gemini31PhaseDProbe";
import { sha256 } from "./lib/gemini31PhaseD2Usage";

loadEnvLocal();

const OUT_DIR = "/opt/cursor/artifacts/gemini31-phase-d2-reasoning";
const OUT = path.join(OUT_DIR, "usage-reconcile.json");

async function main() {
  // §3 production wire snapshot (metadata only)
  const assembled = assemblePrimaryRpRequest({
    system: PHASE_D_MINIMAL_SYSTEM,
    history: [{ role: "user", content: PHASE_D_USER_TURNS[0]! }],
    modelId: "gemini-3.1-pro-preview",
    messageOpts: { transportProvider: "cheaperinference" },
    stream: true,
  });

  const wire = {
    model: assembled.requestBody.model,
    body_key_inventory: Object.keys(assembled.requestBody).sort(),
    reasoning_control_keys: ["reasoning_effort", "reasoning", "thinking", "include_reasoning"].filter(
      (k) => k in assembled.requestBody
    ),
    reasoning_effort: assembled.requestBody.reasoning_effort ?? null,
    reasoning: assembled.requestBody.reasoning ?? null,
    messages_hash: sha256(JSON.stringify(assembled.messages.map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "[blocks]" })))),
    system_hash: sha256(PHASE_D_MINIMAL_SYSTEM),
    max_tokens: assembled.requestBody.max_tokens ?? null,
    temperature: assembled.requestBody.temperature ?? null,
    top_p: assembled.requestBody.top_p ?? null,
    adaptation_removed: assembled.adaptationKeyDiff.removed,
    adaptation_added: assembled.adaptationKeyDiff.added,
  };

  // §4 usage API probe
  const probe = await fetchCiUsageRequests({ limit: 3 });
  let usageApiAvailable = probe.ok;
  let usageApiBlockedReason: string | null = null;
  if (!probe.ok) {
    usageApiAvailable = false;
    usageApiBlockedReason = `HTTP ${probe.status}: ${probe.error}`;
  }

  const d1Runs = loadD1CiRuns();
  const ciRuns = d1Runs.filter((r) => r.provider === "cheaperinference");
  const uniqueIds = [...new Set(ciRuns.map((r) => r.provider_request_id).filter(Boolean))] as string[];

  // D.1 window: 2026-08-30 UTC audit day
  const startAt = "2026-08-30T03:50:00Z";
  const endAt = "2026-08-30T05:00:00Z";
  let usageRecords: ReturnType<typeof indexUsageByRequestId> extends Map<string, infer V> ? V[] : never = [];
  let fetchError: string | undefined;

  if (usageApiAvailable) {
    const fetched = await fetchAllCiUsageInWindow(startAt, endAt, 10);
    if (!fetched.ok) {
      usageApiAvailable = false;
      fetchError = fetched.error;
      usageApiBlockedReason = fetchError ?? `HTTP ${fetched.status}`;
    } else {
      usageRecords = fetched.records;
    }
  }

  const usageIndex = indexUsageByRequestId(usageRecords);
  const usedUsageIds = new Set<string>();
  const joined = [];
  let matched = 0;
  let matchedByRequestId = 0;
  let matchedByTokenFingerprint = 0;

  for (const run of ciRuns) {
    const id = run.provider_request_id;
    const { usage, joinMethod } = joinUsageToRun(run, usageIndex, usageRecords, usedUsageIds);
    if (usage) {
      matched += 1;
      if (joinMethod === "request_id") matchedByRequestId += 1;
      if (joinMethod === "token_fingerprint") matchedByTokenFingerprint += 1;
    }

    const usageTtft = usage?.time_to_first_token_ms ?? null;
    const usageTotal = usage?.total_latency_ms ?? null;
    const ttftClass = closestTtftTarget(
      typeof usageTtft === "number" ? usageTtft : null,
      {
        first_sse: run.request_to_first_sse_ms,
        first_reasoning: run.request_to_first_reasoning_ms,
        first_visible: run.request_to_first_visible_ms,
      }
    );

    joined.push({
      client_source: run.source,
      client_request_id: id,
      join_method: joinMethod,
      matched: !!usage,
      usage_record_id: usage ? pickRequestId(usage) : null,
      model: usage?.model ?? null,
      status: usage?.status ?? null,
      prompt_tokens_usage: usage?.prompt_tokens ?? null,
      completion_tokens_usage: usage?.completion_tokens ?? null,
      client_reasoning_tokens: run.reasoning_tokens,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? null,
      cache_write_input_tokens: usage?.cache_write_input_tokens ?? null,
      cache_read_class: classifyCacheField(usage?.cache_read_input_tokens),
      cache_write_class: classifyCacheField(usage?.cache_write_input_tokens),
      billed_cost_usd: usage?.billed_cost_usd ?? null,
      total_latency_ms: usageTotal,
      time_to_first_token_ms: usageTtft,
      client_stream_complete_ms: run.request_to_stream_complete_ms,
      total_latency_delta_ms:
        usageTotal != null && run.request_to_stream_complete_ms != null
          ? usageTotal - run.request_to_stream_complete_ms
          : null,
      client_first_sse_ms: run.request_to_first_sse_ms,
      client_first_reasoning_ms: run.request_to_first_reasoning_ms,
      client_first_visible_ms: run.request_to_first_visible_ms,
      ttft_closest_to: ttftClass.closest,
      ttft_deltas: ttftClass.deltas,
      created_at: usage?.created_at ?? null,
      completed_at: usage?.completed_at ?? null,
    });
  }

  const cacheClasses = joined.map((j) => j.cache_read_class);
  let cacheReportingOwner = "CACHE_READ_NOT_RECORDED";
  if (cacheClasses.some((c) => c === "RECORDED_NONZERO")) {
    cacheReportingOwner = "CI_USAGE_API_AVAILABLE; STREAM_USAGE_INCOMPLETE if stream lacked cache";
  } else if (cacheClasses.every((c) => c === "RECORDED_ZERO")) {
    cacheReportingOwner = "CACHE_READ_RECORDED_ZERO";
  } else if (cacheClasses.some((c) => c === "RECORDED_ZERO")) {
    cacheReportingOwner = "MIXED";
  }

  const ttftClosestCounts = joined
    .filter((j) => j.matched && j.ttft_closest_to !== "UNKNOWN")
    .reduce(
      (acc, j) => {
        acc[j.ttft_closest_to] = (acc[j.ttft_closest_to] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

  const report = {
    generatedAt: new Date().toISOString(),
    CI_USAGE_API_AVAILABLE: usageApiAvailable,
    CI_USAGE_API_BLOCKED_REASON: usageApiBlockedReason,
    PRODUCTION_WIRE: wire,
    D1_CI_RUNS_TOTAL: ciRuns.length,
    D1_UNIQUE_REQUEST_IDS: uniqueIds.length,
    D1_REQUESTS_MATCHED: `${matched}/${ciRuns.length}`,
    D1_MATCHED_BY_REQUEST_ID: matchedByRequestId,
    D1_MATCHED_BY_TOKEN_FINGERPRINT: matchedByTokenFingerprint,
    USAGE_WINDOW: { startAt, endAt },
    USAGE_RECORDS_FETCHED: usageRecords.length,
    CACHE_REPORTING_OWNER: cacheReportingOwner,
    STREAM_CACHE_REPORTING: "UNAVAILABLE (stream usage lacks cache_read in D.1 probes)",
    CI_USAGE_TTFT_AVAILABLE: joined.some((j) => usageFieldPresent(j.time_to_first_token_ms)),
    CI_TTFT_CLOSEST_TO_COUNTS: ttftClosestCounts,
    joined,
    sample_usage_record_keys:
      usageRecords.length > 0 ? Object.keys(usageRecords[0]!).sort() : [],
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
