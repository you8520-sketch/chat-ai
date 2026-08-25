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
