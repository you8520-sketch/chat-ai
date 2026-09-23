/**
 * Phase D.3 — build provider-verifiable escalation evidence from frozen artifacts.
 * No prompt/response bodies. No live inference.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type JoinQuality =
  | "EXACT_UUID_JOIN"
  | "HEADER_ID_CORRELATED"
  | "TOKEN_FINGERPRINT_JOIN"
  | "TIMESTAMP_ONLY";

export type EvidenceRow = {
  sample: string;
  join_quality: JoinQuality;
  CI_USAGE_REQUEST_UUID: string | null;
  x_ci_request_id: string | null;
  stream_provider_request_id: string | null;
  timestamp: string | null;
  model: string;
  reasoning_control_variant: string;
  request_body_semantic_hash: string | null;
  messages_hash: string | null;
  system_hash: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  reasoning_tokens: number | null;
  cache_read_input_tokens: number | null;
  cache_write_input_tokens: number | null;
  time_to_first_token_ms: number | null;
  total_latency_ms: number | null;
  client_first_sse_ms: number | null;
  client_first_visible_ms: number | null;
  client_stream_complete_ms: number | null;
  x_ci_cache: string | null;
  notes: string | null;
};

export function sha256(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

export function classifyAliasJoin(
  ciRequestId: string | null | undefined,
  usageRecordId: string | null | undefined,
  matched: boolean
): JoinQuality {
  if (!matched || !ciRequestId) return "TIMESTAMP_ONLY";
  if (usageRecordId && ciRequestId === usageRecordId) return "EXACT_UUID_JOIN";
  if (usageRecordId) return "HEADER_ID_CORRELATED";
  return "TIMESTAMP_ONLY";
}

export function classifyD1Join(joinMethod: string | undefined): JoinQuality {
  if (joinMethod === "request_id") return "EXACT_UUID_JOIN";
  if (joinMethod === "token_fingerprint") return "TOKEN_FINGERPRINT_JOIN";
  return "TIMESTAMP_ONLY";
}

type AliasRun = Record<string, unknown>;
type ReconcileRow = Record<string, unknown>;

export function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function buildEscalationEvidence(opts: {
  d1ArtifactDir?: string;
  d2ArtifactDir?: string;
  systemHash?: string;
}): {
  generatedAt: string;
  EXACT_REQUEST_IDS_AVAILABLE: boolean;
  NEW_INFERENCE_CALLS: number;
  primary_join_counts: Record<JoinQuality, number>;
  rows: EvidenceRow[];
} {
  const d1Dir = opts.d1ArtifactDir ?? "/opt/cursor/artifacts/gemini31-phase-d1-reasoning";
  const d2Dir = opts.d2ArtifactDir ?? "/opt/cursor/artifacts/gemini31-phase-d2-reasoning";

  const parityPath = path.join(d1Dir, "request-parity.json");
  const parityMeta = fs.existsSync(parityPath)
    ? loadJson<{ SYSTEM_HASH?: string; MESSAGES_HASH?: string }>(parityPath)
    : {};
  const systemHash = opts.systemHash ?? parityMeta.SYSTEM_HASH ?? null;

  const alias = loadJson<{ runs: AliasRun[] }>(path.join(d2Dir, "reasoning-alias.json"));
  const aliasJoin = loadJson<{ joined: Array<Record<string, unknown>> }>(
    path.join(d2Dir, "alias-usage-join.json")
  );
  const reconcile = loadJson<{ joined: ReconcileRow[] }>(path.join(d2Dir, "usage-reconcile.json"));
  const parity = loadJson<{ paired: Array<{ pair: number; ci: Record<string, unknown>; or: Record<string, unknown> }> }>(
    path.join(d1Dir, "ci-or-comparator-parity.json")
  );
  const prodLike = loadJson<{ paired: Array<{ cheaperinference: Record<string, unknown>; openrouter: Record<string, unknown> }> }>(
    path.join(d1Dir, "production-like-comparator.json")
  );

  const aliasJoinById = new Map(aliasJoin.joined.map((j) => [String(j.ci_request_id ?? ""), j]));

  const exactAliasRuns = alias.runs
    .map((run) => {
      const id = String(run.ci_request_id ?? "");
      const join = aliasJoinById.get(id);
      const matched = Boolean(join?.matched);
      const jq = classifyAliasJoin(id, join?.usage_record_id as string | undefined, matched);
      return { run, join, jq, matched };
    })
    .filter((x) => x.jq === "EXACT_UUID_JOIN");

  const joinCounts: Record<JoinQuality, number> = {
    EXACT_UUID_JOIN: exactAliasRuns.length,
    HEADER_ID_CORRELATED: 0,
    TOKEN_FINGERPRINT_JOIN: reconcile.joined.filter((j) => j.join_method === "token_fingerprint").length,
    TIMESTAMP_ONLY: aliasJoin.joined.filter((j) => !j.matched).length,
  };

  const rows: EvidenceRow[] = [];

  function pushAliasSample(
    sample: string,
    pick: (runs: typeof exactAliasRuns) => (typeof exactAliasRuns)[0] | undefined,
    notes: string
  ) {
    const picked = pick(exactAliasRuns);
    if (!picked) return;
    const { run, join } = picked;
    const variant = String(run.variant ?? "?");
    const control =
      variant === "A"
        ? "reasoning_effort=low"
        : variant === "B"
          ? "reasoning={effort:low}"
          : "omitted";
    rows.push({
      sample,
      join_quality: "EXACT_UUID_JOIN",
      CI_USAGE_REQUEST_UUID: String(join?.usage_record_id ?? run.ci_request_id ?? ""),
      x_ci_request_id: String(run.ci_request_id ?? ""),
      stream_provider_request_id: String(run.provider_request_id ?? "") || null,
      timestamp: String(join?.created_at ?? run.created_at ?? "") || null,
      model: "gemini-3.1-pro-preview",
      reasoning_control_variant: control,
      request_body_semantic_hash: String(run.reasoning_control_hash ?? "") || null,
      messages_hash: String(run.messages_hash ?? "") || null,
      system_hash: systemHash,
      prompt_tokens: num(run.prompt_tokens),
      completion_tokens: num(run.completion_tokens),
      reasoning_tokens: num(run.reasoning_tokens),
      cache_read_input_tokens: num(join?.cache_read_input_tokens),
      cache_write_input_tokens: null,
      time_to_first_token_ms: num(join?.time_to_first_token_ms),
      total_latency_ms: num(join?.total_latency_ms),
      client_first_sse_ms: num(run.request_to_first_sse_ms),
      client_first_visible_ms: num(run.request_to_first_visible_ms),
      client_stream_complete_ms: num(run.request_to_stream_complete_ms),
      x_ci_cache: String(run.x_ci_cache ?? "") || null,
      notes,
    });
  }

  // Representative exact-UUID alias samples (not cherry-pick worst only)
  const aRuns = exactAliasRuns.filter((x) => x.run.variant === "A");
  aRuns.sort(
    (x, y) =>
      num(x.run.request_to_first_visible_ms)! - num(y.run.request_to_first_visible_ms)!
  );
  const medIdx = Math.floor(aRuns.length / 2);
  pushAliasSample(
    "normal_ci_low_exact",
    () => aRuns[medIdx],
    "D.2 alias variant A; median first-visible among exact-UUID A runs"
  );
  pushAliasSample(
    "slow_ci_low_exact",
    () => aRuns[Math.min(aRuns.length - 2, Math.ceil(aRuns.length * 0.75))],
    "D.2 alias variant A; ~75th percentile first-visible (not absolute worst)"
  );
  pushAliasSample(
    "alias_b_reasoning_object_low",
    () => exactAliasRuns.find((x) => x.run.variant === "B"),
    "D.2 alias variant B; OpenRouter-style reasoning object"
  );
  pushAliasSample(
    "alias_c_omitted_control",
    () => exactAliasRuns.find((x) => x.run.variant === "C"),
    "D.2 alias variant C; no reasoning control"
  );

  // D.1 paired CI/OR — TOKEN_FINGERPRINT_JOIN only; label honestly
  const d1Matched = reconcile.joined.filter((j) => j.matched);
  const parityPairs = parity.paired.map((p) => {
    const ci = p.ci;
    const usage = d1Matched.find(
      (j) =>
        j.client_reasoning_tokens === ci.reasoning_tokens &&
        j.prompt_tokens_usage === ci.prompt_tokens &&
        j.completion_tokens_usage === ci.completion_tokens
    );
    return { pair: p.pair, ci, or: p.or, usage };
  });

  const parityMed =
    parityPairs.slice().sort((a, b) => Number(a.ci.reasoning_tokens) - Number(b.ci.reasoning_tokens))[
      Math.floor(parityPairs.length / 2)
    ];
  if (parityMed?.usage) {
    const u = parityMed.usage;
    rows.push({
      sample: "paired_ci_or_ci_side",
      join_quality: "TOKEN_FINGERPRINT_JOIN",
      CI_USAGE_REQUEST_UUID: String(u.usage_record_id ?? ""),
      x_ci_request_id: null,
      stream_provider_request_id: String(parityMed.ci.provider_request_id ?? "") || null,
      timestamp: String(u.created_at ?? "") || null,
      model: "gemini-3.1-pro-preview",
      reasoning_control_variant: "reasoning_effort=low (production wire)",
      request_body_semantic_hash: null,
      messages_hash: parityMeta.MESSAGES_HASH ?? null,
      system_hash: systemHash,
      prompt_tokens: num(u.prompt_tokens_usage),
      completion_tokens: num(u.completion_tokens_usage),
      reasoning_tokens: num(u.client_reasoning_tokens),
      cache_read_input_tokens: num(u.cache_read_input_tokens),
      cache_write_input_tokens: num(u.cache_write_input_tokens),
      time_to_first_token_ms: num(u.time_to_first_token_ms),
      total_latency_ms: num(u.total_latency_ms),
      client_first_sse_ms: num(u.client_first_sse_ms),
      client_first_visible_ms: num(u.client_first_visible_ms),
      client_stream_complete_ms: num(u.client_stream_complete_ms),
      x_ci_cache: null,
      notes: `D.1 parity pair ${parityMed.pair}; OR reasoning=${parityMed.or.reasoning_tokens} first_visible=${Math.round(Number(parityMed.or.request_to_first_visible_ms))}ms routed=${parityMed.or.or_routed_provider}; join via prompt+completion tokens not stream gen-* id`,
    });
    rows.push({
      sample: "paired_ci_or_or_reference",
      join_quality: "TIMESTAMP_ONLY",
      CI_USAGE_REQUEST_UUID: null,
      x_ci_request_id: null,
      stream_provider_request_id: String(parityMed.or.provider_request_id ?? "") || null,
      timestamp: null,
      model: "google/gemini-3.1-pro-preview",
      reasoning_control_variant: "reasoning={effort:low}, include_reasoning=false",
      request_body_semantic_hash: null,
      messages_hash: parityMeta.MESSAGES_HASH ?? null,
      system_hash: systemHash,
      prompt_tokens: num(parityMed.or.prompt_tokens),
      completion_tokens: num(parityMed.or.completion_tokens),
      reasoning_tokens: num(parityMed.or.reasoning_tokens),
      cache_read_input_tokens: null,
      cache_write_input_tokens: null,
      time_to_first_token_ms: null,
      total_latency_ms: null,
      client_first_sse_ms: num(parityMed.or.request_to_first_sse_ms),
      client_first_visible_ms: num(parityMed.or.request_to_first_visible_ms),
      client_stream_complete_ms: num(parityMed.or.request_to_stream_complete_ms),
      x_ci_cache: null,
      notes: `D.1 parity pair ${parityMed.pair} OpenRouter reference; no CI usage UUID`,
    });
  }

  // Production-like comparator
  const prodPairs = prodLike.paired ?? [];
  if (prodPairs.length > 0) {
    const prod = prodPairs[0]!;
    const ci = prod.cheaperinference;
    const usage = d1Matched.find(
      (j) =>
        j.client_reasoning_tokens === ci.reasoning_tokens &&
        j.prompt_tokens_usage === ci.prompt_tokens
    );
    if (usage) {
      rows.push({
        sample: "production_like_ci",
        join_quality: classifyD1Join(String(usage.join_method ?? "")),
        CI_USAGE_REQUEST_UUID: String(usage.usage_record_id ?? ""),
        x_ci_request_id: null,
        stream_provider_request_id: String(ci.provider_request_id ?? "") || null,
        timestamp: String(usage.created_at ?? "") || null,
        model: "gemini-3.1-pro-preview",
        reasoning_control_variant: "reasoning_effort=low (production wire)",
        request_body_semantic_hash: null,
        messages_hash: null,
        system_hash: systemHash,
        prompt_tokens: num(usage.prompt_tokens_usage),
        completion_tokens: num(usage.completion_tokens_usage),
        reasoning_tokens: num(usage.client_reasoning_tokens),
        cache_read_input_tokens: num(usage.cache_read_input_tokens),
        cache_write_input_tokens: num(usage.cache_write_input_tokens),
        time_to_first_token_ms: num(usage.time_to_first_token_ms),
        total_latency_ms: num(usage.total_latency_ms),
        client_first_sse_ms: num(usage.client_first_sse_ms),
        client_first_visible_ms: num(usage.client_first_visible_ms),
        client_stream_complete_ms: num(usage.client_stream_complete_ms),
        x_ci_cache: null,
        notes: "D.1 production-like comparator CI side; token-fingerprint usage join",
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    EXACT_REQUEST_IDS_AVAILABLE: exactAliasRuns.length >= 4,
    NEW_INFERENCE_CALLS: 0,
    primary_join_counts: joinCounts,
    rows,
  };
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
