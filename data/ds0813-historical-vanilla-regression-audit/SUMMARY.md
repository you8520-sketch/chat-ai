# Return block

EVIDENCE ONLY. DO NOT MERGE. DO NOT DEPLOY.
PHASE D STOPPED. NO NEW PROMPT. NO LENGTH BLOCK. NO CONTINUATION.

```
BASE_MAIN_SHA: 3eec104b066ba2e851f8a5558c5ab7bc9cdd0f25
EARLY_0813_VANILLA_LONG_OUTPUT_PROVEN: true
EARLY_0813_TRUE_ZERO_REASONING_PROVEN: true
EARLY_0813_LENGTH_ADAPTER_REQUIRED: false
CORRECTION: Do not claim DeepSeek 0813 naturally outputs only 1700-2300 chars.
HYPOTHESIS_PROVEN: false
EXACT_HISTORICAL_LONG_HISTORY_RESTORABLE: false
EXACT_493_VANILLA_REQUEST_RESTORABLE: false
H_THIN_RECENT_ASSISTANT_COUNT: n/a
H_THIN_RECENT_ASSISTANT_CHARS: n/a
H_THIN_OUTPUT_CHARS: n/a
H_LONG_RECENT_ASSISTANT_COUNT: n/a
H_LONG_RECENT_ASSISTANT_CHARS: n/a
H_LONG_OUTPUT_CHARS: n/a
DELTA_CHARS: n/a
HISTORY_LENGTH_DEPENDENCE_REPRODUCED: n/a
CURRENT_0813_DIFFERS_FROM_EARLY_VANILLA: n/a
SHORT_OUTPUT_NOT_REPRODUCED: n/a
PROVIDER_CALLS: 0
RETRIES: 0
CONTINUATIONS: 0
QUALITY_SCORE_ASSIGNED: false
MODEL_WINNER_SELECTED: false
SOURCE_PRODUCTION_BEHAVIOR_CHANGED: false
MERGED: false
DEPLOYED: false
HUMAN_RAW_REVIEW_REQUIRED: true
```

## PR #493 freeze

- Target: `deepseek-v4-pro-0813`
- Transport: `thinking={type:"disabled"}`, `reasoning_effort=none`
- Reasoning stream events: 0 / 0
- Reasoning chars: 0 / 0
- No SOURCE_MIRROR / COMPLETION / TURN_OWNERSHIP / ORIGIN_POINTER / model-specific style adapter
- No retry / continuation / fallback
- Vanilla outputs: 3356 / 3747, both `finish_reason=stop`
- Frozen Gemini source turns: 2534 / 2630 / 3517

## Why isolation calls did not run

Missing committed artifacts:

1. Private snapshot `handoff-17-1-2026-08-18T11-38-17-786Z` (not on this VM)
2. Assembled system prompt (SYSTEM.txt is a stub; SHA only)
3. Greeting RAW (HISTORY.txt says it existed; text not copied)
4. Assembled message list / wrapped current-user turn

Restorable without invention: the three Gemini assistant RAWs and the synthetic user lines. That is not an exact #493 request.

Do not graft those Gemini turns onto the #555 도윤 thin fixture. That would invent a false scene.

## Next

If the private snapshot or assembled messages are supplied, the next task can isolate source/system changes between #493 and current main, then retry H_THIN / H_LONG with `SYSTEM_SHA_EQUAL` and `CURRENT_USER_SHA_EQUAL` proven.
