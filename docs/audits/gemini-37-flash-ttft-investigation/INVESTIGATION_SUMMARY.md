# Gemini 3.7 Flash TTFT investigation — consolidated findings

**Final status:** `UPSTREAM_PROVIDER_BOUNDARY_LATENCY_CONFIRMED`

**DO NOT MERGE. DO NOT DEPLOY.**

## Hard invariants verified

| Check | Value |
|---|---|
| Endpoint | `https://api.cheaperinference.com/v1/chat/completions` |
| Model | `gemini-3.7-flash` |
| Production `reasoning_effort` | `low` |
| `thinking` / `reasoning` body keys | deleted (absent in final body) |
| Request headers | `Authorization`, `Content-Type` only |

## Provider-boundary telemetry (added)

`turnPhaseLatencyAudit` now reports:

- `T11_PROVIDER_RESPONSE_HEADERS` (legacy `T11_PROVIDER_HEADERS` still read)
- `FETCH_TO_HEADERS_MS` (T10→T11)
- `HEADERS_TO_FIRST_SSE_MS` (T11→T12)
- `FIRST_SSE_TO_VISIBLE_MS` (T12→T13)
- `VISIBLE_TO_SERVER_WRITE_MS` (T13→T14)
- `cheaper_inference_diagnostics` (`x-ci-request-id`, `x-ci-cache`, `x-ci-techniques`, `x-ci-tokens-saved`, `x-ci-saved-usd`)

## Experiment matrix (5 samples/arm, frozen production assembler body)

### Fixture: quiet-interaction (~4314 prompt tokens)

| VARIANT | MEDIAN_TTFT | P25 | P75 | MIN | MAX | MEDIAN_FETCH_TO_HEADERS | MEDIAN_HEADERS_TO_FIRST_SSE | REASONING | FAIL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A_production_low | 19337 | 19059 | 21248 | 18768 | 36538 | 19329 | 8 | 0 | 0 |
| A_reasoning_none | 9345 | 7434 | 20192 | 5044 | 24494 | 9336 | 8 | 0 | 0 |
| B_baseline_headers | 20229 | 19735 | 24847 | 18913 | 25939 | 20221 | 8 | 0 | 0 |
| B_ci_route_auto | 23235 | 19885 | 24835 | 17963 | 26663 | 23226 | 8 | 0 | 0 |

Slowest quiet / low: `d8efa758-ba23-4f23-b10f-bdb733abd4e1` (36538ms TTFT)  
Fastest quiet / low: `9fd9516d-8ce9-4770-b37e-fe042d987a5e` (18768ms)

### Fixture: action-event (~4414 prompt tokens)

| VARIANT | MEDIAN_TTFT | P25 | P75 | MIN | MAX | MEDIAN_FETCH_TO_HEADERS | MEDIAN_HEADERS_TO_FIRST_SSE | REASONING | FAIL |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A_production_low | 17946 | 17428 | 18989 | 16440 | 21841 | 17937 | 9 | 0 | 0 |
| A_reasoning_none | 18081 | 17435 | 19241 | 15037 | 52021 | 18073 | 8 | 1460 | 0 |
| B_baseline_headers | (same as A low arm) | | | | | | | | |
| B_ci_route_auto | not re-run on action fixture | | | | | | | | |

## Decision tree

### Production path (`reasoning_effort=low`) → CASE C

For both fixtures, **T10→T11 ≈99% of provider-visible TTFT**; T11→T13 ≈8–10ms total.

- Quiet median TTFT **19.3s** (matches prior ~18–19s evidence)
- Action median TTFT **17.9s**
- Prompt size (~4.3K tokens) is **not** the primary driver (same order of magnitude delay vs prior 22K measurements)

**No in-app prompt/transport fix warranted.** Escalate to CheaperInference with:

- `x-ci-request-id` samples above
- model `gemini-3.7-flash`, `reasoning_effort=low`
- p50/p75 ~19–21s FETCH_TO_HEADERS on 2026-08-30 VM runs

### Experiment A (`reasoning=none`) → inconclusive / not production-ready

Quiet fixture shows **median −9.9s (−51%)** vs low, but:

- P75 still **~20s**; MAX **~24s** (bimodal — not repeatable enough)
- Action fixture shows **no median improvement** (18081 vs 17946ms)
- Action arm reports **1460 reasoning tokens** despite `reasoning_effort=none` (billing/behavior mismatch risk)

**FAIL quality/cost gate for production adoption without human RP review and larger sample.**

No draft PR for reasoning policy change.

### Experiment B (`X-CI-Route:auto`) → rejected

Quiet fixture median TTFT **+3.0s worse** (23235 vs 20229ms). Model identity preserved (`models/gemini-3.7-flash`) but latency and economics fail the gate.

**No header change.**

### Experiment C/D

- Connection/TLS: FETCH_TO_HEADERS dominates; post-header phases ~8ms → **not a local pooling issue**
- CI cache: all samples `x-ci-cache: miss`, `x-ci-tokens-saved: 0` → **no cache correlation**

## Harness

```bash
AB_SAMPLES=5 node --conditions=react-server --import tsx scripts/gemini-37-flash-ttft-ab.ts
AB_FIXTURE=action AB_EXPERIMENTS=A node --conditions=react-server --import tsx scripts/gemini-37-flash-ttft-ab.ts
```

## Owner map

See `REPORT.md` owner audit JSON (unchanged from production code audit).
