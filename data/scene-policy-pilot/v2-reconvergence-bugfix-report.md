# V2 R1 Reconvergence Bugfix Report

Status: **V2_RECONVERGENCE_ROOT_CAUSE_FIXED** → **TARGETED_PILOT_READY_FOR_GPT_EVALUATION**

## BEFORE

R1 `NATURAL_PARTING_NO_HOOK` V2 T1 (`오늘은 여기까지. 들어가.`) committed state:

- `state = "together"` (parting not detected; `PARTING_TERMS` lacked session-end phrasing)
- `unresolvedHooks`: false `shared_item`, false `confirmed_schedule`
- Source: pilot assistant output (`가방`, `내일 일정`) scanned by `extractReconvergenceHooks()` with no role filter

V2 T2+ received `reconvergence="together"` and character re-entered user space.

## ROOT CAUSE

| Hypothesis | Verdict | Evidence |
|------------|---------|----------|
| H1 assistant suggestion → authoritative hook | **ACCEPT** | Pilot T1 output contains `가방`/`일정`; keyword scan created hooks |
| H2 currentUser duplicated in recentMessages | REJECT (secondary) | Duplication harmless; assistant inclusion was primary |
| H3 parting intent not read | **ACCEPT** | `detectPartingIntent("오늘은 여기까지. 들어가.")` was false |
| H4 hooks block separation | REJECT | Separation not attempted because H3 failed; hooks added first |
| H5 benchmark-only input shape | PARTIAL | Post-turn transition included assistant; fixed to production commit shape |
| H6 production lacks provenance | **ACCEPT** | `extractReconvergenceHooks` joined all recent message roles |

## OWNER MAP

| Concern | Owner |
|---------|-------|
| Separation intent | `detectPartingIntent()` — `reconvergenceState.ts` |
| Hook extraction | `extractReconvergenceHooks()` / `collectAuthoritativeReconvergenceText()` |
| Transition | `advanceReconvergenceState()` |
| Persistence | `prepareReconvergenceTransition()` + `commitReconvergenceTransition()` |
| V2 directive consumer | `buildSceneDirectiveV2()` / `getUpdatedReconvergenceStateFromBuild()` |
| Benchmark adapter | `advanceV2ReconvergenceForBenchmark()` — delegates to production transition |

## AFTER (fixed V2 targeted pilot)

R1 V2 T1:

- `reconvergence`: **separated**
- `state_after`: **separated**, `unresolvedHooks: []`

R5 V2: **temporary_quiet** preserved (T1–T3).

## PRESERVED

- R5 no-contact semantics (RC8)
- B13/R2 user shared-item hooks (RC7)
- User-confirmed schedule hooks (RC6)
- Production path outside R1 false-hook scope unchanged in structure

## TARGETED PILOT

| Arm | Source | Calls |
|-----|--------|-------|
| V1 R1/R5 | Existing `pilot-result.json` baseline | 0 (reused) |
| V2 R1/R5 | `targeted-pilot-result.json` | 7 |
| Living R1/R5 | `targeted-pilot-result.json` | 7 |

**Accounting:** planned=14, successful=14, fallback=0, retry=0, auxiliary=0, billing=0, DB=0

GPT artifact: `data/scene-policy-pilot/gpt-evaluation-artifact.json` (21 turn records, labeled, not blind)

## COMMON FAILURE (separate follow-up)

User agency (user movement/fatigue/unprovided actions) remains a cross-arm issue — not addressed in this patch.

## PROOF

- RC1–RC9 PASS (`src/lib/reconvergenceRegression.test.ts`)
- BMARK1–22, TRJ1–4, MODEL1–4, COST1–5 PASS (harness suite)
- Offline R1 T1 reproduction proved bug pre-fix; post-fix RC gates green
