# Current-main results

```text
FIXTURE_PARITY_PROVEN=false
TOTAL_PROVIDER_CALLS=0
RETRIES=0
CONTINUATIONS=0
RECOVERY_CALLS=0
REGEN=0
CURSOR_QUALITY_SCORE_ASSIGNED=false
CURSOR_MODEL_VERDICT_ASSIGNED=false
PRODUCTION_PROMPT_CHANGED=false
```

No current-main Gemini 3.1 sample exists in this packet. Numbers below are `NOT_RUN`, not zero-length model output.

## Four-call objective table

| call | VISIBLE_CHARS_INCL_SPACES | VISIBLE_CHARS_EXCL_SPACES | PARAGRAPH_COUNT | NARRATION_PARAGRAPH_COUNT | DIALOGUE_PARAGRAPH_COUNT | DIALOGUE_PARAGRAPH_RATIO | MAX_CONSECUTIVE_DIALOGUE_PARAGRAPHS | INPUT_TOKENS | OUTPUT_TOKENS | THINKING_TOKENS | LATENCY_MS | TTFT_MS | FINISH_REASON | REQUEST_SHA | RAW_SHA |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REL-T1 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| REL-T2 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| ACT-T1 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| ACT-T2 | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |

```text
CURRENT_MEDIAN_CHARS=NOT_RUN
CURRENT_AVG_CHARS=NOT_RUN
```

## Historical vs current visible chars

| call | HISTORICAL | CURRENT |
| --- | --- | --- |
| REL-T1 | 4659 | NOT_RUN |
| REL-T2 | 4254 | NOT_RUN |
| ACT-T1 | 4743 | NOT_RUN |
| ACT-T2 | 4327 | NOT_RUN |

No length-regression claim is licensed from this packet. PR #589 1778–2436 samples remain a different fixture family.

## Deterministic alarms

No model text was produced. No passage exists to quote for:

`MALFORMED_OUTPUT` · `META_LEAK` · `EMPTY_OUTPUT` · `PROVIDER_ERROR` · `TRUNCATION` · `NEW_USER_DIALOGUE_CANDIDATE` · `NEW_USER_ACTION_CANDIDATE` · `NEW_USER_INTENT_CANDIDATE` · `CANON_CONTRADICTION_CANDIDATE` · `SEMANTIC_REPETITION_CANDIDATE`

`EMPTY_OUTPUT` is not asserted. `NOT_RUN` is not an empty model completion.

## Planned call shape (not executed)

If parity is later proven, the intended shape (unchanged current-main production; no adapter) is:

```text
model = gemini-3.1-pro-preview
provider = Cheaper Inference current production path
temperature = 0.95
reasoning_effort = low
top_p = current production (omitted)
max_tokens = current production (omitted)
Gemini31 agency supplement = current
shared prose/layout = current
terminal length owner = current 3200 USER_TAIL
memory/history policy = current
REL-T1 / ACT-T1 = fresh logical chats
REL-T2 / ACT-T2 = continue matching T1
```
