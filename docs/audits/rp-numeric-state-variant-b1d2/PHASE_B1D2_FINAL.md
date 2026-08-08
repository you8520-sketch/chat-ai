# PHASE_B1D2_FINAL

```text
PHASE_B1D2_FINAL:

baseline main: 268b8a70556f3392e7eb89283ba2e07689e2e332
branch: cursor/rp-numeric-state-variant-switch-b1d2-96c2
commit: 534114cf6a649f6bcbf7d9f61b51b396f7bb5614
draft PR: https://github.com/you8520-sketch/chat-ai/pull/279
note: commit = implementation tip (feat); docs tip may advance after this seal

CANONICAL_WORLDLINE_INVARIANT:
PASS

selected variant semantics:
LAST_GENERATED = NO
ACTIVE_SELECTED = YES

numeric strategy:
OLD_EVENT_POINTER_REWIND = NO
NEW_CANONICAL_SELECTION_EVENT = YES
REDUCER_RERUN = NO

frontier guard:
latest assistant: YES
no later user: YES
no generating assistant: YES (any later message blocks)
transaction-local recheck: YES
BEGIN IMMEDIATE: YES

source event resolution:
generationSequence: required (fail-closed if missing)
requestId: used to disambiguate when present
ambiguous source handling: 409 numeric_state_variant_source_not_ready

basic D→B:
  previous baseline: 30
  D current: 41
  B selected: 38
  numeric current: 38
  message: B prose
  status: 호감도=38, location=창고
  active variant: 1

revision:
  before switch: tip D revision (route canary: 5)
  after switch: tip+1 (route canary: 6)
  monotonic: PASS

reselection:
  B→A→C→B (route canary) / B→C→A→D→B (unit V3):
  parity failures: 0

multi-field:
  affection / trust / corruption projected atomically (unit V7)

episodic: B facts replace D (unit V1)
trigger: D superseded; B re-eval uses final mirrored status (unit V16/V17)
fire_once: superseded events do not block re-fire (unit V16/V17)
status: selected nonnumeric + mirrored numeric (unit V1/V14)

next-turn history:
  selected B visible: YES (messages.content)
  rejected variants absent from active history: YES
  result: SELECTED_VARIANT_NEXT_TURN_HISTORY_PARITY = PASS

long-term memory:
  summary contamination audit: covering batch inactivated
  reconcile/invalidation: mark inactive + rebuild lorebook + clear
    chat_memories.recent_summary + chats.current_summary + chats.memory
  result: SELECTED_VARIANT_LONG_TERM_MEMORY_PARITY = PASS

select→normal: before=B.after (unit V21)
select→regen: before=original baseline 30 (unit V22)
select→delete: current=30, all assistant events deleted (unit V23 + route canary)

frontier moved:
  later user exists: YES
  HTTP: 409
  code: variant_switch_frontier_moved
  mutation count: 0

historical numeric variant:
  HTTP: 409
  code: numeric_state_historical_variant_replay_unsupported

same-active idempotency: IDEMPOTENT_NOOP (unit V4)
concurrent duplicate: SQLite serialization + txn active_variant re-read
concurrent different-selection: last successful explicit selection wins / no half-state

forced numeric failure: full rollback (V26)
forced message failure: full rollback (V27)
forced episodic failure: full rollback (V28)
forced trigger failure: full rollback (V29)

postcommit trigger reevaluation failure:
  committed B remains; missing new > stale wrong (best-effort)

nonnumeric regression: mutation-core wrapper preserved (unit)

route canary:
  PATCH calls: 4 (B→A→C→B) + 1 frontier 409
  LLM calls: 0
  point mutations: 0
  parity failures: 0
  evidence: docs/audits/rp-numeric-state-variant-b1d2/ROUTE_VARIANT_CANARY.json

tests:
  rpNumericState* + rpDerivedState* + LTM reconcile: 187 pass / 0 fail
lint: PASS (typecheck:app)
typecheck: PASS (typecheck:app)
git diff --check: PASS

prompt diff: 0
background extractor diff: 0
model adapter diff: 0
billing diff: 0

final verdict:
B1_D2_SELECTED_VARIANT_CANONICAL_PASS

merge:
NOT_RUN

B1-D3:
NOT_RUN
```

## Evidence pointers

- Pre-implementation audit: `docs/audits/rp-numeric-state-variant-b1d2/00_PREIMPLEMENTATION_AUDIT.md`
- Route canary: `docs/audits/rp-numeric-state-variant-b1d2/ROUTE_VARIANT_CANARY.json`
- Core: `src/lib/rpNumericState/variantSelection.ts`, `variantSwitchAtomic.ts`
- Frontier helpers: `src/lib/rpDerivedStateLifecycle.ts`
- LTM: `src/lib/memory/memory-variant-switch-reconcile.ts`
- Route: `src/app/api/chat/message/variant/route.ts`
