import {
  ROLLING_SUMMARY_MAX_CHARS,
  ROLLING_SUMMARY_MIN_CHARS,
} from "./memory-constants";

const ARROW_SEP = " → ";

const FALLBACK_BREAKS: { pattern: string; cutAfter: boolean }[] = [
  { pattern: ARROW_SEP, cutAfter: false },
  { pattern: "→", cutAfter: false },
  { pattern: ". ", cutAfter: true },
  { pattern: "! ", cutAfter: true },
  { pattern: "? ", cutAfter: true },
  { pattern: "…", cutAfter: true },
  { pattern: ", ", cutAfter: true },
];

/**
 * 5턴 기억 기록 — 500자 상한. 짧은 요약은 그대로 유지.
 * " → " 구절 경계에서 끊어 중간 잘림·말줄임을 최소화한다.
 */
export function clampMemoryRecordSummary(
  text: string,
  max = ROLLING_SUMMARY_MAX_CHARS,
  min = ROLLING_SUMMARY_MIN_CHARS
): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;

  // 1) " → " 경계마다 누적 — max 이하 중 가장 긴 완결 구절열
  let bestAtArrow = "";
  if (t.includes(ARROW_SEP)) {
    const parts = t.split(ARROW_SEP);
    let built = parts[0]?.trim() ?? "";
    if (built.length <= max) bestAtArrow = built;

    for (let i = 1; i < parts.length; i++) {
      const next = `${built}${ARROW_SEP}${parts[i].trim()}`;
      if (next.length > max) break;
      built = next;
      bestAtArrow = built;
    }
  }

  if (bestAtArrow.length >= min) return bestAtArrow;
  if (bestAtArrow.length >= 280) return bestAtArrow;

  // 2) 구두점·공백 등 자연 경계
  const prefix = t.slice(0, max);
  const windowStart = Math.max(0, max - 100);

  for (const { pattern, cutAfter } of FALLBACK_BREAKS) {
    const idx = prefix.lastIndexOf(pattern);
    if (idx < windowStart) continue;
    const end = cutAfter ? idx + pattern.length : idx;
    const result = t.slice(0, end).trim();
    if (result.length >= min) return result;
    if (result.length >= 280 && result.length > bestAtArrow.length) {
      bestAtArrow = result;
    }
  }

  if (bestAtArrow.length >= 280) return bestAtArrow;

  const lastSpace = prefix.lastIndexOf(" ");
  if (lastSpace >= min - 20) {
    return t.slice(0, lastSpace).trim();
  }

  // 3) 최후 — 단어 중간 절단 대신 짧게라도 완결
  return prefix.trimEnd();
}

/** AI 요약 실패 시 기계적으로 붙인 임시 기록 — UI·재생성 판별용 */
export function isFallbackMemoryRecordSummary(text: string): boolean {
  const t = text.trim();
  return (
    t.startsWith("[임시 기록 — AI 요약 실패]") || /…라 말했고 .+은\(는\) .+…/.test(t)
  );
}
