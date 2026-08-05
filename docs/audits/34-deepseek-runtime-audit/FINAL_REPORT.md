# DeepSeek provider truncation & tail-stability audit

## Verdicts (separated axes)

| Axis | Verdict |
|---|---|
| A. PROVIDER_TRUNCATION | `UPSTREAM_PROVIDER_INSTABILITY_CONFIRMED` |
| B. VALID_EARLY_STOP (1610) | `VALID_MODEL_EARLY_STOP` |
| C. VALID_RHYTHM_REGRESSION | `RHYTHM_REGRESSION_SYSTEMIC` |

Provider route: `NO_PROVIDER_ROUTE_CORRELATION` (+ `PROVIDER_METADATA_UNAVAILABLE` for region/generation id)

## Attempt summary

- attempt count: **10**
- failed attempt ids: **A06, A08**
- failed provider routes: both `cheaperinference` / `deepseek-v4-pro` (same label as successes)

### Truncations

1. **A06** → `UPSTREAM_PROVIDER_STREAM_TRUNCATED` (1347, finish=null, RAW=SSE=DB)
2. **A08** → `UPSTREAM_PROVIDER_STREAM_TRUNCATED` (99, finish=null, mid-sentence; persist rejected)

Runtime root: **`UPSTREAM_PROVIDER_INSTABILITY_CONFIRMED`**

### 1610 early-stop (not truncation)

- finish=stop, usage present, near-parity (trailing postprocess artifact only)
- terminal length owner / SHORT HISTORY dense-internal / ACTIVE_DYAD / 3-beat directive: **present/applied**
- grammatically complete; premature closure / staff exit; reaction opening present
- verdict: **`VALID_MODEL_EARLY_STOP`** (functional length-floor issue, separate from transport)

### Rhythm (valid n=6)

- resume mean/median/max: **1.9567 / 2.095 / 3.11**
- resume outputs >1.2: **4/6**
- fragmentation mean/median/max: **1.8267 / 1.875 / 2.25**
- fragmentation outputs >1.5: **4/6**
- verdict: **`RHYTHM_REGRESSION_SYSTEMIC`**

## Runtime probe / reconfirm

- runtime probe: **not executed** (offline cause confirmed)
- post-fix runtime probe: **not executed** (no fix shipped)
- functional reconfirmation: **blocked** until transport reliability

## Cross-model

- inventory ready: **YES** → `docs/audits/35-cross-model-inventory/`
- live cross-model ready: **NO**

## Next isolated issue

PROVIDER_TRANSPORT_FAILOVER_OR_PINNING_CANARY — transport-incomplete only (finish missing / stream done missing / mid-sentence RAW); do NOT retry finish=stop short outputs; do NOT change SHORT HISTORY / ACTIVE_DYAD / beats / terminal owner

## Safety

production DB apply: NO · general rollout: NO · auto merge: NO · auto deploy: NO · canary enabled after test: NO
