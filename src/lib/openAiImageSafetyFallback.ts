import {
  callOpenAiImageEdit,
  OpenAiImageError,
  type OpenAiImageQuality,
  type OpenAiImageUsageEvidence,
} from "@/lib/openAiImageEdit";
import {
  formatOpenAiImageFailureDiagnosticForAdmin,
  hashPromptForDiagnostic,
  isOpenAiImageSafetyRejection,
  type OpenAiImageFailureDiagnostic,
} from "@/lib/openAiImageFailureDiagnostic";

export const IMAGE_GENERATION_TOTAL_TIMEOUT_MS = 280_000;

export type OpenAiImageProviderAttemptKind = "primary" | "strict_safety_fallback";

export class OpenAiImageGenerationError extends OpenAiImageError {
  constructor(
    message: string,
    status: number,
    diagnostic: OpenAiImageFailureDiagnostic | undefined,
    public readonly providerAttempts: OpenAiImageProviderAttemptRecord[]
  ) {
    super(message, status, diagnostic);
    this.name = "OpenAiImageGenerationError";
  }
}

export type OpenAiImageProviderAttemptOutcome =
  | "success"
  | "safety_rejected"
  | "failed";

export type OpenAiImageProviderAttemptRecord = {
  attempt: number;
  kind: OpenAiImageProviderAttemptKind;
  outcome: OpenAiImageProviderAttemptOutcome;
  diagnostic?: Record<string, unknown>;
  costUsd?: number | null;
  promptHash?: string | null;
  promptCharCount?: number;
  providerRequestId?: string | null;
  usageEvidence?: OpenAiImageUsageEvidence | "unknown";
};

export type OpenAiImageEditWithSafetyFallbackResult = {
  buffer: Buffer;
  finalAttemptCostUsd: number | null;
  knownProviderCostUsd: number | null;
  hasUnknownAttemptCost: boolean;
  safetyFallbackUsed: boolean;
  providerAttempts: OpenAiImageProviderAttemptRecord[];
};

function diagnosticAdminRecord(
  diagnostic: OpenAiImageFailureDiagnostic
): Record<string, unknown> {
  return formatOpenAiImageFailureDiagnosticForAdmin(diagnostic);
}

function createDeadlineAbortSignal(totalMs: number): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), totalMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    dispose: () => clearTimeout(timer),
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function aggregateKnownProviderCostUsd(
  attempts: readonly OpenAiImageProviderAttemptRecord[]
): number | null {
  const known = attempts
    .map((attempt) => attempt.costUsd)
    .filter((cost): cost is number => cost != null && Number.isFinite(cost));
  if (!known.length) return null;
  return known.reduce((sum, cost) => sum + cost, 0);
}

function throwTerminalGenerationError(
  error: unknown,
  providerAttempts: OpenAiImageProviderAttemptRecord[]
): never {
  if (error instanceof OpenAiImageGenerationError) {
    throw error;
  }
  if (error instanceof OpenAiImageError) {
    throw new OpenAiImageGenerationError(
      error.message,
      error.status,
      error.diagnostic,
      providerAttempts
    );
  }
  if (isAbortError(error)) {
    throw new OpenAiImageGenerationError(
      "이미지 생성 시간이 초과되었습니다.",
      504,
      undefined,
      providerAttempts
    );
  }
  const message =
    error instanceof Error && error.message.trim()
      ? error.message
      : "OpenAI 이미지 생성 요청에 실패했습니다.";
  throw new OpenAiImageGenerationError(message, 502, undefined, providerAttempts);
}

/**
 * Canonical provider-attempt orchestration: one primary call, optional strict
 * safety fallback when attempt #1 is a recognized OpenAI safety rejection.
 */
export async function callOpenAiImageEditWithSafetyFallback(opts: {
  model: string;
  primaryPrompt: string;
  strictFallbackPrompt: string;
  references: string[];
  size: string;
  quality: OpenAiImageQuality;
  outputCompression: number;
  templateId?: string;
  mode?: string;
  totalTimeoutMs?: number;
}): Promise<OpenAiImageEditWithSafetyFallbackResult> {
  const totalTimeoutMs = opts.totalTimeoutMs ?? IMAGE_GENERATION_TOTAL_TIMEOUT_MS;
  const deadline = createDeadlineAbortSignal(totalTimeoutMs);
  const providerAttempts: OpenAiImageProviderAttemptRecord[] = [];
  let hasUnknownAttemptCost = false;

  const baseEditOpts = {
    model: opts.model,
    references: opts.references,
    size: opts.size,
    quality: opts.quality,
    outputCompression: opts.outputCompression,
    templateId: opts.templateId,
    mode: opts.mode,
    signal: deadline.signal,
  };

  try {
    try {
      const primary = await callOpenAiImageEdit({
        ...baseEditOpts,
        prompt: opts.primaryPrompt,
      });
      providerAttempts.push({
        attempt: 1,
        kind: "primary",
        outcome: "success",
        costUsd: primary.costUsd,
        promptHash: hashPromptForDiagnostic(opts.primaryPrompt),
        promptCharCount: opts.primaryPrompt.length,
        providerRequestId: primary.providerRequestId,
        usageEvidence: primary.usageEvidence,
      });
      return {
        buffer: primary.buffer,
        finalAttemptCostUsd: primary.costUsd,
        knownProviderCostUsd: aggregateKnownProviderCostUsd(providerAttempts),
        safetyFallbackUsed: false,
        providerAttempts,
        hasUnknownAttemptCost: false,
      };
    } catch (error) {
      if (!(error instanceof OpenAiImageError) || !error.diagnostic) {
        throw error;
      }
      if (!isOpenAiImageSafetyRejection(error.diagnostic)) {
        throw error;
      }

      if (error.diagnostic.providerChargeEvidence === "usage_absent") {
        hasUnknownAttemptCost = true;
      }

      providerAttempts.push({
        attempt: 1,
        kind: "primary",
        outcome: "safety_rejected",
        diagnostic: diagnosticAdminRecord(error.diagnostic),
        costUsd: error.diagnostic.computedCostUsd,
        promptHash: hashPromptForDiagnostic(opts.primaryPrompt),
        promptCharCount: opts.primaryPrompt.length,
      });

      if (deadline.signal.aborted) {
        throwTerminalGenerationError(error, providerAttempts);
      }

      try {
        const fallback = await callOpenAiImageEdit({
          ...baseEditOpts,
          prompt: opts.strictFallbackPrompt,
        });
        providerAttempts.push({
          attempt: 2,
          kind: "strict_safety_fallback",
          outcome: "success",
          costUsd: fallback.costUsd,
          promptHash: hashPromptForDiagnostic(opts.strictFallbackPrompt),
          promptCharCount: opts.strictFallbackPrompt.length,
          providerRequestId: fallback.providerRequestId,
          usageEvidence: fallback.usageEvidence,
        });
        return {
          buffer: fallback.buffer,
          finalAttemptCostUsd: fallback.costUsd,
          knownProviderCostUsd: aggregateKnownProviderCostUsd(providerAttempts),
          safetyFallbackUsed: true,
          providerAttempts,
          hasUnknownAttemptCost,
        };
      } catch (fallbackError) {
        if (fallbackError instanceof OpenAiImageError && fallbackError.diagnostic) {
          const outcome: OpenAiImageProviderAttemptOutcome =
            isOpenAiImageSafetyRejection(fallbackError.diagnostic)
              ? "safety_rejected"
              : "failed";
          if (fallbackError.diagnostic.providerChargeEvidence === "usage_absent") {
            hasUnknownAttemptCost = true;
          }
          providerAttempts.push({
            attempt: 2,
            kind: "strict_safety_fallback",
            outcome,
            diagnostic: diagnosticAdminRecord(fallbackError.diagnostic),
            costUsd: fallbackError.diagnostic.computedCostUsd,
            promptHash: hashPromptForDiagnostic(opts.strictFallbackPrompt),
            promptCharCount: opts.strictFallbackPrompt.length,
          });
          throwTerminalGenerationError(fallbackError, providerAttempts);
        }

        providerAttempts.push({
          attempt: 2,
          kind: "strict_safety_fallback",
          outcome: "failed",
          promptHash: hashPromptForDiagnostic(opts.strictFallbackPrompt),
          promptCharCount: opts.strictFallbackPrompt.length,
        });
        throwTerminalGenerationError(fallbackError, providerAttempts);
      }
    }
  } finally {
    deadline.dispose();
  }
}

export function serializeOpenAiImageProviderAttempts(
  attempts: OpenAiImageProviderAttemptRecord[]
): string {
  return JSON.stringify(attempts);
}

export function parseStoredOpenAiImageProviderAttempts(
  raw: string | null | undefined
): OpenAiImageProviderAttemptRecord[] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as OpenAiImageProviderAttemptRecord[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Generic product failure after exhausted safety recovery — no provider safety wording. */
export function formatOpenAiImageFinalUserError(_message?: string): string {
  return "이미지를 생성하지 못했습니다. 장면을 조금 바꿔 다시 시도해 주세요.";
}

export function formatOpenAiImageProviderAttemptsForAdmin(opts: {
  providerAttempts: readonly OpenAiImageProviderAttemptRecord[];
  knownProviderCostUsd: number | null;
  hasUnknownAttemptCost: boolean;
  safetyFallbackUsed: boolean;
  referenceSet?: {
    referenceCount: number;
    referenceSetSignature: string;
    references: ReadonlyArray<{ index: number; role: string; content: string }>;
  };
}): Record<string, unknown> {
  const safetyFallbackInvoked = opts.providerAttempts.some(
    (attempt) => attempt.kind === "strict_safety_fallback"
  );
  return {
    safetyFallbackUsed: opts.safetyFallbackUsed,
    safetyFallbackInvoked,
    attemptCount: opts.providerAttempts.length,
    knownProviderCostUsd: opts.knownProviderCostUsd,
    hasUnknownAttemptCost: opts.hasUnknownAttemptCost,
    attempts: opts.providerAttempts.map((attempt) => ({
      attempt: attempt.attempt,
      kind: attempt.kind,
      outcome: attempt.outcome,
      costUsd: attempt.costUsd ?? null,
      providerRequestId: attempt.providerRequestId ?? attempt.diagnostic?.providerRequestId ?? null,
      usageReturned: attempt.diagnostic?.usageReturned ?? (
        attempt.usageEvidence === "usage_present"
          ? true
          : attempt.usageEvidence === "usage_absent"
            ? false
            : null
      ),
      moderationStage: attempt.diagnostic?.moderationStage ?? null,
      errorCode: attempt.diagnostic?.errorCode ?? (attempt.outcome === "success" ? null : "UNKNOWN"),
      safetyCategories: Array.isArray(attempt.diagnostic?.safetyCategories)
        && attempt.diagnostic.safetyCategories.length
        ? attempt.diagnostic.safetyCategories
        : "UNKNOWN",
      promptHash: attempt.promptHash ?? null,
      ...(opts.referenceSet ?? {}),
    })),
  };
}

export type OpenAiImageGeneratedWithAttempts = {
  buffer: Buffer;
  knownProviderCostUsd: number | null;
  finalAttemptCostUsd: number | null;
  hasUnknownAttemptCost: boolean;
  safetyFallbackUsed: boolean;
  providerAttempts: OpenAiImageProviderAttemptRecord[];
};

export function toOpenAiImageGeneratedWithAttempts(
  result: OpenAiImageEditWithSafetyFallbackResult
): OpenAiImageGeneratedWithAttempts {
  return {
    buffer: result.buffer,
    knownProviderCostUsd: result.knownProviderCostUsd,
    finalAttemptCostUsd: result.finalAttemptCostUsd,
    hasUnknownAttemptCost: result.hasUnknownAttemptCost,
    safetyFallbackUsed: result.safetyFallbackUsed,
    providerAttempts: result.providerAttempts,
  };
}
