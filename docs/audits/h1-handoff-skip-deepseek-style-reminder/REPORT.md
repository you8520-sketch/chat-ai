# Issue 2 — H1 handoff-skip DeepSeek style reminder

Minimal production change + evidence. **H1 executed.** Do not merge #620–#625 or this PR.

## Production change (one semantic delta)

`suppressDeepSeekStyleReminderForAdultHandoff?: boolean` on `ContextBuildInput` (default `false`).

Set `true` only in `route.ts` adult-handoff fallback `buildContext` (non-DeepSeek source → DeepSeek0813).

When true, `buildContext` skips `prependDeepSeekStyleOnlyReminder` on the current user turn. Native/user-selected DeepSeek unchanged.

## Static scope proof

| Field | Value |
| --- | --- |
| `NATIVE_DEEPSEEK_STYLE_REMINDER_ACTIVE` | true |
| `ADULT_HANDOFF_DEEPSEEK_STYLE_REMINDER_ACTIVE` | false |
| `GEMINI_PRIMARY_CHANGED` | false |
| `OTHER_MODELS_CHANGED` | false |

Transport gate (H1 wire): T1/T2 byte-identical exemplars present; T3 Gemini gold absent.

## A/B request diff gate

| Field | Value |
| --- | --- |
| `A_REQUEST_SHA` | `d155d08328ba7903846799feb6a05f3d239631b4593d72a607d60d6f0ecf26d2` |
| `H1_REQUEST_SHA` | `8313d5e41e2e8317e49c66abce39f222dabc4008d04dc79e23a6b695a1db3d1d` |
| `H1_ONLY_DELTA_IS_DEEPSEEK_STYLE_REMINDER_REMOVAL` | **true** |
| `REMOVED_REMINDER_CHARS` | 279 |

Model/temperature/top_p/stream/thinking/reasoning_effort identical. Messages 0–4 byte-identical. Final user differs only by removed `DEEPSEEK_BOTTOM_REMINDER_STYLE_ONLY` prefix.

## H1 owner freeze

| Owner | H1 |
| --- | --- |
| `DEEPSEEK_STYLE_REMINDER_ACTIVE` | false |
| `HANDOFF_CONTINUATION_OWNER_ACTIVE` | true |
| `INTIMACY_OWNER_ACTIVE` | true |
| `USER_TAIL_3200_ACTIVE` | true |
| `TERMINAL_DIALOGUE_OWNER_ACTIVE` | true |
| `SCENE_PACING_OWNER_ACTIVE` | true |

## One logical H1 turn

`executeDeepSeekWithProviderFailover`, `routeKind=adult_handoff`, `LOGICAL_DEEPSEEK_TURNS=1`.

| Field | Value |
| --- | --- |
| `CI_ATTEMPTED` | true |
| `CI_FAILURE_CLASS` | headers_timeout |
| `FAILOVER_TRIGGER` | headers_timeout |
| `OPENROUTER_BACKUP_ATTEMPTED` | true |
| `OPENROUTER_BACKUP_SUCCESS` | true |
| `TOTAL_PROVIDER_ATTEMPTS` | 2 |
| `DELIVERED_PROVIDER` | openrouter |
| `PRODUCTION_WOULD_DELIVER_RESPONSE` | true |
| `DELIVERED_FINISH_REASON` | stop |
| `DELIVERED_USAGE_PRESENT` | true |
| `DELIVERED_ENDS_COMPLETE_SENTENCE` | true |
| `H1_VISIBLE_CHARS` | 3812 |
| `H1_RAW_SHA` | `9a7024859ac4fe355b830644cf6403c5fec9404e914f3379ce0167c73629d8ab` |

CheaperInference primary timed out on headers; production failover delivered from OpenRouter pinned 0813 backup (infrastructure, not a second experiment).

## Objective metrics (descriptive A vs H1)

| Metric | T1 Gemini | T2 Gemini | T3 Gemini GOLD | T3 DeepSeek A (#625) | T3 DeepSeek H1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| VISIBLE_CHARS | 3473 | 3173 | 2651 | 2863 | 3812 |
| PARAGRAPH_COUNT | 22 | 24 | 23 | 17 | 34 |
| DIALOGUE_BLOCKS | 5 | 5 | 5 | 5 | 14 |
| DIALOGUE_BLOCKS_PER_1000_CHARS | 1.440 | 1.576 | 1.886 | 1.746 | 3.673 |
| DIALOGUE_PARAGRAPH_RATIO | 0.227 | 0.208 | 0.217 | 0.294 | 0.412 |
| MAX_CONSECUTIVE_DIALOGUE | 1 | 1 | 1 | 1 | 1 |
| MEDIAN_PARAGRAPH_CHARS | 154 | 139 | 108 | 217 | 98.5 |
| MEDIAN_NARRATION_PARAGRAPH_CHARS | 183 | 154 | 136.5 | 232 | 177 |
| MEDIAN_DIALOGUE_PARAGRAPH_CHARS | 85 | 51 | 29 | 15 | 26.5 |

`H1_VS_PRIMARY_LENGTH_RATIO` = 1.1472  
`H1_VS_GEMINI_GOLD_LENGTH_RATIO` = 1.4379

## Agency / alarms

`NEW_USER_PERSONA_DIALOGUE_CANDIDATE_COUNT` = 0  
`NEW_USER_DIALOGUE_HUMAN_REVIEW_REQUIRED` = false

Legacy alarm `NEW_USER_DIALOGUE_CANDIDATE=true` (regex); improved attribution: all quotes `AI_CHARACTER_DIALOGUE_CANDIDATE`.

`CONTACT_ACTOR_EXTRACTION_BUG=true` — not fixed.

## Tests

`src/services/contextBuilder.adultHandoffStyleReminder.test.ts` — 5 pass.

STOP for Human/ChatGPT RAW review. Do not merge.
