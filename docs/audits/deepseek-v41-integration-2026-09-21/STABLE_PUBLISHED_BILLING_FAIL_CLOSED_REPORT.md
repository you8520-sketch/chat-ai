# Stable Published Billing Fail-Closed — System Delta Report

**Audit date:** 2026-09-21  
**Exact main / PR head:** `e2c3f330b25432304d00ee4f490b4f563bb41d58`  
**Branch:** `cursor/v41-flash-hidden-integration-a91d` (PR #994, draft)  
**MERGE:** NO · **PUBLIC_PICKER_ENABLE:** NO · **PROVIDER_CALLS:** 0 · **NEW_BILLING_ENGINE:** NO

---

## Final classification

**`STOP_PRODUCT_DECISION_REQUIRED`**

No existing canonical owner defines fail-closed behavior for **stable Phase2 direct-selected** models when published billing is **attempted then blocked/unresolved**. The only implemented path is Phase1-style **legacy fallback charging `legacyFinalPoints`** (procurement-coupled CI legacy BASE). That path contradicts the confirmed launch invariant but is the current production contract.

---

## 1. Confirmed product invariant

| Layer | Policy |
|-------|--------|
| USER BASE | stable provider baseline + model target margin (published catalog) |
| ACTUAL PROCUREMENT | CI current / marketplace discount / off-peak — margin evidence only |
| **Forbidden at launch** | `PUBLISHED BILLING BLOCK → PROCUREMENT-COUPLED LEGACY BASE` (silent) |

---

## 2. Current fallback dataflow

```text
route.ts
  computeTurnBilling() → billing.total (legacy CI catalog; upstreamCostUsd when CI + present)
  shouldWaiveTurnBilling() → billingWaiverReason (generation failures only)
  legacyFinalPointsBeforeDispatch = waiver-adjusted legacy total
  resolveChatBillingContract()
    publishedPhase = phase1 | phase2 (direct-selected)
    resolveTurnBillableUsage()
    computePublishedUserChargeWithSnapshot()
    on block/unresolved → legacyDecision(reason) → { contract: "legacy", points: legacyFinalPoints }
  if published_phase1|phase2 → cost = decision.points
  else → cost stays legacyFinalPointsBeforeDispatch  ← silent procurement BASE on block
  settleChatTurnBillingExactlyOnce(cost)
  buildUsageBillingContractAdmin(decision, settled, legacyFinalPointsBeforeDispatch)
```

**Key files**

| Owner | Module | Role |
|-------|--------|------|
| Dispatch | `chatBillingContractDispatch.ts` | Published vs legacy; `legacyDecision()` on all published failures |
| Published charge | `publishedUserCharge.ts` | Deterministic catalog charge; `status: "blocked"` reasons |
| Usage basis | `turnBillableUsage.ts` | LEVEL-1 usage; coverage gates |
| Legacy BASE | `points.ts` / `pointsReasoningMargins.ts` | `computeTurnBilling()`; CI `upstreamCostUsd` margin path |
| Waiver | `points.ts` `shouldWaiveTurnBilling()` | Generation failure → 0P; **not** billing-calc anomaly |
| Settlement | `chatBillingSettlement.ts` `settleChatTurnBillingExactlyOnce()` | Exactly-once deduct; receives final integer cost only |
| Refund / no-charge evidence | `storedTurnChargeEvidence.ts` | Post-hoc charge proof; interrupted 0P invariant |
| Product-not-delivered | `BillingProductNotDeliveredError` | Blocks settlement when assistant content empty — **not** billing-formula failure |
| Admin telemetry | `chatBillingFinalCharge.ts` → `buildUsageBillingContractAdmin()` | Stores `publishedBlockReason`, `legacyFinalPoints`, `billingContract` |
| Forensic receipt | `adminBillingForensicMetadata.ts` | Surfaces dispatch fields; no `appliedFailClosedPolicy` today |

**`STABLE_PUBLISHED_BILLING_FAILURE_POLICY` owner:** **does not exist.** Nearest reuse candidates rejected below.

---

## 3. RED policy-violation fixture (reproduced, provider call 0)

**Scenario:** direct-selected `deepseek-v4.1-flash`, Phase2 ON, positive `cacheWriteTokens=128`.

| Step | Result |
|------|--------|
| Published attempt | yes (`resolvePublishedBillingPhase` → `phase2`) |
| `computePublishedUserChargeWithSnapshot` | `status: "blocked"`, `unsupported_cache_semantics` |
| Dispatch | `contract: "legacy"`, `reason: "unsupported_cache_semantics"` |
| Settled points | `legacyFinalPoints` (e.g. 8P on 10k/500 fixture) |
| Telemetry | `publishedCandidateStatus: "blocked"`, `publishedBlockReason` set |

**Procurement coupling proof (V4 Pro Phase2, same block reason):**

| `upstreamCostUsd` | Legacy BASE (points) |
|-------------------|----------------------|
| 0.001 | 5 |
| 0.05 | 223 |

Dispatch assigns `decision.points = legacyFinalPoints` → charge tracks procurement report, not published catalog.

Repro: `scripts/repro-stable-published-billing-red.ts`, tests in `deepseekV41StablePublishedBillingFailClosed.test.ts`.

---

## 4. Existing fail-closed behavior audit

| Candidate | Existing owner? | Applies to published-billing anomaly after successful generation? |
|-----------|-----------------|-------------------------------------------------------------------|
| **A. No-charge / waiver** | `shouldWaiveTurnBilling()` | **NO** — triggers: degeneration, generation_failure, forced_abort, garbage_output, usageUnavailable. No `published_blocked` / `billing_anomaly` reason. |
| **B. Settlement withheld / billing failure** | `BillingProductNotDeliveredError` | **NO** — empty/missing durable assistant product only. Successful RP prose + blocked published charge still settles legacy cost today. |
| **C. Legacy fallback (Phase1 canonical)** | `legacyDecision()` in dispatch | **YES — but violates launch invariant** — documented in `chatBillingContractDispatch.test.ts` "fail-closed legacy fallback" suite and `deepseekPhase2PublishedBillingCutover.test.ts` D6–D9. |

Phase1 closure matrix explicitly requires `decision.points === fixtureLegacyFinalPoints` on legacy fallback (`PHASE1_EXPECTED_LEGACY_FALLBACK_CHARGE_MISMATCH = 0`). Phase2 copied the same architecture.

---

## 5. Product decision required? **YES**

Must choose one before implementation:

| Option | Behavior | User impact | Finance / ops | Settlement |
|--------|----------|-------------|---------------|------------|
| **A. Billing-anomaly waiver (0P)** | Successful turn, published blocked → charge 0 | User receives prose free | Revenue gap; needs anomaly reporting | `settleChatTurnBillingExactlyOnce(0)` + `billingWaived` telemetry extension |
| **B. Withhold settlement / explicit billing failure** | Turn completes but settlement errors or pending review | UX ambiguity (charged vs not?) | Manual reconciliation | May conflict with "product delivered" gate |
| **C. Reject / fail turn** | Treat as hard failure | Bad UX if prose already streamed | Clean ledger | Conflicts with current streaming persistence model |
| **D. Keep legacy fallback** | Status quo | Charges CI legacy BASE | Contradicts launch invariant | Works today — **not launch-safe for V4.1 public picker** |

**Recommendation for product:** decide A vs B (or hybrid) and define a new `BillingWaiverReason` or dispatch contract variant (e.g. `published_blocked_waiver`) with admin telemetry field `appliedFailClosedPolicy`.

---

## 6. Patch status

**No production dispatch patch applied** — no canonical policy to implement without guessing.

---

## 7. Preserved paths (unchanged at head)

| Path | Status |
|------|--------|
| V4.1 no-cache | `published_phase2` ✓ |
| V4.1 cache-read | `published_phase2` ✓ |
| V4.1 cacheWrite unreported → `MISSING_BUT_PROVEN_ZERO` | `published_phase2` ✓ |
| Positive cacheWrite | published **blocked** (not absorbed at $0) ✓ |
| Legacy-only models (Terra, etc.) | legacy unchanged ✓ |
| Phase2 OFF + V4.1 selected | `phase2_deepseek_billing_disabled` legacy ✓ |
| Settlement exactly-once | existing owner unchanged ✓ |

---

## 8. Telemetry gap (for follow-up)

Admin receipt already stores: `billingContract`, `billingContractReason`, `publishedCandidateStatus`, `publishedBlockReason`, `legacyFinalPoints`, `settledDeductedPoints`.

**Missing for launch gate:** explicit `appliedFailClosedPolicy` distinguishing "legacy eligibility fallback" vs "published attempted then blocked".

---

## 9. Regression fixtures

| ID | Desired | Status at head |
|----|---------|----------------|
| A–C | V4.1 normal published paths | **PASS** (existing suites) |
| D | positive cacheWrite → no procurement legacy BASE | **FAIL (RED documented)** |
| E | incomplete usage → no procurement legacy BASE | **FAIL (same architecture)** |
| F | invalid FX → canonical fail-closed | **FAIL (legacy fallback today)** |
| G | legacy-only unchanged | PASS |
| H | V4 Pro unchanged unless policy scoped | RED for blocked paths (upstream coupling) |
| I | settlement replay exactly once | PASS for happy path; fail-closed path untested |

Skipped desired-invariant tests: `deepseekV41StablePublishedBillingFailClosed.test.ts`.

---

## 10. Proof artifacts

- RED tests: `src/lib/deepseekV41StablePublishedBillingFailClosed.test.ts`
- Repro script: `scripts/repro-stable-published-billing-red.ts`
- Existing documenting tests: `deepseekPhase2PublishedBillingCutover.test.ts` D6–D9, `deepseekV41EvidenceCorrection.test.ts` cache boundary

---

## 11. Follow-up (out of scope)

- V4 Pro peak price reconciliation
- Public picker enable
- Implement chosen fail-closed policy in `resolveChatBillingContract()` + route cost assignment
- Extend `UsageBillingContractAdmin` with `appliedFailClosedPolicy`
