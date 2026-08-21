# H4.6 — One-turn post-delegation restored owner

**Status:** FAIL (provider CASE B leak) — MERGE_READY=NO  
**Date:** 2026-08-21  
**Branch:** `cursor/h4-6-post-delegation-owner-e1d6`  
**PR:** [#542](https://github.com/you8520-sketch/chat-ai/pull/542)  
**Base:** frozen H4.4 HEAD `d311ab44ec5d051662ee77182f64857df68a7b28`  
**Not based on:** H4.5 PR #541 (frozen FAIL; do not merge or edit)

This pack is controlled Gemini evidence for a **one-turn specialized owner**
used only on the first ordinary OFF turn after an explicit TURN-ONLY grant
expires. It replaces STANDARD for that turn. It does **not** add a transition
sentence onto STANDARD.

This is **not** a homepage/production character quality audit.
Do **not** assign prose / RP / character quality scores. Human review uses
complete RAW outputs.

## Architecture

| Turn | Example input | Owner |
|---|---|---|
| B | `OOC: 이번 턴만 …` | COAUTHOR |
| C | ordinary IC | POST_DELEGATION_RESTORED |
| D | ordinary IC | STANDARD |

Exactly one primary owner per turn. No stacking.

## Frozen priors (do not merge / rewrite)

| Work | PR | Note |
|---|---|---|
| H4.1 | #529 | transcript freeze |
| H4.2 | #531 | STRICT 0/3 consequential [B]; CONTROL leaked |
| H4.3 | #534 FAILED / FROZEN | do not cherry-pick history-precedent sentence |
| H4.4 | #539 | state machine accepted; CASE B FAIL 2/2 |
| H4.5 | #541 FAILED / FROZEN | extra reset sentence still leaked 2/3 |

## Provider budget

```text
Gemini = 3 / 3 (CASE B transition only)
DeepSeek = 0
retries = 0
H4.2 CONTROL = not rerun
CASE A persistent = not rerun
CASE C revoke = not rerun
absolute lock = OFF
```

## Files

```text
README.md
REPORT.md
METRICS.md
metrics.json
harness-inspect.json
raw/transition-r1.txt
raw/transition-r2.txt
raw/transition-r3.txt
```

Complete RAW text is in `raw/`. No truncation.

## Stop condition

H4.6 still produced clear independent consequential [B] authorship on 2 of 3
samples. **Stop user-agency prompt tuning. Do not create H4.7 with a larger
prompt.** Return this pack for product decision.
