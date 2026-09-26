import type Database from "better-sqlite3";
import {
  buildOpenRouterHeaders,
  OPENROUTER_BASE_URL,
  resolveOpenRouterApiKey,
} from "@/lib/openRouterConfig";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import { recordBackgroundProviderCost } from "@/lib/providerCostLedger";
import { buildAuxProviderCallLogInput, logAuxProviderCall } from "@/lib/auxProviderProvenance";

/**
 * Canonical owner for the OpenRouter Embeddings API (`POST /api/v1/embeddings`).
 * Separate from chat completions and from the Jev Decisions transport — the
 * endpoint semantics differ — but auth/headers, usage parsing, the cost ledger,
 * and provenance logging are the shared canonical primitives, not re-implemented.
 *
 * Wire contract verified against the official OpenAPI spec
 * (https://openrouter.ai/openapi.json, `/embeddings`): request
 * `{ model, input: string[], encoding_format, dimensions?, provider }` where
 * `provider` is `ProviderPreferences` (includes `zdr`, `data_collection`);
 * response `{ object, data: [{ object, embedding, index? }], model, usage: { prompt_tokens, total_tokens, cost? } }`.
 *
 * Privacy: every request carries `provider: { zdr: true, data_collection: "deny" }`.
 * Per the spec, routing then returns an error when no compliant endpoint exists.
 * ZDR means the endpoint does not retain the text — the provider still receives
 * and processes it. Callers own what text they send.
 *
 * Failure policy: one attempt, no retry/fallback fan-out; every malformed
 * response throws `OpenRouterEmbeddingsError` so callers fall back to lexical.
 */
export const OPENROUTER_EMBEDDINGS_URL = `${OPENROUTER_BASE_URL}/embeddings`;

export const OPENROUTER_EMBEDDINGS_PROVIDER_POLICY = {
  zdr: true,
  data_collection: "deny",
} as const;

export const OPENROUTER_EMBEDDINGS_MAX_INPUTS = 64;

export class OpenRouterEmbeddingsError extends Error {
  readonly httpStatus: number | null;
  readonly code:
    | "invalid_request"
    | "missing_key"
    | "transport_error"
    | "http_error"
    | "invalid_response";

  constructor(opts: { message: string; code: OpenRouterEmbeddingsError["code"]; httpStatus?: number | null }) {
    super(opts.message);
    this.name = "OpenRouterEmbeddingsError";
    this.code = opts.code;
    this.httpStatus = opts.httpStatus ?? null;
  }
}

export type OpenRouterEmbeddingsLedgerOptions = {
  db?: Database.Database;
  persistInTests?: boolean;
};

export type OpenRouterEmbeddingsUsage = {
  inputTokens: number;
  estimated: boolean;
  upstreamCostUsd?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeResponseModelId(value: string): string {
  return value.trim().toLowerCase();
}

function isExactOrDatedModelId(served: string, acceptedBase: string): boolean {
  const normalizedServed = normalizeResponseModelId(served);
  const normalizedBase = normalizeResponseModelId(acceptedBase);
  if (normalizedServed === normalizedBase) return true;
  const escaped = normalizedBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}-\\d{8}$`).test(normalizedServed);
}

/**
 * OpenRouter's embeddings response `model` is the model used, but live provider
 * responses are not guaranteed to byte-match the requested OpenRouter slug.
 * Stay fail-closed: case differences are normalized, while any vendor/provider
 * naming difference must be explicitly allowlisted by the model config.
 */
function isServedModelOf(
  served: string,
  requested: string,
  responseModelAliases: readonly string[] = []
): boolean {
  return [requested, ...responseModelAliases].some((accepted) =>
    isExactOrDatedModelId(served, accepted)
  );
}

function recordLedger(
  ledger: OpenRouterEmbeddingsLedgerOptions | null | undefined,
  input: {
    model: string;
    requestKind: string;
    usage: OpenRouterEmbeddingsUsage;
    providerRequestId: string | null;
    httpStatus: number | null;
    outcome: "success" | "failed_without_usage";
  }
): void {
  if (ledger === null) return;
  try {
    recordBackgroundProviderCost(
      {
        provider: "openrouter",
        model: input.model,
        requestKind: input.requestKind,
        inputTokens: input.usage.inputTokens,
        outputTokens: 0,
        upstreamCostUsd: input.usage.upstreamCostUsd,
        usageEstimated: input.usage.estimated,
        providerRequestId: input.providerRequestId,
        httpStatus: input.httpStatus,
        outcome: input.outcome,
        persistInTests: ledger?.persistInTests,
      },
      ledger?.db
    );
  } catch (error) {
    console.warn("[openrouter-embeddings] ledger record skipped:", (error as Error).message);
  }
}

export async function callOpenRouterEmbeddings(opts: {
  model: string;
  inputs: readonly string[];
  /** Expected vector length; any other length fails closed. */
  dimensions: number;
  /** Sent as the official `dimensions` field only when set. */
  requestDimensions?: number;
  /**
   * Explicit model-name aliases accepted in OpenRouter's response `model`.
   * Matching is case-insensitive; arbitrary vendor/provider prefix stripping is
   * intentionally not supported.
   */
  responseModelAliases?: readonly string[];
  requestKind: string;
  timeoutMs: number;
  /** Null skips ledger recording (wire-contract tests); omitted records canonically. */
  ledger?: OpenRouterEmbeddingsLedgerOptions | null;
  /**
   * Explicit credential supplied by a benchmark-only credential owner. This
   * transport never reads benchmark env vars; without it the canonical
   * production resolver is used. Production callers never pass it.
   */
  apiKey?: string;
}): Promise<{ vectors: number[][]; usage: OpenRouterEmbeddingsUsage; responseModel: string }> {
  const { model, inputs, dimensions, requestKind } = opts;
  if (
    !model.trim() ||
    !Number.isInteger(dimensions) ||
    dimensions <= 0 ||
    inputs.length === 0 ||
    inputs.length > OPENROUTER_EMBEDDINGS_MAX_INPUTS ||
    inputs.some((text) => typeof text !== "string" || !text.trim())
  ) {
    throw new OpenRouterEmbeddingsError({
      message: `[openrouter-embeddings] request needs a model, dimensions, and 1..${OPENROUTER_EMBEDDINGS_MAX_INPUTS} non-empty inputs`,
      code: "invalid_request",
    });
  }

  let key: string;
  try {
    key = opts.apiKey?.trim() || resolveOpenRouterApiKey();
  } catch {
    throw new OpenRouterEmbeddingsError({
      message: "[openrouter-embeddings] OPENROUTER_API_KEY is not configured",
      code: "missing_key",
    });
  }

  const body = {
    model,
    input: [...inputs],
    encoding_format: "float" as const,
    ...(opts.requestDimensions != null ? { dimensions: opts.requestDimensions } : {}),
    provider: OPENROUTER_EMBEDDINGS_PROVIDER_POLICY,
  };
  logAuxProviderCall(buildAuxProviderCallLogInput({ model, messages: body.input, requestKind }));

  const fail = (
    message: string,
    code: OpenRouterEmbeddingsError["code"],
    httpStatus: number | null,
    providerRequestId: string | null
  ): never => {
    recordLedger(opts.ledger, {
      model,
      requestKind,
      usage: { inputTokens: 0, estimated: true },
      providerRequestId,
      httpStatus,
      outcome: "failed_without_usage",
    });
    throw new OpenRouterEmbeddingsError({ message, code, httpStatus });
  };

  let res: Response;
  try {
    res = await fetch(OPENROUTER_EMBEDDINGS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(key),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (error) {
    return fail(`[openrouter-embeddings] transport error: ${(error as Error).message}`, "transport_error", null, null);
  }

  const providerRequestId =
    res.headers.get("x-request-id") ?? res.headers.get("x-openrouter-request-id");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return fail(`[openrouter-embeddings] HTTP ${res.status}: ${text.slice(0, 240)}`, "http_error", res.status, providerRequestId);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return fail("[openrouter-embeddings] response is not valid JSON", "invalid_response", res.status, providerRequestId);
  }
  if (!isRecord(data) || !Array.isArray(data.data)) {
    return fail("[openrouter-embeddings] response needs a data array", "invalid_response", res.status, providerRequestId);
  }
  if (
    typeof data.model !== "string" ||
    !isServedModelOf(data.model, model, opts.responseModelAliases)
  ) {
    return fail(
      `[openrouter-embeddings] served model ${JSON.stringify(data.model)} does not match requested ${JSON.stringify(model)}`,
      "invalid_response",
      res.status,
      providerRequestId
    );
  }
  if (data.data.length !== inputs.length) {
    return fail(
      `[openrouter-embeddings] expected ${inputs.length} embeddings, got ${data.data.length}`,
      "invalid_response",
      res.status,
      providerRequestId
    );
  }

  const vectors: Array<number[] | undefined> = new Array(inputs.length);
  data.data.forEach((item, position) => {
    if (!isRecord(item) || !Array.isArray(item.embedding)) {
      fail(`[openrouter-embeddings] data[${position}] needs a float embedding array`, "invalid_response", res.status, providerRequestId);
    }
    const record = item as Record<string, unknown>;
    const index = record.index === undefined ? position : record.index;
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= inputs.length || vectors[index as number]) {
      fail(`[openrouter-embeddings] data[${position}] has an invalid or duplicate index`, "invalid_response", res.status, providerRequestId);
    }
    const embedding = record.embedding as unknown[];
    if (embedding.length !== dimensions) {
      fail(
        `[openrouter-embeddings] data[${position}] has ${embedding.length} dimensions, expected ${dimensions}`,
        "invalid_response",
        res.status,
        providerRequestId
      );
    }
    if (embedding.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
      fail(`[openrouter-embeddings] data[${position}] contains a non-finite value`, "invalid_response", res.status, providerRequestId);
    }
    vectors[index as number] = embedding as number[];
  });

  if (!isRecord(data.usage) || typeof data.usage.prompt_tokens !== "number" || !Number.isFinite(data.usage.prompt_tokens)) {
    return fail("[openrouter-embeddings] response needs usage.prompt_tokens", "invalid_response", res.status, providerRequestId);
  }
  const breakdown = parseOpenRouterUsage(data.usage, res.headers);
  const usage: OpenRouterEmbeddingsUsage = {
    inputTokens: breakdown.promptTokens,
    estimated: breakdown.estimated,
    ...(breakdown.upstreamCostUsd != null ? { upstreamCostUsd: breakdown.upstreamCostUsd } : {}),
  };
  recordLedger(opts.ledger, {
    model,
    requestKind,
    usage,
    providerRequestId,
    httpStatus: res.status,
    outcome: "success",
  });
  return { vectors: vectors as number[][], usage, responseModel: data.model };
}
