# Issue 2 — C2 티키타카 isolation experiment

**STOP for human/ChatGPT review. Do not merge into production.**

## Single change (frozen request harness only)

Patches **only** the `[19+ INTIMACY]` phrase in the frozen Phase-1 B2 DeepSeek request.
Production `NSFW_INTIMACY_SECTION` / `advancedProseNsfwGuidelines.ts` is **unchanged**.

| Item | Status |
|---|---|
| Accepted handoff owner | unchanged (production original) |
| Terminal dialogue lines 1 & 2 | unchanged (production original) |
| USER_TAIL 3200+ owner | unchanged |
| C1 terminal-line experiment | **not used** |
| #609 handoff experiment | **not used** |

**Patch:**

- OLD: `기계적 피스톤 나열 금지. 상호작용·티키타카.`
- C2: `기계적 피스톤 나열 금지. 상호작용을 유지한다.`

## Run

```bash
node docs/audits/gemini31-deepseek-handoff-issue2-c2-exp/scripts/repro-b2-c2-once.mjs
```

Requires `CHEAPER_INFERENCE_API_KEY` in `.env.local`.

## Artifacts

- `requests/B-DEEPSEEK-input-c2.json`
- `raw/B-DEEPSEEK-C2-RAW.txt`
- `raw/B-DEEPSEEK-C2-WIRE.txt`
- `meta/B-DEEPSEEK-C2-provider.json`
- `ISSUE2-C2-EXPERIMENT-REPORT.json` / `.md`

## C2 density thresholds (human review)

| dialogue_blocks_per_1000_chars | Support |
|---:|---|
| ≤ 3.0 | Strong |
| 3.0–4.0 | Weak/mixed |
| ≥ 4.0 | No useful C2 support |

Production B2 baselines: run1 ≈ 4.70 / 1000 chars · run2 ≈ 4.26 / 1000 chars.
