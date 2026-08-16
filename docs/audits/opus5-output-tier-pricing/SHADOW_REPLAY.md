# Opus 5 tier shadow replay

```text
dbWrite = false
recharge = false
llmCalls = 0
priceAutoChanged = false
modelFilter = claude-opus-5
dbStatus = DB_UNAVAILABLE
sampleTurns = 0
AVAILABLE_SAMPLE_ONLY = true
verdict = AVAILABLE_SAMPLE_ONLY
sample < 20 — 가격 확정 금지.
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
- p10 new charge: null
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
- p10 new charge: null
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
- p10 new charge: null
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
- p10 new charge: null
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

## Railway SSH (production, SELECT-only)

This VM has no production `/data/app.db`. Run inside the live Railway service:

```bash
railway ssh
node scripts/opus5-tier-shadow-railway.cjs
```

If that file is not in the running image, paste the same script:

```bash
railway ssh
node <<'ENDSCRIPT'
# contents of scripts/opus5-tier-shadow-railway.cjs
ENDSCRIPT
```

Opens `/data/app.db` readonly. Prints aggregates only. No user text. No writes.
