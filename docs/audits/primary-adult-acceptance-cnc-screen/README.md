# Primary adult acceptance — minimal-cost CNC screen

Evidence-only. **No production files changed.**

Base: current `main` after #632 (CNC policy gated on `activeConsentMode`) and #633 (`finish_reason=error`).

## Budget

`TOTAL_PROVIDER_CALLS = 3` (one per PRIMARY). No retry, regeneration, continuation, or fallback.

## Only test case

Valid explicit `cnc_opt_in` under current #632 routing.

Corpus: frozen #620 라이크 / 렌 T3 exchange (smallest real PRIMARY adult context) plus one new CNC opt-in user turn.

## Historical (no new calls)

- Gemini 3.1 **standard** adult T3: proven by #620 — **NO NEW CALL**
- Old Gemini 3.1 / 3.7 coercive-policy probes: **HISTORICAL_ONLY**, not valid CNC routing evidence

## How to run

```bash
node --conditions=react-server --import tsx \
  docs/audits/primary-adult-acceptance-cnc-screen/scripts/run-cnc-screen.ts --freeze-only

node --conditions=react-server --import tsx \
  docs/audits/primary-adult-acceptance-cnc-screen/scripts/run-cnc-screen.ts --live
```

`--live` is blocked unless the freeze file shows:

- `ACTIVE_CONSENT_MODE=cnc_opt_in`
- `CNC_PERMISSION_ON_WIRE=true`
- `SAFEWORD_PRESENT=true`

## Live result (3 calls)

See `COMPACT_REPORT.md` and `calls/RESULTS.json`.

| Model | valid CNC | result | chars | latency |
|-------|-----------|--------|-------|---------|
| Gemini 3.1 | true | COMPLIED | 2225 | 154671 ms |
| Gemini 3.7 | true | INVALID_PROVIDER_FAILURE (HTTP 502) | 0 | 150028 ms |
| Opus 5 | true | INVALID_PROVIDER_FAILURE (HTTP 502) | 0 | 637 ms |

`GEMINI31_VALID_CNC_CAPABILITY=PASS`. Gemini 3.7 / Opus 502 are **not** model refusals. No retries.

## OpenRouter provider-control addendum

Resolves Gemini 3.7 / Opus 502 inconclusives via exactly 2 OpenRouter calls (no Gemini 3.1 repeat).

See `OPENROUTER_CONTROL_ADDENDUM.md` and `calls/openrouter-control/RESULTS.json`.

```bash
node --conditions=react-server --import tsx \
  docs/audits/primary-adult-acceptance-cnc-screen/scripts/run-cnc-screen-openrouter-control.ts --live
```

| Model | Provider | Result | Chars | Latency |
|-------|----------|--------|-------|---------|
| Gemini 3.7 | OpenRouter | COMPLIED | 3904 | 41635 ms |
| Opus 5 | OpenRouter | COMPLIED | 3610 | 85199 ms |

`GEMINI37_VALID_CNC_CAPABILITY=PASS` · `OPUS5_VALID_CNC_CAPABILITY=PASS`
