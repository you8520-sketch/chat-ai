# #1574 free-narrative goal: does the real GM propose completion? (2 real Gemini calls)

Code under test: PR #1574 HEAD `67f3249d0e80099d665ab1c1d5354a6dc9bcca09` (unchanged). Main `8d0b4874553945c5322a22e9cf7cdc5c81c1414d` has no goal/claim code (`questsClaimDone` / `claimedRound` count 0), so only the PR HEAD can be exercised.
Model `gemini-3.8-flash` (CheaperInference, `reasoning_effort: low`, temperature 0.7, stream), `callTrpgGm` through the real engine path (`startTrpgCampaign` / `submitTrpgAction` / `advanceTrpgCampaign`). No retry, no fallback, fetch capped at 2 and non-provider hosts blocked. Estimated cost 19.69 KRW total (10.21 + 9.48). No production DB, no deploy, no merge. Nothing here is scored; read the raw files.

## What was fed to the model
- R0 is the REAL A-scenario R0 output from the earlier run (`docs/evidence/trpg-1574-goal-quality/post-contract-attempt/raw/call-01-A-scenario-r0-response.txt`, branch `cursor/trpg-1574-goal-quality-evidence-9d27`), replayed as the R0 GM text with no provider call. Its real goal is the active goal in both scenes: `해오라기호의 행방 추적: 선원의 가족이나 부두 사람들에게서 실종 정황을 파악한다` (no criterion).
- R1 is a scripted history round (no provider call): `fixture-actions-and-history.json`. A: the wife and an old deckhand give departure time, crew count and the last whistle. B: the wife gives one fragment only ("등대 불이 이상하다") and the sailors stay silent.
- R2 is the only real call per scene, with a plain player action (`ACTION_A` asks the guild elder where and when the last whistle sounded and to piece the story together; `ACTION_B` writes the fragment down and asks others more). The dice are the harness' fixed d20=14 (SUCCESS, DC 9). No instruction to the model about claiming, removing or adding goals was added; the prompt is the unmodified final assembly.
- Bias to keep in mind: A's scripted R1 already supplies two of the facts, so a resolution is plausible by construction. That is the requested scene, but it is not an unbiased sample, and n=1 per scene.

## Real outputs (files in this directory)
| | A resolved | B clue only |
|---|---|---|
| raw | `raw/call-01-A-resolved-r2-response.txt` | `raw/call-02-B-clue-only-r2-response.txt` |
| parsed | `parsed/call-01-A-resolved-r2-parsed-delta.json` | `parsed/call-02-B-clue-only-r2-parsed-delta.json` |
| final wire | `prompts/call-01-A-resolved-r2-{system,user}.txt`, `wire/call-01-A-resolved-r2-provider-request.json` | `prompts/call-02-...`, `wire/call-02-...` |
| `questsClaimDone` | the active goal title | none |
| `questsRemove` | the same title | none |
| `questsAdd` | `곶 끝 등대 또는 세관 기록 조사: 실종 당일 해오라기호와 세관 감시정의 접촉 흔적을 찾는다` | none |
| `threadsAdd` | 2 | 2 |
| `threadsResolve` | `사흘째 실종된 어선 해오라기호의 행방` | none |
| stored goal (`states.json`) | old goal `retired` (closedRound 2, NO `claimedRound`), new goal `active` | old goal `active`, unchanged |
| server log | `lifecycle {created:1, completed:[], retired:1}` | no lifecycle line |
| narration chars | 3,070 | 3,117 |

A: the narration itself closes the investigation ("원로 선원과의 대화로 실종 당시의 시간대와 공간적 궤적이 맞아떨어지자 ...") and `next_round_context` says "...파악했다". The model emitted the claim AND the removal of the same goal AND a successor goal.
B: no claim, no removal, goal untouched; the narration says the clues form "두 진실의 축" and still points the PC at two places to go.

Final wire (both scenes): the quest contract is in system once, including the sentence "without a criterion the server never confirms it as done"; `quests:` is in user once; there is no `goals_*` line because nothing was claimed or completed before R2.

Secret-literal check of the raw outputs is in `summary.json` (`literalContainmentOfRawOutputs`): A contains 강도현 / 밀수 / 장부, B contains 장부 / 오 노인. Not evaluated here (out of scope; reported as-is).

## Finding: the claim is swallowed by the removal
`applyGoalTransition` checks `questsRemove` before `questsClaimDone` for an active goal, and a removal retires it without credit; the claim branch is then never reached. `probes/reroll-and-delta-replay.log` replays the REAL A delta through `applyGoalTransition`: `goal-0-1 -> retired, claimedRound null`, successor active. So a real claim exists in the model output but is never recorded, and nothing could ever ask a host to confirm it.

## Finding: reroll does not touch the ledger (corrects an earlier statement)
`commitPendingGmResult` returns before `persistCampaignLedger` when `opts.regenerate` is set. `probes/reroll-and-delta-replay.log` (scripted GM text on a copy of the real A campaign, no provider call): the `trpg_gm_messages` row keeps its id, narration and `structured_json` change, `goals_json` and `quests_json` are byte-identical, and the reroll's own `questsAdd` is not applied. So after a reroll the goal state (including `claimedRound`, or a retirement) is from the first generation and the visible narration is from the second. The earlier note "ledger is additive on reroll" was wrong about the mechanism; the observable consequence (an old claim stays) is the same.

## Rollback of new fields
`probes/parse-goal-rollback.log`: the current `parseGoal` keeps only known fields. A goal carrying a `host_confirmed` evidence, a claim fingerprint or a decline marker keeps `status` and `claimedRound` but loses the new fields when an older #1574 build parses and rewrites `goals_json`; a payload with `version: 2` is read as "no goal state" (`null`) and would drop everything back to `quests_json`. So additive fields inside `version: 1` degrade safely; a version bump does not.

## Harness
`harness/` holds the three throwaway scripts used (they import `../src/...`, so copy them to `scripts/` of the PR HEAD checkout). The live driver is the earlier #1574 evidence driver reduced to this scenario; no new runner or evaluation infrastructure was added to the product tree.
Command: `G_MODE=live G_BUDGET_KRW=900 REGULAR_TEST_REAL_PROVIDER_CALLS=1 node --conditions=react-server --import tsx --import ./src/lib/test/regularTestEgressPolicy.ts scripts/_tmp-1574-free-goal.ts`

## Verification (fix commits e38019df, 074e4ada, 76d73058)

- `verification/free-goal-claim-red-on-pr-head.log` / `...green-priority-fix.log`: real A/B outputs, fail-before / pass-after for the claim-priority fix.
- `verification/goal-host-confirm-green.log`: 20 tests (host/non-host, double click, stale claim, reroll provenance, two DB connections, server priority, rollback/re-upgrade).
- `verification/goal-host-confirm-red-no-settle.log`: the same suite with the in-transaction re-check disabled; the interleave test and the settle test fail.
- `verification/goal-rollback-real-old-module.log` + `rollback-probe.test.ts`: the real 67f3249d `campaignGoals.ts` rewrites a host-confirmed `goals_json`; the new build reads it back as completed with basis `unrecorded` (evidence is lost, never shown as host- or server-verified) and a pending claim without `claimSource` is not confirmable.
- `verification/full-trpg-baseline-67f3249d.log` vs `full-trpg-after-76d73058.log`: same 28 pre-existing failing tests before and after; no new failure.

## UI evidence for 8c42b503 (before = PR head 76d73058; local dev server, seeded local SQLite, no deploy)

Screenshots are committed at `8782f597ae86836c74b0ee25955240d7d60688dc`; each URL returned HTTP 200 image/png when checked.

| state | device | before | after |
|---|---|---|---|
| host, valid proposal | pc | [before-host-valid-pc.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/before-host-valid-pc.png) | [after-host-valid-pc.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/after-host-valid-pc.png) |
| host, valid proposal | mobile | [before-host-valid-mobile.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/before-host-valid-mobile.png) | [after-host-valid-mobile.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/after-host-valid-mobile.png) |
| host, stale proposal (reroll) | pc | [before-host-stale-pc.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/before-host-stale-pc.png) | [after-host-stale-pc.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/after-host-stale-pc.png) |
| host, stale proposal (reroll) | mobile | [before-host-stale-mobile.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/before-host-stale-mobile.png) | [after-host-stale-mobile.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/after-host-stale-mobile.png) |
| other human, valid proposal | pc | [before-guest-valid-pc.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/before-guest-valid-pc.png) | [after-guest-valid-pc.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/after-guest-valid-pc.png) |
| other human, valid proposal | mobile | [before-guest-valid-mobile.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/before-guest-valid-mobile.png) | [after-guest-valid-mobile.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/after-guest-valid-mobile.png) |

After an answer (live click in the browser):

| step | device | screenshot |
|---|---|---|
| host clears the stale proposal -> card gone | pc | [act-stale-host-after-clear-pc.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/act-stale-host-after-clear-pc.png) |
| host clears the stale proposal -> card gone | mobile | [act-stale-host-after-clear-mobile.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/act-stale-host-after-clear-mobile.png) |
| other human, same stale campaign -> card gone | pc | [act-stale-guest-after-clear-pc.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/act-stale-guest-after-clear-pc.png) |
| other human, same stale campaign -> card gone | mobile | [act-stale-guest-after-clear-mobile.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/act-stale-guest-after-clear-mobile.png) |
| host confirms valid proposal -> card gone | pc | [act-valid-host-after-confirm-pc.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/act-valid-host-after-confirm-pc.png) |
| host confirms valid proposal -> card gone | mobile | [act-valid-host-after-confirm-mobile.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/act-valid-host-after-confirm-mobile.png) |
| other human, same valid campaign -> card gone | pc | [act-valid-guest-after-confirm-pc.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/act-valid-guest-after-confirm-pc.png) |
| other human, same valid campaign -> card gone | mobile | [act-valid-guest-after-confirm-mobile.png](https://raw.githubusercontent.com/you8520-sketch/chat-ai/8782f597ae86836c74b0ee25955240d7d60688dc/docs/evidence/trpg-1574-free-goal-claim/ui/act-valid-guest-after-confirm-mobile.png) |

Database state after the clicks (`verification-ui/final-db-state.log.txt`): the cleared stale goal stays `active` (`declinedRound: 1`, no evidence); the confirmed goal is `completed` with `host_confirmed` evidence.

Other logs under `verification-ui/`: view-model + host tests RED on 76d73058 / GREEN on 8c42b503, 20-test host suite on a real remote libsql server (sqld 0.24.32) through the production driver, rollback to real production main (1945e2de) and re-upgrade, deployment history check, full TRPG suite after (same 28 baseline failures), build. `*.log` is gitignored in this repo, so logs here carry a `.txt` suffix.
