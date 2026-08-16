# Opus tier shadow replay

This VM has no production Railway `DATA_DIR` / Turso credentials.
The script is SELECT-only and did not create a local DB, write rows,
recharge users, call an LLM, or change tier numbers.

```text
dbWrite = false
recharge = false
llmCalls = 0
priceAutoChanged = false
dbStatus = DB_UNAVAILABLE
sampleTurns = 0
AVAILABLE_SAMPLE_ONLY = true
recommendation = AVAILABLE_SAMPLE_ONLY
표본이 20턴 미만이므로 45% 달성 여부를 확정하지 않는다.
```

## Windows

### all
- sample turns: 0
- avg output chars: null
- avg input tokens: null
- avg old charge: null
- avg new charge: null
- total API cost: 0
- total new revenue: 0
- new realized gross margin %: null
- cold-write turn count: 0
- p50 new charge: null
- p90 new charge: null
- max new charge: null
- AVAILABLE_SAMPLE_ONLY: true

### last20
- sample turns: 0
- avg output chars: null
- avg input tokens: null
- avg old charge: null
- avg new charge: null
- total API cost: 0
- total new revenue: 0
- new realized gross margin %: null
- cold-write turn count: 0
- p50 new charge: null
- p90 new charge: null
- max new charge: null
- AVAILABLE_SAMPLE_ONLY: true

### last50
- sample turns: 0
- avg output chars: null
- avg input tokens: null
- avg old charge: null
- avg new charge: null
- total API cost: 0
- total new revenue: 0
- new realized gross margin %: null
- cold-write turn count: 0
- p50 new charge: null
- p90 new charge: null
- max new charge: null
- AVAILABLE_SAMPLE_ONLY: true

### last100
- sample turns: 0
- avg output chars: null
- avg input tokens: null
- avg old charge: null
- avg new charge: null
- total API cost: 0
- total new revenue: 0
- new realized gross margin %: null
- cold-write turn count: 0
- p50 new charge: null
- p90 new charge: null
- max new charge: null
- AVAILABLE_SAMPLE_ONLY: true


## Volatility

- old charge range: null
- new charge range: null
- old p90-p10: null
- new p90-p10: null
- old max single-turn charge: null
- new max single-turn charge: null
- 620P hard-cap applied count: 0

FINAL_WINNER / PRICE_CHANGE = NOT_APPLIED
