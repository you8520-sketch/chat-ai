# 01 — RP Quality Vector V2 Spec

## Purpose

Offline-first evaluation harness for RP reply quality. **Not** a production prompt change.

Implementation: `src/lib/rpQualityVector/`  
Entry: `computeRpQualityVectorV2(input)`

## Length bands (visible chars, whitespace stripped)

| Band | Range |
|------|-------|
| IDEAL | 3200–4200 |
| SOFT_ACCEPT | 2800–3199, or >4200 (outside ideal but not review) |
| REVIEW_REQUIRED | 2400–2799 |
| STRONG_LENGTH_REGRESSION | 1800–2399 |
| DENSITY_COLLAPSE | <1800 |

`incomplete` / `finish_reason` / `saw_done` are tracked separately on the vector.

## Composition (character-share primary)

```text
dialogue_char_share = dialogueChars / totalChars
narration_char_share = 1 - dialogue_char_share
```

Dialogue chars counted only inside production quote pairs `"…"` / `“…”`  
(`「」` is **not** a production dialogue delimiter — see `quotes.ts`).

Secondary (not primary gate):

```text
dialogue_paragraph_share  // formerly ambiguous "dialogue_share"
narration_paragraph_share
```

## Review flags (not hard fail alone)

- `dialogue_fragmentation_review`
- `narration_fragmentation_review`
- `setting_overlap_alarm` when exact-overlap ratio ≥ 18%

## Human review schemas (required for D1 gates)

- `CHARACTER_FIDELITY` 1–5
- `ACTIVE_CANON_USE` 1–5
- `SETTING_RECITAL` 0–3
- `SCENE_PROGRESSION` 1–5
- Continuity fields — see `02_CONTINUITY_AUDIT_SPEC.md`

## Hard quality gate (adapter candidates)

```text
SETTING_RECITAL ↓
RECENT_SCENE_REPLAY ↓
CURRENT_INPUT_REPLAY ↓

while

ACTIVE_CANON_USE >= baseline
CHARACTER_FIDELITY >= baseline
SCENE_PROGRESSION >= baseline
LENGTH/COMPOSITION >= baseline
```

`RECITAL ↓` with `ACTIVE_CANON_USE ↓` = **FAIL**.
