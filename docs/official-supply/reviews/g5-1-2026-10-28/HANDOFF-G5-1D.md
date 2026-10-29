# G5-1D — world-stage cast intent, humor owner, public QA

Draft PR: https://github.com/you8520-sketch/chat-ai/pull/1748
GPT review that scoped this: issue comment `6481578561`
Code SHA: `2ae3978345a92c95e495dd9063f3f146ea0c612c`
Evidence is the following commit on `cursor/g5-1-genre-profile-d9a9`.

Cursor does not score the manuscript. One live character was generated. The play is not clearly different from 박수진 / 최하늘, so there is **no second generation. STOP.**

## BEFORE

Generation order is still world core → atlas → portfolio, then brief gate, then part1 / voice / bonds.

Confirmed on saved G5-1C prompts and briefs:

1. `WorldBibleInput.castIntent` (이웃·동료·룸메이트) was passed by the runner and consumed only by the portfolio call. `buildWorldCoreUser` and `buildWorldAtlasUser` dropped it. Portfolio must pick `faction` from the world list, so the intent could not leave a world that was already 민원·기록·재개발.
2. `HUMOR_LINES.central` ended with “농담이 인물의 목표·약점·대가를 대신하지 않는다.” Both comedy briefs told the model to stop the joke when responsibility appears.
3. `evaluateBriefCastFit` on the saved 최하늘 brief against 박수진 plus the pilot cast returns `errors: []`. Name collision was caught on the first 최하늘 portfolio (`박수진 (회의록 개그)`). Occupation / hook / speech Jaccard stayed far under the existing thresholds. The gate does not see the shared play (unfixed user, record review, joke-then-stop, institutional job).
4. `global-08` is the only non-romance `현대/일상` PRIMARY. Saved comedy-c world core, atlas, portfolio, and briefs cite it. The world premise copied 부자 친구 / 엄격한 아버지 / 재개발·생활지원. It is not the only source of the admin skeleton: 박수진’s world was already civic negotiation when PRIMARY was fantasy `kr-07` / `kr-08`.

`findAdultTermsInText` on the unchanged 최하늘 greeting returns the stem `사정` inside the eojeol `사정도` (“누구의 사정도”). Pitch and detailed description do not hit. `identity.gender` is `female`. The public pitch and detailed description use `그는` for her. Voice user and part1 recap omitted gender. Player-gender QA does not look at character self-reference. Default voice revision deletes `detailedDescription`.

## PROBLEM

The portfolio cannot invent a different first scene after the world has locked factions, the current event, and the power rules. A later overlap sentence on replacement does not unlock that world. Lexical cast-fit cannot reject this pair without a new scorer or a blacklist, both out of scope.

## AFTER

Canonical owners only. No new prompt section, JSON schema, runner, or quality score.

- `genreProfile.ts`: the one `humor=central` line now says the funny situation and the action make the next event. The “대신하지 않는다” clause is gone, not joined by a second humor rule.
- `authorPrompts.ts` / `author.ts`: when `authoring.profile.key === "genre_neutral"` and `castIntent` is non-empty, world core and atlas receive that existing field, and portfolio / replacement say the slot’s goal, user relation, first incident, first action, and humor come from the intent when it conflicts with a market-signal identity. Absent authoring and `rofan_parity` do not gain these lines.
- Part1 and voice prompts for `genre_neutral` include `officialCharacterPronounDirective`. Part1 recap includes `성별`. `validateCharacterBible` checks pitch + detailed description only (`그는`/`그가` for female, `그녀` for male). A voice revision whose reasons include `official_character_pronoun` may copy a non-empty `detailedDescription`. Creator comment is still not copied. `assertGeneratedPublicManuscripts` does not throw on this code.
- `findAdultTermsInText`: eojeol-start `사정` plus an ordinary particle (`사정도`, `사정이`, …) is skipped. Bare `사정`, `사정을`, `사정했다`, and split `사 정` still hit. `폰섹스` still hits.

Live prompts for `g5-modern-comedy-d` (calls 30–33, 35) contain those lines. PRIMARY remains `global-08` only. Model `gpt-6-luna`.

### Live character — not a clear play change

| | 박수진 | 최하늘 | 오지은 (this run) |
| --- | --- | --- | --- |
| Key | `g5-modern-comedy` | `g5-modern-comedy-c` | `g5-modern-comedy-d` |
| Job | 생활권 조정실 현장 조정 | 재단 청년 생활지원 보조 | 생활지원센터 민원·공용공간 실무자 |
| First incident | 임시 통행로 표지·민원·합의 | 영수증과 지원 조건 공개 검토 | 잘못 배포한 공동창고 예약표 대조 |
| Humor | 중요한 대목에서 농담을 멈춤 | 부담이 나오면 웃음을 거두고 금액·책임을 확인 | 비유가 잠깐 나왔다가 취소되고, 책임을 논의하면 농담을 멈춤 |
| User | 사전 관계 없음, 현장 확인 | 사전 관계 없음, 자료 검토 | 사전 관계 없음, 예약표 확인 |
| Text Lock | `ad56b3f1…` unchanged | `e8f5fd65…` unchanged | `63e1f3639a9066bd995593bf6edf6902e9f08cfd938088407f9975b09e856f94` |

First portfolio (call 32) was `강나리 (공주님)`, still a building-family clerk doing warehouse settlement under redevelopment. The existing royal-density gate rejected it because the nickname `공주` counted with the pilot royals (`cast_royal_density`). Replacement call 33 stayed inside that world and produced 오지은. World premise: “재개발을 앞둔 반송동”. Factions: 한결빌딩 소유주 가족, 세입자 모임, 상인회, 생활지원센터.

`draftQaOk=true` (pronoun directive used `그녀`). `bibleQaOk=false` / `relationQaOk=false`: existing `bible_user_rel_free_premise`. Voice repair count 0, because that code is not a voice field. Manuscript left as generated.

## REMOVED

- The central-humor ban that told the model a joke must not carry the goal.
- The drop of `castIntent` on genre-neutral world core and atlas.
- The false adult hit on ordinary `사정도` / `사정이`.

No cast-fit Jaccard, no admin blacklist, no second market selector, no 19 genre engines.

## PRESERVED

- Rofan and absent-plan prompts stay byte-identical except the replacement overlap lines that G5-1 already added for an explicit plan.
- `selectMarketSignals` and the `global-08` PRIMARY.
- `OFFICIAL_CHARACTER_CALL_CAP` stays 6. Evidence cap is 37 (29 already saved + 8 authorized). This run used 7. Do not raise it.
- 박수진, 문재호, 최하늘 manuscripts, raw responses 01–29, and Text Locks. G3/G4 files were not in the diff.
- 최하늘 `validation.json` still records `draftQaOk=false`. The file was not recomputed. `findAdultTermsInText` on that unchanged greeting now returns `[]`. `evaluateOfficialCharacterPronoun` still flags her public `그는`.

## REGRESSION RISKS

- Genre-neutral world prompts are longer. A male public pitch that mentions another woman as `그녀` fails bible QA.
- Pronoun repair can replace `detailedDescription`. Default revisions still delete it.
- Ordinary `사정`+particle no longer blocks. Bare, object, verbal, and split forms still do.
- A nickname containing `공주` still trips `cast_royal_density` against the pilot cast and forces one replacement inside the already written world.
- `NEUTRAL_POWER_NOTE` (규칙·평판·기술·권한) was not edited. The new world still filled power and situation as records, consent, and redevelopment cost. That remains a hypothesis, not a patched sentence.

## PROOF

- Tests: `src/lib/officialSupply/**/*.test.ts`, `characterAdultText.g2.test.ts`, `characterListingModeration.test.ts` — 730 pass, 0 fail. `git diff --check`, `npm run lint`, `npm run typecheck:app` pass on the code commit.
- Rofan parity, market PRIMARY, cast-fit gap (최하늘 vs 박수진 `errors: []`), adult normal/bypass/false-positive, and female/male pronoun cases are in those tests.
- Final prompts: `provider-responses/30`–`36` `.prompt.json`.
- First manuscript: `candidates/g5-modern-comedy-d/first-manuscript.md`.
- This run: 7 calls, model `gpt-6-luna`, known billed **US$0.006879** (about **₩10** at ₩1,500/USD). Estimate before the run: expected ₩69, worst-case ₩198, under the ₩1,000 gate. Ledger after the run: 36 / cap 37. Generated `2026-10-29 13:09 KST`.

No ops DB write, registration, publish, merge, or deploy. G5-2 admin UI stays next.
