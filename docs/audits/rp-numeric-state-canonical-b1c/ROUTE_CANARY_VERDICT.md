# Phase B1-C.1 — True `/api/chat` Route Canary

- Status: **PASS**
- Model: anthropic/claude-opus-4.5
- Normal turns: 2
- Regen turns: 1
- Parity failures: 0
- User: 903
- Character: 10 (private)
- Chat: 3

Method: live HTTP `POST /api/chat` against local app.
In-memory `executeAtomicNumericAssistantFinalize` harness is **not** this canary
(see CORE_CANONICAL_HARNESS / `FINAL_CANARY_VERDICT.md`).

Post-canary: `RP_NUMERIC_STATE_ENABLED=0` restored for default local config.
Railway: UNCHANGED.
