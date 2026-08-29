# Billing Turn Billable Usage — Correction Note

**Related:** PR #732 candidate foundation correction
**Base:** Post–#728 route-composition audit

## #728 input finding status

```text
#728_INPUT_FINDING: PARTIAL
```

#728 correctly documented **LEVEL 1 route assembly** (primary `stage.input` + `promptAudit` cap → `totalInput`).

It did **not** fully trace **LEVEL 2 effective live pricing basis** for all premium models:

| Model | Route `totalInput` | Live pricing input basis |
|-------|-------------------|-------------------------|
| Gemini 3.7 Flash | `resolveTurnBillableInput(stage.input, promptAudit)` | `apiPromptTokensForCost` (= `apiReportedInputTokens ?? input`) |
| Gemini 3.1 Pro (OpenRouter `google/gemini-3.1-pro-preview`) | same | `totalInput` (route) — core token-floor path |
| Gemini 3.1 Pro (CI `gemini-3.1-pro-preview`) | same | `apiPromptTokensForCost` via unified-reasoning margins |
| Claude Opus 5 | same | `apiPromptTokensForCost` via unified-reasoning margins |

**Candidate responsibility:** LEVEL 1 route-assembled `NormalizedBillableUsage` only.
**LEVEL 2 characterization:** prove via `computeTurnBilling()` — candidate diagnostics expose raw facts (`apiPromptTokensForCost`, `routeTotalInput`) but do **not** interpret live pricing policy.

## Cache evidence

Production chain:

```text
raw usage → parseOpenRouterUsage → OpenRouterUsageBreakdown
→ tokenUsageFromOpenRouterBreakdown → TokenUsage
→ openRouterAdult stage writer → StageUsage
→ resolveTurnBillableUsage
```

| Raw state | Parsed number | Reporting-presence preserved? | TokenUsage field present? | StageUsage field present? |
|-----------|---------------|------------------------------|---------------------------|---------------------------|
| A. `cached_tokens` absent | 0 | No | No | No |
| B. `cached_tokens` explicitly 0 | 0 | No | No | No |
| C. `cached_tokens` > 0 | >0 | Yes (numeric) | Yes (>0 only) | Yes (>0 only) |
| D. `cache_write` absent | 0 | No | No | No |
| E. `cache_write` explicitly 0 | 0 | No | No | No |
| F. `cache_write` > 0 | >0 | Yes (numeric) | Yes (>0 only) | Yes (>0 only) |

Production `StageUsage` writers (`openRouterAdult.ts` ~2282–2287) omit cache fields when zero/unreported.
Absence is **not** proof of zero cache savings.

```text
PRODUCTION_STAGE_CAN_CONTAIN_EXPLICIT_ZERO_CACHE_FIELD: false
CACHE_ABSENT_VS_EXPLICIT_ZERO_DISTINGUISHABLE_AT_STAGE: false
PRODUCTION_REACHABLE_COMPLETE_NO_CACHE: false
```

Candidate coverage: unreported cache → `partial`, not `complete` (fail-closed).

Integration tests that set `cacheReadTokens: 0` / `cacheWriteTokens: 0` on `StageUsage` are **SYNTHETIC_COMPLETE_CONTRACT** fixtures — not production-reachable shapes.

## Reasoning evidence

Production chain:

```text
raw usage → parseReasoningTokens → OpenRouterUsageBreakdown.reasoningTokens
→ tokenUsageFromOpenRouterBreakdown → TokenUsage.reasoningOutputTokens
→ openRouterAdult stage writer → StageUsage.apiReasoningOutputTokens
→ sumOpenRouterStageReasoningTokens → resolveTurnBillableUsage
→ normalizeBillableUsage
```

| Raw state | Parsed | TokenUsage field | StageUsage field | Candidate source (absent path) |
|-----------|--------|------------------|------------------|--------------------------------|
| A. `reasoning_tokens` absent | 0 | omitted | omitted | `MISSING_AND_UNKNOWN` |
| B. `reasoning_tokens` explicitly 0 | 0 | omitted | omitted | `MISSING_AND_UNKNOWN` |
| C. `reasoning_tokens` > 0 | >0 | present (>0 only) | present (>0 only) | `PROVIDER_REPORTED_EXACT` |

```text
REASONING_ABSENT_VS_EXPLICIT_ZERO_DISTINGUISHABLE_AT_PARSER: false
REASONING_ABSENT_VS_EXPLICIT_ZERO_DISTINGUISHABLE_AT_TOKEN_USAGE: false
REASONING_ABSENT_VS_EXPLICIT_ZERO_DISTINGUISHABLE_AT_STAGE: false
PRODUCTION_STAGE_CAN_CONTAIN_EXPLICIT_ZERO_REASONING_FIELD: false
```

`parseReasoningTokens` uses `readNum` (>0 only); absent and explicit zero both collapse to numeric 0 with no reporting-presence preserved.

### Coverage contract (MIXED)

- **Cache:** `UserBillableUsageCoverage = complete` requires reporting-presence evidence (fail-closed partial when unreported).
- **Reasoning:** completion total is authoritative for charge; reasoning breakdown unreported does **not** currently block `complete` (same as pre-audit live/Published path).
- **Field sources:** must be truthful — unreported reasoning is `MISSING_AND_UNKNOWN`, not `MISSING_BUT_PROVEN_ZERO`.

```text
USER_BILLABLE_USAGE_COVERAGE_SEMANTIC: MIXED
BILLABLE_OUTPUT_TOTAL_KNOWN_WHEN_REASONING_DETAIL_MISSING: true (completion_tokens authoritative)
REASONING_BREAKDOWN_KNOWN_WHEN_DETAIL_MISSING: false
UNREPORTED_REASONING_CAN_BE_PERSISTED_AS_CONFIRMED_ZERO: true (P0 before live-grade persistence)
UNREPORTED_REASONING_COULD_APPEAR_TO_USER_AS_ZERO: false (receipt shows thinking only when > 0)
```

## Recommended next PR

**Cache + reasoning reporting-presence evidence preservation** (parser → TokenUsage → StageUsage) before production observational canary or live-grade snapshot persistence. Reasoning absence is non-critical for charge exactness today but must not be persisted as confirmed zero without upstream evidence.

## Published proof concepts (separate)

| Concept | Status |
|---------|--------|
| `PUBLISHED_ENGINE_GOLDEN_GUARD` | Direct normalizeBillableUsage / golden guards |
| `SYNTHETIC_CANDIDATE_TO_PUBLISHED_CONTRACT` | Explicit-zero cache fixture through candidate |
| `PRODUCTION_REACHABLE_CANDIDATE_TO_PUBLISHED_COMPLETE_PATH` | **false** for no-cache production turns |
