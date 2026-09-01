import type { Usage } from "@/lib/chatUsage";

type WidgetExtractAttempt = NonNullable<
  Usage["statusWidgetExtractDiagnostics"]
>["attempts"][number];

export function formatWidgetExtractAttemptResult(attempt: WidgetExtractAttempt): string {
  if (attempt.succeeded === true) {
    if (attempt.reasonCode && attempt.reasonCode !== "OK") {
      return `success (${attempt.reasonCode})`;
    }
    return "success";
  }
  if (attempt.reasonCode) {
    if (attempt.reasonCode === "OK") return "success";
    return `failed (${attempt.reasonCode})`;
  }
  if (attempt.errorCode) return `failed (${attempt.errorCode})`;
  return "failed";
}

export function formatWidgetExtractAttemptLine(attempt: WidgetExtractAttempt): string {
  const transport = `HTTP ${attempt.httpStatus ?? "없음"} · finish ${attempt.finishReason ?? "없음"}`;
  const result = formatWidgetExtractAttemptResult(attempt);
  return `${attempt.stage} · ${attempt.modelId}: ${transport} · 결과: ${result}`;
}

export function countWidgetExtractAttempts(
  diagnostics: NonNullable<Usage["statusWidgetExtractDiagnostics"]>
): { initial: number; repair: number; total: number } {
  const initial = diagnostics.attempts.filter((a) => a.stage === "initial").length;
  const repair = diagnostics.attempts.filter((a) => a.stage === "repair").length;
  return { initial, repair, total: diagnostics.attempts.length };
}
