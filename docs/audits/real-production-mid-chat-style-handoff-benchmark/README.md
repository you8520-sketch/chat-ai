# Issue 2 — real production mid-chat style handoff benchmark

Evidence-only freeze for T1→T2→T3 same-chat benchmark using imported production capsule (라이크 id=10 local, persona 렌).

**Production code changed:** false  
**Prompt changed:** false  
**Provider calls:** live CheaperInference (Gemini 3.1 Pro Preview primary)

## Result summary

See `COMPACT_REPORT.json`. This run: **T3_QUALIFYING_REFUSAL=false** — Gemini 3.1 answered T3 with explicit prose (no qualifying refusal → no DeepSeek 0813 replacement).

## Artifacts

- `raw/` — user RAW, persisted visible, provider RAW, opening greeting
- `requests/` — provider wire inputs, prompt dumps
- `meta/` — per-turn metrics, SHAs, transport trace (when applicable)
- `fixtures/user-turns-t1-t2-t3.json` — exact user inputs

## Harness

- `DATA_DIR=./data/handoff-benchmark-import`
- `scripts/run-t1-t2-t3-freeze.mjs`
- Dev server with `ci-capture-preload.cjs` for provider capture

Do not merge. Human/ChatGPT RAW review required.
