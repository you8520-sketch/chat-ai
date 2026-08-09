# G11-C5 — HISTORICAL SEQUENCE TRIANGULATION

Tested object: **HISTORICAL_SEQUENCE_BUNDLE** (not `EXACT_HISTORICAL_PROMPT`).

`FULL_HISTORICAL_PAYLOAD_PARITY = UNKNOWN` — historical full assembled request was not preserved byte-for-byte.

## Sealed priors

- #300 `BASELINE_GEMINI_LENGTH_INSTABILITY`
- #301 `NO_SINGLE_ROOT_CAUSE_FOUND`
- #302 `ROUTE_ALIAS_LENGTH_EFFECT_NOT_SUPPORTED`

Do not reopen: Scene Pacing / dialogue budget / L1 / P1 / provider / temperature / reasoning search.

## Design

- 4 frozen cells: REL_T1, REL_T2, ACT_T1, ACT_T2 (char 18 × persona 61 sequence)
- T2 history freezes historical #255 Gemini T1 RAW (no new T1→T2 divergence)
- Current Arm A only; same frozen messages → OpenRouter + CheaperInference
- NEW CALLS = 8; historical 4 outputs are reference only
- ONE TURN = ONE PRIMARY LLM CALL
- production wire / merge = NOT_RUN

## Status

See `PHASE_G11_C5_FINAL.md` / `01_LIVE.json`:

- classification: `MIXED_INCONCLUSIVE`
- OR mean 2716 / CI mean 2958 vs historical mean 4496
- `CONTEXT_COMPOSITION_DELTA_HIGH` on all cells (current input ≈26–36% of historical)
- next: `G11-C6 CONTEXT_COMPOSITION_DELTA_AUDIT`

## Run

```bash
PHASE=preaudit node --conditions=react-server --import tsx \
  scripts/rp-quality-g11c5-historical-sequence-triangulation.ts

PHASE=live node --conditions=react-server --import tsx \
  scripts/rp-quality-g11c5-historical-sequence-triangulation.ts
```
