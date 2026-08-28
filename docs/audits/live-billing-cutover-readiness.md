# Live Billing Cutover Readiness Audit

**Scope:** Gemini 3.7 Flash · Gemini 3.1 Pro Preview · Claude Opus 5  
**Mode:** Read-only / shadow-only — **no cutover, no live billing switch**  
**Audit version:** `2026-08-28-readiness-v1`

---

## Executive summary

Published Pricing v2 is merged and shadow-calibrated. This audit answers:

> Can every billing state **reachable in the current product** be priced deterministically and safely under Published v2?

**Answer:** Not yet for live cutover. All three models are **B** (policy decision required) or **C** (blocked by reachable unsupported state). No model is **A** (current-product cutover ready) without additional policy work and a pure live charge engine extraction.

**Safest first cutover candidate:** `gemini-3.7-flash` — isolated legacy formula, no cache in user price, no above-threshold product path.

---

## Final report

```text
BASE_MAIN_SHA: 9b978cffd3daaffe786ee25e3c91269bc120f10e
FINAL_HEAD_SHA: (see PR)
DRAFT_PR: (see PR)

CURRENT_LIVE_CHARGE_OWNER:
  POST /api/chat → computeTurnBilling() in src/lib/pointsReasoningMargins.ts (via @/lib/points alias)

CURRENT_DEDUCTION_OWNER:
  deductPoints() in src/lib/points.ts (chat route ~5515)

CURRENT_DEDUCTION_OWNER_COUNT: 1
PUBLISHED_PRICING_LIVE_DEDUCTION_CALLS: 0

=== REACHABILITY ===
G37_CACHE_REACHABILITY: reachable (POLICY_DECISION_REQUIRED — Published v2 has no cache fields)
G31_ABOVE_200K_REACHABILITY: not_reachable_current_product
G31_CACHE_REACHABILITY: reachable (POLICY_DECISION_REQUIRED — Published cache UNVERIFIED)
OPUS_CACHE_REACHABILITY: reachable
OPUS_CACHE_TTL_MODE: 5M_ONLY

=== USAGE ===
BILLABLE_INPUT_OWNER: resolveTurnBillableInput() in src/lib/points.ts
BILLABLE_OUTPUT_OWNER: billableOpenRouterOutputTokens / primary stage output in src/app/api/chat/route.ts
BILLABLE_STAGE_OWNER: selectBillableStages() in src/lib/points.ts
BILLABLE_STAGE_SELECTION_OWNER_COUNT: 1
BILLABLE_INPUT_OWNER_COUNT: 1
BILLABLE_OUTPUT_OWNER_COUNT: 1
REASONING_DOUBLE_COUNT_POSSIBLE: false
MULTI_STAGE_USAGE_COMPLETE: unknown
FALLBACK_USAGE_COMPLETE: false
CONTINUATION_USAGE_COMPLETE: unknown

=== IDEMPOTENCY / ATOMICITY ===
IDEMPOTENCY_OWNER: clientRequestId + findTurnByRequestId() deduction_slices guard in src/app/api/chat/route.ts
DUPLICATE_REQUEST_DOUBLE_CHARGE_POSSIBLE: false
REGEN_DOUBLE_CHARGE_POSSIBLE: false
LEDGER_ATOMICITY_STATUS: DOCUMENTED (no transaction wrap — assistant save vs charge ordering risk documented)

=== FX ===
ONE_TURN_ONE_FX_SNAPSHOT: true (verified — preview/peek read-only paths; daily lock per KST dateKey)
INTRATURN_FX_DRIFT_POSSIBLE: false
ADMIN_READ_CAN_LOCK_FX: false
MIDNIGHT_BOUNDARY_PASS: true
FX_FALLBACK_READY: true (api_daily → previous_daily_snapshot → emergency)
LIVE_CHARGE_CAN_RESOLVE_FX_WITHOUT_BLOCKING_CHAT: true

=== RECEIPT ===
PUBLIC_RECEIPT_INTERNAL_LEAK_PATHS: 0
HISTORICAL_PRICING_SNAPSHOT_COMPLETE: false (messages.usage lacks pricingVersion + FX snapshot identity for immutable repricing)

=== MIGRATION DELTA @1530 FX ===
G37_A_LEGACY: (see computeMigrationDeltaRows — benchmark gemini37_competitor_a)
G37_A_PUBLISHED: 48P
G37_B_LEGACY: (see computeMigrationDeltaRows — benchmark gemini37_competitor_b)
G37_B_PUBLISHED: 80P
G31_LEGACY: (see computeMigrationDeltaRows — benchmark gemini31_competitor_a)
G31_PUBLISHED: 229P
OPUS5_LEGACY: (see computeMigrationDeltaRows — benchmark opus5_competitor_a)
OPUS5_PUBLISHED: 695P

=== CLASSIFICATION ===
G37: B
G31: B (cache reachable + UNVERIFIED; >200k NOT a product blocker)
OPUS5: B

SAFEST_FIRST_CUTOVER_MODEL: gemini-3.7-flash
WHY: Simplest reachable billing surface — uncached Published v2 base tier, no above-threshold product path, legacy formula isolated in gemini37FlashPricing.ts

PURE_LIVE_CHARGE_ENGINE_EXTRACTION_REQUIRED: true
NUMERIC_COST_OWNER_ONLY_CUTOVER_POSSIBLE: true
SINGLE_SWITCH_ROLLBACK_ARCHITECTURE_POSSIBLE: true

LOCAL_APP_TYPECHECK: pass
TEST_PASS: (see CI)
TEST_FAIL: 0 (readiness suite)
BEHIND_MAIN_BY: 0
PR_MERGEABLE: true

LIVE_DEDUCTION_BEHAVIOR_CHANGED: false
LIVE_CUTOVER_OCCURRED: false
READY_FOR_NEXT_CUTOVER_PREP_PR: true
MERGE_RECOMMENDED: false (audit only — human review required)
```

---

## Production deduction owner trace

```
POST /api/chat
  → selectBillableStages() / resolveTurnBillableInput()
  → computeTurnBilling(...)     [src/lib/pointsReasoningMargins.ts via @/lib/points]
  → shouldWaiveTurnBilling() + model waiver mins
  → cost finalized
  → computeShadowPricing(...)   [admin diagnostics ONLY — never sets cost]
  → deductPoints(user.id, cost, ...)  [guarded by alreadyBilledForRequest]
```

Repository-wide search confirms:

| Symbol | Live deduction? | Owner count |
|--------|-----------------|-------------|
| `computeTurnBilling` | Sets numeric cost | 1 (chat route primary path) |
| `deductPoints(` | Mutates ledger | 1 (chat turn; image/comic routes separate) |
| `computeShadowPricing` | Never | 0 live |
| `getPublishedPricing` | Never | 0 live |

---

## Legacy charge inventory (production)

### Gemini 3.7 Flash

| Dimension | Owner / behavior |
|-----------|------------------|
| Legacy function | `computeGemini37FlashUserChargePoints` in `gemini37FlashPricing.ts` |
| Input | Base 35P + step surcharge (25k included, +1P/10k) |
| Output | Tiered output surcharge; reasoning folded via `max(completion, content+reasoning)` |
| Cache | **Not in user price** (explicit in file header) |
| Reasoning | Included in billed output, not double-counted |
| Minimum | No OPENROUTER_MIN_TURN floor |
| Waiver | 0P on waive; no waiver minimum |
| Long context | +15P/10k above 75k input |
| FX | Legacy points formula (not USD/M Published) |
| Rule order | base → input surcharge → output tier → long-context → sum; waiver after in route |

### Gemini 3.1 Pro Preview (CI production path)

| Dimension | Owner / behavior |
|-----------|------------------|
| Legacy function | `computeReasoningPointCost` in `pointsReasoningMargins.ts` (unified reasoning) |
| Input | Standard + cacheRead + cacheWrite at 50% margin on CI catalog rates |
| Output | `completion = output + reasoning`; reasoning passed as 0 to avoid double-count |
| Cache | Billed via cache token fields in unified path |
| Minimum | No 5P floor in unified path |
| Waiver | `GEMINI_31_WAIVER_SUCCESS_MIN_COST = 65P` on meaningful waived turn |
| Published transition | Waiver is **after pricing** (applied in route, not inside Published formula) |

Legacy OpenRouter slug `google/gemini-3.1-pro-preview` uses token-floor path in `points.ts` (separate, not CI production).

### Claude Opus 5

| Dimension | Owner / behavior |
|-----------|------------------|
| Legacy function | `computeReasoningPointCost` in `pointsReasoningMargins.ts` |
| Input/cache | standardInput + cacheRead + cacheWrite at 45% margin |
| Output/reasoning | Unified — reasoning folded into completion |
| Cache | `cache_control: { type: "ephemeral" }` via `openRouterCache.ts`; 5M TTL |
| Minimum | No 5P floor |
| Waiver | 0P on waive (no model-specific waiver minimum) |

---

## Reachability vs pricing coverage

These are **separate dimensions** — never merge into one boolean.

| State | pricingCoverage | productReachability | effectiveCurrentProductBlocker |
|-------|-----------------|---------------------|--------------------------------|
| Gemini31 >200k | unsupported | not_reachable_current_product | **false** |
| Gemini31 cache | unsupported | reachable | **true** (policy) |
| Gemini37 cache | unsupported | reachable | **true** (policy) |
| Opus cache | supported | reachable | **false** |

### Gemini31 >200k

Assembly budget ceiling ~54,000 tokens:

- System: 28,000 (`DEFAULT_SYSTEM_TOKEN_BUDGET`)
- History: 10,000 (`HISTORY_TOKEN_BUDGET`)
- Memory reserve: 12,000 (`GEMINI_MEMORY_TOKEN_RESERVE`)
- Slack: 4,000

**Conclusion:** `NOT_REACHABLE_CURRENT_PRODUCT` — `GEMINI31_ABOVE_THRESHOLD_CURRENT_PRODUCT_BLOCKER: false`

Shadow invariant retained: prompt >200,000 → `billingReferenceCostStatus: unsupported_pricing_tier`

### Gemini31 cache

Production uses Gemini implicit/explicit cache infrastructure. Published v2 marks cache **UNVERIFIED**.

**Conclusion:** `REACHABLE` — requires policy decision before live cutover.

### Gemini37 cache

Gemini cache infrastructure active; legacy user price ignores cache; Published v2 has no cache rate fields.

**Conclusion:** `REACHABLE` — requires policy decision.

### Opus cache

End-to-end path verified: `cache_control` → usage cacheRead/cacheWrite → receipt normalization → Published cache buckets.

**Conclusion:** `REACHABLE`, `OPUS_CACHE_TTL_MODE: 5M_ONLY`, accounting **READY**.

---

## Current-product readiness matrix

| Dimension | G37 | G31 | Opus5 |
|-----------|-----|-----|-------|
| Base uncached usage | READY | READY | READY |
| Cache read | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED | READY |
| Cache write | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED | READY |
| Above pricing threshold | NOT_REACHABLE_CURRENT_PRODUCT | NOT_REACHABLE_CURRENT_PRODUCT | NOT_REACHABLE_CURRENT_PRODUCT |
| Reasoning accounting | READY | READY | READY |
| Multi-stage turn | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED |
| Fallback | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED |
| Continuation/recovery | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED |
| Missing usage | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED |
| Quality waiver | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED |
| Receipt | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED |
| Idempotency | READY | READY | READY |
| FX snapshot | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED | POLICY_DECISION_REQUIRED |

### Full vs current-product readiness

| Model | FULL_MODEL_PRICING_COVERAGE | CURRENT_PRODUCT_CUTOVER_READINESS |
|-------|----------------------------|-----------------------------------|
| G37 | false (no cache rates in Published v2) | blocked by cache policy + multi-stage/waiver decisions |
| G31 | false (>200k + cache unsupported in Published) | >200k not reachable; cache is reachable blocker |
| Opus5 | true for reachable states | blocked by multi-stage/waiver/receipt/FX policy decisions |

---

## Multi-stage / fallback / continuation

| Stage | User-visible answer? | Production billed? | Shadow actual includes? |
|-------|---------------------|--------------------|-----------------------|
| Primary generation | yes | yes (primary stage input; summed output) | yes |
| Adult/fallback | yes | last stage on refusal | partial when fallbackAttempted |
| Length continuation | yes | output summed; input primary-only | partial |
| HTML flash | optional | separate `computeHtmlFlashOnlyTurnBilling` | separate |
| Secondary creative | varies | not merged into premium model charge | varies |

**Asymmetry:** Input from primary stage only; output summed across non-Gemini stages. Policy decision required for Published cutover.

**USER_BILLABLE_USAGE_COMPLETE_AFTER_FALLBACK:** false

---

## Idempotency & atomicity

- **Key:** `clientRequestId` (client-generated; server fallback `srv_*`)
- **Guard:** `findTurnByRequestId()` + non-empty `deduction_slices` → `alreadyBilledForRequest`
- **Regen:** Same requestId reuses assistant row; second deduct skipped
- **Ledger:** `deductPoints` FIFO; assistant persistence and charge not in single DB transaction — documented risk, not changed in this audit

---

## FX cutover readiness

| Check | Status |
|-------|--------|
| ONE_TURN_ONE_FX_SNAPSHOT | verified |
| INTRATURN_FX_DRIFT_POSSIBLE | false |
| ADMIN_READ_CAN_LOCK_FX | false |
| Midnight KST boundary | 23:59:59 KST → day N; 00:00:01 KST → day N+1 |
| Fallback chain | api_daily → previous_daily → emergency |
| Readiness diagnostics | read-only preview/peek — no FX row creation |

---

## Receipt contract

Public users see: input/output tokens, breakdown, final points.

Must NOT expose: shadowPricing, exchangeRateSource, exchangeRateKrwPerUsd, statusWidgetExtractDiagnostics, provider economics.

**PUBLIC_RECEIPT_INTERNAL_LEAK_PATHS:** 0 (verified via `sanitizeUsageForPublicReceipt`)

**Historical immutability gap:** `messages.usage` missing `pricingVersion`, canonical model ID snapshot, FX snapshot identity for post-cutover audit.

---

## Migration delta (diagnostic — not acceptance gate)

Fixed FX base 1530 / effective 1560.6. Golden planned Published v2:

| Fixture | Input/Output tokens | Planned Published |
|---------|---------------------|-------------------|
| G37 A | 24952 / 2367 | 48P |
| G37 B | 42195 / 3862 | 80P |
| G31 | 40689 / 4307 | 229P |
| Opus5 | 63749 / 3629 | 695P |

Legacy ≠ Published by design (pricing policy changed). See `computeMigrationDeltaRows()` for exact legacy values and percent deltas.

---

## Future live charge engine contract

Do **not** wire live billing to `computeShadowPricing()` directly.

Proposed owner:

```ts
computePublishedUserChargeWithSnapshot({
  modelId,
  normalizedBillableUsage,
  fxSnapshot,
  promoPolicy,
})
```

Returns only: eligibility, pricingVersion, billingReferenceCost, standardUserCharge, finalPoints, normalized usage, FX snapshot.  
Excludes: providerListCost, actualProviderCost, reserve, margin diagnostics.

**Cutover ideal:** swap numeric cost owner only — same `deductPoints()`, same ledger/FIFO/receipt persistence.

---

## Cutover blockers (explicit)

1. Published pricing is shadow-only — no live numeric owner swap implemented
2. Gemini31 Published v2 cache semantics UNVERIFIED while product cache is reachable
3. Gemini37 Published v2 has no cache rate fields while Gemini cache infrastructure is active
4. Multi-stage / fallback / continuation turns bill primary stage input only — policy decision required
5. Quality waiver minimums (e.g. Gemini31 65P) interact with Published charge — cutover policy undecided
6. Historical receipt lacks pricingVersion + FX snapshot identity for immutable repricing audit
7. Pure live charge engine not extracted — computeShadowPricing mixes economics with user charge

---

## Rollback & canary (documentation only — not implemented)

**Rollback:** Single env switch back to legacy `computeTurnBilling` numeric owner without DB migration rollback.

**Recommended canary sequence:**

```
OFF → internal/admin canary → tiny user allowlist → per-model rollout → 100%
```

Compare: planned published charge vs actual deducted charge vs settled provider cost vs receipt snapshot — without double charging.

---

## Hard gates for this audit PR

| Gate | Value |
|------|-------|
| LIVE_DEDUCTION_BEHAVIOR_CHANGED | false |
| POINTS_TS_PRICING_CHANGED | false |
| DEDUCT_POINTS_CHANGED | false |
| PROVIDER_ROUTING_CHANGED | false |
| CACHE_BEHAVIOR_CHANGED | false |
| PROMPT_BUDGET_CHANGED | false |
| PUBLISHED_PRICING_LIVE_DEDUCTION_CALLS | 0 |
| CURRENT_DEDUCTION_OWNER_COUNT | 1 |
| PUBLIC_RECEIPT_INTERNAL_LEAK_PATHS | 0 |
| ONE_TURN_ONE_FX_SNAPSHOT | verified |
| CURRENT_PRODUCT_READINESS_MATRIX | complete |
| LOCAL_APP_TYPECHECK | pass |

---

## Code references

- Read-only diagnostics: `src/lib/liveBillingCutoverReadiness.ts`
- Tests: `src/lib/liveBillingCutoverReadiness.test.ts`
- Shadow tier/cache invariants: `src/lib/shadowPricing.tierCache.test.ts`
