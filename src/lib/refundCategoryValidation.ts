/**
 * Maps user-selected report categories to deterministic server-side defect evidence.
 * Category selection alone never triggers auto-refund.
 */

import { detectCharStutter } from "@/lib/antiRepetition";
import { visibleAssistantMessageLength } from "@/lib/chatDisplayLength";
import type { Usage } from "@/lib/chatUsage";
import { isDegenerateOutput } from "@/lib/gibberishGuard";
import { detectRpMetaLeakage } from "@/lib/narrativeRules";
import {
  assessMessageForAutoRefund,
  hasRepeatedLongFormBlock,
  type AutoRefundReason,
} from "@/lib/refundAutoValidation";
import {
  formatReportRefundCategoryLabel,
  type ReportRefundUiCategory,
} from "@/lib/reportRefundCategories";
import { AUTO_REFUND_MIN_VISIBLE_CHARS } from "@/lib/reportRefundPolicy";
import { diagnoseStatusWidgetFailureFromUsage } from "@/lib/statusWidgetRefundEvidence";
import { detectDuplicateBillingEvidence } from "@/lib/duplicateChargeEvidence";

export type CategoryRefundAssessment = {
  category: ReportRefundUiCategory;
  isError: boolean;
  reasons: AutoRefundReason[];
  summary: string;
  /** Partial refund amount when duplicate billing detected */
  partialRefundAmount?: number;
};

const WIDGET_FAILURE_REASON_CODES = new Set([
  "V3_PARSE_FAILED",
  "MISSING_REQUIRED_KEYS",
  "KEY_MAPPING_MISMATCH",
  "STATUS_WIDGET_EXTRACT_EXHAUSTED",
  "FALLBACK_MODEL_FAILED",
  "RENDERER_KEY_MISMATCH",
]);

function normalizeCompareText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isDuplicateAssistantOutput(
  content: string,
  previousAssistantContent: string | null | undefined
): boolean {
  if (!previousAssistantContent?.trim()) return false;
  const a = normalizeCompareText(content);
  const b = normalizeCompareText(previousAssistantContent);
  if (a.length < 60 || b.length < 60) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (longer.includes(shorter) && shorter.length / longer.length >= 0.88) return true;
  return false;
}

function isInputEcho(content: string, userMessage: string | null | undefined): boolean {
  if (!userMessage?.trim()) return false;
  const a = normalizeCompareText(content);
  const b = normalizeCompareText(userMessage);
  if (b.length < 40 || a.length < 40) return false;
  if (a === b) return true;
  if (a.startsWith(b) && b.length / a.length >= 0.75) return true;
  return false;
}

function hasIncompleteOutputEvidence(input: {
  generationStatus?: string | null;
  finishReason?: string | null;
  usage?: Usage | null;
}): boolean {
  const status = input.generationStatus?.trim().toLowerCase();
  if (
    status === "interrupted" ||
    status === "failed_partial" ||
    status === "failed" ||
    status === "timeout"
  ) {
    return true;
  }
  const finish = (input.finishReason ?? input.usage?.finishReason ?? "")
    .trim()
    .toLowerCase();
  if (finish === "length" || finish === "max_tokens") return true;
  return false;
}

function hasMetaTextLeak(content: string): boolean {
  return detectRpMetaLeakage(content).status === "FAILURE";
}

function hasWidgetDefectEvidence(usage: Usage | null | undefined): boolean {
  if (!usage) return false;
  const diag = diagnoseStatusWidgetFailureFromUsage(usage);
  if (!diag.widgetRequested) return false;
  if (!diag.widgetActive) return false;
  if (WIDGET_FAILURE_REASON_CODES.has(diag.reasonCode)) return true;
  if (usage.statusWidgetExtractDiagnostics?.exhausted) return true;
  return false;
}

function mapReasonsToSummary(
  category: ReportRefundUiCategory,
  reasons: AutoRefundReason[]
): string {
  const label = formatReportRefundCategoryLabel(category);
  const base = assessMessageForAutoRefund({ content: "" });
  void base;
  const technical =
    reasons.length > 0
      ? reasons.join(", ")
      : "technical evidence not confirmed";
  return `${label} (${technical})`;
}

/** Category-aware auto-refund assessment — requires deterministic evidence per category. */
export function assessCategoryForAutoRefund(input: {
  category: ReportRefundUiCategory;
  content: string;
  messageStatus?: string | null;
  generationStatus?: string | null;
  finishReason?: string | null;
  usage?: Usage | null;
  previousAssistantContent?: string | null;
  userMessage?: string | null;
  messageId?: number;
  chatId?: number;
  userId?: number;
}): CategoryRefundAssessment {
  const category = input.category;
  const content = input.content.trim();
  const reasons: AutoRefundReason[] = [];
  let partialRefundAmount: number | undefined;

  if (category === "other") {
    return {
      category,
      isError: false,
      reasons: [],
      summary: formatReportRefundCategoryLabel(category),
    };
  }

  switch (category) {
    case "status_widget_error":
      if (hasWidgetDefectEvidence(input.usage ?? null)) {
        reasons.push("api_error");
      }
      break;
    case "incomplete_output":
      if (hasIncompleteOutputEvidence(input)) {
        reasons.push("api_error");
      }
      break;
    case "under_length":
      if (content && visibleAssistantMessageLength(content) < AUTO_REFUND_MIN_VISIBLE_CHARS) {
        reasons.push("under_length");
      }
      break;
    case "meta_text":
      if (content && hasMetaTextLeak(content)) {
        reasons.push("garbage_output");
      }
      break;
    case "spam_flood":
      if (content && isDegenerateOutput(content)) reasons.push("garbage_output");
      if (content && detectCharStutter(content)) reasons.push("char_stutter");
      if (content && hasRepeatedLongFormBlock(content)) reasons.push("repeated_block");
      break;
    case "duplicate_billing":
      if (
        input.messageId != null &&
        input.chatId != null &&
        input.userId != null
      ) {
        const dup = detectDuplicateBillingEvidence({
          userId: input.userId,
          chatId: input.chatId,
          messageId: input.messageId,
        });
        if (dup.isDuplicate && dup.duplicateChargePoints > 0) {
          reasons.push("duplicate_output");
          partialRefundAmount = dup.duplicateChargePoints;
        }
      }
      break;
    case "similar_content":
      if (content && isDuplicateAssistantOutput(content, input.previousAssistantContent)) {
        reasons.push("duplicate_output");
      }
      if (content && isInputEcho(content, input.userMessage)) {
        reasons.push("input_echo");
      }
      break;
    default: {
      const _exhaustive: never = category;
      void _exhaustive;
    }
  }

  if (input.messageStatus === "error") {
    if (!reasons.includes("api_error")) reasons.push("api_error");
  }

  const unique = [...new Set(reasons)];
  return {
    category,
    isError: unique.length > 0,
    reasons: unique,
    summary: mapReasonsToSummary(category, unique),
    partialRefundAmount,
  };
}
