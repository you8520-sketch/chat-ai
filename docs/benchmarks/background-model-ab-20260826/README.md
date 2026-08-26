# Background model A/B — DeepSeek V4 Flash vs GPT-5.6 Luna

Executed: 2026-08-26 (Cloud Agent VM, CheaperInference direct calls)

Harness: `scripts/bench-background-luna-vs-deepseek.ts`  
Source main SHA at bench definition: `0780df9d89f2ef493d5aae8ef118874d270d5f6e`

## Run conditions

| Setting | Value |
|---------|-------|
| A (DeepSeek) | `deepseek-v4-flash-0731` / CheaperInference, `thinking: { type: "disabled" }` |
| B (Luna) | `gpt-5.6-luna` / CheaperInference, `reasoning.effort = none`, `reasoning_effort = none` |
| Deadline | 45_000 ms (production long-form) |
| Calls | 20 (5 summary + 5 HTML per model, interleaved) |
| retry | 0 |
| provider failover | 0 |
| continuation | 0 |
| recovery | 0 |
| DB writes | 0 |
| point charges | 0 |

## Objective statistics (HTTP 200, non-timeout calls only for latency/token averages)

### DeepSeek (`deepseek-v4-flash-0731`)

| Metric | Value |
|--------|-------|
| CALLS | 10 |
| HTTP_SUCCESS_COUNT | 5 |
| TIMEOUT_COUNT | 5 |
| EMPTY_OUTPUT_COUNT | 5 |
| AVG_LATENCY_MS | 5584 |
| P50_LATENCY_MS | 5054 |
| P95_LATENCY_MS | 8339 |
| AVG_INPUT_TOKENS | 201 |
| AVG_OUTPUT_TOKENS | 248 |
| TOTAL_REASONING_TOKENS | 0 |

### Luna (`gpt-5.6-luna`)

| Metric | Value |
|--------|-------|
| CALLS | 10 |
| HTTP_SUCCESS_COUNT | 10 |
| TIMEOUT_COUNT | 0 |
| EMPTY_OUTPUT_COUNT | 0 |
| AVG_LATENCY_MS | 3648 |
| P50_LATENCY_MS | 2783 |
| P95_LATENCY_MS | 7064 |
| AVG_INPUT_TOKENS | 636 |
| AVG_OUTPUT_TOKENS | 135 |
| TOTAL_REASONING_TOKENS | 0 |

## Mechanical validation (no content-quality judgment)

Per-call checks recorded in `results.json` rows:

- **empty**: output trimmed length == 0
- **fence**: markdown code fence present at output start
- **requiredPresent** (HTML cases only): all `htmlRequired` literals found as substring in output
- **obviousUnclosed**: open tag count > close tag count when angle brackets present

| caseId | model | task | empty | fence | requiredPresent | obviousUnclosed |
|--------|-------|------|-------|-------|-----------------|-----------------|
| S1_promise_item | deepseek-v4-flash-0731 | summary | true | false | — | false |
| S1_promise_item | gpt-5.6-luna | summary | false | false | — | false |
| S2_uncertain_identity | gpt-5.6-luna | summary | false | false | — | false |
| S2_uncertain_identity | deepseek-v4-flash-0731 | summary | true | false | — | false |
| S3_injury_status | deepseek-v4-flash-0731 | summary | true | false | — | false |
| S3_injury_status | gpt-5.6-luna | summary | false | false | — | false |
| S4_time_location | gpt-5.6-luna | summary | false | false | — | false |
| S4_time_location | deepseek-v4-flash-0731 | summary | true | false | — | false |
| S5_relationship_boundary | deepseek-v4-flash-0731 | summary | true | false | — | false |
| S5_relationship_boundary | gpt-5.6-luna | summary | false | false | — | false |
| H1_notice | deepseek-v4-flash-0731 | html | false | false | true | false |
| H1_notice | gpt-5.6-luna | html | false | false | true | false |
| H2_status | gpt-5.6-luna | html | false | false | true | false |
| H2_status | deepseek-v4-flash-0731 | html | false | false | true | false |
| H3_long_korean | deepseek-v4-flash-0731 | html | false | false | true | false |
| H3_long_korean | gpt-5.6-luna | html | false | false | true | false |
| H4_conditional | gpt-5.6-luna | html | false | false | true | false |
| H4_conditional | deepseek-v4-flash-0731 | html | false | false | true | false |
| H5_special_chars | deepseek-v4-flash-0731 | html | false | false | false | false |
| H5_special_chars | gpt-5.6-luna | html | false | false | false | false |

Production HTML tail parser (`stripBrokenHtmlFragmentAtEnd`) was not applied to these artifacts; only substring/tag-count checks above.

## Artifacts

- `results.json` — full per-call raw outputs and provider metadata (no secrets)

## Explicit non-judgments

- QUALITY_JUDGMENT = NOT_PERFORMED
- PRIMARY_RECOMMENDATION = NOT_PERFORMED
- No winner, weighted score, or pass/fail quality labels computed in this run.
