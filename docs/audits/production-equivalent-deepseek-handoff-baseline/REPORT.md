# Issue 2 — production-equivalent DeepSeek handoff baseline

Evidence-only. No production code changes. H1 was not executed.
Do not mutate #620 / #621 / #623 frozen RAW.

## Scope

Counterfactual: `QUALIFYING_PREVISIBLE_REFUSAL_ALREADY_OCCURRED=true`.
No Gemini call. No T3 Gemini gold in the DeepSeek input. No refusal prose.

Selected source = `gemini-3.1-pro-preview`  
`adultHandoffActuallyApplied` = true  
Resolved target = `deepseek-v4-pro-0813`  
Production helper `resolveDeepSeekAdultHandoffTrueOff(...)` → `true`  
`adaptCheaperInferenceChatBody` then sets TRUE-OFF.

Prompt owners held frozen:

- `DEEPSEEK_STYLE_REMINDER_ACTIVE=true`
- `HANDOFF_CONTINUATION_OWNER_ACTIVE=true`
- `INTIMACY_OWNER_ACTIVE=true`
- `USER_TAIL_3200_ACTIVE=true`
- `TERMINAL_DIALOGUE_OWNER_ACTIVE=false`

`CONTACT_ACTOR_EXTRACTION_BUG=true` (`previousActionActor="손이"`). Not fixed.

## Phase A — outbound equivalence (no provider call)

`#621` was assembled with `assemblePrimaryRpRequest` and `transportProvider=cheaperinference` but **without** `deepSeekAdultHandoffTrueOff`. That produces `thinking={type:"disabled"}` and **omits** `reasoning_effort`.

This assembly passes `deepSeekAdultHandoffTrueOff: true` after the production resolver. The adapter then sets:

- `thinking = { type: "disabled" }`
- `reasoning_effort = "none"`

`sceneServerControls` is **not** applied on this baseline. `route.ts` would also replace `[SCENE FLOW]` with `[SCENE PACING]` and append `[이번 응답 대화]`, which would flip `TERMINAL_DIALOGUE_OWNER_ACTIVE` to true and change the already-validated #621 message corpus. That delta is frozen under `meta/route-ts-scene-controls-delta/` and was not used for Phase C.

### Frozen hashes

| Field | Value |
| --- | --- |
| `REQUEST_621_SHA` | `85ae4e16ba3e002dc1dcd84911f3263c68679904e5d3316a0f365fd084003731` |
| `TRUE_PRODUCTION_HANDOFF_REQUEST_SHA` | `5e3c7ff903600bb5fbad38cf0131e9928e733e28ef170b5bf2ae95bd2caa9de0` |
| `PRODUCTION_OUTBOUND_EQUIVALENT_TO_621` | false |
| `PRODUCTION_OUTBOUND_EQUIVALENCE_621` | `NOT_PROVEN` (messages identical; `reasoning_effort` differs) |
| `MESSAGES_BYTE_IDENTICAL` | true |
| `TRUE_OFF_HANDOFF_ACTIVE` | true |
| `THINKING_VALUE` | `{ type: "disabled" }` |
| `REASONING_EFFORT_VALUE` | `"none"` |

### Field-level diff

| FIELD | #621 | true production | EQUAL |
| --- | --- | --- | --- |
| MODEL | `deepseek-v4-pro-0813` | `deepseek-v4-pro-0813` | true |
| MESSAGES | 6 messages, same roles/bytes | 6 messages, same roles/bytes | true |
| TEMPERATURE | 0.92 | 0.92 | true |
| TOP_P | 0.92 | 0.92 | true |
| MAX_TOKENS | absent | absent | true |
| STREAM | true | true | true |
| STREAM_OPTIONS | `{ include_usage: true }` | `{ include_usage: true }` | true |
| THINKING | `{ type: "disabled" }` | `{ type: "disabled" }` | true |
| REASONING_EFFORT | absent | `"none"` | **false** |
| OTHER_FIELDS | none | none | true |

### Transport gate

- `T1_PRIMARY_STYLE_EXEMPLAR_PRESENT=true` (assistant wire 2, 3473 chars, byte-identical)
- `T2_PRIMARY_STYLE_EXEMPLAR_PRESENT=true` (assistant wire 4, 3173 chars, byte-identical)
- `T3_GEMINI_GOLD_PRESENT=false`
- `GEMINI_REFUSAL_PRESENT=false`

Phase A passed. Phase C may execute one logical DeepSeek turn.

## Phase B / C

One logical DeepSeek turn through production `executeDeepSeekWithProviderFailover` (`routeKind=adult_handoff`). Provider failover is infrastructure, not a second generation experiment. No chat row, billing, memory, or route mutation.

| Field | Value |
| --- | --- |
| `LOGICAL_DEEPSEEK_TURNS` | 1 |
| `CI_ATTEMPTED` | true |
| `CI_HTTP_STATUS` | 200 |
| `CI_FIRST_VISIBLE_MS` | 4953 |
| `CI_FAILURE_CLASS` | null |
| `FAILOVER_TRIGGER` | null |
| `OPENROUTER_BACKUP_ATTEMPTED` | false |
| `OPENROUTER_BACKUP_MODEL` | `deepseek/deepseek-v4-pro-0813` |
| `OPENROUTER_BACKUP_SUCCESS` | false |
| `TOTAL_PROVIDER_ATTEMPTS` | 1 |
| `DELIVERED_PROVIDER` | cheaperinference |
| `PRODUCTION_WOULD_DELIVER_RESPONSE` | true |
| `DELIVERED_RAW_CHARS` | 4293 |
| `DELIVERED_FINISH_REASON` | stop |
| `DELIVERED_USAGE_PRESENT` | true |
| `DELIVERED_ENDS_COMPLETE_SENTENCE` | true |
| `DELIVERED_VISIBLE_CHARS` | 4293 |
| RAW == persisted-equivalent | true |

Usage observed: `prompt_tokens=19510`, `completion_tokens=3398`. Elapsed 96940 ms.

Frozen RAW: `responses/T3-DEEPSEEK-TRUE-PRODUCTION-HANDOFF-RAW.txt`

### Objective metrics (descriptive only, no score)

| Metric | T1 Gemini | T2 Gemini | T3 Gemini GOLD | T3 DeepSeek true-production |
| --- | ---: | ---: | ---: | ---: |
| VISIBLE_CHARS | 3473 | 3173 | 2651 | 4293 |
| PARAGRAPH_COUNT | 22 | 24 | 23 | 32 |
| DIALOGUE_BLOCKS | 5 | 5 | 5 | 13 |
| DIALOGUE_BLOCKS_PER_1000_CHARS | 1.440 | 1.576 | 1.886 | 3.028 |
| DIALOGUE_PARAGRAPH_RATIO | 0.227 | 0.208 | 0.217 | 0.406 |
| MAX_CONSECUTIVE_DIALOGUE | 1 | 1 | 1 | 1 |
| MEDIAN_PARAGRAPH_CHARS | 154 | 139 | 108 | 175.5 |
| MEDIAN_NARRATION_PARAGRAPH_CHARS | 183 | 154 | 136.5 | 214 |
| MEDIAN_DIALOGUE_PARAGRAPH_CHARS | 85 | 51 | 29 | 14 |

Baselines: `PRIMARY_MEDIAN_VISIBLE_CHARS=3323`, `T3_GEMINI_GOLD_VISIBLE_CHARS=2651`.  
Ratios: DeepSeek / primary median = 1.2919; DeepSeek / T3 gold = 1.6194.

### Deterministic alarms (candidates only)

| Alarm | Value |
| --- | --- |
| META_LEAK | false |
| EMPTY_OUTPUT | false |
| NEW_USER_DIALOGUE_CANDIDATE | false |
| NEW_USER_ACTION_CANDIDATE | false |
| CANON_CONTRADICTION_CANDIDATE | false |
| REPETITION_CANDIDATE | false |
| TURN_ENDING_USER_CHECKPOINT_CANDIDATE | false |
| REQUESTED_PROGRESSION_COMPLETED | true |

`CONTACT_ACTOR_EXTRACTION_BUG=true`. H1 was not executed.

STOP for Human/ChatGPT RAW review.
