# OpenScale DeepSeek V4.1 Flash RP Pilot

Status: **PREVALIDATION_SUCCEEDED — LIVE POST PENDING IN THIS REVISION**

This is an isolated provider experiment. It is not a production supplier promotion.

Audit baseline: `7573e6fd3552a5802e97d1507f8f671d361447a2` (`origin/main`).

## BEFORE

Current Main RP DeepSeek path on `origin/main`:

- Logical picker model: `deepseek-v4.1-flash`
- Production transport: CheaperInference only
- Production wire model: `deepseek-v4.1-flash`
- OpenScale is absent from the picker, compatible transport, ledger, and Railway config

Existing isolated experiment owners already cover Fluence qualification, scene-policy synthetic fixtures, and an SSE reader. This pilot reuses those owners and does not add a production provider.

## OWNER MAP

| Responsibility | Confirmed current-main owner |
| --- | --- |
| Logical model registry / picker | `src/lib/chatModels.ts#MAIN_RP_USER_SELECTABLE_OPTIONS` |
| Compatible production transport | `src/lib/openRouterAdult.ts#resolveCompatibleTransport` — OpenRouter + CheaperInference only |
| CheaperInference endpoint / DeepSeek TRUE-OFF | `src/lib/cheaperInferenceConfig.ts` |
| Final prompt assembly | `src/services/contextBuilder.ts#buildContext` |
| Primary RP wire assembly | `src/lib/openRouterAdult.ts#assemblePrimaryRpRequest` |
| Sampling | `src/lib/openRouterClient.ts#normalizeOpenRouterGenerationParams` — DeepSeek temperature `0.92`, `top_p` `0.92`, `max_tokens` omitted |
| Streaming | `/api/chat` → `streamOpenRouterAdult`; isolated SSE reader `scripts/lib/compatibleSupplyProbe.ts` |
| User-authoring | `src/lib/userAuthoringPolicy.ts` default `NORMAL`; live block `src/lib/noGodmodding.ts#COLLABORATIVE_INTERACTIVE_OWNER_BLOCK` |
| Usage / billed-cost parser | `src/lib/openRouterUsage.ts#parseCompatibleUsage` |
| Provider cost ledger | `src/lib/providerCostLedger.ts` — this pilot writes no ledger rows |
| Published CI billing reference | `src/lib/publishedModelPricing.ts` `deepseek-v4.1-flash` `$0.30 / $1.20 / $0.006` |
| Synthetic RP fixture | `src/lib/scenePolicyBenchmarkDataset.ts` `B03a` 한서린/민 |
| This isolated contract | `scripts/lib/openscaleDeepseekV41FlashRpPilot.ts` |

## TEST EXECUTION

Prevalidation GET `/v1/models` was executed in an isolated environment with `OPENSCALE_KEY`. Inference POSTs in that step: **0**.

Auth status: **200**. No 401/402/403.

Live inference POST is gated by `OPENSCALE_RP_PILOT=1` and is executed only after this draft lands.

Deterministic tests: pending in this revision; they use mocked fetch only.

## API MODEL LIST

`GET https://api.openscale.so/v1/models` → **200**.

Observed model IDs:

- `deepseek/deepseek-v4.1-flash`

Catalog fields used:

- `is_ready`: true
- streaming: true
- prompt: `$0.00000006` / token = **$0.06 / 1M**
- cached_prompt: `$0.000000003` / token = **$0.003 / 1M**
- completion: `$0.00000024` / token = **$0.24 / 1M**
- `reasoning_effort`: `none | minimal | low | medium | high | xhigh`
- max output: 384000 tokens
- context: 1048568 tokens

Homepage marketing rates match the catalog: input $0.06, cached $0.003, output $0.24 per 1M.

Balance/credit GET endpoints (`/credits`, `/account`, `/usage`, `/billing`, `/dashboard/billing/credit_grants`) returned **404**. Dashboard actual deduction is **NOT_OBSERVED via API**. Auto-recharge was not changed.

## ACTUAL OUTPUT

Not yet captured in this revision. The live runner will use synthetic fixture `B03a` only. No real user chat, PII, or adult content.

## USAGE / COST

Screening rates are catalog-observed, not an invoice cap.

Conservative preflight for the assembled synthetic prompt uses 8000 output tokens. The fixture assembly is expected to stay under the $0.02 screening budget. That budget is a review screen, not a billed maximum.

CheaperInference comparison uses already-saved 2026-09-21 samples only. No new CheaperInference POST is made. Those samples used different fixtures and are **not a fair A/B**.

| Source | Input / 1M | Cached / 1M | Output / 1M | Notes |
| --- | --- | --- | --- | --- |
| OpenScale catalog 2026-10-09 | $0.06 | $0.003 | $0.24 | Observed on GET `/v1/models` |
| HAV published CI reference | $0.30 | $0.006 | $1.20 | User-charge reference, not a live CI invoice |
| Saved CI RP samples 2026-09-21 | not billed here | sample-dependent | not billed here | Different fixtures; not A/B |

## STREAMING METRICS

Pending live POST.

## SECURITY PROOF

- Key is read only from `OPENSCALE_KEY`
- Key is not written to git, report, or production env files
- Runner never falls back to `CHEAPER_INFERENCE_API_KEY` / `OPENROUTER_API_KEY`
- `regularTestEgressPolicy` now deletes `OPENSCALE_KEY`
- No experimental DB writes
- No Railway production env changes

## REGRESSION PROOF

Production owners are not modified:

- `src/lib/chatModels.ts`
- `src/lib/cheaperInferenceConfig.ts`
- `src/lib/openRouterAdult.ts`
- `src/app/api/chat/route.ts`
- billing / points / settlement
- model picker UI

The only `src/` edit is test egress isolation.

## SYSTEM DELTA

Added:

- `scripts/lib/openscaleDeepseekV41FlashRpPilot.ts`
- `scripts/openscale-deepseek-v41-flash-rp-pilot.ts`
- `scripts/lib/openscaleDeepseekV41FlashRpPilot.test.ts`
- this report
- `OPENSCALE_KEY` strip in `src/lib/test/regularTestEgressPolicy.ts`

Removed: none.

## FOLLOW-UP

- Capture exactly one live streaming POST after this draft
- Operator dashboard check for actual deduction
- GPT quality review of the raw Korean output
- No production routing, picker, or billing change in this PR
