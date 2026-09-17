# V2 reconvergence provenance P0 fix report

**Status:** READY_FOR_GPT_MERGE_REVIEW  
**PR:** #931 (draft, not merged)  
**Provider HTTP:** 0 | **DB migration:** 0 | **Railway change:** 0

## BEFORE — evidence sources and transition call graph

```
route (V2 block)
  ├─ buildSceneDirectiveV2(memory, relationship, lorebook, user, trigger)
  │    └─ advanceReconvergenceState(merged lorebook+relationship)
  ├─ getUpdatedReconvergenceStateFromBuild(user, trigger ONLY)  ← drift
  └─ prepareReconvergenceTransition(memory+relationship merged, lorebook separate)  ← drift

extractReconvergenceHooks
  └─ collectAuthoritativeReconvergenceText(user + trigger + memory + lorebook)
       └─ single keyword scan → cross-source false hooks
```

## REPRODUCTION (deterministic)

| Case | Input | Before hooks | After hooks |
|------|-------|--------------|-------------|
| A | user parting + static lorebook (team/base/terminal) | `established_contact_channel`, `known_shared_location`, `shared_organization` | `[]` |
| B | memory `우리` + lorebook `병원` | `known_shared_location` | `[]` |
| C | lorebook past `카페에서 함께 만난` | `known_shared_location` | `[]` |
| PART2–4 | spatial `여기까지` (왔다/따라와/이어진다) | `true` (overmatch) | `false` |
| PART1,5 | session-end `여기까지` | `true` | `true` |

Transition parity drift (route-like): `getUpdatedReconvergenceStateFromBuild` omitted static pools while `prepareReconvergenceTransition` merged relationship into memory — **confirmed pre-fix**; **fixed** via single `reconvergenceEvidence` object in route.

## ROOT CAUSE — ACCEPT / REJECT

| Candidate | Verdict |
|-----------|---------|
| Flatten memory/lorebook/user before keyword scan | **ACCEPT** — root cause for PROV1–3 |
| Static lorebook as HOOK_ORIGINATOR | **ACCEPT** — unintended; fixed via per-originator extraction |
| Route triple evidence assembly | **ACCEPT** — parity drift; fixed via canonical object |
| Bare `여기까지` substring in PARTING_TERMS | **ACCEPT** — PART2–4 overmatch |
| Capability vs unresolved-hook type split | **FOLLOW-UP** — not required for this P0 |
| Remove `getUpdatedReconvergenceStateFromBuild` | **REJECT** — not required; callers preserved |

## OWNER MAP

| Concern | Owner |
|---------|-------|
| Source provenance / role map | `reconvergenceState.ts` (`buildReconvergenceEvidenceSources`, `RECONVERGENCE_EVIDENCE_ROLE_MAP`) |
| Hook extraction | `reconvergenceState.ts` (`extractHooksFromOriginatorText` per source) |
| Transition advance | `reconvergenceState.ts` (`advanceReconvergenceState`) |
| Persistence prepare/commit | `reconvergenceState.ts` |
| Canonical turn evidence (route) | `route.ts` `reconvergenceEvidence` |
| V2 directive consumer | `sceneDirectiveV2.ts` (`buildSceneDirectiveV2`, `getUpdatedReconvergenceStateFromBuild`) |

### Source roles

| Source | Role |
|--------|------|
| CURRENT_USER | HOOK_ORIGINATOR |
| RECENT_USER | HOOK_ORIGINATOR |
| ACTIVE_TRIGGER | HOOK_ORIGINATOR |
| PERSISTED_UNRESOLVED_STATE | HOOK_ORIGINATOR |
| MEMORY | SUPPORT_ONLY |
| RELATIONSHIP_MEMORY | SUPPORT_ONLY |
| LOREBOOK | SUPPORT_ONLY |

## AFTER — single canonical flow

```
route
  └─ reconvergenceEvidence (once)
       ├─ buildSceneDirectiveV2(evidence)
       ├─ getUpdatedReconvergenceStateFromBuild(evidence, built)
       └─ prepareReconvergenceTransition(same fields)

extractReconvergenceHooks
  └─ per originator text (user/recent/trigger only) — no static flatten
```

## PRESERVED

- R1: T1 separated, no false hook from assistant, solo home arrival, independent routine
- R5: temporary_quiet, boundary contract, hold_current_beat, eventBudget=0
- B13/R2: real shared item
- Confirmed schedule + authoritative trigger fixtures
- V2 default OFF (unchanged)
- BOUND1–10, RC1–9, EVAL1–9, existing benchmark gates

## BLIND ARTIFACT CLEANUP AUDIT

| Artifact | Writer | Reader | Tests | Classification |
|----------|--------|--------|-------|----------------|
| `buildPilotBlindArtifacts()` | removed | — | — | **REMOVED** — obsolete, no readers, known identity leak |
| `blind-samples.json` | removed | — | — | **REMOVED** |
| `answer-key.json` | removed | — | — | **REMOVED** |

## REGRESSION GATES ADDED

- `src/lib/reconvergenceProvenance.test.ts`: PROV1–7, PARITY1–4, PART1–5, CASE C

## SYSTEM DELTA

| | |
|--|--|
| **BEFORE** | Static canon flattened into hook scan; route triple evidence assembly; bare `여기까지` parting |
| **PROBLEM** | False unresolved hooks; transition parity drift; spatial parting overmatch |
| **AFTER** | Source-aware originator-only hook extraction; one canonical evidence object per turn |
| **REMOVED** | Lorebook/memory from hook-origin flatten path; bare `여기까지` from PARTING_TERMS |
| **PRESERVED** | R1/R5/B13/schedule/trigger; existing gates; V2 OFF default |

## PROOF

- `npm run lint` / `typecheck:app`: pass
- `node --conditions=react-server --import tsx --test src/lib/reconvergenceProvenance.test.ts src/lib/reconvergenceRegression.test.ts src/lib/boundaryRegression.test.ts`: 41/41 pass
- `git diff --check`: clean
