/** HTTP API 실패 — 상태 코드·본문을 그대로 노출 (디버깅용) */
export function formatHttpApiError(
  status: number,
  statusText: string,
  bodyText: string
): string {
  if (status === 402) {
    return formatOpenRouterInsufficientCreditsError(
      parseOpenRouterAffordableMaxTokens(bodyText)
    );
  }

  const statusLine = `${status} ${statusText || "Error"}`.trim();
  const raw = bodyText.trim();
  if (!raw) return statusLine;

  try {
    const j = JSON.parse(raw) as {
      error?: { message?: string; code?: string | number; type?: string };
      message?: string;
    };
    const nested = j.error;
    const detail =
      (typeof nested === "string" ? nested : nested?.message) ??
      j.message ??
      (nested && typeof nested === "object"
        ? [nested.code, nested.type].filter(Boolean).join(" ")
        : "") ??
      raw;
    const detailStr = String(detail).split("\n")[0].slice(0, 500);
    return detailStr ? `${statusLine}: ${detailStr}` : statusLine;
  } catch {
    const detailStr = raw.split("\n")[0].slice(0, 500);
    return detailStr ? `${statusLine}: ${detailStr}` : statusLine;
  }
}

export function formatMissingApiKeyError(): string {
  return "401 Unauthorized: OPENROUTER_API_KEY is not configured";
}

/** catch 블록·SSE error 필드용 — API 오류 메시지는 그대로, 그 외는 fallback */
export function formatClientApiError(e: unknown, fallback: string): string {
  const msg = (e as Error).message?.trim();
  if (!msg) return fallback;
  if (msg.includes("OpenRouter API 크레딧")) return msg;
  if (/^\d{3}\s+\S/.test(msg)) {
    if (/402/.test(msg) && /can only afford/i.test(msg)) {
      return formatOpenRouterInsufficientCreditsError(
        parseOpenRouterAffordableMaxTokens(msg)
      );
    }
    return msg;
  }
  if (msg === "NO_OPENROUTER_KEY" || msg === "NO_KEY") return formatMissingApiKeyError();
  return msg;
}

/** OpenRouter 402 — "can only afford N" 파싱 */
export function parseOpenRouterAffordableMaxTokens(bodyText: string): number | null {
  const m = bodyText.match(/can only afford\s+(\d+)/i);
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** OpenRouter 계정 크레딧 부족 — 유저 앱 포인트와 별개 */
export function formatOpenRouterInsufficientCreditsError(affordable?: number | null): string {
  if (affordable != null) {
    return `OpenRouter API 크레딧이 부족합니다 (현재 최대 ${affordable.toLocaleString()} output 토큰만 예약 가능). openrouter.ai/settings/credits 에서 충전하거나, 잠시 후 다시 시도해 주세요.`;
  }
  return `OpenRouter API 크레딧이 부족합니다. openrouter.ai/settings/credits 에서 충전해 주세요.`;
}
