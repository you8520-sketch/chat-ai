# Muse pricing sanity — Audit 52

Do **not** change production pricing from this bake-off.

```text
actual-cost sample count = 6
average actual cost KRW = 27.183333333333334
median actual cost KRW = 27.7
average charged points = 76.33333333333333
gross margin = 0.643886462882096
cost per 1000 visible chars = 11.327175498298493
p50 latency = 28.842
p95 latency = 37.925
429/error rate (action attempts) = 0
MUSE_RELATIONSHIP_COST_INCOMPLETE
```

Actual cost uses `apiRawCostKrw` from provider receipts — not inferred from charged points.
Frozen Audit 49 relationship metas store api_raw_cost_krw + points but lack usage.cost / token splits.
