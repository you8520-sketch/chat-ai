# 06_LIVE_RESULTS

## API accounting

```text
Gemini successful calls: 4
DeepSeek successful calls: 4
Opus successful calls: 0
Terra successful calls: 0
transport aborted: 0
quality retries: 0
continuations: 0
recoveries: 0
```

C1 max successful = 12. Stage 2 (Opus+Terra) **not run** — cheap-model quality gate failed.

## Fixtures

| id | character | purpose | provenance |
|---|---|---|---|
| D | c18 라이크 | dialogue / multi-speaker | opus-quality-anchor + STEP A short input; lobby greeting multi-NPC |
| N | c5 저주받은 북부대공 | narration-dense | opus-quality-anchor `rel_conflict` T1 |

NORMAL turns only. Arms differ only by OUTPUT LAYOUT system block swap.

## Layout tokens

```text
layout_A = 670 est
layout_B = 281 est
reduction = 389 (58.1%)
ESTIMATED_UNCACHED_TOKEN_REDUCTION = 389
ESTIMATED_CACHEABLE_TOKEN_REDUCTION = 0
```

## Actual provider usage (where present)

| cell | input_tokens | cached | output_tokens | Δ input vs A |
|---|---:|---:|---:|---:|
| Gemini_D_A | 10457 | 10221 | 2079 | — |
| Gemini_D_B | 10282 | 10046 | 3941 | −175 |
| Gemini_N_A | 3580 | 3342 | 9766 | — |
| Gemini_N_B | 3405 | 3167 | 2398 | −175 |
| DeepSeek_D_A | 13495 | 1024 | 2877 | — |
| DeepSeek_D_B | 13309 | 9728 | 3041 | −186 |
| DeepSeek_N_A | 5374 | 1024 | 1827 | — |
| DeepSeek_N_B | null | null | null | n/a |

Measured input savings on paired cells with usage ≈ **536 tokens** total (cache effects dominate; layout delta is smaller than estimator on warm cache).

## Hard format / agency (PROVIDER_RAW refined)

Refined glue detector excludes Korean reported-speech quotes (`"…"고/라고`).

| pair | hard format B-only | agency A | agency B | notes |
|---|---|---:|---:|---|
| Gemini_D | 0 | 0 | 0 | B longer / denser |
| Gemini_N | 0 glued | 0 | 0 | B much shorter; weaker density |
| DeepSeek_D | 0 glued | 0 | 0 | both solid |
| DeepSeek_N | **completion fail on B** | 0 | 0 | B truncates mid-sentence; echoes user dialogue line |

Raw artifact paths: `/opt/cursor/artifacts/rp-prompt-step-c1-layout-ab/live/*`

Full JSON: `06_LIVE_RESULTS_cheap.json`
