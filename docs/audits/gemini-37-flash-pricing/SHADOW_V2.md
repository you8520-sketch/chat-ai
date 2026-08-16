# Gemini 3.7 Flash V2 shadow reprice

No LLM calls. Valid T1–T20 exclude T11. Prices from `computeGemini37FlashUserChargeBreakdown`.

## A. V1 → V2 shadow table

| Turn | input | billedOut | old P | V2 P | actual API KRW | old margin | V2 margin |
|---|---:|---:|---:|---:|---:|---:|---:|
| T1 | 4312 | 1613 | 45 | 35 | 9.379 | 79.2 | 73.2 |
| T2 | 5956 | 2086 | 45 | 35 | 12.415 | 72.4 | 64.5 |
| T3 | 8051 | 2790 | 60 | 60 | 16.67 | 72.2 | 72.2 |
| T4 | 10873 | 3515 | 60 | 60 | 19.245 | 67.9 | 67.9 |
| T5 | 14397 | 2844 | 60 | 60 | 17.057 | 71.6 | 71.6 |
| T6 | 17256 | 2400 | 45 | 35 | 22.167 | 50.7 | 36.7 |
| T7 | 19667 | 2972 | 60 | 60 | 16.901 | 71.8 | 71.8 |
| T8 | 22647 | 3853 | 60 | 60 | 31.755 | 47.1 | 47.1 |
| T9 | 26517 | 3945 | 65 | 61 | 25.77 | 60.4 | 57.8 |
| T10 | 30477 | 4434 | 75 | 66 | 28.305 | 62.3 | 57.1 |
| T11 (excl, incomplete) | 0 | 0 | 45 | 0 | 0 | 100 | n/a |
| T12 | 35658 | 4586 | 80 | 67 | 44.39 | 44.5 | 33.7 |
| T13 | 40255 | 4460 | 80 | 67 | 23.893 | 70.1 | 64.3 |
| T14 | 44729 | 4284 | 80 | 67 | 23.674 | 70.4 | 64.7 |
| T15 | 49051 | 4480 | 85 | 68 | 24.747 | 70.9 | 63.6 |
| T16 | 53547 | 4686 | 85 | 68 | 25.993 | 69.4 | 61.8 |
| T17 | 58249 | 5141 | 90 | 69 | 25.397 | 71.8 | 63.2 |
| T18 | 63402 | 3458 | 80 | 64 | 19.981 | 75 | 68.8 |
| T19 | 66879 | 4165 | 95 | 70 | 22.353 | 76.5 | 68.1 |
| T20 | 71065 | 4424 | 95 | 70 | 23.562 | 75.2 | 66.3 |

T11 computed price function = 35P, final owner charge = 0P, waived = true.

## B. Aggregate (valid 19 turns)

| metric | value |
|---|---:|
| old revenue | 1345P |
| V2 revenue | 1142P |
| API raw cost | 433.654 KRW |
| expected valid cost | 433.654 KRW |
| cost delta vs expected | 0 |
| old realized margin | 67.8% |
| V2 realized margin | 62% |
| average old P | 70.8 |
| average V2 P | 60.1 |
| p10 / p50 / p90 old | 45 / 75 / 91 |
| p10 / p50 / p90 V2 | 35 / 64 / 69.2 |
| max old / V2 | 95 / 70 |

Expected check: V2 revenue ~1142P, V2 margin ~62%. Actual 1142P / 62%.
price auto-change = forbidden
