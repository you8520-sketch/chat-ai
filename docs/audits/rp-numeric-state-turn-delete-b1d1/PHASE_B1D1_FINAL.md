# PHASE_B1D1_FINAL

```text
PHASE_B1D1_FINAL:

baseline main:
b586a5bf7f506a8da3f6d3b9252ac0f1b82217c1

branch:
cursor/rp-numeric-state-turn-delete-b1d1-6a91

commit:
5db2a3060100920979a0b0e975666fb039d7d8db
6b89f736198cf1952061ebf662ff05f371f9a91e
(implementation tip: 82cc102287ad25065b422d7153eb645bda26d6e1)

draft PR:
https://github.com/you8520-sketch/chat-ai/pull/276

CANONICAL_ROLLOUT:

user allowlist:
REMOVED

character allowlist:
REMOVED FROM CANONICAL ELIGIBILITY

ALLOW_ALL_USERS flag:
NOT NEEDED

ENABLED=1:
ALL AUTHENTICATED USERS

KILL_SWITCH:
PASS

explicit numericState gate:
PASS

pilot state-key gate:
PASS (affection / trust / corruption)

Railway target:
RP_NUMERIC_STATE_ENABLED=1
RP_NUMERIC_STATE_KILL_SWITCH=0

SHADOW allowlists:
UNCHANGED (still fail-closed with USER_IDS)

rollout:
  ALLOW_ALL_USERS flag: NOT_NEEDED / NOT_ADDED
  default: ENABLED=0, KILL_SWITCH=0
  kill-switch override: PASS (beats ENABLED)
  allowlist backward compatibility: canonical ignore; env keys removed from .env.example

normal delete:
  before: T3 tip 44
  after: current 40
  current: predecessor T2 tip
  predecessor: revision continuity via revision_before/after

regen delete:
  variants/events deleted: A/B/C all removed
  before: tip 45
  restored: 40 (pre-turn baseline / tip.before_value)
  revision: predecessor.revision_after

first numeric legacy bootstrap:
  INITIALIZED preserved; mutation deleted; current=35; last_source_message_id=NULL

definition initial:
  INITIALIZED preserved; current=initial

INVALID_HOLD:
  event deleted; current stays before

NO_CHANGE:
  event deleted; current stays

multi-field:
  affection/trust/corruption all restored atomically

episodic:
  PASS (delete by assistant metadata)

trigger:
  PASS (source_message_id cleanup)

memory:
  PASS (reconcile after successful txn; unchanged policy)

messages:
  PASS (last user+assistant)

target-change/idempotency protection:
  PASS — optional expectedAssistantMessageId → 409 turn_delete_target_changed
  client MessageBubbleToolbar sends assistant messageId

forced numeric failure rollback:
  PASS (__testThrowAfterNumericRestore)

forced message failure rollback:
  PASS (__testThrowAfterMessageDelete)

forced trigger cleanup failure rollback (D12):
  PASS — SQLite BEFORE DELETE RAISE(ABORT) → full txn rollback
  numeric/messages/episodic/triggers/engagement all unchanged

trigger cleanup exception propagation:
  PASS — no try/catch swallow inside executeLastTurnDeleteTransaction

nonnumeric regression:
  PASS (revertNumeric=false)

whole-chat regression:
  PASS (existing deleteNumericStateForChat test retained)

tests:
  rpNumericState* + turn delete + derived/episodic: 248/248 PASS
  D12 included
  lint / typecheck:app: PASS
  git diff --check: PASS

prompt diff:
0

background extractor diff:
0

model adapter diff:
0

billing diff:
0

delete API LLM calls:
0

route DELETE canary:
  PASS (scripts/rp-numeric-turn-delete-route-canary.ts)
  HTTP 200; numeric current == predecessor; target events/episodic/triggers == 0
  remaining latest status == numeric current
  expectedAssistantMessageId mismatch → 409 turn_delete_target_changed PASS
  evidence: ROUTE_DELETE_CANARY.json

private-beta Railway/UI canary:
  result: NOT_RUN (local route canary PASS; Railway deploy still human)

final:
B1_D1_MERGE_READY

merge:
NOT_RUN
```

## B1_D1_FINAL_HARDENING

```text
B1_D1_FINAL_HARDENING:
trigger cleanup exception propagation:
PASS
forced trigger cleanup failure:
FULL_ROLLBACK_PASS
numeric unchanged on failed delete:
PASS
messages unchanged on failed delete:
PASS
episodic unchanged on failed delete:
PASS
trigger unchanged on failed delete:
PASS
engagement unchanged on failed delete:
PASS
route DELETE canary:
PASS
route delete LLM calls:
0
expectedAssistantMessageId mismatch:
409 PASS
all-user canonical gate:
PASS
SHADOW allowlists:
UNCHANGED
Railway target:
RP_NUMERIC_STATE_ENABLED=1
RP_NUMERIC_STATE_KILL_SWITCH=0
final verdict:
B1_D1_MERGE_READY
```
