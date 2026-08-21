# H4.4 METRICS

Observation only. Length is **not** a pass/fail owner.

## Provider

| Field | Value |
|---|---|
| model | `google/gemini-3.1-pro-preview` |
| temperature | 0.95 |
| reasoning | `{effort:low}` |
| Gemini calls | 6 |
| DeepSeek calls | 0 |
| retries | 0 |
| refusals | 0 |

## Per-sample output

| file | case | effective | persistent before→after | chars_ws | chars_nws | utf8 | SHA-256 | prompt | completion | reasoning | cost_usd | seconds |
|---|---|---|---|---:|---:|---:|---|---:|---:|---:|---:|---:|
| raw/persistent-next-r1.txt | A | FULL | FULL→FULL | 6105 | 4646 | 14409 | `082e9f5196b588cfb42309b61db22af886d6d1e632b39d469144d4e6f9829fd2` | 9094 | 10314 | 6219 | 0.1331609 | 115.9 |
| raw/persistent-next-r2.txt | A | FULL | FULL→FULL | 6636 | 5035 | 15722 | `16bcf7edc6c46b519060f364d1d1002146c626a6dbce0a9b123fc2626c3d7381` | 9094 | 10431 | 6076 | 0.1322504 | 114.6 |
| raw/turn-only-reset-r1.txt | B | OFF | OFF→OFF | 5698 | 4348 | 13440 | `3c8cc557053bbb12dec4ab64fcd785699a2237793996dbf8d52e12e1435014fe` | 9189 | 9892 | 6035 | 0.1282812 | 114.4 |
| raw/turn-only-reset-r2.txt | B | OFF | OFF→OFF | 4653 | 3546 | 11177 | `efc8ecbd6a65f19f7f57924105c560e1082d846103d1a2088b0a653faffc62c5` | 9189 | 11049 | 7937 | 0.1398492 | 116.7 |
| raw/revoke-r1.txt | C | OFF | FULL→OFF | 3386 | 2548 | 8174 | `69c47254e69a6298488edfaef26cc17dee4aa015556b3a756e5f74535a63b024` | 9207 | 5955 | 3787 | 0.0787572 | 77.8 |
| raw/revoke-r2.txt | C | OFF | FULL→OFF | 3264 | 2438 | 7950 | `ba6a1168f13be56d54e97bd10d51dc6f1bde353d2bee89f632bf25b42de767e7` | 9207 | 7640 | 5529 | 0.1012932 | 104.9 |

Total Gemini cost: **$0.7135921**.

## Prompt-token delta

Provider-measured this PR:

| Turn class | prompt_tokens | notes |
|---|---:|---|
| COAUTHOR persistent (CASE A) | 9094 | persistent wrapper, no boundary, no Gemini 3.1 supplement |
| STANDARD + post-delegation (CASE B) | 9189 | original H4 Turn C, boundary ON |
| STANDARD + revoke transition (CASE C) | 9207 | revoke OOC + check-in, boundary ON |

Not independently provider-called this PR:

| Turn class | prompt_tokens | source |
|---|---:|---|
| STANDARD ordinary (no boundary) | 9149 | H4.2 CONTROL, same Turn C wrap without boundary |

Deltas vs H4.2 CONTROL 9149:

- COAUTHOR persistent: **−55**
- POST-DELEGATION (CASE B): **+40**
- REVOKE transition (CASE C): **+58**

`buildContext` estimated input tokens (inspect, not provider): A 13983 / B 14425 / C 14448.

## Directive classification

| CASE | duration | dialogue | majorActions |
|---|---|---|---|
| A next ordinary | none | unchanged | unchanged |
| B next ordinary | none | unchanged | unchanged |
| C revoke | persistent | deny | deny |

## Agency scores

| CASE | reps | effective | consequential independent [B] failures | result |
|---|---:|---|---:|---|
| A persistent next | 2 | FULL | n/a (authorship desired) | PASS |
| B turn-only reset | 2 | OFF | 2 | FAIL |
| C revoke | 2 | OFF | 0 | PASS |
