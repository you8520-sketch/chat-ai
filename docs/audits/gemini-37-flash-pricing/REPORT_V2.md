# Gemini 3.7 Flash pricing V2

No RP prompt / length / reasoning / routing / memory / cache changes. No merge/deploy. Other model prices unchanged.

## A. V1 → V2 shadow table

See `SHADOW_V2.md`. Valid T1–T20 exclude T11. Code formula, not hand edit.

| metric | V1 | V2 |
|---|---:|---:|
| revenue | 1345P | 1142P |
| API raw cost | 433.654 KRW | 433.654 KRW |
| realized margin | 67.8% | 62.0% |
| average P | 70.8 | 60.1 |
| p10 / p50 / p90 | 45 / 75 / 91 | 35 / 64 / 69.2 |
| max | 95 | 70 |

Expected check matched: V2 revenue 1142P, V2 margin 62.0%, cost delta 0.

## B. Aggregate margin

Shadow valid 19 turns: 62.0% (59–63% band). Price numbers were not changed again after shadow.

T21–T30 live valid 10 turns: 24.0% because 5/10 turns reported actual upstream near catalog (74–89 KRW) while the other 5 stayed ~22–28 KRW.

T1–T30 valid 29 turns: 47.6%.

## C. Competitor fixture

`22947 / 3897` = 35 + 0 + 25 = **60P**. Competitor 62P. Locked in unit tests.

## D. Incomplete-stream actual charge

T11 harness showed `mainP=45` because the price function still computes base P on 0/0 tokens. Production billing owner now waives `finish=null + usage=0` to **0P**. `deductPoints(..., 35)` is not called. Test: `finish=null + usage=0 incomplete stream => final user charge 0P`.

## E. T21–T30

All 10 valid (`finish=stop`, cacheRead=0). V2 P 66–74.

Actual-cost split:

- cheap actual: T22 22.092, T26 24.863, T28 27.931, T29 21.969, T30 26.730
- catalog-like actual: T21 74.605, T23 76.469, T24 82.121, T25 85.573, T27 89.017

Catalog-stress margins on T21–T30 are all negative. Realized-margin source of truth remains actual upstream.

## F. Final rolling

| window | samples | revenue P | API raw KRW | realized margin% |
|---|---:|---:|---:|---:|
| T1–T20 shadow valid | 19 | 1142 | 433.654 | 62.0 |
| T21–T30 valid | 10 | 699 | 531.370 | 24.0 |
| T1–T30 valid | 29 | 1841 | 965.024 | 47.6 |

```text
valid samples = 29 (>=20)
JUDGEMENT = TOO_LOW
price auto-change = forbidden
```

## G. Tests / typecheck

```text
node --conditions=react-server --import tsx --test \
  src/lib/gemini37FlashPricing.test.ts \
  src/lib/points.gemini37Flash.test.ts \
  src/lib/points.geminiPro.test.ts
# 45 pass

npm run typecheck:app
# exit 0
```

## H. Head SHA

Recorded after push.
