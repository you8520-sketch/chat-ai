# Macro progress report — 53-round stall incident

**Status:** Cannot compute from production data. Architecture-only bounds below.

## Production history

```text
PRODUCTION_HISTORY_ACCESSIBLE: false
TOTAL_ROUNDS: unknown (symptom ~53)
ROUNDS_AUDITED: 0
```

## Metrics (required — all unknown without DB)

| Metric | Value |
|--------|-------|
| DISTINCT_MACRO_SCENE_EPOCHS | unknown |
| LOCATION_CHANGE_COUNT | unknown |
| STORY_PHASE_CHANGE_COUNT | unknown |
| THREAD_ADD_COUNT | unknown |
| THREAD_RESOLVE_COUNT | unknown |
| QUEST_CHANGE_COUNT | unknown |
| FLAG_CHANGE_COUNT | unknown |
| EXIT_ROUTE_CREATED_COUNT | unknown |
| EXIT_ROUTE_LATER_ERASED_OR_FORGOTTEN_COUNT | unknown |
| OBSTACLE_REINTRODUCTION_COUNT | unknown |
| FUNCTIONALLY_EQUIVALENT_OBSTACLE_LOOP_COUNT | unknown |
| SUCCESS_COUNT | unknown |
| SUCCESS_WITH_DURABLE_PROGRESS | unknown |
| SUCCESS_PROGRESS_CONVERSION_RATE | unknown |
| LONGEST_SAME_LOCAL_OBJECTIVE_STREAK | unknown (~53 if symptom accurate) |

## Expected epoch pattern (hypothesis — not verified)

If production matches human symptom:

```text
R1–R53  LOCATION: same building / escape zone (hypothesis)
         GOAL: escape (implicit, not in structured state)
         PROGRESS: local hazard rotation only
```

Cannot derive real epoch boundaries without state deltas.

## Audit definition of macro progress (for future extraction)

Count durable progress when any of:

- new usable route in flags/quests/narration **and** persists in next-round structured state
- location meaningfully changes
- storyPhase / thread / quest advances
- major obstacle removed without equivalent replacement in same location

Do **not** count: new fungus/spore flavor text alone, same exit restated, threat repositioning.

## PRE_#725 / POST_#725

Rollout boundary **not provable** without round timestamps and deploy log. Do not split.

## World-only bootstrap interaction

If incident campaign lacked `directorPlan`:

- GM lacked global goal/ending/major-event anchor → higher drift **risk**
- Still requires local progress failure (nextRoundContext, no scene owner) for ~53-round same-scene stall

See `world-only-bootstrap-report.md`.
