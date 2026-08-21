# Style Track S1 — Source Mirror A/B

Independent style-only track. Completion V1 is not modified and is not applied.
Current-stage boundary work is not started.

## Conditions

- Target: `deepseek-v4-pro-0813` via existing Cheaper Inference transport
- BASELINE: vanilla 0813 handoff. Source Mirror OFF. Completion OFF.
- CHALLENGER: same prompt + generic `[HANDOFF SOURCE CONTINUITY — STYLE MIRROR]` once
- Placement: current user semantic input → Mirror → existing terminal length owner last
- System occurrence: 0
- Production chat route: unchanged. Both adapters stay OFF.

## Fixtures

- Claude Opus: unavailable on this VM (frozen last-assistant RAW missing). Skipped. Not relabeled.
- Gemini 3.1: unavailable on this VM (frozen last-assistant RAW missing). Skipped. Not relabeled.
- Gemini 3.7 Flash: recovered. Committed `docs/audits/gemini-37-flash-baseline/t1-raw.txt` as last visible canonical assistant. Matching next user is the original T2 line `같이 갈래? *두리번*`. Lobby / dialogue / escort offer — not a stage-boundary scene.

## Review

Cursor does not score. ChatGPT reads `BLIND_REVIEW_PACKET.md` first, then `REVEAL_MAP.json`.
