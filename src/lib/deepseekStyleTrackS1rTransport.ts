/**
 * Style Track S1R experiment overlay only.
 * Production `adaptCheaperInferenceChatBody` still deletes reasoning_effort
 * for DeepSeek. This helper is applied after that adapter in the S1R script.
 */
export const DEEPSEEK0813_TRUE_OFF_THINKING = { type: "disabled" } as const;
export const DEEPSEEK0813_TRUE_OFF_REASONING_EFFORT = "none" as const;

export function applyDeepSeek0813TrueOffExperimentOverlay(
  body: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...body };
  delete next.enable_thinking;
  delete next.reasoning;
  delete next.include_reasoning;
  next.thinking = { ...DEEPSEEK0813_TRUE_OFF_THINKING };
  next.reasoning_effort = DEEPSEEK0813_TRUE_OFF_REASONING_EFFORT;
  return next;
}

export function isDeepSeek0813TrueOffOutbound(body: Record<string, unknown>): boolean {
  return (
    JSON.stringify(body.thinking) === JSON.stringify(DEEPSEEK0813_TRUE_OFF_THINKING) &&
    body.reasoning_effort === DEEPSEEK0813_TRUE_OFF_REASONING_EFFORT &&
    body.reasoning == null &&
    body.include_reasoning == null &&
    body.enable_thinking == null
  );
}
