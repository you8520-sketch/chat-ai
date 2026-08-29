# Billing Turn Usage + Waiver Contract Audit

**Date:** 2026-08-29  
**Base main SHA:** `0f4f8c3df34488f551c49970101186dda3abc4c1` (#726 merged)  
**Scope:** Read-only production path audit — no billing behavior change

---

## Executive summary

Production chat billing is orchestrated in `src/app/api/chat/route.ts` with pricing math in `@/lib/points` (wrapper chain → `points.ts`) and exactly-once settlement in `settleChatTurnBillingExactlyOnce()`. There is **no single canonical `resolveTurnBillableUsage()` owner** today; usage is assembled inline in the route from `StageUsage[]` via a **split responsibility**:

- **Input + cache:** `selectBillableStages()` → primary (or fallback-last) stage
- **Output + reasoning + upstream USD:** `sumOpenRouterStage*()` over **all** non-Gemini stages

This split is **documented and intentional** for OpenRouter multi-stage turns (primary + recovery/continuation), but creates a structural pattern that must be preserved or explicitly redesigned before Published live cutover.

Waiver semantics are **D — historically accumulated mixed behavior**: base waiver zeros charge, then seven model families may apply a **minimum charge floor** on certain waiver reasons when meaningful output was delivered.

Published engine `#726` adjustment contract (`none | waiver | self_funded_promo`) is **partial** — it does not model legacy minimum-charge-after-waiver.

---

## Owner map

| Responsibility | Owner | Count | Classification |
|----------------|-------|-------|----------------|
| CHAT_PROVIDER_CALL_OWNER | `route.ts` stream/postprocess orchestration | 1 | CANONICAL (orchestration) |
| STAGE_USAGE_WRITER_OWNER(S) | `openRouterAdult.ts`, `serverUnderLengthRecovery.ts`, `narrativeLengthContinuation.ts` → `route.ts` push | 3 writers + 1 collector | SPLIT |
| USER_BILLABLE_STAGE_SELECTION_OWNER | `selectBillableStages()` in `points.ts` | 1 | CANONICAL (partial — input/cache only) |
| USER_BILLABLE_INPUT_OWNER | `route.ts` → `resolveTurnBillableInput(primaryStage.input, promptAudit)` | 1 | SPLIT (route assembly) |
| USER_BILLABLE_OUTPUT_OWNER | `route.ts` → `sumOpenRouterStageOutputTokens` + `billableOpenRouterOutputTokens` | 1 | SPLIT (aggregate) |
| USER_BILLABLE_REASONING_OWNER | `route.ts` → `sumOpenRouterStageReasoningTokens` | 1 | SPLIT (aggregate) |
| USER_BILLABLE_CACHE_OWNER | `route.ts` → `primaryStage.cache*` | 1 | SPLIT (primary only) |
| USER_USAGE_COVERAGE_OWNER | **None explicit** — implicit `complete` when billing runs; `generationFailure` skips billing | 0 dedicated | LEGACY gap |
| PROVIDER_ACTUAL_COST_AGGREGATION_OWNER | `sumOpenRouterStageUpstreamUsd` + `hiddenFallbackOverheadCostUsd` (admin) | 1 | SPLIT |
| ACTUAL_COST_COVERAGE_OWNER | `resolveActualTurnCostCoverage()` in `shadowPricing.ts` | 1 | CANONICAL (shadow only) |
| WAIVER_REASON_OWNER | `shouldWaiveTurnBilling()` in `points.ts` | 1 | CANONICAL |
| WAIVER_MINIMUM_CHARGE_OWNER | `resolveModelWaiverMinimumCharge()` + 7 public resolvers | 1 impl, 7 wrappers | CANONICAL |
| WAIVER_MODEL_ROUTING_OWNER | `route.ts` model `if/else if` chain (lines ~4340–4375) | 1 | LEGACY inline |
| FINAL_PRE_SETTLEMENT_CHARGE_OWNER | `route.ts` (`cost` variable, incl. widget add-on) | 1 | CANONICAL |
| SETTLEMENT_OWNER | `settleChatTurnBillingExactlyOnce()` | 1 | CANONICAL (#719 closed) |
| RECEIPT_USAGE_OWNER | `route.ts` `usageRecord` assembly | 1 | CANONICAL |
| PUBLISHED_USER_CHARGE_OWNER | `computePublishedUserChargeWithSnapshot()` (#726, shadow only) | 1 | CANONICAL (not live) |

---

## Turn provider call inventory

| CALL_ID | TRIGGER | PROVIDER | USER_VISIBLE | DELIVERED | STAGE_WRITTEN | INPUT | CACHE | OUTPUT | REASONING | SETTLED_COST | LIVE_BILL | SHADOW | ECONOMICS |
|---------|---------|----------|--------------|-----------|---------------|-------|-------|--------|-----------|--------------|-----------|--------|-----------|
| P1_primary_generation | Main RP stream | OpenRouter/CI/Gemini | yes | yes | yes → `stages[0]` | yes | conditional | yes | conditional | upstreamUsd | yes | partial | yes |
| P2_adult_refusal_fallback | Primary refusal/error | OpenRouter general | yes | yes | yes (replaces primary in `stages`) | yes | conditional | yes | conditional | fallback upstream | yes | partial | overhead in admin meta |
| P3_under_length_recovery | Primary under-length | Same model | partial append | yes | yes `recoveryStage` | yes | conditional | yes | conditional | per-stage | yes (aggregated output) | partial | yes |
| P4_narrative_continuation | Tier min not met | Same model | yes append | yes | yes push | yes | conditional | yes | conditional | per-stage | yes (agg output) | partial | yes |
| P5_html_visual_flash | HTML card policy | Gemini Flash | yes (HTML) | yes | **no StageUsage** — `flashHtmlUsage` | yes | conditional | yes | no | upstream | yes (htmlFlash path) | unknown | yes |
| P6_status_widget_extract | Status widget active | Separate model call | no (widget JSON) | no | **no StageUsage** | yes | unknown | yes | unknown | widget usage | **partial** (add-on points) | **no** | admin receipt |
| P7_memory_summary | `prepareNonBlockingSummaryForMainRp` | Background | no | no | **no** | n/a | n/a | n/a | n/a | separate | **no** | **no** | **no** |
| P8_stealth_fallback | `selectBillableStages({stealthFallback})` | — | — | — | **UNREACHABLE** in route | — | — | — | — | — | — | — | — |

**TURN_PROVIDER_CALL_TYPE_COUNT:** 7 reachable (+ 1 dead API)  
**CALLS_NOT_REPRESENTED_IN_STAGE_USAGE:** P5 (flashHtmlUsage), P6 (widget), P7 (memory)  
**HIDDEN_PROVIDER_COST_PATHS:** `hiddenFallbackOverheadCostUsd` (failed primary before fallback — admin adultRouting meta only)

---

## Stage writers

**STAGE_WRITER_COUNT:** 3 producers + 1 collector (`route.ts`)

| Writer | Location | Represents | Failed attempt stage? |
|--------|----------|------------|----------------------|
| Primary stream finalize | `openRouterAdult.ts:2265+` | Main generation | Yes if streamed before failure |
| Under-length recovery | `serverUnderLengthRecovery.ts:136+` | Recovery pass | Only on success |
| Length continuation | `narrativeLengthContinuation.ts:133+` | Continuation | Only on success |
| Route collector | `route.ts:3241,3243,3722` | `stages.push` | Generation failure → billing skipped before settlement |

---

## selectBillableStages

**SELECT_BILLABLE_STAGES_PURPOSE:** mixed — selects **one stage** for input/cache/waiver context; does **not** own output aggregation  
**SELECT_BILLABLE_STAGES_CALLERS:** `route.ts:4015` (production), tests  
**SELECT_BILLABLE_STAGES_IS_CANONICAL_USER_USAGE_OWNER:** **partial** (input/cache/failure detection only)

| Scenario | Behavior |
|----------|----------|
| Normal single-stage | `[stages[0]]` |
| Multi-stage same provider | `[stages[0]]` for input; output summed separately |
| Refusal fallback delivered | `[stages[last]]` — fallback stage |
| Stealth fallback | **Not invoked** from route (dead option) |
| Continuation/recovery | Primary selected for input; continuation/recovery in `stages` for output sum |

---

## Primary vs aggregate mixing

**PRIMARY_AGGREGATE_BUCKET_MIXING:** **INTENTIONAL**

Evidence (`route.ts:4133–4224`):
- `totalInput` ← `primaryStage.input` capped by `resolveTurnBillableInput`
- `cacheRead/Write` ← `primaryStage` only
- `summedApiOutput/Reasoning/Upstream` ← **all** non-Gemini stages
- `reasoningTokens: summedApiReasoning` passed to `computeTurnBilling`

Characterization: `src/lib/turnBillingUsageAudit.test.ts`

---

## Coverage separation

| Dimension | Owner | Notes |
|-----------|-------|-------|
| UserBillableUsageCoverage | **No explicit owner** — billing skipped on `generationFailure`; otherwise implicit complete | Not passed to shadow Published engine on live path |
| ActualTurnCostCoverage | `resolveActualTurnCostCoverage()` | Shadow/admin only; marks partial on multi-stage, fallback, recovery, continuation |

**THEY_ARE_CURRENTLY_COUPLED:** **partial** — route does not set UserBillableUsageCoverage; shadow uses separate ActualTurnCostCoverage heuristic

---

## Scenario matrix (reachable)

| ID | Scenario | Provider calls | Live user usage | Provider cost | Waiver | Settlement |
|----|----------|----------------|-----------------|---------------|--------|------------|
| S1 | Normal primary success | P1 | primary input + agg output | primary upstream | null → full | yes |
| S2 | Refusal → fallback | P1+P2 | fallback input + output (single stage in array) | fallback + hidden primary overhead (admin) | null if delivered | yes |
| S3 | Primary failure → recovery | P1+P3 | primary input + agg output | sum upstream | null | yes |
| S4 | Primary + continuation | P1+P4 | primary input + agg output | sum upstream | null | yes |
| S5 | Multiple continuations | **Not reachable** — `lengthContinuationPasses` max 1 | — | — | — | — |
| S6 | Continuation fails after primary | Primary delivered; no cont stage pushed | primary only | primary only | null | yes |
| S7 | Generation failure | P1 maybe | **billing skipped** (4090 return) | provider may have cost | n/a | **no settlement** |
| S8 | Forced abort | P1 | computed then waived | upstream | forced_abort → 0 or min | yes (0 or min) |
| S9 | Degeneration abort | P1 | waived | upstream | degeneration → 0 | yes (0) |
| S10 | Incomplete usage | P1 | waived | unknown | generation_failure | yes (0) |
| S11 | Regeneration | Same as S1–S4 | fresh `stages[]`, new `clientRequestId` | same rules | same | independent settlement |
| S12 | HTML flash auxiliary | P5 (+ maybe P1) | flashHtmlUsage path | flash upstream | generationFailure rules | yes |
| S13 | Cross-provider fallback | **Not reachable** — adult fallback same general OR path | — | — | — | — |

---

## Waiver

**WAIVER_REASON_OWNER:** `shouldWaiveTurnBilling()` — priority: degeneration → generationFailure → usageUnavailable → forcedAbort/unknown → catastrophically short → garbage

**WAIVER_MINIMUM_CHARGE_OWNER_COUNT:** 1 (`resolveModelWaiverMinimumCharge`) + 7 model wrappers (same algorithm, different constants)

**WAIVER_MODEL_ROUTING_OWNER:** `route.ts` inline if/else if

**WAIVER_SEMANTIC:** **D** — mixed historical behavior:
- **A** for degeneration/generation_failure/garbage/over_reasoning → always 0 (minimum resolver returns 0)
- **B** for forced_abort with **catastrophically short** delivered text → waive to 0; minimum charge applies only when waiver reason is `forced_abort` AND visible text ≥ 80 chars (characterization in tests)
- **Important:** `forcedAbort: true` with long healthy text → **no waiver** (`shouldWaiveTurnBilling` returns null) — full normal billing applies
- Models without resolver (Opus, G37 Flash, Terra, …) → stay 0 when waived

**PUBLISHED_ADJUSTMENT_CONTRACT_COVERS_CURRENT_LIVE_POLICY:** **partial**

Missing semantics for future Published live:
- `minimum_charge_after_waiver` (non-zero floor)
- `partial_waiver` / delivered-output recovery charge
- Model-specific minimum constants as policy snapshot fields
- Widget add-on billing (separate API call)

---

## Settlement boundary (#719)

**SETTLEMENT_RECALCULATES_USAGE:** false — receives `requestedPoints: cost` only  
**SETTLEMENT_RECALCULATES_WAIVER:** false  
Retry/replay returns canonical settled result from `chat_billing_settlements` UNIQUE key.

---

## Receipt

**RECEIPT_USAGE_SEMANTIC:** mixed
- `usage.input` / `usage.output` → billable values passed to `computeTurnBilling`
- `apiInputTokens` → primary stage API reported (can differ from billable input)
- `apiOutputTokens` → **aggregated** across stages
- `stages` receipt array → billable stages with **full turn cost duplicated** on each row (`stageCosts`)

**RECEIPT_MATCHES_USER_BILLABLE_USAGE:** **partial** — API token fields show provider totals; billable fields show charge basis

---

## Shadow / Published

Shadow receives route-assembled tokens (`route.ts:4925–4934`) — primary cache + aggregated output.  
Multi-stage → `actualTurnCostCoverage: partial` but Published charge may still compute if exact catalog + complete usage normalized.

Widget cost added **after** shadow attach — shadow does not include widget.

---

## Three sums (must differ intentionally)

| Sum | What it includes today |
|-----|------------------------|
| USER_BILLABLE_USAGE_SUM | primary input (capped) + aggregated OR output + primary cache + waiver/min floor |
| PROVIDER_ACTUAL_COST_SUM | sum upstream USD all stages + hidden fallback overhead (admin) + widget (separate) |
| USER_VISIBLE_RECEIPT_USAGE_SUM | `usage.input/output` + optional api* breakdown fields |

---

## Cleanup classification

| Item | Class |
|------|-------|
| `selectBillableStages({ stealthFallback })` branch | **FOLLOW_UP** — unreachable from route |
| Duplicate `chargePoints` in calibration fixtures | **KEEP** — not billing path |
| Inline waiver model routing in route | **FOLLOW_UP** — delegate to policy owner |
| `stageCosts` full cost on each stage row | **FOLLOW_UP** — receipt semantics confusing |
| No `UserBillableUsageCoverage` on live path | **FOLLOW_UP** — needed before Published persistence |

---

## Recommended next PR

**NAME:** `Billing canonical TurnBillableUsage aggregator (design + canary)`  

**CANONICAL_OWNER_TO_CREATE_OR_CHANGE:**
- New `resolveTurnBillableUsage(stages, opts)` — single owner for NormalizedBillableUsage + UserBillableUsageCoverage
- New `resolveTurnBillingAdjustment(waiver, model, text)` — encapsulate waiver + minimum floor

**OBSOLETE_OWNER_TO_REMOVE_OR_DELEGATE:**
- Route inline usage assembly → delegate to aggregator
- Route inline waiver model chain → delegate to adjustment owner

**CHANGE_BUDGET:** Separate PR after product sign-off on minimum-charge policy snapshot semantics

---

## Findings

### P0
- None requiring immediate production patch (audit-only phase)

### P1
- **PRIMARY_AGGREGATE_BUCKET_MIXING** — INTENTIONAL but must be explicit in future aggregator (ROOT_CAUSE_UNCONFIRMED as bug; INTENTIONAL_POLICY)
- **Published adjustment gap** — minimum charge not representable (BUG_REPRODUCED_NOT_FIXED — design gap)
- **No UserBillableUsageCoverage owner on live path** (ROOT_CAUSE_UNCONFIRMED)

### P2
- Widget billing after shadow attach (FOLLOW_UP)
- Receipt `stageCosts` duplicates full cost per stage (FOLLOW_UP)
- `stealthFallback` dead branch (SAFE_TO_DELETE candidate after confirmation)
