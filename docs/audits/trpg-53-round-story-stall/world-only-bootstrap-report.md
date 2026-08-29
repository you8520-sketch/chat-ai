# World-only TRPG bootstrap / scenario blueprint audit

**Current main SHA:** `330d0069d44f63538a45635e0586d121435c488d`  
**Scope:** Read-only code trace. No implementation.

## Executive classification

Default production (`TRPG_SANDBOX_DIRECTOR_ENABLED` unset or off):

| Letter | Meaning | Verdict |
|--------|---------|---------|
| **C** | Generator exists but is not called | **true** |
| **F** | Campaign may start without a playable plan | **true** |

When `TRPG_SANDBOX_DIRECTOR_ENABLED=1` and generation succeeds:

| Letter | Meaning | Verdict |
|--------|---------|---------|
| **A** | Automatically generates canonical `TrpgScenarioPlan` | **true** |
| **D** | Persists to `trpg_campaign_context.director_plan_json` | **true** |
| **E** | Injected every GM round via `scenarioPlanBlock` + `storyDirectorBlock` | **true** |

When flag is on but generation fails or blueprint lint rejects:

| Letter | Meaning | Verdict |
|--------|---------|---------|
| **B** | Only partial plan (invalid JSON / missing required fields) | possible |
| **D** | Persists context row with `directorPlan=null`, `directorError` set | **true** |
| **F** | Start still proceeds | **true** (`Failure never blocks campaign start`) |

## Production path trace

```
WORLD (worlds table, trpg_enabled)
  → POST /api/trpg/campaigns { worldId }
  → createTrpgCampaign (engineCreate.ts)
       source_world_id set, world_brief = summary+content
       template_id = null
       NO scenario plan at creation
  → CHARACTER_SETUP / sheet save (assertCanStart: sheets only, no plan gate)
  → POST /api/trpg/campaigns/[id]/start
  → startTrpgCampaign (engineAdvance.ts)
       ensureCampaignDirectorContext (sandboxDirector.ts) — ONE SHOT, before round 0
         existing trpg_campaign_context row? → return as-is (never regenerates)
         template_id? → copy authored plan (scenario path, not world-only)
         source_world_id + flag OFF → sourceMode=sandbox, directorPlan=null, persist
         source_world_id + flag ON  → completeTrpgAuthoringJson(kind=sandbox_blueprint)
                                      → parseTrpgScenarioPlan → evaluateSandboxBlueprint
                                      → persist directorPlan or null + directorError
       runGmForRound (opening)
  → every later GM round (runGmForRound)
       loadCampaignContext → resolvedCampaignPlan
       scenarioPlanBlock = serializeTrpgScenarioPlanForGm(plan)  // empty if no plan
       storyDirectorBlock = director instructions + delta contract + director state
                            ONLY when resolvedPlan non-null
       buildTrpgGmUserBlock → GM prompt
```

### Canonical owners

| Step | Owner file | Function |
|------|------------|----------|
| Campaign create (world) | `engineCreate.ts` | `createTrpgCampaign` |
| Plan generation (world-only) | `sandboxDirector.ts` | `ensureCampaignDirectorContext` |
| Generator prompts | `scenarioDraft.ts` | `buildSandboxDirectorSystemPrompt`, `buildSandboxDirectorUserPrompt` |
| LLM call | `scenarioDraftCall.ts` | `completeTrpgAuthoringJson` (`kind: "sandbox_blueprint"`) |
| Plan parse/validate | `scenarioPlan.ts` | `parseTrpgScenarioPlan`, `evaluateSandboxBlueprint`, `hasPlayableScenarioPlan` |
| Persist plan | `campaignContext.ts` | `persistCampaignContext` → `trpg_campaign_context.director_plan_json` |
| Resolve for runtime | `campaignContext.ts` | `resolvedCampaignPlan` |
| GM injection | `engineAdvance.ts` + `gmPrompt.ts` | `serializeTrpgScenarioPlanForGm`, `storyDirectorBlock`, `buildTrpgGmUserBlock` |
| Start gate | `engineCreate.ts` | `assertCanStart` — **does not** require plan |

Feature flag: `TRPG_SANDBOX_DIRECTOR_ENABLED` (default **off**, commented in `.env.example`).

## Required report fields

```text
WORLD_ONLY_TRPG_ALLOWED: true
WORLD_ONLY_SCENARIO_PLAN_GENERATOR_FOUND: true
GENERATOR_CANONICAL_OWNER: sandboxDirector.ensureCampaignDirectorContext
AUTO_GENERATED_ON_WORLD_ONLY_START: conditional (TRPG_SANDBOX_DIRECTOR_ENABLED=1 only)
GENERATED_BEFORE_FIRST_ROUND: true (inside startTrpgCampaign, before runGmForRound opening)
PLAN_PERSISTED: true (trpg_campaign_context.director_plan_json when generation runs)
PLAN_REUSED_EVERY_ROUND: true (loadCampaignContext; ensureCampaignDirectorContext never re-runs)
```

### Field presence when plan exists (successful sandbox blueprint)

Serialization is via `serializeTrpgScenarioPlanForGm` — omits empty fields.

| Field | In TrpgScenarioPlan | Required for playable | In GM block when populated |
|-------|---------------------|------------------------|----------------------------|
| startingSituation | yes | yes (sandbox) | yes |
| centralConflict | yes | yes (sandbox) | yes |
| goal | yes | yes (sandbox) | yes |
| endingConditions | yes | yes (sandbox) | yes |
| majorEvents | yes | no | yes (labeled non-railroad) |
| clues | yes | no | yes |
| climax | yes | no | yes |
| endingCandidates | yes | no | yes |
| gmDirection | yes | no | yes |
| playLength | yes | no | yes |
| secret | yes | no | yes (GM-only) |

```text
CENTRAL_CONFLICT_PRESENT: when directorPlan populated
GOAL_PRESENT: when directorPlan populated
ENDING_CONDITIONS_PRESENT: when directorPlan populated
MAJOR_EVENTS_PRESENT: when LLM filled them (not guaranteed)
CLUES_PRESENT: when LLM filled them (not guaranteed)
CLIMAX_PRESENT: when LLM filled them (not guaranteed)
ENDING_CANDIDATES_PRESENT: when LLM filled them (not guaranteed)
PLAY_LENGTH_PRESENT: when LLM filled them (defaults to medium in empty plan)
STORY_DIRECTOR_CONSUMES_PLAN: true (resolvedCampaignPlan gates storyDirectorBlock)
GM_RUNTIME_CONSUMES_PLAN: true (scenarioPlanBlock + storyDirectorBlock in user prompt)
WORLD_ONLY_WITHOUT_PLAYABLE_PLAN_POSSIBLE: true (default flag off, or generation failure)
```

### Consumption gaps (even when plan exists)

- **No runtime tracking** of which `majorEvents` / `clues` were used or revealed.
- **`playLength`** is prompt text only; no round budget or phase driver.
- **Global goal** in plan is not distinguished from **local scene objective** (see owner-map).

## Affected ~53-round campaign (production)

```text
PRODUCTION_HISTORY_ACCESSIBLE: false
```

No local `data/app.db`, no read-only export of the production campaign, no frozen incident artifact in repo.

Therefore:

```text
HAD_SCENARIO_PLAN: unknown
HAD_CENTRAL_CONFLICT: unknown
HAD_GOAL: unknown
HAD_ENDING_CONDITIONS: unknown
HAD_MAJOR_EVENTS: unknown
HAD_CLUES: unknown
HAD_CLIMAX: unknown
HAD_ENDING_CANDIDATES: unknown
SOURCE_MODE: unknown (world-only vs scenario template)
TRPG_SANDBOX_DIRECTOR_ENABLED_AT_START: unknown
```

**Do not infer** plan absence from symptom alone. Stall signature (local obstacle rotation, low macro progress) is **consistent with** missing plan **and** with plan present but unused for scene progression.

## Material contribution to stall (conditional, not sole cause)

If the affected campaign was world-only **and** started without a persisted playable plan:

1. GM would receive `[WORLD]` + memory only — no `[SCENARIO PLAN]`, no `[STORY DIRECTION]`, no `[DIRECTOR DELTA CONTRACT]`, no `[CAMPAIGN DIRECTOR STATE]`.
2. No canonical global goal / ending conditions / major-event menu for the model to anchor multi-round progression.
3. `storyPhase`, `threadsAdd`, `threadsResolve` would still parse if GM emits them, but **no prompt contract** asks for them without a plan.

This **materially increases** long-term drift risk but does **not** alone explain obstacle regeneration loops; those still implicate **local progress owners** (`nextRoundContext` replacement, no resolved-obstacle ledger) documented in `root-cause-report.md`.

## Conditional design direction (STOP — do not implement)

Recommend separate follow-up **only if** production evidence confirms:

```text
WORLD_ONLY_TRPG is an intended supported path          → true (TrpgLobbyClient onStartWorld)
world-only can begin without usable scenario structure → true (default flag off)
no existing auto-generation owner fills responsibility → false (owner exists; flag off by default)
lack of structure materially contributes to stall     → plausible; unproven for this incident
```

**Architecture option (reuse existing contract):**

```
WORLD
  → one-time ensureCampaignDirectorContext (always-on or default-on flag)
  → evaluateSandboxBlueprint / hasPlayableScenarioPlan
  → persist director_plan_json BEFORE round 0 GM
  → storyDirectorBlock + scenarioPlanBlock every round
  → optional: block start if blueprint fails (product decision)
```

- Reuse `TrpgScenarioPlan`; do not add a second blueprint schema.
- `majorEvents`, `clues`, `climax`, `endingCandidates` remain possibilities, not ordered checkpoints.
- Existing schema (`trpg_campaign_context.director_plan_json`) is sufficient — **no new migration required** for plan persistence.
- Separate human review still needed for **local scene progress** owner (not solved by plan alone).

## Evidence citations

- World create path: `engineCreate.ts` (`opts.worldId` branch)
- Generator gate: `sandboxDirector.ts` `isTrpgSandboxDirectorEnabled`, lines 116–120
- One-shot + non-blocking failure: `sandboxDirector.ts` comment lines 82–86, 147–150
- Start hook: `engineAdvance.ts` `startTrpgCampaign` → `ensureCampaignDirectorContext`
- No plan gate: `engineCreate.ts` `assertCanStart`
- GM injection: `engineAdvance.ts` `runGmForRound` (`scenarioPlanBlock`, `storyDirectorBlock`)
- Default flag: `.env.example` line 18–20
