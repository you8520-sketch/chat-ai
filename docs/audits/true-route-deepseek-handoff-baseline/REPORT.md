# Issue 2 — true route-equivalent DeepSeek handoff baseline (final A)

Evidence-only. No production code changes. H1 was not executed.
Do not merge #620 / #621 / #623 / #624.

## Human correction applied

`PHASE_C_624_PRODUCTION_PROVIDER_PATH_EQUIVALENT=true`  
`PHASE_C_624_PRODUCTION_PROMPT_EQUIVALENT=false`

#624 Phase C used the TRUE-OFF body but **excluded** `route.ts` `sceneServerControls`. This run uses the full route-equivalent wire.

## TRUE ROUTE request

`TRUE_ROUTE_REQUEST_SHA` = `d155d08328ba7903846799feb6a05f3d239631b4593d72a607d60d6f0ecf26d2`

Pre-call SHA gate: **PASS**

| Property | Value |
| --- | --- |
| `TRUE_OFF_HANDOFF_ACTIVE` | true |
| `thinking` | `{ type: "disabled" }` |
| `reasoning_effort` | `"none"` |
| `T1_PRIMARY_STYLE_EXEMPLAR_PRESENT` | true (byte-identical) |
| `T2_PRIMARY_STYLE_EXEMPLAR_PRESENT` | true (byte-identical) |
| `T3_GEMINI_GOLD_PRESENT` | false |
| `TERMINAL_DIALOGUE_OWNER_ACTIVE` | true |
| `[SCENE FLOW]` in system | false |
| `[SCENE PACING]` in system | true |
| `[이번 응답 대화]` on final user | true |

Owners unchanged. `CONTACT_ACTOR_EXTRACTION_BUG=true`.

## Provider accounting

| Field | Value |
| --- | --- |
| `LOGICAL_DEEPSEEK_TURNS` | 1 |
| `CI_ATTEMPTED` | true |
| `CI_HTTP_STATUS` | 200 |
| `CI_FIRST_VISIBLE_MS` | 2332 |
| `CI_FAILURE_CLASS` | null |
| `OPENROUTER_BACKUP_ATTEMPTED` | false |
| `TOTAL_PROVIDER_ATTEMPTS` | 1 |
| `DELIVERED_PROVIDER` | cheaperinference |
| `PRODUCTION_WOULD_DELIVER_RESPONSE` | true |
| `DELIVERED_VISIBLE_CHARS` | 2863 |
| `DELIVERED_FINISH_REASON` | stop |
| `DELIVERED_USAGE_PRESENT` | true |
| `DELIVERED_ENDS_COMPLETE_SENTENCE` | true |

`CHEAPERINFERENCE_PRIMARY_HEALTH=PASS` — do not demote CI based on #621/#623.

## Objective metrics (descriptive only)

| Metric | T1 Gemini | T2 Gemini | T3 Gemini GOLD | T3 DeepSeek TRUE ROUTE A |
| --- | ---: | ---: | ---: | ---: |
| VISIBLE_CHARS | 3473 | 3173 | 2651 | 2863 |
| PARAGRAPH_COUNT | 22 | 24 | 23 | 17 |
| DIALOGUE_BLOCKS | 5 | 5 | 5 | 5 |
| DIALOGUE_BLOCKS_PER_1000_CHARS | 1.440 | 1.576 | 1.886 | 1.746 |
| DIALOGUE_PARAGRAPH_RATIO | 0.227 | 0.208 | 0.217 | 0.294 |
| MAX_CONSECUTIVE_DIALOGUE | 1 | 1 | 1 | 1 |
| MEDIAN_PARAGRAPH_CHARS | 154 | 139 | 108 | 217 |
| MEDIAN_NARRATION_PARAGRAPH_CHARS | 183 | 154 | 136.5 | 232 |
| MEDIAN_DIALOGUE_PARAGRAPH_CHARS | 85 | 51 | 29 | 15 |

`PRIMARY_MEDIAN_VISIBLE_CHARS=3323`, `T3_GEMINI_GOLD_VISIBLE_CHARS=2651`.

## Dialogue attribution (audit-only)

`NEW_USER_PERSONA_DIALOGUE_CANDIDATE_COUNT=0`  
`NEW_USER_DIALOGUE_HUMAN_REVIEW_REQUIRED=false`

All five direct-quote blocks in the delivered text were mechanically attributed as `AI_CHARACTER_DIALOGUE_CANDIDATE` (character speech to 렌 or standalone character lines). User-quoted `"박아. 끝까지."` from T3 input did not reappear as quoted persona dialogue in the model output.

See `meta/phase-c-dialogue-attribution.json`.

STOP for Human/ChatGPT RAW review. H1 MUST NOT EXECUTE.
