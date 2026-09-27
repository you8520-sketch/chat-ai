# PROMPT / Runtime Behavior — Canon Layered Architecture Audit

## Git baseline

| Field | SHA |
|-------|-----|
| **EXACT MAIN** | `4aeaa008c068ff708883a2a01b57dc1c23cb91ab` |
| **EXACT HEAD** | _(commit on branch `cursor/canon-layered-architecture-audit-cea0`)_ |
| **PRODUCTION DIFF (`src/`)** | **0** — audit + harness only |

## BEFORE — actual canon mode per model

| Surface | DeepSeek V4 Pro (`deepseek-v4-pro-0813`) | Gemini 3.7 Flash |
|---------|------------------------------------------|------------------|
| **Code default** (env unset) | `rolloutStage=D0`, `shadowOnly=true`, **`actualCanonMode=FULL_LEGACY`**, `injectionEnabled=false` | Same generic path → **FULL_LEGACY** (no layered branch) |
| **Production Railway** | **PRODUCTION_ENV_ACTIVATION_UNCONFIRMED** | Same |
| **PR620 prior harness** | FULL ~10,252 chars `character-core-identity` (no `canonPlan` / D0 policy) | Same |

**CORE / FULL owner at runtime:** `contextBuilder.pushCharacterCoreIdentity` → layered: `renderCoreCanonBlock`; else `buildCharacterCanonBlock` (`characterKnowledgeBoundary.ts`).

## PROBLEM — why ~10k identity on wire

1. **Intended code path for most traffic:** D0 shadow + `actualCanonMode=FULL_LEGACY` until canary env + cohort → layered never activates on wire.
2. **PR #1124 / #1125 benchmark:** `buildContext` without `canonInjectionPolicy` / `canonPlan` → `layeredCanonActive` always false → full structured dump (~10,128 chars from archived T1) every time.
3. **Not a missing compiler:** Layered stack exists; activation is policy-gated, not globally on.

Historical root cause (#93) unchanged: full canon + archive salience drove dormant activation — layered was built to address that, not deployed globally by default.

## AFTER (this PR)

- Evidence package under `docs/audits/canon-layered-architecture-audit-2026-09-27/`
- Repro: `scripts/canon-layered-architecture-audit-pr620.ts`
- **No runtime flag or `src/` behavior change**

## REMOVED

- None (no obsolete code deleted — uncertain items left for follow-up)

## PRESERVED

- Creator canon data, length policy, one Main RP call, memory/lore boundaries, caching boundaries (cache does not own content policy)

## Wire proof — ARM F vs ARM L (PR620 capsule)

| Snapshot | Model | Arm | core chars | active chars | system chars |
|----------|-------|-----|------------|--------------|--------------|
| A | DeepSeek | F | 10252 | 0 | 17974 |
| A | DeepSeek | L | 3417 | 1574 | 12715 |
| B | DeepSeek | F | 10252 | 0 | 17946 |
| B | DeepSeek | L | 3417 | 1510 | 12623 |
| A | Gemini 3.7 | F | 10196 | 0 | 17827 |
| A | Gemini 3.7 | L | 3361 | 1574 | 12568 |
| B | Gemini 3.7 | F | 10196 | 0 | 17799 |
| B | Gemini 3.7 | L | 3361 | 1510 | 12476 |

Full table: `WIRE_COMPARISON.json`.

## Live comparison (n=2 per cell, 16 calls total)

Raw outputs: `raw/` and `meta/` in this directory (also mirrored under `/opt/cursor/artifacts/canon-layered-audit-pr620/` when run in Cloud).

**Cursor does not assign final quality win** — classifications below are **PENDING_HUMAN_REVIEW**.

| Model | Snapshot | Observation (metadata only) |
|-------|----------|-------------------------------|
| DeepSeek | A | F ~1254–1471 vis chars; L ~777–1395 (L r2 short — review fidelity/completeness) |
| DeepSeek | B | F ~2473–2865; L ~1810–2671 |
| Gemini 3.7 | A | F ~1891–2028; L ~2626–3200 |
| Gemini 3.7 | B | Both arms high length; L r2 shows heuristic CANON_EXPOSITION + PHYSIOLOGY_DISPLACES_EMOTION flags (`CANON_LEAKAGE_MATRIX.json`) |

### Per-model classification (draft)

| Model | Draft classification |
|-------|------------------------|
| DeepSeek V4 Pro | **PENDING_HUMAN_REVIEW** — wire reduction clear; Snapshot A L r2 length outlier needs prose review |
| Gemini 3.7 Flash | **PENDING_HUMAN_REVIEW** — leakage heuristics fire on both F and L; compare to PR #284 only after human read |

## CORE / ACTIVE / dormant — 라이크

- Compile note: production `creator_raw` for char 10 not in local DB; compiled from PR620 T1 wire **CHARACTER bucket** (see `CANON_COMPILE_NOTE.json`).
- Full chunk map: `CANON_CLASSIFICATION_MAP.json` (396 chunks from full-body compile; 157 chunks from character-only source used for L arm).
- ACTIVE selection: `ACTIVE_SELECTION_SNAPSHOT_A.json`, `ACTIVE_SELECTION_SNAPSHOT_B.json` (budget 1200; domestic scene selects ~12 chunks; kiss scene similar — gate `CURRENT_CANON_MATCH`).

## MUST FIX NOW

**None** — no deterministic defect blocking layered architecture when policy + plan are supplied. D0 default FULL is intentional; benchmark omission is harness scope, not production bug.

## REQUIRED CLEANUP

**None in `src/`** for this PR.

Documented stale comment (no edit): `contextBuilder.ts` ~240 “full character profile every turn” → **FOLLOW-UP** doc/comment alignment.

## SAFE OPTIONAL

- CORE heuristic tightening (many `CORE_OVERCLASSIFICATION_CANDIDATE` flags in map)
- Update `pr620-real-capsule-quality-benchmark.ts` to pass `canonPlan` when measuring production-equivalent layered wire

## SEPARATE FOLLOW-UP

- Gemini 3.7 layered tuning if human review fails L vs F
- Railway rollout decision (explicitly out of scope)
- Broader compiler / cache layout work

## REGRESSION RISKS

- Enabling L without cohort testing: CORE still ~3.4k rendered + ACTIVE ~1.5k — dormant world volume removed from always-on surface but CORE inflation remains
- Gemini historical `GEMINI_LAYERED_CANON_FAIL` may or may not apply to 3.7

## PROOF

- `RUNTIME_POLICY_MAP.json`, `OWNER_MAP.json`, `HISTORICAL_DECISION_AUDIT.md`
- `LIVE_RUN_INDEX.json`, `CANON_LEAKAGE_MATRIX.json`
- Re-run: `MAIN_SHA=… HEAD_SHA=… REPS=2 npx tsx scripts/canon-layered-architecture-audit-pr620.ts`
