# Issue 2 — H2 OpenRouter valid replacement sample

Evidence-only audit. **No production code changes.** **Do not merge #620–#630.**

Replaces the invalid #630 H2 sample (`finish_reason=error`, truncated) with **one** direct OpenRouter call using the **exact frozen** #630 backup request. Does not overwrite #630 failed RAW.

## Frozen request

| Field | Value |
|-------|-------|
| Source | `#630` `docs/audits/h2-minimal-handoff-style-reminder/requests/OPENROUTER_BACKUP-input.json` |
| H2_FROZEN_FILE_SHA256 | `6a5bb460ee99405d22ba4be05e809fe03fdcfbfb45efd9d54f307b2c09977fac` |

## Diff gate — PASS

`H2_OR_ONLY_DELTA_IS_PARAGRAPH_CLAUSE_REMOVAL=true`

vs #629 A OpenRouter backup (`0eb5ad147fadc36defda7b58e846b5b765e01fecda7ba402bbb2ee428b3b75a4`):

- Same provider / model / temp / top_p / reasoning / stream
- Same system, T1/T2, current user body
- Only delta: 92-char paragraph-consolidation clause absent in H2

## Validity gate — PASS

| Field | Value |
|-------|-------|
| TOTAL_PROVIDER_CALLS | 1 |
| HTTP_STATUS | 200 |
| FINISH_REASON | stop |
| ENDS_COMPLETE_SENTENCE | true |
| VISIBLE_CHARS | 3805 |
| H2_REPLACEMENT_VALID | **true** |
| H2_REPLACEMENT_RAW_SHA | `7836311e6ecb8d4125dbb5cb201baf79ccf2890c58922a01d569c5b98e7fe2f5` |

## Objective metrics (complete sample)

| Arm | Chars | Para | Dialogue | Dial/1k | Median narr |
|-----|-------|------|----------|---------|-------------|
| T3 Gemini GOLD | 2651 | 23 | 5 | 1.886 | 136.5 |
| A #629 OpenRouter | 2380 | 21 | 10 | 4.202 | **207** |
| H1 #626 OpenRouter | 3812 | 34 | 14 | 3.673 | 177 |
| **H2 replacement OR** | **3805** | **26** | **10** | **2.628** | **233.5** |
| H2 #630 partial (invalid) | 1357 | 13 | 6 | 4.422 | 153 |

Also:

| | H2 replacement | A #629 | H2 #630 partial |
|--|----------------|--------|-----------------|
| SOURCE_USER_QUOTED_DIALOGUE | **1** | 0 | 0 |
| T2_REPLAY_TOPICS | FIRST_KISS | FIRST_KISS | FIRST_KISS |
| REQUESTED_PROGRESSION_COMPLETED | true | — | — |

**Note:** The valid complete H2 sample does **not** reproduce the partial sample's favorable median narration (153). Full-turn median narration (233.5) is closer to A OpenRouter consolidation pressure (207) and A CI (232), not Gemini GOLD (136.5). Human review required.

## Infra read-only audit (#630 failure)

Why `finish_reason=error` still had `PRODUCTION_WOULD_DELIVER_RESPONSE=true`:

| Field | Value |
|-------|-------|
| FINISH_REASON_ERROR_OWNER | OpenRouter SSE `finish_reason=error`; `detectAdultGenerationFailure()` has no `error` branch |
| FINISH_REASON_ERROR_TREATED_AS_PROVIDER_FAILURE | **false** |
| PARTIAL_ERROR_STREAM_PERSISTED_BY_PRODUCTION | **true** (1357 chars > catastrophic floor) |
| RECOVERY_OR_FAILOVER_AFTER_VISIBLE_ERROR | **false** |

See `meta/infra-finish-reason-error-trace.json`. **No fix in this PR.**

## STOP

Awaiting Human/ChatGPT RAW review on the **complete** H2 OpenRouter replacement. H2 prompt unchanged (#630).
