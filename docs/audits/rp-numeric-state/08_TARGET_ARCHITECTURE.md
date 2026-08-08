# 08 — Target Architecture (Design Only — Not Implemented)

Design for the Server-Authoritative RP Numeric State System, grounded in the Phase A audit. No code changes.

## Core principle

```text
Small deterministic state machine (server reducer)
+
LLM semantic observer (existing background extractor)
+
event-aware persistence (current projection + compact ledger)
```

LLM proposes; server reduces and commits. LLM is never the numeric authority.

## Layer 1 — Definition

Creator marks a status field as server-authoritative numeric via optional `numericState?` on `StatusWidgetField` (see doc 07). Legacy fields stay on the existing string extractor path. **Not all fields are forced into the numeric engine.**

Pilot fields: `affection`, `trust`, `corruption` (`server_meter`). `d_day` classified as `server_counter`/`computed` separately.

## Layer 2 — Canonical Current Projection

```text
rp_numeric_state_current
  chat_id              INTEGER NOT NULL
  character_id        INTEGER
  state_key           TEXT NOT NULL
  numeric_value       REAL NOT NULL
  revision            INTEGER NOT NULL
  last_source_turn    INTEGER NOT NULL
  last_source_message_id  INTEGER
  last_generation_sequence INTEGER
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
  UNIQUE (chat_id, state_key)
  INDEX (chat_id, character_id)
```

This table is the **single Source of Truth** for numeric values. `messages.status_widget_values_json` becomes a display snapshot, not the SoT.

## Layer 3 — Audit/Event Ledger

```text
rp_numeric_state_events
  id                  INTEGER PK
  chat_id             INTEGER NOT NULL
  state_key           TEXT NOT NULL
  before_value        REAL
  proposed_value      REAL
  proposed_delta      REAL
  applied_delta       REAL
  after_value         REAL
  source_turn         INTEGER NOT NULL
  assistant_message_id  INTEGER
  request_id         TEXT
  generation_sequence INTEGER
  source_kind         TEXT   -- extractor | manual_override | computed | legacy_bootstrap | future_game_event
  status             TEXT   -- active | superseded | reverted | rejected | noop
  idempotency_key    TEXT NOT NULL
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
  UNIQUE (idempotency_key)
  INDEX (chat_id, state_key, source_turn)
  INDEX (chat_id, assistant_message_id)
```

Compact append-only ledger. Not full event sourcing — current projection + ledger is sufficient.

`idempotency_key` recommended: `chat_id:assistant_message_id:state_key:request_id` (see doc 09 for alternatives).

## Server Reducer responsibilities

```text
numeric parsing
min/max clamp
integer/decimal coercion
missing → HOLD previous
invalid → HOLD previous
placeholder → HOLD previous
per-turn delta bounds (maxIncreasePerTurn / maxDecreasePerTurn)
direction constraint
idempotency (idempotency_key unique)
regeneration replacement (delete events + recompute current for source_turn)
manual override (higher authority than extractor)
revision conflict (CAS)
```

Example: canonical before=40, proposal=999, max=100, maxIncreasePerTurn=5 → after=45 (delta limited to +5), ledger records `proposed=999, applied_delta=+5, after=45, status=DELTA_LIMITED`.

## LLM role

```text
existing background extractor
  ↓
candidate / proposal (absolute value, Option A)
  ↓
server reducer
  ↓
canonical value
```

**Additional LLM calls = 0.** Reuse the existing Status Widget extraction. No new numeric extraction call.

## Proposal model — Option A (recommended for Phase B)

Reuse the existing widget numeric output as an **absolute candidate**.

```text
previous canonical = 40
extractor output   = 44  (absolute string in character namespace)
server delta       = +4
server applies policy (clamp, delta bounds)
canonical after    = 44 (or clamped)
```

**Pros:** prompt change ≈ 0, schema simple, 0 additional API calls, reuses existing extraction JSON.
**Cons:** absolute value can swing wildly (hence delta bounds + clamp are essential).

Option B (separate `numeric_state_updates` delta proposal in the extract JSON) is **not recommended for v1** — it increases extract prompt complexity and model compliance burden with little benefit over Option A + server policy.

## Snapshot synchronization

After reducer commit, overwrite numeric fields in the status payload with canonical values before saving:

```text
non-numeric fields = normalized extractor values
numeric server fields = canonical server values (overwrite)
→ messages.status_widget_values_json
→ variant.statusWidgetValues
→ UI
```

This keeps UI, triggers, and next-turn numeric state consistent.

## Trigger source change

Numeric triggers read `rp_numeric_state_current` (typed). Legacy string triggers keep the existing creator-snapshot path. Trigger evaluation branches:

```text
numeric field → canonical typed state
legacy field   → existing creator status snapshot
```

## Manual edit semantics

- **Latest canonical assistant message:** manual numeric edit = `manual_override` event → validate → clamp → update current projection. Higher authority than extractor.
- **Historical message:** server-owned numeric fields **not editable** on old messages (or historical-only, no current-state mutation). Safest: block historical numeric edit.

## Regeneration semantics

Invariant:
```text
T10 variant A: affection 40 → 45
regen T10 variant B: affection 40 → 42
final canonical = 42   (NOT 40 → 45 → 47)
```

Implementation: on regen finalize for `source_turn=N`, within one transaction:
1. DELETE `rp_numeric_state_events` for `(chat_id, source_turn)` where `source_kind='extractor'`.
2. Re-read canonical **before** value = the value as of `source_turn - 1` (the prior turn's committed value). **This requires storing per-turn before-values or replaying from the ledger.**
3. Reduce variant B's proposal against that before-value.
4. Commit new current + event.

**Historical regen (T10 after T12 exists):** requires replay/rebase of T11/T12. **v1 restricts numeric-state regen to latest assistant only** (matches current UI), avoiding replay.

## Variant switch

Numeric state is **turn-keyed, written once per finalized turn** (last finalized wins). Variant switch updates the display snapshot only (`messages.status_widget_values_json` from the selected variant), **not** canonical numeric state. This avoids replay on switch. Triggers must be reconciled on switch (delete/supersede events for the deactivated variant) — see doc 05.

## Failed turn

```text
NO_FINAL_ASSISTANT → NO_NUMERIC_STATE_COMMIT
```
Reducer runs only inside the success-finalize gate (same as current status widget path). Failed/interrupted/invalid generations do not advance numeric state.

## Background extract failure

```text
invalid/missing/placeholder proposal → HOLD canonical previous value
state event = NO-OP
trigger = no new evaluation caused by fabricated change
```

Never initialize to 0 or arbitrary default on extract failure.

## Legacy bootstrap (lazy)

```text
no numeric state row for (chat_id, state_key)
  ↓
check latest finalized canonical status snapshot
  ↓
valid numeric value? → bootstrap row, source_kind=legacy_bootstrap
  ↓
no trigger fire, no episodic fact
  ↓
no valid value? → use creator initialValue if numericState configured; else leave absent (do NOT default to 0)
```

## Concurrency

```text
LLM/extract await
  ↓
proposal ready
  ↓
short synchronous DB transaction (BEGIN IMMEDIATE)
  ↓
read canonical (revision) → revalidate → reduce → commit current + append event
```

Async LLM call never inside the DB transaction. Per-chat revision CAS or `BEGIN IMMEDIATE` to prevent lost update.

## Observability

Log per decision (no raw RP prose):
```text
[RpNumericState] chat_id, message_id, generation_sequence, state_key,
  before, proposal, applied, after, decision, source_kind
```
decisions: `APPLIED | NO_CHANGE | INVALID_HOLD | CLAMPED_MAX | CLAMPED_MIN | DELTA_LIMITED | IDEMPOTENT_NOOP | REGEN_SUPERSEDED | MANUAL_OVERRIDE`.

## Rollout

```text
RP_NUMERIC_STATE_SHADOW=1  (log only, no commit)
RP_NUMERIC_STATE_ENABLED=0  (default OFF)
admin/user allowlist + chat allowlist
kill switch
```

Shadow → canary → gradual rollout. Never 100% on day one.
