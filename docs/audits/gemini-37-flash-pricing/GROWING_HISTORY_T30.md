# Gemini 3.7 Flash V2 growing-history T21–T30

```text
model = gemini-3.7-flash
price = V2
reasoning_effort = low
retry = 0
continuation = 0
recovery = 0
GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS = 0
```

## E. T21–T30

| Turn | input | billedOut | actualKRW | V2 P | computedP | margin% | catalog-stress% | finish | cacheRead |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|
| T21 | 75503 | 4593 | 74.605 | 71 | 71 | -5.1 | -5.9 | stop | 0 |
| T22 | 80133 | 3776 | 22.092 | 66 | 66 | 66.5 | -14.6 | stop | 0 |
| T23 | 83926 | 3400 | 76.469 | 66 | 66 | -15.9 | -16.8 | stop | 0 |
| T24 | 87338 | 4210 | 82.121 | 72 | 72 | -14.1 | -15 | stop | 0 |
| T25 | 91563 | 4276 | 85.573 | 72 | 72 | -18.9 | -19.8 | stop | 0 |
| T26 | 95850 | 3685 | 24.863 | 68 | 68 | 63.4 | -28.4 | stop | 0 |
| T27 | 99628 | 3572 | 89.017 | 68 | 68 | -30.9 | -32 | stop | 0 |
| T28 | 103212 | 5361 | 27.931 | 73 | 73 | 61.7 | -36 | stop | 0 |
| T29 | 108583 | 3490 | 21.969 | 69 | 69 | 68.2 | -39.6 | stop | 0 |
| T30 | 112091 | 4822 | 26.73 | 74 | 74 | 63.9 | -40.6 | stop | 0 |

## F. Final rolling (valid only)

| window | samples | revenue P | API raw KRW | realized margin% |
|---|---:|---:|---:|---:|
| T1–T20 shadow valid | 19 | 1142 | 433.654 | 62 |
| T21–T30 valid | 10 | 699 | 531.37 | 24 |
| T1–T30 valid | 29 | 1841 | 965.024 | 47.6 |

```text
valid samples = 29
realized margin = 47.6%
JUDGEMENT = TOO_LOW
price auto-change = forbidden
```
