import { resolveAuxProviderOwner, type AuxProviderOwner } from "@/lib/auxProviderProvenance";
import type { ProviderCostLedgerRow } from "@/lib/providerCostLedger";

export type AdminReceiptCostAttribution =
  | "whole_turn"
  | "turn_attributable_async"
  | "global_background";

export type AdminReceiptPhysicalCallDiagnostic = {
  model: string | null;
  costUsd: number | null;
  canonicalOwner: AuxProviderOwner;
  requestKind: string | null;
  trigger: string | null;
  attempt: number | null;
  providerRequestId: string | null;
  costAttribution: AdminReceiptCostAttribution;
  family: string | null;
  executionPhase: string | null;
};

export function resolveAdminReceiptCostAttribution(
  row: Pick<
    ProviderCostLedgerRow,
    "assistant_message_id" | "execution_phase" | "family" | "funding_class"
  >
): AdminReceiptCostAttribution {
  if (row.assistant_message_id == null) return "global_background";
  if (row.execution_phase === "main_generation") return "whole_turn";
  if (row.execution_phase === "sync_post_turn") return "whole_turn";
  return "turn_attributable_async";
}

/** Project one scoped ledger row into admin-only provenance diagnostics. */
export function resolveAdminReceiptPhysicalCallDiagnostic(
  row: ProviderCostLedgerRow
): AdminReceiptPhysicalCallDiagnostic {
  const family = row.family?.trim() || null;
  const requestKind = row.request_kind?.trim() || null;
  const model = row.actual_model?.trim() || row.model?.trim() || row.requested_model?.trim() || null;
  const costUsd =
    row.actual_cost_usd != null && Number.isFinite(row.actual_cost_usd) && row.actual_cost_usd > 0
      ? row.actual_cost_usd
      : null;
  return {
    model,
    costUsd,
    canonicalOwner: resolveAuxProviderOwner({ requestKind, ledgerFamily: family }),
    requestKind,
    trigger: row.execution_phase?.trim() || null,
    attempt: row.attempt_ordinal ?? null,
    providerRequestId: row.provider_request_id?.trim() || null,
    costAttribution: resolveAdminReceiptCostAttribution(row),
    family,
    executionPhase: row.execution_phase?.trim() || null,
  };
}

export function formatAdminReceiptPhysicalCallDiagnosticLine(
  diagnostic: AdminReceiptPhysicalCallDiagnostic
): string {
  const model = diagnostic.model ?? "unknown";
  const cost =
    diagnostic.costUsd != null ? ` · $${diagnostic.costUsd.toFixed(6)}` : "";
  const owner = diagnostic.canonicalOwner;
  const trigger = diagnostic.trigger ?? "unknown";
  const attribution = diagnostic.costAttribution;
  const attempt = diagnostic.attempt ?? 1;
  const requestId = diagnostic.providerRequestId
    ? ` · req ${diagnostic.providerRequestId}`
    : "";
  return `${model}${cost}\nOwner: ${owner}\nTrigger: ${trigger}\nAttribution: ${attribution}\nAttempt: ${attempt}${requestId}`;
}
