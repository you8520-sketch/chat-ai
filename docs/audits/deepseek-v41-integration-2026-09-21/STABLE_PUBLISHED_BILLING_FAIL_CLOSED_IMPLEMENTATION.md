# Stable Published Billing Fail-Closed — Implementation Report

**Head:** (post-patch)  
**Branch:** `cursor/v41-flash-hidden-integration-a91d` (PR #994, draft)  
**Classification:** `READY_FOR_PUBLIC_PICKER_PR` (billing launch-gate satisfied; picker still OFF by policy)

---

## PRODUCT POLICY

Direct-selected Phase2 stable-published DeepSeek models:

| Path | Charge |
|------|--------|
| Published eligible + resolved | Published catalog charge |
| Published not eligible | Existing legacy (unchanged) |
| Published eligible + attempted + unsafe/unresolved | **0P** `published_fail_closed` |

Operator absorbs provider cost; user prose preserved. Separate from generation-quality waiver.

---

## CANONICAL FAIL-CLOSED OWNER

`resolveChatBillingContract()` in `chatBillingContractDispatch.ts`

- New contract: `published_fail_closed`
- Points: `0`
- Telemetry: `appliedFailClosedPolicy = zero_point_billing_anomaly_waiver`
- Phase1 published failures: **unchanged** legacy fallback

---

## BEFORE → AFTER

| Scenario (Phase2 direct-selected) | Before | After |
|-----------------------------------|--------|-------|
| Positive cacheWrite | `legacy` + legacyFinalPoints | `published_fail_closed` + 0P |
| Usage incomplete/unknown/unresolved | `legacy` + legacyFinalPoints | `published_fail_closed` + 0P |
| Invalid FX | `legacy` + legacyFinalPoints | `published_fail_closed` + 0P |
| Phase2 OFF / not direct-selected | legacy | legacy (unchanged) |
| Phase1 Gemini/Opus block | legacy | legacy (unchanged) |

---

## SETTLEMENT

`settleChatTurnBillingExactlyOnce(requestedPoints: 0)` → `outcome: "waived"`, no deduction slices. Replay duplicate-safe (existing owner).

---

## TELEMETRY

`UsageBillingContractAdmin` extended: `publishedBillingPhaseAttempted`, `appliedFailClosedPolicy`. Admin receipt V2 surfaces block reason + policy. `upstreamCostUsd` preserved on usage for finance margin.

---

## REGRESSION

`src/lib/deepseekV41StablePublishedBillingFailClosed.test.ts` — matrix A–P (PROVIDER_CALLS=0).

---

## ABUSE BOUNDARY

Anomaly signals (`cacheWriteTokens`, `usageReportingEvidence`, FX snapshot) originate from provider stream assembly (`openRouterAdult.ts`), not user POST fields.
