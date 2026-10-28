# Main RP 12-call live run — PARTIAL_STOP

Cursor does **not** score prose. GPT grades. This folder is public-safe review evidence only: no keys, no private prompts, no production row dumps, no real-user PII.

## Classification

`PARTIAL_STOP`

- Runtime SHA: `f338ac6d2affa2a95e05538de04d2ee157d6cd33`
- Manifest: `468c9f10efb4a79d03e4bf03ef6dbec347fe563d8bdc8870aae7e1d9a5629c58`
- Identity: `5f400d361ffd7eba0747cada89726d43ee38a36677768beac048c8732af02ded` (match published #1466)
- Seal verdict before POST: `EXPECTED_DEPLOY_SHA_ROTATION`
- Character 18 / 렌 / NORMAL / SAFE
- providerPosts: **2**
- transportPosts: 2
- production DB writes: **0**
- denialReason: `COST_EVIDENCE_MISSING`
- Journal left intact. **No retry.**

## Per-call outcome

| # | Fixture | Model | Status | HTTP | Chars | Prompt tok | Completion tok | USD | Latency ms | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | A | deepseek-v4.1-flash | SETTLED | 200 | 2729 | 8180 | 2087 | 0.001239 | 17626 | artifact present |
| 2 | A | gemini-3.8-flash | UNKNOWN_UNRESOLVED | 200 | — | — | — | — | 23625 | finish `stop`; settlement `missing`; no artifact |
| 3 | A | gpt-6.1-sol | PREPARED | — | — | — | — | — | — | not sent |
| 4 | A | claude-opus-5.5 | PREPARED | — | — | — | — | — | — | not sent |
| 5 | B | deepseek-v4.1-flash | PREPARED | — | — | — | — | — | — | not sent |
| 6 | B | gemini-3.8-flash | PREPARED | — | — | — | — | — | — | not sent |
| 7 | B | gpt-6.1-sol | PREPARED | — | — | — | — | — | — | not sent |
| 8 | B | claude-opus-5.5 | PREPARED | — | — | — | — | — | — | not sent |
| 9 | C | deepseek-v4.1-flash | PREPARED | — | — | — | — | — | — | not sent |
| 10 | C | gemini-3.8-flash | PREPARED | — | — | — | — | — | — | not sent |
| 11 | C | gpt-6.1-sol | PREPARED | — | — | — | — | — | — | not sent |
| 12 | C | claude-opus-5.5 | PREPARED | — | — | — | — | — | — | not sent |

Observed billed total (SETTLED only): **USD 0.001239**. Call 2 charge is unknown. Planning $7 is not a provider cap.

Call 2 OpenRouter generation id (receipt handle only): `gen-1791704575-g9euUXxrA3vGySZiIS7J`.

## Files

- `journal-public.json` — public journal fields only
- `call-01-A-deepseek-v41-flash.txt` — settled model output, fingerprint `0218e0bbc01dad26775cf76c5e6c55f1def15f1e3c59f1e078f95bccb8ce9ca0`

Call 2 produced HTTP 200 but the runner stopped before artifact persist because usage/cost was missing. Raw Gemini text is **not** available in the artifact store.

## Scores

All rubric scores left empty (`emptyRubricScores`). Cursor assigned none.
