# Step 7.5 — Character Dialogue Register (CHECKPOINT)

**Saved:** 2026-07-02  
**Status:** WIP — patch validation interrupted (network). Code + audit committed; resume validation below.

## Goal

Root-cause register regression (Leon/Ren), A/B/C/D isolated patches, apply **one** winning patch only.

**Constraints:** Rewrite / Merge / Priority reorder / Existing wiring only — no new rules/layers/few-shots.

## Root cause (confirmed in code)

1. **Step 7.3 (`2dfcc32`)** — `[genre_tone]` gained per-genre **dialogue register** (`합니다·입니다` etc.) in `narrativeStyle.ts`. Step 4.3 was atmosphere-only.
2. **Dead path** — `formatSpeechSectionAsMetadata()` runs at **character save** only; runtime `buildStructuredCharacterCanonBlock()` used plain `formatSection()` (unless `REGISTER_PATCH=B`).
3. **Recency** — `[genre_tone]` injects **late** (dynamic tail) after prose bundle → overrides CHARACTER CANON context registers (Leon: 둘만=해요 vs 판타지/SF→합니다).

Full report (local): `output/step75-register-root-cause-audit.md`

## Files added/changed (this branch)

| File | Role |
|------|------|
| `src/lib/registerPatchExperiment.ts` | `REGISTER_PATCH` env: none \| A \| B \| C \| D \| step43 |
| `src/lib/characterRegisterCompliance.ts` | Scene expected register vs dialogue compliance % |
| `src/lib/characterKnowledgeBoundary.ts` | Patch B: metadata at canon build; Patch D: `buildCharacterSpeechRecencyTail()` |
| `src/lib/narrativeStyle.ts` | Patch A/step43: `STEP43_GENRE_TONE_HINTS` (no dialogue register) |
| `src/services/contextBuilder.ts` | Patch C: genre before prose; Patch D: speech tail before LENGTH |
| `scripts/step75-register-root-cause-audit.ts` | Static audit → `output/step75-register-root-cause-audit.md` |
| `scripts/step75-register-patch-validation.ts` | 20-pair Leon+Ren validation per patch |
| `scripts/lib/leon-ren-register-fixtures.ts` | Leon (공적/둘만) + Ren (백하율 ~요) scenes |

## Patch matrix

| Patch | Mechanism |
|-------|-----------|
| **A** | Step 4.3 genre hints (remove dialogue register from genre_tone) |
| **B** | Wire `formatSpeechSectionAsMetadata` at canon assembly |
| **C** | Move `[7] Style Mode` before prose bundle |
| **D** | Re-emit speech metadata at dynamic tail (before LENGTH) |
| **step43** | Same genre as A — acceptance baseline threshold |
| **none** | Current production (genre register ON) |

## Validation progress (local `output/` — gitignored)

| Patch | Samples | JSON |
|-------|---------|------|
| none | **20/20** ✅ | `output/step75-register-patch-none.json` |
| step43 | **5/20** ⏸ interrupted | `output/step75-register-patch-step43.json` |
| A | 0/20 | — |
| B | 0/20 | — |
| C | 0/20 | — |
| D | 0/20 | — |

## Resume commands

```powershell
cd "E:\ai chat"

# 1) Re-run static audit (optional)
npm.cmd exec tsx -- scripts/step75-register-root-cause-audit.ts

# 2) Resume step43 from sample 6 (delete partial or script skips existing ids — currently overwrites per scene)
#    Finish step43 then A, B, C, D one at a time (NOT combined):

$env:REGISTER_PATCH="step43"
npm.cmd exec tsx -- scripts/step75-register-patch-validation.ts --patch=step43 --generate

$env:REGISTER_PATCH="A"
npm.cmd exec tsx -- scripts/step75-register-patch-validation.ts --patch=A --generate

$env:REGISTER_PATCH="B"
npm.cmd exec tsx -- scripts/step75-register-patch-validation.ts --patch=B --generate

$env:REGISTER_PATCH="C"
npm.cmd exec tsx -- scripts/step75-register-patch-validation.ts --patch=C --generate

$env:REGISTER_PATCH="D"
npm.cmd exec tsx -- scripts/step75-register-patch-validation.ts --patch=D --generate

# 3) Summary report (reads all JSON)
npm.cmd exec tsx -- scripts/step75-register-patch-validation.ts --all-patches
```

**Note:** Validation script saves after each scene. To resume step43 cleanly, either delete `step75-register-patch-step43.json` and re-run, or extend script to skip cached scene ids (step75-habit pattern).

## After validation — production apply (NOT DONE)

1. Pick **single** patch with highest `avgCompliance` ≥ step43, human proxy ≥ 4, AI smell not worse.
2. **Hardcode** winner (remove `REGISTER_PATCH` env gates).
3. Run **10-pair acceptance** vs step43 threshold.
4. Commit + push.

## Production state

- **4519366** on main = Step 7.5 habit consolidation (pushed).
- Register patch experiment is **local WIP** — `REGISTER_PATCH` unset = current production behavior (genre register still active).

## User trigger to continue

Say: **「Step 7.5 register 이어서」** or **「register patch validation 마저」**
