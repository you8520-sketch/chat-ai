# A1 — official character authoring handoff and review evidence

Base: `ba14f3d76441a13b1fa92c501abe2c66ca039209` (latest main checked at start). Draft for GPT source/code review only. No new character generation, paid provider request, production DB read/write, registration, release, image work or Text Lock replacement.

## BEFORE

Canonical flow: `author.ts` → `authorPrompts.ts` / `bible.ts` schemas → Part1 → Voice → Bonds → `assembleOfficialCharacterBible` → `compileOfficialDraftFromBible` → existing QA and Text Lock candidate. The manual pilot remains `scripts/official-supply-pilot-author.ts`.

`buildPart1Recap` sent name, 400 chars of behavior, desires, 160 chars of contradiction and 220 chars of personal situation, then cut the combined string at 1200 chars. It never selected backstory event/choice/residue, abilities/limits/costs, occupation/status, values/taboos or user entry. The generated Part1 JSON was not otherwise supplied to Voice/Bonds by the live pilot. Optional caller recap overrides had no repository callers.

`CHARACTER_VOICE_SCHEMA` already admitted `detailedDescription` and `creatorComment`. The actual prompt/skeleton did not ask for them, and `assembleOfficialCharacterBible` discarded them even when returned. Existing public-text owners then composed the legacy fallback.

## PROBLEM

The actual recorded mock transport inputs reproduce missing causal past and ability limits. Returned authored public prose is lost. A missing public manuscript silently reaches Bonds and fallback. The new generation tests fail on exact main for these three separate reasons.

Existing structural QA does not establish seal/signature authenticity, causal selfDrive grounding or semantic equivalence after editing. No automatic contradiction detector is claimed. The earlier independent-principle deletion is represented by a clearly synthetic mutation; this PR does not claim the current compiler itself deletes that rule.

## AFTER

- The existing recap owner selects complete source facts: occupation/status/affiliation/world role; behavior; desires/values/taboos; contradiction; causal events; ability scope/limit/cost; current incident and entry. Compact JSON avoids a second prose author and preserves complete strings, without a silent 1200-char cut. Habits, daily life, speech, bonds and the full bible are not copied. Name/age/directions already in the stage input are not repeated in the recap.
- Voice alone receives source appearance/height and the existing shared-world context. These are not duplicated in the common recap or sent as extra appearance to Bonds.
- The same Voice call requests detailed public prose and the creator comment. Existing public-text validators reject missing/invalid manuscripts before Bonds. Assembly preserves them; the existing compiler's authored-text branch consumes them. No new call or provider is added.
- Targeted Voice revisions omit these two manuscripts from schema and template because those revisions cannot apply them. Existing public prose is preserved; the full generation schema is not mutated.
- The existing read-only `characterReview.ts` produces unresolved source/compiled comparisons, complete causal sources, source selfDrive (or `MISSING_SOURCE`), public surfaces and exact behavior-rule sentence preservation. Canon provenance, semantic contradictions, generic drive and scene/agency coherence remain `REQUIRES_GPT_REVIEW`, with `semanticVerdict: null`.
- The existing pilot file writer refreshes this evidence when it writes a candidate/revision, preventing a stale embedded review. The read-only review CLI also appends fresh evidence. The old Lucian report body remains an exact prefix; historical committed prose is unchanged.

## ACTUAL FIELD OWNERS / CONSUMERS

| Field | Generation / conversion | Stored / displayed / consumed |
| --- | --- | --- |
| `publicProfile.description` | Voice short pitch | Existing bible quality and `marketFit.ts` review; **not** the saved page body or character-card text. Retained for these live readers and existing targeted pitch repair. |
| `publicProfile.detailedDescription` | Same Voice call → assembly → `composeOfficialPublicDescription` authored branch | `draft.description` → `buildOfficialCharacterFormBody` → `characterFormSave.ts` → `characters.description` → character page / `CharacterIntroSection` / `RichDescription`. |
| `publicProfile.creatorComment` | Same Voice call → assembly → `draft.creatorComment` / `composeOfficialCreatorComment` | `creator_comment` → character page / `CharacterIntroSection`. Supported markup is unchanged. |
| `tagline` | Existing Voice/compile | Saved tagline → `CharacterCard`. |
| `greeting` | Existing Voice/compile | Saved greeting → initial chat scene. |
| RP setting / speech | Part1 + Voice + Bonds → bible compiler / `composeOfficialSystemPrompt` | Form save → stored `public_canon` / speech → `characterChunks.ts` → `contextBuilder.ts`. |

Public description and comment are display surfaces; they are not an additional RP canon writer. A public-only synthetic phrase is saved but intentionally absent from the final RP prompt. The independent reporting principle reaches final RP through its actual setting/speech owner.

## REMOVED

- Silent clipping at the recap owner and unused generation recap overrides.
- The obsolete instruction that the compiler alone writes the detailed intro.
- New-generation silent fallback when the authored public manuscripts are missing.
- Duplicate Voice player-address instructions, merged while preserving prohibited gendered titles.
- Regenerating two public manuscripts that a targeted revision would discard.

Legacy public-text fallbacks remain **KEEP**: existing old sources still read them. The short pitch remains **KEEP** for the quality/market-fit readers above. No cleanup of other systems is included.

## PRESERVED

Three character-generation calls, the existing optional NPC repair and six-call opt-in budget, workflow accounting/retries, model selection/pricing and all max-token limits. Existing Market Fit owner/policy, popular trope policy, NPC optionality, adult/permission boundaries, existing greeting/tagline/speech behavior, compiler/Text Lock/staging/publish owners, approved sources, production #50/#51, images and lorebooks are unchanged.

This PR does not apply Lucian selfDrive, decide Wolfgang's seal authenticity, re-approve Text Locks, or alter the existing source files. `canon-review-existing-sources.json` inspects **public pilot candidates only** through the existing review compiler. It is not a production read or verification of private approved r2 source. The private approved-source loader correctly refused an absent local file; it was not changed or used to apply a public substitute.

## PROOF

- Exact main plus the eight new direct checks: **1 pass / 7 fail**. Three failures are generation behavior; four expose the absent review-evidence contract. The existing wire behavior already passed.
- After: **209/209** across the ten related files below; final author/revision/budget subset **97/97** after the revision cleanup.
- Missing intro, missing comment and HTML intro are refused before Bonds. New output survives assembly, compile and staged form save. Existing normal fixtures and player agency, greeting, speech, shared world, zero truncation and Text Lock continuity pass.
- Synthetic seal/denial/uncertainty sources remain verbatim and unresolved. Generic but structurally valid selfDrive is **not** declared causally grounded. Removing the independent reporting sentence changes its exact-preservation check to `REVIEW_REQUIRED`; repeated prop sentences do not erase that principle.
- Isolated DB save/read/chunks/final `buildContext` proof uses the existing `buildRelationStartWire` and `isolatedTestDatabase`; no runner or shared DB test infrastructure was added. `/tmp` is tmpfs and refused by the existing mounted-volume guard; `TMPDIR=/var/tmp` uses the root overlay and the original guard unchanged.
- `input-before.json` / `input-after.json`: exact final transport system/user input for one existing public fixture, plus returned public profile. **OFFLINE MOCK**, not a new generated manuscript or model result.
- `input-metrics.json`: four existing fixture input comparisons. `canon-review-fixtures.json` and `canon-review-existing-sources.json`: per-character source/compiled evidence. All sources were already public repository fixtures; no Elin RP, user persona or private wire is included.
- `validation.json`: checks and limitations. Full `npm run typecheck` is not green on main: **2339** diagnostics on base and head, identical after normalizing root paths, line positions and identical type-union member ordering (0 added / 0 removed). The app-only contract is separate.

Regular execution contract:

```sh
TMPDIR=/var/tmp node --conditions=react-server --import tsx --import ./src/lib/test/regularTestEgressPolicy.ts --test \
  src/lib/officialSupply/author.test.ts \
  src/lib/officialSupply/officialSupply.authorQualityHandoff.test.ts \
  src/lib/officialSupply/officialSupply.voiceBudget.test.ts \
  src/lib/officialSupply/officialSupply.correction.test.ts \
  src/lib/officialSupply/officialSupply.authorBudget.test.ts \
  src/lib/officialSupply/officialSupply.publicQuality.test.ts \
  src/lib/officialSupply/officialSupply.relationStart.test.ts \
  src/lib/officialSupply/officialSupply.promptStandard.test.ts \
  src/lib/officialSupply/officialSupply.marketFit.test.ts \
  src/lib/officialSupply/officialSupply.worldIntroCanon.test.ts
```

## REGRESSION RISKS / SIZE AND COST

- Across four existing fixtures, three-call estimated input totals rise from **10,414–10,820** to **15,495–16,461** tokens; paired increases are **4,893–5,641**. These are the repository character-count heuristic, **not measured provider token usage**. The increase is explicit: previously absent causal facts plus source appearance/world context and public-copy instructions. No claim of equal per-character cost is made.
- New-generation public prose targets add 600–1000 intro chars and 150–250 comment chars (rough estimate +675–1125 output tokens). These are soft authoring targets, not new storage or token limits. At the stated targets, the largest pretty-serialized SFW/adult × NPC0/1/2 Voice fixture is approximately **4625 estimated tokens**, below the unchanged 8000 output cap. This does not guarantee model output size or success. Oversized/truncated responses still fail through the existing owner; the cap is not raised.
- Model, rate, call topology and billing/accounting structure are unchanged. Extra payload can increase real cost and failure/retry rate; future approved paid measurement must check actual usage and truncation. Targeted revisions omit the new manuscripts instead of paying to regenerate discarded text.
- Complete selected recap fields no longer have a 1200-char bound. Input size follows the already bounded Part1 completion; broad/verbose facts can increase context. This is the tradeoff for retaining source clauses without inventing a summarizer or silently dropping later categories.
- Existing heading/age/height and plain-text/HTML contracts still constrain public prose. This change does not redesign the renderer or claim literary approval from those checks.

## REMAINING

GPT must read the actual prose and source/code diffs: classify observations, character claims, unresolved secrets and established canon; decide seal authenticity only with canon authority; judge causal selfDrive, independent-fact preservation, natural Korean, market appeal, uniqueness, playable choices and scene consistency. No literary score or semantic auto-pass was assigned.

New paid character generation, actual RP scoring, screenshots of a newly generated saved page, image/style QA, automatic registration/release, other genres and production application remain separate follow-ups. **Draft PR only; no merge or deploy.**
