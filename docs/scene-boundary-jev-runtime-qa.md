# Scene-boundary JEV read-only QA triage (runtime shadow feasibility)

## Selection

`JEV_SCENE_BOUNDARY_QA_TRIAGE_SELECTED_READ_ONLY`  
`JEV_SCENE_BOUNDARY_ENFORCEMENT_NOT_SELECTED`

## Runtime status

`JEV_SCENE_BOUNDARY_RUNTIME_SHADOW_READY_NOT_ACTIVATED`

Default OFF. No Railway activation in this PR.

## Architecture

```
SceneDirective V2 compute (shadow|on)
  → request-local BoundaryExecutionContract
  → finalizeAssistantMessage (canonical prose = savedText)
  → scheduleSceneBoundaryJevQa (fire-and-forget)
       only if SCENE_BOUNDARY_JEV_QA_ENABLED=1
       and boundaryExecution != null
       and lexical scanner ≥1 signal
  → at most one Decisions call per generation identity
  → structured log: review priority annotation only
```

## Gates

| Env | Default | Role |
|---|---|---|
| `SCENE_DIRECTIVE_V2_MODE` | `off` | Must be `shadow` or `on` for canonical contract |
| `SCENE_BOUNDARY_JEV_QA_ENABLED` | unset/off | Must be `1` to schedule QA |

Neither is enabled by this PR on Railway.

## Non-goals

- No blocking / regeneration / prompt mutation
- No second boundary detector
- No DB migration / admin UI
- No Luna shared-call budget sharing
- No user billing change
