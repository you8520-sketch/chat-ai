/**
 * Phase D.2 — CI usage API discovery + D.1 request reconciliation helpers.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  buildCheaperInferenceHeaders,
  resolveCheaperInferenceApiKey,
} from "../../src/lib/cheaperInferenceConfig";

export const CI_USAGE_REQUESTS_URL = "https://api.cheaperinference.com/v1/usage/requests";

export type CiUsageRequestRecord = {
  id?: string;
  request_id?: string;
  client_request_id?: string;
  model?: string;
  status?: string;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_write_input_tokens?: number | null;
  billed_cost_usd?: string | number | null;
  total_latency_ms?: number | null;
  time_to_first_token_ms?: number | null;
  created_at?: string;
  completed_at?: string;
  endpoint?: string;
  [key: string]: unknown;
};

export type CiUsageRequestsPage = {
  data?: CiUsageRequestRecord[];
  requests?: CiUsageRequestRecord[];
  has_more?: boolean;
  next_cursor?: string | null;
};

/** Preserve null vs explicit 0 for cache fields. */
export function classifyCacheField(value: unknown): "NOT_RECORDED" | "RECORDED_ZERO" | "RECORDED_NONZERO" {
  if (value === null || value === undefined) return "NOT_RECORDED";
  const n = Number(value);
  if (!Number.isFinite(n)) return "NOT_RECORDED";
  return n > 0 ? "RECORDED_NONZERO" : "RECORDED_ZERO";
}

export function usageFieldPresent(value: unknown): boolean {
  return value !== null && value !== undefined;
}

export function pickRequestId(record: CiUsageRequestRecord): string | null {
  for (const k of ["id", "request_id", "client_request_id"] as const) {
    const v = record[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export function closestTtftTarget(
  usageTtft: number | null,
  client: {
    first_sse: number | null;
    first_reasoning: number | null;
    first_visible: number | null;
  }
): { closest: "FIRST_SSE" | "FIRST_REASONING" | "FIRST_VISIBLE" | "UNKNOWN"; deltas: Record<string, number | null> } {
  if (usageTtft == null || !Number.isFinite(usageTtft)) {
    return { closest: "UNKNOWN", deltas: {} };
  }
  const candidates: Array<["FIRST_SSE" | "FIRST_REASONING" | "FIRST_VISIBLE", number | null]> = [
    ["FIRST_SSE", client.first_sse],
    ["FIRST_REASONING", client.first_reasoning],
    ["FIRST_VISIBLE", client.first_visible],
  ];
  let closest: "FIRST_SSE" | "FIRST_REASONING" | "FIRST_VISIBLE" | "UNKNOWN" = "UNKNOWN";
  let minDelta = Infinity;
  const deltas: Record<string, number | null> = {};
  for (const [label, clientMs] of candidates) {
    if (clientMs == null || !Number.isFinite(clientMs)) {
      deltas[label] = null;
      continue;
    }
    const delta = Math.abs(usageTtft - clientMs);
    deltas[label] = usageTtft - clientMs;
    if (delta < minDelta) {
      minDelta = delta;
      closest = label;
    }
  }
  return { closest, deltas };
}

export async function fetchCiUsageRequests(opts: {
  limit?: number;
  cursor?: string;
  startAt?: string;
  endAt?: string;
}): Promise<{ ok: boolean; status: number; page: CiUsageRequestsPage | null; error?: string }> {
  const params = new URLSearchParams();
  params.set("limit", String(opts.limit ?? 100));
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.startAt) params.set("start_at", opts.startAt);
  if (opts.endAt) params.set("end_at", opts.endAt);

  const res = await fetch(`${CI_USAGE_REQUESTS_URL}?${params}`, {
    headers: buildCheaperInferenceHeaders(resolveCheaperInferenceApiKey()),
  });
  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, page: null, error: text.slice(0, 500) };
  }
  try {
    return { ok: true, status: res.status, page: JSON.parse(text) as CiUsageRequestsPage };
  } catch {
    return { ok: false, status: res.status, page: null, error: "non-json response" };
  }
}

export async function fetchAllCiUsageInWindow(startAt: string, endAt: string, maxPages = 20) {
  const all: CiUsageRequestRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchCiUsageRequests({ limit: 100, cursor, startAt, endAt });
    if (!result.ok || !result.page) return { ok: false, records: all, error: result.error, status: result.status };
    const rows = result.page.data ?? result.page.requests ?? [];
    all.push(...rows);
    if (!result.page.has_more || !result.page.next_cursor) break;
    cursor = result.page.next_cursor ?? undefined;
  }
  return { ok: true, records: all, error: undefined, status: 200 };
}

export function indexUsageByRequestId(records: CiUsageRequestRecord[]): Map<string, CiUsageRequestRecord> {
  const map = new Map<string, CiUsageRequestRecord>();
  for (const r of records) {
    const id = pickRequestId(r);
    if (id) map.set(id, r);
  }
  return map;
}

export type D1ClientRun = {
  source: string;
  provider: "cheaperinference" | "openrouter";
  provider_request_id: string | null;
  reasoning_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  request_to_first_byte_ms: number | null;
  request_to_first_sse_ms: number | null;
  request_to_first_reasoning_ms: number | null;
  request_to_first_visible_ms: number | null;
  request_to_stream_complete_ms: number | null;
  visible_chars: number;
  finish_reason: string | null;
  ci_route_metadata?: unknown;
  generated_at_hint?: string;
};

export function loadD1CiRuns(artifactDir = "/opt/cursor/artifacts/gemini31-phase-d1-reasoning"): D1ClientRun[] {
  const files = [
    "ci-or-comparator-parity.json",
    "ci-low-self-control.json",
    "production-like-comparator.json",
  ];
  const runs: D1ClientRun[] = [];
  for (const file of files) {
    const p = path.join(artifactDir, file);
    if (!fs.existsSync(p)) continue;
    const json = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
    if (file === "ci-or-comparator-parity.json" && Array.isArray(json.paired)) {
      for (const pair of json.paired as Array<{ ci?: Record<string, unknown> }>) {
        const ci = pair.ci;
        if (!ci) continue;
        runs.push({
          source: file,
          provider: "cheaperinference",
          provider_request_id: (ci.provider_request_id as string) ?? null,
          reasoning_tokens: Number(ci.reasoning_tokens) || 0,
          prompt_tokens: Number(ci.prompt_tokens) || 0,
          completion_tokens: Number(ci.completion_tokens) || 0,
          request_to_first_byte_ms: numOrNull(ci.request_to_first_byte_ms),
          request_to_first_sse_ms: numOrNull(ci.request_to_first_sse_ms),
          request_to_first_reasoning_ms: numOrNull(ci.request_to_first_reasoning_ms),
          request_to_first_visible_ms: numOrNull(ci.request_to_first_visible_ms),
          request_to_stream_complete_ms: numOrNull(ci.request_to_stream_complete_ms),
          visible_chars: Number(ci.visible_chars) || 0,
          finish_reason: (ci.finish_reason as string) ?? null,
          generated_at_hint: json.generatedAt as string | undefined,
        });
      }
    }
    if (file === "ci-low-self-control.json" && json.runs && typeof json.runs === "object") {
      for (const [variant, arr] of Object.entries(json.runs as Record<string, unknown[]>)) {
        for (const row of arr) {
          const r = row as Record<string, unknown>;
          runs.push({
            source: `${file}:${variant}`,
            provider: "cheaperinference",
            provider_request_id: (r.provider_request_id as string) ?? null,
            reasoning_tokens: Number(r.reasoning_tokens) || 0,
            prompt_tokens: Number(r.prompt_tokens) || 0,
            completion_tokens: Number(r.completion_tokens) || 0,
            request_to_first_byte_ms: numOrNull(r.request_to_first_byte_ms),
            request_to_first_sse_ms: numOrNull(r.request_to_first_sse_ms),
            request_to_first_reasoning_ms: numOrNull(r.request_to_first_reasoning_ms),
            request_to_first_visible_ms: numOrNull(r.request_to_first_visible_ms),
            request_to_stream_complete_ms: numOrNull(r.request_to_stream_complete_ms),
            visible_chars: Number(r.visible_chars) || 0,
            finish_reason: (r.finish_reason as string) ?? null,
            generated_at_hint: json.generatedAt as string | undefined,
          });
        }
      }
    }
    if (file === "production-like-comparator.json" && Array.isArray(json.paired)) {
      for (const pair of json.paired as Array<Record<string, unknown>>) {
        const ci = pair.cheaperinference as Record<string, unknown> | undefined;
        if (!ci) continue;
        runs.push({
          source: file,
          provider: "cheaperinference",
          provider_request_id: (ci.provider_request_id as string) ?? null,
          reasoning_tokens: Number(ci.reasoning_tokens) || 0,
          prompt_tokens: Number(ci.prompt_tokens) || 0,
          completion_tokens: Number(ci.completion_tokens) || 0,
          request_to_first_byte_ms: numOrNull(ci.request_to_first_byte_ms),
          request_to_first_sse_ms: numOrNull(ci.request_to_first_sse_ms),
          request_to_first_reasoning_ms: numOrNull(ci.request_to_first_reasoning_ms),
          request_to_first_visible_ms: numOrNull(ci.request_to_first_visible_ms),
          request_to_stream_complete_ms: numOrNull(ci.request_to_stream_complete_ms),
          visible_chars: Number(ci.visible_chars) || 0,
          finish_reason: (ci.finish_reason as string) ?? null,
          generated_at_hint: json.generatedAt as string | undefined,
        });
      }
    }
  }
  return runs;
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function sha256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

/** Counterbalanced variant order for alias test blocks of 3. */
export function aliasVariantOrder(blockIndex: number): Array<"A" | "B" | "C"> {
  const orders: Array<Array<"A" | "B" | "C">> = [
    ["A", "B", "C"],
    ["B", "C", "A"],
    ["C", "A", "B"],
  ];
  return orders[blockIndex % 3]!;
}

export function buildCiAliasBody(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  variant: "A" | "B" | "C",
  baseFromProductionWire: Record<string, unknown>
): Record<string, unknown> {
  const body = { ...baseFromProductionWire, messages };
  delete body.reasoning_effort;
  delete body.reasoning;
  delete body.thinking;
  delete body.include_reasoning;
  if (variant === "A") {
    body.reasoning_effort = "low";
  } else if (variant === "B") {
    body.reasoning = { effort: "low" };
  }
  return body;
}

export function reasoningControlKeys(body: Record<string, unknown>): string[] {
  return ["reasoning_effort", "reasoning", "thinking", "include_reasoning"].filter((k) => k in body);
}

export function reasoningControlHash(body: Record<string, unknown>): string {
  const subset: Record<string, unknown> = {};
  for (const k of reasoningControlKeys(body)) subset[k] = body[k];
  return sha256(JSON.stringify(subset));
}

export type UsageJoinMethod = "request_id" | "token_fingerprint" | "none";

export function isGemini31UsageRecord(record: CiUsageRequestRecord): boolean {
  const model = String(record.model ?? "");
  return model.includes("gemini-3.1-pro");
}

/** Join D.1 client run to usage history — ID first, then unique token fingerprint. */
export function joinUsageToRun(
  run: D1ClientRun,
  usageIndex: Map<string, CiUsageRequestRecord>,
  usageRecords: CiUsageRequestRecord[],
  usedUsageIds: Set<string>
): { usage: CiUsageRequestRecord | undefined; joinMethod: UsageJoinMethod } {
  const clientId = run.provider_request_id;
  if (clientId) {
    const byId = usageIndex.get(clientId);
    if (byId) {
      const id = pickRequestId(byId);
      if (id) usedUsageIds.add(id);
      return { usage: byId, joinMethod: "request_id" };
    }
  }

  const candidates = usageRecords.filter((record) => {
    const id = pickRequestId(record);
    if (!id || usedUsageIds.has(id)) return false;
    if (!isGemini31UsageRecord(record)) return false;
    if (record.prompt_tokens !== run.prompt_tokens) return false;
    if (record.completion_tokens !== run.completion_tokens) return false;
    return true;
  });

  if (candidates.length === 1) {
    const usage = candidates[0]!;
    const id = pickRequestId(usage);
    if (id) usedUsageIds.add(id);
    return { usage, joinMethod: "token_fingerprint" };
  }

  if (candidates.length > 1 && run.request_to_stream_complete_ms != null) {
    let best: CiUsageRequestRecord | undefined;
    let bestDelta = Infinity;
    for (const record of candidates) {
      const total = record.total_latency_ms;
      if (total == null || !Number.isFinite(total)) continue;
      const delta = Math.abs(total - run.request_to_stream_complete_ms);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = record;
      }
    }
    if (best && bestDelta <= 5000) {
      const id = pickRequestId(best);
      if (id) usedUsageIds.add(id);
      return { usage: best, joinMethod: "token_fingerprint" };
    }
  }

  return { usage: undefined, joinMethod: "none" };
}
