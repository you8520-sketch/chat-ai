# Forensic Memory / Cost Audit (post-#987) — Correction Pass

**RUNTIME_CHANGE:** NO  
**PROVIDER_GENERATION_CALLS:** 0  
**BILLING_CHANGE:** NO  
**SUBSCRIPTION_CAPABILITY_CHANGE:** NO  
**MERGE:** NO (Draft PR #989 only)

## EXACT HEAD

```
main baseline: 3c5555a2fe97f9097cf7b65aff5912574d72b805
Merge pull request #987 from you8520-sketch/cursor/creator-lorebook-20-attach-bounded-inject-163d
```

PR #989 audit branch is **ahead** of main baseline (audit-only commits). Architecture checks target post-#987 `main` via `verifyMainHeadIncludesPr987()`.

## MAIN RELATION

Audit-only branch off current `main` HEAD. Adds read-only helpers, verified CheaperInference catalog fixture, billing/margin gate evaluation, and deterministic tests. **No production runtime, billing, subscription, or Global15 implementation.**

## RUNTIME CHANGE

**NO**

## PROVIDER GENERATION CALLS

**0** (catalog evidence uses fixture verified by GET `/v1/models` on 2026-09-20; no chat/completions calls)

## CORRECTED PROVIDER CONTEXT EVIDENCE

Authoritative source: CheaperInference public model catalog (`context_length`, `max_output_tokens`). **Separate** from production assembly `resolveMaxPayloadInputTokens()` (MAX_SAFE_INTEGER telemetry-only).

| model | provider model id | provider context window | max output | source | retrieved/verified | production assembly limit | telemetry budget |
|---|---|---:|---:|---|---|---:|---:|
| deepseek-v4-pro-0813 | deepseek-v4-pro-0813 | **1,048,576** | 384,000 | CI catalog GET /v1/models; provider=DeepSeek | 2026-09-20 | MAX_SAFE_INTEGER (unbounded assembly) | 28,000 |
| gemini-3.1-pro-preview | gemini-3.1-pro-preview | **1,000,000** | 32,768 | CI catalog GET /v1/models; provider=Google | 2026-09-20 | MAX_SAFE_INTEGER | 28,000 |
| gemini-3.7-flash | gemini-3.7-flash | **1,048,576** | 65,536 | CI catalog GET /v1/models; provider=Google (**not** Gemini 3.1 fallback) | 2026-09-20 | MAX_SAFE_INTEGER | 28,000 |
| gpt-5.6-terra | gpt-5.6-terra | **1,050,000** | 128,000 | CI catalog GET /v1/models; provider=OpenAI owned_by=OpenAI | 2026-09-20 | MAX_SAFE_INTEGER | 28,000 |

Fixture: `src/lib/memory/fixtures/cheaperInferenceMainRpProviderContext.fixture.json`

**Removed incorrect ceilings:** DeepSeek 180K repo ref, Gemini 3.1 published 200K, Gemini 3.7 pattern-borrow, Terra assembly unbounded as provider ceiling.

## CORRECTED MODEL HEADROOM

Provider context window basis (`MEMORY_HEAVY` / `PAID10`):

| Model | Input tokens | Provider context window | Headroom | History msgs |
|---|---:|---:|---:|---:|
| deepseek-v4-pro-0813 | 43,615 | 1,048,576 | **1,004,961** | 8 |
| gemini-3.1-pro-preview | 43,367 | 1,000,000 | **956,633** | 8 |
| gemini-3.7-flash | 43,091 | 1,048,576 | **1,005,485** | 8 |
| gpt-5.6-terra | 43,091 | 1,050,000 | **1,006,909** | 8 |

Telemetry `MODEL_SYSTEM_BUDGETS` (~28K) remains **soft** — distinct from provider ceiling.

## BILLING OWNER MAP

| Model | Raw cost owner | Point charge owner | Pricing rule | Canonical margin floor |
|---|---|---|---|---:|
| deepseek-v4-pro-0813 | `computeReasoningPointCost` rawUsd×FX | `computeOpenRouterTurnBilling` (pointsReasoningMargins unified branch) | Token-proportional cost-plus-margin | **65%** |
| gemini-3.1-pro-preview | same | same | Token-proportional; **not** legacy output-floor path for CI delivery | **50%** |
| gemini-3.7-flash | same | same | Token-proportional @ **55%** — **does not inherit** Gemini 3.1 floor | **55%** |
| gpt-5.6-terra | same | same | Token-proportional @ **50%** | **50%** |

## PAID10 / PAID15 REALIZED MARGIN MATRIX

Assumed output: 2,500 chars (~625 tokens). `MEMORY_HEAVY`. Realized gross margin = `(chargeP - rawCostKrw) / chargeP`.

| Model | PAID10 raw KRW | PAID10 P | PAID10 realized margin | PAID15 raw KRW | PAID15 P | PAID15 realized margin | Margin delta | Floor/target | Policy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| deepseek-v4-pro-0813 | 22.42 | 65 | 65.5% | 24.41 | 70 | 65.1% | −0.38pp | 65% | PASS |
| gemini-3.1-pro-preview | 121.81 | 244 | 50.1% | 130.97 | 262 | 50.0% | −0.07pp | 50% | PASS |
| gemini-3.7-flash | 43.65 | 97 | 55.0% | 47.08 | 105 | 55.2% | +0.16pp | 55% | PASS |
| gpt-5.6-terra | 173.17 | 347 | 50.1% | 186.25 | 373 | 50.1% | −0.03pp | 50% | PASS |

**Note:** Incremental cost (+5–26 P/turn) is **not** equivalent to margin-target satisfaction; margin gate uses realized gross margin vs canonical floor.

## CANONICAL POLICY PASS

**A. CURRENT_CANONICAL_POLICY_PASS:** All four models PASS — Paid15 does not violate model-specific gross-margin floors in `pointsReasoningMargins.ts`.

**B. PRODUCT_MARGIN_REFERENCE (informational only):** Legacy `OPENROUTER_GROSS_MARGIN` default 30% in `points.ts` — **not** the billing owner for Main RP CI models.

## CONTEXT GATE

**PASS** — All Main RP provider ceilings verified from catalog fixture. Paid15 `BOUNDED_VALID_STRESS` headroom ≥ 5,000 tokens vs provider ceiling (min ~956K).

## FREE ISOLATION GATE

**PASS** — Free remains Global10 + Free capability (Focus 1K, User LB 2.5K inject). PAID15 sim does not mutate Free matrix.

## HISTORY GATE

**PASS** — `historyTrimOffset=false` for all models; Paid15 does not shrink raw-history vs PAID10.

## BILLING GATE

**PASS** — PAID10/PAID15 raw cost, point charge, and realized margins computed for all Main RP models via production billing owners. Canonical policy PASS for all models.

## OWNER GATE

**PASS** — No new Global owner; no duplicate subscription resolver; RUNTIME_CHANGE=NO; BILLING_CHANGE=NO.

## IMPLEMENTATION DECISION

**SAFE_FOR_SEPARATE_FEATURE_PR** (gate-based; **not** `global15PointsDeltaMax ≤ 500` heuristic)

All five gates PASS. Global15 remains **harness-only** in this PR.

### Recommended follow-up feature PR (not in this audit)

Add `SubscriptionMemoryCapability.globalCurrentMemoryMaxChars` (FREE=10K, SUBSCRIBED=15K) through existing Global resolver path — no parallel tier resolver, env flag, or runtime change in audit PR.

## BEFORE

| Area | Canonical owner (pre-audit production) |
|---|---|
| Global Current Memory | `MEMORY_CAPACITY_FIXED=10_000` — tier-neutral |
| Medium Memory N15 | `MEDIUM_TERM_BLOCK_COUNT=15` + global_compact gate |
| Focus | Free 1K / Paid 2K via subscription capability |
| Creator Lorebook (#987) | 20 attach / 4K turn inject |
| Provider context evidence (prior audit) | **Incorrect** — stale 180K/200K/unbounded assembly conflation |

## PROBLEM

GPT exact-head review blockers:

1. **MODEL CONTEXT CEILING** — prior audit used repo refs / Gemini 3.1 pattern / assembly unbounded instead of CheaperInference catalog `context_length`.
2. **MARGIN SAFETY** — prior decision used `global15PointsDeltaMax ≤ 500` without model-specific margin proof.

## AFTER

- Provider ceiling and production assembly limit are **separate fields**.
- Headroom recomputed from verified catalog ceilings (1M+ tokens).
- Implementation decision uses independent CONTEXT / FREE / HISTORY / BILLING / OWNER gates.
- Margin matrix uses `computeOpenRouterTurnBilling` + realized gross margin vs canonical floors.

## PRESERVED

- Post-#987 Creator max20 / single-unit / 4K inject
- Free Focus 1K / Paid 2K; User Lorebook tiers
- Global production 10K; Medium N15; Global15 harness-only
- Paid peaks: NORMAL 34,377 | MEMORY_HEAVY 43,615 | BOUNDED_VALID_STRESS 44,515
- PAID10→PAID15 +4,275 input tokens (DeepSeek MEMORY_HEAVY); no history trim offset
- #985 115K+ not reproducible; runtime change 0; provider generation calls 0

## REMOVED / CORRECTED

| Removed / corrected | Replacement |
|---|---|
| DeepSeek 180K as provider ceiling | 1,048,576 (CI catalog) |
| Gemini 3.1 200K published tier as G31/G37 ceiling | G31 1M; G37 1,048,576 (distinct) |
| Terra MAX_SAFE_INTEGER as provider ceiling | 1,050,000 (CI catalog) |
| `global15PointsDeltaMax > 500` margin gate | BILLING_GATE with realized margin matrix |
| “Margin targets safe = Yes” without evidence | Canonical policy PASS per model |

## REGRESSION RISKS

- Conflating `resolveMaxPayloadInputTokens()` with provider catalog ceiling again.
- Using incremental P delta as margin safety proxy.
- Wiring Global tier without updating compaction/Medium tests.
- Reintroducing pre-#987 unbounded Creator fixtures.

## PROOF

```bash
git diff --check
npm run lint
npm run typecheck:app
SESSION_SECRET=audit-build-secret-32chars-minimum npm run build
node --conditions=react-server --import tsx --test src/lib/memory/forensic-memory-cost-audit.test.ts
node --conditions=react-server --import tsx --test src/lib/memory/memory-architecture-audit.test.ts
node --conditions=react-server --import tsx --test src/lib/memory/memory-global-current-memory.test.ts
node --conditions=react-server --import tsx --test src/lib/memory/memory-medium-term-prompt-budget-audit.test.ts
node --conditions=react-server --import tsx --test src/lib/memory/memory-medium-term.test.ts
node --conditions=react-server --import tsx --test src/lib/subscriptionMemoryCapability.test.ts
node --conditions=react-server --import tsx --test src/lib/userLorebook.test.ts
node --conditions=react-server --import tsx --test src/lib/creatorLorebook.test.ts
node --conditions=react-server --import tsx scripts/forensic-memory-cost-audit-report.ts
```

## CI STATUS

**No GitHub Actions workflow run on PR #989 head** — intentional path filter.

Workflow: `.github/workflows/validate-memory-episodic.yml` triggers only when listed paths change. It does **not** include:

- `src/lib/memory/forensic-memory-cost-audit.ts`
- `src/lib/memory/forensic-memory-cost-audit-evidence.ts`
- `src/lib/memory/forensic-memory-cost-audit.test.ts`
- `scripts/forensic-memory-cost-audit-report.ts`

Therefore PR #989 does not invoke CI without touching unrelated production files (not done). Exact-head validation executed locally via commands above.

## REQUIRED QUESTIONS (answers)

1. **Realistic Paid peak input?** **43,615 tokens** (MEMORY_HEAVY).
2. **Bounded valid stress?** **44,515 tokens**.
3. **#985 115K+ still possible?** **No**.
4. **Global10→15K input increase?** **+4,275 tokens** (DeepSeek MEMORY_HEAVY).
5. **History trim offset?** **No**.
6. **Min provider headroom (MEMORY_HEAVY PAID10)?** **956,633 tokens** (Gemini 3.1 @ 1M ceiling).
7. **Margin targets safe?** **Yes — proven** via realized gross margin matrix vs canonical floors (not points-delta heuristic).
8. **Free unaffected?** **Yes**.
9. **Global15 weakens Medium N15?** Semantic overlap by design; literal duplicate chars = 0 in fixture.
10. **Provider ceilings verified?** **Yes** — all four Main RP models from CI catalog fixture.
