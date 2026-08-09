# G11-C3B — ROUTE_MODEL_ALIAS_BUNDLE A/B

Sole variable: OpenRouter `google/gemini-3.1-pro-preview` (stored C1 Arm A) vs CheaperInference `gemini-3.1-pro-preview` (new calls).

## Policy

- Arm A only (no Scene Pacing / D3 / L1 / P1)
- Assemble messages **once**, freeze, identical role/content hashes to both route shapes
- No new OpenRouter calls
- Max **6** CI calls (B/D/F × 2)
- ONE TURN = ONE PRIMARY LLM CALL
- production wire / merge = NOT_RUN

## Status

See `PHASE_G11_C3B_FINAL.md` and `01_LIVE.json`:

- `message_hash_parity`: **PASS**
- Live: **6** CI calls completed
- classification: `ROUTE_ALIAS_LENGTH_EFFECT_NOT_SUPPORTED`
- next: `G11-C5 FIXTURE_MATCHED_HISTORICAL_REPRODUCTION`

## Run

```bash
# hash gate + freeze
PHASE=preaudit FIXTURES=B,D,F node --conditions=react-server --import tsx \
  scripts/rp-quality-g11c3b-route-alias-bundle.ts

# after CI key is present (.env.local or /tmp/ci_key)
PHASE=live FIXTURES=B,D,F DRAWS=2 node --conditions=react-server --import tsx \
  scripts/rp-quality-g11c3b-route-alias-bundle.ts
```
