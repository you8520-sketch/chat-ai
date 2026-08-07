# 06 — Manual Edit, Delete & Failed-Turn Audit

## Manual assistant edit

### Route

`PATCH /api/chat/message` (`message/route.ts:135-215`). Client `saveEdit()` (`ChatClient.tsx:3219-3311`) always sends `statusWidgetValues: { character, user }` for assistant edits.

### extracted_facts / episodic memory behavior

```text
message/route.ts:176-190
  if (hasWidgetPatch) {
    const existing = parseStoredStatusWidgetValuesJson(msg.status_widget_values_json);
    const merged = {
      character: incomingWidgets?.character ?? null,
      user: incomingWidgets?.user ?? null,
      ...(existing.extracted_facts?.length
        ? { extracted_facts: existing.extracted_facts }
        : {}),
    };
    ...
  }
```

- `parseIncomingWidgetValues` (125) only accepts `character`/`user` — never incoming `extracted_facts`.
- Existing `extracted_facts` are **copied verbatim** into the merged JSON.
- **No call** to `persistEpisodicMemoryFactsBestEffort`, `deleteEpisodicMemoryFactsByAssistantMessageIds`, or any episodic re-sync.
- `episodic_memory_facts` DB rows (keyed by `metadata.assistant_message_id`) are **untouched**.

### Side effect

Edit collapses alternates to a single `editedMessageVariant` (169-202): regen history lost, per-variant `statusWidgetValues` snapshots discarded.

### Material-change detection

**None.** `normalizeEditedProseForSave` (`canonicalProse.ts:61`) only normalizes line endings. No diff, no whitespace/no-op guard, no re-extraction trigger.

### Answers

```text
기존 extracted_facts가 그대로 유지되는가?  → YES (copied into JSON)
assistant 본문이 크게 변경돼도 기존 fact가 남는가?  → YES
status numeric value만 수정해도 old fact가 유지되는가?  → YES (facts always preserved)
```

### Verdict

```text
MANUAL_EDIT_STALE_EPISODIC_FACT_RISK = CONFIRMED
```

Example: original prose "에녹과 렌은 동행하기로 했다" → fact "둘은 동행하기로 합의했다". User edits prose to "에녹은 동행을 거절했다" — old fact remains in `episodic_memory_facts` and is still recalled.

Per the design principle `stale wrong memory > missing memory` is **rejected** for this case: a fact that contradicts the edited prose is wrong and must not be preserved.

## Delete / reset

### Operations

| Operation | Route | File:lines |
|---|---|---|
| Last-turn delete (user+assistant pair) | `DELETE /api/chat/turn` | `turn/route.ts:16-94` |
| Assistant-only delete | **Not implemented** | — |
| User message edit | `PATCH` user branch | `message/route.ts:213-214` |
| Chat init / 새 대화 | `createChatSession` | `chatSessionCreate.ts:29-91` |
| Chat delete | `DELETE /api/chat/session` | `session/route.ts:35-110` |
| Orphan user message purge | `purgeOrphanUserMessages` | `chatMessageHygiene.ts:44-56` |

`getLastTurnMessageIds` (`chatAccess.ts:30-49`): last user + following non-greeting assistant.

### Cleanup matrix

| Artifact | Last-turn DELETE | Chat DELETE | Chat init | Orphan purge |
|---|---|---|---|---|
| `messages.status_widget_values_json` | deleted with row | deleted with messages | n/a (new) | n/a |
| `episodic_memory_facts` | **YES** by `assistant_message_id` | YES `WHERE chat_id=?` | no | no |
| `status_trigger_events` | **NO** | YES `WHERE chat_id=?` | no | no |
| `status_widget_triggers` (chat-scoped) | no | YES `WHERE chat_id=?` | no | no |
| queued triggers (`is_consumed=0`) | **remain** | deleted with chat | n/a | n/a |
| memory summary coverage | reconciled (`reconcileMemoryAfterTurnDelete`) | `DELETE FROM chat_turn_summaries` | no | no |

### Last-turn delete code

```text
turn/route.ts:58-73
  db.transaction(() => {
    for (id of idsToDelete) DELETE FROM bookmarks WHERE message_id=?
    if (lastTurn.assistantId != null)
      deleteEpisodicMemoryFactsByAssistantMessageIds(db, cId, [lastTurn.assistantId])
    for (id of idsToDelete) DELETE FROM messages WHERE id=? AND chat_id=?
    if (engagementDelta > 0) incrementCharacterTotalTurns(...)
  })()
```

`deleteEpisodicMemoryFactsByAssistantMessageIds` (`episodicMemoryFacts.ts:544-575`): `DELETE FROM episodic_memory_facts WHERE chat_id=? AND json_extract(metadata,'$.assistant_message_id') IN (...)`.

**Gap:** last-turn delete does NOT delete `status_trigger_events` for that turn. If the deleted assistant had fired a trigger that is still queued (`is_consumed=0`), it remains and fires on the next turn — for a turn that no longer exists.

## Failed / interrupted turns

### Generation status values

`streamingPersistence.ts:9-17`: `submitted`, `generating`, `completed`, `ok`, `completed_with_postprocess_error`, `failed`, `failed_partial`, `interrupted`.

### Canonical anchor eligibility

`loadPrevious.ts:8-13`:
```text
CANONICAL_STATUS_WIDGET_GENERATION_STATUSES = ['completed', 'ok', 'completed_with_postprocess_error']
```
`failed`, `failed_partial`, `interrupted`, `generating`, `submitted` are **excluded** as previous canonical anchor.

### Does a failed turn advance canonical state?

**No.** Guards:
- A. Anchor query excludes non-success statuses.
- B. Widget extract gated on `resolved.active` (`extract.ts:1007`).
- C. Status resolve + DB save only on success path (`route.ts:4177-4197`); failed paths return before this block.
- D. `finalizeAssistantMessage` idempotency won't rewrite already-completed rows (`streamingPersistence.ts:462-468`).
- E. Regen bootstrap clears `status_widget_values_json=''` (`streamingPersistence.ts:191-195`).

### Can a failed turn commit status/episodic/triggers?

| Commit | On failure? |
|---|---|
| `status_widget_values_json` | No (except `completed_with_postprocess_error` keeps partial **prose** only, no widget JSON) |
| `episodic_memory_facts` | No (persist only after successful finalize, `route.ts:4595-4618`) |
| `status_trigger_events` (new fires) | No (eval only after finalize, `route.ts:4627-4637`) |
| queued trigger consumption | No (`markStatusTriggerEventsConsumed` only after finalize, `route.ts:4621`) |
| partial prose in DB | Yes (`markAssistantFailed`/`markAssistantInterrupted`) |

**Terra interrupted exception:** under-length Terra responses with enough chars are saved as `interrupted` but go through the **full success finalize path** (widget + episodic + triggers) at `route.ts:3464-3476, 3547-3549`. Intentional "billable partial" behavior.

### Invariant already satisfied

```text
NO_FINAL_ASSISTANT → NO_NUMERIC_STATE_COMMIT
```
is **already true** for the current status widget path. The future numeric reducer must preserve this by only committing inside the same success-finalize gate.

## Recommended Phase B fix (NOT implemented)

1. **Manual edit:** when assistant prose is materially edited, delete `episodic_memory_facts` by `metadata.assistant_message_id` (invalidate, do not re-extract). Detect material change via normalized diff (not whitespace-only).
2. **Last-turn delete:** also delete `status_trigger_events` for `(chat_id, source_turn)` of the deleted assistant (or by `source_message_id`).
3. **Future numeric state:** join the same lifecycle — delete `rp_numeric_state_events` / recompute `rp_numeric_state_current` on turn delete, chat delete, and material prose edit.
