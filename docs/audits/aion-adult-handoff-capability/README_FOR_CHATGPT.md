# README for ChatGPT — Aion adult-handoff capability

Read `REVIEW_PACKET.md` and each `*_RAW.txt` directly.
Cursor did not score quality and did not pick a winner.

Candidates requested: Aion 2.0 vs Aion 3.0 Mini.
Aion 2.5 excluded. DeepSeek / Muse / Qwen / source = 0 new calls.

Live CI catalog: only `aion-labs.aion-2-0` (already called; HTTP 400; not replaced).
Aion 3.0 Mini: OpenRouter exact id `aion-labs/aion-3.0-mini` — Fixture A ×2.
`MODEL_ONLY_PARITY=false` (CI vs OpenRouter).

Fixture A (consensual Like/Ren): complete. Existing samples only — no re-calls this gate.
- AION20_CI_MINIMAL_1 / AION20_CI_MINIMAL_2 (successful thinking-off)
- AION20_CONSENSUAL_1 / AION20_CONSENSUAL_2 (kept HTTP 400; not replaced)
- AION30MINI_CONSENSUAL_1 / AION30MINI_CONSENSUAL_2 (reference only; `AION30MINI_NEW_CALLS=0`)

Fixture B / F4 (pre-negotiated power-play): **not production-equivalent**.
`review-data.private(2).json` was not found. `F4_PRODUCTION_EQUIVALENT=false`. `LIVE_CALLS=0`.
Read `F4_PROVENANCE_AUDIT.md`. Do not treat missing F4 RAW files as empty samples.

Fill the axes in REVIEW_PACKET.md for existing Fixture A / 3.0 Mini samples only. Do not ask Cursor for scores.
