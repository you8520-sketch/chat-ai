# Billing Turn Usage + Waiver Contract Audit

**Audit date:** 2026-08-29 (route-composition correction + doc-consistency micro-pass)
**Scope:** Characterization + contract fit only — **no production billing changes**
**Base main SHA:** `0f4f8c3df34488f551c49970101186dda3abc4c1`
**PR branch:** `cursor/billing-turn-usage-waiver-audit-d7cd`

---

## Executive summary

This audit maps the **live chat turn billing path** from OpenRouter stage usage through waiver/minimum logic to settlement, and compares it to the **Published user-charge engine** contract (PR #726 / #719).

**Route-composition correction (this pass):** The initial audit draft incorrectly concluded that model-specific waiver minimum floors could revive non-zero charges on reachable waiver paths. Reproduction through the **actual composed route path** (`shouldWaiveTurnBilling` → model minimum resolver) proves that **every reachable live waiver ends at 0P**. The prior conclusion was an **audit bug** caused by low-level helper isolation tests that manually injected unreachable `(text, reason)` pairs.

| Finding | Status |
|---------|--------|
| Primary input/cache + aggregate output/reasoning mixing | **INTENTIONAL** (documented) |
| Canonical `resolveTurnBillableUsage()` owner | **MISSING** |
| Live `UserBillableUsageCoverage` owner | **MISSING** |
| `ActualTurnCostCoverage` | **Separate** (shadow only) |
| Settlement recalculates usage/waiver | **NO** |
| Reachable live waiver semantic | **Full waiver to 0P** |
| Model-specific waiver minimum floors via route | **UNREACHABLE / DEAD WORKAROUND** |
| Published `waiver` adjustment covers reachable live waiver | **YES** |
| `minimum_charge_after_waiver` required for live parity | **NO** |

---

## 1. Live billing path (route.ts)

### Stage collection

| Source | Function | Stages appended |
|--------|----------|-----------------|
| Primary adult chat | `openRouterAdult.ts` | Main completion |
| Under-length recovery | `serverUnderLengthRecovery.ts` | Recovery attempt(s) |
| Narrative continuation | `narrativeLengthContinuation.ts` | Continuation attempt(s) |

All stages land in `stages: OpenRouterStageUsage[]` before billing.

### Aggregation (intentional mixing)

```text
primary input/cache     ← selectBillableStages(stages) — first primary-eligible stage only
aggregate output        ← sumOpenRouterStageCompletionTokens(stages)
aggregate reasoning     ← sumOpenRouterStageReasoningTokens(stages)
aggregate upstream      ← sumOpenRouterStageUpstreamCost(stages)
```

**Classification:** `PRIMARY_AGGREGATE_BUCKET_MIXING: INTENTIONAL`

Primary input/cache tokens come from the **first billable primary stage**; output/reasoning/upstream are **summed across all stages** (including recovery/continuation). This is the current production contract.

### Billing computation

`computeTurnBilling()` (via `@/lib/points` alias chain) receives the mixed buckets and returns `{ cost, breakdown, ... }`.

### Waiver gate

Production composition in `route.ts` (lines ~4327–4376):

```text
billingWaiverReason = shouldWaiveTurnBilling(savedText, {
  forcedAbort,
  degenerationAborted,
  generationFailure,
  usageUnavailable,
  adultMode: true,
  targetResponseChars,
})
cost = billingWaiverReason ? 0 : billing.total
if (billingWaiverReason && !isMockApiMode()) {
  waiverMin = model-specific resolve*WaiverMinimumCharge(
    savedText,
    billingWaiverReason,
    { degenerationAborted, targetResponseChars }
  )
  if (waiverMin > 0) cost = waiverMin
}
```

The minimum resolver runs **inside the waiver branch** (same reason and text), not as an `else` fallback. Route-composition tests prove every reachable `(text, reason)` pair yields `waiverMin = 0`, so final charge stays **0P**.

### Widget add-on (auxiliary)

After shadow pricing, `statusWidgetApiCostChargePoints` may add integer points. This is **not** a waiver adjustment.

**Classification:** `AUXILIARY_CHARGE_COMPONENT` — separate from waiver semantics.

### Settlement

`settleChatTurnBillingExactlyOnce()` receives the final integer `cost` only. It does **not** recalculate usage, waiver, or minimum floors.

---

## 2. Owner map (reconfirmed)

| Role | File | Function | Production callers |
|------|------|----------|-------------------|
| **WAIVER_REASON_OWNER** | `src/lib/points.ts` | `shouldWaiveTurnBilling()` | 1 (`route.ts`) |
| **FORCED_ABORT_REASON_OWNER** | `src/lib/points.ts` | `resolveForcedAbortWaiverReason()` (private) | 0 direct (via `shouldWaiveTurnBilling`) |
| **MINIMUM_CHARGE_COMMON_OWNER** | `src/lib/points.ts` | `resolveModelWaiverMinimumCharge()` (private) | 0 direct (via model wrappers) |
| **MINIMUM_CHARGE_MODEL_WRAPPERS** | `src/lib/points.ts` | 7 public `resolve*WaiverMinimumCharge()` | 1 each (`route.ts` only) |
| **MINIMUM_CHARGE_CONSTANT_OWNER** | `src/lib/points.ts` | `*_WAIVER_SUCCESS_MIN_COST` constants | Used only by minimum resolver |
| **FINAL_WAIVER_COST_OWNER** | `src/app/api/chat/route.ts` | inline waiver gate + optional minimum floor (lines ~4335–4376) | 1 |

### `@/lib/points` alias chain (verified)

```text
@/lib/points
  → pointsReasoningMargins.ts (re-exports)
    → pointsMuse60.ts (re-exports)
      → points.ts (runtime owner)
```

---

## 3. Route composition — waiver + minimum (corrected)

### `BillingWaiverReason` enum (current production)

```text
over_reasoning | garbage_output | forced_abort | degeneration | generation_failure
```

There is **no** `usage_unavailable` enum value. `usageUnavailable` is a **route input/trigger** that maps to returned reason `generation_failure`.

### Input condition → returned reason (`shouldWaiveTurnBilling`)

Evaluated in order; first match wins:

| Input condition | Returned `BillingWaiverReason` |
|-----------------|--------------------------------|
| `degenerationAborted === true` | `degeneration` |
| `generationFailure` set (e.g. `under_length`, `provider_error`) | `generation_failure` |
| `usageUnavailable === true` | `generation_failure` |
| `unknownError \|\| forcedAbort` + degenerate text | `garbage_output` |
| `unknownError \|\| forcedAbort` + catastrophically short text | `forced_abort` |
| `unknownError \|\| forcedAbort` + healthy text | `null` (no waiver) |
| catastrophically short text (no prior match) | `generation_failure` |
| degenerate text (no prior match) | `garbage_output` |
| otherwise | `null` |

`over_reasoning` exists in the type and minimum resolver but is **never returned** by `shouldWaiveTurnBilling()`.

### Composed path

```text
reason = shouldWaiveTurnBilling(text, flags, targetResponseChars)
cost = reason ? 0 : billing.total
if (reason && !isMockApiMode()) {
  waiverMin = model-specific resolve*WaiverMinimumCharge(text, reason, targetResponseChars)
  if (waiverMin > 0) cost = waiverMin
}
```

Sequence: waiver reason → zero base charge → optional minimum resolver on **same** reason/text → final charge. All reachable pairs return `waiverMin = 0`, so final charge remains **0P**.

**Critical invariant (proven by tests):**

When `shouldWaiveTurnBilling` returns `forced_abort`, `isCatastrophicallyShortResponse(text, targetResponseChars)` is **always true**. The minimum resolver returns **0** for catastrophically short text regardless of reason. All other reachable waiver reasons (`degeneration`, `generation_failure`, `garbage_output`) explicitly return minimum **0**.

### Reachability matrix (route composition fixtures A–H)

| Fixture | Input triggers | Returned reason | Minimum resolver called | Waiver minimum | Final semantic |
|---------|----------------|-----------------|-------------------------|----------------|----------------|
| A. Forced abort + healthy long output | `forcedAbort` | `null` | No | — | **NORMAL FULL BILLING** |
| B. Forced abort + catastrophically short | `forcedAbort` | `forced_abort` | Yes | **0** | **0P waiver** |
| C. Forced abort + degenerate output | `forcedAbort` | `garbage_output` | Yes | **0** | **0P waiver** |
| D. degenerationAborted | `degenerationAborted` | `degeneration` | Yes | **0** | **0P waiver** |
| E. generationFailure | `generationFailure` | `generation_failure` | Yes | **0** | **0P waiver** |
| F. usageUnavailable | `usageUnavailable` | `generation_failure` | Yes | **0** | **0P waiver** |
| G. Short without forcedAbort | (none) | `generation_failure` | Yes | **0** | **0P waiver** |
| H. Garbage without forcedAbort | (none) | `garbage_output` | Yes | **0** | **0P waiver** |

### Hard reachability question

```text
CAN_ROUTE_WAIVER_MINIMUM_EVER_BE_GREATER_THAN_ZERO: false
EXACT_REACHABLE_FIXTURE_IF_TRUE: (none)
MODEL_SPECIFIC_WAIVER_MINIMUM_ROUTE_PATH: UNREACHABLE / DEAD WORKAROUND
```

The low-level helper `resolveDeepSeekWaiverMinimumCharge(meaningfulProse, "forced_abort")` returns a non-zero floor, but **no production caller can produce that `(text, reason)` pair** — `forced_abort` requires catastrophically short text, which forces minimum 0.

### Reachable waiver reasons (all models)

Returned `BillingWaiverReason` values producible by `shouldWaiveTurnBilling()` through route composition:

```text
forced_abort
degeneration
generation_failure
garbage_output
```

Trigger note: `usageUnavailable` input → returned `generation_failure` (not a separate enum value).

For every model (DeepSeek, Qwen, GLM, Kimi, Muse, Gemini 3.6, Gemini 3.1) and every reachable reason above:

| RETURNED_REASON | MINIMUM_RESULT |
|-----------------|----------------|
| `forced_abort` | 0 |
| `degeneration` | 0 |
| `generation_failure` | 0 |
| `garbage_output` | 0 |

(`over_reasoning` is handled inside the minimum resolver but **never returned** by `shouldWaiveTurnBilling()`.)

### Waiver semantic (corrected)

```text
REACHABLE_WAIVER_SEMANTIC:
  full waiver to 0P

FORCED_ABORT_WITH_HEALTHY_OUTPUT:
  not a waiver → normal full billing (shouldWaive returns null)

MODEL_SPECIFIC_MINIMUM_FLOORS:
  present in code but unreachable from current route composition
```

**Previous audit conclusion (`WAIVER_SEMANTIC = D`, nonzero minimum after waiver) is INCORRECT.**

```text
ROOT_CAUSE:
  HELPER_ISOLATION_TEST_CREATED_UNREACHABLE_STATE

PRODUCTION_BILLING_BUG:
  NOT PROVEN

AUDIT_BUG:
  CONFIRMED
```

---

## 4. Minimum constants (verified from production)

Resolved via `@/lib/points` → `points.ts`:

| Constant | Value |
|----------|-------|
| DEEPSEEK_WAIVER_MIN | **20** |
| QWEN_WAIVER_MIN | **50** |
| GLM_WAIVER_MIN | **50** |
| KIMI_WAIVER_MIN | **65** |
| MUSE_WAIVER_MIN | **50** |
| GEMINI36_WAIVER_MIN | **50** |
| GEMINI31_WAIVER_MIN | **65** |

These constants apply only when `resolveModelWaiverMinimumCharge` is called with **non-catastrophically-short text** and a reason that does not force zero (e.g. manual `over_reasoning` or isolated helper tests). They are **not reachable** through route composition.

### Previous 343 / 357 / 364 values

```text
PREVIOUS_343_357_364_VALUES_EXPLAINED_AS: REPORTING_ERROR
```

No such values exist in `points.ts` or the waiver minimum resolver. They were erroneous figures in the initial audit draft, not a different billing metric or runtime override.

---

## 5. Caller audit — waiver minimum resolvers

| Resolver | Callers | Classification |
|----------|---------|----------------|
| `resolveDeepSeekWaiverMinimumCharge` | `route.ts`, tests | PRODUCTION (route) + TEST |
| `resolveQwenWaiverMinimumCharge` | `route.ts`, tests | PRODUCTION (route) + TEST |
| `resolveGlmWaiverMinimumCharge` | `route.ts`, tests | PRODUCTION (route) + TEST |
| `resolveKimiWaiverMinimumCharge` | `route.ts`, tests | PRODUCTION (route) + TEST |
| `resolveMuseWaiverMinimumCharge` | `route.ts`, tests | PRODUCTION (route) + TEST |
| `resolveGemini36WaiverMinimumCharge` | `route.ts`, tests | PRODUCTION (route) + TEST |
| `resolveGemini31WaiverMinimumCharge` | `route.ts`, tests | PRODUCTION (route) + TEST |

```text
OTHER_PRODUCTION_CALLER_CAN_PASS_NONZERO_REACHABLE_MINIMUM: false
```

The sole production caller is `route.ts`, and route composition never passes a reachable `(text, reason)` pair that yields a non-zero minimum.

---

## 6. Published adjustment fit-gap (re-evaluated)

Current Published adjustment kinds: `none`, `waiver`, `self_funded_promo`.

```text
PUBLISHED_WAIVER_CONTRACT_COVERS_REACHABLE_LIVE_WAIVER: true
MINIMUM_CHARGE_AFTER_WAIVER_REQUIRED_FOR_CURRENT_LIVE_PARITY: false
```

All reachable live waivers are full 0P waivers. The existing `waiver` adjustment kind is sufficient. **`minimum_charge_after_waiver` is not a current-live semantic gap** — it would only model unreachable legacy minimum-resolver behavior.

---

## 7. Dead system classification (do not delete in this PR)

| Component | Classification |
|-----------|----------------|
| `resolveModelWaiverMinimumCharge` (private) | SAFE_TO_DELETE_CANDIDATE |
| 7 public model minimum wrappers | SAFE_TO_DELETE_CANDIDATE |
| 7 minimum constants | SAFE_TO_DELETE_CANDIDATE |
| Route waiver-minimum if chain | SAFE_TO_DELETE_CANDIDATE |

Before future deletion, verify: writer/caller, reader/import, historical receipt dependency, rollback/compatibility.

---

## 8. Recommended next PR (revised)

Do **not** bundle waiver minimum cleanup with canonical usage extraction.

```text
PR A (recommended first):
  Canonical resolveTurnBillableUsage()
  + UserBillableUsageCoverage canary
  One responsibility: usage bucket ownership

PR B (separate, after PR A):
  Waiver / dead minimum cleanup OR charge-component policy
  One responsibility: remove unreachable minimum chain OR document retention
```

---

## 9. Preserved valid findings (unchanged)

- PRIMARY_AGGREGATE_BUCKET_MIXING: **INTENTIONAL**
- No dedicated live `UserBillableUsageCoverage` owner
- `ActualTurnCostCoverage` is separate (shadow diagnostics)
- Settlement does not recalculate usage/waiver
- `StageUsage` does not represent every auxiliary provider call (HTML flash, status widget, memory summary)
- Route / points / PUBLISHED / settlement **unchanged in this PR**

---

## 10. Scope guard

| Guard | Value |
|-------|-------|
| PRODUCTION_CODE_CHANGED | **false** |
| ROUTE_CHANGED | **false** |
| POINTS_PRICING_CHANGED | **false** |
| PUBLISHED_ENGINE_CHANGED | **false** |
| SETTLEMENT_CHANGED | **false** |
| DB_SCHEMA_CHANGED | **false** |
| LIVE_USER_DEDUCTION_CHANGED | **false** |
| PROMPT_FILES_CHANGED | **0** |

Changes limited to: this audit doc + `src/lib/turnBillingUsageAudit.test.ts`.

---

## 11. Characterization tests

| Section | Purpose |
|---------|---------|
| `LOW_LEVEL_HELPER_CHARACTERIZATION` | Isolated resolver behavior including unreachable manual pairs (e.g. healthy text + manual `forced_abort`) — labeled **NOT ROUTE REACHABLE**; **not** route evidence |
| `CURRENT_ROUTE_COMPOSITION_CHARACTERIZATION` | Full composed path mirroring `route.ts` — **authoritative for live semantics** |

Run: `node --conditions=react-server --import tsx --test src/lib/turnBillingUsageAudit.test.ts`

---

## 12. Merge recommendation

```text
MERGE_RECOMMENDED: false
```

Audit-only PR. Human review required before merge.
