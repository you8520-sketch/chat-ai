# P0 — World-Revision Blueprint Pregeneration — Implementation Readiness (Corrected)

**Status:** STOP_BEFORE_MERGE (Draft PR #749 — corrected)  
**Date:** 2026-08-30  
**Baseline main:** `ac6b397330c5fb6af8dc51bda7a57478f6438d67`

---

## Pre-flight

```text
CURRENT_MAIN_SHA: ac6b397330c5fb6af8dc51bda7a57478f6438d67
PR_749_BASE_SHA: ac6b397330c5fb6af8dc51bda7a57478f6438d67
PR_749_HEAD_SHA: ca94b72f34c1a31562d5e063bc3706fcb2ca9018
PR_749_MERGEABLE: MERGEABLE (draft)
```

---

## Defects fixed in correction pass

| ID | Issue | Fix |
|----|-------|-----|
| BUG A | POST bypassed flag check (`trpgEnabled === 1` → direct enqueue) | Both POST/PATCH use `maybeEnqueueWorldBlueprintPregenAfterCommit` |
| BUG B | `updated_at` in validity via `hashWorldSnapshot` | New `blueprintSourceFingerprint` (name+summary+content only) |
| BUG C | Blueprint jobs inherited 8-attempt queue retry | `maxAttemptsForDerivedJobKind` → 1 for `trpg_sandbox_blueprint_pregen` |
| ISSUE D | Duplicate DDL in `schema.ts` + `worldBlueprintArtifact.ts` | Single owner: `ensureTrpgTables` in `schema.ts` only |

No compatibility shims for unmerged Draft schema (`source_world_hash` removed; `source_fingerprint` only).

---

## Canonical owners (after correction)

| Responsibility | Owner | Count |
|----------------|-------|-------|
| Trigger policy | `shouldEnqueueWorldBlueprintPregen` + `maybeEnqueueWorldBlueprintPregenAfterCommit` | 1 |
| Source fingerprint | `blueprintSourceFingerprint` | 1 |
| Validity | `isStoredBlueprintValidForCurrentGeneration` | 1 |
| Generation | `generateWorldSandboxBlueprint` | 1 |
| Storage | `trpg_world_blueprint_artifacts` via `worldBlueprintArtifact.ts` | 1 |
| Schema DDL | `ensureTrpgTables` (`schema.ts`) | 1 |
| Derived job retry policy | `maxAttemptsForDerivedJobKind` (`jobs.ts`) | 1 |
| Campaign copy | `ensureCampaignDirectorContext` → `copyWorldBlueprintPlan` | 1 |

---

## §25 Final report (corrected)

```text
=== REPRODUCTION (before fix) ===
FLAG_OFF_POST_BYPASS_REPRODUCED: true
UNRELATED_EDIT_FALSE_INVALIDATION_REPRODUCED: true
BLUEPRINT_APPLICATION_RETRY_INHERITED: true
BLUEPRINT_TABLE_DDL_OWNER_COUNT_BEFORE: 2

=== FLAG ===
FLAG_OFF_POST_BLUEPRINT_JOB_COUNT: 0
FLAG_OFF_PATCH_BLUEPRINT_JOB_COUNT: 0
FLAG_ON_NEW_WORLD_JOB_COUNT: 1

=== INVALIDATION ===
UPDATED_AT_IN_BLUEPRINT_SOURCE_FINGERPRINT: false
COVER_ONLY_ARTIFACT_STILL_VALID: true
GENRE_ONLY_ARTIFACT_STILL_VALID: true
VISIBILITY_ONLY_BEHAVIOR: no semantic invalidation; enqueue only on TRPG enable or semantic field change
NAME_CHANGE_INVALIDATES: true
SUMMARY_CHANGE_INVALIDATES: true
CONTENT_CHANGE_INVALIDATES: true
INVALID_WITHOUT_REPLACEMENT_JOB_POSSIBLE: false

=== RETRY / COST ===
BLUEPRINT_JOB_MAX_LOGICAL_ATTEMPTS: 1
MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_GENERATION: 2 (primary→backup, #745 unchanged)
TRANSLATION_RETRY_POLICY_CHANGED: false
APPLICATION_RETRY_ADDED: false

=== STORAGE ===
BLUEPRINT_TABLE_DDL_OWNER_COUNT_AFTER: 1
UNMERGED_COMPATIBILITY_SHIM_ADDED: false
PUBLIC_BLUEPRINT_READER_COUNT: 0
BORROWED_WORLD_SECRET_LEAK_COUNT: 0

=== CAMPAIGN ===
VALID_ARTIFACT_PROVIDER_CALLS: 0
MISSING_ARTIFACT_PROVIDER_CALLS: 1 (sync fallback preserved)
CAMPAIGN_PLAN_COPIED: true
CAMPAIGN_RUNTIME_SHARED: false
SYNC_FALLBACK_PUBLISHES_ARTIFACT: false

=== DURABILITY ===
PROCESS_RESTART_SAFE: PARTIAL
BOOT_DRAIN_CHANGED: false

=== FINAL ===
ROOT_CAUSE_STATUS: ROOT_CAUSE_FIXED (pregen path); SYMPTOM_MITIGATED_ONLY for missing-artifact sync fallback
MERGE_READINESS: NEEDS_PRODUCT_DECISION
DEFAULT_ENABLE_READY: NO
STATUS: STOP_BEFORE_MERGE
```

---

## Validation

- `worldBlueprintPregen.test.ts` — 27/27 (T1–T23 + R1 frozen repro)
- `scenarioDraftCall.transport.test.ts` — 13/13 (#745)
- `npm run typecheck:app` — pass
- `npm run lint` — pass
- `git diff --check` — pass
