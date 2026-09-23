import { extractJsonObject, suggestedReplyCharCount } from "./parse";
import {
  SUGGESTED_REPLY_KINDS,
  SUGGESTED_REPLY_MAX_CHARS,
  SUGGESTED_REPLY_MIN_CHARS,
  type SuggestedReplyKind,
} from "./types";

export type SuggestedRepliesDecisionQualityIssue =
  | "malformed_json"
  | "missing_items"
  | "wrong_item_count"
  | "missing_kind"
  | "unknown_kind"
  | "duplicate_kind"
  | "missing_text"
  | "text_out_of_bounds"
  | "duplicate_text";

export type SuggestedRepliesDecisionQualityObservation = {
  contractValid: boolean;
  issues: SuggestedRepliesDecisionQualityIssue[];
  observedKinds: SuggestedReplyKind[];
  itemCount: number;
};

/**
 * P3-A read-only observatory for the existing suggested-replies AI decision.
 *
 * This intentionally does not repair, relabel, persist, route, retry, or call a
 * provider. It observes the raw model response before production normalization
 * so offline fixtures can measure disagreement with the canonical contract
 * without creating a second decision owner.
 */
export function observeSuggestedRepliesDecisionQuality(
  rawModelText: string
): SuggestedRepliesDecisionQualityObservation {
  const parsed = extractJsonObject(rawModelText);
  if (!parsed) {
    return {
      contractValid: false,
      issues: ["malformed_json"],
      observedKinds: [],
      itemCount: 0,
    };
  }

  if (!Array.isArray(parsed.items)) {
    return {
      contractValid: false,
      issues: ["missing_items"],
      observedKinds: [],
      itemCount: 0,
    };
  }

  const issues = new Set<SuggestedRepliesDecisionQualityIssue>();
  const seenKinds = new Set<SuggestedReplyKind>();
  const observedKinds: SuggestedReplyKind[] = [];
  const seenTexts = new Set<string>();

  if (parsed.items.length !== SUGGESTED_REPLY_KINDS.length) {
    issues.add("wrong_item_count");
  }

  for (const rawItem of parsed.items) {
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
      issues.add("missing_kind");
      issues.add("missing_text");
      continue;
    }

    const item = rawItem as { kind?: unknown; text?: unknown };
    if (typeof item.kind !== "string") {
      issues.add("missing_kind");
    } else if (!SUGGESTED_REPLY_KINDS.includes(item.kind as SuggestedReplyKind)) {
      issues.add("unknown_kind");
    } else {
      const kind = item.kind as SuggestedReplyKind;
      if (seenKinds.has(kind)) issues.add("duplicate_kind");
      else {
        seenKinds.add(kind);
        observedKinds.push(kind);
      }
    }

    if (typeof item.text !== "string" || !item.text.trim()) {
      issues.add("missing_text");
      continue;
    }

    const normalizedText = item.text.replace(/\s+/g, " ").trim();
    const charCount = suggestedReplyCharCount(normalizedText);
    if (charCount < SUGGESTED_REPLY_MIN_CHARS || charCount > SUGGESTED_REPLY_MAX_CHARS) {
      issues.add("text_out_of_bounds");
    }

    const textKey = normalizedText.replace(/\s+/g, "").toLowerCase();
    if (seenTexts.has(textKey)) issues.add("duplicate_text");
    else seenTexts.add(textKey);
  }

  for (const kind of SUGGESTED_REPLY_KINDS) {
    if (!seenKinds.has(kind)) issues.add("missing_kind");
  }

  return {
    contractValid: issues.size === 0,
    issues: [...issues],
    observedKinds,
    itemCount: parsed.items.length,
  };
}
