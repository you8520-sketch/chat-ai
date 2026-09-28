# Root cause report — TRPG 53-round story stall

**Date:** 2026-08-29  
**Current main SHA:** `330d0069d44f63538a45635e0586d121435c488d`  
**PR #727:** OPEN draft, `cursor/trpg-gm-resolution-quality-9c97` @ `38e064c2`, base `main`, **not merged**

## Final classification

```text
ROOT_CAUSE_STATUS: ROOT_CAUSE_UNCONFIRMED
FINAL_CLASSIFICATION: ROOT_CAUSE_UNCONFIRMED
PRODUCTION_PATCH_CREATED: false
DRAFT_PR: none (audit artifacts only)
MERGED: false
DEPLOYED: false
STATUS: STOP_BEFORE_MERGE
```

Incident-specific primary cause **cannot be proven** without production round history. Code audit identifies **architectural gaps** that plausibly produce the reported symptom class.

---

## Pre-flight

```text
CURRENT_MAIN_SHA: 330d0069d44f63538a45635e0586d121435c488d
PR_727_STATE: OPEN
PR_727_HEAD: 38e064c2d214db7c846d2b182f1c89b89cccccee
PR_727_BASE: main
PR_727_MERGED: false
AFFECTED_CAMPAIGN_HISTORY_ACCESSIBLE: false
ROUNDS_AUDITED: 0
```

---

## Primary / secondary (architecture + conditional incident fit)

```text
PRIMARY_ROOT_CAUSE (code architecture, incident unproven):
  A_PROGRESS_OWNER_ABSENT — no durable local scene progress / obstacle-resolution / exit-transition owner

SECONDARY_CONTRIBUTORS (likely compound):
  E_PROGRESS_TOO_LOCAL_OR_OVERWRITTEN — nextRoundContext single-field replace (400 chars)
  F_SUCCESS_NOT_CONVERTED — no durable progress channel for success leverage (flags ad hoc)
  World-only path: missing scenario plan when TRPG_SANDBOX_DIRECTOR_ENABLED off (see world-only-bootstrap-report.md)
  H_MODEL_PROMPT_FAILURE — possible; not isolatable without prompt replay on frozen states
  G_OLD_ADJUDICATION — unknown without round timestamps vs #725 deploy

NOT primary:
  D_PROGRESS_NOT_REINJECTED — plan/storyPhase/threads ARE reinjected when plan exists; memory block reinjects ledger
  #727 turn-level forward motion — separate concern; does not fix multi-round scene owner absence
```

---

## Root-cause proof table (A–H)

| Hypothesis | Evidence FOR | Evidence AGAINST | Verdict |
|------------|--------------|------------------|---------|
| **A** Progress owner absent | No `scene_goal`, `scene_progress`, resolved-obstacle schema; `LOCAL_SCENE_PROGRESS_OWNER_FOUND: false` | `threads`, `quests`, `flags` could partially track | **true** (for local scene semantics) |
| **B** Owner exists, not written | storyPhase/threads only if GM emits; no plan → no director contract | Fields exist in delta parser | **partial** |
| **C** Written, not persisted | — | ledger + context persist on commit | **false** |
| **D** Persisted, not reinjected | — | memory block + plan block each GM call | **false** (for existing fields) |
| **E** Too local / overwritten | `nextRoundContext` replaces on new value; only 3 raw rounds in prompt | sealed summary retains some macro facts | **true** |
| **F** Success not → durable progress | No success→flag/route contract; #725 fairness unrelated to progress channel | GM prompt says success creates leverage | **plausible** |
| **G** Adjudication failure rate | — | Many successes with no macro progress would implicate F/E not G | **unresolved** |
| **H** Model ignores correct state | Cannot test without production prompts | Structured state injected when present | **unresolved** |

---

## Owner answers (section 35)

```text
SCENARIO_PLAN_OWNER: scenarioTemplates (authored) / sandboxDirector (world flag-on)
STORY_DIRECTOR_OWNER: engineAdvance.runGmForRound (assembles block from campaignContext serializers)
STORY_PHASE_OWNER: campaignContext.applyCampaignStoryProgress
THREAD_PROGRESS_OWNER: campaignContext.applyCampaignStoryProgress
NEXT_ROUND_CONTEXT_OWNER: campaignLedger.applyCampaignLedger ← GM delta
LOCATION_OWNER: campaignLedger
LOCAL_SCENE_PROGRESS_OWNER_FOUND: false
SCENE_EXIT_TRANSITION_OWNER_FOUND: false
STORY_DIRECTOR_BLOCK_RUNTIME_CONNECTED: conditional on resolvedCampaignPlan
STORY_PHASE_RUNTIME_CONNECTED: conditional on plan + GM delta
THREADS_RUNTIME_CONNECTED: conditional on plan + GM delta
NEXT_ROUND_CONTEXT_RUNTIME_CONNECTED: true
```

---

## World-only bootstrap (additional audit)

Full trace: `world-only-bootstrap-report.md`.

```text
WORLD_ONLY_TRPG_ALLOWED: true
Default production: generator NOT called (C), start without plan allowed (F)
Flag-on success path: auto-generate + persist + inject (A+D+E)
Affected campaign plan fields: ALL UNKNOWN (no production DB)
```

**Conditional follow-up (STOP — not implementing):** Enable or default-on sandbox blueprint generation before round 0, reusing `TrpgScenarioPlan` in existing `trpg_campaign_context`. Does **not** replace need for local scene progress owner.

---

## Change budget (no patch now)

| Class | Item |
|-------|------|
| **MUST_FIX_NOW** | none without production proof or approved schema |
| **REQUIRED_CLEANUP** | none in this audit |
| **SAFE_OPTIONAL** | none committed |
| **SEPARATE_FOLLOW_UP** | (1) local scene progress design (2) world-only default blueprint policy (3) nextRoundContext retention semantics (4) majorEvents/clues consumption tracking |

---

## Stop conditions hit

1. **Actual 53-round history cannot be safely retrieved** → forensic metrics uncomputed  
2. **New persistent scene-progress contract would be required** for canonical local-scene owner → design review first  

No existing-owner bug proven with deterministic fix (e.g. wiring drop) — gap is **missing abstraction**, not miswired existing owner.

---

## Preserved (if future work)

- Player agency, dice, #725 adjudication, #727 scope (turn-level), models, billing, memory safety, no hard round caps

---

## Artifacts

- `owner-map.md`
- `world-only-bootstrap-report.md`
- `macro-progress-report.md`
- `round-timeline.json` (empty — no production access)

---

## Regression fixtures (for future fix branch)

When production slice available, freeze S1–S6 from audit brief:

- S1 route opened persists in structured state next round  
- S2 resolved barrier not recreated as equivalent blocker  
- S3 mixed success/failure preserves A's progress  
- S4 player may stay when route open  
- S5 legitimate multi-round encounter not cut short  
- S6 exhausted local purpose → outward opening, not equivalent blocker  

Gemini probe on 3–6 frozen states: **blocked** until history accessible.
