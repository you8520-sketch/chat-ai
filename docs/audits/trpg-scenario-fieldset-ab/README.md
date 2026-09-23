# TRPG scenario field-set A/B RAW audit

This directory preserves a **READ ONLY** field-set A/B measurement so an external reviewer can read provider RAW on GitHub.

It is **not** a production change.

## Experiment purpose

Compare one-pass generation quality and failure patterns for three requested field sets, using the same production system prompt and empty world / empty draft:

- FIRST5
- CORE13
- FULL21

The goal of this PR is only to archive the already-captured provider assistant content and per-run metadata. ChatGPT (or any other reviewer) can read the RAW files here and independently inspect generation quality, truncation, type errors, and loop/contamination patterns.

## Production status

- **No production code is changed by this PR.**
- **No prompt is changed.**
- **No schema / parser / merge / FIELD SEMANTICS / model setting is changed.**
- **No new provider call was made for this PR.** Existing `/opt/cursor/artifacts/fieldset-ab/` files were copied as-is.
- Existing RAW is not regenerated or summarized. Loop / truncation bodies in CORE13 / FULL21 are kept verbatim.

## Shared call conditions

All six runs used:

- the same production scenario-draft **system prompt**
- **empty world**
- **empty draft**
- model `deepseek-v4-flash-0731`
- temperature `0.3`
- `response_format=json_object`
- thinking / reasoning disabled (same as the forensic replica of production)

The only intended difference between sets is the requested field list (`fill_or_replace_fields`) and the production max-token budget for that mode.

## Field-set differences

| Set | Requested keys | Mode used in this measurement | maxTokens | What it corresponds to |
| --- | --- | --- | --- | --- |
| FIRST5 | `title`, `startingSituation`, `centralConflict`, `goal`, `endingConditions` | `fill_empty` | 1800 | First-create required story fields (5) |
| CORE13 | FIRST5 plus `summary`, `secret`, `majorEvents`, `clues`, `startLocation`, `startInventory`, `difficulty`, `climax` | `fill_empty` | 1800 | Production `fill_empty` CORE field set (13) |
| FULL21 | All 21 `TRPG_SCENARIO_DRAFT_FIELDS` | `regenerate_all` | 2600 | Production regenerate-all field set (21) |

Success in this measurement means:

- `finishReason=stop`
- `title` / `startingSituation` / `centralConflict` / `goal` nonempty
- `endingConditions` is `array<string>` with length ≥ 1
- no missing requested keys
- no wrong-type requested fields
- no pathological repetition loop

## n=2 results

| Run | finishReason | outputTokens | latencyMs | success | Observed notes (not conclusions) |
| --- | --- | --- | --- | --- | --- |
| FIRST5 n1 | stop | 181 | 8811 | yes | `endingConditions` length 2, schema errors 0 |
| FIRST5 n2 | stop | 360 | 39342 | yes | `endingConditions` length 2, schema errors 0 |
| CORE13 n1 | length | 1800 | 136017 | no | missing `difficulty`/`climax`; `startInventory` loop (`구명망치` ×59) then truncated (`null]}`) |
| CORE13 n2 | stop | 681 | 76933 | no | `endingConditions` RAW is a **string**, not `array<string>` |
| FULL21 n1 | length | 2600 | 46968 | no | `endingConditions` loop (`majorEvents` ×356); 14 requested keys missing |
| FULL21 n2 | stop | 1559 | 73121 | yes | all 21 keys present, schema errors 0 |

RAW files:

- `FIRST5_n1_RAW.txt`
- `FIRST5_n2_RAW.txt`
- `CORE13_n1_RAW.txt`
- `CORE13_n2_RAW.txt`
- `FULL21_n1_RAW.txt`
- `FULL21_n2_RAW.txt`

Each RAW file is the parser-before provider assistant content, copied without cleanup. Do not treat CORE13/FULL21 loop or truncation text as something to rewrite; it is the evaluation target.

Per-run metadata:

- `FIRST5_n1_META.json`
- `FIRST5_n2_META.json`
- `CORE13_n1_META.json`
- `CORE13_n2_META.json`
- `FULL21_n1_META.json`
- `FULL21_n2_META.json`

META files contain measurement fields only. They do not include API keys, Authorization headers, cookies, session tokens, user identifiers, or environment secrets.

## Aggregate (copied from the existing measurement)

```text
FIRST5_SUCCESS=2/2
CORE13_SUCCESS=0/2
FULL21_SUCCESS=1/2
FIRST5_AVG_OUTPUT_TOKENS=270.5
CORE13_AVG_OUTPUT_TOKENS=1240.5
FULL21_AVG_OUTPUT_TOKENS=2079.5
FIRST5_SCHEMA_ERRORS=0
CORE13_SCHEMA_ERRORS=5
FULL21_SCHEMA_ERRORS=370
RECOMMENDED_ONE_PASS_FIELD_SET=FIRST5
```

## Observations, not conclusions

The numbers and `RECOMMENDED_ONE_PASS_FIELD_SET=FIRST5` line above are **observations from this n=2 sample**. They are **not** a locked product decision.

What this archive makes independently reviewable:

- FIRST5 completed both runs with `stop` and no schema errors in this sample.
- CORE13 failed both runs: one `length` + inventory loop, one wrong type for `endingConditions`.
- FULL21 failed one run with a `majorEvents` contamination loop and truncation, and passed one run.
- Larger requested sets used more output tokens on average in this sample.
- These patterns are recorded as-is so an external reviewer can judge quality and failure modes from RAW, not from a rewritten summary.
