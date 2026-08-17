export const TRPG_START_FAILURE_CLASSES = ["A", "B", "C"] as const;
export type TrpgStartFailureClass = (typeof TRPG_START_FAILURE_CLASSES)[number];

export type TrpgStartFailure = {
  class: TrpgStartFailureClass;
  error: string;
};

const PRE_GM_MESSAGE =
  /찾을 수 없|방장만|이미 시작|시트를 만들어야|로그인이 필요|관리자만|잘못된 캠페인/;

const PROVIDER_MESSAGE =
  /\[TRPG\]\s+\d{3}|timeout|AbortError|NO_CHEAPER_INFERENCE_KEY|empty completion|fetch failed|ECONN|ETIMEDOUT|UND_ERR/i;

export function classifyTrpgStartFailure(opts: {
  error: unknown;
  /** True when opening round 0 was inserted before the GM ran. */
  reachedOpeningRound?: boolean;
  /** Usage rows written after a successful GM provider response. */
  gmUsageCount?: number;
}): TrpgStartFailure {
  const error = opts.error instanceof Error ? opts.error.message : String(opts.error ?? "start failed");
  if (!opts.reachedOpeningRound) {
    return { class: "A", error };
  }
  if ((opts.gmUsageCount ?? 0) > 0) {
    return { class: "C", error };
  }
  if (PRE_GM_MESSAGE.test(error) && !PROVIDER_MESSAGE.test(error)) {
    return { class: "A", error };
  }
  return { class: "B", error };
}

export function parseTrpgStartFailureJson(raw: string | null | undefined): TrpgStartFailure | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as { class?: unknown; error?: unknown };
    const failureClass = TRPG_START_FAILURE_CLASSES.find((item) => item === parsed.class);
    const error = typeof parsed.error === "string" && parsed.error.trim() ? parsed.error : raw;
    return { class: failureClass ?? "C", error };
  } catch {
    return { class: "C", error: raw };
  }
}
