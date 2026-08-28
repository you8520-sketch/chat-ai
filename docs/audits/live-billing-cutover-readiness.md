# Live Billing Cutover Readiness Audit

**Scope:** Gemini 3.7 Flash · Gemini 3.1 Pro Preview · Claude Opus 5  
**Mode:** Read-only / shadow-only — **no cutover, no live billing switch**  
**Audit version:** `2026-08-28-readiness-v3`

---

## Executive summary

Published Pricing v2 is merged and shadow-calibrated. All three audit models classify **C** (known reachable implementation blocker) due to a **global idempotency defect** — concurrent duplicate charges can commit without DB uniqueness guard.

**No model is cutover-safe today.**

| Model | Class | Notes |
|-------|-------|-------|
| Gemini 3.7 Flash | **C** | Global idempotency BLOCKED + G37 cache UNKNOWN |
| Gemini 3.1 Pro | **C** | Global idempotency BLOCKED + >200k/cache UNKNOWN |
| Claude Opus 5 | **C** | Global idempotency BLOCKED (cache READY otherwise) |

```text
SAFEST_FIRST_CUTOVER_MODEL: NONE_GLOBAL_BLOCKER
LEADING_POST_IDEMPOTENCY_PREP_CANDIDATE: claude-opus-5 (POLICY_INTERPRETATION)
NEXT P0 PRODUCTION PR: Billing idempotency hardening
```

---

## Live billing module chain

```text
LIVE_BILLING_IMPORT_SPECIFIER:
  @/lib/points

LIVE_BILLING_RUNTIME_ENTRYPOINT:
  src/lib/pointsReasoningMargins.ts

LIVE_BILLING_FALLBACK_CHAIN:
  pointsReasoningMargins.ts → pointsMuse60.ts → points.ts
```

Model handling may stop earlier in the chain.

### Model-specific live formula owners

| Model | Owner |
|-------|-------|
| **G37** | pointsReasoningMargins.ts → not unified → pointsMuse60.ts → points.ts → gemini37FlashPricing.ts |
| **G31** | pointsReasoningMargins.ts → unified reasoning branch |
| **Opus5** | pointsReasoningMargins.ts → unified reasoning branch |

`deductPoints()` resolves from downstream `points.ts` via re-export chain — separate from `computeTurnBilling()` entrypoint.

---

## Final report

```text
BASE_MAIN_SHA: (see PR)
AUDIT_VERSION: 2026-08-28-readiness-v3

LIVE_BILLING_RUNTIME_ENTRYPOINT: src/lib/pointsReasoningMargins.ts
LIVE_DEDUCTION_DEFINITION: deductPoints() in src/lib/points.ts

G37_LIVE_FORMULA_OWNER: pointsReasoningMargins → pointsMuse60 → points → gemini37FlashPricing
G31_LIVE_FORMULA_OWNER: pointsReasoningMargins unified reasoning
OPUS5_LIVE_FORMULA_OWNER: pointsReasoningMargins unified reasoning

PUBLISHED_PRICING_LIVE_DEDUCTION_CALLS: 0

=== REACHABILITY ===
G37_CACHE: unknown
G31_ABOVE_200K: unknown
G31_CACHE: unknown
OPUS_CACHE: reachable (READY)

=== IDEMPOTENCY ===
DB_ENFORCED_REQUEST_IDEMPOTENCY: false
LEDGER_IDEMPOTENCY_UNIQUE_KEY: none
IDEMPOTENCY_MATRIX: BLOCKED (all models)
SOURCE_AUDIT: no DB uniqueness guard
TEST_REPRODUCED: concurrent duplicate charge (2 ledger entries)

=== CLASSIFICATION ===
G37: C
G31: C
OPUS5: C

SAFEST_FIRST_CUTOVER_MODEL: NONE_GLOBAL_BLOCKER
LEADING_POST_IDEMPOTENCY_PREP_CANDIDATE: claude-opus-5

=== MIGRATION DELTA @1530 ===
G37_A: 35P → 48P
G37_B: 62P → 80P
G31: 286P → 229P
OPUS5: 798P → 695P

MERGE_RECOMMENDED: false
```

---

## Readiness matrix

| Dimension | G37 | G31 | Opus5 |
|-----------|-----|-----|-------|
| Base uncached usage | READY | READY | READY |
| Cache read | UNKNOWN | UNKNOWN | READY |
| Cache write | UNKNOWN | UNKNOWN | READY |
| Above pricing threshold | NOT_APPLICABLE | UNKNOWN | NOT_APPLICABLE |
| Idempotency | **BLOCKED** | **BLOCKED** | **BLOCKED** |
| Multi-stage / fallback / waiver / receipt / FX | POLICY | POLICY | POLICY |

---

## Classification semantics

| Class | Meaning |
|-------|---------|
| **A** | Ready |
| **B** | Policy only — no new implementation |
| **C** | Known reachable blocker requires implementation |
| **D** | Insufficient evidence (UNKNOWN, no stronger blocker) |

Precedence: BLOCKED → C; else UNKNOWN → D; else POLICY → B; else A.

---

## Next PR priority

**P0 before Published live charge engine extraction:**

```text
Billing idempotency hardening
ONE SUCCESSFUL REQUEST → AT MOST ONE LEDGER CHARGE
```

Origin: **existing_production** + **future cutover safety blocker**.

---

## Hard gates

```text
LIVE_DEDUCTION_BEHAVIOR_CHANGED: false
LIVE_BILLING_ENTRYPOINT: src/lib/pointsReasoningMargins.ts
MODEL_FORMULA_OWNER_AUDIT_COMPLETE: true
IDEMPOTENCY_MATRIX_STATUS: BLOCKED
G37/G31/OPUS5_CLASS: C
SAFEST_FIRST_CUTOVER_MODEL: NONE_GLOBAL_BLOCKER
P0_AUDIT_ACCURACY_BLOCKERS: 0
MERGE_RECOMMENDED: false
```

---

## Code references

- `src/lib/liveBillingCutoverReadiness.ts`
- `src/lib/liveBillingCutoverReadiness.test.ts` (23 tests)
