# Gemini 3.7 Flash growing-history pricing live test

T11–T20 continuation: `GROWING_HISTORY_T20.md`. Price table unchanged.

```text
model = gemini-3.7-flash
reasoning_effort = low
GEMINI_37_MODEL_SPECIFIC_PROMPT_CHARS = 0
retry = 0
continuation = 0
recovery = 0
widget = NOT_INVOKED
```

## T1–T10

| Turn | chars | apiInput | billedOut | content | reasoning | cacheRead | cacheWrite | standardIn | upstreamUSD | rawKRW | mainP | widgetP | finalP | margin% | latency | TTFT | finish |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| T1 | 2569 | 4312 | 1613 | 1613 | 0 | 0 | 0 | 4312 | 0.006499 | 9.379 | 45 | 0 | 45 | 79.2 | 16120 | 3122 | stop |
| T2 | 3225 | 5956 | 2086 | 2086 | 0 | 0 | 0 | 5956 | 0.008603 | 12.415 | 45 | 0 | 45 | 72.4 | 20231 | 3380 | stop |
| T3 | 4425 | 8051 | 2790 | 2790 | 0 | 0 | 0 | 8051 | 0.011551 | 16.67 | 60 | 0 | 60 | 72.2 | 24553 | 3004 | stop |
| T4 | 5475 | 10873 | 3515 | 3515 | 0 | 0 | 0 | 10873 | 0.013335 | 19.245 | 60 | 0 | 60 | 67.9 | 28788 | 2013 | stop |
| T5 | 4389 | 14397 | 2844 | 2844 | 0 | 0 | 0 | 14397 | 0.011819 | 17.057 | 60 | 0 | 60 | 71.6 | 24116 | 2208 | stop |
| T6 | 3699 | 17256 | 2400 | 2400 | 0 | 0 | 0 | 17256 | 0.01536 | 22.167 | 45 | 0 | 45 | 50.7 | 20242 | 2252 | stop |
| T7 | 4628 | 19667 | 2972 | 2972 | 0 | 0 | 0 | 19667 | 0.011711 | 16.901 | 60 | 0 | 60 | 71.8 | 26030 | 3000 | stop |
| T8 | 6000 | 22647 | 3853 | 3853 | 0 | 0 | 0 | 22647 | 0.022004 | 31.755 | 60 | 0 | 60 | 47.1 | 30749 | 2598 | stop |
| T9 | 6140 | 26517 | 3945 | 3945 | 0 | 0 | 0 | 26517 | 0.017857 | 25.77 | 65 | 0 | 65 | 60.4 | 31963 | 3185 | stop |
| T10 | 6835 | 30477 | 4434 | 4434 | 0 | 0 | 0 | 30477 | 0.019613 | 28.305 | 75 | 0 | 75 | 62.3 | 34514 | 3338 | stop |

## Rolling last 10

- total revenue points: 575P
- total API raw cost: 199.664 KRW
- realized gross margin: 65.3%

## Cache

- T1 input 4312 / cacheRead 0 (0%)
- T10 input 30477 / cacheRead 0 (0%)
- cacheRead grew with input: false

## Competitor fixture 22947 / 3897 → 60P vs 62P

{
  "fixture": {
    "input": 22947,
    "billedOutput": 3897,
    "competitorPoints": 62,
    "ourPoints": 60
  },
  "krwPerUsd": 1443.158,
  "rows": [
    {
      "cacheHit": "0%",
      "cacheReadTokens": 0,
      "standardInputTokens": 22947,
      "catalogUsd": 0.022,
      "catalogKrw": 32.343,
      "userPoints": 60,
      "marginPct": 46.1
    },
    {
      "cacheHit": "25%",
      "cacheReadTokens": 5737,
      "standardInputTokens": 17210,
      "catalogUsd": 0.02,
      "catalogKrw": 28.172,
      "userPoints": 60,
      "marginPct": 53
    },
    {
      "cacheHit": "50%",
      "cacheReadTokens": 11474,
      "standardInputTokens": 11473,
      "catalogUsd": 0.017,
      "catalogKrw": 24.001,
      "userPoints": 60,
      "marginPct": 60
    },
    {
      "cacheHit": "75%",
      "cacheReadTokens": 17210,
      "standardInputTokens": 5737,
      "catalogUsd": 0.014,
      "catalogKrw": 19.831,
      "userPoints": 60,
      "marginPct": 66.9
    }
  ]
}
