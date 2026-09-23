# EXPERIMENT_DESIGN — Audit 56

## Question

Does the current common RP prompt suppress Claude Opus 5's actual RP quality?

## Design

- Single model: `claude-opus-5` (Cheaper Inference)
- Three prompt arms (A/B/C), identical character/persona/inputs within each scenario
- 6 scenarios × 2 turns × 3 arms × 1 run = 36 outputs
- No reuse of prior audit outputs as baselines
- Length and quality scored separately (`NATURAL_STOP_BELOW_NUMERIC_TARGET` is a flag, not auto-fail)

## Arms

### A — CURRENT_STANDARD_EXACT
PR #250 standard collaborative payload via `buildContext` + `assemblePrimaryRpRequest`.

Owners:
- SceneDirective = 0
- collaborative owner = 1
- legacy novel owner = 0
- terminal length owner = 1 (numeric 3,200~4,200)
- model adapter = 0

### B — CURRENT_WITHOUT_NUMERIC_LENGTH
Identical to A except numeric length sentence replaced once with qualitative stop sentence.

### C — OPUS_NATIVE_MINIMAL
Audit-only minimal payload: character canon + persona + world + recent history + user input + minimal RP contract.
Excludes numeric length, SceneDirective, DeepSeek XML, Terra/Luna/Muse adapters, extra prose/density/anti-rep lists, legacy novel, auto-continue, recovery.

## Sampling

Arm A/B use production wire generation params for Opus (including temperature from Claude production path).
Arm C uses the same production Opus generation params with minimal messages.
`reasoning_effort` remains production wire (unset for Opus). No invented top_p.

## Phase-1 decision rules (after human blind)

- C mean ≥ A mean + 7 OR blind preference C>A ≥ 65% → `COMMON_PROMPT_SUPPRESSION_CONFIRMED`
- B mean ≥ A mean + 5 OR blind preference B>A ≥ 60% → `NUMERIC_LENGTH_OWNER_HARMS_OPUS`
- All arm means within 3 points and preference ≤ 55% → `PROMPT_NOT_PRIMARY_CAUSE` + `PROVIDER_OR_MODEL_ROUTE_AUDIT_REQUIRED`

Phase-2 (top 2 arms, 12 scenarios, 2 runs) starts only after human blind review.
