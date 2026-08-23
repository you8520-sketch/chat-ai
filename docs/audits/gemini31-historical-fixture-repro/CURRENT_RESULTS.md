# Current-main results

```text
FIXTURE_PARITY_PROVEN=true
TOTAL_PROVIDER_CALLS=4
RETRIES=0
CONTINUATIONS=0
RECOVERY_CALLS=0
REGEN=0
MODEL=gemini-3.1-pro-preview
PROVIDER=cheaperinference
TEMPERATURE=0.95
REASONING_EFFORT=low
CURSOR_QUALITY_SCORE_ASSIGNED=false
CURSOR_MODEL_VERDICT_ASSIGNED=false
PRODUCTION_PROMPT_CHANGED=false
```

## Four-call objective table

| call | VISIBLE_CHARS_INCL | VISIBLE_CHARS_EXCL | PARA | NARR | DIAL | DIAL_RATIO | MAX_CONSEC_DIAL | INPUT_TOK | OUT_TOK | THINK_TOK | LAT_MS | TTFT_MS | FINISH | REQUEST_SHA (prefix) | RAW_SHA (prefix) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REL-T1 | 3393 | 2540 | 24 | 14 | 10 | 0.417 | 1 | 9138 | 3942 | 1808 | 42693 | 21376 | stop | 837874f4… | f8f15c6e… |
| REL-T2 | 3952 | 2947 | 33 | 23 | 10 | 0.303 | 1 | 11285 | 6343 | 3821 | 60630 | 41514 | stop | ed71f77d… | eadf315c… |
| ACT-T1 | 2648 | 1984 | 31 | 26 | 5 | 0.161 | 1 | 9152 | 5192 | 3454 | 43793 | 34087 | stop | 3dd93a07… | 99bc5628… |
| ACT-T2 | 4005 | 3004 | 36 | 26 | 10 | 0.278 | 1 | 10936 | 8479 | 5877 | 74942 | 60453 | stop | 42d8bbc9… | 35fa95c2… |

Full SHA-256 values: `meta/{call}.json`. Full RAW: `raw/{call}.txt`.

```text
CURRENT_AVG_CHARS=3500
CURRENT_MEDIAN_CHARS=3673
CACHE_READ=0 (all calls)
CACHE_WRITE=0 (all calls)
RESOLVED_MODEL=gemini-3.1-pro-preview (all calls)
```

## Historical vs current visible chars

| call | HISTORICAL | CURRENT | delta |
| --- | --- | --- | --- |
| REL-T1 | 4659 | 3393 | −1266 |
| REL-T2 | 4254 | 3952 | −302 |
| ACT-T1 | 4743 | 2648 | −2095 |
| ACT-T2 | 4327 | 4005 | −322 |

Historical reference: Audit #255 `COST_RESULTS.json` (mean ≈ 4496 visible chars).

## Input token comparison

| call | HISTORICAL_INPUT | CURRENT_INPUT (provider) | CURRENT_INPUT (local est. at parity) |
| --- | --- | --- | --- |
| REL-T1 | 17514 | 9138 | 25480 |
| REL-T2 | 21726 | 11285 | — |
| ACT-T1 | 17536 | 9152 | — |
| ACT-T2 | 21862 | 10936 | — |

Provider input is below historical on all four calls. Local assembled estimate exceeded historical REL-T1. No interpretation assigned.

## Deterministic alarms

No candidate flags fired. All `alarms` arrays in `meta/*.json` are empty.

```text
MALFORMED_OUTPUT — none
META_LEAK — none
EMPTY_OUTPUT — none
PROVIDER_ERROR — none
TRUNCATION — none (all finish_reason=stop)
NEW_USER_DIALOGUE_CANDIDATE — none
NEW_USER_ACTION_CANDIDATE — none
NEW_USER_INTENT_CANDIDATE — none
CANON_CONTRADICTION_CANDIDATE — none
SEMANTIC_REPETITION_CANDIDATE — none
```

## Request evidence paths

```text
requests/REL-T1-current-user.txt
requests/REL-T1-system-sanitized.txt
requests/REL-T1-messages-sanitized.json
(same pattern for REL-T2, ACT-T1, ACT-T2)
```
