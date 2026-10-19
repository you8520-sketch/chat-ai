# B8-3 evidence: old-event Episodic saturation by a recurring name

B8-3 reproduces the B7 서윤 failures (T150 and T500) on the code after B8-2 and fixes the owner in `src/lib/episodicMemoryFacts.ts`. The cause was that the query word "태형", which nearly every row contains, counted as much as "한서윤" or "서류", which only the asked-about event contains. As a result, recent rows tied with the old event and recency decided.

Constraints held:
- Zero provider or embedding calls and zero production DB writes.
- No new store, schema, migration, prompt sentence, name list or character-specific code.
- No limit was changed: 25 state keys, 55/25 lane budgets, 8 facts and ~1000 chars of Episodic budget, Global 10,000 chars, Medium 75 turns, RP 3200+ soft target with no output cap.

## SHAs

- Base: `460adb6d` (main / production after #1659, B8-2).
- Commits:
  - `ede4955b`: provider-free B7 snapshot rebuild and the stage probe (evidence tools)
  - `04eedf6b`: query words weighted by in-scope distinctiveness (the fix)
  - `9519bace`: the word frequencies come from the relevance-lane statement, so the candidate fetch keeps its statement count
  - `33105b18`: deterministic regression for common-name saturation past the key cap
  - evidence commit (this README and `logs/`)

## Changed files

| File | Change |
|---|---|
| `src/lib/episodicMemoryFacts.ts` | The relevance-lane statement also returns, per query word, how many recall-scope rows contain it. It orders the lane by summed BM25 idf instead of matched-word count. `weightedLexicalRelevance` replaces `lexicalRelevance` in the final scorer. The reconcile key-cap prefer list is ordered by weighted relevance, and `reconcileGlobalStateLikeFacts` follows that order |
| `src/lib/memory/memory-episodic-long-horizon.test.ts` | +4 tests: `COMMON-NAME saturation` at T150 and T500, name-only question, unrelated question |

## Reproduction method

The original B7 replay DBs were not kept. `rebuild-b7-snapshot.mts` rebuilds them provider-free from the B7 evidence branch:
- The exact scripted T1..T500 text comes from `scenario.mts` and `filler.mts`.
- Every stored row comes from `audit/stored-T<N>.json`.
- Subjects come from `known-keys.json`.
- Quotes come from `known-quotes.json`, or else the best-overlap sentence of the evidence message.
- Each turn is saved through the production `reconcileEpisodicMemoryFactsForGeneration`, which re-verifies the quote.
- T500 stores 441/441 audit rows.

Fidelity against the original-snapshot B8-2 round 4 logs, both run on `460adb6d` code (`logs/rebuild-fidelity-vs-original-round4.txt`):
- 24/26 probes give the same status for every target row (budget reasons `max_chars`/`max_facts` folded together).
- Both B3 cases are identical at every stage that matters: candidate miss, budget drop, and rank region.
- The 2 that differ are T80-C3, a one-place rank shift, and X500-yeom-occupation. In yeom, the original snapshot has T312/T313 as candidates dropped by `max_facts`, while the rebuild has them as candidate misses. So the yeom gain shown below is larger than it would be on the original snapshot.
- 12 probes differ by 1–5 non-target block lines, because the rebuilt quote span differs.

`stage-probe.mts` separates the stages for one question: stored rows, candidate lanes, state reconciliation with the key-cap statistics, final ranking (relevance, composite, rank, budget reason), and the final block. Lexical lanes only; it is read-only.

## BEFORE (`460adb6d`, rebuilt snapshots)

Question: `(복도 끝에서 한서윤이 서류를 안고 다가오는 걸 보고 태형의 소매를 잡아끈다) 저 사람 또 왔어.`
Target rows: #39 T64 `rejected_company` "태형은 구내식당에서 한서윤의 동석 제안을 거절했다." and #40 T64 `opinion_of_seoyun` "태형은 뒤에서 서류를 올리는 사람과 식사하고 싶지 않다고 말했다."

**T150** (`logs/stage/before-460adb6d/L150-B3-seoyun.log`):

| Stage | #39 | #40 |
|---|---|---|
| stored | yes, `unknown` (state-like), guard allowed | same |
| candidates | relevance lane | relevance lane |
| reconcile (30 keys discovered, 25 reconciled, 5 dropped by cap) | kept | kept |
| final ranking | rel 2.000, rank 14, `max_chars` | rel 2.000, rank 13, `max_chars` |

The 25-key competition that excluded T150 in B7 no longer excludes it on current main, because B8-2 already spends the cap on relevance-lane rows first. The remaining failure is the final ranking. The top 12 are T97–T146 rows that match "태형" and "끝에서"/"사람"/"보고", all at relevance 2.000 (the cap), so recency decides.

**T500** (`logs/stage/before-460adb6d/L500-B3-seoyun.log`):

| Stage | #39 | #40 |
|---|---|---|
| candidates | **CANDIDATE_MISS** | relevance lane |
| reconcile | — | kept |
| final ranking | — | rel 2.000, rank 31, `max_chars` |

The relevance lane orders by matched-word count, then recency. 413 of 441 rows contain "태형", so any newer row with one more incidental query word ("끝에서" 19 rows, "보고" 7, "사람" 81) ties #39 at 2 words and fills the 25 slots first.

Final block, T500 before:
```
- [T479] [AI 장면 서술 발췌] “두 사람은 한강 둔치에서 보고서 작성을 했다.”
- [T476] [AI 장면 서술 발췌] “두 사람은 구내식당에서 야간 대기를 했다.”
- [T474] [AI 장면 서술 발췌] “두 사람은 역 앞 분식집에서 저녁 준비를 했다.”
- [T473] [캐릭터 발언(미확정 주장)] “정비팀 박철이 지나가다 "페어 호흡 좋네요"라고 한마디 던졌고, 태형은 괜히 어깨를 으쓱했다.”
- [T463] [AI 장면 서술 발췌] “태형은 골목 끝에서 작은 균열을 확인하고 봉인반을 불렀다.”
- [T456] [AI 장면 서술 발췌] “두 사람은 지하 사격장에서 C급 게이트 정리를 했다.”
- [T449] [유저 입력 발췌] “교관 남궁현 씨가 오늘 우리 찾았대.”
```

## ROOT CAUSE

Lexical relevance was `min(2, matched query words)`, both in the relevance-lane SQL and in `scoreFactForPrompt`. A word that most rows contain counted the same as a word only the event contains. With the cap at 2, "태형 + any incidental word" equals "태형 + 한서윤". Recency (`1/(1+age/20)`) then decides, both in which 25 older rows enter the lane and in the final order. The key-cap prefer list had the same weakness: it followed candidate order, so with more than 25 matching keys, the old event's key could lose the cap to recent rows that also matched only the name.

## FIX

One owner, the existing lexical path of `episodicMemoryFacts.ts`:

1. **Word weight from the chat itself.** For each query word, the relevance-lane statement counts the recall-scope rows that contain it (df) over the same search text the lane already matched. The weight is the BM25 idf `ln(1 + (n − df + 0.5)/(df + 0.5))`, normalized so the rarest present word = 1. A word no in-scope row contains keeps weight 1.
   - At T500: "태형" 0.012, "사람" 0.30, "끝에서" 0.55, "보고" 0.72, "한서윤"/"서류" 1.
   - Nothing is hardcoded: a name is weak only in a chat where nearly every row repeats it.
2. **Same weights in every place that ranks lexically.**
   - The lane orders by summed idf (proportional to the weights) before recency.
   - The final scorer uses `min(2, Σ weights of matched words)`, on the same 0..2 scale.
   - The key-cap prefer list is sorted by that relevance.
3. **Evidence is unchanged.** A row still passes the relevance check when it shares any query word (`matchedWords > 0`). A name-only question therefore still recalls rows with that name (one word → weight 1). An unrelated question still passes nothing.

The df counts come from the relevance-lane statement itself (a `stats` CTE with a LEFT JOIN, so the counts survive when no older row matches). The candidate fetch stays within its existing four-statement limit (`memory-episodic-long-horizon` perf test).

Is each part load-bearing? Without the prefer-list sort, both real B7 cases still pass, because the key cap is not their blocker on current main. The deterministic >25-key fixture fails at T150 and T500, though ("T64 refusal must be injected"). So the sort is what the ">25 keys" requirement depends on.

## AFTER (branch, same snapshots, same questions)

**T150** (`logs/stage/after/L150-B3-seoyun.log`): candidates unchanged. #40 is **INJECTED#1** (rel 1.497) and #39 **INJECTED#2** (rel 1.026). The reconcile statistics are the same (30 discovered, 25 reconciled).

**T500** (`logs/stage/after/L500-B3-seoyun.log`): #39 enters the relevance lane. #40 is **INJECTED#1** (rel 1.309) and #39 **INJECTED#3** (rel 1.012).

Final block, T500 after:
```
- [T64] [캐릭터 발언(미확정 주장)] “웃으면서 뒤에서 서류 올리는 사람이랑은 밥 같이 안 먹어.”
- [T479] [AI 장면 서술 발췌] “두 사람은 한강 둔치에서 보고서 작성을 했다.”
- [T64] [AI 장면 서술 발췌] “태형은 예의 바르게 웃었지만 의자를 빼 주지는 않았다.”
- [T419] [AI 장면 서술 발췌] “태형은 렌이 독수리 타법으로 한 장을 다 채울 때까지 기다렸다.”
- [T44] [AI 장면 서술 발췌] “그날 태형의 왼쪽 옆구리는 정식으로 열네 바늘 봉합되었다.”
- [T30] [AI 장면 서술 발췌] “발톱이 태형의 왼쪽 옆구리를 꿰뚫었다.”
- [T22] [유저 입력 발췌] “그냥 배정받은 가이드랑 탕후루 먹을 필요 없잖아.”
```

Final block, T150 after:
```
- [T64] [캐릭터 발언(미확정 주장)] “웃으면서 뒤에서 서류 올리는 사람이랑은 밥 같이 안 먹어.”
- [T64] [AI 장면 서술 발췌] “태형은 예의 바르게 웃었지만 의자를 빼 주지는 않았다.”
- [T146] [AI 장면 서술 발췌] “태형은 골목 끝에서 작은 균열을 확인하고 봉인반을 불렀다.”
- [T131] [AI 장면 서술 발췌] “태형은 골목 끝에서 작은 균열을 확인하고 봉인반을 불렀다.”
- [T116] [AI 장면 서술 발췌] “태형은 골목 끝에서 작은 균열을 확인하고 봉인반을 불렀다.”
- [T44] [AI 장면 서술 발췌] “그날 태형의 왼쪽 옆구리는 정식으로 열네 바늘 봉합되었다.”
- [T16] [캐릭터 발언(미확정 주장)] “국장 쪽 사람이야.”
```

Not solved here: T57 #34 (서윤's cake) stays out. Its text says "서윤" and the question says "한서윤", so no query token is contained in the row. It is lexically unreachable, and fixing that needs name/alias normalization (a separate follow-up).

## Deterministic regression (`COMMON-NAME saturation`)

The fixture mirrors B7:
- An old two-row T64 event (`rejected_company`, `opinion_of_seoyun`).
- One state key superseded at T80 (`lunch_partner`; the old value contains "한서윤").
- One distinct state key per turn from T90 to the current turn, each row with "태형" plus one incidental query word ("끝에서" or "사람"). More than 25 candidate state keys, asserted.

| Test | `460adb6d` | branch |
|---|---|---|
| T150: both T64 rows are candidates, both injected at rank ≤ 2, superseded `lunch_partner` not injected, every injected row is the latest of its key | **fail**: "T64 refusal must be injected" | pass |
| T500: same | **fail**: refusal row not in the relevance lane | pass |
| name-only `태형 기억나?`: non-empty, all rows contain 태형, latest state only | pass | pass |
| unrelated `오늘 날씨 좋다.`: T64 rows not injected | pass | pass |

Logs: `logs/tests/common-name-saturation-{before-460adb6d,after}.tap`.

## PRESERVED

- **Episodic suite** (75 files, `logs/tests/episodic-75-files.txt`): before 1105 tests / 13 fail; after 1109 / 13 fail. The failing test names are identical (`logs/tests/episodic-75-files-failing-*.txt`, empty diff). This suite covers:
  - current-state latest-wins
  - cancelled promises
  - source verification
  - delete/regenerate/edit/reset/other-chat boundaries
  - the #1659 correction chains and separate-event preservation
  - the long-horizon perf limit (≤ 4 candidate statements)
- **Link probe** (B8-2 `link-probe.mts`; the correction candidate list uses the same candidate path): output byte-identical before and after (`logs/link-probe/`).
- **Boundary probe** (B8-2 `boundary-probe.mts`: chains 1–10, one correction then 210 others, user/scene narrators, 10,600-row chat): content identical in 3/3 runs, timings aside. Statements per call 6 → 6 (`logs/boundary/`).
- **Full regular suite**: no failure attributable to this change; see "Checks".

## 26 B7 probes (`logs/probes-compare.md`)

Sequential, quiet machine, same rebuilt snapshots and memory blocks, `run-probes.sh` from each revision:
- Targets newly injected: L150-B3 and L500-B3 (both T64 rows); X500-yeom-occupation (T267, T312, T313 염태오 rows; see the fidelity note).
- Order only, same lines: A4 ×3, A5 ×3, C3, T80/T90-B3, X500-current-injury.
- L500-A4-stone: T4 stone injected at #2 instead of #3. Non-target lines: T57 cake and T320 in, T403 out.
- X500-night-watch and X500-measurement: one line in, one out (see regression risks 1 and 2).
- Unchanged blocks: 10 probes.

| Total over 26 probes | before | after |
|---|---|---|
| prepared statements per call (sum) | 685 | 682 |
| avg ms per call (sum of 50-call averages) | 177.5 | 178.1 |
| block chars (sum / max) | 24,828 / 1,097 | 24,873 / 1,086 |
| injected rows | 124 | 123 |

Per-probe statements are unchanged except X500-measurement 25 → 26 and X500-yeom 32 → 28. Those are reconcile key lookups, which vary with which keys are preferred, still capped at 25.

## Cost

- Provider/embedding calls: 0. Production DB writes: 0. No schema change.
- Statements: candidate fetch unchanged (the df counts ride on the relevance-lane statement). Boundary probe 6 → 6 per call.
- Time: the lane statement now aggregates df over the recall scope and carries one 0/1 column per query word.
  - 10,600-row chat (horizon 3000): 49.8 → 58.4 ms average over 3 runs.
  - 1,209-row chat: 8.7 → 9.1 ms.
  - 441-row B7 probes: total unchanged within noise.
  - Precomputing idf once instead of per row made no measurable difference, so it was not kept.
- Prompt size: unchanged budgets; block size is within the existing ~1000-char Episodic budget.

## Regression risks for review

1. **A rare generic word can outrank the topic word.**
   - Case: X500-night-watch, `같이 야간 당직 섰던 거 기억나?` (`logs/stage/{before-460adb6d,after}/X500-night-watch.log`).
   - "같이" appears in 2 of 441 rows, one of them T64's quote "밥 같이 안 먹어", and "당직" in none. "야간" appears in 15 rows, giving weight 0.647.
   - The unrelated T64 line now ranks #1 and T348 (옥상 야간 대기) drops at the char budget; 6 of 7 lines are still night-watch.
   - Before, every row tied at relevance 1 and recency decided.
   - This is inherent to frequency weighting without word lists, which the ticket rules out.
   - Options, if review wants it addressed as a follow-up: discount matches found only in the evidence quote; or a coverage term that favours rows matching more of the query's present words. Neither is done here.
2. **Same observation, older row.** X500-measurement `요즘 가이딩 측정 수치는 어때?`: T266 contains "수치" (rare), T447 does not. T266 now replaces T447, the same 80% observation one row older; before, both capped at relevance 2 and recency picked T447.
3. **Weak-relevance fill.** When the distinctive rows are few, the rest of the block is filled by rows whose only match is the common name (relevance ≈ 0.01), ordered by importance and recency. At T500 B3 these are T44/T30/T22 instead of recent T470s rows. Before, the block was all recent name-only rows.
4. **Cost** grows with chat size (about +8 ms at 10,600 rows).

## Checks

- `git diff --check` on every commit (`460adb6d..HEAD`): clean.
- `npm run lint`, `npm run typecheck:app`: pass.
- `npm run test:regular`, run sequentially on both revisions (`logs/tests/regular-summary.txt`):
  - `460adb6d`: 13,726 tests, 327 fail. Branch: 13,730 tests, 305 fail.
  - The failing sets differ only in unrelated areas: S4 variants, refunds and billing fail only before; investigation, persona secrets and world shares fail only after.
  - The 12 files behind the after-only failures pass 208/208 when rerun alone on the branch. These are full-run flakes, not changes. Everything else is the same pre-existing set.
- `memory-episodic-long-horizon.test.ts`: 54/54, including the perf limit of ≤ 4 candidate statements.

## Excluded (per ticket)

Gemini distortion, Global compression cost, repetition counts, promise completion, paid 1000-turn eval, #1591. Not changed: T57 alias reachability; extraction gaps (for example the T12 row B7 never stored).

## Reproduce

```bash
# rebuild a snapshot (B7 evidence branch checked out at $B7)
node --conditions=react-server --import tsx rebuild-b7-snapshot.mts "$B7" 500 known-keys.json known-quotes.json /tmp/b7r/snap-500/app.db
# stages for one question
node --conditions=react-server --import tsx stage-probe.mts /tmp/b7r/snap-500/app.db \
  '(복도 끝에서 한서윤이 서류를 안고 다가오는 걸 보고 태형의 소매를 잡아끈다) 저 사람 또 왔어.' '서윤|서류를 올리는' \
  /tmp/b7r/memory-blocks/L500-B3-seoyun.memory-block.txt
# 26 probes
bash ../pr-b8-2-episodic-independent-event/run-probes.sh /tmp/b7r <out dir>
```

Run from a checkout root (or a worktree with `node_modules` linked) so `@/` resolves to that revision's `src`.
