import type Database from "better-sqlite3";
import { buildOpenRouterHeaders, resolveOpenRouterApiKey } from "@/lib/openRouterConfig";
import { parseOpenRouterUsage } from "@/lib/openRouterUsage";
import { recordBackgroundProviderCost } from "@/lib/providerCostLedger";
import { buildAuxProviderCallLogInput, logAuxProviderCall } from "@/lib/auxProviderProvenance";

/**
 * Independent canonical owner for the OpenRouter Decisions API
 * (TypeSafe Jev) — NOT a chat completion model.
 *
 * Owner map:
 * - JEV_DECIDER_TRANSPORT_OWNER → callJevDecisions below (endpoint, payload,
 *   answers/usage parsing, deterministic failure policy).
 * - OPENROUTER_AUTH_OWNER → openRouterConfig (key + headers, reused primitive).
 * - DECISIONS_USAGE_OWNER → openRouterUsage.parseOpenRouterUsage (token buckets
 *   + upstream cost provenance, reused generic parser).
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

export type JevDecisionPrimitive = "choice" | "noul" | "score";

const JEV_DECISION_PRIMITIVES: ReadonlySet<string> = new Set(["choice", "noul", "score"]);

export type JevDecisionQuestion = {
  id: string;
  primitive: JevDecisionPrimitive;
  question: string;
  options?: string[];
};

export type JevDecisionAnswer = {
  questionId: string;
  primitive: JevDecisionPrimitive;
  /** choice/noul label (noul may be null when the decider abstains). */
  choice: string | null;
  /** score primitive value. */
  score: number | null;
  /** Unrecognized answer fields, preserved for debugging (never trusted). */
  raw: Record<string, unknown>;
};

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

function validateQuestions(questions: JevDecisionQuestion[]): Map<string, JevDecisionPrimitive> {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new JevDecisionsError({
      message: "[jev-decisions] at least one question is required",
      code: "invalid_request",
    });
  }
  const byId = new Map<string, JevDecisionPrimitive>();
  for (const q of questions) {
    if (!isRecord(q) || typeof q.id !== "string" || !q.id.trim()) {
      throw new JevDecisionsError({
        message: "[jev-decisions] every question needs a non-empty string id",
        code: "invalid_request",
      });
    }
    if (!JEV_DECISION_PRIMITIVES.has(q.primitive)) {
      throw new JevDecisionsError({
        message: `[jev-decisions] question ${JSON.stringify(q.id)} has unsupported primitive ${JSON.stringify((q as { primitive?: unknown }).primitive)}`,
        code: "invalid_request",
      });
    }
    if (typeof q.question !== "string" || !q.question.trim()) {
      throw new JevDecisionsError({
        message: `[jev-decisions] question ${JSON.stringify(q.id)} needs non-empty question text`,
        code: "invalid_request",
      });
    }
    if (byId.has(q.id)) {
      throw new JevDecisionsError({
        message: `[jev-decisions] duplicate question id ${JSON.stringify(q.id)}`,
        code: "invalid_request",
      });
    }
    byId.set(q.id, q.primitive);
  }
  return byId;
}

function parseAnswer(
  raw: unknown,
  asked: Map<string, JevDecisionPrimitive>
): JevDecisionAnswer {
  if (!isRecord(raw)) {
    throw new JevDecisionsError({
      message: "[jev-decisions] answer must be an object",
      code: "invalid_response",
    });
  }
  const questionId = raw.question_id ?? raw.questionId ?? raw.id;
  if (typeof questionId !== "string" || !asked.has(questionId)) {
    throw new JevDecisionsError({
      message: "[jev-decisions] answer references unknown question",
      code: "invalid_response",
    });
  }
  const primitive = raw.primitive;
  if (typeof primitive !== "string" || !JEV_DECISION_PRIMITIVES.has(primitive)) {
    throw new JevDecisionsError({
      message: `[jev-decisions] answer for ${JSON.stringify(questionId)} has unsupported primitive`,
      code: "invalid_response",
    });
  }
  const expected = asked.get(questionId);
  if (primitive !== expected) {
    throw new JevDecisionsError({
      message: `[jev-decisions] answer primitive ${JSON.stringify(primitive)} does not match asked ${JSON.stringify(expected)} for ${JSON.stringify(questionId)}`,
      code: "invalid_response",
    });
  }
  let choice: string | null = null;
  let score: number | null = null;
  if (primitive === "score") {
    const n = Number(raw.score);
    if (!Number.isFinite(n)) {
      throw new JevDecisionsError({
        message: `[jev-decisions] score answer for ${JSON.stringify(questionId)} needs a finite number`,
        code: "invalid_response",
      });
    }
    score = n;
  } else if (raw.choice == null) {
    if (primitive === "choice") {
      throw new JevDecisionsError({
        message: `[jev-decisions] choice answer for ${JSON.stringify(questionId)} needs a string choice`,
        code: "invalid_response",
      });
    }
    choice = null;
  } else {
    if (typeof raw.choice !== "string") {
      throw new JevDecisionsError({
        message: `[jev-decisions] answer choice for ${JSON.stringify(questionId)} must be a string`,
        code: "invalid_response",
      });
    }
    choice = raw.choice;
  }
  return { questionId, primitive: primitive as JevDecisionPrimitive, choice, score, raw };
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

export async function callJevDecisions(opts: {
  state: Record<string, unknown>;
  questions: JevDecisionQuestion[];
  /** Pinned-model override for tests only — production always uses the pin. */
  model?: string;
  timeoutMs?: number;
  /** Null skips ledger recording (wire-contract tests); omitted records canonically. */
  ledger?: JevDecisionsLedgerOptions | null;
}): Promise<{ answers: JevDecisionAnswer[]; usage: JevDecisionUsage }> {
  const asked = validateQuestions(opts.questions);
  if (!isRecord(opts.state)) {
    throw new JevDecisionsError({
      message: "[jev-decisions] state must be a JSON object",
      code: "invalid_request",
    });
  }
  // Canonical auth owner throws NO_OPENROUTER_KEY before any HTTP.
  const key = resolveOpenRouterApiKey();
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
    recordJevLedgerOutcome(opts.ledger, {
      usage: { inputTokens: 0, outputTokens: 0, estimated: true },
      providerRequestId: null,
      outcome: "failed_without_usage",
    });
    throw new JevDecisionsError({
      message: `[jev-decisions] transport error: ${(error as Error).message}`,
      code: "transport_error",
    });
  }

  const providerRequestId =
    res.headers.get("x-request-id") ?? res.headers.get("x-openrouter-request-id");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    recordJevLedgerOutcome(opts.ledger, {
      usage: { inputTokens: 0, outputTokens: 0, estimated: true },
      providerRequestId,
      outcome: "failed_without_usage",
    });
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
    recordJevLedgerOutcome(opts.ledger, {
      usage: { inputTokens: 0, outputTokens: 0, estimated: true },
      providerRequestId,
      outcome: "failed_without_usage",
    });
    throw new JevDecisionsError({
      message: "[jev-decisions] response is not valid JSON",
      code: "invalid_response",
      httpStatus: res.status,
    });
  }
  if (!isRecord(data) || !Array.isArray(data.answers) || data.answers.length === 0) {
    recordJevLedgerOutcome(opts.ledger, {
      usage: { inputTokens: 0, outputTokens: 0, estimated: true },
      providerRequestId,
      outcome: "failed_without_usage",
    });
    throw new JevDecisionsError({
      message: "[jev-decisions] response needs a non-empty answers array",
      code: "invalid_response",
      httpStatus: res.status,
    });
  }

  // answers validation throws deterministically before any ledger success write.
  const answers = (data.answers as unknown[]).map((a) => parseAnswer(a, asked));
  const breakdown = parseOpenRouterUsage(isRecord(data) ? data.usage : undefined, res.headers);
  const usage: JevDecisionUsage = {
    inputTokens: breakdown.promptTokens,
    outputTokens: breakdown.completionTokens,
    estimated: breakdown.estimated,
    ...(breakdown.upstreamCostUsd != null ? { upstreamCostUsd: breakdown.upstreamCostUsd } : {}),
  };
  recordJevLedgerOutcome(opts.ledger, { usage, providerRequestId, outcome: "success" });
  return { answers, usage };
}
