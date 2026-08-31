# TRPG Important-Scene Selection Benchmark Report

Research/benchmark only. GPT/human reviewer scores pending.

## Reproducibility

- BASE_MAIN_SHA: `419cb2c0a699587de9ef277da0b0da799b66485c`
- BENCHMARK_HEAD_SHA: `419cb2c0a699587de9ef277da0b0da799b66485c`
- NODE_VERSION: `v22.14.0`
- PRIMARY_MODEL: `gpt-5.6-luna`
- FALLBACK_MODEL: `google/gemini-3.1-flash-lite`
- SCENE_PLAN_MAX_PROVIDER_ATTEMPTS: 2
- SCENE_PLAN_RETRY_COUNT: 0

## Compatibility

- EXISTING_CHAT_PLANNER_TRPG_COMPATIBILITY: PASS
- Probe fixtures: F1, F5

## Invocation counts

- PLAN_CHAT_IMAGE_SCENE_INVOCATIONS: 10
- PRIMARY_SUCCESS_COUNT: 9
- SECONDARY_FALLBACK_SUCCESS_COUNT: 0
- DETERMINISTIC_FALLBACK_COUNT: 1
- PAID_IMAGE_GENERATION_CALLS: 0

## Latency (ms)

- AVG_AI_LATENCY_MS: 6241
- P50_AI_LATENCY_MS: 6215
- P95_AI_LATENCY_MS: 7486

## Objective hard-failure counts

- inventedEvent: 0
- wrongLocation: 9
- rewritesPartyAction: 0
- deterministicFallback: 1

## GPT/Human scoring rubric (100 points)

A. MOST IMPORTANT VISUAL BEAT — 35
B. SINGLE-FRAME COHERENCE — 20
C. ACTION / ACTOR FIDELITY — 15
D. CHRONOLOGY / CONSEQUENCE — 10
E. LOCATION / ENVIRONMENT FIDELITY — 10
F. EMOTIONAL / CINEMATIC CLARITY — 10

## Integration eligibility gates (decide after scoring)

1. AI wins vs CURRENT_RAW on >= 7/10 fixtures
2. AI wins vs DETERMINISTIC_FIRST on >= 7/10 fixtures
3. AI average score advantage >= +10 over deterministic
4. zero H1–H5 hard fidelity failures
5. deterministic fallback <= 1/10 (>=2/10 = reliability concern)

## Artifacts

- fixtures: `fixtures.json`
- raw results: `results.json`
- review packet: `REVIEW_PACKET.md`

CURSOR_SUBJECTIVE_WINNER: NOT_EVALUATED
GPT_SCORING_STATUS: PENDING
