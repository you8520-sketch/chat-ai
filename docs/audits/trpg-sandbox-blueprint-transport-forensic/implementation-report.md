# Sandbox Blueprint Transport Reliability — Implementation Report

Post-#741 transport fix: dedicated `trpg-sandbox-blueprint` request kind + isolated 75s/60s provider body deadlines.

## Selected profile

| Field | Value |
|-------|-------|
| Primary body deadline | 75_000 ms |
| Backup body deadline | 60_000 ms |
| Worst-case (dual attempt) | ~135_000 ms |

### Candidate measurement

| Candidate | Historical 4 failures | Notes |
|-----------|----------------------|-------|
| C1 60/45 | 4/4 pass | Provisionally selected; full 12-world suite still 2–3 transport failures under variance |
| C2 75/45 | W01 dual-timeout | Backup 45s insufficient on slow failover |
| C3 60/60 | W01 dual-timeout | |
| C4 75/60 | W01 failover pass | Selected after bounded measurement |

## Final real-provider regression (production path)

Run: `2026-08-30T06:35:28Z` — artifact: `/opt/cursor/artifacts/trpg-sandbox-blueprint-transport-regression-final2.log`

```text
WORLD_COUNT: 16
TRANSPORT_FAILURES: 0
PARSE_FAILURES: 0
SEMANTIC_BLUEPRINT_REJECTS: 0
MISSING_ENDING_CONDITIONS: 0
PARSED_BLUEPRINT_ACCEPTANCE_RATE: 100%
P50_SUCCESS_LATENCY_MS: 16603
P95_SUCCESS_LATENCY_MS: 127466
```

## Isolation preserved

- Creator scenario draft: `trpg-scenario-draft` @ 45/45 unchanged
- Sandbox repair: `trpg-scenario-draft` @ 45/45 unchanged
- Memory/HTML/TRPG reply: unchanged
