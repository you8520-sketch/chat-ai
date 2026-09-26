# TRPG mechanics referee — DeepSeek ↔ JEV shadow benchmark

## Goal

Measure whether TypeSafe Jev can classify the **same bounded pre-GM mechanics
semantics** currently owned by DeepSeek V4 Flash, through the **same** server
`parseFlashOrEmpty` → `resolveRoundMechanics` path.

This is a FEATURE / BENCHMARK only. It does **not** enable production referee,
replace DeepSeek, or select a winner.

## Owners (preserved)

| Concern | Owner |
|---|---|
| Semantic classification (bounded) | Flash referee / JEV (benchmark arms) |
| d20 / modifier / DC / success tier | Server |
| Numeric HP damage/heal | Server dice tables |
| Inventory consume authorization | Server validator |
| Ongoing persistence / DB commit | Server |
| GM narration | GM model (post-mechanics) |

Production flag `TRPG_MECHANICS_REFEREE_ENABLED` remains default **OFF**.

## Corpus

`src/lib/trpg/mechanicsRefereeBenchmarkCorpus.ts` — PRE-GM labeled fixtures
starting from `scripts/trpg-mechanics-referee-pre-gm-runtime-qa.ts`. Expected
labels are declared explicitly. Current GM result / resolved outcome text is
never used as classifier input.

`scripts/trpg-mechanics-referee-effectiveness-qa.ts` remains
`RESOLVED_OUTCOME_SYNTHETIC_QA` and is **not** the primary enable gate.

## Live run (operator only)

```bash
REGULAR_TEST_REAL_PROVIDER_CALLS=1 \
REAL_JEV_TRPG_MECHANICS_PROBE=1 \
CHEAPER_INFERENCE_BENCHMARK_API_KEY=... \
OPENROUTER_JEV_BENCHMARK_API_KEY=... \
env -u OPENROUTER_API_KEY -u CHEAPER_INFERENCE_API_KEY \
node --conditions=react-server --import tsx scripts/benchmark-trpg-mechanics-jev-live.ts
```

Without full opt-in: `NOT_RUN`, provider calls = 0.

## Metrics

Reported separately:

- **RAW model quality** (harm recall, safe false-harm, severity/cause, ongoing, treatment, malformed)
- **SERVER-ACCEPTED quality** (safety escapes, downgrade/reject rates, required-effect loss, ownership escapes)
- cost / latency / provider calls per arm

Do not select a winner from Cursor output alone.
