import type Database from "better-sqlite3";
import { buildOpenRouterHeaders, resolveOpenRouterApiKey } from "@/lib/openRouterConfig";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import { recordBackgroundProviderCost } from "@/lib/providerCostLedger";
import { buildAuxProviderCallLogInput, logAuxProviderCall } from "@/lib/auxProviderProvenance";

/**
 * Independent canonical owner for the OpenRouter Decisions API
 * (TypeSafe Jev) — NOT a chat completion model.
 *
 * ONE CONTRACT = OFFICIAL DECISIONS CONTRACT. No array/object dual parsing,
 * no primitive/type aliases, no migration — there are no production call
 * sites, no persisted Jev request schema, and no legacy Jev consumers.
 *
 * Owner map:
 * - JEV_DECIDER_TRANSPORT_OWNER → callJevDecisions below (endpoint, payload,
 *   answers/usage parsing, deterministic failure policy).
 * - OPENROUTER_AUTH_OWNER → openRouterConfig (key + headers, reused primitive).
 * - DECISIONS_USAGE_OWNER → openRouterUsage.parseOpenRouterUsage (generic
 *   parser; already supports input_tokens/output_tokens/cost — no new parser).
 * - PROVIDER_COST_LEDGER_OWNER → providerCostLedger.recordBackgroundProviderCost
 *   (same canonical ledger, requestKind-scoped, costCenter "other").
 * - BACKGROUND_PROVENANCE_OWNER → auxProviderProvenance (console-only call log;
 *   the new requestKind surfaces as UNKNOWN per P0-2, never colliding).
 *
 * Explicit non-goals (separate follow-ups):
 * - Main RP picker / generative-model registry exposure (model registry untouched).
 * - `latest` alias tracking (pinned model only — no production drift).
 * - Applying Jev to any real feature (no call sites in this change).
 */

/** Candidate pinned model — never the `latest` alias (auto-drift risk). */
export const JEV_DECISIONS_MODEL = "typesafe/jev-1.13";

/** Decisions endpoint — deliberately NOT the chat/completions transport. */
export const JEV_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

/** Distinct observability identity — collides with no existing owner. */
export const JEV_DECISIONS_REQUEST_KIND = "background-jev-decision";

export type JevDecisionQuestionType = "choice" | "noul" | "score";

const JEV_DECISION_TYPES: ReadonlySet<string> = new Set(["choice", "noul", "score"]);

/**
 * Official question spec, keyed by question ID on the wire.
 * - choice criteria: Record<optionName, optionDescription> (required, max 255).
 * - noul criteria: optional { true, false } descriptions.
 * - score criteria: ordered label list (required, 2..10 levels).
 */
export type JevDecisionQuestionSpec = {
  type: JevDecisionQuestionType;
  instructions: string;
  criteria?: Record<string, string> | { true?: string; false?: string } | string[] | null;
};

export type JevDecisionQuestions = Record<string, JevDecisionQuestionSpec>;

export type JevDecisionChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
};

export type JevDecisionNoulAnswer = {
  type: "noul";
  noul: number;
};

export type JevDecisionScoreAnswer = {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
};

export type JevDecisionAnswer =
  | JevDecisionChoiceAnswer
  | JevDecisionNoulAnswer
  | JevDecisionScoreAnswer;

export type JevDecisionUsage = {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
  /** OpenRouter returned usage.cost provenance (USD), when reported. */
  upstreamCostUsd?: number;
};

export class JevDecisionsError extends Error {
  readonly httpStatus: number | null;
  readonly code: "invalid_request" | "transport_error" | "http_error" | "invalid_response";

  constructor(opts: {
    message: string;
    code: JevDecisionsError["code"];
    httpStatus?: number | null;
  }) {
    super(opts.message);
    this.name = "JevDecisionsError";
    this.code = opts.code;
    this.httpStatus = opts.httpStatus ?? null;
  }
}

export type JevDecisionsLedgerOptions = {
  db?: Database.Database;
  persistInTests?: boolean;
  requestKind?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnitProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function parseProbabilityMap(value: unknown, what: string): Record<string, number> {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new JevDecisionsError({
      message: `[jev-decisions] ${what} must be a non-empty probability map`,
      code: "invalid_response",
    });
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!isUnitProbability(v)) {
      throw new JevDecisionsError({
        message: `[jev-decisions] ${what}[${JSON.stringify(k)}] must be a number in [0,1]`,
        code: "invalid_response",
      });
    }
    out[k] = v;
  }
  return out;
}

function parseConfidence(value: unknown, what: string): number {
  if (!isUnitProbability(value)) {
    throw new JevDecisionsError({
      message: `[jev-decisions] ${what} must be a number in [0,1]`,
      code: "invalid_response",
    });
  }
  return value;
}

function parseLegend(value: unknown, what: string): Record<string, string> {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new JevDecisionsError({
      message: `[jev-decisions] ${what} must be a non-empty legend map`,
      code: "invalid_response",
    });
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string") {
      throw new JevDecisionsError({
        message: `[jev-decisions] ${what}[${JSON.stringify(k)}] must be a string`,
        code: "invalid_response",
      });
    }
    out[k] = v;
  }
  return out;
}

function validateQuestions(questions: JevDecisionQuestions): Map<string, JevDecisionQuestionType> {
  if (!isRecord(questions) || Object.keys(questions).length === 0) {
    throw new JevDecisionsError({
      message: "[jev-decisions] questions must be a non-empty object keyed by question ID",
      code: "invalid_request",
    });
  }
  const byId = new Map<string, JevDecisionQuestionType>();
  for (const [id, spec] of Object.entries(questions)) {
    if (!id.trim()) {
      throw new JevDecisionsError({
        message: "[jev-decisions] question IDs must be non-empty strings",
        code: "invalid_request",
      });
    }
    if (!isRecord(spec) || !JEV_DECISION_TYPES.has(spec.type)) {
      throw new JevDecisionsError({
        message: `[jev-decisions] question ${JSON.stringify(id)} needs type choice|noul|score`,
        code: "invalid_request",
      });
    }
    if (typeof spec.instructions !== "string" || !spec.instructions.trim()) {
      throw new JevDecisionsError({
        message: `[jev-decisions] question ${JSON.stringify(id)} needs non-empty instructions`,
        code: "invalid_request",
      });
    }
    const criteria = spec.criteria ?? null;
    if (spec.type === "choice") {
      if (
        !isRecord(criteria) ||
        Object.keys(criteria).length === 0 ||
        Object.keys(criteria).length > 255 ||
        Object.entries(criteria).some(([k, v]) => !k.trim() || typeof v !== "string")
      ) {
        throw new JevDecisionsError({
          message: `[jev-decisions] choice question ${JSON.stringify(id)} needs 1..255 criteria options as Record<optionName, optionDescription>`,
          code: "invalid_request",
        });
      }
    } else if (spec.type === "noul") {
      if (criteria != null) {
        if (!isRecord(criteria)) {
          throw new JevDecisionsError({
            message: `[jev-decisions] noul question ${JSON.stringify(id)} criteria must be an object`,
            code: "invalid_request",
          });
        }
        for (const [k, v] of Object.entries(criteria)) {
          if ((k !== "true" && k !== "false") || typeof v !== "string") {
            throw new JevDecisionsError({
              message: `[jev-decisions] noul question ${JSON.stringify(id)} criteria only allows string true/false descriptions`,
              code: "invalid_request",
            });
          }
        }
      }
    } else {
      if (
        !Array.isArray(criteria) ||
        criteria.length < 2 ||
        criteria.length > 10 ||
        criteria.some((label) => typeof label !== "string" || !label.trim())
      ) {
        throw new JevDecisionsError({
          message: `[jev-decisions] score question ${JSON.stringify(id)} needs an ordered criteria string list with 2..10 levels`,
          code: "invalid_request",
        });
      }
    }
    byId.set(id, spec.type as JevDecisionQuestionType);
  }
  return byId;
}

function parseAnswer(
  questionId: string,
  raw: unknown,
  expected: JevDecisionQuestionType
): JevDecisionAnswer {
  if (!isRecord(raw)) {
    throw new JevDecisionsError({
      message: `[jev-decisions] answer for ${JSON.stringify(questionId)} must be an object`,
      code: "invalid_response",
    });
  }
  if (raw.type !== expected) {
    throw new JevDecisionsError({
      message: `[jev-decisions] answer type ${JSON.stringify(raw.type)} does not match asked ${JSON.stringify(expected)} for ${JSON.stringify(questionId)}`,
      code: "invalid_response",
    });
  }
  if (expected === "choice") {
    if (typeof raw.choice !== "string" || !raw.choice) {
      throw new JevDecisionsError({
        message: `[jev-decisions] choice answer for ${JSON.stringify(questionId)} needs a non-empty choice`,
        code: "invalid_response",
      });
    }
    return {
      type: "choice",
      choice: raw.choice,
      probabilities: parseProbabilityMap(raw.probabilities, `choice probabilities for ${JSON.stringify(questionId)}`),
      confidence: parseConfidence(raw.confidence, `choice confidence for ${JSON.stringify(questionId)}`),
    };
  }
  if (expected === "noul") {
    if (!isUnitProbability(raw.noul)) {
      throw new JevDecisionsError({
        message: `[jev-decisions] noul answer for ${JSON.stringify(questionId)} must be a number in [0,1]`,
        code: "invalid_response",
      });
    }
    return { type: "noul", noul: raw.noul };
  }
  if (typeof raw.score !== "number" || !Number.isFinite(raw.score)) {
    throw new JevDecisionsError({
      message: `[jev-decisions] score answer for ${JSON.stringify(questionId)} needs a finite number`,
      code: "invalid_response",
    });
  }
  return {
    type: "score",
    score: raw.score,
    legend: parseLegend(raw.legend, `score legend for ${JSON.stringify(questionId)}`),
    probabilities: parseProbabilityMap(raw.probabilities, `score probabilities for ${JSON.stringify(questionId)}`),
    confidence: parseConfidence(raw.confidence, `score confidence for ${JSON.stringify(questionId)}`),
  };
}

function recordJevLedgerOutcome(
  ledger: JevDecisionsLedgerOptions | null | undefined,
  input: {
    usage: JevDecisionUsage;
    providerRequestId: string | null;
    outcome: "success" | "failed_without_usage";
  }
): void {
  if (ledger === null) return;
  try {
    recordBackgroundProviderCost(
      {
        provider: "openrouter",
        model: JEV_DECISIONS_MODEL,
        requestKind: ledger?.requestKind ?? JEV_DECISIONS_REQUEST_KIND,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        upstreamCostUsd: input.usage.upstreamCostUsd,
        usageEstimated: input.usage.estimated,
        providerRequestId: input.providerRequestId,
        outcome: input.outcome,
        persistInTests: ledger?.persistInTests,
      },
      ledger?.db as Database.Database | undefined
    );
  } catch (error) {
    console.warn("[jev-decisions] ledger record skipped:", (error as Error).message);
  }
}

function failLedger(
  ledger: JevDecisionsLedgerOptions | null | undefined,
  providerRequestId: string | null
): void {
  recordJevLedgerOutcome(ledger, {
    usage: { inputTokens: 0, outputTokens: 0, estimated: true },
    providerRequestId,
    outcome: "failed_without_usage",
  });
}

export async function callJevDecisions(opts: {
  /** Official state: string, JSON object, or array of strings. */
  state: string | Record<string, unknown> | string[];
  /** Official questions object keyed by question ID. */
  questions: JevDecisionQuestions;
  /** Pinned-model override for tests only — production always uses the pin. */
  model?: string;
  timeoutMs?: number;
  /** Null skips ledger recording (wire-contract tests); omitted records canonically. */
  ledger?: JevDecisionsLedgerOptions | null;
  /**
   * Explicit OpenRouter credential override. Production callers omit this and
   * continue using resolveOpenRouterApiKey(). Benchmark callers may supply a
   * dedicated key; there is no env fallback from benchmark → production.
   */
  apiKey?: string;
}): Promise<{
  answers: Record<string, JevDecisionAnswer>;
  usage: JevDecisionUsage;
  /** Served model snapshot (dated pins like typesafe/jev-1.13-YYYYMMDD accepted). */
  responseModel: string;
}> {
  const asked = validateQuestions(opts.questions);
  if (
    typeof opts.state !== "string" &&
    !isRecord(opts.state) &&
    !Array.isArray(opts.state)
  ) {
    throw new JevDecisionsError({
      message: "[jev-decisions] state must be a string, JSON object, or array of strings",
      code: "invalid_request",
    });
  }
  if (Array.isArray(opts.state) && opts.state.some((item) => typeof item !== "string")) {
    throw new JevDecisionsError({
      message: "[jev-decisions] state arrays must contain strings only",
      code: "invalid_request",
    });
  }
  // Canonical auth owner throws NO_OPENROUTER_KEY before any HTTP when omit.
  const key = opts.apiKey?.trim() || resolveOpenRouterApiKey();
  const model = (opts.model ?? JEV_DECISIONS_MODEL).trim() || JEV_DECISIONS_MODEL;
  const requestKind = opts.ledger?.requestKind ?? JEV_DECISIONS_REQUEST_KIND;

  logAuxProviderCall(
    buildAuxProviderCallLogInput({
      model,
      messages: { state: opts.state, questions: opts.questions },
      requestKind,
    })
  );

  const timeoutMs = opts.timeoutMs ?? 120_000;
  let res: Response;
  try {
    res = await fetch(JEV_DECISIONS_URL, {
      method: "POST",
      headers: buildOpenRouterHeaders(key),
      body: JSON.stringify({ model, state: opts.state, questions: opts.questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    failLedger(opts.ledger, null);
    throw new JevDecisionsError({
      message: `[jev-decisions] transport error: ${(error as Error).message}`,
      code: "transport_error",
    });
  }

  const providerRequestId =
    res.headers.get("x-request-id") ?? res.headers.get("x-openrouter-request-id");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    failLedger(opts.ledger, providerRequestId);
    throw new JevDecisionsError({
      message: `[jev-decisions] HTTP ${res.status}: ${body.slice(0, 240)}`,
      code: "http_error",
      httpStatus: res.status,
    });
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    failLedger(opts.ledger, providerRequestId);
    throw new JevDecisionsError({
      message: "[jev-decisions] response is not valid JSON",
      code: "invalid_response",
      httpStatus: res.status,
    });
  }
  if (!isRecord(data) || !isRecord(data.answers)) {
    failLedger(opts.ledger, providerRequestId);
    throw new JevDecisionsError({
      message: "[jev-decisions] response needs an answers object keyed by question ID",
      code: "invalid_response",
      httpStatus: res.status,
    });
  }
  if (typeof data.model !== "string" || !data.model) {
    failLedger(opts.ledger, providerRequestId);
    throw new JevDecisionsError({
      message: "[jev-decisions] response needs a model snapshot string",
      code: "invalid_response",
      httpStatus: res.status,
    });
  }

  // Fail-closed completeness: unknown IDs rejected, missing requested answers
  // rejected (the official contract does not permit silent omission).
  // Per-answer throws happen before any ledger success write.
  const answers: Record<string, JevDecisionAnswer> = {};
  for (const id of Object.keys(data.answers)) {
    const expected = asked.get(id);
    if (!expected) {
      failLedger(opts.ledger, providerRequestId);
      throw new JevDecisionsError({
        message: `[jev-decisions] answer for unknown question ${JSON.stringify(id)}`,
        code: "invalid_response",
        httpStatus: res.status,
      });
    }
    try {
      answers[id] = parseAnswer(id, (data.answers as Record<string, unknown>)[id], expected);
    } catch (error) {
      failLedger(opts.ledger, providerRequestId);
      throw error;
    }
  }
  for (const id of asked.keys()) {
    if (!(id in answers)) {
      failLedger(opts.ledger, providerRequestId);
      throw new JevDecisionsError({
        message: `[jev-decisions] missing answer for requested question ${JSON.stringify(id)} — fail-closed`,
        code: "invalid_response",
        httpStatus: res.status,
      });
    }
  }

  const breakdown = parseOpenRouterUsage(data.usage, res.headers);
  const usage: JevDecisionUsage = {
    inputTokens: breakdown.promptTokens,
    outputTokens: breakdown.completionTokens,
    estimated: breakdown.estimated,
    ...(breakdown.upstreamCostUsd != null ? { upstreamCostUsd: breakdown.upstreamCostUsd } : {}),
  };
  recordJevLedgerOutcome(opts.ledger, { usage, providerRequestId, outcome: "success" });
  return { answers, usage, responseModel: data.model };
}
