# DeepSeek V4 Pro PEAK pricing v3 correction audit

**Fetched:** 2026-09-21 (UTC)  
**Official source:** https://api-docs.deepseek.com/quick_start/pricing  
**Service status:** deepseek-v4-pro active (DeepSeek-V4-Pro-0813)

## Official V4 Pro pricing (USD per 1M tokens)

| Component | OFF-PEAK | PEAK |
| --- | --- | --- |
| Cache hit (input) | $0.022 | $0.044 |
| Cache miss (input) | $0.66 | $1.32 |
| Output | $1.98 | $3.96 |

Off-peak = exactly 50% of peak.

## Root cause

Published catalog v2 used OFF-PEAK rates as stable user BASE (`V4_PRO_STABLE_BASELINE_USES_OFF_PEAK`).

Product policy requires official **PEAK** as stable user BASE; OFF-PEAK/CI discount is procurement benefit only.

## Candidate v3 row (deepseek-v4-pro-0813)

| Field | v2 (historical) | v3 (candidate) |
| --- | --- | --- |
| input | 0.66 | 1.32 |
| output | 1.98 | 3.96 |
| cache read | 0.022 | 0.044 |
| targetMargin | 0.50 | 0.50 |
| minimumMarginFloor | 0.40 | 0.40 |
| pricingVersion | 2 | 3 |
| publishedAt | 2026-09-02T09:00:00.000Z | 2026-09-21T09:00:00.000Z |

V4.1 Flash unchanged: 0.30 / 1.20 / 0.006, v1.

## Production Phase2 state

`PRODUCTION_PHASE2_FLAG_UNVERIFIED` — Railway variable `PHASE2_DEEPSEEK_PUBLISHED_BILLING_ENABLED` exists but enabled/disabled value not independently confirmed.

## MERGE

**NO** — user price change candidate pending GPT review of P impact matrix.
