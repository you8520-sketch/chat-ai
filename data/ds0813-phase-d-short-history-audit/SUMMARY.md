# Section 14 — return block

EVIDENCE ONLY. DO NOT MERGE. DO NOT DEPLOY.
DO NOT MODIFY OR MERGE PR #555.
NO PROSE QUALITY SCORE. NO CURSOR WINNER. HUMAN RAW REVIEW REQUIRED.

```
BASE_MAIN_SHA: 98f8111a6e81ad9551c3c9c5777032e40f7b4b3d
PR: pending
DENSE_INTERNAL_SOURCE_SHA: 91be35edc3adbe790452ec9420dc7b28e3e6c97a
R_SHORT_HISTORY_TRIGGERED: true
R_RECENT_ASSISTANT_AVG_NO_WS: 425
R_D_CHARS: pending_provider
R_D_OUTPUT_TOKENS: pending_provider
R_D_REASONING: pending_provider
R_D_TTFT_MS: pending_provider
R_D_TOTAL_LATENCY_MS: pending_provider
A_SHORT_HISTORY_TRIGGERED: true
A_RECENT_ASSISTANT_AVG_NO_WS: 988
A_D_CHARS: pending_provider
A_D_OUTPUT_TOKENS: pending_provider
A_D_REASONING: pending_provider
A_D_TTFT_MS: pending_provider
A_D_TOTAL_LATENCY_MS: pending_provider
R_D_GE_2700: pending_provider
A_D_GE_2700: pending_provider
CURRENT_USER_DIALOGUE_ECHO: pending_provider
NEW_USER_DIALOGUE_BEYOND_CURRENT_INPUT: pending_provider
NEW_USER_INTENTIONAL_ACTION_BEYOND_CURRENT_INPUT: pending_provider
USER_MAJOR_CHOICE_AUTHORED: pending_provider
USER_CONSENT_OR_REFUSAL_AUTHORED: pending_provider
NEW_DYNAMIC_NUMERIC_STATE_WITHOUT_SOURCE: pending_provider
NEW_EXTERNAL_NPC: pending_provider
UNRELATED_EVENT: pending_provider
PREMATURE_SCENE_CLOSE: pending_provider
D_SCREEN_LENGTH_PASS: pending_provider
D_SCREEN_FAIL: pending_provider
TOTAL_NEW_PROVIDER_CALLS: 0 (pre-call revision; 2 max)
RETRIES: 0
CONTINUATIONS: 0
QUALITY_SCORE_ASSIGNED: false
MODEL_WINNER_SELECTED: false
SOURCE_PRODUCTION_BEHAVIOR_CHANGED: false
HUMAN_RAW_REVIEW_REQUIRED: true
```

PR #555 A/B/C all failed the 2700 floor. None is production-ready. C is not selected for being longest.

Historical correction: rescue end-to-end effect observed, but rescue ran with reasoning stream. True-zero-reasoning length-block effect is not proven. Opus-source true-zero-reasoning DeepSeek reached 3721 / 4136 / 3884 on a different history shape.
