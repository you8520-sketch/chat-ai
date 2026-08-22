# Phase E transport isolation — pre-call freeze

EVIDENCE ONLY. DO NOT MERGE. DO NOT DEPLOY.

`SOURCE_PRODUCTION_BEHAVIOR_CHANGED=false`

`TOTAL_NEW_PROVIDER_CALLS` pending (assemble-only complete).

## Owners (current main)

```
NATIVE_DS_REASONING_EFFORT=OMITTED
HANDOFF_DS_REASONING_EFFORT=none
```

NATIVE_TRANSPORT:

- temperature=0.92
- top_p=0.92
- thinking={type:"disabled"}
- reasoning_effort=OMITTED

HANDOFF_TRANSPORT:

- temperature=0.92
- top_p=0.92
- thinking={type:"disabled"}
- reasoning_effort="none"

HISTORICAL_TRANSPORT (#493):

- temperature=0.7
- top_p=OMITTED
- thinking={type:"disabled"}
- reasoning_effort="none"

## Parity

`MESSAGES_IDENTICAL=true`

SYSTEM_SHA / HISTORY_SHA / CURRENT_USER_SEMANTIC_SHA match PR #555 A_A.

Only request transport fields may differ. See `bodies/*.keys.json`.

## Baseline (existing A_A; no recapture)

- T_NATIVE_CHARS=1625
- OUTPUT_TOKENS=1463
- REASONING_TOKENS=0
- finish_reason=stop

## Next

Exactly two provider calls: T_HANDOFF then T_HISTORICAL.

No retry. No continuation. No Gemini. No GLM. No native recapture.
