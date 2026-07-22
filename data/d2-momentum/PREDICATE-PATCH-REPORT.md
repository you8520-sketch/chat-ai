# Momentum Activation Predicate Patch (P2) — Report

Date: 2026-07-22
Spec: `scripts/_tmp-momentum-predicate-patch-task.md`
Calibration evidence: `scripts/_tmp-momentum-predicate-replay.ts` + `data/d2-momentum/predicate-replay.json` (13 fixtures, P2 formula, replay table).

## 1. Changed files

| File | Status | Purpose |
|------|--------|---------|
| `src/lib/sceneMomentum/predicate.ts` | NEW | P2 activation predicate + observability types (model-agnostic) |
| `src/lib/sceneMomentum/predicate.test.ts` | NEW | 26 production tests A–K (contract + 13-fixture replay + wiring) |
| `src/services/contextBuilder.ts` | MODIFIED | Replace `isThinSceneHistory` term with P2 `momentumEligible`; surface observability on `BuiltContext.meta` |
| `src/types.ts` | MODIFIED | Additive `momentumActivation?` field on `BuiltContext.meta` |
| `src/lib/sceneMomentum/extractor.ts` | UNCHANGED | `isThinSceneHistory` + `buildSceneMomentumBlockString` byte-identical (see §5) |
| `src/lib/sceneMomentum/types.ts` | UNCHANGED | Header / 5 fields / types untouched |

No other files touched. No LENGTH / Terminal / Scene Engine / Canon CORE/ACTIVE / Archive selector / ACTIVE selector / Momentum-content changes.

## 2. Exact P2 implementation (formula + where it lives)

Formula (in `src/lib/sceneMomentum/predicate.ts`):

```
momentumEligible(history) =
    isThinSceneHistory(history)
    AND NOT structurallyMatureByAlternatingExchange(history)

structurallyMatureByAlternatingExchange(history) =
    countAlternatingExchanges(history) > MOMENTUM_BOOTSTRAP_MAX_EXCHANGES   // 3
```

Where it lives: a **new adjacent module** `src/lib/sceneMomentum/predicate.ts`. `isThinSceneHistory` is **imported and reused** from `extractor.ts` (not modified, not duplicated). The structural guard is combined **only at the Momentum activation layer** — LENGTH / SHORT HISTORY semantics are globally unchanged.

Wiring in `src/services/contextBuilder.ts` (the only call site):

```
const momentumPredicate = resolveMomentumActivation(input.shortTermHistory);
const momentumModelPolicyOn =
    deepSeekXmlMode && layeredCanonActive && input.sceneMomentumInput != null;
const momentumActive =
    momentumModelPolicyOn && momentumPredicate.momentumEligible;
...
if (deepSeekXmlMode) {
    ...
    if (momentumActive && input.sceneMomentumInput) {
        deepSeekMomentumExtra = buildSceneMomentumBlockString(input.sceneMomentumInput);
    }
```

The opt-in `sceneMomentumInput` channel is preserved, so existing D2 harness/data that does not thread it stays byte-identical. `buildSceneMomentumBlockString` (Candidate A content) is called unchanged — FROZEN.

## 3. altExchanges counting contract

`countAlternatingExchanges(history)` in `predicate.ts`:

- Keeps only `user` / `assistant` roles. **Excludes** system / tool / meta / synthetic helper metadata (dropped before counting).
- **Excludes** empty / whitespace-only messages (dropped before counting).
- An exchange = one adjacent **(user → assistant)** pair in the **normalized** sequence (after dropping excluded roles/empties). **Consecutive same-role messages are NOT forced as an exchange**; only genuine user→assistant transitions count.
- `assistant → user` transitions do not count (an exchange completes on the assistant reply).
- Pure cold-start (no assistant turn) → 0 exchanges.

This is more robust than the calibration script's reference counter (which only checked assistant non-emptiness) but produces identical counts on the 13 well-formed RP fixtures (verified by the replay tests).

## 4. Structural boundary (named constant + value)

```ts
export const MOMENTUM_BOOTSTRAP_MAX_EXCHANGES = 3;
```

- Named, single definition in `predicate.ts`. **Momentum-bootstrap-only** — not imported or reused by LENGTH / SHORT HISTORY / canon / archive / any other production turn-count rule.
- Observable: surfaced as `alternatingExchanges` (number) and `structuralMature` (boolean) on every `MomentumActivation` / `BuiltContext.meta.momentumActivation`.

## 5. Existing isThinSceneHistory untouched confirmation

- `git diff --stat -- src/lib/sceneMomentum/extractor.ts` → **empty** (no modifications).
- `isThinSceneHistory` is imported into `predicate.ts` and reused as-is. Its internals (last-3-assistant-turns, `SHORT_HISTORY_AVG_NO_WS_THRESHOLD`, `countNoWsChars`, cold-start `return true`) are byte-identical.
- The structural guard is combined at the **activation layer** (`momentumEligible`), not inside `isThinSceneHistory`. LENGTH / SHORT HISTORY behavior is unchanged (test I confirms the same P0 results on the corpus; the contextBuilder `koreanRule`/`regenerate` suite is unaffected — see §12).

## 6. 13-fixture replay before/after (P0 = `isThin` only → P2)

| Fixture | altExch | isThin | P0 (isThin) | P2 (P2) | P2 reason |
|---------|--------:|:------:|:----------:|:-------:|-----------|
| A. cold-start `[]` | 0 | T | **ON** | **ON** | THIN_LENGTH_AND_LOW_EXCHANGES |
| A2. one-user | 0 | T | **ON** | **ON** | THIN_LENGTH_AND_LOW_EXCHANGES |
| B. modern-quiet (4-turn) | 2 | T | **ON** | **ON** | THIN_LENGTH_AND_LOW_EXCHANGES |
| B. fantasy-quiet (4-turn) | 2 | T | **ON** | **ON** | THIN_LENGTH_AND_LOW_EXCHANGES |
| B. enoch-quiet (4-turn) | 2 | T | **ON** | **ON** | THIN_LENGTH_AND_LOW_EXCHANGES |
| C. modern MATURE (12-turn) | 6 | T | ON ❌ | **OFF** ✅ | MATURE_EXCHANGE_GUARD |
| C. fantasy MATURE (12-turn) | 6 | T | ON ❌ | **OFF** ✅ | MATURE_EXCHANGE_GUARD |
| C. enoch MATURE (12-turn) | 6 | T | ON ❌ | **OFF** ✅ | MATURE_EXCHANGE_GUARD |
| D. modern many-short (~20-turn) | 10 | T | ON ❌ | **OFF** ✅ | MATURE_EXCHANGE_GUARD |
| D. fantasy many-short (~20-turn) | 10 | T | ON ❌ | **OFF** ✅ | MATURE_EXCHANGE_GUARD |
| D. enoch many-short (~20-turn) | 10 | T | ON ❌ | **OFF** ✅ | MATURE_EXCHANGE_GUARD |
| E. long-opening (2 long turns) | 2 | F | **OFF** | **OFF** | NOT_THIN |
| F. terse (5 short exchanges) | 5 | T | ON ❌ | **OFF** ✅ | MATURE_EXCHANGE_GUARD |

**P2: 13/13 pass.** P0 had 7 false-positive ON cases (C×3, D×3, F) — all structurally-mature-but-concise scenes where `isThin` was true solely because assistant turns were short. P2 turns them OFF via the structural guard while retaining the 5 genuine cold/thin ON cases (A, A2, B×3) and the E OFF case.

## 7. THIN activation retention (no regression)

- B (modern/fantasy/enoch, 2 exchanges each) → `momentumEligible = ON` under P2 (altExchanges 2 ≤ 3, isThin true).
- Wiring test **K2**: D2 canary ON + THIN → `momentumActive = true`, `activationReason = THIN_LENGTH_AND_LOW_EXCHANGES`, `alternatingExchanges = 2`, `structuralMature = false`, and the last user payload **contains** `CURRENT SCENE CONTINUITY`. THIN activation is retained exactly.

## 8. MATURE auto-off

- C (modern/fantasy/enoch 12-turn, 6 exchanges each) → `momentumEligible = OFF` (altExchanges 6 > 3 → structuralMature → guard fires). `activationReason = MATURE_EXCHANGE_GUARD`.
- `isThin` is still **true** on C (short turns) — the structural guard is what turns Momentum OFF. This is the intended P2 behavior: content-maturity ≠ predicate-maturity for many-short-turn scenes (the Phase-1 calibration observation, resolved structurally rather than by tuning).

## 9. many-short-turn / terse auto-off

- D (modern/fantasy/enoch ~20-turn, 10 exchanges each) → OFF (`MATURE_EXCHANGE_GUARD`); `isThin` still true (short turns) — the discovered false-positive is fixed.
- F (terse, 5 exchanges) → OFF (`MATURE_EXCHANGE_GUARD`); `isThin` true (terse) — terse-character false-positive fixed.
- Wiring test **K3**: D2 canary ON + many-short mature → `momentumActive = false`, `activationReason = MATURE_EXCHANGE_GUARD`, `existingThinHistory = true`, `structuralMature = true`, and the last user payload **does not contain** `CURRENT SCENE CONTINUITY` (auto-off). Under P0 this same fixture incorrectly injected momentum; P2 auto-disables it.

## 10. Model isolation (Muse/Gemini/HY3 payload unchanged)

- The Momentum block is assembled **only inside `if (deepSeekXmlMode)`** (`deepSeekXmlMode = isDeepSeekV4ProModel(modelId)`). For every non-DeepSeek provider the `deepSeekUserExtras` momentum block is never built, so the actual model payload (`systemPrompt` + `history` / `contents`) is **byte-identical to baseline**.
- The only additive non-DeepSeek change is the `momentumActivation` field on `BuiltContext.meta` — **metadata for observability, not part of the model payload**. `resolveMomentumActivation` / `countAlternatingExchanges` are pure (no I/O, no payload mutation).
- Wiring test **J** loops over **Muse** (`meta/muse-spark-1.1`, openrouter), **HY3** (`tencent/hy3`, openrouter), **Qwen** (`qwen/qwen3.7-max`, openrouter), **Gemini** (`google/gemini-2.5-pro`, gemini). For each: payload contains **no** `CURRENT SCENE CONTINUITY`; `momentumActive = false`; `activationReason = MODEL_POLICY_OFF`; `existingThinHistory = true` (predicate still computed for observability).
- P2 helper is **not** a DeepSeek-specific data structure — it is a COMMON, model-agnostic predicate. Model policy (DeepSeek D2 canary / kill switch) is applied at the call site, not in `predicate.ts`.

## 11. Kill switch

- Wiring test **K**: `CONTROL_POLICY` (canary off / kill switch) + DeepSeek + THIN → `momentumActive = false`, `activationReason = MODEL_POLICY_OFF`; last user payload contains **no** `CURRENT SCENE CONTINUITY`; existing `SHORT HISTORY` marker still present (SHORT HISTORY behavior unchanged). Rollback contract preserved exactly.
- `momentumModelPolicyOn = deepSeekXmlMode && layeredCanonActive && sceneMomentumInput != null` — turning off the canary (`layeredCanonActive` false) or the master kill switch collapses `momentumActive` to false with `MODEL_POLICY_OFF`, identical to the pre-P2 production payload.

## 12. Tests / typecheck results

- `npm.cmd run typecheck:app` → **PASS** (exit 0). Only app source is typechecked (tests excluded by `tsconfig.app.json`); the 4 changed/new src files compile clean.
- `node --conditions=react-server --import tsx --test "src/lib/sceneMomentum/**/*.test.ts"` → **38 pass / 0 fail** (12 existing `extractor.test.ts` A–J still green + 26 new `predicate.test.ts` A–K).
  - Existing 12 extractor tests remain green (P2 did not regress content/extractor behavior; J3 MATURE auto-off still holds via `NOT_THIN` for the long-turn mature fixture).
  - New 26 tests: G/H contract (malformed/duplicate roles, empty/meta/system), 13-fixture replay (A–F), A–F invariants, I (isThin unchanged), J (Muse/Gemini/HY3/Qwen isolation), K/K2/K3 (kill switch + positive gate + many-short auto-off).
- `node --conditions=react-server --import tsx --test "src/services/contextBuilder.*.test.ts"` → 28 pass / 4 fail. The 4 failures are in `contextBuilder.koreanRule.test.ts` (×3) and `contextBuilder.regenerate.test.ts` (×1) — Korean-output-language-rule and regenerate-divergence-block assertions. **Confirmed PRE-EXISTING**: stashing the two P2-tracked files (`contextBuilder.ts`, `types.ts`) and re-running those two files on the clean baseline reproduces the **same 4 failures** (4 fail / 4 pass of 8). They are unrelated to Momentum and not introduced by P2.

## 13. API call count

**0 live API calls.** Justification:

- P2 is a **deterministic boolean gate**; the 13/13 calibration replay + 26 production tests fully verify ON/OFF behavior and the counting contract.
- The dry-run `buildContext` wiring tests (K2 ON / K3 OFF / K kill-switch / J isolation) verify the **exact ON/OFF payload** sent to the model — `CURRENT SCENE CONTINUITY` present for THIN ON, absent for many-short mature OFF and for non-DeepSeek / kill-switch.
- Candidate A **content is FROZEN** (`buildSceneMomentumBlockString` byte-identical) — the same block the PoC already live-proved.
- Every payload variant P2 can emit was already live-proven by prior work: the PoC's 9 THIN D2+MOMENTUM calls (ON content), the PoC's 2 MATURE sanity calls (long-turn OFF), and the existing D2 baseline (many-short OFF = no-momentum baseline payload). Re-running them is explicitly disallowed ("Reuse the existing Candidate A 9-call quality results — do NOT re-run them").
- Per spec: "If provider payload/dry-run sufficiently verifies ON/OFF wiring, 0 live API calls is allowed." The dry-run suffices → 0.

## Self-check

- [x] Only the activation predicate changed; content/header/fields/source/wording/budget/insertion untouched.
- [x] `isThinSceneHistory` byte-identical (internals not modified; `git diff --stat` empty).
- [x] `altExchanges` excludes system/tool/meta/empty/synthetic and does not force consecutive same-role as an exchange.
- [x] Boundary `3` named (`MOMENTUM_BOOTSTRAP_MAX_EXCHANGES`), observable, not reused elsewhere.
- [x] Critical invariants hold: cold-start ON, THIN 3 ON, MATURE OFF, many-short mature OFF, terse mature OFF.
- [x] Muse/Gemini/HY3 provider payload byte-identical; kill switch exact.
- [x] Deterministic tests A–K + `typecheck:app` pass.
- [x] API calls 0 (≤4); no large benchmark.
- [x] No commit/push/PR/deploy; no production-wide activation (D2 canary opt-in unchanged).

---

## Final verdict

### READY FOR MOMENTUM CONFIRMATION


