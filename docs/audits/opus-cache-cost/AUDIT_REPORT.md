# Opus Cache & Cost Forensics — Audit Report

**Branch:** `cursor/opus-cache-cost-forensics-163d`
**PR:** #962 (investigation-only amend)
**Date:** 2026-09-19
**Method:** Current `main` code + Railway production path. **No live provider calls in this amend.**

---

## Final Classifications (separated)

| Label | Classification |
|-------|----------------|
| `HISTORICAL_OPUS_60K_INCIDENT` | **FAILURE_MODE_CONFIRMED** |
| `HISTORICAL_CACHE_BYPASS_UNDERLYING_CAUSE` | **ROOT_CAUSE_UNCONFIRMED** |
| `CURRENT_OPUS_PHYSICAL_PROMPT_DUPLICATION` | **NO_MATERIAL_DEFECT_FOUND** |
| `CURRENT_OPUS_CACHE_HEALTH` | **UNVERIFIED_NO_CURRENT_LIVE_PROVIDER_PROOF** |
| `CURRENT_OPUS_BILLING_CONTRACT` | **UNVERIFIED_PRODUCTION_ENV_VALUE_REDACTED** |
| `OPUS_PUBLIC_EXPOSURE_GUARD` | **REMOVED_WITHOUT_CACHE_ROOT_CAUSE_PROOF** |

---

## Historical Production Incident (PR #440 evidence)

**Source:** PR #440 body — production example cited when Opus was disabled for users.

| Field | Value |
|-------|-------|
| Provider request id (suffix) | `669865` |
| Input / output tokens | **60,522 / 6,221** |
| Cache read / write | **0 / 0** |
| Standard input (derived) | **60,522** (full prompt uncached) |
| Actual billed (CI) | **$0.320695** |
| Failure mode | **FULLY_UNCACHED_CONFIRMED** |

**Hard invariant:** `60522 = 60522 + 0 + 0` ✓

**Catalog reconciliation (CI Opus 5 rates, offline):**
`(60522/1e6 × $3.5) + (6221/1e6 × $17.5) ≈ $0.3207` — matches billed `$0.320695` within rounding.
This is **100% standard-input pricing**, not cache-write or cache-read mix.

**Do not classify this incident as cold cache-write.** Provider reported zero cache read and zero cache write. The confirmed failure mode is **full-price uncached input** on a ~60K prompt.

**Underlying cause** (why CI/Anthropic ignored `cache_control` on that request) remains **ROOT_CAUSE_UNCONFIRMED** — separate from failure-mode confirmation.

---

## Lifecycle Audit: #423 → #440 → #643 → #876

| PR | Date (merged) | Action | Cache evidence |
|----|---------------|--------|----------------|
| **#423** | 2026-08-16 | Restore Anthropic history cache breakpoint on CI Opus; same-snapshot diagnostic | Live T7→T8→T9 warm hits; growing history OK |
| **#440** | 2026-08-16 | **`OPUS5_USER_ENABLED` user disable** — incident `669865` cited | Probes also 0/0 cache; temporary exposure guard |
| **#643** | 2026-08-26 | **Admin-only** Opus re-exposure while global disable held | No new cache root-cause proof |
| **#876** | 2026-09-06 | **Gate removal** — Opus in `MAIN_RP_USER_SELECTABLE_OPTIONS` for all users; `OPUS5_USER_ENABLED` removed | **NO cache recovery proof in PR body** — retirement/cleanup PR only |

**Current main:** `userSelectableAIOptionsForUser()` returns all 4 canonical models including `claude-opus-5` with no admin/env gate.

**`OPUS_PUBLIC_EXPOSURE_GUARD = REMOVED_WITHOUT_CACHE_ROOT_CAUSE_PROOF`**

---

## Executive Summary (current main)

| Question | Finding |
|----------|---------|
| Why ~60K input on historical turn? | **Confirmed:** 60,522 tokens, **fully uncached** (PR #440) |
| Standard / read / write split (historical)? | **0 / 0** → all standard — **FULLY_UNCACHED_CONFIRMED** |
| Why $0.32 CI charge? | Matches catalog full standard input + output — **reconciled offline** |
| Current cache warm/reuse? | **UNVERIFIED** — offline wire layout healthy; no current live proof |
| Physical prompt 2× Gemini? | **NO_MATERIAL_DEFECT_FOUND** (#423 / OC-01 preserved) |
| Production billing path? | **UNVERIFIED** — see below |

---

## Billing Contract (Railway correction)

| | |
|---|---|
| **Code default** | `PHASE1_PUBLISHED_BILLING_ENABLED` → **false** when unset (`chatBillingContractDispatch.ts`) |
| **Railway production** | Variable **exists**; value **OAuth redacted** → **UNVERIFIED** |
| **Do not assert** | `production = legacy` — only **CODE DEFAULT = legacy fallback when gate off** |

When Published gate is on + valid FX/usage: `published_phase1` for Opus. When off or blocked: legacy char floor (`points.ts`, 0.142 P/char, cache ignored for user charge).

---

## OWNER MAP (A–O) — summary

Canonical owners unchanged from prior audit; forensics helpers live in **`scripts/test-support/opusCacheCostForensics.ts`** (not production runtime).

| ID | Canonical owner |
|----|-----------------|
| A Physical assembly | `contextBuilder.buildContext` → `openRouterAdult.assemblePrimaryRpRequest` |
| B System cache split | `openRouterCache.buildOpenRouterCachedSystemContent` |
| C History breakpoint | `openRouterCache.resolveHistoryCacheBreakpointIndex` (tail=3) |
| D Cache lifetime | Provider ephemeral 5m; app sends `type: "ephemeral"` only |
| E Cache affinity | **None on CI wire** — OR `session_id` stripped; no `x-ci-prompt-cache*` |
| F Generation identity | `route.ts` sessionId; regen suffix |
| G Usage parsing | `openRouterUsage.parseOpenRouterUsage` |
| H CI settled cost | `providerCostLedger` + `/v1/usage/requests` reconciliation |
| I Provider ledger | `providerCostLedger.recordMainGenerationProviderCost` |
| J Live catalog | `cheaperInferenceCatalogPricing.server.ts` |
| K Fallback pricing | `openRouterModelPricing.ts` |
| L User P contract | `chatBillingContractDispatch` → Published or legacy |
| M Published Phase1 | `publishedUserCharge` + `publishedModelPricing` v2 |
| N Legacy Opus | Char floor; `OPENROUTER_CLAUDE_OPUS_LEGACY_*` dead |
| O Admin receipt | `adminBillingReceiptV3` — section tokens = proportional allocation |

**Cache region ownership:** `contextBuilder.ts` `pushSection(..., "cacheRules"|"cacheCharacter"|"dynamic")` — no manual inventory constant (avoids drift).

---

## Cache Affinity (observation, not proven root cause)

```
route → session_id = chat-${chatId}
openRouterClient → body.session_id
adaptCheaperInferenceChatBody → delete session_id
HTTP → Content-Type + Authorization only
```

`GENERATION_IDENTITY` ≠ `CACHE_AFFINITY_IDENTITY` (no dedicated CI cache-affinity owner).

---

## Cache Economics (reference scenarios)

CI Opus 5 catalog: input $3.5/M · read $0.35/M · write $4.375/M · output $17.5/M

| Scenario | Notes | Provider USD (approx) |
|----------|-------|----------------------|
| **PR440** | 60522 std, 6221 out, 0/0 cache | **$0.321** (matches billed) |
| A | 60K all standard + 2K out | $0.245 |
| B | 60K all cache read | $0.056 |
| C | 60K all cache write | $0.298 |
| D | 4K+52K+4K mixed | $0.085 |

PR #423 noted some turns had cacheWrite with ~4K standard — **different failure shape** from PR #440 incident (0/0). Do not conflate.

---

## OC Regression Matrix — Coverage Audit

**Do not treat OC numbers alone as full proof.** Coverage labels:

| OC | Scope | Status |
|----|-------|--------|
| OC-01 | Same-snapshot physical parity | **OFFLINE_PROOF** (delegates #423) |
| OC-02 | 3 cache_control blocks | **OFFLINE_PROOF** |
| OC-03 | Dynamic mutation, stable prefix | **OFFLINE_PROOF** |
| OC-04 | Stable character fingerprint | **OFFLINE_PROOF** |
| OC-05 | KO→EN translation transition | **NOT_VALIDATED** (persona test only) |
| OC-06 | T1→T2 prefix stable | **OFFLINE_PREREQ** (not live warm) |
| OC-07 | Growing history prefix | **OFFLINE_PROOF** |
| OC-08 | Regen session_id strip | **OFFLINE_PROOF** |
| OC-09/10 | Ephemeral TTL in app | **OFFLINE_PROOF** |
| OC-11–14 | Isolation / invalidation | **OFFLINE_PROOF** |
| OC-15 | Parser partition math | **OFFLINE_PROOF** |
| OC-16 | Actual CI settlement | **NOT_VALIDATED** — catalog formula + PR440 shape only |
| OC-17 | Production billing parity | **NOT_VALIDATED** — code default false only |
| OC-18 | Legacy cache-agnostic charge | **OFFLINE_PROOF** |
| OC-19 | Phase1 model membership | **DELEGATED** |
| OC-20 | Failed/timeout settlement idempotency | **NOT_VALIDATED** — adapter idempotency only; see `providerCostLedger` tests |

Tests: `scripts/test-support/opusCacheCostForensics.test.ts`
Also run: `src/lib/opusGeminiSameSnapshotDiagnostic.test.ts`, `openRouterCache.test.ts`, `cheaperInferenceConfig.test.ts`

---

## Patch Policy — NO FIXES IN THIS PR

- Historical failure mode confirmed; underlying bypass cause unconfirmed
- Current physical prompt duplication: no material defect
- Current cache health: unverified without live provider proof
- Public exposure guard removed in #876 without cache root-cause proof — documented only

---

## Artifacts

```bash
node --conditions=react-server --import tsx scripts/opus-cache-cost-forensics-offline.ts
node --conditions=react-server --import tsx --test scripts/test-support/opusCacheCostForensics.test.ts
node --conditions=react-server --import tsx --test src/lib/opusGeminiSameSnapshotDiagnostic.test.ts
```

---

## STOP

- No live provider calls in this amend
- Draft PR #962 — do not merge
- Await approval before controlled live Opus cache verification
