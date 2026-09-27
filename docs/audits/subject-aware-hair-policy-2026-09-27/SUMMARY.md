# Subject-aware hair policy bugfix (2026-09-27)

## Git

| | SHA |
|--|-----|
| **EXACT MAIN (start)** | `dbbebd5c6600c9f5d2b0f4f0a12733348ff840f1` |
| **EXACT HEAD** | (branch commit at PR time) |
| **User cited main** | `9e46fcbe9630fcbc5bb8c7071b050e7e09401f80` (superseded by fetch) |

## BEFORE — owner map

| Stage | Canonical owner |
|-------|-----------------|
| Character setting → policy | `resolveHairDescriptionPolicy` in `bodyHairRules.ts` (keyword `BEARD_IN_SETTING` on whole setting) |
| Prompt appearance fact | **None** on main (no canon hair fact injected) |
| USER_PERSONA appearance | Persona text + `buildUserPersonaReferencePrompt` / identity block (`contextBuilder.ts`) |
| Post-output sanitizer | `sanitizeHairDescriptions(text, HairDescriptionPolicy)` — **character** `allowsBeard`/`allowsBodyHair` applied to **every** sentence |
| Stream/final parity | Same `hairPolicy` in `route.ts` stream trace + saved-text paths |

## ROOT CAUSE (reproduced)

1. **Parser:** `settingAllowsBeardDescription("수염 없음") === true` because `수염` substring matched before absence semantics.
2. **Sanitizer cross-subject:** With character beard disallowed, `렌의 턱수염…` sentences were dropped even when persona canon allows beard (global policy).
3. **NPC:** Third-party beard sentences (e.g. `김 형사는 턱수염`) were dropped under character restrictive policy.
4. **Attribution gap:** Single-character persona names (e.g. `렌`) were excluded from `userPersonaNames` (`length < 2`), forcing ambiguous attribution → conservative KEEP when character allowed beard.

## AFTER

- **ONE SUBJECT = ONE POLICY:** `SubjectHairPolicy` + `resolveCharacterSubjectHairPolicy` / `resolveUserPersonaSubjectHairPolicy`.
- **Prompt fact:** `facial_hair=none; body_hair=none` injected once under `[외형]` via `buildCharacterHairCanonFactFromSetting` (no Korean stubble vocabulary).
- **Sanitizer:** `buildHairSanitizeContext` + subject attribution (character name / persona name / NPC heuristic / ambiguous conservative rule).
- **Removed:** `buildBodyHairDescriptionRule` (zero callers).

## PROMPT BUDGET

Structured fact ≈ 35 characters (~32 local tokens heuristic) per character when restrictions apply; 0 change to COMMON PROSE / NSFW owners.

## FINAL CLASSIFICATION

**ROOT_CAUSE_FIXED** (deterministic tests + parser/sanitizer/attribution proofs).

## LIVE GEMINI (post-fix)

`LABEL=hair-fix-g31 FIXTURES=beard_closeup MODELS=gemini-3.1-pro-preview BEARD_VARIANT=A REPEAT=2`

- Wire prompt includes `facial_hair=none; body_hair=none` under `[외형]`.
- `r1/raw.txt` and `r2/raw.txt`: no `수염` / `턱수염` / `까칠` / `면도` in model output (jaw-contact user message only).
- Artifacts: `/opt/cursor/artifacts/prose-diet/hair-fix-g31/`
