# User agency / length / contextual callback runtime fix

**Status:** ROOT_CAUSE_FIXED  
**Provider HTTP:** 0 | **DB migration:** 0 | **V2 / reconvergence:** unchanged

## BEFORE — owner graph

| Owner | File | Scope |
|-------|------|-------|
| Interactive collaborative agency | `noGodmodding.ts` → `COLLABORATIVE_INTERACTIVE_OWNER_BLOCK` | `[0a]` system |
| Auto progression agency | `autoProgressionRules.ts` | autoContinue mode only |
| Current-user wrapper | `currentUserInputLabel.ts` | user-turn tail |
| Length target | `responseLength.ts` → `USER_TAIL_LENGTH_OWNER_SENTENCE` | user-turn tail |
| Narrative density | `sceneExpansionPolicy.ts` | prose bundle |
| Immersive prose | `advancedProseNsfwGuidelines.ts` | prose bundle |
| Runtime mode resolver | `chatRuntimeMode.ts` + `contextBuilder.ts` | per-turn flags |

## REPRODUCTION

| Case | Pre-fix gap | Post-fix |
|------|-------------|----------|
| **UA-AUTO1** Auto [B] dialogue in history → manual turn | Collaborative owner lacked explicit auto→manual reset; wrapper silent on prior auto output | Owner + wrapper declare prior auto assistant [B] = history only |
| **LEN1** Long target | Length sentence did not forbid [B] filler | `USER_TAIL_LENGTH_OWNER_SENTENCE` prioritizes AI-owned expansion |
| **CTX1–6** Memory/canon fixation | Present in immersive prose lightly; no anti-fixation / no-quota in density | Strengthened in existing `IMMERSIVE_PROSE` + `NARRATIVE DENSITY` |

## ROOT CAUSE — H1–H7

| ID | Verdict | Evidence |
|----|---------|----------|
| H1 AUTO permission persists in prompt state | **REJECT** | `resolveChatRuntimeMode` + `resolveNoGodmoddingMode` reset on manual turn |
| H2 Prior auto assistant output as behavioral example | **ACCEPT** | Default collaborative path lacked “history ≠ permission” recency |
| H3 Minor allowance → major action | **PARTIAL** | Clarified in collaborative owner (elevator chain, etc.) |
| H4 Length pressure → user authoring filler | **ACCEPT** | Length owner mode-blind; no anti-filler clause |
| H5 AI expansion priority unclear | **ACCEPT** | Density/length did not state AI-first priority |
| H6 Anti-fixation semantics insufficient | **ACCEPT** | No explicit non-functional reuse rule |
| H7 Memory retrieval ranking | **FOLLOW-UP** | Prompt consumption fix only; retrieval unchanged |

## AFTER

- **Current-turn scoped permission:** collaborative owner + wrapper + example-dialog note
- **Auto boundary:** auto owner scoped to auto turns; explicit manual revert line
- **AI-owned expansion priority:** length + density owners
- **Contextual callback:** present-first, transform-not-explain, no quota, anti-fixation in immersive/density

## PRESERVED

Minor co-narration, adult handoff wrapper, auto progression semantics, long-form 3200+ target, memory continuity as grounding (not hook creation), V2 OFF, reconvergence PR931 invariant text in owner.

## PROOF

- `src/lib/userAgencyRuntime.test.ts`: UA1–12, LEN1–5, CTX1–10, UA-AUTO1
- Existing: `userAgencyRoleBindingP0`, benchmark harness BMARK/TRJ/COST, RC/BOUND/EVAL (when present on branch)
- `npm run lint` / `typecheck:app` / `build`
