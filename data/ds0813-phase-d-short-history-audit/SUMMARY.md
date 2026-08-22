# Section 14 — return block

EVIDENCE ONLY. DO NOT MERGE. DO NOT DEPLOY.
DO NOT MODIFY OR MERGE PR #555.
NO PROSE QUALITY SCORE. NO CURSOR WINNER. HUMAN RAW REVIEW REQUIRED.

```
BASE_MAIN_SHA: 98f8111a6e81ad9551c3c9c5777032e40f7b4b3d
PR: https://github.com/you8520-sketch/chat-ai/pull/556
DENSE_INTERNAL_SOURCE_SHA: 91be35edc3adbe790452ec9420dc7b28e3e6c97a
R_SHORT_HISTORY_TRIGGERED: true
R_RECENT_ASSISTANT_AVG_NO_WS: 425
R_D_CHARS: 1593
R_D_OUTPUT_TOKENS: 1434
R_D_REASONING: 0
R_D_TTFT_MS: 3624
R_D_TOTAL_LATENCY_MS: 29333
A_SHORT_HISTORY_TRIGGERED: true
A_RECENT_ASSISTANT_AVG_NO_WS: 988
A_D_CHARS: 1541
A_D_OUTPUT_TOKENS: 1387
A_D_REASONING: 0
A_D_TTFT_MS: 3093
A_D_TOTAL_LATENCY_MS: 31551
R_D_GE_2700: false
A_D_GE_2700: false
CURRENT_USER_DIALOGUE_ECHO: R true / A false
NEW_USER_DIALOGUE_BEYOND_CURRENT_INPUT: R true / A false
NEW_USER_INTENTIONAL_ACTION_BEYOND_CURRENT_INPUT: R false / A false
USER_MAJOR_CHOICE_AUTHORED: R false / A false
USER_CONSENT_OR_REFUSAL_AUTHORED: R false / A false
NEW_DYNAMIC_NUMERIC_STATE_WITHOUT_SOURCE: R false / A false
NEW_EXTERNAL_NPC: R false / A false
UNRELATED_EVENT: R false / A false
PREMATURE_SCENE_CLOSE: R false / A false
D_SCREEN_LENGTH_PASS: false
D_SCREEN_FAIL: true
TOTAL_NEW_PROVIDER_CALLS: 2
RETRIES: 0
CONTINUATIONS: 0
QUALITY_SCORE_ASSIGNED: false
MODEL_WINNER_SELECTED: false
SOURCE_PRODUCTION_BEHAVIOR_CHANGED: false
HUMAN_RAW_REVIEW_REQUIRED: true
```

Both fixtures triggered the existing short-history predicate (greeting-only history, avg no-ws 425 / 988 < 2200). Owner asserts passed: `USER_TAIL_COUNT=1`, `DENSE_SHORT_HISTORY_COUNT=1`, `SYSTEM_LENGTH_ADAPTER_COUNT=0`, `HISTORICAL_SINGLE_CALL_COUNT=0`. System and history SHAs match PR #555 ARM A. The only user-turn delta is Candidate D.

Both calls HTTP 200, `finish_reason=stop`, `REASONING_TOKENS=0`, `REASONING_STREAM_SEEN=false`, `OUTPUT_TRUNCATED=false`. Neither reached 2700. Screen fails. No D2. No second candidate. No continuation.

PR #555 A/B/C also failed the 2700 floor. None is production-ready. C is not selected for being longest.

Historical correction: rescue end-to-end effect observed, but rescue ran with a reasoning stream. True-zero-reasoning length-block effect is not proven. Opus-source true-zero-reasoning DeepSeek reached 3721 / 4136 / 3884 on a different history shape.
