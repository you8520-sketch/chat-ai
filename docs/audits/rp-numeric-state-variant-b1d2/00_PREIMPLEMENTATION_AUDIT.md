# B1-D2 Pre-implementation Audit (API=0)

**Baseline main:** `268b8a70556f3392e7eb89283ba2e07689e2e332`  
**Branch:** `cursor/rp-numeric-state-variant-switch-b1d2-96c2`  
**Date:** 2026-08-08  
**Method:** read-only code inspection (no live LLM / no route mutations)

## Invariant (target)

```text
LAST GENERATED != CANONICAL
ACTIVE SELECTED VARIANT == CANONICAL WORLDLINE
```

## Q1 — messages.content overwrite on variant select?

**YES**

- `variantToRowFields` → selected `variants[i].content`
- Latest: `executeAtomicVariantSwitchCore` UPDATEs `messages.content` + `active_variant`
- Historical: route transaction also UPDATEs `content`
- Files: `src/lib/messageAlternates.ts`, `src/lib/rpDerivedStateLifecycle.ts`, `src/app/api/chat/message/variant/route.ts`

Caveat (pre-B1-D2): numeric-eligible chats 409 before any UPDATE (`numeric_state_variant_replay_unsupported`).

## Q2 — next history source?

**messages.content** (not alternates / active_variant)

- Chat route: `SELECT id, role, content, model ...` → `shortTermHistory` → `buildContext`
- LTM loader: `memory-turn-loader.ts` same pattern
- After successful switch, content is denormalized to selected variant

## Q3 — statusWidgetValues / requestId / generationSequence preserved?

**YES** on successful finalize into `alternates` JSON (`MessageVariant` optional fields).  
Route reads them for status snapshot + post-commit trigger re-eval.  
Legacy/synthetic variants may omit them → B1-D2 must fail-closed when provenance incomplete.

## Q4 — unique numeric generation event lookup A/B/C/D?

**PARTIAL**

- Events store `assistant_message_id`, `generation_sequence`, `request_id`, `state_key`
- Idempotency via `mutationId = gen:${assistantMessageId}:${generationSequence}:${requestId|none}` + `source_kind=extractor`
- No first-class public finder API yet; B1-D2 adds explicit resolve + ambiguity fail-closed

## Q5 — LTM can include source turn before switch?

**YES**

- Rolling summary seals from `messages.content` at batch time
- Variant switch does **not** currently reconcile rolling summary / lorebook
- Only regen calls `refreshRollingSummaryForRegeneratedAssistant` (LLM)

## Q6 — rejected D can remain as stale LTM after selecting B?

**YES for rolling summary / lorebook; NO for episodic (latest switch replaces facts)**

| Channel | After latest switch today |
|---------|---------------------------|
| Episodic | Replaced with selected facts |
| Triggers | Superseded + best-effort re-eval |
| Rolling LTM | **Stale D possible** |

→ B1-D2 must add deterministic LTM invalidation (no new LLM on select route).

## Q7 — later user INSERT blocks previous assistant switch?

**NO (pre-B1-D2)**

- Frontier = latest canonical assistant only (`isLatestCanonicalAssistantMessage`)
- Trailing user message does **not** demote previous assistant
- Numeric chats blanket-block all variant switches today

→ B1-D2 introduces canonical frontier: no later message of any kind + txn-local recheck.

## Supporting inventory

| Area | Location |
|------|----------|
| Variant route | `src/app/api/chat/message/variant/route.ts` |
| Atomic switch | `executeAtomicVariantSwitchCore` (deferred tx, not IMMEDIATE) |
| Numeric events | `rp_numeric_state_events` — source_kind: definition_initial / legacy_bootstrap / extractor / manual_override |
| Numeric 409 | `numeric_state_variant_replay_unsupported` (blanket) |
| Turn delete | `executeLastTurnDeleteTransaction` + `revertNumericStateForDeletedAssistantCore` |
| Memory inactive | `markMemoryRecordInactive` + `rebuildLorebookFromRecords` (skips inactive) |

## Design decisions locked for implementation

```text
OLD_EVENT_POINTER_REWIND = NO
NEW_CANONICAL_SELECTION_EVENT = YES
REDUCER_RERUN_ON_SELECTION = NO
BEGIN IMMEDIATE on numeric variant switch = YES
FRONTIER = latest assistant AND no later message rows
LTM = deterministic inactive + lorebook rebuild (LLM=0 on select)
```
