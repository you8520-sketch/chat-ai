# Gemini 3.7 Flash pricing V3 shadow

No LLM calls. V2 table kept. Only change: long-context surcharge on `apiInputTokens` > 75,000.
`longContextSurcharge = ceil((input - 75000) / 10000) * 15`.
No RP prompt / length / reasoning / routing / memory / cache / widget / other-model / Opus #424 changes.
No merge/deploy. Price auto-change = forbidden.

## A. V2 → V3 29-turn shadow

Valid T1–T30 exclude T11. Cost source unchanged.

| metric | V2 | V3 |
|---|---:|---:|
| revenue | 1841P | 2201P |
| API raw cost | 965.024 KRW | 965.024 KRW |
| realized margin | 47.6% | 56.2% |

T1–T20 are all ≤75K, so V3 P = V2 P. T21–T30 pick up +15…+60P.

Full per-turn table: `SHADOW_V3.md`.

## B. V3 rolling margin

```text
valid samples = 29
API raw cost = 965.024 KRW (delta 0)
V2 revenue = 1841P (delta 0 vs expected)
V3 revenue = 2201P (delta 0 vs expected ~2201P)
V3 rolling gross margin = 56.2%
JUDGEMENT = PASS (55–60%)
price auto-change = forbidden
```

## C. T21–T30 V3 prices / margins

All 10 match the expected V3 prices.

| Turn | input | billedOut | V2 P | long | V3 P | expected | KRW | V3 margin |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| T21 | 75503 | 4593 | 71 | 15 | 86 | 86 | 74.605 | 13.2 |
| T22 | 80133 | 3776 | 66 | 15 | 81 | 81 | 22.092 | 72.7 |
| T23 | 83926 | 3400 | 66 | 15 | 81 | 81 | 76.469 | 5.6 |
| T24 | 87338 | 4210 | 72 | 30 | 102 | 102 | 82.121 | 19.5 |
| T25 | 91563 | 4276 | 72 | 30 | 102 | 102 | 85.573 | 16.1 |
| T26 | 95850 | 3685 | 68 | 45 | 113 | 113 | 24.863 | 78.0 |
| T27 | 99628 | 3572 | 68 | 45 | 113 | 113 | 89.017 | 21.2 |
| T28 | 103212 | 5361 | 73 | 45 | 118 | 118 | 27.931 | 76.3 |
| T29 | 108583 | 3490 | 69 | 60 | 129 | 129 | 21.969 | 83.0 |
| T30 | 112091 | 4822 | 74 | 60 | 134 | 134 | 26.730 | 80.1 |

Cheap vs catalog-like actuals still produce the same user P for the same input/output.

## D. 75K boundary tests

Locked in `src/lib/gemini37FlashPricing.test.ts`:

| input | long-context |
|---|---:|
| 75000 | +0 |
| 75001 | +15 |
| 85000 | +15 |
| 85001 | +30 |
| 95000 | +30 |
| 95001 | +45 |

V3 fixtures: 80K/4K=81, 90K/4K=97, 100K/4K=113, 110K/4K=129.

## E. Competitor fixture

`22947 / 3897` = 35 + 0 + 25 + 0 = **60P**. Also 30K/3K=61, 40K/3K=62, 50K/3K=63, 70K/4K=65. Unchanged from V2.

## F. Incomplete waiver

T11 `finish=null + usage=0`: computed 35P, final deducted **0P**, waived=`generation_failure`. Existing regression test kept.

## G. Tests / typecheck

```text
node --conditions=react-server --import tsx --test \
  src/lib/gemini37FlashPricing.test.ts \
  src/lib/points.gemini37Flash.test.ts \
  src/lib/points.geminiPro.test.ts
# 36 pass

npm run typecheck:app
# exit 0
```

## H. Head SHA

`37ea46d81781d0a2f0940081006f8bf856649521`
