# POST-D3 FINALIZATION AUDIT (READ-ONLY)

**Phase:** Post-D3 finalization audit — READ-ONLY ONLY.
**Date:** 2026-07-23
**Accepted architecture:** Frozen DeepSeek candidate (D3 verdict A. PASS).
**Constraints observed:** 0 API/model calls · 0 file deletions · 0 code edits · 0 commit/push/PR/merge/deploy · 0 production flag changes.

---

## 1. Purpose

Separate the working tree into five buckets so a future commit/PR can be scoped cleanly — NO functional changes in this phase:
- (A) PRODUCTION_REQUIRED — production code the accepted architecture needs on the real runtime path.
- (B) TEST_REQUIRED — tests that must ship with the commit.
- (C) EVIDENCE_KEEP — reports/metrics/locked fixtures to preserve per repo convention.
- (D) TEMP_DELETE_CANDIDATE — `_tmp` harness / disposable API outputs to exclude (or delete) before commit.
- (E) UNRELATED_EXISTING_CHANGE — pre-existing WIP or a different feature's WIP not part of the canon/memory/momentum PR.

## 2. Git Working Tree Full Audit

Commands run: `git status --porcelain=v1` (167 entries), `git diff --stat` (6 tracked files, +266/-9), `git diff --check` (exit 0 — no whitespace errors).

**Modified tracked files (6):**

| file | status | owner/phase | purpose | prod? | test? | recommend | risk |
|------|--------|-------------|---------|-------|------|-----------|------|
| src/app/api/chat/route.ts | M | canon/D3 | wires canonInjectionPolicy + lazy compile + shadowD0; passes policy+plan to buildContext | YES | indirect | KEEP (prod) | low |
| src/lib/characterFormSave.ts | M | canon/D3 | buildCanonPlanJsonForSave; save creator_canon_plan_json on create/update | YES | indirect | KEEP (prod) | low |
| src/lib/db.ts | M | canon/D3 | additive migration: `creator_canon_plan_json TEXT` | YES | indirect | KEEP (prod) | low (additive) |
| src/lib/statusWidget/extractNormalize.ts | M | kaomoji WIP | kaomoji/emoji format priority for status-widget fields | NO | NO | SEPARATE (unrelated) | medium — mixes unrelated WIP |
| src/services/contextBuilder.ts | M | canon/D3 | layered canon + selective archive + AR-A3 ACTIVE + Momentum wiring | YES | indirect | KEEP (prod) | low |
| src/types.ts | M | canon/D3 | ContextBuildInput/BuiltContext fields (policy, plan, momentum) | YES | indirect | KEEP (prod) | low |

**Untracked production source (new, mine):**

| file | owner | purpose | recommend |
|------|-------|---------|-----------|
| src/lib/canonInjectionPolicy.ts + .test.ts | canon | D0/D1/D2 policy, kill switch, model isolation | KEEP (prod + test) |
| src/lib/canonPlan/ (15 files: 10 src + 5 test) | canon | compiler, activeSelector (AR-A3/B1/B2), lazyCompile, compileForSave, serialize, coreRenderer, observability, shadowD0, types, hash | KEEP (prod + test) |
| src/lib/memory/archiveSelective.ts + .test.ts | canon | D1.1 selective archive | KEEP (prod + test) |
| src/lib/sceneMomentum/ (5 files: 3 src + 2 test) | canon | Candidate A extractor + P2 predicate + types | KEEP (prod + test) |

**Untracked non-canon source (separate WIP):**

| file | owner | purpose | recommend |
|------|-------|---------|-----------|
| src/lib/statusWidget/characterCriticalContext.ts + .test.ts | status-widget WIP | referenced by statusWidget/extract.ts; not canon | SEPARATE (unrelated) |
| src/lib/statusWidget/kaomojiFormatPriority.test.ts | kaomoji WIP | test for extractNormalize kaomoji change | SEPARATE (unrelated) |

**Untracked scripts:**

| file group | count | recommend |
|------------|-------|-----------|
| scripts/_tmp-* (harness/probes/benches/pr-body md) | 149 | EXCLUDE/DELETE before commit |
| scripts/live-background-fallback-gate.ts | 1 | UNKNOWN_REVIEW_REQUIRED (owner unclear: runtime gate vs temp harness) |
| scripts/smoke-episodic-live-chat.ts | 1 | EXCLUDE (smoke harness) |

**Untracked data/ (entire dir untracked):**

| subdir | owner | recommend |
|--------|-------|-----------|
| data/ar0/, data/d2-live/, data/d2-momentum/, data/d2-length/, data/d3/, data/post-d3/ | canon/D3 evidence | EVIDENCE_KEEP (reports + locked metrics; per repo convention) |
| data/b2-live-d1/, data/d11-live/, data/step710c-replay/, data/step79b-replay/, data/_tmp-hy3-* | pre-existing replay | UNRELATED_EXISTING_CHANGE (not mine) |

## 3. Production-Required Code List

| file | owns | on real runtime path? | dead experiment code? |
|------|-------|-----------------------|----------------------|
| src/lib/canonInjectionPolicy.ts | D0/D1/D2 policy, kill switch, model isolation | YES (route.ts) | none |
| src/lib/canonPlan/compiler.ts | CanonPlan compiler | YES (lazyCompile/compileForSave) | none |
| src/lib/canonPlan/activeSelector.ts | AR-A3 + B1 + B2 | YES (contextBuilder.pushActiveCanon) | none |
| src/lib/canonPlan/lazyCompile.ts | lazy compile + persist | YES (route.ts) | none |
| src/lib/canonPlan/compileForSave.ts | save-time compile | YES (characterFormSave) | none |
| src/lib/canonPlan/serialize.ts / hash.ts / types.ts | serialization | YES (transitive) | none |
| src/lib/canonPlan/coreRenderer.ts | CORE/ACTIVE block render | YES (contextBuilder) | none |
| src/lib/canonPlan/observability.ts | bounded observability | YES (transitive) | none |
| src/lib/canonPlan/shadowD0.ts | D0 shadow side-effects (no prompt change) | YES (route.ts, D0 only) | none |
| src/lib/memory/archiveSelective.ts | D1.1 selective archive | YES (contextBuilder.pushArchiveMemory) | none |
| src/lib/sceneMomentum/extractor.ts | Momentum Candidate A | YES (contextBuilder) | none |
| src/lib/sceneMomentum/predicate.ts | P2 predicate | YES (contextBuilder) | none |
| src/lib/sceneMomentum/types.ts | types | YES (transitive) | none |
| src/services/contextBuilder.ts | assembles CORE/ACTIVE/Archive/Momentum | YES | none |
| src/app/api/chat/route.ts | policy resolve + lazy compile + wiring | YES | none |
| src/lib/characterFormSave.ts | save creator_canon_plan_json | YES (create/update) | none |
| src/lib/db.ts | additive column | YES (migration) | none |
| src/types.ts | ContextBuildInput/BuiltContext fields | YES | none |

All accepted features (D0/D1/D2/P2/AR-A3/B1/B2/Momentum/Archive) are on the real runtime path. No dead experiment code in these files.

## 4. Dead Experiment Code Audit

Searched production code (canonPlan/, sceneMomentum/, memory/archiveSelective.ts, canonInjectionPolicy.ts, contextBuilder.ts diff, route.ts diff) for forbidden/discarded experiments:
- Dialogue Economy / Speech Reopen Gate / NARRATIVE_DENSITY / numeric dialogue quotas — NOT present in production path.
- SCENE_CONTINUATION / coordinated LENGTH/CONTINUATION changes / Turn Scope Controller / REACT/ADVANCE/RESOLVE / Dynamic Length / Scene Engine split / DeepSeek serial-ladder adapter / CHARACTER-CENTERED DEEPENING / SHORT HISTORY OFF — NOT present in the accepted production path.

The only `_tmp` scripts referencing these (e.g. `_tmp-speech-reopen-*`, `_tmp-scene-engine-ambient-smoke`, `_tmp-deepseek-serial-ladder-smoke`, `_tmp-dialogue-density-*`) are TEMP harness, NOT imported by production code. **No forbidden experiment is active in the runtime path.** No UNKNOWN_REVIEW_REQUIRED from this check.

## 5. Prompt Freeze Audit

Frozen anchors checked against `git diff src/services/contextBuilder.ts` and `src/app/api/chat/route.ts`:
- No Godmodding rule change — diff touches neither the godmoding block nor `noGodmodding` helpers.
- Korean prose rules / WEBNOVEL paragraph layout — untouched by the diff.
- LENGTH owner — untouched; `DEEPSEEK_REGEN_LENGTH_BLOCK` only referenced (not modified).
- Terminal exact tail — untouched (the diff only inserts `deepSeekMomentumExtra` into the user-extras array; Terminal/LENGTH tail string unchanged, matches HEAD).
- Recovery continuation — untouched.
- DeepSeek SHORT HISTORY existing behavior — `deepSeekShortHistoryExtra` referenced, not modified; `isThinSceneHistory` reused BYTE-IDENTICAL (per predicate.ts header comment).

The only unrelated prompt diff is `extractNormalize.ts` (kaomoji format priority) — UNRELATED_EXISTING_CHANGE, must be separated.

## 6. Feature Flag / Rollout State Audit

| flag | default | prod current expected | OFF behavior | ON behavior | rollback |
|------|---------|----------------------|--------------|-------------|----------|
| CANON_INJECTION_ENABLED | unset (falsy) | unset → masterEnabled=false → injectionEnabled=false | no injection | enables policy | set FORCE_FULL_LEGACY |
| CANON_INJECTION_ROLLOUT_STAGE | "D0" | "D0" | D0=shadow-only FULL_LEGACY | D1/D2/D3/D4 stages | back to D0 or kill switch |
| CANON_INJECTION_DEEPSEEK_CANARY | unset | unset (canary OFF) | actual stays FULL_LEGACY (CONTROL) | D1/D2 actual injection | unset flag |
| CANON_ARCHIVE_DEEPSEEK_SELECTIVE | unset | unset | FULL_ALWAYS archive | SELECTIVE archive | unset flag |
| CANON_INJECTION_DEEPSEEK_MODE | unset | unset (LAYERED at D2+) | — | override canonMode | unset |
| CANON_INJECTION_FORCE_FULL_LEGACY / _KILL_SWITCH | unset | unset | — | FULL_LEGACY + FULL_ALWAYS + ACTIVE OFF + Momentum OFF | set this flag |

**CRITICAL:** Default rollout stage = **D0** (shadow-only, FULL_LEGACY). DeepSeek D1/D2 *actual* injection requires `CANON_INJECTION_DEEPSEEK_CANARY=1` AND stage≥D1. **Merging the PR does NOT auto-activate DeepSeek production-wide** — without the canary flag set in the deployed env, DeepSeek stays FULL_LEGACY (CONTROL). Controlled canary remains possible post-merge.

## 7. Default Behavior Hard Gate

- Muse / Gemini / HY3 → `isUnvalidatedDefaultFullLegacyModel` → FULL_LEGACY + FULL_ALWAYS, `canaryActualInjection=false`. Unchanged until separate validation. ✓
- Other models (Qwen etc.) → default branch FULL_LEGACY + FULL_ALWAYS. ✓
- DeepSeek without `CANON_INJECTION_DEEPSEEK_CANARY` → `shadowOnly=true`, actualCanonMode=FULL_LEGACY, actualArchiveMode=FULL_ALWAYS → ACTIVE OFF, Momentum OFF (layeredCanonActive false at call site). ✓
- **"code merge = all users immediately D2" is FALSE.** Merge does NOT auto-activate DeepSeek. NOT a blocker (verdict D not triggered by flag default).

## 8. Kill Switch Exact Rollback

Code path (`canonInjectionPolicy.ts` lines 115–133): `CANON_INJECTION_FORCE_FULL_LEGACY` OR `CANON_INJECTION_KILL_SWITCH` truthy →
- canonMode=FULL_LEGACY, archiveMode=FULL_ALWAYS, forceFullLegacy=true
- actualCanonMode=FULL_LEGACY, actualArchiveMode=FULL_ALWAYS
- At call site: `isLayeredCanonActive`=false → CORE uses `buildCharacterCanonBlock` (legacy full canon); `pushActiveCanon` no-ops; `isSelectiveArchiveActive`=false → legacy full archive; `momentumModelPolicyOn`=false → Momentum OFF.

Result = exact legacy behavior (FULL_LEGACY canon + FULL_ALWAYS archive + ACTIVE OFF + Momentum OFF). Confirmed by code reading + accepted deterministic test M (canonInjectionD3.test.ts kill-switch case). No new API call.

## 9. Database / Migration Audit

- Migration (`db.ts`): `addColumn("characters", "creator_canon_plan_json", "TEXT")` — nullable, no default. **Additive only.**
- Existing rows: column NULL → lazy compile on first chat access (`ensureCanonPlanOnAccess`). No backfill, no destructive rewrite.
- Old valid plan retention: same `sourceHash` → reuse (no recompile, no write).
- sourceHash mismatch → recompile + CAS persist.
- Compile failure → `plan=null` → `layeredCanonActive=false` → legacy FULL_LEGACY canon served (no unsafe stale layered serve). `technicalFallbackEligible=true`.
- Race/CAS: `tryPersistPlanJson` uses `WHERE creator_canon_plan_json IS NULL OR TRIM='' OR =expectedPrevious` (compare-and-set); in-process `compileInFlight` Set guards duplicate work. Concurrent first-access: only one write wins, others reuse.
- **No destructive migration on deploy.** Rollback implication: dropping the column is safe (code tolerates NULL/missing); but leaving it is harmless. No data loss risk.

## 10. Lazy Compilation Audit

Accepted contract confirmed in `lazyCompile.ts`:
- NULL → lazy compile → persist (CAS, only fills empty/stale). ✓
- same hash → reuse (`storedPlan.sourceHash === sourceHash` → "existing", no write). ✓
- hash mismatch → recompile. ✓
- failure → no unsafe stale layered serve; `technicalFallbackEligible=!plan`; route passes `canonPlan = result?.plan ?? null`; null → legacy FULL_LEGACY. ✓
- **No per-turn DB write**: write occurs only on first access or hash mismatch. Same-hash reuse = zero writes. `shadowD0` side-effects are log/observability only (no DB write). ✓

## 11. Cache Contract Audit

- Stable CORE → cached/static area (`renderCoreCanonBlock` via `pushCoreCanon`, cacheCharacter/cacheRules target). ✓
- ACTIVE / Selective Archive / Momentum / volatile memory → dynamic area (`pushActiveCanon` "dynamic"; selective archive "dynamic" ltm; Momentum in deepSeekUserExtras below CORE cache prefix). ✓
- AR-A3 ACTIVE changes, Momentum ON/OFF, Selective Archive changes do NOT flush the stable cache prefix — CORE block content depends only on `canonPlan` (stable per sourceHash), not on ACTIVE/Archive/Momentum selection.
- Cross-check D3 evidence: CORE serialized hash `ca90d51f54c5…` STABLE across 3 mature Cell C turns while ACTIVE went 0/0/17 and activeHash changed `e3b0c44→e3b0c44→6310f4a7`. **ACTIVE change did NOT alter CORE hash** → cache prefix preserved. ✓

## 12. Knowledge-Boundary Final Audit

- B1 (`activeSelector.ts`): `ACTIVE_RESTRICTED_BUCKETS = {player, scenario_meta}` excluded at `eligibleActiveChunks` (before scoring). ✓
- Bypass-path check: CORE (`renderCoreCanonBlock`) — CORE is the public canon subset, restricted buckets are not in CORE by compiler design; Archive (`selectArchiveChunksSelective`) — separate selector, restricted buckets not eligible; Momentum — extracts scene continuity from history, no canon bucket; Lorebook/LTM/Episodic/Greeting — unchanged legacy paths, not fed by restricted buckets.
- Latent risk beyond this audit: any future code that feeds raw `creator_raw_description` into a prompt bypassing the compiler could re-surface restricted text — not present in the accepted path; recorded as backlog only. No new architecture.

## 13. Scene Momentum Final Audit

- Candidate A + P2 (`predicate.ts`): `momentumEligible = isThinSceneHistory(history) AND NOT structurallyMatureByAlternatingExchange(history)`. cold/thin → ON; structurally mature → OFF. ✓
- `MOMENTUM_BOOTSTRAP_MAX_EXCHANGES = 3` is a **Momentum-bootstrap-only constant**; comment explicitly forbids reuse for LENGTH/SHORT HISTORY/canon/archive. ✓
- `altExchanges > 3` guard applies ONLY to Momentum activation. `isThinSceneHistory` reused BYTE-IDENTICAL; LENGTH / SHORT HISTORY semantics NOT globally changed. ✓ (confirmed by code header + contextBuilder call-site gating `deepSeekXmlMode && layeredCanonActive && sceneMomentumInput != null`).

## 14. ACTIVE Final Audit

- AR-A3 (`activeSelector.ts`): current user message primary (body +2 / title +1); recent context = gated bridge (`gateOn = canonMatch || action || openQuestion`); when gate NONE, recent context contributes nothing = legacy behavior + B1/B2. ✓
- B1: player + scenario_meta excluded. ✓
- B2: `ACTIVE_STOPWORDS = {이름, 하고}` applied to ACTIVE keyword sets only (shared `extractKeywords` NOT modified → Archive untouched). ✓
- `activeMaxChars` = `plan.retrieval.activeBudgetChars` = **1200** (unchanged, frozen; confirmed in D3). ✓
- `selected=0` valid (no FULL fallback, no top-N filler). ✓
- Precision tradeoff (0.92→0.67) is known accepted behavior; no further tuning. ✓

## 15. Archive Final Audit

- D1.1 (`archiveSelective.ts`, wired in `contextBuilder.pushArchiveMemory`): retrieval query = current user cue + bounded recent scene context (last -4 slice). Recent-context hits weighted below current-user hits, need 2 distinct hits to cross threshold alone → stray old words cannot broadly activate dormant archive. ✓
- `selected=0` valid (`if (!selective.included) return;` — no archive block injected). ✓
- No whole-archive fallback, no full blob re-injection. ✓
- Current scene evidence only; existing archive semantics preserved (legacy FULL_ALWAYS path intact when selective not active). ✓

## 16. Temporary Artifact Inventory

| artifact | count | classification |
|----------|-------|----------------|
| scripts/_tmp-* (harness/probes/benches/pr-body md/fixtures) | 149 | DELETE_BEFORE_COMMIT (or .gitignore) |
| scripts/smoke-episodic-live-chat.ts | 1 | DELETE_BEFORE_COMMIT (smoke) |
| scripts/live-background-fallback-gate.ts | 1 | UNKNOWN (owner unclear — confirm if runtime gate or temp) |
| data/ar0/, data/d2-live/, data/d2-momentum/, data/d2-length/, data/d3/, data/post-d3/ | dirs | KEEP_IN_REPO (evidence/reports; per repo convention REPORT.md + locked metrics preserved) |
| data/b2-live-d1/, data/d11-live/, data/step710c-replay/, data/step79b-replay/, data/_tmp-hy3-* | dirs | UNRELATED (pre-existing replay; not mine) |

Principle: `_tmp` executable harness is not needed for production → commit-exclude candidates. REPORT.md / locked metrics / reproducibility fixtures may be preserved per repo policy. **Nothing deleted in this phase.**

## 17. Test Inventory

Tests that MUST be in the commit (acceptance coverage):

| test file | covers |
|-----------|--------|
| src/lib/canonPlan/compiler.test.ts | CanonPlan compiler |
| src/lib/canonPlan/activeSelector.arPatch.test.ts | AR-A3 + B1 + B2 |
| src/lib/canonPlan/canonInjectionB1.test.ts | B1 knowledge boundary |
| src/lib/canonPlan/canonInjectionB2.test.ts | B2 stopword |
| src/lib/canonPlan/canonInjectionD3.test.ts | D3 deterministic gates (boundary, dormant, kill-switch, other-model) |
| src/lib/canonInjectionPolicy.test.ts | policy D0/D1/D2, kill switch, model isolation |
| src/lib/memory/archiveSelective.test.ts | D1.1 archive retrieval |
| src/lib/sceneMomentum/predicate.test.ts | P2 predicate |
| src/lib/sceneMomentum/extractor.test.ts | Momentum Candidate A |
| src/services/contextBuilder.assemblyOrder.test.ts | assembly order invariants |
| src/services/contextBuilder.cacheBoundary.test.ts | cache/static-dynamic boundary |
| src/services/contextBuilder.flashFirewall.test.ts | firewall invariants |

Quiet ACTIVE=0 is covered inside activeSelector.arPatch.test.ts / canonInjectionD3.test.ts. Kill-switch + other-model isolation covered in canonInjectionD3.test.ts (test M).

Separate/temporary-only: `src/lib/statusWidget/characterCriticalContext.test.ts`, `src/lib/statusWidget/kaomojiFormatPriority.test.ts` — status-widget WIP, NOT canon scope.

## 18. Existing Failing Tests Audit

Known pre-existing failures (from prior evidence / AGENTS.md): `koreanRule` ×3, `regenerate` ×1. These are baseline-independent pre-existing (they persist with `contextBuilder.ts` reverted to HEAD — established in prior sessions). They are NOT caused by the accepted canon patch:
- The canon patch adds new sections/fields but does not modify the Korean prose rule, Godmoding, LENGTH, or regenerate blocks.
- `git diff --check` = clean; no whitespace corruption introduced.

These must NOT be hidden in the PR description. The accepted patch created **no new regression** in the canon/momentum tests (all canon/sceneMomentum/archiveSelective/policy tests pass per D3 + AR0 evidence). Do NOT fix unrelated tests in this phase.

## 19. Final Test Command Plan

Run right before commit (after cleanup), using REAL repo scripts only:

```bash
git diff --check
npm run typecheck:app
npm run lint
node --conditions=react-server --import tsx --test \
  src/lib/canonPlan/compiler.test.ts \
  src/lib/canonPlan/activeSelector.arPatch.test.ts \
  src/lib/canonPlan/canonInjectionB1.test.ts \
  src/lib/canonPlan/canonInjectionB2.test.ts \
  src/lib/canonPlan/canonInjectionD3.test.ts \
  src/lib/canonInjectionPolicy.test.ts \
  src/lib/memory/archiveSelective.test.ts \
  src/lib/sceneMomentum/predicate.test.ts \
  src/lib/sceneMomentum/extractor.test.ts \
  src/services/contextBuilder.assemblyOrder.test.ts \
  src/services/contextBuilder.cacheBoundary.test.ts \
  src/services/contextBuilder.flashFirewall.test.ts
```

Notes: `npm run lint` == `npm run typecheck:app` (app-only TS validation; no ESLint installed). `npm run typecheck` (full tsc) has known pre-existing test-file errors on main — do NOT treat those as new. In this READ-ONLY phase no tests were run (0 API; classification confirmed by code reading).

## 20. Commit Boundary Recommendation

The canon/memory/momentum architecture is one cohesive change. Recommend **splitting into 2 commits** (same PR) to keep the production change reviewable and separate evidence:

1. **Commit 1 — accepted architecture:** production files (canonPlan/*, sceneMomentum/*, memory/archiveSelective.ts, canonInjectionPolicy.ts, contextBuilder.ts, route.ts, characterFormSave.ts, db.ts, types.ts) + required tests (§17). One cohesive frozen-architecture commit.
2. **Commit 2 — evidence/reports:** data/ar0, data/d2-*, data/d3, data/post-d3 reports + locked metrics (EVIDENCE_KEEP). Optional; may also be kept untracked per repo convention.

**MUST be excluded from both:** 149 `scripts/_tmp-*`, `scripts/smoke-episodic-live-chat.ts`, and the **unrelated WIP** (`extractNormalize.ts` kaomoji change, `characterCriticalContext.ts`, `kaomojiFormatPriority.test.ts`). The unrelated WIP makes a single clean commit impossible without `git add` scoping → use explicit path staging, NOT `git add -A`.

## 21. PR Scope Recommendation

**PR includes:** production files (§3) + required tests (§17) + additive migration (creator_canon_plan_json) + minimal docs/reports (REPORT.md evidence per repo convention).
**PR excludes:** `_tmp` harness, large disposable API outputs, unrelated WIP (kaomoji status-widget, characterCriticalContext).
**Rollout note in PR description:** default stage D0 (shadow-only); DeepSeek production-wide activation requires explicit `CANON_INJECTION_DEEPSEEK_CANARY=1` + stage≥D1 in deployed env — NOT triggered by merge. Muse/Gemini/HY3 unchanged.
Preserve report/metrics per repo convention (data/ar0, data/d2-*, data/d3, data/post-d3).

## 22. Controlled Production Canary Plan (DO NOT EXECUTE — plan only)

Using CURRENT feature-flag architecture (`CANON_INJECTION_ROLLOUT_STAGE` + `CANON_INJECTION_DEEPSEEK_CANARY` + `CANON_ARCHIVE_DEEPSEEK_SELECTIVE`):

- **Stage 1 (internal/admin/test users):** deploy with `CANON_INJECTION_ENABLED=1`, `CANON_INJECTION_ROLLOUT_STAGE=D1`, `CANON_ARCHIVE_DEEPSEEK_SELECTIVE=1`, `CANON_INJECTION_DEEPSEEK_CANARY=1` for a small admin/test cohort only (per-user/segment gate). Selective archive first; canon stays FULL_LEGACY.
- **Stage 2 (limited % DeepSeek):** `ROLLOUT_STAGE=D2`, canary flag on for a small % of DeepSeek traffic (segment-gated). LAYERED canon + selective archive + Momentum A + P2.
- **Stage 3 (expanded DeepSeek):** widen the canary segment %; keep kill switch armed.
- **Stage 4 (full DeepSeek):** canary flag on for all DeepSeek traffic. Muse/Gemini/HY3 remain FULL_LEGACY throughout (separate validation).
- Rollback at any stage: set `CANON_INJECTION_KILL_SWITCH=1` (or `FORCE_FULL_LEGACY=1`) → exact legacy restore.

## 23. Canary Observability Plan

Minimum production observability (aggregate where possible; **NO raw canon/history/private text**):
- canonMode, archiveMode, canaryActualInjection, rolloutStage
- CORE hash/version (sourceHash), CORE block chars
- ACTIVE: selected count + chars + recentContextUsed + gate reason
- Archive: selected count + chars
- Momentum: momentumActive + activationReason + alternatingExchanges
- Fallback reason + count (technicalFallbackEligible / FULL_LEGACY fallback)
- prompt_tokens, cached_tokens, completion_tokens, usage.cost, latency_ms
- error rate, http status

Log bounded metadata only (the existing `observability.ts` / `shadowD0.ts` already follow this — no raw restricted text).

## 24. Rollback Trigger Plan

Immediate rollback candidates (set `CANON_INJECTION_KILL_SWITCH=1`):
- Error-rate increase vs baseline
- Technical FULL fallback repeat (fallbackEligible spike)
- Unexpected cost spike / cache collapse (cached_tokens abnormal drop with stable CORE hash)
- Secret/knowledge leak (player/scenario_meta surfacing)
- Dormant lore ladder reports
- Severe output shortening (repeated <2000 + no progression)
- Widespread repetition / godmoding regression

Rollback = master kill / DeepSeek canary OFF → exact legacy restore (§8). Possible at any stage without code change.

## 25. Known Backlog Separation (NOT a commit/PR blocker)

- A. ACTIVE chunk segmentation title-only misses (Cell B requiredMissed=23 sub-chunks; semantic recall 0.80 covers concepts)
- B. Recency-decay refinement (canon-adjacent selection on mature cues, e.g. Cell C turn3 active=17 — harmless, no lore ladder)
- C. Ground-truth re-baseline (Cell B requiredTotal=32 broad)
- D. Fantasy-specific scene-fuel gap (policy: natural 2300–2500 allowed; D3 fantasy 2540 natural = PASS)

Do NOT mix this backlog into the PR.

## 26. HY3 Future Validation (out of this PR scope)

HY3 stays FULL_LEGACY. After DeepSeek rollout stabilizes, separate:
1. HY3 H0 audit (FULL_LEGACY baseline)
2. FULL_LEGACY vs CORE+ACTIVE+Selective small validation
3. Momentum A + P2 trial ONLY if cold-start regression appears on HY3
Do NOT auto-apply DeepSeek policy to HY3.

## 27. Final Deliverable Tables A–L

### A. FILE CLASSIFICATION TABLE (summary counts)

| classification | count | notes |
|-----------------|-------|-------|
| PRODUCTION_REQUIRED | 5 modified + 4 new src groups (canonPlan 10, sceneMomentum 3, archiveSelective 1, canonInjectionPolicy 1) | accepted runtime path |
| TEST_REQUIRED | 10 new test files (canonPlan 5, sceneMomentum 2, archiveSelective 1, canonInjectionPolicy 1, + 3 contextBuilder existing) | §17 |
| EVIDENCE_KEEP | 6 data dirs (ar0, d2-live, d2-momentum, d2-length, d3, post-d3) | reports + locked metrics |
| TEMP_DELETE_CANDIDATE | 149 _tmp scripts + 1 smoke script | exclude before commit |
| UNRELATED_EXISTING_CHANGE | extractNormalize.ts (M) + characterCriticalContext.ts+test + kaomojiFormatPriority.test.ts + pre-existing data replay dirs | separate WIP |
| UNKNOWN_REVIEW_REQUIRED | scripts/live-background-fallback-gate.ts | owner unclear |

### B. PRODUCTION REQUIRED FILES
canonInjectionPolicy.ts · canonPlan/{compiler,activeSelector,lazyCompile,compileForSave,serialize,coreRenderer,observability,shadowD0,types,hash}.ts · memory/archiveSelective.ts · sceneMomentum/{extractor,predicate,types}.ts · services/contextBuilder.ts · app/api/chat/route.ts · lib/characterFormSave.ts · lib/db.ts · types.ts

### C. TEST REQUIRED FILES
canonPlan/{compiler,activeSelector.arPatch,canonInjectionB1,canonInjectionB2,canonInjectionD3}.test.ts · canonInjectionPolicy.test.ts · memory/archiveSelective.test.ts · sceneMomentum/{predicate,extractor}.test.ts · services/contextBuilder.{assemblyOrder,cacheBoundary,flashFirewall}.test.ts

### D. DELETE/EXCLUDE CANDIDATES
149 × scripts/_tmp-* · scripts/smoke-episodic-live-chat.ts (and confirm scripts/live-background-fallback-gate.ts)

### E. UNRELATED WIP
src/lib/statusWidget/extractNormalize.ts (kaomoji) · src/lib/statusWidget/characterCriticalContext.ts + .test.ts · src/lib/statusWidget/kaomojiFormatPriority.test.ts · pre-existing data replay dirs (b2-live-d1, d11-live, step710c-replay, step79b-replay, _tmp-hy3-*)

### F. FEATURE FLAGS / DEFAULTS
(see §6) — default D0 shadow-only; merge does NOT auto-activate DeepSeek.

### G. DB/MIGRATION RISK
(see §9) — additive `creator_canon_plan_json TEXT` nullable; no destructive migration; CAS persist; rollback safe.

### H. CACHE CONTRACT
(see §11) — CORE stable cached; ACTIVE/Archive/Momentum dynamic; D3 CORE hash `ca90d51f54c5…` stable across 3 turns confirms no cache-prefix flush.

### I. ROLLBACK CONTRACT
(see §8, §24) — kill switch → exact FULL_LEGACY + FULL_ALWAYS + ACTIVE OFF + Momentum OFF.

### J. FINAL TEST PLAN
(see §19) — `git diff --check` + `npm run typecheck:app` + `npm run lint` + targeted canon/sceneMomentum/contextBuilder tests via `node --conditions=react-server --import tsx --test`.

### K. COMMIT/PR PLAN
(see §20, §21) — 2 commits in one PR: (1) accepted architecture + tests, (2) evidence/reports. Exclude _tmp + unrelated WIP via explicit path staging.

### L. PRODUCTION CANARY/RAMP PLAN
(see §22) — 4 stages (D1 selective archive → D2 limited % → D3 expanded → D4 full DeepSeek); Muse/Gemini/HY3 unchanged; kill switch armed.

---

## FINAL VERDICT

**B. READY WITH MINOR CLEANUP**

The accepted DeepSeek architecture is fully present, on the real runtime path, with no dead experiment code, prompt freeze intact, default D0 (merge does NOT auto-activate DeepSeek), kill-switch exact rollback, additive DB migration with CAS, stable cache contract, and all knowledge-boundary/Momentum/P2/ACTIVE/Archive gates confirmed. No blocker of type D or E.

The one caveat forcing B (not A): the working tree is **contaminated with unrelated WIP** — `src/lib/statusWidget/extractNormalize.ts` (kaomoji format priority), `characterCriticalContext.ts`+test, `kaomojiFormatPriority.test.ts` — plus 149 `_tmp` harness scripts and one UNKNOWN (`live-background-fallback-gate.ts`). A clean commit requires explicit path staging (commit 1 = canon production + tests; commit 2 = evidence) and **excluding** the unrelated WIP and `_tmp` files. This is minor cleanup at commit time, not an architecture blocker. (If the unrelated WIP could not be separated it would be verdict C, but it CAN be separated via `git add <paths>`, so the PR itself is cleanable.)

**Confirmations:**
- 0 API/model calls
- 0 files deleted
- 0 code edits
- 0 commit / push / PR / merge / deploy
- 0 production flag changes
- `activeMaxChars` still 1200; Momentum/Archive/compiler/CORE/LENGTH/Terminal/Scene Engine/prose prompt untouched
