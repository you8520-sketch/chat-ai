# 10 — Phase B Implementation Plan (Design Only — Not Implemented)

Concrete Phase B spec derived from the Phase A audit. **No implementation in Phase A.**

## Exact DB schema

```sql
CREATE TABLE IF NOT EXISTS rp_numeric_state_current (
  chat_id              INTEGER NOT NULL,
  character_id        INTEGER,
  state_key           TEXT NOT NULL,
  numeric_value       REAL NOT NULL,
  revision            INTEGER NOT NULL DEFAULT 0,
  last_source_turn    INTEGER NOT NULL,
  last_source_message_id  INTEGER,
  last_generation_sequence INTEGER,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, state_key)
);
CREATE INDEX IF NOT EXISTS idx_rp_numeric_state_current_chat ON rp_numeric_state_current(chat_id, character_id);

CREATE TABLE IF NOT EXISTS rp_numeric_state_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id             INTEGER NOT NULL,
  state_key           TEXT NOT NULL,
  before_value        REAL,
  proposed_value      REAL,
  proposed_delta      REAL,
  applied_delta       REAL,
  after_value         REAL,
  source_turn         INTEGER NOT NULL,
  assistant_message_id  INTEGER,
  request_id         TEXT,
  generation_sequence INTEGER,
  source_kind         TEXT NOT NULL,  -- extractor | manual_override | computed | legacy_bootstrap | future_game_event
  status             TEXT NOT NULL,    -- active | superseded | reverted | rejected | noop
  idempotency_key    TEXT NOT NULL UNIQUE,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rp_numeric_state_events_turn ON rp_numeric_state_events(chat_id, state_key, source_turn);
CREATE INDEX IF NOT EXISTS idx_rp_numeric_state_events_msg ON rp_numeric_state_events(chat_id, assistant_message_id);
```

Both writes (current + event) in **one transaction**. Foreign lifecycle: delete on chat delete and last-turn delete (same transaction as messages/episodic).

## Exact TypeScript types

```text
type NumericStateDefinition = {
  enabled: true;
  min: number;
  max: number;
  initial: number;
  integer: boolean;
  authority: "server";
  maxIncreasePerTurn?: number;
  maxDecreasePerTurn?: number;
  manualEditable?: boolean;
};

// Extend StatusWidgetField with optional numericState?: NumericStateDefinition

type NumericStateEvent = {
  chatId: number;
  stateKey: string;
  beforeValue: number | null;
  proposedValue: number | null;
  proposedDelta: number | null;
  appliedDelta: number | null;
  afterValue: number | null;
  sourceTurn: number;
  assistantMessageId: number | null;
  requestId: string | null;
  generationSequence: number | null;
  sourceKind: "extractor" | "manual_override" | "computed" | "legacy_bootstrap" | "future_game_event";
  status: "active" | "superseded" | "reverted" | "rejected" | "noop";
  idempotencyKey: string;
};

type ReducerDecision =
  | "APPLIED" | "NO_CHANGE" | "INVALID_HOLD" | "CLAMPED_MAX"
  | "CLAMPED_MIN" | "DELTA_LIMITED" | "IDEMPOTENT_NOOP"
  | "REGEN_SUPERSEDED" | "MANUAL_OVERRIDE";
```

## Exact reducer API

```text
function reduceNumericStateProposal(
  db: Database,
  input: {
    chatId: number;
    characterId: number;
    stateKey: string;
    definition: NumericStateDefinition;
    proposal: string | number | null | undefined;  // from extractor character namespace
    sourceTurn: number;
    assistantMessageId: number;
    requestId: string | null;
    generationSequence: number | null;
    sourceKind: "extractor" | "manual_override" | "legacy_bootstrap";
  }
): { afterValue: number; decision: ReducerDecision; event: NumericStateEvent };
```

Reducer steps: parse → validate → compute delta vs canonical before → clamp min/max → apply per-turn delta bounds → integer coercion → idempotency check → commit current + append event in one transaction.

## Exact transaction boundary

```text
BEGIN IMMEDIATE
  SELECT numeric_value, revision FROM rp_numeric_state_current WHERE chat_id=? AND state_key=?
  SELECT COUNT(*) FROM rp_numeric_state_events WHERE idempotency_key=?
  (if count>0 → IDEMPOTENT_NOOP, rollback)
  compute afterValue
  UPDATE rp_numeric_state_current SET numeric_value=?, revision=revision+1, last_source_turn=?, ...
  INSERT INTO rp_numeric_state_events (...)
COMMIT
```

The async LLM extraction runs **before** this transaction. The transaction is short and synchronous.

## Exact route integration point

`route.ts:4562-4636` — after `finalizeAssistantMessage`, before/alongside episodic persist and trigger eval. Order (doc 43):

```text
1. assistant generation accepted/finalized (already gated on success status)
2. status background extract completes (existing)
3. raw status candidate sanitize (existing)
4. numeric proposals separated (per field with numericState)
5. BEGIN IMMEDIATE
6. read canonical numeric state
7. idempotency/regen/version validation
8. server reducer (per field)
9. commit rp_numeric_state_current + append events
10. overwrite numeric fields in statusWidgetValuesPayload with canonical values
11. message/variant snapshot persist (existing finalize path; snapshot now reflects canonical numerics)
12. episodic facts reconcile (existing + fix: call persist on regen regardless of length)
13. stale replaced-turn facts remove (existing replaceSourceTurn)
14. triggers evaluate from committed canonical numeric state (numeric fields) / legacy snapshot (string fields)
15. stale replaced-variant trigger events reconcile (NEW: delete by source_turn/source_message_id on regen)
16. COMMIT
17. response/client
```

**Caveat:** current route does step 11 (finalize) **before** step 5-10. To overwrite numeric fields in the snapshot before save, the reducer must run **before** `finalizeAssistantMessage`, or finalize must be re-issued after the reducer overwrites the payload. Phase B must reorder so the reducer runs before the snapshot save, or perform a second UPDATE of `status_widget_values_json` after the reducer. This is the main structural friction point — report it; do not force a single transaction if it risks the streaming finalize contract.

## Exact regeneration reconciliation

On regen finalize for `source_turn=N` (latest assistant only in v1):
1. DELETE `rp_numeric_state_events` for `(chat_id, source_turn)` where `source_kind='extractor'`.
2. Re-derive `before_value` = canonical value as of `source_turn - 1`. **Requires per-turn before-values:** either store `before_value` on each event (already in schema) and replay from the earliest event for that turn, or store a per-turn snapshot. v1 stores `before_value` on events; replay reads the latest event with `source_turn < N` for the before-value.
3. Reduce variant B's proposal against that before-value.
4. Commit new current + event.
5. DELETE `status_trigger_events` for `(chat_id, source_turn)` (NEW — fixes doc 05).
6. Re-evaluate triggers from the new canonical numeric state.

## Exact manual edit integration

`PATCH /api/chat/message`:
- If editing the **latest** assistant message and the field has `numericState.enabled`: treat incoming numeric value as `manual_override` proposal → reducer (`sourceKind: "manual_override"`) → commit. Higher authority than extractor.
- If editing a **historical** message: server-owned numeric fields **not editable** (reject or ignore). Display-only non-numeric fields remain editable.
- On material prose edit (normalized diff non-empty): delete `episodic_memory_facts` by `metadata.assistant_message_id` (fixes doc 06). Do not re-extract.

## Exact episodic-memory filter change

Background extractor prompt gets a short boundary (doc 21):
```text
Server-owned numeric meter/counter values are not episodic facts.
If a durable narrative event caused the numeric change, store the event, not the meter number.
```
Added to the **background status extractor** prompt only (`extract.ts` extract prompt builder), NOT the main RP system prompt.

Plus route fix: call `persistEpisodicMemoryFactsBestEffort` on regen regardless of `extractedFactsForPersistence.length` (fixes doc 04 Case B).

## Exact trigger change

- Numeric fields: `evaluateStatusWidgetTriggers` reads `rp_numeric_state_current` (typed) instead of parsing the creator snapshot string. Branch: `numericState.enabled` → canonical; else → existing string path.
- Regen: delete `status_trigger_events` for `(chat_id, source_turn)` before re-evaluating (fixes doc 05).
- Variant switch: delete/supersede trigger events for the deactivated variant's `source_message_id`; re-evaluate selected variant's status (or mark active).
- Threshold crossing: v2 adds `crosses_up`/`crosses_down` using ledger `before_value` (not v1).

## Exact tests (matrix from §38)

1-30 from the spec, plus:
- 31. A/B active variant switch (numeric state unchanged, snapshot updated, triggers reconciled)
- 32. switch after later turn exists (numeric state turn-keyed, no replay)
- 33. regen empty-fact replacement (fix verification)
- 34. regen stale-trigger deletion (fix verification)
- 35. manual prose edit invalidates episodic facts (fix verification)
- 36. last-turn delete removes trigger events (fix verification)
- 37. shadow mode logs without committing
- 38. idempotency key collision → IDEMPOTENT_NOOP

## Exact rollout flags

```text
RP_NUMERIC_STATE_ENABLED=0       (default OFF)
RP_NUMERIC_STATE_SHADOW=0        (default OFF; =1 logs only)
RP_NUMERIC_STATE_ALLOWLIST_USERS=
RP_NUMERIC_STATE_ALLOWLIST_CHATS=
RP_NUMERIC_STATE_KILL_SWITCH=0
```

## Cost / performance

- Additional main RP calls: 0.
- Additional background LLM calls: 0.
- Per-turn commit: O(number of configured numeric fields) — small SQLite transaction.
- No full episodic scan or chat history replay per turn. Replay only on regen/delete/variant-switch (rare lifecycle events).

## Non-regression

Must not break: existing non-numeric widgets, user overlay, protected creator keys, HTML rendering, status value editor, status background billing, repair/fallback, episodic recall, episodic temporary filter, memory summary cadence, status triggers, message variants, regeneration, RP output/prose.

## Phase B NOT included (P3)

complex formula DSL, cross-character shared state, party numeric state, full historical replay engine, threshold-crossing DSL (v2).
