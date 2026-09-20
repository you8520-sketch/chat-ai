# Model Pricing Auto-Tracker — Architecture & Investigation Report

**Status:** Phase A (`OBSERVE_ONLY`) — Draft PR, not merge-ready for auto-apply  
**Main HEAD:** `3c5555a2fe97f9097cf7b65aff5912574d72b805`  
**Classification:** `FEATURE_READY_FOR_IMPLEMENTATION` (Phase A only)

---

## EXACT MAIN HEAD

```
3c5555a2fe97f9097cf7b65aff5912574d72b805
Merge pull request #987 — creator lorebook attach bounded inject
```

No open PR overlap detected for model-pricing tracking at investigation time.

---

## CURRENT OWNER MAP

| Responsibility | Canonical Owner | Notes |
|----------------|-----------------|-------|
| **MODEL_PRICING_POLICY** | `src/lib/modelPricingPolicy.ts` (new) + margin fields in `publishedModelPricing.ts` | `baselineMode`, `autoApply`, `expectedProviderModelId`; margins stay in published catalog |
| **PROVIDER_PRICE_SOURCE** | Per-provider adapters (Phase B+) | Phase A: CI `reference_*` as proxy; official HTML/API parsers not yet implemented |
| **CI_PROCUREMENT_PRICE** | `cheaperInferenceCatalogPricing.server.ts` → `cheaperInferenceCatalogPricing.ts` | `/v1/models` parser; 60s TTL per chat |
| **PRICE_SNAPSHOT_HISTORY** | `modelPricingTrackingSchema.ts` + `modelPricingTrackerPersistence.ts` | Append-only `model_price_snapshots` |
| **PRICE_CHANGE_CLASSIFICATION** | `modelPriceChangeClassifier.ts` | Event type → action table |
| **ACTIVE_BASELINE** | `publishedModelPricing.ts` (code-static) | Runtime snapshots observe; do not mutate in Phase A |
| **BASE_USER_CHARGE** | Live: `@/lib/points` → `pointsReasoningMargins.ts`; Cutover: `publishedUserCharge.ts` | No symbol `BASE_USER_CHARGE`; site promo uses `baseUserChargePoints` on Usage |
| **OFFICIAL_PROMOTION** | `officialProviderPromotion.ts` | DB CRUD; no REST admin route yet |
| **SITE_PROMOTION** | `sitePromotion.ts` + `sitePromotionPolicy.ts` | Pass-through 60% of official discount |
| **ACTUAL_REALIZED_MARGIN** | `procurementCost.ts` + `shadowPricing.ts` | CI current rates; margin floor watch in tracker |
| **PRICING_SCHEDULER** | `src/cron/financeScheduler.ts` (node-cron) | Daily 12:00 KST; HTTP cron only for subscription renew |
| **PRICE_CHANGE_NOTICE** | `boardPosts.ts` + `/api/admin/posts` | Requires admin auth; system writer separation needed for Phase B |

---

## MODEL INVENTORY

### Main RP user-selectable (daily tracked)

| modelId | Provider | baselineMode |
|---------|----------|--------------|
| `deepseek-v4-pro-0813` | cheaperinference | PROVIDER_PEAK |
| `gemini-3.1-pro-preview` | cheaperinference | PROVIDER_STANDARD |
| `gemini-3.7-flash` | cheaperinference | PROVIDER_STANDARD |
| `gpt-5.6-terra` | cheaperinference | PROVIDER_STANDARD |

### Published catalog (also tracked when policy exists)

Claude Opus 5, DeepSeek Flash, Luna, Gemini 3.6, Qwen, GLM, Kimi, OpenRouter slugs, etc.

---

## PROVIDER SOURCE MAP

| Model family | Phase A source | Phase B target |
|--------------|----------------|----------------|
| All CI-routed | `GET /v1/models` via `cheaperInferenceCatalogPricing.server.ts` | Same + official provider corroboration |
| Google Gemini | CI `reference_*` | Google AI pricing page / structured API |
| DeepSeek | CI `reference_*` | DeepSeek official pricing |
| Anthropic | CI `reference_*` | Anthropic pricing API |
| OpenAI (Terra) | CI `reference_*` | OpenAI pricing page |

**Phase A limitation:** `CI_REFERENCE_CHANGED_UNVERIFIED` when CI reference ≠ published baseline. Direct provider parsers = follow-up.

---

## SCHEDULER OWNER

**Production canonical:** `node-cron` registered in `server.js` → `startFinanceScheduler()`.

| Job | Owner | Trigger |
|-----|-------|---------|
| Finance snapshot + CI reconciliation | `financeScheduler.ts` | `0 12 * * *` Asia/Seoul |
| Model pricing tracker (Phase A) | `financeScheduler.ts` → `runModelPricingTracker()` | After finance snapshot |
| Subscription renew | `/api/cron/subscription-renew` | External HTTP + `CRON_SECRET` |

**Multi-replica:** In-memory `running` boolean in financeScheduler is insufficient for distributed dedup. Phase A uses DB idempotency via `model_pricing_tracker_runs.run_date_key` UNIQUE (KST date).

Disable: `DISABLE_MODEL_PRICING_TRACKER=1`

---

## PRICE SNAPSHOT DESIGN

Tables (append-only):

- `model_pricing_tracker_runs` — daily run idempotency
- `model_price_snapshots` — provider, modelId, pricingMode, rates, fingerprint, observedAt
- `model_price_change_events` — classified diffs with unique `event_fingerprint`
- `model_pricing_admin_events` — admin observability feed

Per model per run:

1. `published_billing_baseline` (from `publishedModelPricing.ts`)
2. `cheaper_inference_models_current` (procurement)
3. `cheaper_inference_models_reference` (provider list proxy)

---

## CHANGE CLASSIFIER

| Event Type | Action (Phase A) | User price impact |
|------------|------------------|-------------------|
| `PROVIDER_NORMAL_BASELINE_CHANGED` | `OBSERVE_ONLY_LOG` | None (Phase A) |
| `PROVIDER_SCHEDULED_BASELINE_CHANGED` | `OBSERVE_ONLY_LOG` | None (Phase A) |
| `CI_MARKET_DISCOUNT_CHANGED` | `PROCUREMENT_ONLY` | None |
| `PROCUREMENT_TIER_CHANGED` | `PROCUREMENT_ONLY` | None |
| `CI_REFERENCE_CHANGED_UNVERIFIED` | `HOLD` | None |
| `SOURCE_CONFLICT` | `HOLD` | None |
| `MODEL_ROUTING_CHANGED` | `HOLD` | None |
| `PARSER_FAILURE` | `ADMIN_ALERT` | None (fail-closed) |
| `OFFICIAL_TEMP_PROMOTION_*` | `ACTIVATE/END_PROMOTION` | Phase B via existing promo owners |

Large change threshold: `MODEL_PRICING_LARGE_CHANGE_THRESHOLD = 0.25` in `modelPricingTrackingConfig.ts`.

---

## AUTO APPLY POLICY (Phase B — not enabled)

Gates required before `AUTO_APPLY_BASE`:

- Exact model identity (`expectedProviderModelId`)
- Pricing mode confirmed
- Official source verified (not CI-only)
- `targetMargin` exists in published catalog
- Representative billing fixtures pass
- No promotion double-apply
- `MODEL_PRICING_TRACKER_PHASE=AUTO_APPLY_SAFE_EVENTS` + `policy.autoApply=true`

---

## PROMOTION PRESERVATION

- CI `discount_percent` → procurement only (`procurementPromotionSeparation.test.ts`)
- Official promos → `officialProviderPromotion` → `sitePromotion` → `applySitePromotionToTurnBilling`
- Published catalog `promo` field → separate self-funded path in `publishedUserCharge`
- CI discount is **not** an official promotion signal

---

## NOTICE OWNER / PUSH FLOW

1. Admin POST `/api/admin/posts` → `createAdminBoardPost()` → in-app + web push (notice board only)
2. Home popup: separate `homePopupNotice.ts` owner

**Phase B requirement:** Extract notice writer core from admin route for trusted system writer without bypassing auth boundary. **STOP if permission model must change.**

Auto notices: idempotent via `event_fingerprint` + pricing version linkage; grouped by provider + effectiveAt.

---

## IDEMPOTENCY

- Daily run: `run_date_key` UNIQUE (KST YYYY-MM-DD)
- Events: `event_fingerprint` UNIQUE on `model_price_change_events`
- Duplicate cron → `skipped_duplicate` status, no second snapshot batch for same date

---

## MARGIN FLOOR WATCH

`runModelPricingTracker()` checks representative workload:

- User charge from published baseline + `targetMargin`
- Procurement from CI current via `procurementCost.ts`
- If realized margin < `minimumMarginFloor` → `MARGIN_FLOOR_BREACH` admin event
- Does **not** silently change user price

---

## FAILURE / ROLLBACK

- CI fetch failure → fail-closed, keep active price, `PARSER_FAILED` admin event
- No 0/null rate writes
- Phase A never mutates `publishedModelPricing.ts` — rollback = no-op

---

## DB IMPACT

Additive only:

- 4 new tables via `ensureModelPricingTrackingSchema()` in `db.ts` boot migration
- No destructive migration

---

## DEAD SYSTEM AUDIT

| Item | Classification |
|------|----------------|
| Duplicate CI fetch in tracker vs chat route | **KEEP** — tracker uses same canonical refresh owner |
| `openRouterModelPricing.ts` static fallbacks | **KEEP** — legacy billing; drift monitored by admin pricing page |
| `premiumPricingCalibration.ts` | **FOLLOW-UP** — calibration-only; superseded by tracker for ongoing ops |
| `gemini37PricingPolicy.ts` shadow calibration | **KEEP** — evidence for G37 v2 decision |
| Second scheduler for pricing | **REMOVED** — integrated into financeScheduler |
| Notice writer in admin route only | **FOLLOW-UP** — extract for Phase B automation |

---

## REGRESSION TESTS

`src/lib/modelPricingTracker.test.ts` covers fixtures A, B, D, F, G, H, I (+ large-change hold, append-only snapshots).

Fixtures C, E deferred to Phase B (promotion activation + scheduled effectiveAt apply).

Run:

```bash
node --conditions=react-server --import tsx --test src/lib/modelPricingTracker.test.ts
```

---

## SYSTEM DELTA

### BEFORE

- Published rates code-static; no daily observation
- CI catalog in-memory only (60s TTL)
- No classified price change history
- Finance scheduler: reconciliation + finance snapshot only

### PROBLEM

Manual deployment required for any billing reference update; no audit trail for procurement vs baseline divergence.

### AFTER (Phase A)

- Daily OBSERVE_ONLY tracker after finance snapshot
- Persistent append-only snapshots + classified events
- Admin observability events (margin floor, conflicts, parser failures)
- Idempotent daily runs

### REMOVED

- (none — additive feature)

### PRESERVED

- All existing billing, promotion, notice, settlement owners unchanged
- `publishedModelPricing.ts` not auto-mutated

### REGRESSION RISKS

- Finance scheduler runtime extended (CI refresh + DB writes)
- Multi-replica: mitigated by date-key idempotency; not full distributed lock

### PROOF

- Unit/regression tests pass
- `npm run typecheck:app` clean

---

## NEXT STEPS (Phase B+)

1. Official provider source adapters (Google, DeepSeek, Anthropic, OpenAI)
2. Extract system notice writer from admin route
3. Candidate BASE recomputation + pricing version increment
4. Enable `AUTO_APPLY_SAFE_EVENTS` after OBSERVE_ONLY evidence review
5. Notice grouping by provider + effectiveAt
