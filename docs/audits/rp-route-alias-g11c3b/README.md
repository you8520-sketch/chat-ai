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

See `00_PREAUDIT.json`:

- `message_hash_parity`: must be **PASS** before any paid call
- Live requires non-empty `CHEAPER_INFERENCE_API_KEY` (cloud currently injects `OPENROUTER_API_KEY` only)

## Run

```bash
# hash gate + freeze
PHASE=preaudit FIXTURES=B,D,F node --conditions=react-server --import tsx \
  scripts/rp-quality-g11c3b-route-alias-bundle.ts

# after CI key is present (.env.local or /tmp/ci_key)
PHASE=live FIXTURES=B,D,F DRAWS=2 node --conditions=react-server --import tsx \
  scripts/rp-quality-g11c3b-route-alias-bundle.ts
```
