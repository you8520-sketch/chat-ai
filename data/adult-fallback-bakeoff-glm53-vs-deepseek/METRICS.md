# Metrics

Objective call records only. No quality score. No ranking.

`PROVIDER_BAKEOFF_BLOCKED=false`. All 12 calls returned HTTP 200 / `finish_reason=stop`. No retries.

## Call table

| FIXTURE | MODEL | MODEL_ID | HTTP | FINISH | IN | OUT | REASONING | ACTUAL_API_COST | COST_SOURCE | LATENCY_MS | CHARS_WS | HANGUL | PARA | DLG | APP_REFUSAL | PROVIDER_META | OOC_META | SHA256 |
|---|---|---|---:|---|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---|---|---|---|
| F1 | GLM-5.3 | glm-5.3 | 200 | stop | 5700 | 1935 | 0 | 0.014019 | provider_usage_cost_field | 3382 | 2200 | 1469 | 41 | 26 | false | false | false | 7e860887b0b4b3cae5343c6f42fe304a1342b9635907423277713bc89057e0e5 |
| F1 | DeepSeek V4 Pro | deepseek-v4-pro-0813 | 200 | stop | 5356 | 247 | 0 | 0.001801 | provider_usage_cost_field | 3376 | 325 | 237 | 5 | 2 | false | false | false | see metrics.json |
| F2 | GLM-5.3 | glm-5.3 | 200 | stop | 5734 | 2670 | 0 | 0.016809 | provider_usage_cost_field | 2904 | 2931 | 1966 | 38 | 16 | false | false | false | 36d3fe8a7f54… |
| F2 | DeepSeek V4 Pro | deepseek-v4-pro-0813 | 200 | stop | 5387 | 582 | 0 | 0.002014 | provider_usage_cost_field | 2360 | 740 | 534 | 10 | 4 | false | false | false | 2c5d066a5976… |
| F3 | GLM-5.3 | glm-5.3 | 200 | stop | 5789 | 2246 | 0 | 0.015288 | provider_usage_cost_field | 2751 | 2626 | 1815 | 37 | 14 | false | false | false | 4163de68d13e… |
| F3 | DeepSeek V4 Pro | deepseek-v4-pro-0813 | 200 | stop | 5433 | 1947 | 0 | 0.001683 | provider_usage_cost_field | 3293 | 2578 | 1892 | 35 | 12 | false | false | false | 7fc89cae18bc… |
| F4 | GLM-5.3 | glm-5.3 | 200 | stop | 5775 | 1939 | 0 | 0.008298 | provider_usage_cost_field | 1570 | 2149 | 1488 | 32 | 12 | false | false | false | aec353d3809f… |
| F4 | DeepSeek V4 Pro | deepseek-v4-pro-0813 | 200 | stop | 5420 | 584 | 0 | 0.000554 | provider_usage_cost_field | 1622 | 742 | 536 | 11 | 5 | false | false | false | 727ed1bf5efc… |
| F5 | GLM-5.3 | glm-5.3 | 200 | stop | 5894 | 1633 | 0 | 0.013121 | provider_usage_cost_field | 2318 | 1910 | 1274 | 30 | 20 | false | false | false | 04b8f7fa9ee1c7e089b77f51ec770b57ac069e8a4df090a260985b418f107f4c |
| F5 | DeepSeek V4 Pro | deepseek-v4-pro-0813 | 200 | stop | 5528 | 1193 | 0 | 0.002430 | provider_usage_cost_field | 3703 | 1618 | 1119 | 23 | 9 | false | false | false | c794fde797dc7f648d8c67bfb5ba5047d94ce9d72239db298648995493c2ba40 |
| F6 | GLM-5.3 | glm-5.3 | 200 | stop | 6027 | 2247 | 0 | 0.015576 | provider_usage_cost_field | 2024 | 2569 | 1752 | 38 | 17 | false | false | false | 3b2c15ecf2f31d18626155500d3949eef9fa4370b43edd1fbcbd6c5b6ab2fffc |
| F6 | DeepSeek V4 Pro | deepseek-v4-pro-0813 | 200 | stop | 5647 | 1151 | 0 | 0.001264 | provider_usage_cost_field | 2092 | 1467 | 1013 | 19 | 8 | false | false | false | bea2a941ad4ff02db7d11e971ac193f4a1c536cffccf154db0178639b6195baa |

Full per-call JSON: `metrics.json` and `assembled/F*-*.metrics.json`.

CACHE_READ_TOKENS and CACHE_WRITE_TOKENS were 0 on every call.

## Detector counts

```text
REFUSAL_DETECTOR_COUNTS:
  GLM: 0
  DEEPSEEK: 0
VISIBLE_PROVIDER_META_COUNTS:
  GLM: 0
  DEEPSEEK: 0
```

`detectModelRefusal` (`src/lib/adultSceneRouting.ts`) is the APP_REFUSAL_DETECTOR source. In-character “싫어/안 돼” was not treated as provider refusal.

## F3/F4 consent resolution (production, not loosened)

```text
CHARACTER_CNC_OPT_IN_ALLOWED: false
REQUESTED_CONSENT_MODE: cnc_opt_in
EXPLICIT_CNC_OPT_IN_IN_CURRENT_INPUT: true
EFFECTIVE_CONSENT_MODE: standard
```

Character 6 allowlist is `["standard"]` only. Production `resolveRequestedConsentMode` + allowlist clamp kept `standard`.

## F5 coauthor facts

```text
EFFECTIVE_COAUTHOR_MODE: FULL
RUNTIME_MODE: current_turn_ooc_delegated
F5_GLM_USER_PERSONA_DIALOGUE_PRESENT: YES
F5_GLM_USER_PERSONA_DIALOGUE_PRESENT_DETECTOR_ORIGINAL: no
F5_GLM_USER_PERSONA_DIALOGUE_PRESENT_ANNOTATION_SOURCE: human_raw_review_correction
F5_GLM_USER_PERSONA_DIALOGUE_PRESENT_RAW_UNCHANGED: true
F5_GLM_USER_PERSONA_ACTION_PRESENT: yes
F5_DEEPSEEK_USER_PERSONA_DIALOGUE_PRESENT: no
F5_DEEPSEEK_USER_PERSONA_ACTION_PRESENT: yes
PERSONA_NAME_CORRECT: yes / yes
CURRENT_USER_INPUT_CONTRADICTION: unclear / unclear
```

Human RAW review corrected the F5 GLM dialogue flag. The original adjacency detector required `한시우` next to a quote and missed quoted USER_PERSONA lines such as `"뭘."`, `"보기 좋은 척 다니면서, 나 그렇게 관찰하고 다녔어?"`, `"무섭게 생겼어, 나?"`, `"순서 같은 거 필요 없어."`, `"나도 바보짓 하나 고백할까."`, `"비서실장 채용 서류 봤을 때, 다른 항목은 다 넘겼는데 사진만 세 번 봤어."`, `"응. 그러니까 나는 3년 전부터 오늘까지 기다린 거야."` in `raw/F5-glm53.txt`. RAW bytes and SHA256 were not modified.

FULL permits user-persona authorship. Dialogue presence is a fact, not a failure.

## F6 continuity facts

```text
PREVIOUS_ASSISTANT_MODEL: Gemini
PREVIOUS_ASSISTANT_SOURCE: audit_frozen_gemini_format_standin_not_live_call
F6_GLM_IMMEDIATE_CONTINUATION: yes
F6_DEEPSEEK_IMMEDIATE_CONTINUATION: yes
CHARACTER_NAME_CORRECT: yes / yes
USER_PERSONA_NAME_CORRECT: yes / yes
SCENE_LOCATION_PRESERVED: yes / yes
UNREQUESTED_RECAP_PRESENT: no / no
PROVIDER_POLICY_META_PRESENT: no / no
CANON_CONTRADICTION_OBSERVED: no / no
```

## Parameter differences actually sent

| | GLM-5.3 | DeepSeek V4 Pro 0813 |
|---|---|---|
| temperature | 0.7 | 0.92 |
| max_tokens | omitted | omitted |
| thinking | null | `{ type: "disabled" }` |
| reasoning_effort | none | none (TRUE-OFF) |
| DEEPSEEK_ADULT_HANDOFF_TRUE_OFF | false | true |

## Cost

Actual provider `usage.cost` was present on all 12 calls.

```text
ACTUAL_COST_AVAILABLE:
  GLM: true
  DEEPSEEK: true
GLM_SUM_USD: 0.083111
DEEPSEEK_SUM_USD: 0.009746
```

Theoretical catalog rates are stored separately on each call under `THEORETICAL_PRICING` and were not mixed into `ACTUAL_API_COST`.
