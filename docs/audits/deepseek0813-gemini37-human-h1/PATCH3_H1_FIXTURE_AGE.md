# Patch 3 — Local H1 fixture structured age (test-only)

**Character:** `id=17` (플러드 / 서강우), local H1 fixture only. **No production mutation.**

## Test attestation

| Field | Value | Rationale |
|-------|-------|-----------|
| `participant_min_age` | **22** | Canon establishes ability awakening at **21** (`system_prompt` / snapshot chunks). Current scene is post-awakening. No exact current age in public `description`. **22** is a conservative test-only lower bound (>21), not a claimed biography exact age. |
| `adult_status` | **confirmed** | Derived from `participant_min_age >= 19`. |

## Classifier replay (post-fix)

```
CHAR_PARTICIPANT_STATUS=confirmed
PERSONA_PARTICIPANT_STATUS=confirmed
ELIGIBILITY_ELIGIBLE=true
BLOCK_REASON=none
ADULT_ROUTE_DECISION_SHOULD_BLOCK=false
GEMINI_CALLS=0
DEEPSEEK_CALLS=0
```

Run: `node --conditions=react-server --import tsx scripts/h1-classifier-replay-patch3.ts`
