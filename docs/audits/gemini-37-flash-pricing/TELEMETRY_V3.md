# Gemini 3.7 Flash V3 telemetry

Telemetry-only. V3 numbers unchanged. No LLM. No auto price change.

`krwPerUsd = 1443.158`
cheap/expensive = actual API KRW >= 70% of catalog list on apiInput+billedOutput.

## Production paid receipts

SELECT-only from production `messages.usage`.

- total messages: 3467
- usage messages: 1345
- gemini-3.7-flash messages: 0
- paid gemini-3.7-flash receipts: 0

| band | n | revenueP | rawKRW | margin% | avgP | avgIn | avgOut | cheap | expensive |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| <=75K | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 |
| 75K-85K | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 |
| 85K-95K | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 |
| 95K-105K | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 |
| >105K | 0 | 0 | 0 | n/a | n/a | n/a | n/a | 0 | 0 |

| window | n | revenueP | rawKRW | margin% |
|---|---:|---:|---:|---:|
| last20 | 0 | 0 | 0 | n/a |
| last50 | 0 | 0 | 0 | n/a |
| last100 | 0 | 0 | 0 | n/a |
| all | 0 | 0 | 0 | n/a |

>75K turn share: n/a%
>75K revenue share: n/a%
production verdict: **INSUFFICIENT_SAMPLES**

## Live shadow corpus (T1–T30 valid, T11 excluded)

This is the only Gemini 3.7 corpus with actual API cost. It is not a production user receipt set.

| band | n | revenueP | rawKRW | margin% | avgP | avgIn | avgOut | cheap | expensive |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| <=75K | 19 | 1142 | 433.654 | 62 | 60.1 | 33841.5 | 3691.4 | 9 | 10 |
| 75K-85K | 3 | 248 | 173.166 | 30.2 | 82.7 | 79854 | 3923 | 1 | 2 |
| 85K-95K | 2 | 204 | 167.694 | 17.8 | 102 | 89450.5 | 4243 | 0 | 2 |
| 95K-105K | 3 | 344 | 141.811 | 58.8 | 114.7 | 99563.3 | 4206 | 2 | 1 |
| >105K | 2 | 263 | 48.699 | 81.5 | 131.5 | 110337 | 4156 | 2 | 0 |

| window | n | revenueP | rawKRW | margin% |
|---|---:|---:|---:|---:|
| last20 | 20 | 1735 | 793.665 | 54.3 |
| last50 | 29 | 2201 | 965.024 | 56.2 |
| last100 | 29 | 2201 | 965.024 | 56.2 |
| all | 29 | 2201 | 965.024 | 56.2 |

>75K: n=10, turn share 34.5%, revenue 1059P (48.1%), cost 531.37 KRW, margin 49.8%

live-corpus verdict: **V3_PRODUCTION_CANDIDATE**

Owner is aggregate rolling margin, not per-turn or per-band 55–60%.
price auto-change = forbidden
