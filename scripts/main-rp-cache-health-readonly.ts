/**
 * Read-only Main RP cache health snapshot — CI usage API only.
 * provider generation calls = 0
 */
import { writeFileSync } from "node:fs";
import { resolveBenchmarkCheaperInferenceApiKey } from "./lib/benchmarkCheaperInferenceCredential";

const MODELS = [
  "deepseek-v4-pro-0813",
  "gemini-3.1-pro-preview",
  "gemini-3.7-flash",
];

const key = resolveBenchmarkCheaperInferenceApiKey();
if (!key) {
  console.error("NOT_RUN — missing CHEAPER_INFERENCE_BENCHMARK_API_KEY");
  console.log("provider calls=0");
  process.exit(0);
}

type Row = Record<string, unknown>;

function fmt(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function fetchPage(startAt: string, endAt: string, cursor?: string) {
  const params = new URLSearchParams({ start_at: startAt, end_at: endAt, limit: "100" });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`https://api.cheaperinference.com/v1/usage/requests?${params}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { data?: Row[]; next_cursor?: string | null };
}

function pick(row: Row) {
  const prompt = Number(row.prompt_tokens ?? 0);
  const cacheRead = Number(row.cache_read_input_tokens ?? 0);
  const cacheWrite = Number(row.cache_write_input_tokens ?? 0);
  const standard = Math.max(0, prompt - cacheRead - cacheWrite);
  return {
    request_id: row.request_id,
    created_at: row.created_at,
    model: row.model,
    endpoint: row.endpoint,
    status: row.status,
    prompt_tokens: prompt,
    completion_tokens: row.completion_tokens,
    cache_read_input_tokens: cacheRead,
    cache_write_input_tokens: cacheWrite,
    standard_input_tokens: standard,
    billed_cost_usd: row.billed_cost_usd,
    provider_attempt_count: row.provider_attempt_count,
    cache_reporting_state: row.cache_reporting_state,
    routing_overhead_ms: row.routing_overhead_ms,
    time_to_response_headers_ms: row.time_to_response_headers_ms,
  };
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function summarize(rows: Row[], startAt: string, endAt: string) {
  const picked = rows.map(pick).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const withCacheRead = picked.filter((r) => r.cache_read_input_tokens > 0);
  const withCacheWrite = picked.filter((r) => r.cache_write_input_tokens > 0);
  const multiAttempt = picked.filter((r) => Number(r.provider_attempt_count ?? 1) > 1);
  const cacheRatio = picked.map((r) =>
    r.prompt_tokens > 0 ? r.cache_read_input_tokens / r.prompt_tokens : 0
  );
  return {
    sampleCount: picked.length,
    window: { startAt, endAt },
    cacheReadPositiveCount: withCacheRead.length,
    cacheWritePositiveCount: withCacheWrite.length,
    cacheReadRatioMedian: median(cacheRatio),
    cacheReadRatioMax: cacheRatio.length ? Math.max(...cacheRatio) : 0,
    providerAttemptGt1Count: multiAttempt.length,
    cacheReportingStates: [...new Set(picked.map((r) => String(r.cache_reporting_state ?? "null")))],
    recent: picked.slice(-8),
    cacheReadExamples: withCacheRead.slice(-8),
    multiAttemptExamples: multiAttempt.slice(0, 8),
    allRows: picked,
  };
}

async function main() {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 3600 * 1000);
  const startAt = fmt(start);
  const endAt = fmt(end);

  const byModel: Record<string, Row[]> = Object.fromEntries(MODELS.map((m) => [m, []]));
  let cursor: string | null | undefined = undefined;
  let pages = 0;
  let totalScanned = 0;
  const maxPages = 100;

  do {
    const payload = await fetchPage(startAt, endAt, cursor ?? undefined);
    const items = payload.data ?? [];
    totalScanned += items.length;
    for (const item of items) {
      const model = String(item.model ?? "").trim().toLowerCase();
      if (MODELS.includes(model)) byModel[model]!.push(item);
    }
    cursor = payload.next_cursor ?? null;
    pages += 1;
  } while (cursor && pages < maxPages);

  const modelsRes = await fetch("https://api.cheaperinference.com/v1/models", {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const modelsJson = (await modelsRes.json()) as { data?: Row[] };
  const catalog = Object.fromEntries(
    MODELS.map((id) => {
      const row = (modelsJson.data ?? []).find((m) => String(m.id).toLowerCase() === id);
      const pricing = (row?.pricing ?? {}) as Row;
      return [
        id,
        {
          id: row?.id ?? null,
          cache_read_input_per_million: pricing.cache_read_input_per_million ?? null,
          cache_write_input_per_million: pricing.cache_write_input_per_million ?? null,
          input_per_million: pricing.input_per_million ?? null,
          output_per_million: pricing.output_per_million ?? null,
        },
      ];
    })
  );

  const summaries = Object.fromEntries(
    MODELS.map((m) => {
      const s = summarize(byModel[m] ?? [], startAt, endAt);
      const { allRows, ...rest } = s;
      return [m, rest];
    })
  );

  const out = {
    generatedAt: new Date().toISOString(),
    audit: "main-rp-cache-health-read-only",
    query: {
      startAt,
      endAt,
      pagesScanned: pages,
      totalRequestsScanned: totalScanned,
      paginationComplete: !cursor,
    },
    providerCatalogCapability: catalog,
    models: summaries,
    rawCounts: Object.fromEntries(MODELS.map((m) => [m, (byModel[m] ?? []).length])),
  };

  writeFileSync(
    "docs/audits/main-rp-cache-health-2026-09-19/ci-usage-snapshot.json",
    JSON.stringify(out, null, 2)
  );

  console.log(
    JSON.stringify(
      {
        rawCounts: out.rawCounts,
        paginationComplete: out.query.paginationComplete,
        pages: out.pagesScanned,
        totalScanned,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
