# Issue 2 — GLM-5.3 pure handoff candidate benchmark

Evidence-only. **No production code changes.** No production routing. No GLM style adapter.

## Assembly audit (pre-call gate)

| Field | Value |
| --- | --- |
| MODEL | `z-ai/glm-5.3` |
| PROVIDER | openrouter |
| MESSAGE_COUNT | 8 |
| REQUEST_SHA | `0ba8608766d61ec1b8a1602d15de94973a1ee1818428c6c80deee29d15bf4057` |
| T1_ASSISTANT_BYTE_IDENTICAL | true |
| T2_ASSISTANT_BYTE_IDENTICAL | true |
| GEMINI_GOLD_PRESENT | false |
| GEMINI_REFUSAL_PRESENT | false |
| DEEPSEEK_STYLE_REMINDER_PRESENT | false |
| DEEPSEEK_XML_PRESENT | false |
| DEEPSEEK_OPENING_REMAP_PRESENT | false |
| GLM_SPECIFIC_STYLE_ADAPTER_PRESENT | false |
| HANDOFF_CONTINUATION_INSTRUCTION_COUNT | 1 |
| USER_TAIL_3200_OWNER_COUNT | 1 |
| TERMINAL_DIALOGUE_OWNER_ACTIVE | true |
| USER_AGENCY_OWNER_ACTIVE | true |
| ACTIVE_CONSENT_MODE | standard |
| CNC_PERMISSION_ON_WIRE | false |

Corpus: frozen #620/#625 (라이크 / 렌). T1/T2 Gemini assistant exemplars byte-identical. Gemini T3 Gold absent from input.

## Provider call (exactly one)

| Field | Value |
| --- | --- |
| TOTAL_PROVIDER_CALLS | 1 |
| HTTP_STATUS | 200 |
| FINISH_REASON | stop |
| USAGE_PRESENT | true |
| VISIBLE_CHARS | 2891 |
| ENDS_COMPLETE_SENTENCE | true |
| REASONING_TOKENS | 29 |
| OUTPUT_TOKENS | 2666 |
| INPUT_TOKENS | 21729 |
| TTFT_MS | 5079 |
| TOTAL_LATENCY_MS | 100612 |
| COST | 0.042151 |
| UPSTREAM_COST | 0.042151 |
| RAW_SHA | `a594b2c12704b982d0762145199e5d5664d73c69fe5104ccf671cc88e8af8b66` |

## Refusal / capability gate

| Field | Value |
| --- | --- |
| COMPLIED | true |
| REFUSED | false |
| SAFETY_EMPTY | false |
| GLM53_HANDOFF_CAPABILITY | PASS |

## Objective metrics (GLM candidate)

Descriptive only — no automated subjective prose score.

## Comparison table

Production-candidate comparison (not strict one-variable A/B vs #625 DeepSeek-specific wire).

| Arm | Chars | Para | Dialogue | Dial/1k | Dial ratio | Med narr | User quoted | T2 replay | In tok | Out tok | Reas tok | Latency ms | Cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Gemini T1 | 3473 | 22 | 5 | 1.44 | 0.227 | 183 | 0 | FOOD_HUNGER, FIRST_KISS | — | — | — | — | — |
| Gemini T2 | 3173 | 24 | 5 | 1.576 | 0.208 | 154 | 0 | WHY_LOOKING, FOOD_HUNGER, FIRST_KISS | — | — | — | — | — |
| Gemini T3 GOLD | 2651 | 23 | 5 | 1.886 | 0.217 | 136.5 | 0 | FIRST_KISS | — | — | — | — | — |
| DeepSeek #625 CI A | 2863 | 17 | 5 | 1.746 | 0.294 | 232 | 0 | FIRST_KISS | 19546 | 2307 | — | 2332 | 0.016224 |
| DeepSeek #629 OR A | 2380 | 21 | 10 | 4.202 | 0.476 | 207 | 0 | FIRST_KISS | 19546 | 1924 | 0 | — | 0.021862896 |
| DeepSeek H1 #626 OR | 3812 | 34 | 14 | 3.673 | 0.412 | 177 | 1 | WHY_LOOKING, FOOD_HUNGER, FIRST_KISS | 19362 | 3046 | 0 | — | 0.03762 |
| GLM-5.3 candidate | 2891 | 28 | 15 | 5.189 | 0.536 | 208 | 0 | FIRST_KISS | 21729 | 2666 | 29 | 100612 | 0.042151 |

PRIMARY_MEDIAN_VISIBLE_CHARS=3323, T3_GEMINI_GOLD_VISIBLE_CHARS=2651.

## Human review questions (Cursor does NOT answer)

1. Does it feel more like the same Gemini 3.1 writer?
2. Does 라이크 retain playful / casual / humorous character voice?
3. Does it begin from the CURRENT T3 state rather than replay T2?
4. Is narration/dialogue balance closer to Gemini T1/T2?
5. Is paragraph/sentence rhythm closer to Gemini?
6. Does it preserve canon?
7. Does it avoid inventing new user dialogue?
8. Does it complete requested progression?
9. Does mandatory reasoning create over-analysis or strange prose?
10. Is the quality improvement large enough to justify replacing DeepSeek as Gemini refusal fallback?

Artifacts:
- `requests/GLM53-HANDOFF-input.json`
- `responses/T3-GLM53-CANDIDATE-RAW.txt`
- `responses/T3-GLM53-CANDIDATE-PERSISTED-EQUIVALENT.txt`
- `meta/phase-c-objective-metrics.json`

**STOP for Human/ChatGPT RAW review.**