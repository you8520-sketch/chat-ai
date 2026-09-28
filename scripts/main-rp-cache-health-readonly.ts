/**
 * Legacy one-off entrypoint — delegates to the canonical monthly Main RP cache auditor.
 * Manual MODELS list removed (AUDITOR_DRIFT root cause).
 * Fixed-date output path removed — artifacts use the audit calendar month.
 *
 * Prefer: scripts/main-rp-monthly-cache-audit.ts
 */
import "./main-rp-monthly-cache-audit";
