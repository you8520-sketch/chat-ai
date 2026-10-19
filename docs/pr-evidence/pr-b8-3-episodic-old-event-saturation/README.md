# B8-3 evidence: old-event Episodic saturation by a recurring name, and the verbatim-quote-only regression

B8-3 reproduces the B7 서윤 failures (T150 and T500) on the code after B8-2 and fixes the owner in `src/lib/episodicMemoryFacts.ts`. Round 1 fixed the cause: the query word "태형", which nearly every row contains, counted as much as "한서윤" or "서류", which only the asked-about event contains. Review of `3e232140` then found a regression the rarity weight introduced (야간 당직), fixed in round 2 below.

Constraints held in both rounds:
- Zero provider or embedding calls and zero production DB writes.
- No new store, schema, migration, prompt sentence, name or word list, or character-specific code.
- No limit was changed: 25 state keys, 55/25 lane budgets, 8 facts and ~1000 chars of Episodic budget, Global 10,000 chars, Medium 75 turns, RP 3200+ soft target with no output cap.

## SHAs

- Base: `460adb6d` (main / production after #1659, B8-2).
- Round 1 (reviewed head `3e232140`):
  - `ede4955b` provider-free B7 snapshot rebuild and the stage probe
  - `04eedf6b` query words weighted by in-scope distinctiveness (the fix)
  - `9519bace` the word frequencies come from the relevance-lane statement (statement count unchanged)
  - `33105b18` regression for common-name saturation past the key cap
  - `3e232140` evidence (see "Evidence paths" for what was wrong with it)
- Round 2:
  - `48a9ede3` failing tests for the 야간 당직 regression (fail on `3e232140`)
  - `7ac0c4be` the fix (verbatim-quote-only discount) and the final fixtures
  - evidence commit (this README and `logs/`)

## Changed files

| File | Change |
|---|---|
| `src/lib/episodicMemoryFacts.ts` | Round 1: the relevance-lane statement also returns, per query word, how many recall-scope rows contain it, orders the lane by summed BM25 idf, `weightedLexicalRelevance` in the final scorer, prefer list ordered by weighted relevance. Round 2: a word found only in the evidence quote counts at `EPISODIC_QUOTE_ONLY_MATCH_WEIGHT` (0.25) of its weight, in the lane SQL, the final scorer and the prefer list alike |
| `src/lib/memory/memory-episodic-long-horizon.test.ts` | `COMMON-NAME saturation` (4 tests) and `QUOTE-ONLY rare word` (5 tests) |
| `docs/pr-evidence/.../stage-probe.mts` | Fixed: the "stored rows" nature column now attaches the stored evidence type as the pipeline does; the reconcile stage reports the production resolved set; per-word weights and content/quote match sites are printed |

## Reproduction method and the reconstructed DB

The original B7 replay DBs were not kept, so every number here comes from **reconstructed snapshots**, not the original DBs. `rebuild-b7-snapshot.mts` rebuilds them provider-free from the B7 evidence branch:
- The exact scripted T1..T500 text comes from `scenario.mts` and `filler.mts`.
- Every stored row comes from `audit/stored-T<N>.json`.
- Subjects come from `known-keys.json`.
- Quotes come from `known-quotes.json` (original quotes preserved in committed B7/B8 final blocks), or else the best-overlap sentence of the evidence message.
- Each turn is saved through the production `reconcileEpisodicMemoryFactsForGeneration`, which re-verifies the quote.
- T500 stores 441/441 audit rows.

Differences from the original snapshots (`logs/rebuild-fidelity-vs-original-round4.txt`, both run on `460adb6d` code against the B8-2 round-4 logs):
- 24/26 probes give the same status for every target row (budget reasons `max_chars`/`max_facts` folded together). Both 서윤 cases and the night-watch case match the original; the night-watch block is identical.
- The 2 that differ are T80-C3 (a one-place rank shift) and X500-yeom-occupation (T312/T313 were budget drops in the original and are candidate misses in the rebuild, so the 염태오 gain is larger here than it would be on the original).
- 12 probes differ by 1–5 non-target block lines, because a rebuilt quote span differs from the original.
- For the night-watch case, the T64 decoy quote ("밥 같이 안 먹어") and the T144/T340/T348/T476 night quotes are original text. Other night rows, and the T129 차세린 row whose quote contains "야간", use rebuilt quote spans.

`stage-probe.mts` separates the stages for one question: stored rows (key, nature, guard, quote, where each query word matches), candidate lanes, survival in the production resolved set, final ranking (relevance, composite, rank, budget reason), and the final block. Lexical lanes only; read-only.

## Round 1: common-name saturation (서윤 T150 / T500)

Question: `(복도 끝에서 한서윤이 서류를 안고 다가오는 걸 보고 태형의 소매를 잡아끈다) 저 사람 또 왔어.`
Target rows: #39 T64 `rejected_company` "태형은 구내식당에서 한서윤의 동석 제안을 거절했다." (historical event, so the 25-key cap never applies to it) and #40 T64 `opinion_of_seoyun` "태형은 뒤에서 서류를 올리는 사람과 식사하고 싶지 않다고 말했다." (a character claim, state-like, exposed to the cap).

Correction to the round-1 README: it listed #39 as state-like. With the stored evidence type attached, as the pipeline does, #39 is a `historical_event`; only #40 is state-like. The stage probe printed the wrong column before; it is fixed.

### Before (`460adb6d`), `logs/stage/before-460adb6d/`

| Case | #39 | #40 |
|---|---|---|
| T150 | relevance lane, `max_chars`, rank 14, rel 2.000 (tie) | relevance lane, `max_chars`, rank 13, rel 2.000 (tie) |
| T500 | **CANDIDATE_MISS** | relevance lane, `max_chars`, rank 31, rel 2.000 |

The 25-key competition that excluded T150 in B7 no longer does on main: B8-2 spends the cap on relevance-lane rows first, and #40 survives. T150 fails at final ranking (the top 12 are rows matching "태형" and "끝에서"/"사람"/"보고", all at the cap of 2.000, so recency decides). At T500, 413 of 441 rows contain "태형", so any newer row with one more incidental query word ("끝에서" 19 rows, "보고" 7, "사람" 81) ties #39 at 2 words and fills the 25 relevance slots first.

### Cause

Lexical relevance was `min(2, matched query words)` in the relevance-lane SQL and in `scoreFactForPrompt`. A word most rows contain counted the same as a word only the event contains. With the cap at 2, "태형 + any incidental word" equals "태형 + 한서윤", and recency decided, both for which 25 older rows enter the lane and for the final order. The key-cap prefer list followed candidate order, so with more than 25 matching state-like keys the old event's key could lose the cap.

### Fix

1. Each query word gets a BM25 idf over the recall scope, from the chat itself, normalized so the rarest present word = 1 (a word no in-scope row contains keeps 1). At T500: "태형" 0.012, "사람" 0.297, "끝에서" 0.549, "보고" 0.717, "한서윤"/"서류" 1.
2. The same weight orders the relevance lane (summed idf before recency), the final scorer (`min(2, Σ weights)`), and the key-cap prefer list.
3. Pass evidence is unchanged: a row passes when it shares any query word. A name-only question still recalls rows with that name; an unrelated question passes nothing.

The df counts ride on the relevance-lane statement (a `stats` CTE with a LEFT JOIN), so the candidate fetch keeps its existing statement count (the long-horizon perf test asserts at most 4).

### After (`7ac0c4be`), `logs/stage/after-7ac0c4be/`

| Case | #39 | #40 |
|---|---|---|
| T150 | INJECTED #2 (rel 1.026) | INJECTED #1 (rel 1.497) |
| T500 | INJECTED #2 (rel 1.012) | INJECTED #1 (rel 1.309) |

The `reviewed-3e232140` results are the same except T500 #39 was #3 (see below). Final blocks (full in the stage logs):

T500 before (`460adb6d`):
```
- [T479] [AI 장면 서술 발췌] “두 사람은 한강 둔치에서 보고서 작성을 했다.”
- [T476] [AI 장면 서술 발췌] “두 사람은 구내식당에서 야간 대기를 했다.”
- [T474] [AI 장면 서술 발췌] “두 사람은 역 앞 분식집에서 저녁 준비를 했다.”
- [T473] [캐릭터 발언(미확정 주장)] “정비팀 박철이 지나가다 "페어 호흡 좋네요"라고 한마디 던졌고, 태형은 괜히 어깨를 으쓱했다.”
- [T463] [AI 장면 서술 발췌] “태형은 골목 끝에서 작은 균열을 확인하고 봉인반을 불렀다.”
- [T456] [AI 장면 서술 발췌] “두 사람은 지하 사격장에서 C급 게이트 정리를 했다.”
- [T449] [유저 입력 발췌] “교관 남궁현 씨가 오늘 우리 찾았대.”
```
T500 after (`7ac0c4be`):
```
- [T64] [캐릭터 발언(미확정 주장)] “웃으면서 뒤에서 서류 올리는 사람이랑은 밥 같이 안 먹어.”
- [T64] [AI 장면 서술 발췌] “태형은 예의 바르게 웃었지만 의자를 빼 주지는 않았다.”
- [T479] [AI 장면 서술 발췌] “두 사람은 한강 둔치에서 보고서 작성을 했다.”
- [T419] [AI 장면 서술 발췌] “태형은 렌이 독수리 타법으로 한 장을 다 채울 때까지 기다렸다.”
- [T44] [AI 장면 서술 발췌] “그날 태형의 왼쪽 옆구리는 정식으로 열네 바늘 봉합되었다.”
- [T30] [AI 장면 서술 발췌] “발톱이 태형의 왼쪽 옆구리를 꿰뚫었다.”
- [T22] [유저 입력 발췌] “그냥 배정받은 가이드랑 탕후루 먹을 필요 없잖아.”
```
T150 before and after: see `logs/stage/{before-460adb6d,after-7ac0c4be}/L150-B3-seoyun.txt`.

Not solved here: T57 #34 (서윤's cake). Its text says "서윤" and the question says "한서윤", so no query token is contained in the row. It is lexically unreachable; fixing it needs name/alias normalization (a separate follow-up, not started).

## Round 2: 야간 당직 regression (verbatim-quote-only match)

### Reproduction on the reviewed head

Question: `같이 야간 당직 섰던 거 기억나?` on the T500 snapshot. Query words: "같이" (2 rows contain it, weight 1.000), "야간" (15 rows, weight 0.647); "당직", "섰던", "기억나" match nothing.
`logs/stage/reviewed-3e232140/X500-night-watch.txt`:

| Row | Where "같이"/"야간" matches | rel | rank / result |
|---|---|---|---|
| #40 T64 (claim, state-like) "…서류를 올리는 사람과 식사하고 싶지 않다고 말했다." | "같이" only in the quote "…밥 같이 안 먹어." | 1.000 | **rank 1, INJECTED** |
| #308 T348 "태형과 렌은 본부 옥상에서 야간 대기를 했다." | "야간" in the gloss and the quote | 0.647 | rank 8, **DROPPED(max_chars)** |

Stages for the two rows: both are stored and guard-allowed, both enter the relevance lane (14 of 25 slots used), both survive reconcile (the night rows are historical events, so the cap never applies to them), and the final ranking decides. In the 3e232140 ranking, a rarity weight of 1.000 for a word that no gloss contains beat 0.647 for the word in every night row's gloss.

The problem is not "같이" and not night watch. Rarity measures how well a word tells rows apart, not whether it names the asked topic. A row that matches only through a word in its verbatim narration quote, while its gloss and key fields (what the memory is about) share nothing with the question, can still be the only row that contains a rare word. The same happens at the other two places that use the weight: the relevance lane order, and the 25-key prefer list (a rare quote-only word moves a row ahead of rows whose content matches).

### Fix

One existing owner, the same lexical path. A query word found **only in the evidence quote**, not in the gloss, subject, attribute or value, counts at `EPISODIC_QUOTE_ONLY_MATCH_WEIGHT` = 0.25 of its weight. It is applied identically in:
- the relevance-lane SQL (separate content and quote match flags per word, so the lane order matches),
- `weightedLexicalRelevance` (the final scorer and the key-cap prefer list, which sorts by it).

Not done: "같이" is not special-cased; nothing is night-specific; quote matching is not removed (a quote-only match still passes the relevance check, still enters the lane, and still counts); no limit or budget changed. The word weights themselves (df over the whole searchable text) are unchanged.

Why a coverage count alone would not have worked: both candidates match exactly one word, so a count ties; the discount is what separates them.

Why 0.25 and not something else (`probes-q*` sweep, 26 probes, Q = 0.1 / 0.25 / 0.5): the B7 probes are insensitive; targets and blocks are identical for all three. The value is bounded by the lane fixture: a verbatim-only row must not beat a topical content word that is only moderately common. With 36 night rows in 441 the night weight is about 0.46, so the discount must stay below that; 0.5 would have let the decoys take lane slots. 0.25 leaves margin, so a verbatim-only word loses to any content word that appears in under about a quarter of the rows.

### Tests (`QUOTE-ONLY rare word`, 5 tests)

| Test | `3e232140` | `7ac0c4be` | Which part it pins |
|---|---|---|---|
| final ranking: B7-shaped (15 night rows, 2 quote-only decoys, ~440 rows); decoys rank after every night row, none injected | fail | pass | scorer |
| candidate lane: 36 older night rows, lane full; decoys hold no lane slot, 25 night rows do | fail | pass | lane SQL |
| 25-key priority: 36 night claims + 2 decoys in the recent window (27 state-like keys, cap 25); decoys are cut, 25 night rows kept | fail | pass | prefer list |
| a quote-only clue still recalls the row when only name-only rows compete | pass | pass | legitimate quote recall |
| a quote-only clue plus a second matching word beats rows matching one common content word | pass | pass | legitimate quote recall |

Ablations: removing only the lane SQL discount fails only the lane test; removing only the JS discount fails the final-ranking and key-cap tests. Logs: `logs/tests/quote-only-{before-3e232140,after-7ac0c4be}.tap`; the earlier `COMMON-NAME saturation` tests (T150/T500, name-only, unrelated) still pass.

Known limit, stated openly: a single quote-only match on a rare word, competing with a single content match on a word in more than about a quarter of the rows, now loses to the content match. That is the intended direction, but it is the same shape as a real quote-only clue that has no other match; the guards above show the clue still wins when it has a second matching word or when only name-only rows compete.

### Night-watch before / reviewed / after (`logs/stage/{before-460adb6d,reviewed-3e232140,after-7ac0c4be}/X500-night-watch.txt`)

| Row | `460adb6d` | `3e232140` | `7ac0c4be` |
|---|---|---|---|
| #40 T64 "밥 같이 안 먹어" | rel 1.000, rank 16, dropped | rel 1.000, **rank 1, injected** | **rel 0.250, rank 15, dropped (`max_chars`)** |
| #308 T348 야간 대기 | rel 1.000, rank 7, injected | rel 0.647, **rank 8, dropped** | rel 0.647, **rank 7, injected** |
| #436 T491 야간 대기 | rank 1 | rank 2 | rank 1 |

Final block, `3e232140`: starts with the T64 line, and T348 is missing. Final block, `7ac0c4be`: identical to `460adb6d` (seven night-watch lines, T491 to T348; `diff` of the block lines is empty).

## Evidence paths

The round-1 commit `3e232140` listed `logs/stage/`, `logs/probes-*`, `logs/link-probe/` and `logs/boundary/` in this README, but none of those files were in the commit: the repository's `.gitignore` excludes `*.log`, and `git add` skipped them. This commit regenerates them as `.txt` (no `.gitignore` change):

| Path | Content |
|---|---|
| `logs/stage/{before-460adb6d,reviewed-3e232140,after-7ac0c4be}/{L150-B3-seoyun,L500-B3-seoyun,X500-night-watch}.txt` | per-row stages, scores, ranks, drop reasons, top ranked, final block |
| `logs/probes-{before-460adb6d,reviewed-3e232140,after-7ac0c4be}/*.txt` | the 26 B7 probes per revision |
| `logs/probes-compare-main-to-after.md`, `logs/probes-compare-reviewed-to-after.md` | per-probe target, block, size, statement and time comparison |
| `logs/link-probe/<rev>.txt`, `logs/boundary/<rev>-run{1,2,3}.txt` | B8-2 correction-link and boundary probes per revision |
| `logs/tests/*.tap`, `logs/tests/*.txt` | test runs (before/after) and failing-name sets |
| `logs/rebuild-fidelity-vs-original-round4.txt` | reconstructed DB vs original B8-2 round-4 logs |

Each revision ran from its own checkout (`460adb6d` and `3e232140` as detached worktrees, `7ac0c4be` as the branch), `@/` resolving to that checkout's `src`. `run-probes.sh` does `cd` to its own checkout, so it was invoked from each worktree's copy.

## Checks (round 2)

- **Related Episodic suite** (75 files, `logs/tests/episodic-75-files.txt`): 1114 tests, 14 failing names. 13 are the identical pre-existing set of `460adb6d` (1105 tests, 13 failing, `logs/tests/episodic-75-files-failing-before-460adb6d.txt`). The 14th is `characterSettingExpansionAudit.test.ts` ("keeps the live 12000 authoring ceiling…", "character setting expansion readiness"), failing with `database is locked` (`SQLITE_BUSY`) in the parallel run; it passes 5/5 alone on both `460adb6d` and `7ac0c4be` and does not touch Episodic. Not fixed or repeated.
- `memory-episodic-long-horizon.test.ts`: 59/59, including the perf limit of at most 4 candidate statements.
- **B8-2 link probe**: output byte-identical on `460adb6d`, `3e232140` and `7ac0c4be` (`RESULT failures=0`, 38 checks).
- **B8-2 boundary probe** (chains 1–10, one correction then 210 others, user/scene narrators, 10,600-row chat): content identical to `460adb6d` in 3/3 runs on both later revisions; statements per call 6 → 6.
- **26 B7 probes**:
  - vs `3e232140`: 0 targets lost, 2 gained (night-watch T348, 염태오 T126). Block-line changes are only low-relevance filler: L500-A4 T403 for T320/T57, T80/T90-B3 T10 for T16 (T16 matched "사람" only through its quote), 염태오 T126 for T19.
  - vs `460adb6d`: 1 target lost, 9 gained. The 서윤 T150/T500 rows and the 염태오 rows are gained. The one lost is X500-measurement T447, replaced by T266 (the same 80% observation one row older, because T266 matches the rarer query word "수치" in its gloss; T447 does not contain it). No target is displaced by an unrelated row.
  - Night-watch: the block is identical to `460adb6d`.
- **Cost** (`probes-compare-*.md`, boundary logs; sequential, same machine, noise a few percent):

| | `460adb6d` | `3e232140` | `7ac0c4be` |
|---|---|---|---|
| 26 probes: prepared statements (sum) | 685 | 682 | 688 |
| 26 probes: avg ms per call (sum of 50-call averages) | 191.0 | 187.7 | 197.6 |
| 26 probes: block chars (sum / max) | 24,828 / 1,097 | 24,873 / 1,086 | 24,823 / 1,086 |
| 26 probes: injected rows | 124 | 123 | 122 |
| boundary, 10,600-row chat: avg ms (3 runs) | 55.7 | 60.3 | 66.5 |
| boundary, 1,209-row chat: avg ms (3 runs) | 9.8 | 9.7 | 10.3 |

  - The statement changes in the probes are reconcile key lookups (capped at 25), which move with which keys are preferred. The candidate fetch itself is unchanged.
  - The lane statement now evaluates a content flag and a quote flag per word instead of one combined flag, which is the added work. Block size stays inside the ~1000-char Episodic budget.
- `git diff --check` on every commit, `npm run lint`, `npm run typecheck:app`: see the PR description.
- The round-1 full `npm run test:regular` comparison is kept as recorded in `logs/tests/regular-summary.txt` (`460adb6d` vs `3e232140`); it was not repeated, per the review instruction not to repeat the already-identified unrelated failures.

## Regression risks for review

1. **A single quote-only rare word now loses to a single content word that is moderately common.** The discount direction is intended, but it applies to real quote-only clues too. The two guard tests cover the clue winning with a second matching word, or with only name-only competitors. A real quote-only clue competing with a content-matched mid-frequency word and nothing else would lose.
2. **Same observation, older row.** X500-measurement: T266 replaces T447 (same 80% observation), because only T266 contains "수치" in its gloss. Both rows are relevant; this is not an unrelated displacement.
3. **Weak-relevance fill.** When distinctive rows are few, remaining block slots are filled by rows whose only match is the common name (relevance about 0.01), ordered by importance and recency.
4. **Cost** grows with chat size: about +11 ms average over `460adb6d` on a 10,600-row chat, flat at B7 size.
5. The discount constant is tuned on a fixture, not learned; the B7 probes do not distinguish 0.1 from 0.5.

## Excluded (per ticket)

Gemini distortion, Global compression cost, repetition counts, promise completion, paid 1000-turn eval, #1591, alias normalization, merge and deploy. Not changed: T57 alias reachability; extraction gaps (for example the T12 row B7 never stored).

## Reproduce

```bash
# rebuild a snapshot (B7 evidence branch checked out at $B7)
node --conditions=react-server --import tsx rebuild-b7-snapshot.mts "$B7" 500 known-keys.json known-quotes.json /tmp/b7r/snap-500/app.db
# stages for one question
node --conditions=react-server --import tsx stage-probe.mts /tmp/b7r/snap-500/app.db \
  '같이 야간 당직 섰던 거 기억나?' '당직|night_watch|야간|밥 같이' \
  /tmp/b7r/memory-blocks/L500-A5-injury.memory-block.txt
# 26 probes (run from the checkout under test)
bash ../pr-b8-2-episodic-independent-event/run-probes.sh /tmp/b7r <out dir>
```

Run from a checkout root (or a worktree with `node_modules` linked) so `@/` resolves to that revision's `src`.
