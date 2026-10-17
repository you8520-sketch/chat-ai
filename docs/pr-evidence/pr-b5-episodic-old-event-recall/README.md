# B5 evidence — old event / NPC / emotion / relationship recall

Provider-free. In-memory SQLite, synthetic fixtures only (no production rows, no
user conversations, 0 provider calls). Base `83b9bd60` (main), PR commits `cd963ce5`
(relevance-lane ordering) and `4e2b466d` (word-level relevance count).

## Reproduce

```
node --conditions=react-server --import tsx docs/pr-evidence/pr-b5-episodic-old-event-recall/old-event-recall-probe.mts [--json]
node --conditions=react-server --import tsx docs/pr-evidence/pr-b5-episodic-old-event-recall/recall-latency-probe.mts
```

The probe calls the real owners (`fetchEpisodicMemoryCandidatesForDebug`,
`getEpisodicMemoryForPrompt`). Per case and horizon (30/50/80/150/500/1000 turns,
≈1.33 rows per turn, NPC names recur on purpose) it reports, per target row, the
stage where it stops: `CANDIDATE_MISS` (no lane) → `RECONCILED_OUT` (state
reconciliation / latest-by-key, no debug row) → `RELEVANCE_FAIL` → `DEDUPED` →
`BUDGET_DROP` (`#rank`) → `INJECTED` (`#rank`).

| file | content |
| --- | --- |
| `logs/probe-before-summary.log`, `logs/probe-before.json` | base: stage, lanes, relevance, composite, rank, budget reason, relevance-lane turn range, final block |
| `logs/probe-lane-only-cd963ce5-summary.log` | first commit only |
| `logs/probe-after-summary.log`, `logs/probe-after.json` | PR head |
| `logs/wire-before-after-H1000.txt` | final episodic block at 1000 turns, cases A2 / E / A |
| `logs/latency-before.log`, `logs/latency-after.log` | median / p90 of `getEpisodicMemoryForPrompt`, 30 runs |
| `logs/regression-summary.log` | direct test suites, base vs PR |
