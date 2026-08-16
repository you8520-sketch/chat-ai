# Gemini 3.7 Flash user pricing

Branch starts from PR #426 (`cursor/gemini-37-flash-baseline`). No merge/deploy. No 3.7 style/length adapter. `reasoning_effort=low` unchanged. Other model billing unchanged.

## A. Pricing function / code path

User price is only:

`base + input surcharge + output surcharge`

Implemented in `src/lib/gemini37FlashPricing.ts` and hooked only for exact `gemini-3.7-flash` in:

- `computeOpenRouterTurnCost`
- `computeOpenRouterTurnBilling` (skips user-note surcharge)
- `explainOpenRouterGemini37TurnCost` / `explainOpenRouterGeminiTurnCost`
- `/api/chat` usage record → `usage.gemini37FlashPricing`

`cacheReadTokens`, `cacheWriteTokens`, `standardInputTokens`, `upstreamCostUsd`, and `actualApiCostKrw` are admin/telemetry only. They never enter the user-price formula.

Defaults (this test did not override env):

- base 45P
- included input 25,000
- input step 10,000 tokens / +5P
- output tiers 2500=0 / 4000=15 / 5500=25 / 7000=35 / 9000=45
- over 9000: +10P per extra 1,500 billed output tokens

Billed output = provider completion tokens. If reasoning is already inside `completion_tokens`, that total is used. If reasoning is separate and billed extra, `max(completion, content + reasoning)` avoids double-counting. Visible RP character count is not used.

## B. Exact model detector

`isCheaperInferenceGemini37FlashModel()` in `src/lib/chatModels.ts`:

`modelId.trim().toLowerCase() === "gemini-3.7-flash"`

Not applied to Gemini 3.1 / 3.6 / 2.x, `google/gemini-3.7-flash`, DeepSeek, Opus, Luna, or Terra.

## C. Example price table

| input | billed output | formula | user P |
|---|---:|---|---:|
| 20,000 | 2,000 | 45+0+0 | 45 |
| 22,947 | 3,897 | 45+0+15 | 60 |
| 30,000 | 3,000 | 45+5+15 | 65 |
| 40,000 | 3,000 | 45+10+15 | 70 |
| 50,000 | 3,000 | 45+15+15 | 75 |
| 53,823 | 4,444 | 45+15+25 | 85 |
| 70,000 | 4,000 | 45+25+15 | 85 |
| 100,000 | 6,000 | 45+40+35 | 120 |

No hard cap.

## D. Competitor 62P comparison

Fixture: input 22,947 / billed output 3,897 (content 1,725 + reasoning 2,172 if already inside completion).

- competitor: 62P
- ours: 60P (−2P)

Catalog rates (unchanged): input $0.53/1M, cached input $0.02625/1M, output $2.63/1M. FX snapshot 1443.158 KRW/USD.

| cache | catalog KRW | user | margin |
|---|---:|---:|---:|
| cold 0% | 32.343 | 60P | 46.1% |
| 25% | 28.172 | 60P | 53.0% |
| 50% | 24.001 | 60P | 60.0% |
| 75% | 19.831 | 60P | 66.9% |

Same 50K/3K cold vs warm user price is 75P in both cases.

## E. T1–T10 growing-history

Same 조태형 / 렌 seed as #426. Production `buildContext` → `assemblePrimaryRpRequest` → Cheaper Inference. 1 main API call/turn. retry=0, continuation=0, recovery=0. `reasoning_effort=low`. No 3.7-specific prompt. Assistant outputs accumulated into the next turn.

| Turn | chars | apiInput | billedOut | content | reasoning | cacheRead | cacheWrite | standardIn | upstreamUSD | rawKRW | mainP | widgetP | finalP | margin% | latency | TTFT | finish |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| T1 | 2569 | 4312 | 1613 | 1613 | 0 | 0 | 0 | 4312 | 0.006499 | 9.379 | 45 | 0 | 45 | 79.2 | 16120 | 3122 | stop |
| T2 | 3225 | 5956 | 2086 | 2086 | 0 | 0 | 0 | 5956 | 0.008603 | 12.415 | 45 | 0 | 45 | 72.4 | 20231 | 3380 | stop |
| T3 | 4425 | 8051 | 2790 | 2790 | 0 | 0 | 0 | 8051 | 0.011551 | 16.670 | 60 | 0 | 60 | 72.2 | 24553 | 3004 | stop |
| T4 | 5475 | 10873 | 3515 | 3515 | 0 | 0 | 0 | 10873 | 0.013335 | 19.245 | 60 | 0 | 60 | 67.9 | 28788 | 2013 | stop |
| T5 | 4389 | 14397 | 2844 | 2844 | 0 | 0 | 0 | 14397 | 0.011819 | 17.057 | 60 | 0 | 60 | 71.6 | 24116 | 2208 | stop |
| T6 | 3699 | 17256 | 2400 | 2400 | 0 | 0 | 0 | 17256 | 0.015360 | 22.167 | 45 | 0 | 45 | 50.7 | 20242 | 2252 | stop |
| T7 | 4628 | 19667 | 2972 | 2972 | 0 | 0 | 0 | 19667 | 0.011711 | 16.901 | 60 | 0 | 60 | 71.8 | 26030 | 3000 | stop |
| T8 | 6000 | 22647 | 3853 | 3853 | 0 | 0 | 0 | 22647 | 0.022004 | 31.755 | 60 | 0 | 60 | 47.1 | 30749 | 2598 | stop |
| T9 | 6140 | 26517 | 3945 | 3945 | 0 | 0 | 0 | 26517 | 0.017857 | 25.770 | 65 | 0 | 65 | 60.4 | 31963 | 3185 | stop |
| T10 | 6835 | 30477 | 4434 | 4434 | 0 | 0 | 0 | 30477 | 0.019613 | 28.305 | 75 | 0 | 75 | 62.3 | 34514 | 3338 | stop |

Provider did not report a separate reasoning token field. `completion_tokens` was used as billed output.

## F. Cache hit behavior

- T1 input 4,312 → T10 input 30,477 (Δ +26,165)
- `cacheReadTokens` stayed 0 on every turn
- `cacheWriteTokens` stayed 0
- cache hit % = 0%
- `cacheRead` did **not** grow with input on this Cheaper Inference live path

Cache implementation was not changed. User price is independent of cache: same input/output always same P.

## G. Actual rolling margin

Last 10 test turns:

- total revenue: 575P
- total API raw cost: 199.664 KRW (provider `upstreamCostUsd` × 1443.158)
- realized gross margin: **65.3%**

This run was entirely cold/cache-miss. No env/price retune.

## H. Cold vs warm margin

Competitor fixture 22,947 / 3,897 → 60P, catalog rates:

- cold: 46.1%
- 25% cache: 53.0%
- 50% cache: 60.0%
- 75% cache: 66.9%
- live observed (all cacheRead=0): 65.3% rolling, per-turn 47.1%–79.2%

Live 10-turn band coverage: only the 30K input band was reached (T9–T10). Avg user 70P / avg raw 27.038 KRW. 40K–70K+ bands were not reached in 10 lobby turns.

## I. Widget final charge

Current general-model widget policy kept. No Opus-style widget bundle.

This harness does not invoke status-widget extract.

- main RP user charge: per-turn table
- widget user charge: 0P (`NOT_INVOKED`)
- final deducted points: same as main
- main API raw cost: per-turn `rawKRW`
- widget API raw cost: 0

## J. Changed files

- `src/lib/gemini37FlashPricing.ts`
- `src/lib/gemini37FlashPricing.test.ts`
- `src/lib/points.gemini37Flash.test.ts`
- `src/lib/points.ts`
- `src/lib/chatUsage.ts`
- `src/lib/billingDisplay.ts`
- `src/components/BillingReceiptTooltip.tsx`
- `src/lib/refundMessageReceipt.ts`
- `src/app/api/chat/route.ts`
- `.env.example`
- `scripts/gemini-37-flash-growing-history.ts`
- `docs/audits/gemini-37-flash-pricing/*`

Unchanged: RP prompt, memory, RAW/history, rolling summary, cache implementation, Gemini 3.1/3.6/2.x, DeepSeek, Opus, Luna, Terra, #424, 3.7 length/style adapter.

## K. Tests / typecheck

```text
node --conditions=react-server --import tsx --test \
  src/lib/gemini37FlashPricing.test.ts \
  src/lib/points.gemini37Flash.test.ts \
  src/lib/points.geminiPro.test.ts
# 28/28 pass

npm run typecheck:app
# exit 0
```

Required cases locked: 22947/3897=60P, 20K/2K=45P, 30K/3K=65P, 40K/3K=70P, 50K/3K=75P, 53823/4444=85P, cold vs warm same 75P, waived=0P, Gemini 3.1 / DeepSeek / Opus unchanged.

## L. PR / SHA

- Draft PR: https://github.com/you8520-sketch/chat-ai/pull/429
- Head SHA: `2b4405dfa5cb4ffafb4c01fa2a479f0d24f5b2f6`

No merge/deploy.
