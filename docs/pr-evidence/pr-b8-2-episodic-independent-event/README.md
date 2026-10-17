# B8-2 evidence: Episodic independent past events, recovery, and user correction

This PR changes how the shared Episodic path decides that a later user statement corrects an earlier record. Rounds 1–3 are unchanged in intent and summarized under PRESERVED and the round 3 recap. This README describes **round 4**, the response to GPT's review of `8124ca8f`.

Round 4 scope is fixed to three issues: (③) long correction chains, (④) correction validity independent of how many other corrections exist, (⑤) user-stated events preserved like scene events. Zero provider calls this round; the round 3 live extraction evidence is reused. No new store, no schema or migration, no new prompt sentence, no production DB change, no merge or deploy.

## SHAs

- Base / merge-base: `0a086447`. Main checked at the start of this round: `e808831f` (unchanged; owners unchanged).
- Reviewed head: `8124ca8f`. Round 4 commits:
  - `f3d36428`: a correction chain is grouped by its stored root, with no count or depth bound (③, ④)
  - `6aa78999`: a verified first-hand occurrence is history whoever narrated it; standing values keep latest-wins (⑤)
  - `492a1273`: regression tests for the three boundaries through the real save path
  - evidence commit (this README, `boundary-probe.mts`, `classify-dump.mts`, `logs/boundary/`, `logs/probes-round4/`, `logs/tests/*round4*`, `logs/link-probe/round4-492a1273.log`)

## Changed files (round 4)

| File | Change |
|---|---|
| `src/lib/memory/memory-episodic-correction.ts` | `EpisodicCorrectionLink` gains `root_fact_id` / `root_source_turn`. The reader defaults a missing root to the target and rejects a root later than the target |
| `src/lib/episodicMemoryFacts.ts` | Save: the root is copied from the target's own valid link (else the target). Recall: `createEpisodicCorrectionResolver` replaces `resolveEpisodicCorrectionLinks`; `substituteEpisodicCorrections` uses it. `EPISODIC_CORRECTION_LINK_SCAN_LIMIT = 200` and `EPISODIC_CORRECTION_CHAIN_MAX_DEPTH = 3` are deleted. Reconcile closure uses `isVerifiedFirstHandRecord` |
| `src/lib/episodicMemoryTemporal.ts` | `isVerifiedFirstHandRecord` and `statesStandingValue` replace `isVerifiedSceneRecord` and `isUserStatedOccurrence` |
| Tests | `memory-episodic-past-event-slots.test.ts` (+18), `memory-episodic-correction.test.ts` (+1, 1 changed), `episodicMemoryTemporal.test.ts` (2 rewritten, see REMOVED) |

## BEFORE (`8124ca8f`)

All cases run through the production save path: the server lists its candidates, the simulated model copies a handle, `parseSharedEpisodicSection` parses it, `reconcileEpisodicMemoryFactsForGeneration` saves it, and `getEpisodicMemoryForPrompt` builds the block at T500/T1000.

**③ Chain R → C1 → C2 → C3 → C4** (each correction targets the record the server offers, i.e. the previous one). At T1000, `logs/boundary/before-8124ca8f.log`:

```
id=30  T30  injury       explicit_scene_event    CURRENT_SCENE correction=null
id=120 T120 injury_cause explicit_user_statement USER_EXPLICIT correction={"target_fact_id":30,"target_source_turn":30}
id=121 T140 injury_cause explicit_user_statement USER_EXPLICIT correction={"target_fact_id":120,"target_source_turn":120}
id=122 T160 injury_cause explicit_user_statement USER_EXPLICIT correction={"target_fact_id":121,"target_source_turn":140}
id=123 T180 injury_cause explicit_user_statement USER_EXPLICIT correction={"target_fact_id":122,"target_source_turn":160}
final block @T1000 q="예전에 에녹 왼팔은 왜 다쳤었지?":
  - [T180] [유저 입력 발췌] “그 부상은 사실 울타리에 다친 거야.”
  - [T160] [유저 입력 발췌] “그 부상은 사실 낙석에 다친 거야.”      ← C3 resurfaced
```

With 10 corrections the block holds C10 and C3 (`녹슨 못` + `낙석`).

**④ One correction, then 211 corrections of other events** (marker k is a scene record; the user corrects marker k−1 each turn). At T1000:

```
final block @T1000 q="예전에 에녹 왼팔은 왜 다쳤었지?":
  - [T30] [AI 장면 서술 발췌] “늑대가 에녹의 왼팔을 깊이 물어뜯었다.”   ← wrong original resurrected
  - [T120] [유저 입력 발췌] “그 부상은 사실 창틀에 다친 거야.”
```

**⑤ First event stored as `explicit_user_statement` (USER_EXPLICIT), separate second injury on the same `injury` key.** user → user, at T1000:

```
id=30  T30  injury explicit_user_statement USER_EXPLICIT correction=null
id=200 T200 injury explicit_user_statement USER_EXPLICIT correction=null
final block @T1000 q="예전에 에녹 왼팔은 왜 다쳤었지?":
  - [T200] [유저 입력 발췌] “어제 훈련하다 칼에 오른손을 베였잖아.”     ← T30 replaced
```

user → scene fails the same way; scene → scene and scene → user pass. Both gloss wordings behave the same.

New tests on `8124ca8f` (`logs/tests/new-boundary-tests-before-8124ca8f.tap`): **91 tests, 81 pass, 10 fail**:

| Failing test | Assertion |
|---|---|
| stored rows (link carries the root) | link lacks `root_fact_id` / `root_source_turn` |
| long chains 1/3/4/10, T500 and T1000 | `4 corrections: correction 3 resurfaced` |
| server offers the latest correction | `correction 1` (no root) |
| removing a middle correction | `correction 1` resurfaced |
| a correction stays in force after 210 later corrections | `T500`: T30 back |
| user → scene, user → user (× 2 glosses) | `T500 first`: T30 missing |

## ROOT CAUSE

1. **③ Chain depth was a loop bound.** `resolveEpisodicCorrectionLinks` climbed to the root and walked down to the stand-in with two loops bounded by `EPISODIC_CORRECTION_CHAIN_MAX_DEPTH = 3`. From C4 the climb stopped at C1, which made C1 a second root whose stand-in was C3. So the walk produced two stand-ins, C3 and C4.
2. **④ The link scan read the latest 200 corrections in the whole chat.** `ORDER BY source_turn DESC LIMIT 200` ignored the candidates being resolved. After 200 corrections of other events, the link from T120 to T30 was no longer read, and T30 came back as a normal record.
3. **⑤ Narrator decided the nature of the record.** `classifyEpisodicFactTemporalNature` promoted only `explicit_scene_event` rows to `historical_event`, and the #1651 closure (`isVerifiedSceneRecord`) only kept scene rows. `isUserStatedOccurrence` let a user statement close earlier scene rows, but the statement itself stayed state. A later row of the same key then replaced it, whoever narrated that later row.

## AFTER

### ③ ④ One owner for "which corrections belong to this event": the stored root

- **Save.** `resolveEpisodicCorrectionLinkForSave` already loads the target in scope. It now also reads the target's own valid link and stores `root_fact_id` / `root_source_turn` = the target's root, else the target itself. Every correction of one event shares one root, whatever the chain length.
- **Recall.** `createEpisodicCorrectionResolver(db, scope).cover(rows)` gives each candidate one group key: its stored root if it is a valid correction, else itself. One query in `scope.baseWhere` reads exactly the corrections stored under those roots:

  ```sql
  … AND source_turn > ?minRootTurn
    AND COALESCE(json_extract(metadata,'$.correction.root_fact_id'),
                 json_extract(metadata,'$.correction.target_fact_id')) IN (?rootIds)
  ```

  A primary-key read in scope loads any root that is not a candidate. Members still need a valid link (user `USER_EXPLICIT` quote, target earlier), and their root key must match by id **and** turn. The latest member by `(source_turn, id)` is the stand-in. There is no count or depth bound, so the chain ends where the stored `source_turn` order ends.
- **Root alive** (it exists in scope at `root_source_turn` and passes the guard): reconcile sees the root and keeps its standing. The root is then replaced by the stand-in, and a corrected past occurrence stays a past occurrence.
- **Root gone** (deleted, regenerated, before a memory reset, or guard-blocked): the stand-in stands as an ordinary record and the earlier members stay hidden.
- Rows that reconcile introduces are covered by a second `cover` call before substitution. A stand-in owned by RAW or blocked by the guard removes its group without injecting anything (unchanged).
- **Processing limit.** None exists in this path. Candidate max 6 (`EPISODIC_CORRECTION_CANDIDATE_LIMIT`) only bounds what the extractor is shown each turn; it does not bound stored link validity.

AFTER on the same scenarios (`logs/boundary/after-492a1273.log`):

```
id=30  T30  injury       explicit_scene_event    CURRENT_SCENE correction=null
id=120 T120 injury_cause … correction={"target_fact_id":30,"target_source_turn":30,"root_fact_id":30,"root_source_turn":30}
id=121 T140 injury_cause … correction={"target_fact_id":120,"target_source_turn":120,"root_fact_id":30,"root_source_turn":30}
id=122 T160 injury_cause … correction={"target_fact_id":121,"target_source_turn":140,"root_fact_id":30,"root_source_turn":30}
id=123 T180 injury_cause … correction={"target_fact_id":122,"target_source_turn":160,"root_fact_id":30,"root_source_turn":30}
final block @T1000 q="예전에 에녹 왼팔은 왜 다쳤었지?":
  - [T180] [유저 입력 발췌] “그 부상은 사실 울타리에 다친 거야.”
  (+7 filler lines)

chain of 10 @T1000:            - [T300] [유저 입력 발췌] “그 부상은 사실 녹슨 못에 다친 거야.”   (only)
1 correction + 211 others:     - [T120] [유저 입력 발췌] “그 부상은 사실 창틀에 다친 거야.”      (only; T30 absent)
10,600-row chat, chain 10 + 301 others @T3000:  - [T300] … “녹슨 못” (only)
```

### ⑤ One owner for narrator authority vs. event/state nature

- `isVerifiedFirstHandRecord(fact)`: the server verified the record first-hand. That is a verified `explicit_scene_event` quote, or the user's own `explicit_user_statement` with `USER_EXPLICIT`. Character claims never count. The classifier promotes to `historical_event`, and the reconcile closure keeps a row, on this single predicate, so the narrator no longer decides either.
- `statesStandingValue(fact)` keeps latest-wins for standing values, for **either** narrator. It matches a key naming status / state / condition / job / occupation / role / position / title / affiliation / member / location / residence / current relationship, or a gloss that only says what someone was presented as (`…으로 소개/언급/등장되었다`). So not every user past tense becomes a permanent event: "카페에서 일했다" under `past_job` and "구급대원으로 언급되었다" under `occupation` stay latest-wins.

AFTER, user → user at T1000:

```
id=30  T30  injury explicit_user_statement USER_EXPLICIT correction=null
id=200 T200 injury explicit_user_statement USER_EXPLICIT correction=null
final block @T1000 q="예전에 에녹 왼팔은 왜 다쳤었지?":
  - [T30] [유저 입력 발췌] “지난번에 늑대가 네 왼팔을 깊이 물어뜯었잖아.”
  - [T200] [유저 입력 발췌] “어제 훈련하다 칼에 오른손을 베였잖아.”
final block @T1000 q="에녹 오른손은 왜 다쳤었지?":
  - [T200] [유저 입력 발췌] “어제 훈련하다 칼에 오른손을 베였잖아.”
  - [T30] [유저 입력 발췌] “지난번에 늑대가 네 왼팔을 깊이 물어뜯었잖아.”
```

All 8 narrator runs (4 combinations × 2 glosses) pass at T500 and T1000. The first event is really stored as `explicit_user_statement` with `USER_EXPLICIT`, and the test asserts the stored type and authority.

### Effect on real data (B7 500-turn snapshot, 441 rows, classifier only)

18 rows change class (`classify-dump.mts` run in both checkouts; diff in `logs/boundary/b7-snap500-classification-diff.txt`; the snapshot itself is not committed):

- **6 user rows become `historical_event`**, all genuine events: T22 야시장 cancellation, T69 praise in a briefing, T82 the instructor changed, and the T313 / T393 / T449 visits.
- **12 scene rows become latest-wins**: repeated identity glosses (`서다온은 연구국 인턴으로 소개되었다` ×5, `염태오는 에지카 구급대원으로 소개/언급/등장했다` ×5, `유하람은 신입 가이드로 소개되었다`), and one action the extractor filed under `occupation_claim`. These used to pile up as separate "events".
- Unchanged by design: `차세린은 리컨 유닛 소속으로 언급되었다` (`member`) and `박철은 정비팀 소속으로 언급되었다` (`work_team`, caught by the gloss) stay latest-wins. A key-token-only rule that included `team` was tried and rejected: it also demoted the genuine event T214 `called_seal_team` ("봉인반을 불렀다").

## REMOVED

| Removed | Why it is safe |
|---|---|
| `EPISODIC_CORRECTION_LINK_SCAN_LIMIT = 200` and the latest-200 scan | The cause of ④. Replaced by the root query bound to the current candidates, not by a larger number |
| `EPISODIC_CORRECTION_CHAIN_MAX_DEPTH = 3` and both bounded loops | The cause of ③. The stored root makes a walk unnecessary |
| `resolveEpisodicCorrectionLinks`, `EpisodicCorrectionLinks` (`rootIdByCorrectionId` / `standInByRootId`) | Replaced in place by `createEpisodicCorrectionResolver`. No other reader |
| `isVerifiedSceneRecord`, `isUserStatedOccurrence` (`episodicMemoryTemporal.ts`) | Replaced by `isVerifiedFirstHandRecord` + `statesStandingValue`. Their only readers were the classifier and the reconcile closure |
| Changed test: `episodicMemoryTemporal` "a legacy row, a character claim or another evidence type is not promoted" | Its user case "유저는 카페에서 일했다." under `injury` asserted that **any** user statement stays state. That was the narrator rule being fixed. The same sentence is now asserted latest-wins under `past_job`, by the standing-value rule. A non-first-hand evidence-type case was added |
| Changed test: "a user's verified statement … closes, not history" | Asserted `isUserStatedOccurrence` and that a user occurrence is not history, which is the ⑤ bug. Rewritten as classifier cases: user event → history; state gloss, unverified, character claim and assistant authority → not; standing values → latest-wins for both narrators |
| Changed expectation: stored link shape (`stored rows` test, `counts only with a verified user quote`) | The link now carries `root_fact_id` / `root_source_turn`. A new test pins the default (missing root = target) and rejects a root later than its target |

The round 3 fixtures run on round 4 code give 94/98 (`logs/tests/round3-fixtures-on-492a1273.tap`). The 4 failures are exactly the changed tests listed here.

## PRESERVED

- **Explicit correction link, real extraction linking, T30 restoration, #1651 state-gloss preservation.** The link contract, prompt line and candidate list are untouched. `link-probe.mts`: 38/38 PASS (`logs/link-probe/round4-492a1273.log`); the only differences from round 3 are the root fields and B/C now also listing the user-told right-hand event next to T30. The B7 T30 flank cause stays injected at L500-A5 (`- [T30] [AI 장면 서술 발췌] “발톱이 태형의 왼쪽 옆구리를 꿰뚫었다.”`).
- **Delete / regenerate / source edit / reset / other chat.** Tested on a 4-correction chain:
  - Deleting, regenerating or editing the latest correction makes the previous one current, and the C4 quote is gone.
  - Removing a middle correction keeps C4.
  - Removing the original leaves C4 as an ordinary record.
  - After a memory reset at T150 only C4 remains (R, C1 and C2 are out of scope).
  - Moving the chain to another chat leaves chat 1 with the original only.
  - Round 3's single-correction boundary tests pass unchanged.
- **Normal latest-wins.** State, preference, job and current relationship keep latest-wins: the round 1–3 tests, the `memory-b2-source-lineage` cancel test, and the new "user's standing value stays latest-wins" test (`occupation`, `past_job`).
- **Budgets.** Global 10,000 chars, Episodic 8 facts / 1,000 chars, the RP 3,200+ target and no output cap are untouched. B7 block chars ≤ 1,099 (identical to round 3 for every probe).

## REGRESSION RISKS (for GPT review)

1. **The standing-value rule is vocabulary.** The key tokens and the presented-as gloss are generic, but a standing value filed under an unlisted key with a completed-change gloss (e.g. `instructor` "교관이 바뀌었다", B7 T82) is now an event for either narrator. That is the existing scene behavior, now narrator-independent. The opposite error, an event under a standing key, keeps latest-wins (B7 T479, misfiled by the extractor).
2. **Scene identity rows changed class.** 12 B7 scene rows that were `historical_event` are now latest-wins. On B7 this changed one decision: T398 moves from `DROPPED(max_facts)` to `RECONCILED_OUT`. The block is identical. It also changed one ordering: T22 sits two lines higher in T80-B3 and T90-B3, same content.
3. **More user rows reach the milestone lane.** A user-told event that is now history can win an important-milestone slot. On B7 that is T22, so `milestone_important` goes 5 → 6 in every probe, and injected content is unchanged.
4. **The root query reads the chat range after the oldest candidate root.** `json_extract` is evaluated per row over `(chat_id, source_turn)` index range, like the old scan, which read the whole chat whenever fewer than 200 links existed. Measured cost is in PROOF. An expression index on the root would be a schema change; it is reported as an option and was not added.
5. **Rows written before round 4 have no root.** The reader then defaults root = target, so a pre-round-4 chain of 2+ would split into groups. No such rows exist outside this Draft (round 3 never shipped).

## PROOF

### Fail-before / pass-after for the new boundaries

| Evidence | `8124ca8f` | `492a1273` |
|---|---|---|
| New boundary tests (`memory-episodic-past-event-slots.test.ts`, final version) | 91 / 81 pass / **10 fail** | 91 / **91 pass** / 0 fail |
| `boundary-probe.mts`: chain 1 / 3 / 4 / 10 at T500 and T1000 | 4 / 8 ok (4 and 10 fail) | 8 / 8 ok |
| `boundary-probe.mts`: 1 correction + 211 others at T500 and T1000 | 0 / 2 ok | 2 / 2 ok |
| `boundary-probe.mts`: 10,600-row chat, chain 10 + 301 others at T3000 | fail (T30 back) | ok |
| `boundary-probe.mts`: narrator 4 combinations × 2 glosses | 4 / 8 ok (user-first fail) | 8 / 8 ok |

### Fixture and related tests

- Fixture set (`episodicMemoryTemporal`, `memory-episodic-past-event-slots`, `memory-episodic-correction`): **116/116 pass** (`logs/tests/fixture-round4-492a1273.tap`). That is the 98 from round 3 (4 updated as listed under REMOVED) plus 18 new.
- Related regression set (84 files, one invocation, fresh `DATA_DIR`, keys stripped by `regularTestEgressPolicy`):

| Tree | Tests | Pass | Fail |
|---|---|---|---|
| main `e808831f` | 1,026 | 1,006 | 20 |
| round 3 `b1982cee` | 1,087 | 1,067 | 20 |
| round 4 `492a1273` | 1,105 | 1,085 | 20 |

The 20 failing leaf tests are identical on all three (`logs/tests/related-round4-492a1273.summary.txt`). The causes are pre-existing, as described in round 3.

### Query volume and time (`logs/boundary/performance.md`)

Prepared statements per `getEpisodicMemoryForPrompt` call and average time. Both trees were measured in the same session on the same machine.

| Scenario | statements `8124ca8f` → `492a1273` | avg ms `8124ca8f` → `492a1273` |
|---|---|---|
| chain 4, T1000 (923 rows) | 7 → 6 | 7.98 → 7.09 |
| chain 10, T1000 (809 rows) | 7 → 6 | 7.29 → 6.35 |
| 1 + 211 corrections, T1000 (1,209 rows) | 8 → 6 | 11.89 → 8.61 |
| 10,600-row chat, T3000 | 8 → 6 | 56.43 → 50.89 |
| B7 26 probes (no corrections), mean | 27.65 → 27.00 | 6.35 → 6.74 |

The resolver issues one root query per `cover` with uncovered keys, plus a primary-key read only when a root is not a candidate. On B7, which has no corrections, round 4 costs about +0.4 ms per call (mostly the second root read after reconcile). Statements per call move by −3 to +1 per probe.

### B7 replay (0 provider calls)

`run-probes.sh /tmp/b7 logs/probes-round4`: 26 probes. Apart from the summary line, the blocks match round 3 (`logs/probes-after/`) in 24 probes. The other 2 (T80-B3, T90-B3) contain the same lines with T22 two lines higher. Per-row placement differs in one probe: X500-yeom-occupation, T398, Risk 2.

### Static checks

`git diff --check` clean; `npm run lint` and `npm run typecheck:app` pass (also at `f3d36428` alone).

## Round 3 recap (unchanged; evidence reused)

- **Contract.** The server offers up to 6 records as handles `C1`..`C6` in the existing Shared Initial user block. `corrects` is a required enum; the parser maps handles back to fact ids. One prompt line replaced the old "NEVER generate source_turn, id…" line.
- **Save.** A link is stored only for a user `USER_EXPLICIT` verified quote whose target is earlier and in the same chat/character/user/reset scope.
- **Live extraction** (`logs/live/`, `call-ledger.json`): `gpt-6-luna`, 11 calls, about 1.66 KRW. 4/4 explicit corrections linked `C1`, 0/5 non-corrections linked, and main stored no correction at all.
- **Link probe.** `logs/link-probe/{main-e808831f,prev-71e39dff,fix-b1982cee}.log`: 21/38 → 21/38 → 38/38.

## LIMITS / FOLLOW-UPS (not in this PR)

- **팔 / 왼팔 candidate miss.** Lexical candidate discovery: "팔은 이제 괜찮아?" offers no record about "왼팔", so such a correction cannot link and nothing is invalidated.
- **New right-hand event not extracted live** (round 3 S3, 2/2): extraction recall for user-told past events.
- **The standalone (fallback) extractor has no candidate list**, so it never writes a link.
- **Pre-round-4 links without a root** default to root = target (Risk 5).
- **Expression index on the correction root.** An option if the root query ever shows up at scale; it needs a schema change, so it is not added here.
- **Passive `…였다` endings** are read as copula past (`looksLikeCompletedOccurrence`).
- Round 2 follow-ups still open: injection diversity for repeats, 25-key cap saturation, promise completion, 1000-turn real-RP verification, #1591 (untouched).
