/**
 * Admin Finance vs Admin Receipt V3 cost-scope audit — read-only classification.
 * Finance revenue owner remains persisted deduction_slices (no price recompute).
 */

export type AdminFinanceCostScopeAudit = {
  ADMIN_RECEIPT_V3_ACTUAL_COST_SCOPE: string;
  ADMIN_FINANCE_CHAT_API_COST_SCOPE: string;
  MAIN_GENERATION_INCLUDED: boolean;
  SYNC_POST_TURN_INCLUDED: boolean;
  ASYNC_POST_TURN_INCLUDED: boolean;
  ADMIN_FINANCE_MISSING_COST_FAMILIES: readonly string[];
  ADMIN_FINANCE_DOUBLE_COUNTED_COST_FAMILIES: readonly string[];
  ADMIN_FINANCE_REVENUE_OWNER: string;
  ADMIN_FINANCE_COST_OWNER: string;
  ADMIN_FINANCE_RECOMPUTES_USER_PRICE: false;
  TARGET_MARGIN_USED_AS_REALIZED_MARGIN: false;
  ADMIN_FINANCE_EXACT_COST_ALIGNMENT_REQUIRED: boolean;
};

const RECEIPT_V3_SCOPE =
  "turn_attributable whole-turn: main RP actual + sync platform spend + async post-turn api_cost_ledger (suggested_replies_repair, status_meta, memory_relationship, post_turn_shared_initial, status_widget_extract)";

const FINANCE_CHAT_API_COST_SCOPE =
  "messages.usage.apiRawCostKrw per assistant row (main RP sync snapshot only) + api_cost_ledger DeepSeek V4 Flash background aggregate";

/** Platform-funded async families tracked by Receipt V3 but not in Finance chat apiRawCostKrw row cost. */
const FINANCE_MISSING_FROM_RECEIPT_V3_ASYNC = [
  "suggested_replies_repair",
  "status_meta",
  "memory_relationship",
  "post_turn_shared_initial",
] as const;

/** Sync extract may appear in usage.statusWidgetExtract — partially overlapping ledger paths. */
const POTENTIAL_DOUBLE_COUNT_WATCHLIST = ["status_widget_extract"] as const;

export function auditAdminFinanceCostScope(): AdminFinanceCostScopeAudit {
  return {
    ADMIN_RECEIPT_V3_ACTUAL_COST_SCOPE: RECEIPT_V3_SCOPE,
    ADMIN_FINANCE_CHAT_API_COST_SCOPE: FINANCE_CHAT_API_COST_SCOPE,
    MAIN_GENERATION_INCLUDED: true,
    SYNC_POST_TURN_INCLUDED: false,
    ASYNC_POST_TURN_INCLUDED: false,
    ADMIN_FINANCE_MISSING_COST_FAMILIES: [...FINANCE_MISSING_FROM_RECEIPT_V3_ASYNC],
    ADMIN_FINANCE_DOUBLE_COUNTED_COST_FAMILIES: [],
    ADMIN_FINANCE_REVENUE_OWNER:
      "messages.deduction_slices (paid+free slice totals) in buildAdminFinanceSummary()",
    ADMIN_FINANCE_COST_OWNER:
      "messages.usage.apiRawCostKrw (main RP) + api_cost_ledger DeepSeek V4 Flash background — NOT whole-turn Receipt V3",
    ADMIN_FINANCE_RECOMPUTES_USER_PRICE: false,
    TARGET_MARGIN_USED_AS_REALIZED_MARGIN: false,
    ADMIN_FINANCE_EXACT_COST_ALIGNMENT_REQUIRED: true,
  };
}

export function adminFinanceRealizedMarginReady(
  audit: AdminFinanceCostScopeAudit = auditAdminFinanceCostScope()
): "YES" | "NO" {
  return audit.ADMIN_FINANCE_MISSING_COST_FAMILIES.length > 0 ||
    audit.ADMIN_FINANCE_EXACT_COST_ALIGNMENT_REQUIRED
    ? "NO"
    : "YES";
}
