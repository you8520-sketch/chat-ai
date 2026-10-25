# TRPG multi-round story progress — owner map (current main)

**SHA:** `330d0069d44f63538a45635e0586d121435c488d`

One responsibility → one canonical owner. Duplicates noted.

## Summary table

| Responsibility | CANONICAL_OWNER | WRITER | PERSISTENCE | NEXT_READER | PROMPT_INJECTION |
|----------------|-----------------|--------|-------------|-------------|------------------|
| SCENARIO_PLAN (authored) | `scenarioTemplates` + `campaignContext.scenarioSnapshot` | Scenario editor / template row | `trpg_scenario_templates.scenario_plan_json`, snapshot in `trpg_campaign_context` | `resolvedCampaignPlan` | `serializeTrpgScenarioPlanForGm` |
| SCENARIO_PLAN (world sandbox) | `sandboxDirector.ensureCampaignDirectorContext` | `completeTrpgAuthoringJson` when flag on | `trpg_campaign_context.director_plan_json` | `resolvedCampaignPlan` | same |
| SCENARIO_GOAL / ENDING (static) | `scenarioPlan.ts` fields on plan | Author or sandbox generator | plan JSON | GM prompt each round | `[SCENARIO PLAN]` block |
| SCENARIO_ENDING (runtime) | `campaignContext.applyCampaignStoryProgress` | GM delta `endingConditionId`, `campaign_finished` | `trpg_campaign_context.ending_status_json` | `serializeCampaignDirectorState` | director state block |
| STORY_DIRECTOR_BLOCK | `engineAdvance.runGmForRound` | assembled from `campaignContext` serializers | n/a (derived each call) | GM user prompt | `buildTrpgGmUserBlock.storyDirectorBlock` |
| STORY_PHASE | `campaignContext.applyCampaignStoryProgress` | GM delta `storyPhase` | `trpg_campaign_context.story_phase` | `serializeCampaignDirectorState`, delta contract | director block (if plan) |
| THREAD_ADD / RESOLVE | `applyCampaignStoryProgress` | GM delta `threadsAdd` / `threadsResolve` | `active_threads_json`, `resolved_threads_json` | `serializeCampaignDirectorState` | director block (if plan) |
| NEXT_ROUND_CONTEXT | GM delta → `campaignLedger.applyCampaignLedger` | GM `next_round_context` | `trpg_campaign_state.next_round_context` | `buildCampaignMemoryPrompt` | `[NEXT DECISION]` in memory block |
| LOCATION | same ledger | GM delta `location` | `trpg_campaign_state.location` | memory block | `location=` line |
| QUEST | ledger merge | GM `questsAdd`/`questsRemove` | `quests_json` | memory block | `quests:` line |
| FLAG | ledger merge | GM `flagsAdd`/`flagsRemove` | `world_flags_json` | memory block | `flags:` line |
| CURRENT_SCENE_GOAL | **none** | — | — | — | — |
| SCENE_PROGRESS | **none** | — | — | — | — |
| OBSTACLE_RESOLUTION | **none** (flags ad hoc) | GM may add flags | `world_flags_json` | memory | no semantic contract |
| SCENE_EXIT_TRANSITION | **none** | GM narration + location delta only | location | memory | prompt prose only (`gmPrompt` SCENE CRAFT) |
| GM_DELTA_PARSE | `gmPrompt.parseTrpgGmOutput` | — | — | commit path | — |
| GM_DELTA_APPLY | `engineAdvance.commitPendingGmResult` | — | ledger + context + sheets | next round load | — |
| GM_STATE_PERSISTENCE | `persistCampaignLedger`, `persistCampaignContext`, sheets | commit transaction | `trpg_campaign_state`, `trpg_campaign_context`, sheets | loaders above | — |
| NEXT_GM_PROMPT_INJECTION | `engineAdvance.runGmForRound` + `buildTrpgGmUserBlock` | — | — | — | full user block |

## STORY_DIRECTOR_BLOCK runtime

```text
STORY_DIRECTOR_BLOCK_EXISTS_AT_RUNTIME: conditional (only when resolvedCampaignPlan != null)
STORY_DIRECTOR_BLOCK_EMPTY_RATE: ~100% for world-only campaigns with flag off; 0% for scenario campaigns with plan
STORY_DIRECTOR_BLOCK_CONTENTS:
  - [STORY DIRECTION — GM only] (serializeCampaignDirectorInstructions)
  - [DIRECTOR DELTA CONTRACT] (storyPhase, threads, endingConditionId + soft round hint)
  - [CAMPAIGN DIRECTOR STATE] (storyPhase, active/resolved threads, ending text)
STORY_DIRECTOR_BLOCK_PERSISTENCE_SOURCE: derived from trpg_campaign_context each GM call
STORY_DIRECTOR_BLOCK_REFRESH_POLICY: no separate refresh; updates when GM delta applies story fields
```

## nextRoundContext

```text
WRITTEN_EVERY_ROUND: when GM emits next_round_context in delta
MAX_CHARS: 400 (TRPG_NEXT_ROUND_CONTEXT_MAX_CHARS)
PERSISTS_OR_REPLACES: full replace when new value non-null; unchanged when omitted
INJECTED_NEXT_ROUND: yes, [NEXT DECISION] in [TRPG STRUCTURED STATE]
```

Ledger test confirms omission preserves previous value; **new local threat overwrites** prior macro context in one field.

## storyPhase / threads

```text
HAS_WRITER: GM delta (optional)
WRITTEN_IN_PRODUCTION: unknown (no DB)
PERSISTED: yes when plan exists and delta includes fields
READ_NEXT_ROUND: serializeCampaignDirectorState
INJECTED_TO_GM: only when plan exists
USED_BY_REGEN: same commit path (idempotent delta log)
USED_BY_RECOVERY: pending GM replay uses same commit
```

Without scenario plan, GM system prompt delta example **does not include** storyPhase/threads keys; director contract absent.

## Scenario plan usage

```text
SCENARIO_PLAN_PRESENT_IN_GM_CALLS: when resolvedCampaignPlan non-null
PLAN_PRESENT_EVERY_ROUND: yes (static full list each round)
PLAY_LENGTH_USED_BY_RUNTIME: prompt text only
MAJOR_EVENTS_TRACKED_AS_USED: false
CLUES_TRACKED_AS_REVEALED: false
ENDING_CONDITIONS_TRACKED: ending_status_json when GM sets endingConditionId
```

## LOCAL_SCENE_PROGRESS

```text
LOCAL_SCENE_PROGRESS_OWNER_FOUND: false
SCENE_EXIT_TRANSITION_OWNER_FOUND: false (only soft GM SCENE CRAFT prose + location)
```

Existing fields partially overlap but none answer: resolved obstacles, open routes, scene completion.

## Obsolete / parallel systems (TRPG scope)

| System | Status | Notes |
|--------|--------|-------|
| `scene_progression_state` (chat `db.ts`) | **DEAD** for TRPG | App Router chat only |
| Scene momentum (`sceneMomentum/`) | **DEAD** for TRPG | contextBuilder chat path |
| Sandbox director | **PARTIALLY_CONNECTED** | default off |
| Memory seal / events | **PRODUCTION_CONNECTED** | episodic facts, not scene goal |
| PR #727 forward-motion prompt | **NOT ON MAIN** | turn-level only |

## Global vs local goal

Architecture **does not distinguish** global scenario goal from local scene/encounter goal. `goal` in plan is global; `nextRoundContext` holds last decision prompt only.
