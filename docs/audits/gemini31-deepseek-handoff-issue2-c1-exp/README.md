# Issue 2 — C1 terminal dialogue budget isolation experiment

**STOP for human/ChatGPT review. Do not merge into production.**

## Single change (frozen request harness only)

Patches **only** terminal dialogue budget line 2 in the frozen Phase-1 B2 DeepSeek request.
Production `renderTerminalDialogueBudgetOwner()` is **unchanged**.

| Item | Status |
|---|---|
| Original accepted handoff owner | unchanged |
| Terminal line 1 (max 4 blocks) | byte-identical |
| Terminal line 2 | C1 experiment wording |
| All other request fields | identical to Phase-1 `B-DEEPSEEK-input.json` |

## Run

```bash
node docs/audits/gemini31-deepseek-handoff-issue2-c1-exp/scripts/repro-b2-c1-once.mjs
```

Requires `CHEAPER_INFERENCE_API_KEY` in `.env.local`.

## Artifacts

- `requests/B-DEEPSEEK-input-c1.json` — patched frozen request
- `raw/B-DEEPSEEK-C1-RAW.txt` — visible assistant output
- `raw/B-DEEPSEEK-C1-WIRE.txt` — provider SSE wire
- `meta/B-DEEPSEEK-C1-provider.json` — metadata + SHAs
- `ISSUE2-C1-EXPERIMENT-REPORT.json` / `.md` — metrics
