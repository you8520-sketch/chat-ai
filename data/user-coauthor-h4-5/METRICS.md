# H4.5 METRICS

Observation only. Length is not a pass/fail owner.

## Injected transition sentence

```text
The previous user-authoring permission was explicitly limited to the prior
turn and has ended. [B] is user-controlled again: do not write new [B] dialogue
or consequential [B] actions/choices on this turn unless the current user input
explicitly authors them.
```

Transition reason on CASE B5: `turn_only_expiry`  
Effective mode: OFF / persistent OFF  
Injection count: 1  
Persists after that one turn: false

## Provider

| Field | Value |
|---|---|
| model | `google/gemini-3.1-pro-preview` |
| temperature | 0.95 |
| reasoning | `{effort:low}` |
| Gemini calls | 3 |
| DeepSeek calls | 0 |
| retries | 0 |
| refusals | 0 |

## Per-sample

| file | effective | reason | chars_ws | chars_nws | utf8 | SHA-256 | prompt | completion | reasoning | cost_usd | seconds | new_B_dialogue | new_B_action | new_B_pace | result |
|---|---|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| raw/turn-only-reset-r1.txt | OFF | turn_only_expiry | 4727 | 3561 | 11273 | `778f73540eac5ab6fcf481e3010e70e2404e89183a299b27a1a57c7e115a9096` | 9205 | 7744 | 4589 | 0.1025372 | 98.0 | 0 | 1 | 1 | FAIL |
| raw/turn-only-reset-r2.txt | OFF | turn_only_expiry | 3618 | 2733 | 8562 | `9d560d89f0a17e3d5c0848ad9ad22c3eb86f68f45fad205f88e158030b5cb766` | 9205 | 7939 | 5519 | 0.1025612 | 98.1 | 0 | 1 | 1 | FAIL |
| raw/turn-only-reset-r3.txt | OFF | turn_only_expiry | 3643 | 2764 | 8753 | `a75ef39b54ac60a62cda5bc4035164e9a1e8640f7df27327351f6c37e88a260e` | 9205 | 6802 | 4467 | 0.0889172 | 88.2 | 0 | 0 | 0 | PASS |

Total Gemini cost: **$0.2940156**.

## Prompt-token delta vs H4.4 CASE B

| | prompt_tokens |
|---|---:|
| H4.4 CASE B (old sentence) | 9189 |
| H4.5 CASE B5 (new sentence) | 9205 |
| delta | **+16** |

`buildContext` estimated input tokens: 14482 (H4.4 CASE B was 14425).
