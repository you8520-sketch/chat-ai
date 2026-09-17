# Dead System / Parallel Owner Audit Report

**Main SHA (verified at start):** `1026e9fd58eae5e6bbdda05885a54da743ac0867`
**Branch:** `cursor/dead-system-parallel-owner-audit-aa40`
**Canonical owner:** SceneDirective v1.2 (`sceneDirective.ts`)
**Status:** `PARTIAL_CLEANUP_ONLY`

---

## 0. VERIFIED BASELINE

- `git fetch origin main` → `1026e9fd58eae5e6bbdda05885a54da743ac0867`
- Standard = compact `[SCENE PACING]` (COMPACT_SUFFICIENT)
- Auto / Simulation = full SceneDirective v1.2 block
- sceneDirectiveV2 + livingSceneDirective remain **env-gated experiments** — not deleted

---

## 1. SYSTEM CLASSIFICATION

| System | Classification | Production reachability (default env) |
|--------|----------------|--------------------------------------|
| **SceneDirective v1.2** | **PRODUCTION_ACTIVE** | Always — motion, grounding, progression commit, wire |
| **sceneDirectiveV2** | **EXPERIMENT_ONLY** | OFF by default; `shadow`/`on` compute + telemetry + reconvergence DB when enabled |
| **livingSceneDirective** | **EXPERIMENT_ONLY** | OFF by default; user+model allowlist when `LIVING_SCENE_DIRECTIVE_V2_ENABLED=1` |
| **reconvergenceState** | **EXPERIMENT_ONLY** (V2 satellite) | Writes only when V2 compute enabled + finalize commit |

### sceneDirectiveV2 detail

| Element | Classification |
|---------|----------------|
| `buildSceneDirectiveV2` | EXPERIMENT_ONLY — route callsite when `isSceneDirectiveV2ComputeEnabled()` |
| `renderSceneDirectiveV2ForPrompt` | EXPERIMENT_ONLY — prompt only via `rpDiagnosticCanary` branch + `scenePacingOwner === event_restraint_v2` |
| `logSceneDirectiveV2Telemetry` | EXPERIMENT_ONLY — console telemetry |
| `commitReconvergenceTransition` | EXPERIMENT_ONLY — post-finalize when V2 compute ran |
| `buildSceneDirectiveV2PromptBlock` | **DEAD** — zero callers → **removed** |

### livingSceneDirective detail

| Element | Classification |
|---------|----------------|
| `buildLivingSceneDirective` | EXPERIMENT_ONLY — route when `isLivingSceneDirectiveV2EnabledForUser()` |
| `renderLivingSceneDirectiveForPrompt` | EXPERIMENT_ONLY — prompt via `rpDiagnosticCanary` + `living_continuity_director` owner |
| `buildLivingSceneDirectivePromptBlock` | **DEAD** — zero callers → **removed** |

---

## 2. OWNER MAP (responsibility × parallel execution)

| Responsibility | Canonical v1.2 owner | sceneDirectiveV2 | livingSceneDirective | Simultaneous in default prod? |
|----------------|----------------------|------------------|----------------------|-------------------------------|
| **Motion decision** | `buildSceneDirective` → wire via `scenePacingController` | Parallel compute when flag `shadow`/`on` | Parallel compute when living canary | **NO** — V2/living compute skipped when flags OFF |
| **Stagnation** | `analyzeStagnation` in v1.2 | V2 internal copy | Living internal copy | **NO** (flags OFF) |
| **Scene kind** | `resolveSceneKind` (v1.2) | V2 pacing buckets | Living mode buckets | **NO** |
| **Cast focus** | `resolveSceneCastFocus` (v1.2) | Not wired to wire | Not wired to wire | **NO** |
| **NPC grounding** | `resolveNpcGrounding` (v1.2) | V2 `allowNewNpc` (experiment) | Living eligibility | **NO** — wire uses v1.2 `canonicalSceneDirective: legacySceneDirective` |
| **Progression selection** | v1.2 `progressionTypes` | V2 types (UI/canary only) | Living types (UI/canary only) | **NO** — `commitSceneProgressionState` uses `sceneDirective.progressionTypes` (legacy only) |
| **Next-beat steering** | v1.2 execution contract | V2 prompt block (canary) | Living prompt block (canary) | **NO** |
| **User agency** | v1.2 `userControl` | V2 rules | Living rules | **NO** |
| **Prompt rendering** | Standard: `[SCENE PACING]`; Auto/Sim: v1.2 full block | Inject only: canary + `SCENE_DIRECTIVE_V2_MODE=on` | Inject only: canary + living allowlist + V2 off/shadow | **NO** — default path = v1.2 only |
| **Progression history** | `sceneProgressionState` (v1.2 commits) | `chat_reconvergence_state` (V2 only) | None | **NO** overlap on same table |

**Policy mutex:** `resolveScenePacingPromptOwner` — V2 ON supersedes Living; shadow/off → Living if enabled else legacy_v1. Only one prompt owner selected; dual inject prevented by design.

**Important production path:** When `rpDiagnosticCanary` is null (normal users), `sceneDirectiveBlock` is **always** `renderSceneDirectiveForPrompt(sceneDirectiveForRender)` — V2/Living block render is unreachable regardless of V2 mode.

---

## 3. PRODUCTION CALLSITE TRACE

### route.ts (`/api/chat`)

| Step | v1.2 | V2 | Living |
|------|------|-----|--------|
| Build | `legacySceneDirective = buildSceneDirective(...)` | `eventRestraintV2` when compute enabled | `livingSceneDirective` when user allowlist |
| Prompt block (no canary) | `renderSceneDirectiveForPrompt` | **not injected** | **not injected** |
| Prompt block (canary) | fallback | `renderSceneDirectiveV2ForPrompt` if owner | `renderLivingSceneDirectiveForPrompt` if owner |
| Wire controls | `canonicalSceneDirective: legacySceneDirective` | — | — |
| Progression commit | `sceneDirective.progressionTypes` | — | — |
| Reconvergence commit | — | `commitReconvergenceTransition` | — |

### Feature flags / env

| Env | Default | Effect |
|-----|---------|--------|
| `SCENE_DIRECTIVE_V2_MODE` | `off` (comment in `.env.example`) | `off`: no compute; `shadow`: compute+telemetry+shadow DB; `on`: inject owner + production reconvergence namespace |
| `LIVING_SCENE_DIRECTIVE_V2_ENABLED` | unset/false | Requires `=1` + `LIVING_SCENE_DIRECTIVE_V2_USER_IDS` + allowed model |

### DB

| Table | Writer | Reader | Deleted this PR? |
|-------|--------|--------|------------------|
| `chat_reconvergence_state` | V2 finalize commit | V2 compute load | **NO** |
| `scene_progression_state` | v1.2 commit | v1.2 load | **NO** |

---

## 4. HYPOTHESIS / DEAD CODE AUDIT

| Candidate | Verdict | Action |
|-----------|---------|--------|
| `buildSceneDirectiveV2PromptBlock` | **DEAD** (0 imports) | **REMOVED** |
| `buildLivingSceneDirectivePromptBlock` | **DEAD** (0 imports) | **REMOVED** |
| sceneDirectiveV2 core module | **KEEP** — EXPERIMENT_ONLY, live route callsites | — |
| livingSceneDirective core module | **KEEP** — EXPERIMENT_ONLY, live route callsites | — |
| reconvergenceState | **KEEP** — V2 experiment DB | — |
| `sceneDirective = legacySceneDirective` alias | **KEEP** — documents canonical commit source | — |

---

## 5. REGRESSION FIXTURES (D1–D12)

| Fixture | Description | Result |
|---------|-------------|--------|
| D1 | sceneDirectiveV2 route callsites exist | PASS |
| D2 | livingSceneDirective route callsites exist | PASS |
| D3 | Default env → legacy_v1 owner | PASS |
| D4 | Standard prompt parity | PASS |
| D5 | Auto full v1.2 block | PASS |
| D6 | Simulation full v1.2 block | PASS |
| D7 | Motion owner count = 1 | PASS |
| D8 | No V2/Living inject when off | PASS |
| D9 | Progression commit uses legacy only | PASS |
| D10 | Regen/continuation no V2/Living prose | PASS |
| D11 | No extra provider calls | PASS |
| D12 | No billing hooks | PASS |

File: `src/lib/deadSystemParallelOwnerAudit.test.ts`

---

## FINAL REPORT

### BEFORE

- **v1.2** fully wired: build → context/wire → compact or full block → progression commit.
- **sceneDirectiveV2** wired in route behind `SCENE_DIRECTIVE_V2_MODE`; compute/telemetry/reconvergence when enabled; prompt inject gated by `rpDiagnosticCanary` + owner resolution.
- **livingSceneDirective** wired behind env+user+model allowlist; prompt inject same canary gate.
- Two unused prompt-block wrapper exports with zero callers.

### PROBLEM

No **production duplicate prompt owner** under default env. Parallel systems exist as **intentional experiments**, not dead production paths. Only provably unreachable exports found.

### ROOT CAUSE

V2 and Living were added as gated experiments alongside v1.2 canonical owner; wrappers duplicated `build+render` one-liners but were never adopted.

### AFTER

- Canonical owner unchanged: **SceneDirective v1.2**
- Removed 2 dead wrapper exports only
- Experiment modules retained with documented reachability

### REMOVED

- `buildSceneDirectiveV2PromptBlock` (`sceneDirectiveV2.ts`)
- `buildLivingSceneDirectivePromptBlock` (`livingSceneDirective.ts`)

### KEPT

- Full `sceneDirectiveV2.ts`, `livingSceneDirective.ts`, policy modules, reconvergence stack
- Route experiment wiring (STOP: production-active when flags enabled)

### FOLLOW-UP

- Decide whether V2 ON without `rpDiagnosticCanary` should inject (`.env.example` says on injects; normal path currently always v1 block)
- DB legacy cleanup for unused `party_rooms` (separate)
- Integrate or retire V2/Living after experiment conclusion
- General Chat party feature (separate)

### REGRESSION RISKS

| Risk | Mitigation |
|------|------------|
| Standard behavior change | D4 + existing Q/O/P/F/W |
| Auto/Sim dual motion | D5/D6 + skipMotionCue unchanged |
| Progression history fork | D9 — commit still legacy |
| Shadow mode duplicate compute | CPU only; no prompt change |
| Billing / provider calls | D11/D12 |

### PROOF

- D1–D12 pass
- Q/O/P scene suites pass
- lint + typecheck:app + build pass

### FINAL STATUS

**`PARTIAL_CLEANUP_ONLY`**
