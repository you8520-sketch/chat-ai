# G5-1 / G5-1B handoff — genre-generic official character authoring core

Issue: https://github.com/you8520-sketch/chat-ai/issues/1746
Draft PR: https://github.com/you8520-sketch/chat-ai/pull/1748
GPT mid-review: issue comment `6472189151` on HEAD `5617280b`
This evidence SHA: see latest commit on `cursor/g5-1-genre-profile-d9a9`

Status: **Draft. Two non-rofan live manuscripts + runner cleanup. Cursor does not score manuscripts. GPT re-review requested. STOP.**

## BEFORE / PROBLEM

G5-1 left 박수진 complete but:
1. `--only=g5-horror-dry` would overwrite `validation.json` and drop the comedy row.
2. `voiceRepairs` counted every `character_bible_voice` file (−1), so comedy reported **3** instead of the one selective repair after bonds.
3. Timeout calls with `costUsd=null` were summed as if known; billed ~₩18 was known-cost only.
4. Horror/mystery manuscript missing; call cap was 16 with 13 already used.
5. GPT scored 박수진 **5.8/10** and flagged document/authority/responsibility overlap with G3/G4.

## AFTER — G5-1B runner (docs evidence runner only)

| Fix | Owner |
| --- | --- |
| Merge prior `validation.json` candidates by key; Specs order preserved | `mergeValidationCandidates` / `loadPreviousValidationCandidates` in `generate.ts` |
| Selective Voice repair = `character_bible_voice` **after** bonds for that spec | `countSelectiveVoiceRepairs`; comedy corrected **3 → 1** from raw (call 13); persisted `voice-repairs.json` |
| `CALL_CAP` 16 → **28** (this runner only; +15 for horror) | `generate.ts` |
| Known billed cost vs `costUsd=null` unknown calls separated | `cost-usage.json` (`billedCostUsdKnownOnly`, `unknownCostCalls`) |
| Fixture | `--self-check` asserts comedy repairs=1 and merge keeps both keys |

No new runner, Journal, or cost-tracking service.

## Live manuscripts

| Key | Name | Genre / axes | Text Lock | Selective voice repairs | QA |
| --- | --- | --- | --- | --- | --- |
| `g5-modern-comedy` | 박수진 (양쪽말) | 현대/일상 · light · humor central · dialogue · nickname | `ad56b3f1…af555` **unchanged** | 1 | all green |
| `g5-horror-dry` | 문재호 | 공포/추리 · dry · humor light · narration | `f357fd98…` | 1 | bible/tags/draft/relation/lorebook all green |

- Comedy manuscript/bible SHA256 unchanged vs G5-1: bible `209f0d9f…`, first-manuscript `8e395a63…`.
- Horror path: world → portfolio → brief replan once (`박도윤` failed `market_fit_not_relationship_first` → `문재호`) → Part1 → Voice → Bonds → 1 Voice repair → compile.
- Raw + prompts for every physical call (including comedy timeouts 8–9): `provider-responses/`.
- Horror manuscript for GPT: `candidates/g5-horror-dry/first-manuscript.md` (also compiled draft, system prompt, bible).

## Cost

- Physical calls: **21** / cap 28 (comedy 13 + horror 8).
- Known billed: **US$0.020616 ≈ ₩31** at conservative ₩1,500/USD.
- Unknown cost calls: **2** (comedy provider timeouts, `costUsd=null`) — **not** asserted as $0.
- Model: `gpt-6-luna` / cheaper-inference-background. No provider change.

## Diversity investigation (no code change)

See `DIVERSITY-CAUSE.md`. Short version:
- **Fact:** humor/pacing axes reached Voice; the administrative conflict was already locked in world premise + portfolio brief; PRIMARY market signals were fantasy tops, not comedy; G3/G4 text was not pasted into comedy portfolio/Part1 prompts; gate did not reject the coordinator occupation.
- **Hypothesis:** `genre_neutral` + bureaucratic non-magic world fill + “real stakes / don’t let jokes replace cost” language converge on document/authority RP. Horror `문재호` also uses 판정·기록·허가 — pattern is not comedy-Voice-only.
- No new comedy regen and no speculative prompt edits in this pass.

## PRESERVED

- Rofan parity profile / prompt parity tests.
- G3/G4 originals and pilot data (empty diff vs intentional scope).
- No ops DB write, image, publish, merge, deploy.
- G5-2 admin UI still separate.

## REGRESSION RISKS

- Evidence runner `CALL_CAP=28` is intentional and local to this review script; production author budgets unchanged.
- Validation merge depends on on-disk `validation.json`; deleting that file before `--only` would lose prior rows (same as any resume ledger).

## PROOF / checks

- `generate.ts --self-check` OK.
- Comedy Text Lock + file hashes unchanged after horror run.
- Both candidates in `validation.json`.
- `git diff --check`, `npm run lint`, `npm run typecheck:app` clean.
- `officialSupply/*.test.ts` 704/704.
- Offline prompts still under `offline-prompts/` (rofan / comedy / horror-dry).

## GPT review request

Please evaluate **문재호** literary/opening quality from the real manuscript (Cursor did not score it). Also confirm whether the diversity write-up’s facts are sufficient to choose a follow-up lever (market-signal priority vs world template vs play-pattern cast check) without speculative prompt stacking.
