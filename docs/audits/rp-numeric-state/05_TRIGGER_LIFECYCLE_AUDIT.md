# 05 — Trigger Lifecycle Audit

Audit of `status_widget_triggers` and `status_trigger_events`, including the regeneration stale-trigger risk.

## Tables

### `status_widget_triggers` (`db.ts:136-156`)

Creator namespace: stored at `character_id=<id>`, `chat_id IS NULL` (production save path writes only `chat_id IS NULL` rows; per-chat overrides supported by schema but unused).

| Column | Type | Notes |
|---|---|---|
| trigger_id | TEXT | e.g. `corruption_70` |
| status_key | TEXT | bare snake_case, maps to `values.character` namespace |
| operator | TEXT | `<= >= == != < >` |
| value | TEXT | serialized via `serializeTriggerValue` |
| fire_once | INTEGER | default 1 |
| event_key, effect_text | TEXT | |
| visibility | TEXT | always `engine_only` |
| character_knowledge | TEXT | default `unknown` |
| is_enabled | INTEGER | default 1 |

Indexes: `idx_status_widget_triggers_lookup (chat_id, character_id, is_enabled)`, `idx_status_widget_triggers_trigger (trigger_id)`.

### `status_trigger_events` (`db.ts:157-178` + migrations 525-527)

| Column | Type | Notes |
|---|---|---|
| chat_id, character_id | INTEGER | scope |
| trigger_id, event_key | TEXT | |
| source_turn | INTEGER | logical turn |
| effect_text | TEXT | injected into prompt |
| is_consumed | INTEGER | default 0 |
| fired_at, consumed_at | TEXT | |
| metadata | TEXT | JSON duplicate of provenance |
| source_message_id | INTEGER | addColumn |
| request_id | TEXT | addColumn |
| generation_sequence | INTEGER | addColumn |

Indexes: `idx_status_trigger_events_chat_consumed (chat_id, is_consumed, fired_at, id)`, `idx_status_trigger_events_once (chat_id, trigger_id)`, `idx_status_trigger_events_turn (chat_id, trigger_id, source_turn)`.

**Note:** `messages.status_widget_generation_sequence`, `status_widget_request_id`, `status_widget_source_message_id` (`db.ts:512-514`) exist but are **never written or read** in app code. Provenance lives on trigger events and in `MessageVariant` alternates JSON.

## Evaluation

`evaluateStatusWidgetTriggers` (`statusWidgetTriggers.ts:439-529`), wrapper `evaluateStatusWidgetTriggersBestEffort` (531), called at `route.ts:4627-4636`.

### Creator values only

`flattenStatusValues` (380) uses `mergeNamespacedStatusValues(values).creatorForTriggers` — `values.character` only. User widget values cannot satisfy creator triggers. Protected keys (`d_day, affection, trust, corruption`) enforced at merge (`namespaces.ts:58-68`).

### String → numeric parsing (runtime)

`normalizeRuntimeValue` (386): strips commas, matches first `-?\d+(\.\d+)?`, else boolean keywords (true/yes/on/참/예/켜짐 / false/no/off/거짓/아니오/꺼짐), else string. `compareTriggerValues` (397): `==`/`!=` case-insensitive strings; ordering ops require both numeric.

### Same-turn duplicate prevention

- `fire_once=1`: `alreadyFired(db, chatId, triggerId)` — any prior event for `(chat_id, trigger_id)` → skip (418-422, 479).
- `fire_once=0`: `alreadyQueuedForTurn(db, chatId, triggerId, sourceTurn)` — any event for `(chat_id, trigger_id, source_turn)` → skip (425-437, 481).

## Lifecycle

```text
Turn N finalize
  → evaluateStatusWidgetTriggersBestEffort
  → INSERT status_trigger_events (is_consumed=0, source_turn=N)
Turn N+1 request start
  → loadQueuedStatusTriggerEventsForPrompt(db, chatId, 8)   [route.ts:1382]
  → buildTriggeredScenarioEventsPromptBlock → prompt
Turn N+1 finalize
  → markStatusTriggerEventsConsumed(eventIds)               [route.ts:4621]
  → evaluateStatusWidgetTriggersBestEffort (for turn N+1)
```

**No worker/queue table** — consumption is synchronous at finalize of the next chat request.

## CRITICAL — Regen stale trigger event

```text
variant A: corruption=75 → corruption_70 fires (is_consumed=0, source_turn=N)
regen variant B: corruption=40 → threshold not met, no new event
```

| Step | What happens |
|---|---|
| A finalizes | INSERT event row |
| User regens same turn | **No DELETE/supersede.** `replaceSourceTurn` applies only to episodic facts, not triggers. |
| B finalizes (corruption=40) | No new event. A's row remains `is_consumed=0`. |
| `fire_once=true` | `alreadyFired()` sees A's row → trigger can never fire again in this chat. |
| Next normal turn N+1 | `loadQueuedStatusTriggerEventsForPrompt(db, chatId, 8)` — **no `maxSourceTurn` filter on normal sends** (`route.ts:1382-1387`). A's stale event is loaded, injected, and consumed. |

### Partial mitigation (prompt only, not DB)

During regen request startup, queued events with `source_turn > playableTurnCount` are excluded:
```text
route.ts:1382-1387
  loadQueuedStatusTriggerEventsForPrompt(db, chat.id, 8,
    regenerateMessageId ? { maxSourceTurn: playableTurnCount } : undefined)
```
Since current turn's `source_turn = playableTurnCount + 1`, same-turn events (including A's) are excluded from the **regen prompt**. They are NOT deleted/superseded and still fire on the next normal turn.

The only `DELETE FROM status_trigger_events` in the codebase is full chat reset (`session/route.ts:90`).

### Verdict

```text
REGEN_STALE_TRIGGER_EVENT_RISK = CONFIRMED
```

Stale events from a superseded variant are **left in DB**, not deleted or superseded, and are **consumed on the next non-regen turn**. `fire_once=true` triggers are additionally **permanently blocked** by the rejected variant's event.

## Variant switch — same problem

`PATCH /api/chat/message/variant` does not touch `status_trigger_events`. Switching from variant A (fired trigger) to variant B (no trigger) leaves A's queued event. Switching to a variant that should not have fired still consumes A's event next turn.

## Recommended Phase B fix (NOT implemented)

1. On regen finalize, before evaluating new triggers, **delete `status_trigger_events` for `(chat_id, source_turn)` where `source_message_id` = the regenerated assistant message id** (or where `generation_sequence` < new sequence). Then evaluate B's status.
2. On variant switch, delete/supersede trigger events for the deactivated variant's `source_message_id` and re-evaluate the selected variant's status (or mark its events active).
3. Future numeric triggers read `rp_numeric_state_current` (typed), not the string snapshot. Legacy string triggers keep the existing path.
4. Threshold-crossing semantics (`crosses_up`/`crosses_down`) require storing `before_value` to detect crossing rather than re-firing every turn — compatible with `fire_once` if the ledger records the crossing event once.
