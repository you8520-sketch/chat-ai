# Phase B0 — RP Derived-State Integrity Foundation

Derived from Phase A audit PR #261. This PR hardens the existing derived-state lifecycle (assistant generation → status snapshot → episodic facts → trigger events → regeneration → variant → edit → delete). It does NOT implement the numeric state system.

## Status

```text
REGEN_EMPTY_FACT_STALE_MEMORY_BUG = FIXED
REGEN_STALE_TRIGGER_EVENT_RISK = FIXED
MANUAL_EDIT_STALE_EPISODIC_FACT_RISK = FIXED
LAST_TURN_DELETE_STALE_TRIGGER = FIXED
INTERRUPTED_NEW_EPISODIC_GHOST = BLOCKED
INTERRUPTED_NEW_TRIGGER_GHOST = BLOCKED
LATEST_VARIANT_EPISODIC_RECONCILIATION = PASS
LATEST_VARIANT_TRIGGER_RECONCILIATION = PASS
PHASE_B0_ATOMIC_HARDENING_PASS
MATERIAL_EDIT_EMBEDDED_FACT_INDEPENDENT_OF_WIDGET_PATCH = PASS
LATEST_VARIANT_CANONICAL_MUTATION_ATOMIC = PASS
MANUAL_MATERIAL_EDIT_ATOMIC = PASS
LATEST_MANUAL_STATUS_CANONICAL_MUTATION_ATOMIC = PASS
MATERIAL_PLUS_WIDGET_TRIGGER_RECONCILIATION = PASS
STATUS_ONLY_SUPERSESSION_ROLLBACK = PASS
DB_SAVED_STATUS_EQUALS_TRIGGER_INPUT = PASS
MATERIAL_NO_WIDGET_TRIGGER_UNCHANGED = PASS
TRIGGER_REEVALUATION_FAIL_SAFE = PASS
main RP prompt change = 0
background prompt change = 0
API calls = 0
```

## Changes

### P0-1 Regeneration empty-fact replacement
- `src/lib/episodicMemoryFacts.ts`: add `reconcileEpisodicMemoryFactsForGeneration` with explicit contract (normal+facts>0 → insert; normal+facts=0 → noop; regen+facts>0 → replace; regen+facts=0 → delete).
- `src/app/api/chat/route.ts`: replace the `extractedFactsForPersistence.length > 0` gate with `reconcileEpisodicMemoryFactsForGeneration`, gated on `assistantFinalizedThisRequest && isCanonicalDerivedStateGenerationStatus`.

### P0-2 Trigger event supersession
- `src/lib/db.ts` + `src/lib/statusWidgetTriggers.ts`: add backward-compatible columns `is_superseded`, `superseded_at`, `superseded_reason`.
- `alreadyFired`, `alreadyQueuedForTurn`, `loadQueuedStatusTriggerEventsForPrompt` filter `is_superseded=0` (superseded events don't count as fired, aren't queued, aren't loaded).
- `src/lib/rpDerivedStateLifecycle.ts`: `supersedeStatusTriggerEventsForSourceMessage` / `…ForSourceTurn`, `deleteStatusTriggerEventsForSourceMessage`.
- `src/app/api/chat/route.ts`: on regen finalize, supersede prior variant's active trigger events for the source assistant message before re-evaluating (missing event > stale wrong event).

### P0-3 Manual prose edit stale episodic facts
- `src/lib/canonicalProse.ts`: `normalizeEditedProseForDerivedStateComparison` + `isMaterialProseEdit` (CRLF/LF + whitespace normalize; word/sentence/dialogue/action/punctuation change = material).
- `src/app/api/chat/message/route.ts`: material prose edit → delete `episodic_memory_facts` by `metadata.assistant_message_id` and clear embedded `extracted_facts`; format-only / status-only edit → preserve facts.

### Last-turn delete trigger cleanup
- `src/app/api/chat/turn/route.ts`: in the same transaction, delete `status_trigger_events` for the deleted assistant (no stale queued / fire_once ghost).

### Latest manual status edit → trigger reconciliation
- `src/app/api/chat/message/route.ts`: latest assistant status-only edit → supersede old events + re-evaluate with edited status (provenance preserved, `manual_status_edit` reason). Historical status edit → display snapshot only + `HISTORICAL_MANUAL_EDIT_LONG_TERM_SUMMARY_RECONCILIATION_UNVERIFIED` diagnostic.

### Phase B0.1 — atomic mutation hardening
- Material prose edit clears embedded `extracted_facts` even when `statusWidgetValues` is omitted (character/user preserved).
- `persistEpisodicMemoryFactsCore` (strict) + best-effort wrapper; canonical mutations use `replaceEpisodicMemoryFactsForCanonicalMutation`.
- `executeAtomicVariantSwitchCore`: message UPDATE + trigger supersession + episodic reconcile = ONE TRANSACTION; trigger re-eval after commit (best-effort).
- `executeAtomicManualEditCore` (B0.1): message UPDATE + episodic invalidation = ONE TRANSACTION.

### Phase B0.2 — manual status trigger atomicity (final B0 gate)
- `executeAtomicManualEditCore` extended: when caller sets `supersedeTriggers=true`, previous active trigger events are superseded **inside the same transaction** as message/status UPDATE (+ episodic invalidation when material).
- Route policy: `supersedeTriggers = hasWidgetPatch && isLatest` (explicit caller policy; material prose without widget patch leaves triggers untouched).
- Trigger re-evaluation after commit uses **saved sanitized** payload; `materialProseChange` no longer blocks re-eval when a widget patch is present (material+widget reconciles triggers).
- No double supersession in the route — core supersedes once; route only evaluates.
- Transaction boundary:
  ```text
  LATEST_MANUAL_WIDGET_EDIT_CANONICAL_CORE:
  message/status UPDATE + episodic invalidation if needed + trigger supersession
  = ONE TRANSACTION
  TRIGGER_REEVALUATION: AFTER COMMIT, BEST-EFFORT
  ```

### Interrupted / failed_partial derived-state guards
- `src/lib/rpDerivedStateLifecycle.ts`: `isCanonicalDerivedStateGenerationStatus` (only completed / ok / completed_with_postprocess_error).
- `src/app/api/chat/route.ts`: `derivedStateAllowed = assistantFinalizedThisRequest && isCanonicalDerivedStateGenerationStatus(persistedGenerationStatus)` gates episodic reconcile + trigger eval. `interrupted` / `failed_partial` / `failed` produce no new durable facts/events. Queued-trigger consumption semantics unchanged.

### Latest variant switch reconciliation
- `src/app/api/chat/message/variant/route.ts`: latest assistant variant switch → supersede old trigger events + replace source-turn episodic facts with selected variant's facts + re-evaluate triggers. Historical switch → `HISTORICAL_VARIANT_DERIVED_STATE_REPLAY_UNSUPPORTED` diagnostic (no fake replay).

### Phase B1 preparation helpers (no numeric tables)
- `src/lib/rpDerivedStateLifecycle.ts`: `hasLaterCanonicalTurn`, `isLatestCanonicalAssistantMessage`, `getLatestCanonicalAssistantMessageId`, `getAssistantSourceTurn`.

## Not in scope (B0)

```text
rp_numeric_state_current = NOT IMPLEMENTED
rp_numeric_state_events = NOT IMPLEMENTED
numericState field config = NOT IMPLEMENTED
numeric reducer = NOT IMPLEMENTED
numeric shadow mode = NOT IMPLEMENTED
main RP prompt change = NO
background extractor prompt change = NO
new LLM call = NO
API model call = 0
pricing change = NO
public UI change = NO
creator UI change = NO
production DB apply = NO
deploy = NO
```

## Tests

- `src/lib/rpDerivedStateEpisodic.test.ts` — E1-E8
- `src/lib/rpDerivedStateTriggers.test.ts` — T1-T9
- `src/lib/rpDerivedStateGuards.test.ts` — I1-I6, V1-V5
- `src/lib/rpDerivedStateAtomicHardening.test.ts` — A1-A4, TX1-TX5 (B0.1), TX6-TX9 (B0.2)
- Existing: episodicMemoryFacts, statusWidgetTriggers, canonicalProse, streamingPersistence, messageAlternates, regenerationContext all PASS (no regression).

## Verification

```text
typecheck:app = PASS
lint = PASS
new API calls = 0
numeric tables = NOT_RUN
DB production apply = NO
deploy = NO
merge = NOT_RUN
```

Phase B1 is NOT started. Awaiting direction.
