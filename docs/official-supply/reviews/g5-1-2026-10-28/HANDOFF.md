# G5-1 handoff — genre-generic official character authoring core

Issue: https://github.com/you8520-sketch/chat-ai/issues/1746
Base: `8cc96458` (main, includes #1743). Branch: `cursor/g5-1-genre-profile-d9a9`.
Status: **Draft. 1 of 2 required live non-rofan manuscripts delivered. Second is blocked by the 16-call hard cap (see "Remaining constraints").** Cursor does not score manuscripts; GPT review is requested.

## BEFORE / PROBLEM

- `authorPrompts.ts` builders hard-coded a rofan author identity, a romance-fantasy world example and a romance/power-relation premise. Any non-rofan genre was authored as a rofan.
- `marketFit.ts` cast-fit used romance-led signals for every genre.
- The public-intro gate rejected a legitimate `본명 (별명)` name when the intro printed the bare name.
- The shared-world projection (`officialSharedWorld.ts`, used by `compileOfficialDraftFromBible` for `compact_rp` drafts) hard-coded Ethernos: the identity assertion required the literal `에테르노스 제국`, and the power-system clauses were always labelled `에테르를 다루는 법`/`에테르 사용`. A non-Ethernos world could never compile. Found by the live run, not by the offline tests.

## AFTER — owner map

| Responsibility | Canonical owner | Change |
| --- | --- | --- |
| Genre / tone / humor / pacing / wordplay authoring policy | `src/lib/officialSupply/genreProfile.ts` (new, only owner) | 19 genres accepted; unknown → genre-neutral fallback; rofan → `ROFAN_PARITY_PLAN` |
| Prompt assembly | `authorPrompts.ts` | builders take optional `OfficialAuthoringPlan`; default = parity plan |
| Plan threading | `author.ts` | passes plan to world / brief replacement / bible / voice / style board |
| Cast overlap at planning | `marketFit.ts` (`evaluateBriefCastFit`, `excludeRomanceLedSignals`) + `authorPrompts.ts` (`describeCastForPlanning`) | one feedback replan max (existing path) |
| Name alias gate | `publicProfileText.ts` (`withoutNameAlias`) | bare name accepted when name carries `(별명)` |
| Shared-world projection | `officialSharedWorld.ts` | identity check uses the bible's own world name; non-Ethernos power labels neutral; one extra shrink step appended to the existing ladder |
| Visual style | `style.ts` | untouched; rofan visual direction stays rofan-only |

## REMOVED / GENERALISED rofan assumptions

- Rofan author identity, rofan world example, mandatory romance/power relation premise → conditional on profile.
- Romance-led signals in non-romance cast-fit → excluded.
- Ethernos-only identity assertion and power labels in shared-world projection → per-world (Ethernos output byte-identical, covered by existing `sharedWorld` / `worldIntroCanon` tests plus a new non-Ethernos test).

## PRESERVED

- Rofan prompts byte-identical for default callers (`ROFAN_PARITY_PLAN`; parity tests in `officialSupply.genreProfile.test.ts`).
- Part1 → Voice → Bonds, QA, FREE/ROLE_BOUND/RELATIONSHIP_BOUND, Text Lock, spending ledger, styleKey/Appearance Lock.
- G3 / G4 originals and pilot data untouched (`git diff 8cc96458 -- src/lib/officialSupply/pilot` is empty).
- No DB, schema, provider or billing change. No ops DB writes.

## PROOF

Offline (no paid calls): `offline-prompts/{rofan-serious,g5-modern-comedy,g5-horror-dry}.md`, `prompt-composition.json` (direction lines appear once; no rofan-only vocabulary in non-rofan prompts).

Live (`gpt-6-luna`, existing `cheaper-inference-background` path; code SHA recorded in `cost-usage.json`):

- `g5-modern-comedy` (현대/일상, light / humor central / dialogue / nickname `박수진 (양쪽말)`, `userRelation=free`): all QA green (`validation.json`: bible, tags, draft/Text Lock, relation, lorebook). Manuscript: `candidates/g5-modern-comedy/first-manuscript.md`; compiled draft `draft.compiled.json`; Text Lock `ad56b3f1…af555`.
- Raw responses and prompts for every physical call, including the 2 provider timeouts: `provider-responses/`.
- Cost: 13 physical calls (11 ok, 2 provider timeouts), 37,570 in / 28,234 out tokens, billed ≈ US$0.0122 ≈ ₩18 at the conservative ₩1,500/USD (cap ₩1,000). `cost-usage.json` has the per-call table.

Call history for this candidate (all kept): world 3 calls; bible+voice attempt 1 failed the intro gate on `public_intro_name_missing` (fixed, see AFTER); attempt 2 failed on `public_intro_facts_missing` (model wrote the compiled-sheet layout on separate lines, which the gate treats as an auto-sheet); two timeouts; attempt 3 passed bible+voice, then bonds, then one voice repair; compile initially failed in the shared-world projection (fixed, see AFTER) and was re-run with **0 new paid calls** from the saved bible.

Regression: `npm run lint`, `npm run typecheck:app`, `git diff --check`, `officialSupply/*.test.ts` 704/704.

## REGRESSION RISKS

- `officialSharedWorld.ts` is shared with rofan compile. Ethernos labels and ladder order are unchanged; the new ladder step only runs where the old code threw. Existing Ethernos projection tests pass.
- Voice gate strictness for the separate-line `이름:/나이:/키:` layout is unchanged (not weakened). It is a pre-existing nondeterministic reject that can hit rofan too; the prompt line is intentionally left alone to keep parity.

## Remaining constraints / for GPT review

- **Second live manuscript (`g5-horror-dry`) not generated.** 13 of 16 hard-cap calls are used; a fresh world plus bible/voice/bonds needs about 7. Spending beyond 16 needs an explicit decision. The runner is idempotent: `generate.ts --run --only=g5-horror-dry` resumes it.
- Please compare the comedy manuscript's first event and tensions with the G4 characters. Its conflict (a marker, records, authority limits, a self-disclosed late report) uses the same document/authority/responsibility vocabulary the G4 review flagged; Cursor did not judge it.
- Genre diversity is only proven offline for horror/SF until the second manuscript exists.
- G5-2 (admin UI, private draft registration) is not started.
