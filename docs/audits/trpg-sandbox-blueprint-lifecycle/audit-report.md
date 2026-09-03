# POST-#745 — World-Only Blueprint Lifecycle / Pregeneration Architecture Audit

**Status:** STOP_FOR_HUMAN_REVIEW — analysis only, no implementation  
**Date:** 2026-08-30  
**Baseline:** `origin/main` @ `ac6b397330c5fb6af8dc51bda7a57478f6438d67` (#745 merged)

---

## Source of Truth

```text
CURRENT_MAIN_SHA: ac6b397330c5fb6af8dc51bda7a57478f6438d67
PR_745_PRESENT: yes
PR_745_MERGE_SHA: ac6b397330c5fb6af8dc51bda7a57478f6438d67
PR_741_PRESENT: yes (c135e1d4912ecc8a09181a53adb797c3ed5944fc, ancestor of main)
```

Confirmed production path (feature flag **on**, world-only sandbox campaign):

```text
POST /api/trpg/campaigns/[id]/start
  → startTrpgCampaign (engineAdvance.ts)
  → ensureCampaignDirectorContext (sandboxDirector.ts)
  → completeTrpgAuthoringJson({ kind: "sandbox_blueprint", ... }) (scenarioDraftCall.ts)
  → evaluateSandboxBlueprint (scenarioPlan.ts)
  → makeDraftProvenance + persistCampaignContext (director_plan_json)
  → runGmForRound round 0 (GM reads plan via resolvedCampaignPlan → serializeTrpgScenarioPlanForGm)
```

Blueprint is generated **once per campaign** (early return if `trpg_campaign_context` row exists). It is **not** regenerated per round.

---

## 1. Full Blueprint Dataflow

| Stage | Writer | Reader | Canonical owner | Persistence | Invalidation |
|-------|--------|--------|-----------------|-------------|--------------|
| World create | `POST /api/worlds` (`src/app/api/worlds/route.ts`) | `loadWorldForTrpg` | `worlds` row | `worlds.name/summary/content/trpg_*` | N/A |
| World update | `PATCH /api/worlds/[id]` | `loadWorldSnapshot` | `worlds` row | same + `updated_at` | `updated_at` change → hash change |
| TRPG publication | `validateWorldTrpgPublicationTransition` (`trpgPublication.ts`) on PATCH | `canUseWorldForTrpg` (`worldAccess.ts`) | `worlds.trpg_enabled`, `trpg_visibility` | DB columns | Permission gate only; **not** in blueprint hash |
| World snapshot (campaign) | `loadWorldSnapshot` in `sandboxDirector.ts` | `loadCampaignContext` | Per-campaign frozen copy | `trpg_campaign_context.world_snapshot_json` | **None** after first persist (world edits ignored) |
| World hash | `hashWorldSnapshot` (`scenarioDraft.ts`) | Provenance + snapshot | `hashWorldSnapshot()` | Embedded in snapshot + `plan.provenance.sourceWorldHash` | Recomputed only on new generation |
| Campaign creation | `createTrpgCampaign` (`engineCreate.ts`) | `loadCampaign` | `trpg_campaigns` | campaign row | N/A |
| Blueprint generation | `ensureCampaignDirectorContext` → `completeTrpgAuthoringJson` | — | `sandboxDirector.ts` (orchestrator) | — | Only if no context row yet |
| Transport (#745) | `resolveTrpgAuthoringTransportRequestKind` → `trpg-sandbox-blueprint` 75s/60s | `deepseekProviderFailover.ts` | Request kind resolver | — | N/A |
| Semantic validation (#741) | `evaluateSandboxBlueprint` | `sandboxDirector.ts` | `scenarioPlan.ts` | — | Reject → `directorPlan=null`, `directorError` set |
| Provenance | `makeDraftProvenance` | GM/debug | `scenarioDraft.ts` | Inside `director_plan_json` | Tied to generation moment |
| Campaign plan persist | `persistCampaignContext` | `resolvedCampaignPlan` | `campaignContext.ts` | `trpg_campaign_context.director_plan_json` | Never updated for sandbox after first write |
| GM consumption | — | `serializeTrpgScenarioPlanForGm` → `buildTrpgGmUserBlock` | GM prompt path only | — | Uses frozen campaign copy |

**Authored scenario path (unchanged):** `template_id` campaigns copy `scenario_templates.scenario_plan_json` into `directorPlan`; sandbox director is **not** called.

---

## 2. Generator Input Verification (Frozen)

Assembled LLM request for world-only sandbox (`sandboxDirector.ts` + `scenarioDraft.ts`):

**System:** `buildSandboxDirectorSystemPrompt()` — constant template + #741 endingConditions contract.  
**User:** `buildSandboxDirectorUserPrompt({ worldName, worldSummary, worldContent })` only.

| Field | Classification |
|-------|----------------|
| `worldName` | WORLD_REVISION_SPECIFIC |
| `worldSummary` | WORLD_REVISION_SPECIFIC |
| `worldContent` | WORLD_REVISION_SPECIFIC |
| System prompt text | WORLD_STABLE |
| `temperature` (0.6 default) | RANDOM_ONLY (implicit LLM variance) |
| Repair path | Uses `trpg-scenario-draft` profile, not sandbox 75/60 — only on JSON parse failure |

```text
USES_CAMPAIGN_ID: no
USES_USER_ID: no
USES_PERSONA: no
USES_PARTY_MEMBERS: no
USES_CHARACTER_SELECTION: no
USES_CAMPAIGN_HISTORY: no
USES_RANDOM_SEED: no (no seed in request body)
USES_CURRENT_TIME: no (not in prompt; provenance.generatedAt uses wall clock at write only)
```

Evidence: `buildSandboxDirectorUserPrompt` accepts exactly three world fields; `ensureCampaignDirectorContext` passes no campaign/user/party data to `completeTrpgAuthoringJson`.

---

## 3. Current Owner Map

```text
WORLD_SNAPSHOT_OWNER: ensureCampaignDirectorContext → trpg_campaign_context.world_snapshot_json (per campaign, frozen)
WORLD_HASH_OWNER: hashWorldSnapshot (scenarioDraft.ts), computed in loadWorldSnapshot (sandboxDirector.ts)
BLUEPRINT_GENERATION_OWNER: ensureCampaignDirectorContext → completeTrpgAuthoringJson (sandboxDirector.ts / scenarioDraftCall.ts)
BLUEPRINT_VALIDATION_OWNER: evaluateSandboxBlueprint (scenarioPlan.ts)
BLUEPRINT_PROVENANCE_OWNER: makeDraftProvenance (scenarioDraft.ts), written in sandboxDirector.ts
CAMPAIGN_DIRECTOR_PLAN_PERSISTENCE_OWNER: persistCampaignContext → director_plan_json (campaignContext.ts)
BLUEPRINT_INVALIDATION_OWNER: none (no re-generation on world edit after campaign start)
FEATURE_FLAG_OWNER: isTrpgSandboxDirectorEnabled / TRPG_SANDBOX_DIRECTOR_ENABLED (default OFF)
```

**Existing similar storage (do not duplicate blindly):**

| Artifact | Owner | Relation to sandbox blueprint |
|----------|-------|-------------------------------|
| `scenario_templates.scenario_plan_json` | Creator-authored scenarios | Different path; KEEP |
| `trpg_campaign_context.director_plan_json` | Per-campaign runtime | Current sandbox sink; KEEP |
| Creator `ai-draft` (`/api/trpg/scenarios/ai-draft`) | Human-reviewed draft | Not auto-blueprint; KEEP |
| World-level blueprint cache | **Does not exist** | Would be net-new |

---

## 4. Past-Fix Audit (#741, #745)

| Fix | Status | Notes |
|-----|--------|-------|
| #741 semantic contract (`evaluateSandboxBlueprint`, sandbox prompts) | **STILL_EXECUTING** | Active in `sandboxDirector.ts`, `scenarioPlan.ts` |
| #745 transport isolation (`trpg-sandbox-blueprint`, 75s/60s) | **STILL_EXECUTING** | `resolveTrpgAuthoringTransportRequestKind` + `deepseekProviderFailover.ts` |
| `directorPlan` read path | **STILL_EXECUTING** | `resolvedCampaignPlan` → GM serializer |
| `sourceWorldHash` provenance | **STILL_EXECUTING** | Written on accept; stored in plan JSON |
| Per-campaign frozen snapshot | **KEEP** | Test: world edit after start does not refresh plan |
| Failure never blocks start | **KEEP** | `directorPlan=null` → GM runs without `[SCENARIO PLAN]` |

Nothing observed **OVERRIDDEN** or **OBSOLETE** for these fixes on current main.

---

## 5. Core Product Question — Must Blueprint Differ Per Campaign?

**Answer: NO** — nothing in the generator **requires** two fresh campaigns on the same world revision to get different blueprints. All narrative fields are derived from world text only.

| Field | MUST differ? | Classification |
|-------|--------------|----------------|
| startingSituation | No | SAFE_TO_SHARE_BY_WORLD_REVISION (product: SHOULD_VARY if diversity wanted) |
| centralConflict | No | SAFE_TO_SHARE / product SHOULD_VARY |
| goal | No | SAFE_TO_SHARE / product SHOULD_VARY |
| endingConditions | No | SAFE_TO_SHARE / product SHOULD_VARY |
| majorEvents | No | SAFE_TO_SHARE / product SHOULD_VARY |
| clues | No | SAFE_TO_SHARE / product SHOULD_VARY |
| NPCs (if present) | No | SAFE_TO_SHARE / product SHOULD_VARY |
| climax | No | SAFE_TO_SHARE / product SHOULD_VARY |
| endingCandidates | No | SAFE_TO_SHARE / product SHOULD_VARY |
| gmDirection | No | SAFE_TO_SHARE / product SHOULD_VARY |
| secret | No | SAFE_TO_SHARE (GM-only) |

**Distinction:** Reuse is **semantically safe** (inputs identical). **Campaign sameness** is a **product** choice, not a code requirement.

---

## 6. Diversity Audit (Frozen Artifacts, No New Provider Batch)

Source: `docs/audits/trpg-sandbox-blueprint-quality-probe/probe-results.json` and `docs/audits/trpg-sandbox-blueprint-transport-reliability/transport-confirmation-probe-results.json` — W01/W02 each have 3 runs (same world text, independent generations).

**Observed:** Material differences in `startingSituation`, `centralConflict`, `endingConditions`, `endingCandidates`, `majorEvents`, `clues` across runs on identical world fixtures.

Examples (W01 apocalypse):
- Run 0: subway shelter, resource scarcity framing
- Run 1: "동묘 쉘터", different gang name ("잿빛 독사")
- Run 2: different opening beat and faction setup

```text
SAME_WORLD_BLUEPRINT_VARIANCE: HIGH
```

Fields carrying meaningful variance: **startingSituation**, **centralConflict**, **endingConditions**, **endingCandidates**, **majorEvents**, **clues**.  
If one blueprint is shared per world revision, variance drops from **HIGH → ZERO** for that revision.

---

## 7. Options Evaluation

### Option A — World-revision singleton

Copy one validated blueprint per `sourceWorldHash` to each new campaign.

| Dimension | Assessment |
|-----------|------------|
| Startup latency | **LOW** at campaign start (copy only) |
| Provider cost | **LOW** (1× per revision) |
| Story diversity | **LOW** (same story for all campaigns on revision) |
| Implementation | **MEDIUM** (new world-level store + single-flight lock) |
| Invalidation | **MEDIUM** (hash covers text edits; permission-only edits not in hash) |
| Privacy | **NEEDS_DESIGN** (GM-secret store must stay server/GM-only) |
| Concurrency | **MEDIUM** without lock on first campaign (today: duplicate calls possible) |
| Rollback | **LOW** (flag off → fall back to null plan or sync gen) |

### Option B — Pregenerate on world publish/update

Generate when creator saves world (especially `trpg_enabled=1` or content change).

| Dimension | Assessment |
|-----------|------------|
| Creator UX | **MEDIUM** wait at publish/edit (async recommended) |
| Player startup | **LOW** |
| Provider cost | Shifted to creator; **LOW** per player campaign |
| Worlds never played | Wasted gen cost on creator |
| Private worlds | Only creator-triggered; acceptable |
| Publication failure | Need explicit policy (block publish vs allow with warning) |
| Invalidation | Natural on `updated_at` / hash change |

### Option C — Variant pool (N per revision)

Only justified if product rejects identical stories **and** won't accept per-campaign wait.

| Dimension | Assessment |
|-----------|------------|
| N | 2–3 likely enough given HIGH run variance; unproven without product bar |
| Cost | N× provider calls per revision |
| Storage | N validated plans + selection index per campaign |
| Repetition | Reduced vs singleton, not eliminated |
| Selection | Campaign start picks unused/random variant; needs concurrency rules |
| Invalidation | Same as A/B |

**Skepticism:** Adds complexity; only if diversity is a hard requirement **and** B/A latency is required.

### Option D — Per-campaign prewarm

Generate during setup before Start.

| Dimension | Assessment |
|-----------|------------|
| Latency | **MEDIUM** (may still wait if slow) |
| Duplicate calls | Still possible (double-click, abandon, stale world edit) |
| Idempotency | Needs session/world-hash keyed dedupe — similar complexity to A/B |
| Privacy | Same as today |

**Rejected** as primary: does not establish a canonical world owner; complexity without clear win over B.

### Option E — Current synchronous per-campaign

| Dimension | Assessment |
|-----------|------------|
| Startup latency | **HIGH** — measured #745: P50 ≈ 16.6s, P95 ≈ 127.5s, worst-case ≈ 135s |
| Provider cost | **HIGH** — 1 call per campaign (× repair if JSON bad) |
| Diversity | **HIGH** |
| Implementation | **LOW** (already built) |
| Default-enable | **Unacceptable** for 60–135s blocking start |

---

## 8. Concurrency (Current)

```text
DUPLICATE_BLUEPRINT_CALL_POSSIBLE: yes
CURRENT_DEDUPE_OWNER: per-campaign only (loadCampaignContext early return after first persist)
CURRENT_LOCK_OWNER: none at world level
```

Two simultaneous **first** campaigns on the same world revision can each call the provider before either persists context.

**Conceptual guarantee for shared/pregen design:**

```text
world revision hash
  → one generation writer (DB row lock / single-flight job keyed by sourceWorldHash)
  → waiters read validated result or poll job status
  → campaign start copies into director_plan_json (runtime state stays per campaign)
```

No lock implementation in this audit.

---

## 9. Invalidation

`hashWorldSnapshot` = SHA256(name + summary + content + updatedAt)[0:32].

| Scenario | Invalidates hash? | Invalidates stored campaign plan? |
|----------|-------------------|-----------------------------------|
| Same world unchanged | No | No (frozen) |
| Description/content edit | Yes (`content`, `updated_at`) | No for existing campaigns |
| Name edit | Yes | No for existing campaigns |
| Summary edit | Yes | No for existing campaigns |
| TRPG setting toggle (`trpg_enabled`) | **No** | N/A to generator input |
| Visibility change only | **No** | N/A |
| Permission / borrow rules | **No** | Access gate separate |

```text
WORLD_HASH_CANONICAL_INVALIDATION_KEY: PARTIAL
```

Missing from hash (if ever needed): `trpg_enabled`, `trpg_visibility`, genres, cover — **not in generator input today**, so not required for blueprint **content** validity. Do not extend hash until proven necessary.

**Provenance check:** `plan.provenance.sourceWorldHash` vs current `hashWorldSnapshot(...)` sufficient to detect stale **shared** blueprint for new campaigns.

---

## 10. Privacy / Permission Boundary

| World type | Access gate | Blueprint exposure today |
|------------|-------------|--------------------------|
| Public TRPG | `canUseWorldForTrpg` | Plan only in GM path via `serializeTrpgScenarioPlanForGm` |
| Private (creator) | Creator only | Same |
| Borrowed legacy | Blocked from TRPG | N/A |
| Authored scenario | Template visibility | Separate `scenario_plan_json` |

`publicTrpgScenarioPlan()` returns `null` — **no player-facing plan projection**.

Player APIs under `/api/trpg` do **not** expose `director_plan_json`. GM secrets (`secret`, clues, ending conditions) flow only to GM prompt assembly.

```text
SHARED_BLUEPRINT_PRIVACY_SAFE: NEEDS_DESIGN
```

Any world-level store must:
- Remain **server-side / GM-only** (same as today’s campaign copy)
- Never surface via snapshot or client APIs
- Respect `canUseWorldForTrpg` on read (private world blueprint readable only by creator/system, not other players)

**STOP condition not triggered:** shared storage can mirror existing GM-only boundaries if designed correctly.

---

## 11. Failure Policy (By Option)

| Failure | E (current) | A/B singleton | C variant pool | D prewarm |
|---------|-------------|---------------|----------------|-----------|
| Timeout | `directorPlan=null`, start continues | Same at campaign copy; pregen job fails → null plan or block publish (product choice) | Same | Orphan prewarm job discarded |
| Malformed JSON | Repair via `trpg-scenario-draft`; then null plan | Pregen job fails; don’t store | Same | Same |
| Semantic reject (#741) | `directorPlan=null`, `directorError` | Don’t cache reject; retry only on next invalidation | Same | Same |
| Provider unavailable | null plan, start continues | Campaign reads nothing / waits on pregen job | Same | Same |
| World changes during gen | N/A (snapshot frozen at gen) | Abort if hash ≠ job key at commit | Pick variant matching hash | Invalidate prewarm if hash stale |

No hidden retries in current code. No silent stale reuse unless provenance hash matches.

---

## 12. Dead-System Audit

| Item | Classification | Notes |
|------|----------------|-------|
| `publicTrpgScenarioPlan()` → null | **KEEP** | Intentional stub for non-secret projection |
| `draftLocks` / `assertScenarioDraftRateLimit` | **KEEP** | Creator ai-draft only, not sandbox |
| `scenario_templates.scenario_plan_json` | **KEEP** | Authored scenario path |
| World-level blueprint cache | **FOLLOW_UP** | Does not exist |
| Duplicate `hashWorldSnapshot` | **KEEP** | Also used by ai-draft route (same function) |
| `TRPG_SANDBOX_DIRECTOR_ENABLED` | **KEEP** | Default off |
| `director_error` column | **KEEP** | Written on reject/failure |
| Unused env for sandbox cache | None found | — |

No **SAFE_TO_DELETE** items identified without implementation.

---

## 13. Comparison Table

| Option | STARTUP_LATENCY | PROVIDER_COST | STORY_DIVERSITY | IMPL_COMPLEXITY | INVALIDATION_RISK | PRIVACY_RISK | CONCURRENCY_RISK | ROLLBACK_COMPLEXITY |
|--------|-----------------|---------------|-----------------|-----------------|-------------------|--------------|--------------------|---------------------|
| **A** Singleton | LOW | LOW | LOW | MEDIUM | MEDIUM | NEEDS_DESIGN | MEDIUM→LOW w/ lock | LOW |
| **B** Publish pregen | LOW | LOW (shifted to creator) | LOW | MEDIUM | MEDIUM | NEEDS_DESIGN | LOW | LOW |
| **C** Variant pool | LOW | MEDIUM–HIGH | MEDIUM | HIGH | MEDIUM | NEEDS_DESIGN | MEDIUM | MEDIUM |
| **D** Prewarm | MEDIUM | HIGH | HIGH | HIGH | MEDIUM | NEEDS_DESIGN | HIGH | MEDIUM |
| **E** Sync per-campaign | HIGH (16s–135s) | HIGH | HIGH | LOW (done) | LOW (frozen) | LOW (today) | HIGH (dup calls) | LOW |

Evidence: latency from #745 transport confirmation probe; diversity from quality probe W01/W02 repeats; concurrency from `loadCampaignContext` early-return semantics.

---

## 14. Recommendation

**Per-campaign synchronous generation is not the right long-term owner** if sandbox director is default-enabled: it duplicates world-only work and exposes 16s–135s start delay.

**Blueprint is reusable by world revision** from an input/provenance standpoint (`SAME_WORLD_REUSE_SEMANTICALLY_SAFE: YES`).

**Product tension:** reuse kills **HIGH** run-to-run diversity → accept identical stories per revision **or** fund variant pool (C) **or** keep sync gen (E) for diversity-only worlds.

### Recommended lifecycle: **Option B (pregenerate on world publish/update)** with world-revision singleton storage

Rationale:
1. Simplest **canonical owner**: one validated blueprint per `sourceWorldHash` (not per campaign).
2. Eliminates player-facing 16s–135s wait and duplicate provider calls.
3. Natural invalidation when name/summary/content/`updated_at` change.
4. Campaign start becomes **copy** into `director_plan_json` + frozen `world_snapshot_json` (runtime progress stays per campaign).
5. Add **single-flight writer** keyed by hash (same mechanism needed for A).

**Not recommended as primary:** E (default-enable), D (prewarm), C (unless product mandates diversity + low latency).

**Separate follow-up:** variant pool (C), default-enable, round-0 UX, billing for creator-time gen, async publish UX.

```text
DEFAULT_ENABLE_READY: NO
```

---

## 15. Proposed System Delta (Documentation Only)

### BEFORE

```text
Start campaign (flag ON)
  → sync provider call (world-only prompt)
  → wait P50 ~16s / P95 ~127s
  → persist per-campaign director_plan_json
  → round 0
```

### PROBLEM

- 1 provider call **per campaign** for deterministic-in-input work.
- Concurrent starts on same world → duplicate calls.
- Default-enable would block start on long-tail transport (75s+60s worst case).

### PROPOSED AFTER

```text
World publish / content edit (trpg enabled)
  → async generate + evaluateSandboxBlueprint
  → store validated plan keyed by sourceWorldHash (GM-only)

Campaign start
  → copy cached plan + snapshot if hash matches
  → else null plan (same failure semantics as today)
  → round 0 (no provider wait)
```

### REMOVED

- Redundant per-campaign provider calls for unchanged world revisions.
- Duplicate concurrent generation for same world (via single-flight).

### PRESERVED

- Per-campaign `director_plan_json`, story phase, local scene progress (#734).
- #741 semantic validation, #745 transport profile for pregen jobs.
- Feature flag default OFF until product signs off.
- GM-only secret path; no player plan leak.
- Billing unchanged in this design pass.

### REGRESSION RISKS

- **Diversity:** all players on same revision see same story beat sheet.
- **Stale cache:** must compare `sourceWorldHash` before copy.
- **Privacy:** world-level store must stay GM/server-only.
- **Concurrency:** requires one writer per hash.

### PROOF

- Input path: `sandboxDirector.ts` lines 123–130 (world-only prompt).
- Persistence: `campaignContext.ts` `director_plan_json`.
- Latency: `transport-confirmation-probe-results.json` median 16603ms, p95 127466ms.
- Variance: quality probe W01/W02 × 3 runs — distinct `planSummary` per run.
- No world cache today: only `trpg_campaign_context` per campaign.

---

## 16. Final Report Block

```text
CURRENT_MAIN_SHA: ac6b397330c5fb6af8dc51bda7a57478f6438d67
=== INPUT OWNERSHIP ===
BLUEPRINT_USES_WORLD_ONLY_INPUT: yes
BLUEPRINT_USES_CAMPAIGN_SPECIFIC_INPUT: no
BLUEPRINT_USES_USER_SPECIFIC_INPUT: no
BLUEPRINT_USES_PARTY_SPECIFIC_INPUT: no
=== OWNER MAP ===
BLUEPRINT_GENERATION_OWNER: ensureCampaignDirectorContext (sandboxDirector.ts)
WORLD_HASH_OWNER: hashWorldSnapshot (scenarioDraft.ts)
PROVENANCE_OWNER: makeDraftProvenance (scenarioDraft.ts)
CAMPAIGN_PLAN_PERSISTENCE_OWNER: persistCampaignContext → director_plan_json
INVALIDATION_OWNER: none active (frozen per campaign); hash available for future world-level store
=== REUSE SAFETY ===
SAME_WORLD_REUSE_SEMANTICALLY_SAFE: YES
SAME_WORLD_BLUEPRINT_VARIANCE: HIGH
WORLD_HASH_CANONICAL_INVALIDATION_KEY: PARTIAL
SHARED_BLUEPRINT_PRIVACY_SAFE: NEEDS_DESIGN
=== CURRENT COST ===
CURRENT_PROVIDER_CALLS_PER_CAMPAIGN: 1 (primary; +1 repair only on JSON parse failure, trpg-scenario-draft profile)
CURRENT_P50_STARTUP_MS: ~16603
CURRENT_P95_STARTUP_MS: ~127466
CURRENT_WORST_CASE_MS: ~135000
=== OPTIONS ===
OPTION_A_SINGLETON: POSSIBLE
OPTION_B_PUBLISH_PREGEN: RECOMMENDED
OPTION_C_VARIANT_POOL: POSSIBLE (only if diversity is mandatory)
OPTION_D_CAMPAIGN_PREWARM: REJECTED
OPTION_E_SYNCHRONOUS: REJECTED (for default-enable; keep as fallback while flag off)
=== RECOMMENDATION ===
RECOMMENDED_LIFECYCLE: Option B — pregenerate on world publish/update, store one validated blueprint per world revision (sourceWorldHash), copy into campaign at start
RATIONALE: Generator input is world-only; measured per-campaign sync cost/latency is unjustified; canonical world-revision owner eliminates duplicate calls and startup wait; diversity tradeoff is explicit product choice
DEFAULT_ENABLE_READY: NO
IMPLEMENTATION_CREATED: false
MERGED: false
DEPLOYED: false
STATUS: STOP_FOR_HUMAN_REVIEW
```
