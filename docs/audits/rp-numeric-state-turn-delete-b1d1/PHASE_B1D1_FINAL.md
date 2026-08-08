# PHASE_B1D1_FINAL

```text
PHASE_B1D1_FINAL:

baseline main:
b586a5bf7f506a8da3f6d3b9252ac0f1b82217c1

branch:
cursor/rp-numeric-state-turn-delete-b1d1-6a91

commit:
(see tip after push)

draft PR:
(see GitHub)

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

nonnumeric regression:
  PASS (revertNumeric=false)

whole-chat regression:
  PASS (existing deleteNumericStateForChat test retained)

tests:
  rpNumericState* + turn delete: 108/108 PASS
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

delete API calls:
0

private-beta live canary:
  result: NOT_RUN (core harness PASS; Railway/UI delete canary deferred to human private-beta)

final:
B1_D1_LAST_TURN_DELETE_PASS

merge:
NOT_RUN
```
