# TRPG Bot-Seat Model A/B — Gemini 3.7 Flash vs GPT-5.6 Luna

Evidence-only benchmark. **No production routing change.**

## Artifacts

| File | Purpose |
| --- | --- |
| `CONTRACT_PROBE.json` | Reasoning/thinking contract probe before benchmark |
| `BENCHMARK_REPORT.md` / `.json` | Objective metrics only |
| `HUMAN_REVIEW.md` | Blind Sample A/B for manual scoring |
| `MODEL_KEY.md` | Model identity (open after scoring) |
| `PIPELINE_FEASIBILITY.md` | Read-only latency-hiding pipeline audit |
| `raw_evidence.json` | All 40 calls aggregate |
| `raw/*.json` | Per-call raw records |

## Reproduce

```bash
# 1) Contract probe
npx tsx scripts/trpg-bot-model-ab-probe.ts

# 2) Full benchmark (40 provider calls)
npx tsx scripts/trpg-bot-model-ab-bench.ts

# 3) Regenerate reports from saved evidence
REPORT_ONLY=1 npx tsx scripts/trpg-bot-model-ab-bench.ts
```

Requires `CHEAPER_INFERENCE_API_KEY` in `.env.local`.

## Production builders reused

- `TRPG_BOT_SYSTEM`, `buildTrpgBotActionUserBlock`, `parseTrpgBotAction`, `prepareTrpgBotActionBody`
- Benchmark transport uses `adaptCheaperInferenceChatBody` (not `adaptTrpgBotChatBody`)

## Decision status

- `FINAL_MODEL_WINNER`: **HUMAN_REVIEW_PENDING**
- `CURSOR_SUBJECTIVE_SCORING`: **false**
