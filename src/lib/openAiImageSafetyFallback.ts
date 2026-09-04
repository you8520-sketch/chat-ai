import {
  callOpenAiImageEdit,
  OpenAiImageError,
  type OpenAiImageQuality,
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
};

export type OpenAiImageEditWithSafetyFallbackResult = {
  buffer: Buffer;
  costUsd: number | null;
  safetyFallbackUsed: boolean;
  providerAttempts: OpenAiImageProviderAttemptRecord[];
  hasUnknownAttemptCost: boolean;
};

function diagnosticAdminRecord(
  diagnostic: OpenAiImageFailureDiagnostic
): Record<string, unknown> {
  return formatOpenAiImageFailureDiagnosticForAdmin(diagnostic);
}

function createDeadlineAbortSignal(totalMs: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), totalMs);
  timer.unref?.();
  return controller.signal;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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
  const deadlineSignal = createDeadlineAbortSignal(totalTimeoutMs);
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
    signal: deadlineSignal,
  };

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
    });
    return {
      buffer: primary.buffer,
      costUsd: primary.costUsd,
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

    if (deadlineSignal.aborted) {
      throw error;
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
      });
      return {
        buffer: fallback.buffer,
        costUsd: fallback.costUsd,
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
        throw new OpenAiImageGenerationError(
          fallbackError.message,
          fallbackError.status,
          fallbackError.diagnostic,
          providerAttempts
        );
      }
      if (isAbortError(fallbackError)) {
        providerAttempts.push({
          attempt: 2,
          kind: "strict_safety_fallback",
          outcome: "failed",
          promptHash: hashPromptForDiagnostic(opts.strictFallbackPrompt),
          promptCharCount: opts.strictFallbackPrompt.length,
        });
        throw new OpenAiImageGenerationError(
          "이미지 생성 시간이 초과되었습니다.",
          504,
          undefined,
          providerAttempts
        );
      }
      throw fallbackError;
    }
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

/** Generic product failure — no provider safety wording for end users. */
export function formatOpenAiImageFinalUserError(_message?: string): string {
  return "이미지를 생성하지 못했습니다. 장면을 조금 바꿔 다시 시도해 주세요.";
}
