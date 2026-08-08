# 09 — Risk Register

Severity-ordered risks from the Phase A audit. Each entry: confirmed / possible / disproved, evidence, affected files, recommended fix.

## P0

### regen double-apply (numeric)
- **Status:** possible (no numeric system yet); the structural precondition is confirmed.
- **Evidence:** `persistEpisodicMemoryFactsBestEffort` idempotency keys on `(assistant_message_id, request_id)` (`episodicMemoryFacts.ts:457-468`). Regens use a new `request_id`, so a replay would not no-op. The route calls persist only when `extractedFactsForPersistence.length > 0` (`route.ts:4595`). For a future numeric reducer, without idempotency on `(chat_id, assistant_message_id, state_key, request_id)`, the same finalize could double-apply a delta.
- **Affected:** future reducer; `route.ts:4562-4636`.
- **Recommended fix:** unique `idempotency_key` = `chat_id:assistant_message_id:state_key:request_id`; reducer no-op if key exists.

### regen stale episodic fact (empty-fact replacement)
- **Status:** CONFIRMED.
- **Evidence:** `route.ts:4595` gates persist on `extractedFactsForPersistence.length > 0`. Empty-fact regen never calls the library DELETE (`episodicMemoryFacts.ts:470-480`).
- **Affected:** `src/app/api/chat/route.ts:4595-4619`; `src/lib/episodicMemoryFacts.ts:436-537`.
- **Recommended fix:** call `persistEpisodicMemoryFactsBestEffort` on regen regardless of array length, with `facts: []` and `replaceSourceTurn: true`.

### regen stale trigger event
- **Status:** CONFIRMED.
- **Evidence:** no `DELETE FROM status_trigger_events` on regen; only full chat reset (`session/route.ts:90`). Stale `is_consumed=0` events from a superseded variant are consumed on the next normal turn (`loadQueuedStatusTriggerEventsForPrompt`, `route.ts:1382`). `fire_once=true` triggers are permanently blocked by the rejected variant's event (`alreadyFired`, `statusWidgetTriggers.ts:418-422`).
- **Affected:** `src/lib/statusWidgetTriggers.ts:439-529`; `src/app/api/chat/route.ts:4621-4636`.
- **Recommended fix:** on regen finalize, delete `status_trigger_events` for `(chat_id, source_turn)` (or by `source_message_id`/`generation_sequence`) before evaluating the new variant.

### manual edit / state-memory divergence
- **Status:** CONFIRMED.
- **Evidence:** `message/route.ts:176-190` preserves `existing.extracted_facts` and never touches `episodic_memory_facts` DB rows. Editing prose from "동행하기로 했다" to "동행을 거절했다" leaves the stale fact.
- **Affected:** `src/app/api/chat/message/route.ts:135-215`; `src/lib/episodicMemoryFacts.ts`.
- **Recommended fix:** on material prose edit, delete `episodic_memory_facts` by `metadata.assistant_message_id` (invalidate, do not re-extract).

### variant / state divergence
- **Status:** CONFIRMED (for triggers/episodic); possible (for future numeric).
- **Evidence:** `variant/route.ts:71-93` updates `status_widget_values_json` only; no episodic/trigger reconciliation. Switching from a variant that fired a trigger to one that should not leaves the queued event.
- **Affected:** `src/app/api/chat/message/variant/route.ts`.
- **Recommended fix:** numeric state is turn-keyed (last finalized wins) — variant switch updates display snapshot only. Triggers must be reconciled on switch (delete/supersede deactivated variant's events, re-evaluate selected variant).

### failed generation state advance
- **Status:** disproved (already guarded).
- **Evidence:** `loadPrevious.ts:8-13` excludes non-success statuses; widget extract gated on `active`; persist/eval only in success path (`route.ts:4177-4637`); `finalizeAssistantMessage` idempotency (`streamingPersistence.ts:462-468`).
- **Affected:** none — invariant `NO_FINAL_ASSISTANT → NO_NUMERIC_STATE_COMMIT` already holds. Future reducer must stay inside the same gate.

## P1

### concurrent lost update
- **Status:** possible.
- **Evidence:** no `BEGIN IMMEDIATE` or revision CAS around finalize persist/eval. Two near-simultaneous finalizes could lost-update.
- **Affected:** `route.ts:4562-4636`; future reducer.
- **Recommended fix:** short synchronous `BEGIN IMMEDIATE` transaction with per-chat revision CAS for the reducer commit.

### legacy bootstrap ambiguity
- **Status:** possible.
- **Evidence:** no numeric state rows exist today; bootstrap value would come from the latest snapshot string, which may be placeholder/unknown. `loadPrevious.ts` already filters placeholders.
- **Affected:** future bootstrap.
- **Recommended fix:** lazy bootstrap only from valid numeric snapshot; else `creator.initialValue` if `numericState` configured; never default to 0.

### numeric parsing ambiguity
- **Status:** possible.
- **Evidence:** `normalizeRuntimeValue` (`statusWidgetTriggers.ts:386`) takes the first numeric substring — "약 43%" → 43. Inconsistent with a typed numeric field.
- **Affected:** future reducer.
- **Recommended fix:** reducer parses the configured numeric field strictly (Number() or regex on the whole value); legacy string triggers keep `normalizeRuntimeValue`.

### trigger repeated firing
- **Status:** possible.
- **Evidence:** `fire_once=0` + `alreadyQueuedForTurn` allows one event per turn; threshold-true-every-turn would queue every turn.
- **Affected:** `statusWidgetTriggers.ts:425-437`.
- **Recommended fix:** future threshold-crossing semantics (`crosses_up`/`crosses_down`) using ledger `before_value` to fire once on crossing.

### message snapshot / current mismatch
- **Status:** CONFIRMED (post-variant-switch and post-manual-edit).
- **Evidence:** variant switch and manual edit write `status_widget_values_json` without updating canonical numeric state (none exists) or triggers/episodic.
- **Affected:** `variant/route.ts`; `message/route.ts`.
- **Recommended fix:** future reducer overwrites numeric fields in the snapshot with canonical values before save.

## P2

### prompt duplication
- **Status:** disproved (current). Possible if Phase B adds long numeric rules to the main RP prompt.
- **Evidence:** main RP prompt has no numeric-state rules today.
- **Recommended fix:** keep numeric rules in the **background extractor** prompt only; main RP prompt gets at most a compact `[CURRENT SERVER STATE]` read-only block.

### extra token cost
- **Status:** disproved (current).
- **Evidence:** no numeric extraction call exists; existing extraction reused.
- **Recommended fix:** maintain 0 additional LLM calls. Option A (absolute proposal reuse) keeps this.

### UI historical edit confusion
- **Status:** possible.
- **Evidence:** manual edit allowed on any assistant message; editing an old message's numeric value currently mutates that snapshot only.
- **Recommended fix:** block server-owned numeric edits on historical messages (or historical-only, no current-state mutation).

### migration complexity
- **Status:** possible.
- **Evidence:** thousands of existing chats have no numeric state rows.
- **Recommended fix:** lazy bootstrap (doc 08); no bulk rewrite.

## Disproved risks

- **failed generation state advance:** disproved — already guarded (see P0).
- **prompt duplication / extra token cost:** disproved currently; only a Phase B design discipline risk.
