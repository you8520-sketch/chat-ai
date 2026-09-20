/**
 * Client-safe shared contract for Admin Provider Request forensic UI.
 *
 * Keep runtime-safe constants here so client components never import the
 * server-only ledger/projection implementation.
 */
export const LEDGER_INPUT_TOKEN_SEMANTICS = "SENT_TO_MODEL" as const;
export const LEDGER_CREATED_AT_SEMANTICS = "COMPLETION_TIME" as const;
export const DEFAULT_CORRELATION_WINDOW_SECONDS = 15;
export const BROADER_CORRELATION_WINDOW_SECONDS = 120;
