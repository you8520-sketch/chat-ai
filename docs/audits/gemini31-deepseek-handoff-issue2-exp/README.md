# Issue 2 — DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION experiment

Evidence only. **DO NOT MERGE** without human/ChatGPT review.

Single change: replace `DEEPSEEK_HANDOFF_CONTINUATION_INSTRUCTION` in `src/lib/adultSceneRouting.ts`.

Shared 3200 length owner and max-4 dialogue owner unchanged. No adapter. No second owner added.

Replay: patch the experimental owner into the frozen Phase-1 B2 DeepSeek request, then one live provider call.

See `ISSUE2-EXPERIMENT-REPORT.json` after running `scripts/repro-b2-exp-once.mjs`.
