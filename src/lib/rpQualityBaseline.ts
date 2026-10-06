/**
 * Product quality baseline for Main RP.
 * Length classifies and records. It does not score prose quality.
 * Cursor does not assign subjective scores.
 */
import {
  AUTO_REFUND_UNDER_LENGTH_MAX_VISIBLE_CHARS,
  isAutoRefundUnderLengthEvidence,
} from "@/lib/reportRefundPolicy";

export const RP_QUALITY_CENTER_BAND_MIN_CHARS = 2700;
export const RP_QUALITY_CENTER_BAND_MAX_CHARS = 3500;
export const RP_QUALITY_SHORT_ACCEPTABLE_MIN_CHARS = 1501;
export const RP_QUALITY_SHORT_RISK_MIN_CHARS = 1001;
export const RP_QUALITY_SHORT_RISK_MAX_CHARS = 1500;

export type RpVisibleLengthClass =
  | "refund_evidence"
  | "short_risk"
  | "short_acceptable"
  | "center_band"
  | "long_ok";

export function classifyVisibleLength(visibleChars: number): RpVisibleLengthClass {
  if (!Number.isFinite(visibleChars) || visibleChars < 0) {
    return "refund_evidence";
  }
  if (isAutoRefundUnderLengthEvidence(visibleChars)) return "refund_evidence";
  if (visibleChars <= RP_QUALITY_SHORT_RISK_MAX_CHARS) return "short_risk";
  if (visibleChars < RP_QUALITY_CENTER_BAND_MIN_CHARS) return "short_acceptable";
  if (visibleChars <= RP_QUALITY_CENTER_BAND_MAX_CHARS) return "center_band";
  return "long_ok";
}

export function describeVisibleLengthClass(lengthClass: RpVisibleLengthClass): string {
  switch (lengthClass) {
    case "refund_evidence":
      return `visible chars <= ${AUTO_REFUND_UNDER_LENGTH_MAX_VISIBLE_CHARS}: under_length report may be deterministic auto-refund evidence`;
    case "short_risk":
      return `${RP_QUALITY_SHORT_RISK_MIN_CHARS}–${RP_QUALITY_SHORT_RISK_MAX_CHARS}: SHORT_RISK diagnostic; not auto retry; not auto-refund by length alone`;
    case "short_acceptable":
      return `${RP_QUALITY_SHORT_ACCEPTABLE_MIN_CHARS}–${RP_QUALITY_CENTER_BAND_MIN_CHARS - 1}: short but acceptable when the scene completes with high prose quality`;
    case "center_band":
      return `${RP_QUALITY_CENTER_BAND_MIN_CHARS}–${RP_QUALITY_CENTER_BAND_MAX_CHARS}: usual desired visible Korean band; ~3000 is a normal result`;
    case "long_ok":
      return `> ${RP_QUALITY_CENTER_BAND_MAX_CHARS}: not an upper-cap violation when the extra length is scene-needed and not padding`;
    default: {
      const _never: never = lengthClass;
      return _never;
    }
  }
}

export function countVisibleParagraphs(text: string): number {
  const parts = text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length > 0) return parts.length;
  return text.trim() ? 1 : 0;
}

/**
 * Deterministic quote-span estimate only. Not a quality score.
 * Returns null when there is no visible text.
 */
export function estimateDialogueShare(text: string): number | null {
  const body = text.trim();
  if (!body) return null;
  const quoteRe = /[「『“"']([^」』”"']+)[」』”"']/g;
  let dialogueChars = 0;
  for (const match of body.matchAll(quoteRe)) {
    dialogueChars += match[1]?.length ?? 0;
  }
  return dialogueChars / body.length;
}
