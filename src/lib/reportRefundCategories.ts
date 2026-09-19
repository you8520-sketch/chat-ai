/**
 * User-facing report categories — distinct from internal AutoRefundReason enum.
 */

export const REPORT_REFUND_UI_CATEGORIES = [
  "status_widget_error",
  "incomplete_output",
  "under_length",
  "meta_text",
  "spam_flood",
  "duplicate_billing",
  "similar_content",
  "other",
] as const;

export type ReportRefundUiCategory = (typeof REPORT_REFUND_UI_CATEGORIES)[number];

export const REPORT_REFUND_CATEGORY_LABELS: Record<ReportRefundUiCategory, string> = {
  status_widget_error: "상태창(HTML, JSX) 오류",
  incomplete_output: "미완성(상태창 제외)",
  under_length: "출력량 부족",
  meta_text: "메타 텍스트",
  spam_flood: "도배",
  duplicate_billing: "복수 출력",
  similar_content: "유사한 내용 출력",
  other: "기타",
};

export function isReportRefundUiCategory(value: unknown): value is ReportRefundUiCategory {
  return (
    typeof value === "string" &&
    (REPORT_REFUND_UI_CATEGORIES as readonly string[]).includes(value)
  );
}

export function formatReportRefundCategoryLabel(category: ReportRefundUiCategory): string {
  return REPORT_REFUND_CATEGORY_LABELS[category];
}
