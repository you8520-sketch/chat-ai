# Post-turn Luna physical-call owner

Production incident: `cr_mtyes39w_uap6ttej / chat 707 / assistant 3945` recorded a shared
initial call, a Status Widget repair, and a Relationship Memory recovery. The model's malformed
sections were the trigger, not the root cause: each logical consumer retained provider capability
after the shared owner had already spent one physical call.

## Owner map

| Path | Physical owner | Before this fix | After a shared attempt | Ledger family |
| --- | --- | --- | --- | --- |
| Shared status/suggestions/relationship | `runPostTurnSharedInitial` | one initial call | canonical and only call | `post_turn_shared_initial` |
| Status Widget | `extractStatusWidgetValuesForTurn` | repair and fallback could fan out | validates/preserves valid sections; invalid sections get no update and no retry | shared family above |
| Suggested Replies | shared runner, then suggestion persistence owner | background extractor could retry | a spent physical budget synchronously persists terminal success/failure + `noRetry`; no pending job is created | shared family above |
| Relationship Memory | shared runner, then memory persistence owner | invalid/missing section could call the relationship-only runner | applies a valid delta or preserves `memory_meta` and records `shared_section_invalid_no_retry` | shared family above |

A transport error also spends the single attempt. The next assistant generation is the recovery
boundary and may make its own one initial call. Generation, reset-boundary, and stale-result fences
remain in the existing persistence owners.

Consumer eligibility and physical budgeting are separate. The visibility gate controls only whether
Suggested Replies may enter the shared prompt; it does not prevent Status + Relationship sharing.
Every shared or standalone Status attempt returns `postTurnPhysicalAttempted`, and the route passes
that one result to both downstream consumers. Suggested Replies synchronously persists a terminal
generation-scoped `noRetry` record when that result is true, so no crash-sensitive pending job exists.
On reconnect, requeue also checks the generation-scoped provider ledger and fails closed when a
physical row exists or budget evidence cannot be read. The in-memory `running` set remains only a
concurrency optimization.

Original-turn Suggested Replies eligibility is also persisted in the same existing record. An
ineligible turn writes terminal failed/no-retry state with an `original_turn_ineligible` reason after
finalization, so a later GET cannot turn
an absent logical record into new provider work. Eligible turns with no prior physical attempt retain
their one standalone call. Receipt coverage treats that reason as not expected rather than a provider
failure. No new table, column, or parallel budget marker is used.

Standalone Status calls now write the existing `status_widget_extract` physical ledger family;
shared calls continue to own `post_turn_shared_initial`. Removed repair/fallback prompt builders and
their provider-contract tests were **SAFE TO DELETE** because runtime reader search returned zero.
The renamed instruction-echo sanitizer is **KEEP** because both standalone and shared parsers use it.
Historical repair/fallback diagnostic enum values are **KEEP** for stored telemetry compatibility;
they no longer have runtime provider invocation sites.

The Status-only `fallbackModelId` plumbing and OpenRouter V4 fallback assertions were **SAFE TO
DELETE**: runtime search found no Status fallback caller. `OPENROUTER_DEEPSEEK_V4_FLASH_MODEL`
remains a shared model constant for non-Status owners, not a Status fallback. The `usedFallback`
result field is **KEEP FOR COMPAT** so historical diagnostics and receipt shapes remain readable;
new Status extraction always reports it as false.

## Relationship Memory audit

Relationship Memory remains active and is not the same thing as rolling/episodic summary memory.
Its durable writer merges `items`, `itemsRemove`, `promisesAdd`, and `promisesRemove` into
`chats.memory_meta`; the prompt-building path reads that projection, and scene momentum also reads
active promises. Chat fork/reset/regeneration code carries or fences the same projection. Therefore
the durable items/promises system is **KEEP**.

Legacy `honorifics`, `thoughts`, and `currentLocation` remain accepted by the broader memory schema
and compatibility readers. The shared automatic writer does not add them. Existing database rows,
API/UI memory editing, fork compatibility, and rollback compatibility make them **FOLLOW-UP**, not
safe deletion candidates here. This bugfix performs no destructive migration.

## Failure policy

Valid independent sections survive another section's failure. Explicitly present empty relationship
arrays are a valid no-op. Missing/malformed relationship data and shared transport failures remain
distinguishable failures, preserve the previous durable value, and never invoke another provider.
Malformed suggestions persist as empty/failed; malformed status retains canonical previous values
through the existing merge/temporal behavior or makes no update.
