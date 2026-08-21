# H4.4 — Persistent OOC user co-authoring

**Status:** FAIL (provider CASE B leak) — MERGE_READY=NO  
**Date:** 2026-08-21  
**Branch:** `cursor/h4-4-persistent-user-coauthor-e1d6`  
**PR:** [#539](https://github.com/you8520-sketch/chat-ai/pull/539)  
**Base main:** `5276619655d481ca9f0542d37c1b82982db31aa9`

This pack is controlled Gemini evidence for the H4.4 authoring-state model.
It is **not** a homepage/production character quality audit.
Length / prose / dialogue-ratio are observations only.

## Policy (product)

Three concepts:

| Concept | When | Next ordinary turn |
|---|---|---|
| STANDARD | default | STANDARD |
| TURN-ONLY co-author | leading OOC grant **with** a turn limiter | previous persistent state |
| PERSISTENT co-author | leading OOC grant **without** a limiter | remains ON until revoke |

Bare positive leading-OOC grants default to **PERSISTENT**.
Turn-only markers: `이번 턴만`, `이 턴만`, `이번 응답만`, `지금 턴만`, `이번 턴은`, `이 턴은`, `지금 턴은`, `이번 응답은`.

Server owns `chats.user_coauthor_mode` (`OFF | DIALOGUE | ACTIONS | FULL`).
The model receives the effective authoring contract only.

## Frozen priors (do not merge / rewrite)

| Work | PR | Note |
|---|---|---|
| H4.1 | #529 | transcript freeze |
| H4.2 | #531 | CONTROL vs STRICT A/B |
| H4.3 | **#534 FAILED / FROZEN** | do not cherry-pick history-precedent sentence |

Original H4 Turn B contains `이번 턴만` → still **TURN_ONLY** under this policy.

## Provider budget

```text
Gemini = 6 / 6 (CASE A×2, CASE B×2, CASE C×2)
DeepSeek = 0
retries = 0
absolute lock = OFF
```

## Files

```text
README.md
REPORT.md
METRICS.md
metrics.json
harness-inspect.json          # deterministic inspect of the three CASE prompts
raw/persistent-next-r1.txt
raw/persistent-next-r2.txt
raw/turn-only-reset-r1.txt
raw/turn-only-reset-r2.txt
raw/revoke-r1.txt
raw/revoke-r2.txt
```

## Result

```text
STATIC P1–P10 / T1–T10: PASS
CASE A persistent next: PASS (2/2) — [B] authorship desired
CASE B turn-only reset: FAIL (2/2) — consequential independent [B] continuation
CASE C explicit revoke: PASS (2/2)
H4_4_RESULT: FAIL
MERGE_READY: NO
```
