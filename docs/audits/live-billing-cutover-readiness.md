# Live Billing Cutover Readiness Audit

**Scope:** Gemini 3.7 Flash · Gemini 3.1 Pro Preview · Claude Opus 5  
**Mode:** Read-only / shadow-only — **no cutover, no live billing switch**  
**Audit version:** `2026-08-28-readiness-v2`

---

## Executive summary

Published Pricing v2 is merged and shadow-calibrated. This audit answers whether every billing state **reachable in the current product** can be priced deterministically and safely under Published v2.

**Answer:** Not yet for live cutover. Evidence is conservative: unknown reachability is not converted to “not reachable.” Reachable unsupported states classify as **C** (blocked); insufficient evidence classifies as **D**.

| Model | Classification | Rationale |
|-------|---------------|-----------|
| Gemini 3.7 Flash | **D** | G37 cache reachability UNKNOWN; multi-stage/waiver/receipt policy gaps |
| Gemini 3.1 Pro | **D** | >200k and cache reachability UNKNOWN |
| Claude Opus 5 | **B** | Cache verified end-to-end; policy decisions remain for multi-stage/waiver/receipt/FX |

**Safest first cutover (recomputed):** `claude-opus-5` — only model at class B; deterministic score among tied candidates.

---

## Final report

```text
BASE_MAIN_SHA: 9b978cffd3daaffe786ee25e3c91269bc120f10e
AUDIT_VERSION: 2026-08-28-readiness-v2

CURRENT_LIVE_CHARGE_OWNER:
  POST /api/chat → computeTurnBilling() → src/lib/points.ts (canonical definition)

CHAT_ROUTE_COMPUTE_TURN_BILLING_OWNER:
  @/lib/points → src/lib/pointsReasoningMargins.ts (tsconfig alias)

OTHER_COMPUTE_TURN_BILLING_DEFINITIONS:
  src/lib/pointsReasoningMargins.ts
  src/lib/pointsMuse60.ts

OTHER_DEFINITION_REACHABLE_FROM_CHAT_ROUTE: true
  (pointsReasoningMargins delegates to pointsMuse60 → points.ts)

CURRENT_DEDUCTION_OWNER:
  deductPoints() in src/lib/points.ts

CURRENT_DEDUCTION_OWNER_COUNT: 1 (one live deductPoints call in chat route)
PUBLISHED_PRICING_LIVE_DEDUCTION_CALLS: 0

=== REACHABILITY ===
G37_CACHE_REACHABILITY: unknown
G31_ABOVE_200K_REACHABILITY: unknown
G31_CACHE_REACHABILITY: unknown
OPUS_CACHE_REACHABILITY: reachable
OPUS_CACHE_TTL_MODE: 5M_ONLY

=== USAGE ===
BILLABLE_INPUT_OWNER: resolveTurnBillableInput() in src/lib/points.ts
BILLABLE_OUTPUT_OWNER: billableOpenRouterOutputTokens in src/app/api/chat/route.ts
BILLABLE_STAGE_OWNER: selectBillableStages() in src/lib/points.ts
REASONING_DOUBLE_COUNT_POSSIBLE: verified (false)

=== IDEMPOTENCY ===
DB_ENFORCED_REQUEST_IDEMPOTENCY: false
LEDGER_IDEMPOTENCY_UNIQUE_KEY: none
DUPLICATE_REQUEST_DOUBLE_CHARGE_POSSIBLE: reproduced_risk (concurrent test: 2 charges commit)
REGEN_DOUBLE_CHARGE_POSSIBLE: documented (sequential guard via deduction_slices)

=== FX ===
SHADOW_ONE_TURN_ONE_FX_SNAPSHOT: verified
SHADOW_ADMIN_READ_CAN_LOCK_FX: verified (false)
SHADOW_MIDNIGHT_BOUNDARY_PASS: verified
FUTURE_PUBLISHED_ONE_TURN_ONE_FX_SNAPSHOT: not_implemented

=== RECEIPT ===
PUBLIC_RECEIPT_INTERNAL_LEAK_PATHS: 0
HISTORICAL_PRICING_SNAPSHOT_COMPLETE: not_implemented

=== MIGRATION DELTA @1530 ===
G37_A_LEGACY: 35P  →  G37_A_PUBLISHED: 48P
G37_B_LEGACY: 62P  →  G37_B_PUBLISHED: 80P
G31_LEGACY: 286P  →  G31_PUBLISHED: 229P
OPUS5_LEGACY: 798P  →  OPUS5_PUBLISHED: 695P

=== CLASSIFICATION ===
G37: D
G31: D
OPUS5: B

SAFEST_FIRST_CUTOVER_MODEL: claude-opus-5 (recomputed — not hardcoded)
REPORT_CLASSIFICATION_MATCHES_RUNTIME_CLASSIFICATION: true

LIVE_DEDUCTION_BEHAVIOR_CHANGED: false
LIVE_CUTOVER_OCCURRED: false
MERGE_RECOMMENDED: false
```

---

## Classification semantics (canonical)

| Class | Meaning |
|-------|---------|
| **A** | Current product cutover ready — all cells READY, NOT_APPLICABLE, or NOT_REACHABLE_CURRENT_PRODUCT |
| **B** | Only policy choice missing; engine can execute permitted choice without new billing support |
| **C** | Reachable billing state cannot be priced safely without new implementation |
| **D** | Evidence insufficient (UNKNOWN cells present) |

**Reachability ≠ pricing coverage.** Example: G31 >200k has `pricingCoverage: unsupported` but `productReachability: unknown` — not converted to NOT_REACHABLE without a proven hard provider cap.

---

## Current-product readiness matrix

| Dimension | G37 | G31 | Opus5 |
|-----------|-----|-----|-------|
| Base uncached usage | READY | READY | READY |
| Cache read | UNKNOWN | UNKNOWN | READY |
| Cache write | UNKNOWN | UNKNOWN | READY |
| Above pricing threshold | NOT_APPLICABLE | UNKNOWN | NOT_APPLICABLE |
| Reasoning accounting | READY | READY | READY |
| Multi-stage turn | POLICY | POLICY | POLICY |
| Fallback | POLICY | POLICY | POLICY |
| Continuation/recovery | POLICY | POLICY | POLICY |
| Missing usage | POLICY | POLICY | POLICY |
| Quality waiver | POLICY | POLICY | POLICY |
| Receipt | POLICY | POLICY | POLICY |
| Idempotency | POLICY | POLICY | POLICY |
| FX snapshot | POLICY | POLICY | POLICY |

---

## Reachability evidence chains

### Gemini 3.1 >200k — UNKNOWN

- Component budgets (28k system, 10k history, 12k memory) are **not** a proven global provider-prompt ceiling.
- `resolveMaxPayloadInputTokens()` returns `Number.MAX_SAFE_INTEGER`.
- Additional sections (persona, lorebook, user note, canon, status widget) not bounded in audit.
- Shadow marks >200k as `unsupported_pricing_tier` — pricing policy only.

### Gemini 3.1 / 3.7 cache — UNKNOWN

- No proven production request path with cache_control for Gemini CI models.
- `applyAnthropicCacheAndPrefill` skips non-Anthropic models.
- Usage parser **can** parse cache tokens if provider reports them; billing **can** consume them.
- No production fixture proving `cacheReadTokens > 0` on G31/G37 CI turns.

### Opus 5 cache — REACHABLE

```
claude-opus-5
→ assemblePrimaryRpRequest / applyCacheAndPrefillForTransport
→ cache_control: { type: "ephemeral" }
→ parseCompatibleUsage / openRouterUsage.ts
→ route.ts cacheReadTokens/cacheWriteTokens
→ computeTurnBilling unified reasoning path
→ Published v2 cache rates (verified_5m)
```

---

## Idempotency audit

| Scenario | Status |
|----------|--------|
| Single-process sequential duplicate | documented — `alreadyBilledForRequest` guard |
| Multi-worker concurrent duplicate | **reproduced_risk** — test shows 2 ledger charges |
| Retry after commit | documented |
| Regeneration | documented — same requestId reuses assistant |

**DB schema:** `idx_messages_chat_request_id` is non-unique. `point_logs` has no unique billing key per request.

---

## Cutover blockers (with origin)

| Blocker | Origin |
|---------|--------|
| Published pricing shadow-only | cutover_required |
| Duplicate-request DB idempotency gap | **existing_production** |
| G31 cache UNVERIFIED / path unproven | cutover_required |
| G37 cache unsupported / path unproven | cutover_required |
| Multi-stage billing asymmetry | both |
| Waiver minimum interaction | both |
| Historical receipt snapshot | cutover_required |
| Pure live charge engine not extracted | cutover_required |

---

## Finding basis labels

| Finding | Basis |
|---------|-------|
| Published live calls = 0 | SOURCE_AUDIT |
| Reasoning no double-count | TEST_REPRODUCED |
| Concurrent duplicate charge | TEST_REPRODUCED |
| Opus cache reachable | CODE_VERIFIED |
| G31/G37 cache unknown | SOURCE_AUDIT |
| Safest-first model | POLICY_INTERPRETATION (score from classification) |

---

## Hard gates (audit PR)

```text
LIVE_DEDUCTION_BEHAVIOR_CHANGED: false
AUDIT_OWNER_PATH_CORRECT: true
AUDIT_HARDCODED_PASS_FINDINGS: 0
AUDIT_SELF_ASSERTION_ONLY_TESTS: 0
REPORT_MATRIX_MATCHES_CODE: true
REPORT_CLASSIFICATION_MATCHES_CODE: true
G31_ABOVE_200K_FALSE_CEILING_REMOVED: true
IDEMPOTENCY_DB_GUARD_STATUS_EXPLICIT: true
CUTOVER_BLOCKERS_ORIGIN_CLASSIFIED: true
P0_AUDIT_ACCURACY_BLOCKERS: 0
MERGE_RECOMMENDED: false
```

---

## Code references

- Diagnostics: `src/lib/liveBillingCutoverReadiness.ts`
- Tests: `src/lib/liveBillingCutoverReadiness.test.ts` (21 tests including concurrent idempotency reproduction)
