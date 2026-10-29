# G5-1C — genre-matched market PRIMARY + comedy compare

Draft PR: https://github.com/you8520-sketch/chat-ai/pull/1748
GPT review that scoped this: issue comment `6480492915` (HEAD then `ab1ec374`)
Code+evidence HEAD: see latest commit on `cursor/g5-1-genre-profile-d9a9`

Cursor does **not** score manuscripts. GPT re-review requested. **STOP.**

## BEFORE / PROBLEM

`selectMarketSignals()` with `domestic_first` put **all KR eligible rows** into PRIMARY, then sorted by genre inside that bag. After `excludeRomanceLed` dropped every KR `현대/일상` row (all three are romance-framed), PRIMARY for comedy/horror became fantasy tops `kr-07`/`kr-08` while same-genre global rows stayed SUPPORTING.

Saved proof (live prompts):
- comedy call03 PRIMARY: `kr-07, kr-08, kr-13, kr-15, kr-14, kr-27…`
- horror call16 PRIMARY: same fantasy bag; `global-07` only in SUPPORTING

See `signal-selection-before-after.json`.

## AFTER

Single owner change in `src/lib/officialSupply/marketFit.ts`:
- **Non-rofan:** PRIMARY = exact same-genre signals only (preferred region first, then other). Off-genre popular KR rows never enter PRIMARY.
- **No same-genre eligible signal:** PRIMARY empty + explicit Korean no-signal line in `formatMarketSignalLines`.
- **Rofan (`로맨스 판타지`):** unchanged locale-first PRIMARY/SUPPORTING id order (parity-locked in tests).

After:
- `현대/일상` + excludeRomance → PRIMARY `global-08` only
- `공포/추리` + excludeRomance → PRIMARY `global-07` only
- `학원` → empty PRIMARY + no-signal line

## REMOVED

- Treating “all domestic signals” as PRIMARY for non-rofan genres (the region-before-genre bag).

## PRESERVED

- Rofan default selection byte order (test lock).
- Common author engine, QA owners, Text Lock, relation contracts, paid call path.
- G3/G4 originals; G5 박수진 / 문재호 manuscripts, raw, Text Locks **unchanged** (SHA256 verified after comedy-c run).
- No new trope recommender, no snapshot rewrite, no new runner/QA scorer, no 19 per-genre engines.

## Live compare — `g5-modern-comedy-c`

| | 박수진 (before) | 최하늘 (영수증 부자) (after signal fix) |
| --- | --- | --- |
| Key | `g5-modern-comedy` | `g5-modern-comedy-c` |
| Axes | light / humor central / dialogue / nickname | same |
| PRIMARY in world prompts | fantasy KR | **`global-08` only** (calls 22/24/25) |
| Occupation | 생활권 조정실 현장 조정 | 재단 청년 생활지원 보조 진행자 |
| Hook | 표지·민원·합의·자기 실수 | 영수증 별명·가족 재단 원칙 vs 주민 생활비 |
| Text Lock | `ad56b3f1…` unchanged | `e8f5fd65…` |
| Selective voice repairs | 1 | 1 |
| QA | all green | bible/tags/relation/lorebook green; **draftQa** `sfw_public_text_has_adult_terms` (not rewritten) |

Manuscript: `candidates/g5-modern-comedy-c/first-manuscript.md`
Raw: `provider-responses/22-…` through `29-…`

### Cost (this compare)
- New physical calls: **8** (≤10 approved). Total ledger: 29 / cap 31.
- Known billed total ≈ **US$0.0299 (~₩45)**; 2 prior comedy timeouts still UNKNOWN.
- Model: `gpt-6-luna` / cheaper-inference-background.

## Confirmed improvement vs remaining gap

**Confirmed (code/prompt):**
- Genre-mismatched fantasy PRIMARY injection is fixed for non-rofan.
- New live prompts cite `global-08` as PRIMARY and `provenMarketSignal: ["global-08"]`.
- Nickname comedy (`영수증 부자`) and receipt wordplay appear in greeting/speech; conflict is family-foundation vs neighborhood costs rather than municipal marker negotiation.

**Remaining (for GPT / next scope — do not prompt-patch here):**
- The only non-romance `현대/일상` eligible signal in the snapshot is `global-08` (angst family drama / powerful difficult figure). That prior still pulls rich-family / foundation / paperwork stakes.
- KR `현대/일상` rows (`kr-05/06/26`) are all romance-led, so comedy with `excludeRomanceLed` has **no domestic same-genre PRIMARY**.
- World/brief planning can still choose institutional settings; signal fix alone may be insufficient for roommate-slice comedy.
- `draftQaOk=false` on adult-term SFW gate — investigate later; manuscript left as model output.

If GPT judges literary quality still inadequate, next candidate is world/brief planning structure (and/or snapshot coverage for non-romance daily comedy), **not** another Voice prompt sentence.

## REGRESSION RISKS

- Non-rofan batches that previously “borrowed” fantasy KR PRIMARY will see thinner PRIMARY lists; empty PRIMARY is explicit.
- Rofan path is test-locked; any future change to `LOCALE_FIRST_PRIMARY_GENRE` must update that lock.

## PROOF / checks

- `signal-selection-before-after.json`
- Tests: marketFit + genreProfile incl. rofan id lock, 19-genre smoke, comedy/horror PRIMARY assertions
- `officialSupply/*.test.ts` 708/708; lint; typecheck:app; `git diff --check`
- Original G5 manuscript hashes unchanged after this run

## STOP

Draft PR only. No ops DB / image / publish / merge / deploy. G5-2 admin UI remains follow-up.
