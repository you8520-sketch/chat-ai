# 04 — Status ↔ Episodic Conflict Audit

Audit of the `status extraction → extracted_facts → episodic_memory_facts` path and the regeneration empty-fact replacement bug.

## Path trace

```text
status extraction (split_raw + V3)
  → extracted_facts in ParsedStatusWidgetTurnValues
  → route.ts:4562 extractedFactsForPersistence = payload?.extracted_facts ?? []
  → route.ts:4563 summarizeEpisodicFactPersistCandidates (telemetry only)
  → route.ts:4595 if (extractedFactsForPersistence.length > 0)   ← GATE
  → persistEpisodicMemoryFactsBestEffort
     → idempotency check (assistant_message_id, request_id) → no-op if exists
     → shouldReplaceSourceTurn? → DELETE by (chat_id, source_turn)
     → sanitize + filterUnsafe + dedupe → INSERT
```

## Function responsibilities

| Function | File:lines | Responsibility |
|---|---|---|
| `sanitizeExtractedFacts` | `statusWidget/extractedFacts.ts:67-106` | Schema validation, within-call dedupe (key incl. fact_text), cap 3. No contamination/psych filtering here. |
| `mergeExtractedFacts` | `statusWidget/extractedFacts.ts:108-123` | Cross-source dedupe within one response, latest-wins, cap 3. Key incl. fact_text. |
| `summarizeEpisodicFactPersistCandidates` | `episodicMemoryFacts.ts:325-350` | Dev/audit summary only — no DB write. Runs sanitize + contamination + psych + within-response dedupe. |
| `persistEpisodicMemoryFactsBestEffort` | `episodicMemoryFacts.ts:436-537` | DB write. Idempotency, regen replace, INSERT. |
| `getEpisodicMemoryForPrompt` | `episodicMemoryFacts.ts:747-993` | Recall: load, filter, rank, budget, format. SELECT only. |
| `filterContaminatedFactsForSave` | `episodicMemoryFacts.ts:298-300` | Rejects D-DAY, trigger, speech-style, runtime strings. |
| `filterAbstractPsychologicalInferenceFactsForSave` | `episodicMemoryFacts.ts:302-309` | Rejects personality_change, relationship_stage, etc. (preference/rule exempt). |
| `dedupeFactsWithinResponse` | `episodicMemoryFacts.ts:398-408` | Persist-time dedupe, key = `category:subject:attribute:value` (NO fact_text), cap 3. |
| `resolveLatestFactsByLogicalKey` | `episodicMemoryFacts.ts:702-712` | Recall-time latest-wins by `category:subject:attribute`. |
| `isClearlyTemporaryEpisodicFact` | `episodicMemoryTemporal.ts:128-130` | Recall filter for current_emotion/current_action etc. Rows stay in DB. |

## Recall filters (preserved — must not break)

| Filter | Where | Behavior |
|---|---|---|
| Schema re-validation | `getEpisodicMemoryForPrompt:818-825` | `sanitizeExtractedFacts` per row |
| Contamination | `:831-848` | `detectEpisodicMemoryContamination` |
| Temporary-state recall | `:850-855` | `isClearlyTemporaryEpisodicFact` (completed historical events exempt) |
| Psychological inference | `:856-874` | `detectAbstractPsychologicalInference` |
| Latest-wins by logical key | `:877` | `resolveLatestFactsByLogicalKey` |
| Duplicate suppression | `:899-922` | vs recentChatText, LTM, relationshipMemory, lorebook, triggeredEvents + `duplicate_subject_attribute` |
| Ranking | `:924-928` | importance → keyword boost → source_turn → id |
| Dynamic memory budget | `:930-933` | `min(maxChars, dynamicTotal - LTM/relationship/lorebook chars)` |
| Min-age | `:802-805` | `source_turn <= currentTurn - minAgeTurns` (default 3) |
| `source_turn < currentTurn` | `:799-801` | Never recall current turn's facts |

## CRITICAL — Case A: regen with facts → facts

```text
T10 variant A: extracted_facts = [fact1]
regen T10 variant B: extracted_facts = [fact2]
```

- Route: `extractedFactsForPersistence.length > 0` → persist called.
- Library: `shouldReplaceSourceTurn` true (regenerateMessageId set) → DELETE `WHERE chat_id=? AND source_turn=10` → INSERT fact2.
- **Final DB: fact1 removed, fact2 present. CORRECT.**

## CRITICAL — Case B: regen with facts → empty facts (BUG)

```text
T10 variant A: extracted_facts = [fact1]
regen T10 variant B: extracted_facts = []
```

- Route `route.ts:4595`: `if (extractedFactsForPersistence.length > 0)` → **false** → `persistEpisodicMemoryFactsBestEffort` **never called**.
- Library DELETE (lines 470-480) never runs.
- **Final DB: fact1 REMAINS. BUG.**

### Verdict

```text
REGEN_EMPTY_FACT_STALE_MEMORY_BUG = CONFIRMED
```

**Evidence:** `src/app/api/chat/route.ts:4595` gates the entire persist call on raw array length. The library's `replaceSourceTurn` DELETE is correct but unreachable when the new variant produces no facts.

### Idempotency edge case

If the same `(assistant_message_id, request_id)` already has rows, `persist` returns 0 at lines 457-468 **before** the DELETE. A regen replay with an identical client `request_id` would skip replacement entirely (no DELETE, no INSERT). In practice regen uses a new `request_id`, so this is low-risk but worth noting.

## Manual edit — Case C (doc 06 covers in detail)

Manual assistant prose edit (`PATCH /api/chat/message:176-190`) **preserves** `existing.extracted_facts` in the JSON and never touches `episodic_memory_facts` DB rows. Editing prose from "동행하기로 했다" to "동행을 거절했다" leaves the old fact "둘은 동행하기로 합의했다" in the DB.

```text
MANUAL_EDIT_STALE_EPISODIC_FACT_RISK = CONFIRMED
```

## Recommended Phase B fix (NOT implemented in Phase A)

1. **Route layer:** call `persistEpisodicMemoryFactsBestEffort` on regen **regardless** of `extractedFactsForPersistence.length`, passing `replaceSourceTurn: true` and `facts: []`. The library already handles empty facts (DELETE then return 0). This makes the DELETE unconditional on regen.
2. **Idempotency:** key the no-op on `(assistant_message_id, request_id)` but still allow regen replace when `regenerated: true` (new request_id).
3. **Manual edit:** invalidate/delete episodic facts by `metadata.assistant_message_id` when prose is materially edited (see doc 06).
