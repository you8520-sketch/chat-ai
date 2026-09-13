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
| Suggested Replies | shared runner, then suggestion persistence job | background extractor could retry | persists valid prefetch or an empty failed result; no retry | shared family above |
| Relationship Memory | shared runner, then memory persistence owner | invalid/missing section could call the relationship-only runner | applies a valid delta or preserves `memory_meta` and records `shared_section_invalid_no_retry` | shared family above |

A transport error also spends the single attempt. The next assistant generation is the recovery
boundary and may make its own one initial call. Generation, reset-boundary, and stale-result fences
remain in the existing persistence owners.

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
