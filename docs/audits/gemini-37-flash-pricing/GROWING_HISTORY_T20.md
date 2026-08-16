# Gemini 3.7 Flash growing-history T1–T20

```text
model = gemini-3.7-flash
reasoning_effort = low
GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS = 0
retry = 0
continuation = 0
recovery = 0
price table = UNCHANGED
T1–T10 = recorded actual assistant history
T11–T20 = live continuation
widget = NOT_INVOKED
```

T11 is STREAM_INCOMPLETE (`finish=null`, usage=0, 992 chars mid-stream). retry=0 so it was not re-called. Partial text was accumulated as the actual assistant output. T11 is excluded from valid rolling/band totals because 45P revenue / 0 KRW cost is not a real charge.

## A. T11–T20

| Turn | chars | apiInput | billedOut | cacheRead | cacheWrite | standardIn | upstreamUSD | catalogUSD | rawKRW | mainP | widgetP | finalP | margin% | latency | TTFT | finish |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| T11 | 992 | 0 | 0 | 0 | 0 | 0 | n/a | 0 | 0 | 45 | 0 | 45 | n/a (incomplete) | 6442 | 3030 | n/a |
| T12 | 6950 | 35658 | 4586 | 0 | 0 | 35658 | 0.030759 | 0.031 | 44.39 | 80 | 0 | 80 | 44.5 | 21523 | 2337 | stop |
| T13 | 6810 | 40255 | 4460 | 0 | 0 | 40255 | 0.016556 | 0.033 | 23.893 | 80 | 0 | 80 | 70.1 | 29456 | 9012 | stop |
| T14 | 6592 | 44729 | 4284 | 0 | 0 | 44729 | 0.016404 | 0.035 | 23.674 | 80 | 0 | 80 | 70.4 | 23440 | 2527 | stop |
| T15 | 6780 | 49051 | 4480 | 0 | 0 | 49051 | 0.017148 | 0.038 | 24.747 | 85 | 0 | 85 | 70.9 | 21514 | 1789 | stop |
| T16 | 7186 | 53547 | 4686 | 0 | 0 | 53547 | 0.018011 | 0.041 | 25.993 | 85 | 0 | 85 | 69.4 | 24027 | 1965 | stop |
| T17 | 7790 | 58249 | 5141 | 0 | 0 | 58249 | 0.017598 | 0.044 | 25.397 | 90 | 0 | 90 | 71.8 | 25093 | 3248 | stop |
| T18 | 5205 | 63402 | 3458 | 0 | 0 | 63402 | 0.013845 | 0.043 | 19.981 | 80 | 0 | 80 | 75 | 19012 | 2004 | stop |
| T19 | 6225 | 66879 | 4165 | 0 | 0 | 66879 | 0.015489 | 0.046 | 22.353 | 95 | 0 | 95 | 76.5 | 20566 | 2838 | stop |
| T20 | 6712 | 71065 | 4424 | 0 | 0 | 71065 | 0.016327 | 0.049 | 23.562 | 95 | 0 | 95 | 75.2 | 22571 | 2835 | stop |

## B. T1–T20 input growth

- T1: 4312
- T2: 5956
- T3: 8051
- T4: 10873
- T5: 14397
- T6: 17256
- T7: 19667
- T8: 22647
- T9: 26517
- T10: 30477
- T11: 0 (STREAM_INCOMPLETE, usage missing)
- T12: 35658
- T13: 40255
- T14: 44729
- T15: 49051
- T16: 53547
- T17: 58249
- T18: 63402
- T19: 66879
- T20: 71065

T1 4312 → T10 30477 → T20 71065

## C. Cache

- any cacheRead > 0: false
- any cacheWrite > 0: false
- T1/T10/T11/T20 cacheRead: 0 / 0 / 0 / 0

## D. Input-band margins (valid T1–T20, T11 excluded)

| band | turns | avg input | avg billed out | avg user P | avg actual KRW | realized margin% | min% | max% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 0~25K | 8 | 12894.875 | 2759.125 | 54.4 | 18.199 | 66.5 | 47.1 | 79.2 |
| 25~35K | 2 | 28497 | 4189.5 | 70 | 27.038 | 61.4 | 60.4 | 62.3 |
| 35~45K | 3 | 40214 | 4443.333 | 80 | 30.652 | 61.7 | 44.5 | 70.4 |
| 45~55K | 2 | 51299 | 4583 | 85 | 25.37 | 70.2 | 69.4 | 70.9 |
| 55~65K | 2 | 60825.5 | 4299.5 | 85 | 22.689 | 73.3 | 71.8 | 75 |
| 65K+ | 2 | 68972 | 4294.5 | 95 | 22.958 | 75.8 | 75.2 | 76.5 |

No band aggregate is below 50%. Single-turn lows: T8 47.1% (0~25K), T12 44.5% (35~45K, actual upstream 0.030759 vs later ~0.016).

## E. Rolling margins

| window | revenue P | API raw KRW | gross margin% | note |
|---|---:|---:|---:|---|
| T1–T10 | 575 | 199.664 | 65.3 | recorded complete |
| T12–T20 | 770 | 233.99 | 69.6 | valid T11–T20 |
| T1–T20 excl T11 | 1345 | 433.654 | 67.8 | **judgement window** |
| T11–T20 raw | 815 | 233.99 | 71.3 | includes invalid T11 45P/0KRW |

## F. 50K+ cold margins (cacheRead=0)

### 50K+
| Turn | input | billedOut | userP | actualKRW | actualUSD | catalogUSD | catalogKRW | actualMargin% | catalogMargin% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| T16 | 53547 | 4686 | 85 | 25.993 | 0.018011 | 0.041 | 58.742 | 69.4 | 30.9 |
| T17 | 58249 | 5141 | 90 | 25.397 | 0.017598 | 0.044 | 64.066 | 71.8 | 28.8 |
| T18 | 63402 | 3458 | 80 | 19.981 | 0.013845 | 0.043 | 61.619 | 75 | 23 |
| T19 | 66879 | 4165 | 95 | 22.353 | 0.015489 | 0.046 | 66.962 | 76.5 | 29.5 |
| T20 | 71065 | 4424 | 95 | 23.562 | 0.016327 | 0.049 | 71.147 | 75.2 | 25.1 |

### 60K+
| Turn | input | billedOut | userP | actualKRW | actualUSD | catalogUSD | catalogKRW | actualMargin% | catalogMargin% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| T18 | 63402 | 3458 | 80 | 19.981 | 0.013845 | 0.043 | 61.619 | 75 | 23 |
| T19 | 66879 | 4165 | 95 | 22.353 | 0.015489 | 0.046 | 66.962 | 76.5 | 29.5 |
| T20 | 71065 | 4424 | 95 | 23.562 | 0.016327 | 0.049 | 71.147 | 75.2 | 25.1 |

### 70K+
| Turn | input | billedOut | userP | actualKRW | actualUSD | catalogUSD | catalogKRW | actualMargin% | catalogMargin% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| T20 | 71065 | 4424 | 95 | 23.562 | 0.016327 | 0.049 | 71.147 | 75.2 | 25.1 |

## G. Verdict

```text
T1–T20 valid (excl T11) realized gross margin = 67.8%
JUDGEMENT = PRICE_HIGH_CANDIDATE
band aggregate <50% = none
single-turn <50% = T8 47.1%, T12 44.5%
50K+/60K+/70K+ actual cold margins = 69.4–76.5%
50K+ catalog theoretical margins = 23.0–30.9% (not used for judgement)
price auto-change = forbidden
```

Actual upstream stays far below catalog rates at 50K–71K. Price numbers were not changed.
