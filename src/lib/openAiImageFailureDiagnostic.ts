import { createHash } from "node:crypto";

import {
  calculateGptImage2CostUsd,
  type OpenAiImageQuality,
} from "@/lib/openAiImageEdit";

export type OpenAiImageBillingEvidence =
  | "usage_present"
  | "usage_absent"
  | "confirmed_billed"
  | "confirmed_zero"
  | "unknown";

export type OpenAiImageFailureDiagnostic = {
  httpStatus: number;
  providerRequestId: string | null;
  errorType: string | null;
  errorCode: string | null;
  errorParam: string | null;
  errorMessage: string;
  moderationStage: string | null;
  safetyCategories: string[] | null;
  usage: Record<string, unknown> | null;
  inputTokens: number | null;
  outputTokens: number | null;
  imageInputTokens: number | null;
  textInputTokens: number | null;
  computedCostUsd: number | null;
  hasUsageEvidence: boolean;
  providerChargeEvidence: OpenAiImageBillingEvidence;
  attemptStartedAt: string;
  attemptFinishedAt: string;
  latencyMs: number;
  model: string;
  size: string;
  quality: OpenAiImageQuality;
  referenceCount: number;
  promptCharCount: number;
  promptHash: string | null;
  templateId?: string | null;
  mode?: string | null;
};

type OpenAiImageUsageLike = {
  input_tokens?: unknown;
  output_tokens?: unknown;
  input_tokens_details?: {
    image_tokens?: unknown;
    text_tokens?: unknown;
  };
};

function cleanString(value: unknown, max = 240): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function tokenCount(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function extractSafetyCategories(message: string): string[] | null {
  const match = /safety_violations\s*=\s*\[([^\]]*)\]/i.exec(message);
  if (!match) return null;
  const categories = match[1]
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
  return categories.length ? categories : null;
}

function headerRequestId(headers: Headers): string | null {
  return (
    cleanString(headers.get("x-request-id"), 120) ??
    cleanString(headers.get("openai-request-id"), 120) ??
    cleanString(headers.get("request-id"), 120)
  );
}

function bodyRequestId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;
  return (
    cleanString(root.request_id, 120) ??
    cleanString(root.requestId, 120) ??
    cleanString((root.error as { request_id?: unknown } | undefined)?.request_id, 120)
  );
}

export function hashPromptForDiagnostic(prompt: string): string | null {
  const trimmed = prompt.trim();
  if (!trimmed) return null;
  return createHash("sha256").update(trimmed, "utf8").digest("hex").slice(0, 16);
}

export function parseOpenAiImageFailureDiagnostic(opts: {
  httpStatus: number;
  responseHeaders: Headers;
  responseBody: unknown;
  attemptStartedAt: string;
  attemptFinishedAt: string;
  model: string;
  size: string;
  quality: OpenAiImageQuality;
  referenceCount: number;
  prompt: string;
  templateId?: string | null;
  mode?: string | null;
}): OpenAiImageFailureDiagnostic {
  const errorObj =
    opts.responseBody && typeof opts.responseBody === "object"
      ? ((opts.responseBody as { error?: unknown }).error as Record<string, unknown> | undefined)
      : undefined;

  const errorMessage =
    cleanString(errorObj?.message, 240) ??
    cleanString((opts.responseBody as { message?: unknown } | null)?.message, 240) ??
    "OpenAI 이미지 생성 요청에 실패했습니다.";

  const usageRaw =
    (opts.responseBody as { usage?: OpenAiImageUsageLike } | null)?.usage ??
    (errorObj?.usage as OpenAiImageUsageLike | undefined) ??
    null;

  const imageInputTokens = tokenCount(usageRaw?.input_tokens_details?.image_tokens);
  const textInputTokens = tokenCount(usageRaw?.input_tokens_details?.text_tokens);
  const inputTokens = tokenCount(usageRaw?.input_tokens);
  const outputTokens = tokenCount(usageRaw?.output_tokens);
  const hasUsageEvidence =
    imageInputTokens != null ||
    textInputTokens != null ||
    inputTokens != null ||
    outputTokens != null;
  const computedCostUsd = hasUsageEvidence
    ? calculateGptImage2CostUsd(usageRaw ?? undefined)
    : null;

  const moderationStage =
    cleanString(errorObj?.moderation_stage, 64) ??
    cleanString(errorObj?.moderationStage, 64) ??
    cleanString((opts.responseBody as { moderation_stage?: unknown } | null)?.moderation_stage, 64);

  return {
    httpStatus: opts.httpStatus,
    providerRequestId: headerRequestId(opts.responseHeaders) ?? bodyRequestId(opts.responseBody),
    errorType: cleanString(errorObj?.type, 64),
    errorCode: cleanString(errorObj?.code, 64),
    errorParam: cleanString(errorObj?.param, 120),
    errorMessage,
    moderationStage,
    safetyCategories: extractSafetyCategories(errorMessage),
    usage: usageRaw && typeof usageRaw === "object" ? (usageRaw as Record<string, unknown>) : null,
    inputTokens,
    outputTokens,
    imageInputTokens,
    textInputTokens,
    computedCostUsd,
    hasUsageEvidence,
    providerChargeEvidence: hasUsageEvidence ? "usage_present" : "usage_absent",
    attemptStartedAt: opts.attemptStartedAt,
    attemptFinishedAt: opts.attemptFinishedAt,
    latencyMs: Math.max(
      0,
      Date.parse(opts.attemptFinishedAt) - Date.parse(opts.attemptStartedAt)
    ),
    model: opts.model,
    size: opts.size,
    quality: opts.quality,
    referenceCount: opts.referenceCount,
    promptCharCount: opts.prompt.length,
    promptHash: hashPromptForDiagnostic(opts.prompt),
    templateId: opts.templateId ?? null,
    mode: opts.mode ?? null,
  };
}

export function serializeOpenAiImageFailureDiagnostic(
  diagnostic: OpenAiImageFailureDiagnostic
): string {
  return JSON.stringify(diagnostic);
}

export function parseStoredOpenAiImageFailureDiagnostic(
  raw: string | null | undefined
): OpenAiImageFailureDiagnostic | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as OpenAiImageFailureDiagnostic;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.httpStatus !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function formatOpenAiImageFailureDiagnosticForAdmin(
  diagnostic: OpenAiImageFailureDiagnostic
): Record<string, unknown> {
  return {
    status: "rejected",
    provider: "OpenAI direct",
    model: diagnostic.model,
    httpStatus: diagnostic.httpStatus,
    providerRequestId: diagnostic.providerRequestId,
    errorType: diagnostic.errorType,
    errorCode: diagnostic.errorCode,
    errorParam: diagnostic.errorParam,
    errorMessage: diagnostic.errorMessage,
    moderationStage: diagnostic.moderationStage ?? "unavailable",
    safetyCategories: diagnostic.safetyCategories ?? [],
    usageReturned: diagnostic.hasUsageEvidence,
    inputTokens: diagnostic.inputTokens,
    outputTokens: diagnostic.outputTokens,
    imageInputTokens: diagnostic.imageInputTokens,
    textInputTokens: diagnostic.textInputTokens,
    computedCostUsd: diagnostic.computedCostUsd,
    billingEvidence: diagnostic.providerChargeEvidence,
    latencyMs: diagnostic.latencyMs,
    referenceCount: diagnostic.referenceCount,
    promptCharCount: diagnostic.promptCharCount,
    promptHash: diagnostic.promptHash,
    templateId: diagnostic.templateId ?? null,
    mode: diagnostic.mode ?? null,
    attemptStartedAt: diagnostic.attemptStartedAt,
    attemptFinishedAt: diagnostic.attemptFinishedAt,
  };
}

export function isOpenAiImageSafetyRejection(diagnostic: OpenAiImageFailureDiagnostic): boolean {
  const haystack = [
    diagnostic.errorMessage,
    diagnostic.errorCode ?? "",
    diagnostic.errorType ?? "",
    ...(diagnostic.safetyCategories ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return (
    /rejected by the safety system/.test(haystack) ||
    /safety_violations/.test(haystack) ||
    /content.?policy/.test(haystack) ||
    /moderation/.test(haystack)
  );
}
