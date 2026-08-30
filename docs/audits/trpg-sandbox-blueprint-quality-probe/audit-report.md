# TRPG Sandbox Blueprint Generator Reliability Audit

Generated: 2026-08-30 (metrics reclassified 2026-08-30)

## Root cause chain (confirmed)

```text
sandbox prompt → model returns valid JSON → endingConditions missing/empty
→ parseScenarioDraftJson succeeds → completeTrpgAuthoringJson succeeds (no repair)
→ evaluateSandboxBlueprint rejects → directorPlan=null → campaign starts planless
```

| Check | Result |
|-------|--------|
| VALID_JSON_WITH_EMPTY_ENDING_CONDITIONS_PARSE_SUCCESS | **true** |
| SEMANTIC_BLUEPRINT_VALIDATION_HAPPENS_AFTER_AUTHORING_COMPLETE | **true** |
| JSON_REPAIR_SEES_SEMANTIC_BLUEPRINT_FAILURE | **false** |

**PRIMARY_ROOT_CAUSE:** `A_SANDBOX_REQUIRED_FIELD_CONTRACT_TOO_WEAK` + `B_OPEN_ENDED_WORDING_SUPPRESSES_END_CONDITIONS`

## Frozen provider suite (corrected metrics)

| Metric | Count |
|--------|-------|
| TOTAL_PROVIDER_RUNS | 16 |
| SUCCESSFUL_PARSED_BLUEPRINTS | 12 |
| TRANSPORT_FAILURES | 4 |
| PARSE_FAILURES | 0 |
| REPAIR_FAILURES | 0 |
| SEMANTIC_BLUEPRINT_REJECTS | 0 |
| MISSING_ENDING_CONDITIONS_AMONG_PARSED | 0 |

### Pass rates (split denominators)

| Rate | Value |
|------|-------|
| END_TO_END_GENERATION_SUCCESS_RATE (all 16) | 12/16 = 75% |
| PARSED_BLUEPRINT_ACCEPTANCE_RATE | 12/12 = 100% |
| PRIMARY_WORLD_END_TO_END_PASS_RATE (12 primary) | 9/12 = 75% |
| PRIMARY_PARSED_BLUEPRINT_ACCEPTANCE_RATE | 9/9 = 100% |

Transport failures (all `body completion deadline exceeded`):

- W03 fantasy adventure (primary)
- W09 urban supernatural (primary)
- W12 lore-heavy world (primary)
- W02 open exploration (high-risk repeat run 1)

Previously failing genres on successful parse:

- Apocalypse survival: **PASS**
- Open exploration: **PASS** (primary + repeat run 2)

## Heuristic vs human review

| Field | Value |
|-------|-------|
| AGENCY_HEURISTIC_HITS | 2 (W06, W07) |
| AGENCY_HUMAN_CONFIRMED_FAILURES | 0 |
| RAILROAD_HEURISTIC_HITS | 2 (W06, W07) |
| RAILROAD_HUMAN_CONFIRMED_FAILURES | 0 |

Human review note: goal phrasing (“플레이어는 … 행동한다”) triggered regex false positives; no confirmed agency or railroad failures.

## High-risk repeats

| Field | Value |
|-------|-------|
| HIGH_RISK_TRANSPORT_FAILURES | 1 |
| HIGH_RISK_MISSING_ENDING_CONDITIONS | 0 |

## Product gate

- **Required-field contract (parsed Blueprints):** 0 missing `endingConditions`
- **DEFAULT_ENABLE_READY:** **NO** — 3/12 primary transport timeouts remain a separate reliability concern
- **TRANSPORT_FAILURE_COUNTED_AS_SEMANTIC_REJECT:** **false** (corrected)
- **TIMEOUT_COUNTED_AS_ENDING_MISS:** **false** (corrected)

## Latency / tokens (successful calls only)

| Metric | Value |
|--------|-------|
| MEDIAN_LATENCY_MS | 16077 |
| P95_LATENCY_MS | 88865 |
| AVG_INPUT_TOKENS | 1044 |
| AVG_OUTPUT_TOKENS | 1420 |
