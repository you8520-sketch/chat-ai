# B8-2 evidence: Episodic independent past events, recovery, and user correction

This PR fixes record selection in the shared Episodic retrieval path. It does not change model behavior and does not fix Gemini's fabrication (B8-1). Everything here is synthetic or replayed B7 data with **0 provider calls and 0 production DB writes**. It is not an RP quality pass; GPT judges RP quality.

This README covers two rounds:

- **Round 1 (`7e8f86a9`)**: an independent past occurrence (B7 T30 flank injury) was dropped by same-key latest-wins.
- **Round 2 (this update, `e7d03be2`)**: GPT review of `0a279116` found that round 1 made a verified scene record immune to the user's explicit correction (BLOCKER), and that removing the #1651 closure lost a cause whose gloss is worded as a state (RELATED). Both are fixed. Round 1's B7 result is unchanged.

## SHAs

- Base: `0a0864472d91a3837c7c25a01e63d150a1f6ee30`.
- Main at the time of this update: `e808831f` (#1660). Production (Railway, read-only check): `b5d63d9` (#1654). Neither commit after the base touches `src/lib/episodicMemory*`, `src/lib/memory/` or the chat route's memory code, and the branch merges into main without conflicts.
- Reviewed head: `0a279116`. New fix commit: `e7d03be2`.
- B7 data: the isolated eval snapshots from `cursor/b7-real-rp-memory-eval-c504` (`snap-50/80/90/150/500/app.db`, plus memory blocks `docs/pr-evidence/pr-b7-real-rp-memory-eval/memory-blocks/`). The snapshots are not committed.

## Changed files (vs main)

| File | Change |
|---|---|
| `src/lib/episodicMemoryTemporal.ts` | Canonical classifier. Round 1: a verified scene record whose gloss closes on a past-tense action is `historical_event`. Round 2: exports `isVerifiedSceneRecord` (moved here from the facts module) and `isUserCorrectableSceneRecord` |
| `src/lib/episodicMemoryFacts.ts` | `reconcileGlobalStateLikeFacts` gains the user-correction lookup. The #1651 closure is kept (it was removed in round 1 and is restored) |
| `src/lib/episodicMemoryTemporal.test.ts` | Classifier cases |
| `src/lib/memory/memory-episodic-past-event-slots.test.ts` | B7-format fixture, the correction fixture (production save path), and the #1651 gloss fixture |
| `docs/pr-evidence/pr-b8-2-episodic-independent-event/` | Probes, runner, logs, this README |

## BEFORE

### Round 1: B7 T30 dropped (main)

In the B7 T500 history, these rows are all `explicit_scene_event`, with a quote verified against the assistant message (`CURRENT_SCENE`):

| Row | Turn | Key | Gloss | Verified quote |
|---|---|---|---|---|
| 23 | T30 | `character:taehyung:injury` (important) | 태형은 진화형 크리처의 발톱에 왼쪽 옆구리를 찔렸다. | 발톱이 태형의 왼쪽 옆구리를 꿰뚫었다. |
| 29 | T44 | `…:injury_treatment` (important) | 태형은 왼쪽 옆구리 상처를 열네 바늘로 봉합받았다. | 그날 태형의 왼쪽 옆구리는 정식으로 열네 바늘 봉합되었다. |
| 33 | T55 | `…:medical_recovery` (normal) | 태형은 왼쪽 옆구리 부상에서 완전히 회복되어 현장 복귀 허가를 받았다. | 오늘부터 현장 복귀 허가합니다. |
| 270 | T312 | `…:injury` (normal) | 태형은 순찰 중 계단에서 미끄러져 오른쪽 발목을 접질렀다. | 태형은 계단 모서리에서 미끄러지며 오른쪽 발목을 접질렀다. |

For L500-A5 ("옆구리 다친 건 이제 다 나은 거지? 그때 왜 다쳤었지?") on main, T30 is `RECONCILED_OUT`, and the final block has T44, T55, T48, T33 and two claims, but no cause.

### Round 2: mixed-source correction (reviewed head `0a279116`)

Stored rows, written through the production save path (`persistEpisodicMemoryFactsCore` with `evidenceBinding`, which checks each quote against the stored message). Output of `correction-probe.mts`, scenario S1:

```
id=1 T30  injury=left_arm_bitten          explicit_scene_event    role=assistant authority=CURRENT_SCENE message_id=302  quote=“늑대가 에녹의 왼팔을 깊이 물어뜯었다.”
id=2 T120 injury=left_arm_caught_in_door  explicit_user_statement role=user      authority=USER_EXPLICIT message_id=1201 quote=“늑대에게 물린 게 아니라 문에 팔이 끼인 거야.”
```

The T120 user message is "아까 그 부상 장면 정정할게. 늑대에게 물린 게 아니라 문에 팔이 끼인 거야. 같은 사건이야." At turn 500 and 1000, both far outside RAW, the question "예전에 에녹 왼팔은 왜 다쳤었지?" (which does not restate the correction) produced this block on `0a279116`:

```
- [T30] [AI 장면 서술 발췌] “늑대가 에녹의 왼팔을 깊이 물어뜯었다.”
- [T120] [유저 입력 발췌] “늑대에게 물린 게 아니라 문에 팔이 끼인 거야.”
```

The corrected wolf cause is injected as a valid record next to its correction.

Same-source gloss wording (RELATED, #1651): with T30 glossed "에녹의 왼팔에는 늑대에게 물린 상처가 남아 있다." (state wording, same verified quote) and a T80 same-key recovery, `0a279116` drops T30 (the cause is lost), while main keeps it through the #1651 closure.

## ROOT CAUSE

- **Round 1.** `classifyEpisodicFactTemporalNature` returned `unknown` (state-like) for verified occurrences filed under free-form keys (`injury`). Stage 1 (`reconcileGlobalStateLikeFacts`) replaced them with the key's DB-latest state row, T312 the ankle. The #1651 closure only fired when the closing row matched a narrow recovery regex under the same key. B7's recovery was `medical_recovery` (another key) with different morphology.
- **Round 2, BLOCKER.** Round 1 made the classifier's new rule (verified scene record + past-tense gloss → `historical_event`) unconditional. Historical rows skip both latest-wins stages, so no later row of the key could replace the record, including the user's explicit correction of the same event. Main handled S1 by latest-wins. It failed when a same-key historical recovery sat between the record and the correction (S2), because the #1651 closure kept the record.
- **Round 2, RELATED.** Round 1 removed the #1651 closure on the assumption that the new rule covered it. The rule requires a past-tense ending, so a state-worded gloss ("…상처가 남아 있다") stayed state-like and was replaced by the later same-key recovery. The removal was not covered.

## AFTER

Ownership: the classifier (`episodicMemoryTemporal.ts`) answers "is this a verified scene record, and can a user correct it". Stage 1 (`reconcileGlobalStateLikeFacts`) remains the single owner of same-key replacement. No new store, no LLM judge, no external call, no new prompt text, and no cap change.

1. **A user correction replaces a verified scene record.** A verified scene record whose intrinsic nature is `unknown` is corrected when the same logical key (`category:subject:attribute`) has a later row with `memory_evidence_type = explicit_user_statement` and verified evidence authority `USER_EXPLICIT`, within the same scope (chat, character/user, reset boundary, `source_turn < currentTurn`). A corrected record is state-like again, so the key's latest allowed state row replaces it. That is the correction itself, or a later state row. One scoped query per recall, only when a correctable candidate exists.
   - A later scene occurrence never corrects (T312 ankle keeps T30).
   - A user statement before the record never corrects.
   - A user's scene action (`explicit_scene_event` with `USER_EXPLICIT`) is not a statement and does not correct.
   - Intrinsically historical rows (fixed attributes `action`, `response`, `scene_event`, `encounter_event`, `role_direction`, or the completed-recovery regex) are unchanged from main and not correctable.
2. **The #1651 closure is restored.** A verified scene record that is still state-like and not corrected is kept as history when a later historical row of its key exists. This applies whether that row is a candidate or the guard-allowed DB-latest row.

S1 after the fix, at turn 500 and at turn 1000:

```
- [T120] [유저 입력 발췌] “늑대에게 물린 게 아니라 문에 팔이 끼인 거야.”
```

After the correction turn is deleted (`deleteEpisodicMemoryFactsByAssistantMessageIds` for assistant message 1202), T30 returns:

```
- [T30] [AI 장면 서술 발췌] “늑대가 에녹의 왼팔을 깊이 물어뜯었다.”
```

S2 (T30 bite, T80 same-key recovery, T120 correction) at turn 500:

```
- [T80] [AI 장면 서술 발췌] “치료를 마친 에녹의 왼팔은 완전히 회복되었다.”
- [T120] [유저 입력 발췌] “늑대에게 물린 게 아니라 문에 팔이 끼인 거야.”
```

On main, S2 also injects the T30 wolf bite (closure). On `0a279116`, S2 also injects it (historical).

S4 (#1651 gloss, no correction), for both "에녹은 늑대에게 물려 왼팔을 크게 다쳤다." and "왼팔에는 늑대에게 물린 상처가 남아 있다.":

```
- [T80] [AI 장면 서술 발췌] “치료를 마친 에녹의 왼팔은 완전히 회복되었다.”
- [T30] [AI 장면 서술 발췌] “늑대가 에녹의 왼팔을 깊이 물어뜯었다.”
```

Full output for all three trees: `logs/correction-probe/{main-0a086447,prev-0a279116,fix}.log`.

The B7 T30 result is unchanged from round 1. L500-A5 still injects `- [T30] [AI 장면 서술 발췌] “발톱이 태형의 왼쪽 옆구리를 꿰뚫었다.”`. B7 has no user corrections, and the injected content of all 26 B7 probes is identical to `0a279116` (only timing and the statement count differ).

## REMOVED

| Removed | Reader | Coverage |
|---|---|---|
| `isVerifiedSceneOccurrence()` in `episodicMemoryFacts.ts` | The #1651 closure | Same predicate, moved to the classifier as `isVerifiedSceneRecord()` and used by the closure, the classifier rule and the correction lookup. One owner |
| (round 1) the #1651 closure | — | **Restored in round 2.** Round 1's removal was not covered for state-worded glosses (S4) |
| (round 1) test "a guard-blocked completed row does not close the state …", rewritten as "a guard-blocked latest is never recalled and no older state resurfaces past it" | Test only | The protected invariant is still pinned: a blocked latest is never recalled and an older state-shaped row does not resurface |

Nothing else is removed. The `normalizeRetrievalToken` change and the B6-2 same-evidence dedupe from #1651 are untouched.

## PRESERVED

- **Independent past events.** T30 flank and T312 ankle are both kept and each keeps its own turn (B7 fixture at 500 and 1000, and S3).
- **Recovery.** A T30 → T55 recovery under another key keeps T30. A same-key recovery (T80) keeps T30 for both gloss wordings (S4), and the recovery still leads for current-state questions.
- **State latest-wins.** Job, location and preference rows under a verified source still collapse to the latest (new test). Present-tense and copula-past glosses, legacy rows without a verified quote, and character claims are unchanged. On B7, the occupation key for 염태오 does not pile up (`X500-yeom-occupation`: one occupation line injected).
- **Source authority.** Verified rows render only their quote with the server label. Character claims are never promoted, and they never correct or get corrected.
- **Boundaries.** Deleting or regenerating the correction turn restores the record. A correction in another chat has no effect. Reset (`memory_reset_after_message_id`) and `source_turn < currentTurn` are part of the correction query's scope.
- **Current injury wording.** For "지금 어디 다친 데 있어? 발목은 괜찮아?", T312 is still the latest `injury` row and is injected (second, after the T312 treatment row). The T330 ankle recovery was never extracted, so this shows that the latest stored injury row is selected. It does not show that the ankle is still injured at T500.
- **Budgets.** 8 facts / 1,000 chars Episodic, the 25-key reconcile cap, Global 10,000 chars, the Medium window, the RP 3,200+ target and no output cap are untouched.

## REGRESSION RISKS (for GPT review)

1. **Correction vs. new event on user statements is not distinguished.** A later `explicit_user_statement` on the same key also replaces an earlier verified record when the user describes a different event (for example, "나 어제 발목 다쳤어" filed as `character:enoch:injury` after a T30 arm bite). Main already had this latest-wins behavior for these rows. Round 1 did not.
2. **Not covered: correction target outside the key** (STOP item; no speculative matching added):
   - **V2:** the extractor labels the correction `explicit_scene_event` with a user quote. That violates the extractor contract; the record is kept next to it.
   - **V3:** the correction is filed under a different attribute (for example `injury_cause`). Main and this branch both keep both rows.
   - **V4:** the record was filed under an intrinsically historical attribute (`scene_event`, `action`, …). It is not correctable (same as main).

   Options for a follow-up, both in the existing extractor/owner:

   - (a) The extractor emits an explicit `corrects` reference (turn or fact identity) on the user statement, and stage 1 uses it instead of the key.
   - (b) Link events through their evidence (same assistant message or quote).

   Both change extraction, so they are out of scope here.
3. **Repeated routine observations each take a slot** (round 1, unchanged). `X500-measurement` injects 6 identical "80%대" lines, which push out older distinct context. Following B6-2, real repeats from different source messages are each kept, but B6-2 does not require six identical lines in every turn's injection. Injection diversity for repeats is a FOLLOW-UP. Stored rows are not affected; only per-turn selection is.
4. **More rows reach the milestone lanes** (round 1, unchanged). Small selection changes in `L500-A6`, `T80-B3`/`T90-B3`, `L500-B3` and `X500-night-watch`, listed in round 1's logs.
5. **One extra query.** The correction lookup adds one prepared statement per recall when a correctable candidate exists. B7 probes: 24–31 statements per call (main 30, `0a279116` 23–30). Average over 50 calls across 26 probes: 6.54 ms (main 5.75 ms). The largest per-probe value is L500-B3 at 10.71 ms (main 9.10 ms).

## PROOF

### Fail-before / pass-after (same fixture, all three trees)

`node --conditions=react-server --import tsx --import ./src/lib/test/regularTestEgressPolicy.ts --test src/lib/memory/memory-episodic-past-event-slots.test.ts src/lib/episodicMemoryTemporal.test.ts`

| Tree (src) + the new tests | Tests | Pass | Fail |
|---|---|---|---|
| main `0a086447` | 66 | 56 | 10 |
| reviewed `0a279116` | 66 | 60 | 6 |
| fix `e7d03be2` | 66 | 66 | 0 |

Failing on `0a279116` (the review findings):

- correction at turn 500 and at turn 1000
- correction with a same-key recovery in between
- correction followed by a later separate scene injury
- #1651 state gloss with a same-key recovery
- #1651 state gloss with an other-key recovery and then a separate same-key injury

Failing on main:

- the B7 flank-cause and two-distinct-injury cases at 500 and 1000
- the classifier case
- the rewritten guard test
- correction with a same-key recovery in between
- "a later scene occurrence or an earlier user statement is not a correction"
- both #1651 glosses with an other-key recovery and a separate same-key injury

Logs: `logs/tests/fixture-on-main-0a086447.tap`, `logs/tests/fixture-on-prev-0a279116.tap`, `logs/tests/fixture-after.tap`.

The correction probe on the production save path (`correction-probe.mts`, 7 checks) gives the same picture. Main fails S2 and S3, `0a279116` fails S1 (500 and 1000), S2 and S4 (state gloss), and the fix fails none.

### Direct regressions

The 42 files that touch Episodic retrieval, temporal classification or the memory benchmarks (`logs/tests/related-files.txt`), provider keys unset:

| Tree | Tests | Pass | Fail |
|---|---|---|---|
| main `0a086447` | 714 | 700 | 14 |
| fix `e7d03be2` | 743 | 729 | 14 |

The same 14 tests fail on both trees with identical errors. Matching counts alone are not the pass criterion: the correction boundary is proven by the fixture and the probe. Each pre-existing failure was traced to a cause outside the correction boundary:

| File | Failing tests | Cause | Relation to this change |
|---|---|---|---|
| `episodicMemoryFacts.test.ts` | "latest fact wins for the same category subject attribute", "older facts are injected when old enough" | `resolveEpisodicMemoryMinAgeTurns` clamps the minimum age to at least 5 (since #642). The fixtures set 0 or 3, so the candidate query returns 0 rows (measured: `minAgeTurns=5`, `recallCutoffTurn=5`, 0 rows) and reconcile never runs | None. The failure occurs before stage 1. Latest-wins for state is pinned by the new job/location/preference test |
| `episodicMemoryFacts.test.ts` | "verifies explicit-user provenance …" (insert 0 vs 1), "ranking prefers critical …" (persist falsy), "preserves psychological resolution …" (insert 6 vs 7) | Each assertion fails on the save-time insert count before any recall (save without `evidenceBinding`, and control-term or ledger filters) | None. The save path is unchanged |
| `memory-source-edit-invalidation.test.ts` | 3 tests | `releaseLlm is not a function`: the test's LLM-gate mock is never assigned | None (LTM summary path) |
| `rpDerivedStateEpisodic.test.ts` | E1/E3/E4/E5 | `reconcileEpisodicMemoryFactsForGeneration` inserts 0 at save time | None. The save path is unchanged |
| `rpNumericStateVariantSwitch.test.ts` | 2 tests | `no such column: global_projection_kind` in the test schema | None |

### Canonical suite

`npm run test:regular`, provider keys unset, run on main (worktree) and the fix at the same time with separate `DATA_DIR`s:

| Tree | Tests | Pass | Fail |
|---|---|---|---|
| main `0a086447` | 13,585 | 13,285 | 299 |
| fix `e7d03be2` | 13,614 | 13,317 | 296 |

Every failure is in a file that fails on both trees except for these:

- **Only on the fix:** `investigationDiscovery.s3Home`, `personaSecretDiscovery.followup` and `recentActivity` (24 tests). The errors are `database is locked` and `cannot commit transaction - SQL statements in progress`. The same three files also fail on main when run together (21 of 31 fail on main, 17 of 31 on the fix). Each passes 100% when run alone with a fresh `DATA_DIR` (15/15, 8/8, 8/8). This is SQLite contention between concurrently running test files, not this change. None of them imports Episodic code.
- **Only on main:** `knowledgeTransfer.s4d` and `personaSecretDesignVerification.integration`. Same contention class: each passes 12/12 when run alone on main. `g37PublishedRuntimeDivergence` and `publishedUserChargeBuildArtifactGuard` require `npm run build` output, which the main worktree does not have.

### Static checks

- `git diff --check`: clean.
- `npm run lint` and `npm run typecheck:app`: pass.
- Full `npm run typecheck`: no errors in changed files (the known test-file errors on main remain).

### Replay on real B7 rows (lexical-only, 0 provider calls)

`run-probes.sh <b7 dir> <out>` runs `episodic-probe.mts` on the B7 snapshots. It opens the DB read-only, unsets the provider keys, and uses `semanticQuery: null`. Logs: `logs/probes-before/` (main) and `logs/probes-after/` (fix). With timing and statement count removed, all 26 `probes-after` logs are byte-identical to the `0a279116` logs (git history).

| Run | Candidates | Resolved | Injected | Block chars | Statements / call | Avg ms (50 calls) |
|---|---|---|---|---|---|---|
| L500-A5 main | 63 | 38 | 6 | 1035 | 30 | 7.07 |
| L500-A5 fix | 65 | 57 | 7 | 1081 | 27 | 7.91 |
| X500-flank-current main | 61 | 38 | 4 | 934 | 30 | 7.43 |
| X500-flank-current fix | 63 | 55 | 5 | 980 | 25 | 6.67 |
| X500-measurement main | 81 | 48 | 6 | 1037 | 30 | 7.10 |
| X500-measurement fix | 85 | 77 | 6 | 1074 | 26 | 8.23 |
| L500-B3 main | 81 | 47 | 7 | 1073 | 30 | 9.10 |
| L500-B3 fix | 85 | 73 | 7 | 1073 | 28 | 10.71 |

### Correction probe (production save path, in-memory DB)

`node --conditions=react-server --import tsx docs/pr-evidence/pr-b8-2-episodic-independent-event/correction-probe.mts`

## FOLLOW-UPS (not in this PR)

- Correction targets outside the key (V2/V3/V4 above), through an explicit `corrects` reference or evidence linking in the extractor.
- Injection diversity for repeated observations (Risk 3). B6-2 keeps the rows, but it does not require every repeat in each turn's block.
- The T330 ankle recovery was never extracted (extraction gap), so "current injury" stays the ankle with no recovery row.
- The 25-key reconcile cap and candidate saturation.
- Promise completion.
- Global compaction cost.
- 1000-turn real-RP verification.
- The min-age floor vs. the stale `episodicMemoryFacts.test.ts` fixtures (pre-existing).
- #1591 (untouched).
