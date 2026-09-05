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
 * Owner semantics (P0-2):
 * - Known requestKind → its dedicated owner (STATUS_WIDGET / ROLLING_SUMMARY /
 *   EPISODIC_MEMORY / RELATIONSHIP_MEMORY / SUGGESTED_REPLIES / STATUS_META).
 * - Known OTHER_ASYNC requestKind (explicit allow-list) → OTHER_ASYNC.
 * - Unrecognized requestKind → UNKNOWN (never swallowed into OTHER_ASYNC), so
 *   a brand-new requestKind surfaces instead of hiding in the generic bucket.
 * - missing/null requestKind with no ledger owner → UNKNOWN.
 *
 * Job identity (P0-3): jobId carries the strongest available canonical job
 * discriminator — the durable queue row id when threaded through opts.jobId
 * (derived-cache translation), else the generation-scoped request id from the
 * ledger context (stable across background retries/requeues of the same task).
 * Together with `attempt`/`isRetry` this distinguishes "same job retried N
 * times" (same jobId, attempt 1..N, isRetry) from "N distinct jobs each called
 * once" (N distinct jobIds, attempt 1).
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

/** Explicit allow-list of requestKinds that are genuinely OTHER_ASYNC. */
const KNOWN_OTHER_ASYNC_REQUEST_KINDS: ReadonlyArray<RegExp> = [
  /background-html-visual-card/i,
  /background-chat-image-scene-brief/i,
  /background-prompt-translation/i,
  /background-appearance-compile/i,
  /trpg-mechanics-referee/i,
  /trpg-scenario-draft/i,
  /trpg-sandbox-blueprint/i,
];

const LEDGER_FAMILY_OWNER_RULES: ReadonlyArray<readonly [RegExp, AuxProviderOwner]> = [
  [/status_widget_extract|post_turn_shared_initial/, "STATUS_WIDGET"],
  [/status_meta/, "STATUS_META"],
  [/suggested_replies/, "SUGGESTED_REPLIES"],
  [/memory_relationship/, "RELATIONSHIP_MEMORY"],
];

/** Map a background requestKind (or ledger family) to its auxiliary owner. */
export function resolveAuxProviderOwner(input: {
  requestKind?: string | null;
  ledgerFamily?: string | null;
}): AuxProviderOwner {
  const family = input.ledgerFamily ?? "";
  for (const [pattern, owner] of LEDGER_FAMILY_OWNER_RULES) {
    if (pattern.test(family)) return owner;
  }
  const kind = typeof input.requestKind === "string" ? input.requestKind.trim() : "";
  if (!kind) return "UNKNOWN";
  for (const [pattern, owner] of REQUEST_KIND_OWNER_RULES) {
    if (pattern.test(kind)) return owner;
  }
  for (const pattern of KNOWN_OTHER_ASYNC_REQUEST_KINDS) {
    if (pattern.test(kind)) return "OTHER_ASYNC";
  }
  return "UNKNOWN";
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
  jobId?: string | null;
  attempt?: number | null;
  isRetry?: boolean;
  promptFingerprint?: string | null;
};

export type AuxProviderCallLogSource = {
  model: string;
  messages: unknown;
  requestKind?: string | null;
  ledgerContext?: {
    family?: string | null;
    executionPhase?: string | null;
    chatId?: number | null;
    assistantMessageId?: number | null;
    generationRequestId?: string | null;
    jobAttemptOrdinal?: number | null;
  } | null;
  jobId?: string | null;
};

/** Pure builder — deterministic, unit-testable without emitting a log line. */
export function buildAuxProviderCallLogInput(
  source: AuxProviderCallLogSource
): AuxProviderCallLogInput {
  const ledger = source.ledgerContext;
  const attempt = ledger?.jobAttemptOrdinal ?? 1;
  const retrySuffix = /-retry|-repair|-fallback|-echo-fix/i.test(source.requestKind ?? "");
  return {
    auxOwner: resolveAuxProviderOwner({
      requestKind: source.requestKind,
      ledgerFamily: ledger?.family,
    }),
    model: source.model,
    requestKind: source.requestKind ?? null,
    trigger: ledger?.executionPhase ?? null,
    chatId: ledger?.chatId ?? null,
    messageId: ledger?.assistantMessageId ?? null,
    requestId: ledger?.generationRequestId ?? null,
    jobId: source.jobId ?? ledger?.generationRequestId ?? null,
    attempt,
    isRetry: attempt > 1 || retrySuffix,
    promptFingerprint: auxPromptFingerprint(source.model, source.messages),
  };
}

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