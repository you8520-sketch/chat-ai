import { createHash } from "node:crypto";

/**
 * Zero-cost auxiliary provider-call provenance logging (P0).
 *
 * Emits one console line per logical auxiliary/background provider call so a
 * provider-dashboard pattern (e.g. repeated fixed-size Luna calls) can be
 * attributed to an owner on its next occurrence. Console-only — no new
 * telemetry provider calls, no DB writes, no API keys, no raw prompt or user
 * content ever logged (only a truncated hash fingerprint).
 *
 * Physical attempt evidence for DeepSeek background failover remains in
 * api_cost_ledger (providerCostLedger); this log adds the logical-call owner
 * attribution for everything flowing through callOpenRouterCompletion.
 */
export type AuxProviderOwner =
  | "STATUS_WIDGET"
  | "ROLLING_SUMMARY"
  | "EPISODIC_MEMORY"
  | "RELATIONSHIP_MEMORY"
  | "SUGGESTED_REPLIES"
  | "STATUS_META"
  | "OTHER_ASYNC"
  | "TEST_HARNESS"
  | "UNKNOWN";

const REQUEST_KIND_OWNER_RULES: ReadonlyArray<readonly [RegExp, AuxProviderOwner]> = [
  [/background-status-widget-extract/i, "STATUS_WIDGET"],
  [/background-post-turn-shared-initial/i, "STATUS_WIDGET"],
  [/background-status-meta-extract/i, "STATUS_META"],
  [/background-suggested-replies-extract/i, "SUGGESTED_REPLIES"],
  [/reply-suggestion/i, "SUGGESTED_REPLIES"],
  [/background-episodic-extract/i, "EPISODIC_MEMORY"],
  [/relationship|memory-regen-extract/i, "RELATIONSHIP_MEMORY"],
  [/background-memory-extract|background-lorebook-compact/i, "ROLLING_SUMMARY"],
];

/** Map a background requestKind (or ledger family) to its auxiliary owner. */
export function resolveAuxProviderOwner(input: {
  requestKind?: string | null;
  ledgerFamily?: string | null;
}): AuxProviderOwner {
  const family = input.ledgerFamily ?? "";
  if (/status_widget_extract|post_turn_shared_initial/.test(family)) return "STATUS_WIDGET";
  if (/status_meta/.test(family)) return "STATUS_META";
  if (/suggested_replies/.test(family)) return "SUGGESTED_REPLIES";
  if (/memory_relationship/.test(family)) return "RELATIONSHIP_MEMORY";
  const kind = input.requestKind ?? "";
  for (const [pattern, owner] of REQUEST_KIND_OWNER_RULES) {
    if (pattern.test(kind)) return owner;
  }
  return "OTHER_ASYNC";
}

/** Stable short fingerprint of (model, messages) — no prompt content is logged. */
export function auxPromptFingerprint(model: string, messages: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify({ model, messages }))
    .digest("hex")
    .slice(0, 16);
}

export type AuxProviderCallLogInput = {
  auxOwner: AuxProviderOwner;
  model: string;
  requestKind?: string | null;
  trigger?: string | null;
  chatId?: number | null;
  messageId?: number | null;
  requestId?: string | null;
  attempt?: number | null;
  isRetry?: boolean;
  jobId?: string | null;
  promptFingerprint?: string | null;
};

/** event=aux_provider_call — safe structured provenance line. */
export function logAuxProviderCall(input: AuxProviderCallLogInput): void {
  if (process.env.NODE_TEST_CONTEXT) return;
  console.info("[aux_provider_call]", {
    event: "aux_provider_call",
    auxOwner: input.auxOwner ?? "UNKNOWN",
    model: input.model,
    requestKind: input.requestKind ?? null,
    trigger: input.trigger ?? null,
    chatId: input.chatId ?? null,
    messageId: input.messageId ?? null,
    requestId: input.requestId ?? null,
    attempt: input.attempt ?? 1,
    isRetry: input.isRetry ?? false,
    jobId: input.jobId ?? null,
    promptFingerprint: input.promptFingerprint ?? null,
  });
}
