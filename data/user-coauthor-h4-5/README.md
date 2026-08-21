# H4.5 — Turn-only expiry reset signal

**Status:** FAIL (CASE B5 2/3 still leak) — MERGE_READY=NO  
**Date:** 2026-08-21  
**Base H4.4 HEAD:** `d311ab44ec5d051662ee77182f64857df68a7b28`  
**Branch:** `cursor/h4-5-turn-only-expiry-reset-e1d6`  
**PR:** [#541](https://github.com/you8520-sketch/chat-ai/pull/541)

H4.4 PR #539 is frozen FAIL evidence and was not modified.

## Hypothesis

Gemini follows an explicit current authorization-state reset better than the
abstract H4.4 history / natural-completion sentence.

## One change

REPLACE, do not append:

```text
The previous user-authoring permission was explicitly limited to the prior
turn and has ended. [B] is user-controlled again: do not write new [B] dialogue
or consequential [B] actions/choices on this turn unless the current user input
explicitly authors them.
```

Injected only on: turn-only coauthor → permission expires → next effective OFF.
Not on ordinary STANDARD. Not on persistent COAUTHOR. Not on explicit revoke.

## Provider budget

```text
Gemini CASE B5 = 3
CASE A / CASE C / H4.2 CONTROL = not rerun
DeepSeek = 0
retries = 0
```

## Result

```text
STATIC S1–S8: PASS
NEW_B_DIALOGUE_FAILURES: 0/3
NEW_B_CONSEQUENTIAL_ACTION_FAILURES: 2/3
NEW_B_CONSENT_PACE_FAILURES: 2/3
H4_5_RESULT: FAIL
MERGE_READY: NO
```

No second sentence was added after the fail.
