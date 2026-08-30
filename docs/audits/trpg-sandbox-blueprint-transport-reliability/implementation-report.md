# Sandbox Blueprint Transport Reliability — #745 Implementation Report

## Classification (corrected)

| Dimension | Status |
|-----------|--------|
| Structural root cause | **ROOT_CAUSE_FIXED** — dedicated request kind + isolated deadline profile removes shared 45/45 longForm collision |
| Transport availability | **BEST_MEASURED_CANDIDATE** — not PRODUCTION_GRADE from one clean 16/16 batch alone |
| Default enable | **NO** |
| Round-0 blocking | **NO** |

### STOP boundary audit

The approved candidate procedure was C1→C2→C3 then STOP. Implementation continued to **C4 75/60** (135s worst-case provider body budget).

```text
PREVIOUS_STOP_CONDITION_CROSSED: true
C4_75_60_HUMAN_REVIEW_REQUIRED: true
```

C4 was selected after bounded measurement but **requires human product review** before treating 135s pre-round-0 wait as acceptable.

## Selected runtime profile (unchanged by this correction)

| Field | Value |
|-------|-------|
| Sandbox primary request kind | `trpg-sandbox-blueprint` (exact match) |
| Primary body deadline | 75_000 ms |
| Backup body deadline | 60_000 ms |
| Worst-case dual attempt | ~135_000 ms |
| Sandbox repair | `trpg-scenario-draft` @ 45/45 |
| Creator draft | `trpg-scenario-draft` @ 45/45 |

## Audit artifact dataflow

| Artifact | Source | Writer | Readers | Immutable |
|----------|--------|--------|---------|-----------|
| `../trpg-sandbox-blueprint-quality-probe/probe-results.json` | #741 frozen suite | #741 probe | Forensic #743, quality audits | **YES** |
| `candidate-comparison-evidence.json` | Existing VM logs | #745 correction | Human review | No |
| `transport-confirmation-probe-results.json` | Final 75/60 production-path run | #745 probe (pre-correction) | Transport review | No |

**Do not overwrite** the #741 baseline with transport confirmation results. Use `PROBE_OUT_DIR=docs/audits/trpg-sandbox-blueprint-transport-reliability` for post-fix transport runs.

## C4 evidence summary (existing artifacts only)

```text
C4_TOTAL_RUNS_ACROSS_ALL_EXISTING_EVIDENCE: 35
C4_TOTAL_SUCCESS: 32
C4_TOTAL_FAILURE: 3
C4_FINAL_BATCH_RUNS: 16
C4_FINAL_BATCH_FAILURES: 0
C4_INTERMEDIATE_FAILURES: 3
```

Intermediate failures: 1 harness (W02 dual-timeout) + 2 full-suite (final.log). Provider variance persists despite final clean batch.

## Regression risks (explicit — not resolved)

- **R1:** Worst-case sandbox provider body window ~135s (was ~90s at 45/45×2)
- **R2:** Primary may hold capacity up to 75s before failover
- **R3:** Upstream cost unknown when provider returns no usage on timeout
- **R4:** Provider variance observed in intermediate 75/60 runs
- **R5:** Future default-enable would expose dormant transport policy as user-visible pre-round-0 latency

## Preserved

#741 prompt contract, creator/repair/memory/HTML/reply profiles, CI→OR failover ×2, feature flag default-off, startup fallback, billing, DB, #727/#734
