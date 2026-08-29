# TRPG story architecture — final report

**CURRENT_MAIN_SHA:** `80d159757ec901b0a2090753e96c5d2f3c7acac1`  
**PR #731:** audit artifact only — not a production fix

---

## WORLD-ONLY BLUEPRINT

```text
GENERATOR_OWNER: sandboxDirector.ensureCampaignDirectorContext
GENERATOR_MODEL: deepseek-v4-flash-0731
PROVIDER_CALLS_PER_CAMPAIGN: 1 (+0–1 repair on JSON parse failure)
TYPICAL_COST: ~$0.00029 upstream ref / ~5P hypothetical user charge
MEDIAN_LATENCY: ~12.2s
P95_LATENCY: ~16.1s
GENERATOR_QUALITY: INADEQUATE_FOR_DEFAULT_ON (3/5 evaluateSandboxBlueprint pass)
PLAYABLE_PLAN_PASS_RATE: 60% (3/5)
CURRENT_FAILURE_POLICY: OPTION B — silent planless fallback
RECOMMENDED_FAILURE_POLICY: OPTION A — require playable blueprint before round 0 (after generator fix)
DEFAULT_ENABLE_RECOMMENDED: NO
FLAG_STATUS: KEEP_FOR_ROLLBACK
PRODUCTION_IMPLEMENTATION_CREATED: false
DRAFT_PR: (this audit branch only)
```

**Billing:** No user points charged today. Do not add silently.

**Generator blockers before default-on:**

- survival/apocalypse and open exploration failed `endingConditions` requirement
- Fix canonical prompt owner or post-parse validation before rollout

---

## LOCAL SCENE PROGRESS

```text
CURRENT_OWNER_FOUND: false
ACTIVE_THREADS_REUSE: REJECTED
LEDGER_REUSE: REJECTED
NEXT_ROUND_CONTEXT_REUSE: REJECTED
DEDICATED_SCENE_STATE: RECOMMENDED
RECOMMENDED_CANONICAL_OWNER: new TrpgLocalSceneProgress (conceptual) via GM delta in commitPendingGmResult
RECOMMENDED_PERSISTENCE: additive nullable JSON on trpg_campaign_context (human review)
RECOMMENDED_WRITER: GM delta parse + applyCampaignLocalSceneProgress in commit transaction
RECOMMENDED_NEXT_READER: compact injection in buildTrpgGmUserBlock / memory block
NEW_MODEL_CALL_REQUIRED: false
DB_CHANGE_REQUIRED: true (additive)
OLD_CAMPAIGN_COMPATIBILITY: null → empty; no migration of history
PLAYER_AGENCY_PRESERVED: yes (design constraint)
```

---

## GLOBAL FOLLOW-UPS

```text
MAJOR_EVENT_CONSUMPTION_TRACKING: SEPARATE_FOLLOW_UP
CLUE_REVEAL_TRACKING: SEPARATE_FOLLOW_UP
PLAY_LENGTH_RUNTIME_OWNER: SEPARATE_FOLLOW_UP
```

---

## CLEANUP

```text
SAFE_TO_DELETE: (none yet)
KEEP: TRPG_SANDBOX_DIRECTOR_ENABLED flag for rollback
FOLLOW_UP: generator endingConditions reliability; default-on policy; local scene schema; major event consumption
```

---

## FINAL CLASSIFICATION

```text
WORLD_ONLY_BLUEPRINT: NEEDS_PRODUCT_DECISION + NEEDS_CORRECTION (generator 60% pass)
LOCAL_SCENE_PROGRESS: DESIGN_READY_FOR_HUMAN_REVIEW
MERGED: false
DEPLOYED: false
STATUS: STOP_FOR_HUMAN_REVIEW
```

---

## Artifacts

| File | Purpose |
|------|---------|
| `world-only-blueprint-productionization.md` | Track A audit |
| `sandbox-blueprint-quality-probe.json` | Frozen 5-world probe results |
| `local-scene-progress-architecture.md` | Track B design |
| `local-scene-design-fixtures.md` | L1–L7 acceptance |
| `scripts/trpg-sandbox-blueprint-quality-probe.ts` | Re-runnable probe |

---

## Human decisions required

1. **Blueprint billing:** absorb cost vs charge ~5P at campaign start vs bundle in first round  
2. **Startup failure UX:** Option A vs retain silent fallback for a labeled sandbox mode  
3. **Generator fix** before default-on (endingConditions reliability)  
4. **Local scene schema** approval (additive DB column + delta contract)  
5. **Do not merge #731 as fix** — reference only
