/**
 * Provider stream termination — normalize native refusal signals for central owners.
 * Fields observed on OpenRouter / CheaperInference OpenAI-compatible streams.
 */

export type ProviderTerminationFields = {
  finishReason?: string | null;
  stopReason?: string | null;
  nativeFinishReason?: string | null;
  stopDetailsType?: string | null;
};

const NATIVE_REFUSAL_RE = /^(refusal|refused)$/i;

/** True when a provider-native termination field explicitly signals model refusal. */
export function isProviderNativeRefusalSignal(value: string | null | undefined): boolean {
  const normalized = (value ?? "").trim();
  if (!normalized) return false;
  return NATIVE_REFUSAL_RE.test(normalized);
}

/** Any exposed native refusal field → treat as model refusal. */
export function coalesceProviderNativeRefusal(fields: ProviderTerminationFields): boolean {
  return (
    isProviderNativeRefusalSignal(fields.finishReason) ||
    isProviderNativeRefusalSignal(fields.stopReason) ||
    isProviderNativeRefusalSignal(fields.nativeFinishReason) ||
    isProviderNativeRefusalSignal(fields.stopDetailsType)
  );
}

/**
 * Canonical finish_reason for downstream generation-failure / refusal owners.
 * Native refusal wins over benign stop/end_turn wrappers.
 */
export function normalizeProviderTerminationFinishReason(
  fields: ProviderTerminationFields
): string | undefined {
  if (coalesceProviderNativeRefusal(fields)) {
    return "refusal";
  }
  const finish = fields.finishReason?.trim();
  return finish || undefined;
}

/** Extract termination fields from one OpenAI-compat stream choice object. */
export function extractStreamChoiceTermination(
  choice: Record<string, unknown>
): ProviderTerminationFields {
  const nativeFinish = choice.native_finish_reason;
  const stopDetails = choice.stop_details as { type?: unknown } | undefined;
  let nativeFinishReason: string | null = null;
  if (typeof nativeFinish === "string") {
    nativeFinishReason = nativeFinish;
  } else if (nativeFinish && typeof nativeFinish === "object") {
    const nested = nativeFinish as { stop_reason?: unknown; type?: unknown };
    if (typeof nested.stop_reason === "string") nativeFinishReason = nested.stop_reason;
    else if (typeof nested.type === "string") nativeFinishReason = nested.type;
  }

  return {
    finishReason:
      typeof choice.finish_reason === "string" ? choice.finish_reason : null,
    stopReason: typeof choice.stop_reason === "string" ? choice.stop_reason : null,
    nativeFinishReason,
    stopDetailsType:
      typeof stopDetails?.type === "string" ? stopDetails.type : null,
  };
}

function mergeStreamTerminationFields(
  choice: Record<string, unknown> | undefined,
  topLevel?: Record<string, unknown> | null
): ProviderTerminationFields | null {
  const fields: ProviderTerminationFields = {};
  let hasTermination = false;

  if (topLevel) {
    if (typeof topLevel.stop_reason === "string") {
      fields.stopReason = topLevel.stop_reason;
      hasTermination = true;
    }
    const topStopDetails = topLevel.stop_details as { type?: unknown } | undefined;
    if (typeof topStopDetails?.type === "string") {
      fields.stopDetailsType = topStopDetails.type;
      hasTermination = true;
    }
  }

  if (choice) {
    const extracted = extractStreamChoiceTermination(choice);
    if (extracted.finishReason) {
      fields.finishReason = extracted.finishReason;
      hasTermination = true;
    }
    if (extracted.stopReason) {
      fields.stopReason = extracted.stopReason;
      hasTermination = true;
    }
    if (extracted.nativeFinishReason) {
      fields.nativeFinishReason = extracted.nativeFinishReason;
      hasTermination = true;
    }
    if (extracted.stopDetailsType) {
      fields.stopDetailsType = extracted.stopDetailsType;
      hasTermination = true;
    }
  }

  return hasTermination ? fields : null;
}

/** Merge choice-level and optional top-level stream termination fields. */
export function normalizeStreamTermination(
  choice: Record<string, unknown> | undefined,
  topLevel?: Record<string, unknown> | null
): string | undefined {
  const fields = mergeStreamTerminationFields(choice, topLevel);
  if (!fields) return undefined;
  return normalizeProviderTerminationFinishReason(fields);
}

/** Top-level termination-only SSE chunks (no choices array). */
export function normalizeTopLevelStreamTermination(
  topLevel: Record<string, unknown> | null | undefined
): string | undefined {
  return normalizeStreamTermination(undefined, topLevel);
}

/**
 * Accumulate finish_reason across SSE chunks.
 * Native refusal is sticky — later benign stop/end_turn must not erase it.
 */
export function accumulateStreamFinishReason(
  previous: string | undefined,
  incoming: string | undefined
): string | undefined {
  if (isProviderNativeRefusalSignal(previous) || incoming === "refusal") {
    return "refusal";
  }
  return incoming ?? previous;
}
