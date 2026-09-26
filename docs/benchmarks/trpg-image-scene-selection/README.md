# TRPG Important-Scene Selection Benchmark

Research/benchmark only. **Not production code.** Do not merge for runtime behavior.

## Purpose

Compare three arms on frozen TRPG round evidence:

| Arm | Owner | Provider calls |
|-----|-------|----------------|
| A — CURRENT_RAW | `buildTrpgIllustrationSituation` | 0 |
| B — DETERMINISTIC_FIRST | `buildDeterministicScenePlan` | 0 |
| C — EXISTING_AI_PLANNER | `planChatImageScene` | 1 per fixture |

## TRPG compatibility boundary

Location and party actions remain canonical metadata outside the AI selector.
The benchmark feeds **GM narration only** into ScenePlan as one assistant message:

```text
ROUND N
location N -------- preserved separately (Arm A metadata)
actions N --------- preserved separately (Arm A metadata)
GM narration N
      ↓
buildSceneSourceMessages([{ role: "assistant", content: narration }])
      ↓
planChatImageScene (Arm C)
```

No production adapter is introduced.

## Fixtures

- `fixtures.json` — exactly 10 frozen rounds (F1–F10), all `SYNTHETIC`
- Each fixture includes `sourceSha256` in results for reproducibility

## Run (manual only)

```bash
node --conditions=react-server --import tsx scripts/benchmarks/trpg-image-scene-selection.run.ts
```

Requires `CHEAPER_INFERENCE_API_KEY` and/or `OPENROUTER_API_KEY` for Arm C.
**Never run in GitHub Actions.**

## Harness tests (no provider calls)

```bash
node --conditions=react-server --import tsx --test scripts/benchmarks/trpg-image-scene-selection.harness.test.ts
```

## Outputs

- `results.json` — machine-readable raw evidence + objective flags
- `REVIEW_PACKET.md` — GPT/human scoring blocks (`GPT SCORE: PENDING`)
- `REPORT.md` — methodology, invocation counts, rubric, eligibility gates

Cursor does **not** assign subjective quality scores or declare a winner.
