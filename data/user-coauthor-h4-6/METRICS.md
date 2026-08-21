# H4.6 METRICS

Observation only. Length is **not** a pass/fail owner.
No prose / RP / character quality scores.

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

## Per-sample output

| file | owner | chars_ws | chars_nws | utf8 | SHA-256 | prompt | completion | reasoning | cost_usd | seconds |
|---|---|---:|---:|---:|---|---:|---:|---:|---:|---:|
| raw/transition-r1.txt | RESTORED | 3229 | 2442 | 7725 | `f730051db8e80e061dd256111fc03adb2b721bd9aeea61e3d5dae9c59f6e8462` | 8880 | 7889 | 5818 | 0.103962075 | 89.74 |
| raw/transition-r2.txt | RESTORED | 4202 | 3165 | 9968 | `642d90e746e68ed37926b6fe4bb50ddb633233aba72eda91845b6a69b221763a` | 8880 | 7853 | 5064 | 0.1013022 | 92.582 |
| raw/transition-r3.txt | RESTORED | 3777 | 2870 | 8947 | `00641a993c70d13e319693a1c62dda7865acfee917c196959c2bdc15216486e4` | 8872 | 4029 | 1515 | 0.0553982 | 39.882 |

Total Gemini cost: **$0.260662475**.

## Prompt-token comparison

| Turn class | prompt_tokens | source |
|---|---:|---|
| H4.4 normal STANDARD (no boundary) | 9149 | H4.2 CONTROL / H4.4 report; not rerun |
| H4.4 COAUTHOR persistent | 9094 | H4.4 CASE A; not rerun |
| H4.4 CASE B STANDARD + sentence | 9189 | H4.4 CASE B; not rerun |
| H4.6 POST_DELEGATION_RESTORED | 8880 / 8880 / 8872 | this PR, 3 samples |

Ordinary STANDARD delta attributable to this transition feature: **0**.
The STANDARD owner block is byte-for-byte identical to H4.4
(`buildCompactNoGodmoddingStandardBlock` SHA match). The STANDARD wrapper
without a boundary sentence is the same collaborative text (WRAP_MANUAL SHA
`1f3e645d965bcefb7cf47bd1ec2774e97408e990c6c4cd952572d509ac83369f`).

Persistent COAUTHOR owner / wrapper: **unchanged** vs H4.4
(`delegatedScopeLines` equal).

Transition owner: **one-turn only**. Not added to ordinary STANDARD.
Gemini 3.1 supplement is not injected on the RESTORED turn
(`godmoddingMode !== "standard"`).

`buildContext` estimated input tokens (inspect, not provider): 14106.

## Directive classification (CASE B)

| Field | Value |
|---|---|
| duration | none |
| dialogue | unchanged |
| majorActions | unchanged |
| currentMode | OFF |
| persistent | OFF → OFF |
| postDelegationBoundary | true |
| owner count | 1 |
