# User agency / length / contextual callback — owner consolidation cleanup

**Status:** `READY_FOR_GPT_FINAL_MERGE`
**Classification:** `PROMPT_CONTRACT_ROOT_CAUSE: ROOT_CAUSE_FIXED` | `LIVE_MODEL_OUTPUT: UNVERIFIED_NO_PROVIDER_CALL`
**Provider HTTP:** 0 | **DB migration:** 0 | **V2 / reconvergence:** unchanged

## BEFORE

- Callback semantics duplicated across agency / prose / density owners
- Example-dialog owner contaminated with auto-history permission rule
- CTX7 used fake string proof (noGodmodding owner) instead of reconvergence regression

## PROBLEM

- Responsibility duplication violated ONE RESPONSIBILITY = ONE CANONICAL OWNER
- EXAMPLE_DIALOG_STYLE_ONLY_NOTE could not be AUTO→MANUAL invariant owner (character-gated injection)
- CTX7 name/proof mismatch on reconvergence hook behavior

## AFTER — owner graph

| Owner | File | Responsibility |
|-------|------|----------------|
| User authoring permission | `noGodmodding.ts` → `COLLABORATIVE_INTERACTIVE_OWNER_BLOCK` | AUTO→MANUAL reset, [B] permission bounds, canonical fact usage (no callback contract) |
| Turn recency materialization | `currentUserInputLabel.ts` | Current runtime = interactive; prior auto co-narration does not carry over |
| Auto permission | `autoProgressionRules.ts` | Auto turn only; manual revert line preserved |
| Contextual callback / anti-fixation | `advancedProseNsfwGuidelines.ts` → `IMMERSIVE_PROSE_BLOCK` | present first, relevant-only callback, no verbatim echo, no mandatory recall, anti-fixation |
| AI-owned length routing | `sceneExpansionPolicy.ts` → `NARRATIVE_DENSITY_BLOCK` | AI_CAST expansion first; defers callback to IMMERSIVE PROSE; [B] not filler |
| Terminal length target | `responseLength.ts` → `USER_TAIL_LENGTH_OWNER_SENTENCE` | 3200+ default, AI expansion priority, no [B] filler (compact) |
| Example dialog boundary | `noGodmodding.ts` → `EXAMPLE_DIALOG_STYLE_ONLY_NOTE` | Style/reference only — no auto-history permission |

## REMOVED

- Collaborative owner: callback / anti-fixation / verbatim-echo / quota semantics
- Example-dialog note: auto assistant history permission line
- NARRATIVE DENSITY: full contextual-callback contract duplication
- USER_TAIL length: emotion-paraphrase anti-fixation duplicate
- CTX7: invalid noGodmodding string pseudo-proof

## PRESERVED

AUTO→MANUAL current-turn permission reset, manual minor/local co-narration, adult local reaction, auto progression semantics, AI-owned length expansion, contextual callback semantics (now single-owned), anti-fixation, no verbatim memory/canon echo, 3200+ length target, interactive wrapper recency, auto owner revert line.

## PROOF

- `src/lib/userAgencyRuntime.test.ts`: UA1–12, LEN1–5, CTX1–6/8–10, OWNER1–9, UA-AUTO1
- CTX7 → PROV1–3 inline (canonical `extractReconvergenceHooks` regression from #931)
- `src/lib/reconvergenceProvenance.test.ts`: PROV1–7, PARITY1–4, PART1–5 (unchanged)
- `npm run lint` / `typecheck:app` / `build` / `git diff --check`
