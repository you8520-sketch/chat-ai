# P0 — World-Revision Blueprint Pregeneration — Implementation Readiness & Draft

**Status:** STOP_BEFORE_MERGE (Draft PR only)  
**Date:** 2026-08-30  
**Baseline main:** `ac6b397330c5fb6af8dc51bda7a57478f6438d67` (#745 merged)  
**PR #746:** OPEN (audit-only, not merged)

---

## Pre-flight

```text
CURRENT_MAIN_SHA: ac6b397330c5fb6af8dc51bda7a57478f6438d67
PR_745_PRESENT: yes
PR_745_MERGE_SHA: ac6b397330c5fb6af8dc51bda7a57478f6438d67
PR_746_STATE: OPEN
PR_746_MERGED: no
```

Main unchanged since audit. No competing ownership landed on main.

---

## Implementation gates (§26)

| Gate | Result | Evidence |
|------|--------|----------|
| BLUEPRINT_INPUT_IS_WORLD_ONLY | **true** | `generateWorldSandboxBlueprint` uses world name/summary/content only |
| VALIDITY_OWNER_CAN_BE_SINGLE | **true** | `isStoredBlueprintValidForCurrentGeneration` in `blueprintValidity.ts` |
| GM_ONLY_STORAGE_SAFE | **true** | `trpg_world_blueprint_artifacts` — not in `rowToWorldListItem` / catalog |
| TRIGGER_OWNER_FOUND | **true** | `PATCH/POST /api/worlds` after durable commit; semantic + TRPG enable |
| DURABLE_EXECUTION_PATH_SAFE | **true** | Reuses `derived_cache_jobs` + `kickDerivedCacheWorker` (same as world translate) |
| NO_DESTRUCTIVE_MIGRATION | **true** | Additive `CREATE TABLE IF NOT EXISTS` only |
| PUBLIC_SECRET_BOUNDARY_PRESERVED | **true** | Test: catalog/list JSON has zero blueprint fields |

**All gates passed → Draft implementation included in this PR.**

---

## Architecture implemented (Draft)

```text
World PATCH/POST (trpg_enabled=1, flag ON, semantic change)
  → enqueueWorldBlueprintPregenJob (derived_cache_jobs, idempotent)
  → kickDerivedCacheWorker
  → refreshWorldBlueprintArtifact
  → generateWorldSandboxBlueprint (canonical owner)
  → evaluateSandboxBlueprint (#741)
  → trpg-sandbox-blueprint transport (#745)
  → casPublishWorldBlueprintArtifact (GM-only table)

Campaign start (flag ON)
  → loadValidWorldBlueprintPlan → copyWorldBlueprintPlan → director_plan_json
  → if missing: sync fallback via same generateWorldSandboxBlueprint
```

---

## Validity contract (single owner)

`isStoredBlueprintValidForCurrentGeneration` checks:

- `sourceWorldHash` (`hashWorldSnapshot`: name + summary + content + updatedAt)
- `derivationVersion` (`TRPG_SANDBOX_BLUEPRINT_DERIVATION_VERSION` — bump on #741-like prompt contract changes)
- `generatorModel` (`TRPG_SCENARIO_DRAFT_MODEL`)
- `schemaVersion` (`TRPG_SCENARIO_PLAN_SCHEMA_VERSION`)

`hashWorldSnapshot` classification: **CONSERVATIVE_SUPERSET** (includes `updatedAt` not in LLM user prompt).

---

## Product diversity (accepted)

One macro Blueprint per exact world generation revision. Same-revision campaigns may share narrative beat sheet; runtime state remains per-campaign.

---

## §30 Final report

```text
CURRENT_MAIN_SHA: ac6b397330c5fb6af8dc51bda7a57478f6438d67
HEAD_SHA: (see branch cursor/trpg-world-blueprint-pregen-9c97)
DRAFT_PR: (created on push)
=== INPUT ===
BLUEPRINT_INPUT_IS_WORLD_ONLY: true
=== VALIDITY ===
WORLD_HASH_CLASSIFICATION: CONSERVATIVE_SUPERSET
BLUEPRINT_VALIDITY_OWNER: isStoredBlueprintValidForCurrentGeneration (blueprintValidity.ts)
BLUEPRINT_VALIDITY_OWNER_COUNT: 1
MODEL_CHANGE_INVALIDATES: true (generatorModel field)
SCHEMA_CHANGE_INVALIDATES: true (schemaVersion field)
PROMPT_CONTRACT_CHANGE_INVALIDATES: true (derivationVersion bump)
=== LIFECYCLE ===
TRPG_READY_TRIGGER_OWNER: shouldEnqueueWorldBlueprintPregen + worlds API after DB commit
TRIGGER_AFTER_DURABLE_COMMIT: true
UNRELATED_EDIT_TRIGGERS_REGEN: false (cover/genre-only PATCH does not enqueue; updated_at-only would via hash — conservative)
DURABLE_JOB_QUEUE_EXISTS: true (derived_cache_jobs)
DURABLE_JOB_OWNER: derivedCache/jobs.ts + worker.ts
PROCESS_RESTART_SAFE: partial — jobs persist; worker drains on kick (same as world translate; boot drain is follow-up)
=== STORAGE / PRIVACY ===
BLUEPRINT_STORAGE_OWNER: trpg_world_blueprint_artifacts (worldBlueprintArtifact.ts)
NEW_STORAGE_CREATED: true
MIGRATION_TYPE: additive CREATE TABLE IF NOT EXISTS
PUBLIC_BLUEPRINT_LEAK_COUNT: 0 (test)
BORROWED_WORLD_SECRET_LEAK_COUNT: 0
=== GENERATION / CONCURRENCY ===
BLUEPRINT_GENERATION_OWNER_COUNT: 1 (generateWorldSandboxBlueprint)
SAME_REVISION_DUPLICATE_CALL_POSSIBLE: false for pregen (INSERT OR IGNORE job); true for campaign sync fallback when artifact missing
STALE_GENERATION_OVERWRITE_POSSIBLE: false (CAS checks current world hash before publish)
MAX_PROVIDER_ATTEMPTS: 2 (#745 unchanged)
APPLICATION_RETRY_ADDED: false
=== CAMPAIGN ===
CAMPAIGN_START_VALID_ARTIFACT_PROVIDER_CALLS: 0
CAMPAIGN_PLAN_COPIED: true
CAMPAIGN_RUNTIME_SHARED: false
EXISTING_CAMPAIGN_CHANGED: false (no migration/backfill)
=== FEATURE / COST ===
FLAG_OFF_PROVIDER_CALLS: 0
PROVIDER_CALLS_PER_WORLD_REVISION: 1 (when flag ON and TRPG-ready world saved)
ESTIMATED_PROVIDER_CALLS_PER_100_CAMPAIGNS: 1 per world revision (not 100)
DEFAULT_ENABLE_READY: NO
=== CLEANUP ===
SAFE_TO_DELETE: none in this PR
KEEP: per-campaign sync fallback, derived_cache translation jobs, #741/#745 paths
FOLLOW_UP: boot-time derived cache drain; variant pool; default-enable UX; historical backfill
=== VALIDATION ===
FOCUSED_TEST_PASS: worldBlueprintPregen.test.ts (9/9), scenarioDraftCall.transport.test.ts (13/13)
FOCUSED_TEST_FAIL: none
TYPECHECK: pass
LINT: pass
DIFF_CHECK: pass
CI_STATUS: pending
=== SYSTEM DELTA ===
BEFORE: Per-campaign synchronous Blueprint generation on campaign start
PROBLEM: World-only work duplicated; 16s–135s startup when flag ON
AFTER: Pregenerate on TRPG-ready world commit; campaign copies validated artifact; sync fallback if missing
REMOVED: Duplicate prompt/generation block from sandboxDirector (delegates to canonical owner)
PRESERVED: #741 validation, #745 transport, flag default OFF, billing, campaign runtime independence
REGRESSION_RISKS: Same story per revision; boot drain gap; sync fallback still duplicates if artifact missing
PROOF: worldBlueprintPregen.test.ts + transport tests
=== FINAL ===
ROOT_CAUSE_STATUS: ROOT_CAUSE_FIXED (for pregen path when artifact exists; symptom remains on missing-artifact fallback)
IMPLEMENTATION_CREATED: true
MERGE_READINESS: NEEDS_PRODUCT_DECISION
DEFAULT_ENABLED: false
STARTUP_FAILURE_POLICY_CHANGED: false
USER_BILLING_CHANGED: false
MERGED: false
DEPLOYED: false
STATUS: STOP_BEFORE_MERGE
```
