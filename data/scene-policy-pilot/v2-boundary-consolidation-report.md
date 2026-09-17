# V2 Boundary Consolidation + Living Absorption Audit

Classification: **ROOT_CAUSE_FIXED** (location hook + boundary materialization)

Benchmark status: **R5_VARIANCE_PILOT_COMPLETE** — output variance partially remains (see below)

## BEFORE

- R1 T2 `"집에 도착했다."` → false `known_shared_location` → `reconvergence_offered` by T3
- R5 V2 state `temporary_quiet` correct but rendered generic hold block → model variance on boundary negotiation
- Living: self-generated hooks → next-turn facts → reconnection (parallel owner; not production wired)

## ROOT CAUSE

| Issue | Owner | Cause |
|-------|-------|-------|
| False location hook | `extractReconvergenceHooks()` | Any `LOCATION_TERMS` hit without shared-relation semantics |
| Weak boundary output | `renderSceneDirectiveV2ForPrompt()` | No boundary branch; `temporary_quiet` used same hold copy as together |
| R5 T2 advance beat | `buildSceneDirectiveV2()` | No-contact did not force `hold_current_beat` / zero budget before stagnation branch |

## OWNER MAP (after consolidation)

| Concern | Canonical owner |
|---------|-----------------|
| Parting / no-contact detection | `reconvergenceState.ts` |
| Hook provenance (user/trigger/canon only) | `collectAuthoritativeReconvergenceText()` |
| Shared location evidence | `hasSharedLocationReconvergenceEvidence()` |
| Lifecycle transition | `advanceReconvergenceState()` |
| Boundary execution contract | `resolveBoundaryExecutionContract()` — **V2 sole materializer owner** |
| Prompt materialization | `renderSceneDirectiveV2ForPrompt()` boundary branch |
| Living (benchmark-only) | `livingSceneDirective.ts` — **not** a second production canonical owner |

No duplicate boundary owners in V1/V2/Living production inject path when V2 ON (`event_restraint_v2` sole owner).

## AFTER

- Solo user location reports do not create hooks (relation + participant semantics)
- `temporary_quiet` / `hard_no_contact` / pre-due `separated` → boundary contract block with explicit prohibitions
- `eventBudget=0`, `progressionTypes=[]` under boundary contract
- Living quality semantics mapped into existing V2 vocabulary (see below)

## LIVING ABSORPTION (audit — no parallel owner)

| Living concept | V2 equivalent | Action |
|----------------|---------------|--------|
| `character_routine` | `allowsIndependentRoutine` + separated hold / `T1_INDEPENDENT_BEAT` | **Absorbed** into boundary contract |
| `relationship_aftereffect` | `allowsInternalAftereffect` + internal emotion in boundary block | **Absorbed** |
| `environment_continuity` | Existing hold + scene prose (no new hook) | Already covered |
| `parallel independent activity` | Separated hold before due; no reconverge without hooks | **Absorbed** |
| `future_intent` | Blocked under boundary contract (`blocksFutureMeetingInitiative`) | **Explicitly suppressed** at boundary |
| Self-generated hook loop | Authoritative hook provenance (RC/BOUND6-7) | **Shared canonical provenance** |

Living renderer stays benchmark-only; production V2 ON does not dual-inject.

## PRESERVED

- B13 / R2 user shared-item hooks (BOUND8)
- User-confirmed schedules (BOUND9)
- Authoritative trigger reunion/defer (BOUND10)
- R5 `temporary_quiet` state machine
- R1 T1 separation fix (RC1–RC3)

## REGRESSION

- BOUND1–BOUND10 PASS (`src/lib/boundaryRegression.test.ts`)
- RC1–RC9 PASS (`src/lib/reconvergenceRegression.test.ts`)

## SYSTEM DELTA

| | |
|--|--|
| **BEFORE** | Keyword location → hook; generic hold under no-contact |
| **PROBLEM** | Manifest/state drift; boundary negotiation variance |
| **AFTER** | Relation-gated location; boundary contract materialization |
| **REMOVED** | Generic hold for active boundary lifecycle |
| **PRESERVED** | Real hooks, triggers, character internal emotion |
| **REGRESSION RISKS** | Over-tight shared-location gate on rare canon-only location lore |
