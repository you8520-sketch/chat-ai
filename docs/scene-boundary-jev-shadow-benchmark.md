# Scene-boundary lexical → JEV semantic shadow benchmark

## Goal

Measure whether TypeSafe Jev can act as a **bounded second-stage semantic
judge** on candidates already found by the deterministic R5 boundary
suspicion scanner.

This is FEATURE / BENCHMARK only. It does **not** enforce, block, regenerate,
or mutate scene/reconvergence/authoring state.

## Architecture

```
RP output (synthetic fixture)
  → scanR5BoundarySuspicionSignals (lexical candidate owner)
  → ONLY when ≥1 suspicion signal
  → callJevDecisions(boundary_verdict) with benchmark apiKey
  → read-only QA metrics
```

## Owners (preserved)

| Concern | Owner |
|---|---|
| Lexical candidate | `scenePolicyBoundarySuspicionScan.ts` |
| Semantic verdict (benchmark only) | `sceneBoundaryJevJudge.ts` + live runner |
| Scene directive | `sceneDirective*.ts` |
| Reconvergence | `reconvergenceState.ts` |
| Auto-progression | `autoProgressionRules.ts` |
| User-authoring | `userAuthoringPolicy.ts` |
| Benchmark credential | `OPENROUTER_JEV_BENCHMARK_API_KEY` via `benchmarkOpenRouterJevCredential.ts` |

Production `TRPG` / comment-moderation JEV experiments are **not** reused.

## Live run (operator only)

```bash
REGULAR_TEST_REAL_PROVIDER_CALLS=1 \
REAL_JEV_SCENE_BOUNDARY_PROBE=1 \
OPENROUTER_JEV_BENCHMARK_API_KEY=... \
env -u OPENROUTER_API_KEY \
node --conditions=react-server --import tsx scripts/benchmark-scene-boundary-jev-live.ts
```

Without full opt-in: `NOT_RUN`, provider calls = 0.

## Metrics

Reported separately:

- **Lexical scanner** — candidate hits, missed true violations, benign candidates, per-signal counts
- **JEV (scanner-positive only)** — VIOLATION / COMPLIANT / INSUFFICIENT_CONTEXT, malformed, agreement, cost/latency
- **Combined alert** — `scanner positive AND JEV == VIOLATION`

Do not select a winner from Cursor output alone.
