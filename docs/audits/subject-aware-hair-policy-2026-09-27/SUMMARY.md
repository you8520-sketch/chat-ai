# Subject-aware hair policy bugfix (2026-09-27)

## Git

- Start main: `dbbebd5c6600c9f5d2b0f4f0a12733348ff840f1`
- Synced main during review: `1d5ebcf0c63feacea82b0e790ed91a55f5cd3808`
- Final HEAD: see PR #1104 after this audit-doc commit.

## BEFORE — owner map

| Stage | Before |
|---|---|
| Character hair source | Whole joined character setting, so NPC/world beard terms could contaminate the primary character policy |
| Presence parsing | Beard/body-hair keyword existence; `수염 없음` could be read as present |
| USER_PERSONA | No independent hair policy |
| Prompt appearance fact | None |
| Sanitizer | One character-derived policy applied to mixed-subject output |
| Core prompt plumbing | Unused `allowsBeard` / `allowsBodyHair` fields survived despite producing no prompt text |

## ROOT CAUSE — deterministic proof

1. `수염 없음` was misclassified as beard-present.
2. Character-only policy deleted legitimate USER_PERSONA beard sentences.
3. Character-only policy could delete third-party/NPC beard sentences.
4. Single-syllable persona aliases needed support, but substring matching must not turn words such as `렌즈` into persona references.
5. Whole-setting hair parsing allowed NPC/world beard text to enable beard on the primary character.
6. Gender defaults could overwrite explicit canon instead of allowing explicit traits to win.

## AFTER

- **ONE SUBJECT = ONE POLICY:** `SubjectHairPolicy` with independent character and USER_PERSONA resolution.
- Character policy source is scoped with `extractMainCharacterAppearanceBody(...)`; world/NPC lore is not hair-policy input.
- Presence parsing evaluates explicit absence/presence, then product default.
- Explicit canon wins regardless of gender default.
- Character prompt uses one compact structured appearance fact under the existing `[외형]` owner:
  - absent/absent: `facial_hair=none; body_hair=none`
  - canonical beard + absent body hair: `facial_hair=canon; body_hair=none`
  - both canonical: no extra fact.
- Sanitizer receives `HairSanitizeContext`, attributes explicit character/persona names conservatively, preserves likely NPC/third-party sentences, and only removes ambiguous hair text when both primary subjects disallow it.
- Korean alias matching is particle/boundary-aware, so single-syllable names work without matching unrelated words such as `렌즈`.
- Existing no-violation byte identity / paragraph / CRLF / idempotence behavior remains covered.

## REMOVED

- `buildBodyHairDescriptionRule` parallel prompt owner.
- Legacy `HairDescriptionPolicy` compatibility path and adapter.
- Dead `allowsBeard` / `allowsBodyHair` inputs from `CoreMasterPromptInput` and context assembly.

## LIVE GEMINI 3.1 EVIDENCE

Original post-fix probe:
`LABEL=hair-fix-g31 FIXTURES=beard_closeup MODELS=gemini-3.1-pro-preview BEARD_VARIANT=A REPEAT=2`

- The no-beard fixture wire contained `facial_hair=none; body_hair=none`.
- 2/2 outputs contained no invented beard/stubble terms.
- Later review corrections preserve the same no-beard fact for that fixture; they tighten source scope, canon priority, alias attribution, and legacy cleanup rather than adding new prose instructions.
- This is supporting evidence, not a statistical estimate of model hallucination probability.

## PROMPT BUDGET / OWNER BOUNDARY

Hair facts remain a small structured fact in the existing appearance owner.
COMMON PROSE and 19+ INTIMACY are unchanged.
No new model-specific hair prompt or parallel section was added.

## FINAL CLASSIFICATION

**ROOT_CAUSE_FIXED** for the deterministic parser, owner, source-scope, and cross-subject sanitizer defects.

Model-level hallucination frequency remains stochastic; the live Gemini sample is deliberately reported as limited evidence rather than a guaranteed rate reduction.
