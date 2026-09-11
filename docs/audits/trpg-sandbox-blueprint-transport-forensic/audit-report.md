# Sandbox Blueprint Transport Reliability Forensic

Post-#741 read-only audit. Proves timeout owner before any transport fix.

## Pre-flight

| Field | Value |
|-------|-------|
| CURRENT_MAIN_SHA | `c135e1d4912ecc8a09181a53adb797c3ed5944fc` |
| PR_741_MERGED | YES |
| PR_741_MERGE_SHA | `c135e1d4912ecc8a09181a53adb797c3ed5944fc` |

PR #741 sandbox Blueprint contract (`buildSandboxDirectorSystemPrompt` mandatory `endingConditions`) confirmed on main.

## Frozen #741 probe baseline

```text
TOTAL_PROVIDER_RUNS: 16
SUCCESSFUL_PARSED_BLUEPRINTS: 12
TRANSPORT_FAILURES: 4
SEMANTIC_BLUEPRINT_REJECTS: 0
MISSING_ENDING_CONDITIONS_AMONG_PARSED: 0
PRIMARY_WORLD_END_TO_END_PASS_RATE: 9/12 (75%)
PRIMARY_PARSED_BLUEPRINT_ACCEPTANCE_RATE: 9/9 (100%)
```

All four failures: `body completion deadline exceeded` → `generationFailure: transport_timeout`. Not semantic rejects.

Source: `docs/audits/trpg-sandbox-blueprint-quality-probe/probe-results.json`, telemetry log `/opt/cursor/artifacts/trpg-sandbox-blueprint-probe-run.log`.

## Production execution path (main)

```text
ensureCampaignDirectorContext                    src/lib/trpg/sandboxDirector.ts
  → completeTrpgAuthoringJson(kind="sandbox_blueprint")
      src/lib/trpg/scenarioDraftCall.ts
      (no primaryTimeoutMs — defaults via callTrpgAuthoringModel)
    → callTrpgAuthoringModel(timeoutMs ?? 90_000)
        src/lib/trpg/scenarioDraftCall.ts
      → executeDeepSeekBackgroundWithProviderFailover(requestKind: "trpg-scenario-draft")
          src/lib/deepseekProviderFailover.ts
        → resolveBackgroundFlashProviderDeadlines()
        → executeDeepSeekWithProviderFailover(routeKind: "background_flash")
          primary: cheaperinference (deepseek-v4-flash-0731)
          backup:  openrouter (deepseek-v4-flash-0731 backup slug)
          stream: false, consumeCompleteBody: true
```

Creator scenario draft shares the same transport stack via `completeTrpgAuthoringJson` → `callTrpgAuthoringModel` with `primaryTimeoutMs` from `scenarioDraftPrimaryTimeoutMs()` (120k–240k) but identical `requestKind: "trpg-scenario-draft"`.

## Deadline owner map

| Field | Owner / value (current main) |
|-------|------------------------------|
| SANDBOX_OUTER_TIMEOUT_OWNER | `callTrpgAuthoringModel` default `timeoutMs ?? 90_000` — passed as `existingTimeoutMs` cap only |
| REQUEST_KIND_OWNER | Hard-coded `"trpg-scenario-draft"` in `scenarioDraftCall.ts` |
| BACKGROUND_ROUTE_KIND | `"background_flash"` (default) |
| PRIMARY_PROVIDER | `cheaperinference` |
| BACKUP_PROVIDER | `openrouter` |
| PRIMARY_HEADERS_DEADLINE | Same as body: `completionMs` (= min(outer, 45_000) = 45_000) |
| PRIMARY_FIRST_VISIBLE_DEADLINE | N/A (non-streaming) |
| PRIMARY_BODY_COMPLETION_DEADLINE | `BACKGROUND_PRIMARY_COMPLETION_MS.longForm` = **45_000** via `resolveBackgroundFlashProviderDeadlines` |
| BACKUP_HEADERS_DEADLINE | Same as backup body completion |
| BACKUP_FIRST_VISIBLE_DEADLINE | N/A (non-streaming) |
| BACKUP_BODY_COMPLETION_DEADLINE | `BACKGROUND_BACKUP_COMPLETION_MS.longForm` = **45_000** |
| MAX_PROVIDER_ATTEMPTS | **2** (`MAX_PROVIDER_ATTEMPTS_PER_BACKGROUND_TASK`) |

Long-form classification regex (`resolveBackgroundFlashProviderDeadlines`):

```text
/html-visual-card|background-html|scenario-draft|trpg-scenario|director|background-memory-extract/i
```

`trpg-scenario-draft` matches → longForm 45s/45s.

Effective per-attempt deadline formula:

```text
primaryCompletionMs = min(outerTimeoutMs, BACKGROUND_PRIMARY_COMPLETION_MS.longForm)
backupCompletionMs  = min(outerTimeoutMs, BACKGROUND_BACKUP_COMPLETION_MS.longForm)
```

Body timeout error originates in `readCompleteBody()` → `DeepSeekBodyDeliveryError("body completion deadline exceeded")` (`deepseekProviderFailover.ts`).

## Outer timeout false-owner proof

| Constant | Declared use | Effective body deadline for sandbox |
|----------|--------------|-------------------------------------|
| `TRPG_SCENARIO_DRAFT_PRIMARY_TIMEOUT_MS` (120_000) | Creator ai-draft outer | **45_000** (capped) |
| `TRPG_SCENARIO_DRAFT_CORE_TIMEOUT_MS` (210_000) | Creator core fill | **45_000** (capped) |
| `TRPG_SCENARIO_DRAFT_FULL_TIMEOUT_MS` (240_000) | Creator regenerate_all | **45_000** (capped) |
| `TRPG_SCENARIO_DRAFT_REPAIR_TIMEOUT_MS` (90_000) | JSON repair stage | **45_000** (capped) |
| Sandbox default (no override) | 90_000 | **45_000** (capped) |

```text
SANDBOX_REQUESTED_OUTER_TIMEOUT_MS: 90_000
EFFECTIVE_PRIMARY_BODY_DEADLINE_MS: 45_000
EFFECTIVE_BACKUP_BODY_DEADLINE_MS: 45_000
WOULD_RAISING_ONLY_OUTER_TIMEOUT_CHANGE_PROVIDER_BODY_DEADLINES: NO
```

Raising only `TRPG_SCENARIO_DRAFT_*_TIMEOUT_MS` or sandbox outer 90s does **not** change provider body deadlines. The owner is `BACKGROUND_*_COMPLETION_MS.longForm` (45s) unless `requestKind` profile or explicit `deadlines.completionMs` override changes.

## Shared transport profile

```text
BLUEPRINT_REQUEST_KIND: trpg-scenario-draft
CREATOR_DRAFT_REQUEST_KIND: trpg-scenario-draft
SHARED_TRANSPORT_PROFILE: true
```

Other production long-form consumers of the same 45s/45s policy:

| Consumer | requestKind | Outer timeout (if any) | Effective body |
|----------|-------------|------------------------|----------------|
| Sandbox Blueprint | `trpg-scenario-draft` | 90_000 default | 45_000 |
| Creator scenario ai-draft | `trpg-scenario-draft` | 120k–240k | 45_000 |
| Background memory extract | `background-memory-extract` | 120_000 default | 45_000 |
| HTML visual card | `background-html-visual-card` | 240_000 | 45_000 |

`GLOBAL_LONGFORM_CHANGE_SAFE: NO` — raising `BACKGROUND_PRIMARY_COMPLETION_MS.longForm` globally would affect creator drafts, memory extract, and HTML generation without isolated proof.

## Four frozen transport failures (telemetry-proven)

Telemetry order matches probe run order. Classifications use `[deepseek-provider-failover]` blocks from frozen log.

### W03_fantasy_adventure (run 0)

```text
PRIMARY_ATTEMPTED: yes (cheaperinference)
PRIMARY_FAILURE_TRIGGER: body_timeout
PRIMARY_DURATION_MS: 45002
BACKUP_ATTEMPTED: yes (openrouter)
BACKUP_FAILURE_TRIGGER: body_timeout
BACKUP_DURATION_MS: 45004
TOTAL_DURATION_MS: 90006
CLASS: A_PRIMARY_BODY_TIMEOUT_BACKUP_BODY_TIMEOUT
```

### W09_urban_supernatural (run 0)

```text
PRIMARY_ATTEMPTED: yes
PRIMARY_FAILURE_TRIGGER: body_timeout
PRIMARY_DURATION_MS: 45001
BACKUP_ATTEMPTED: yes
BACKUP_FAILURE_TRIGGER: body_timeout
BACKUP_DURATION_MS: 45002
TOTAL_DURATION_MS: 90003
CLASS: A_PRIMARY_BODY_TIMEOUT_BACKUP_BODY_TIMEOUT
```

### W12_lore_heavy_no_scenario (run 0)

```text
PRIMARY_ATTEMPTED: yes
PRIMARY_FAILURE_TRIGGER: body_timeout
PRIMARY_DURATION_MS: 45001
BACKUP_ATTEMPTED: yes
BACKUP_FAILURE_TRIGGER: body_timeout
BACKUP_DURATION_MS: 45001
TOTAL_DURATION_MS: 90002
CLASS: A_PRIMARY_BODY_TIMEOUT_BACKUP_BODY_TIMEOUT
```

### W02_open_exploration (high-risk repeat run 1)

```text
PRIMARY_ATTEMPTED: yes
PRIMARY_FAILURE_TRIGGER: body_timeout
PRIMARY_DURATION_MS: 45001
BACKUP_ATTEMPTED: yes
BACKUP_FAILURE_TRIGGER: body_timeout
BACKUP_DURATION_MS: 45000
TOTAL_DURATION_MS: 90001
CLASS: A_PRIMARY_BODY_TIMEOUT_BACKUP_BODY_TIMEOUT
```

### Failure summary

```text
TWO_PROVIDER_TIMEOUT_EXHAUSTION: PROVEN (4/4 via telemetry, not duration inference alone)
PRIMARY_BODY_TIMEOUTS: 4
BACKUP_BODY_TIMEOUTS: 4
HEADERS_TIMEOUTS: 0
FIRST_VISIBLE_TIMEOUTS: 0
NETWORK_FAILURES: 0
OUTER_TIMEOUTS: 0 (outer 90s never reached; failures at ~90s = 45+45 provider exhaustion)
OTHER_FAILURES: 0
```

Failover executed correctly on all four: `provider_attempt_count: 2`, `failover_trigger: body_timeout`.

Three additional runs succeeded only after primary body timeout + backup success (W06, W07, W01 repeat) — evidence that 45s is occasionally insufficient even when backup completes.

## Telemetry gap

Existing `[deepseek-provider-failover]` telemetry exposes:

- `provider_attempt_count`
- `primary_failure_class`
- `failover_trigger`
- `backup_success`
- `primary_headers_ms`, `backup_headers_ms`
- `primary_first_visible_ms`, `backup_first_visible_ms`

```text
EXISTING_TELEMETRY_SUFFICIENT: YES
```

No new permanent production telemetry required for this audit. Bounded probe (section 9) **not run** — frozen log sufficient.

## Root cause

```text
PRIMARY_ROOT_CAUSE: A_PROVIDER_BODY_DEADLINE_TOO_SHORT
```

Secondary contributors:

- **D_OUTER_TIMEOUT_NOT_ACTUAL_OWNER** — 90s/120k–240k outer values mislead operators; real cap is 45s per provider.
- **C_SHARED_TRANSPORT_PROFILE_COLLISION** — sandbox Blueprint shares `trpg-scenario-draft` with creator drafting; isolated fix requires new requestKind or explicit deadlines.
- **B_PROVIDER_INSTABILITY** (partial) — backup also timed out on 4/4 failures; both providers slow on heavy JSON outputs (~1400+ tokens), not pure primary flake.

Failover is **not** broken (`E` rejected).

## Fix options (no implementation)

| Option | Verdict | Notes |
|--------|---------|-------|
| A — sandbox-specific transport profile (`trpg-sandbox-blueprint` + dedicated completionMs) | **RECOMMENDED** | Isolates Blueprint from creator/memory/HTML; allows measured primary deadline without global regression |
| B — raise global `longForm` 45s | **REJECTED** | Touches 4 unrelated consumer classes; no safety proof |
| C — asymmetric primary/backup deadlines | **NEEDS_PROBE** | Reasonable within Option A; needs latency distribution before numbers |
| D — provider/model replacement | **FOLLOW_UP** | Only if dedicated deadline still insufficient after measured policy |
| E — extra retry (3rd attempt) | **REJECTED** | Failover already provides 2 attempts; failures exhausted both |

## Latency / cost (frozen suite)

### Current observed (12 successes)

```text
P50_SUCCESS_LATENCY: 16_382 ms
P95_SUCCESS_LATENCY: 88_865 ms (failover recovery: primary 45s + backup ~44s)
P50_END_TO_END_STARTUP: 16_382 ms (Blueprint-only path)
P95_END_TO_END_STARTUP: 88_865 ms
DOUBLE_TIMEOUT_WORST_CASE: ~90_000 ms (proven on 4 failures)
```

Primary-only successes cluster 12.5–17s. P95 driven by primary body timeout + backup completion (W07: 88.9s).

### Token / cost observability

```text
PRIMARY_ONLY_SUCCESS_COST: ~1_044 input + ~1_420 output tokens (avg successful run)
FAILOVER_SUCCESS_COST: ~1_015–1_078 input + ~1_274–2_105 output (backup-only billing on timeout path; primary timed out with 0 tokens returned)
BOTH_PROVIDER_TIMEOUT_COST: 0 tokens returned, ~90s wall time, 2 provider API calls
```

No user point charging impact (Blueprint billing separate).

### Option A estimate (illustrative, not implemented)

If sandbox primary body deadline raised to ~75s with backup 45s:

```text
EXPECTED_P50: ~16s (unchanged — fast primary path)
EXPECTED_P95: ~60–75s (failover cases may avoid double-timeout)
RECOMMENDED_WORST_CASE: ~120s (75+45) — still requires human product review before default-enable
```

## Product gate

```text
DEFAULT_ENABLE_READY: NO
```

Transport failures remain (4/16). Semantic contract fixed by #741; transport correction + acceptable startup latency required before default-on.

## Stop conditions met

Correction requires isolated transport profile design (Option A) — **STOP_FOR_HUMAN_REVIEW** before implementation.

```text
IMPLEMENTATION_CREATED: false
MERGED: false
DEPLOYED: false
STATUS: STOP_FOR_HUMAN_REVIEW
```
