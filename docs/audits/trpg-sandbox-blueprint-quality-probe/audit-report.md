# TRPG Sandbox Blueprint Generator Reliability Audit

Generated: 2026-08-30

## Root cause chain (confirmed)

```text
sandbox prompt → model returns valid JSON → endingConditions missing/empty
→ parseScenarioDraftJson succeeds → completeTrpgAuthoringJson succeeds (no repair)
→ evaluateSandboxBlueprint rejects → directorPlan=null → campaign starts planless
```

| Check | Result |
|-------|--------|
| VALID_JSON_WITH_EMPTY_ENDING_CONDITIONS_PARSE_SUCCESS | **true** (test + prior probe) |
| SEMANTIC_BLUEPRINT_VALIDATION_HAPPENS_AFTER_AUTHORING_COMPLETE | **true** (`sandboxDirector.ts` L133–137) |
| JSON_REPAIR_SEES_SEMANTIC_BLUEPRINT_FAILURE | **false** (repair only on parse throw) |

**PRIMARY_ROOT_CAUSE:** `A_SANDBOX_REQUIRED_FIELD_CONTRACT_TOO_WEAK` + `B_OPEN_ENDED_WORDING_SUPPRESSES_END_CONDITIONS`

Generic draft prompt listed `endingConditions` in JSON keys but treated endings as optional via "Ending candidates are adaptable outcomes" and sandbox addendum "Keep playLength open_ended" without requiring completion criteria.

## Owner map

| Owner | Location |
|-------|----------|
| SANDBOX_BLUEPRINT_GENERATION_OWNER | `sandboxDirector.ensureCampaignDirectorContext` |
| SANDBOX_SYSTEM_PROMPT_OWNER | `buildSandboxDirectorSystemPrompt` |
| SANDBOX_USER_PROMPT_OWNER | `buildSandboxDirectorUserPrompt` |
| SHARED_SCENARIO_DRAFT_PROMPT_OWNER | `buildScenarioDraftSystemPrompt` |
| JSON_PARSE_OWNER | `parseScenarioDraftJson` / `completeTrpgAuthoringJson` |
| JSON_REPAIR_OWNER | `completeTrpgAuthoringJson` repair branch |
| SANDBOX_SEMANTIC_VALIDATION_OWNER | `evaluateSandboxBlueprint` |
| SANDBOX_PLAN_PERSISTENCE_OWNER | `trpg_campaign_context.director_plan_json` |
| WORLD_ONLY_START_FAILURE_POLICY_OWNER | `ensureCampaignDirectorContext` (null plan, no block) |

`WORLD_ONLY_BLUEPRINT_GENERATOR_OWNER_COUNT = 1`

## Minimal correction (sandbox-only)

Extended `buildSandboxDirectorSystemPrompt` + one line in `buildSandboxDirectorUserPrompt`:
- Mandatory `startingSituation`, `centralConflict`, `goal`, `endingConditions` (≥1)
- `endingConditions` vs `endingCandidates` semantics
- `open_ended` ≠ absent completion criteria

**Not changed:** generic creator draft, JSON repair, validator strictness, feature flag, startup policy.

## Provider suite (post-correction)

| Metric | Value |
|--------|-------|
| FROZEN_WORLD_COUNT | 12 |
| HIGH_RISK_REPEAT_CALLS | 4 |
| TOTAL_PROVIDER_CALLS | 16 |
| PRIMARY_JSON_PARSE_SUCCESS | 12/16 |
| JSON_REPAIR_TRIGGERED | 0 |
| SEMANTIC_BLUEPRINT_REJECT (empty endings) | **0** |
| MISSING_ENDING_CONDITIONS (successful parses) | **0** |
| BEFORE missing endings (prior 5-world probe) | 2/5 |
| AFTER missing endings | 0/9 successful primary parses |
| Apocalypse + open exploration (primary) | **PASS** both |
| HIGH_RISK_ENDING_CONDITION_MISSES | 1 (W02 repeat timeout, not empty endings) |
| Transport timeouts (primary) | 3 (W03, W09, W12) |
| MEDIAN_LATENCY_MS | 16077 |
| P95_LATENCY_MS | 88865 |
| AVG_INPUT_TOKENS | 1044 |
| AVG_OUTPUT_TOKENS | 1420 |

## Product gate

- **Required-field contract:** fixed (0 empty `endingConditions` on successful calls)
- **DEFAULT_ENABLE_READY:** **NO** — 3/12 primary runs hit transport timeout; timeout handling is a separate follow-up
- **GENERATOR_QUALITY:** **PRODUCTION_GRADE** for the targeted endingConditions failure mode

## Cleanup

| Item | Status |
|------|--------|
| `scripts/lib/blueprint-prompt-vnext.ts` | KEEP (harness-only) |
| Duplicate sandbox generator | none found |
| Generic scenario authoring | KEEP unchanged |
