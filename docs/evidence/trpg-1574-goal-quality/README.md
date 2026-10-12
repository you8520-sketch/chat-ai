# #1574 real Gemini goal creation / progression evidence (raw, unscored)

Evidence only. No score. GPT evaluates the raw text. No product code is changed on this branch.

- PR under test: https://github.com/you8520-sketch/chat-ai/pull/1574 at `91077e7f2063f7873370730d19309c8583365779`
- main at run time: `5a6a950fc7e2381164b4e82317a5afdb360bd3da`
- Model: `gemini-3.8-flash` (request `model` field), through the existing `callTrpgGm` and the real final prompt assembly (`startTrpgCampaign` / `advanceTrpgCampaign`). Credential: `CHEAPER_INFERENCE_BENCHMARK_API_KEY` (manual-probe key) as `cheaperInferenceApiKeyOverride`.
- State: throwaway SQLite copy (`/tmp/p2/dev-copy.db`, older dev copy, upgraded by this PR's `ensureTrpgTables`), test users only. Production DB, deploy and production campaigns untouched.
- Limits: at most 4 provider calls, no retry, no fallback model. The harness blocks any fetch beyond 4 (`fetchLog` in `summary.json`; exactly 4 fetches, 0 blocked).
- Harness: `harness/_tmp-1574-goal-quality.ts` (throwaway, wires existing owners only; builds no prompt). `harness/reconstruct-wire.ts` rebuilds a provider request body from the saved system/user text.

## What ran

| # | case | round | real call | result |
| --- | --- | --- | --- | --- |
| 1 | A scenario R0 (GM-only `plan.goal`, `secret`, endings, encounter) | 0 | yes | **NO OUTPUT: stream stalled, aborted at 180,005 ms** |
| 2 | B world-only R0 (no scenario, no Blueprint) | 0 | yes | ok, 34.5 s, finish `stop` |
| - | C construction R0 (scripted GM, no provider call): goals `등대로 가서 상황을 살핀다` with `reach_location` = `곶 끝의 등대`, and a free goal | 0 | no | - |
| - | C construction R1 (scripted GM, no provider call): player declares `곶 끝의 등대로 이동한다.`; the server approves the move and completes the goal | 1 | no | `goals_json`: goal `completed`, `quests_json` projection drops it |
| 3 | C after completion | 2 | yes | ok, 19.1 s, finish `stop`; player action `등대 안을 둘러본다.` |
| 4 | C after completion | 3 | yes | ok, 26.3 s, finish `stop`; player action `더 자세히 살펴본다.` |

Case A was the first fetch: HTTP 200 returned after 3.6 s, then the streamed body produced no completion within the existing 180 s provider timeout. The engine put round 0 in `ERROR_RECOVERY` and saved no GM message. No partial text was kept. The 4-call limit was already spent on B, C2 and C3, so A was **not retried**. A's exact system/user text is saved (`prompts/call-01-*`), but its raw output, parsed delta and goal state do not exist. A's provider request body was not captured by the harness (the fetch log shows 17,371 bytes). `reconstruct-wire.ts` shows the builder gives the saved bodies +132 bytes for B/C2/C3, so the same offset applies to A.

## Cost

Estimated from reported tokens, `summary.json` price formula and 1,450 KRW/USD.

| call | in tok | out tok | est KRW |
| --- | --- | --- | --- |
| A | n/a (aborted, no usage returned) | n/a | not metered (bounded above by B, about 9) |
| B | 3,164 | 2,563 | 8.69 |
| C R2 | 4,336 | 1,468 | 6.35 |
| C R3 | 5,689 | 2,152 | 8.94 |

Metered total 23.98 KRW. Far below the 1,000 KRW cap.

## Where to open

- Final system/user text per call: `prompts/call-NN-*-system.txt`, `prompts/call-NN-*-user.txt`. Actual provider request bodies for calls 2-4: `wire/`.
- Unmodified raw model output: `raw/`
- Parsed delta (`parseTrpgGmOutput`): `parsed/`
- Stored goal state (`goals_json`, `quests_json`, player-visible `snapshot.goals`, sheet locations) after each step: `states.json`
- Per-call model/usage/finish/elapsed, fetch log, literal containment table: `summary.json`
- Scenario fixture, with the GM-only parts: `scenario-fixture.json`
- Console log: `run.log`

## Objective facts (no judgement)

B world-only R0:
- `questsAdd`: one string, `곶 끝 등대 조사: 고장 위기에 처한 등대의 문제를 확인하거나 해결 방도를 찾는다.`
- The goal has no `criterion` (the model did not propose one). It is stored as active goal `goal-0-1` and is the only entry in `snapshot.goals`.
- The narration ends with a `GM:` line asking what the PC does. A lighthouse assistant (an NPC) appeals for help in the narration.
- `delta.location` is `마레노 중앙 부두`. The player's sheet location after R0 is `마레노 중앙 부두`.
- The literal `장부` appears in the narration as an ordinary object (a customs clerk's ledger).

C after the server completed `reach_location`:
- Final user text of R2 and R3 contains `quests: 부두 사람들에게 해오라기호 소문을 묻는다` and `goals_done: 등대로 가서 상황을 살핀다`.
- R2 delta has no `questsAdd` key. R3 delta has `"questsAdd": []`.
- After R3 the active goal list is unchanged: only `부두 사람들에게 해오라기호 소문을 묻는다`. The player is at `곶 끝의 등대`. No new goal was registered in R2 or R3.
- R2 narration: an ambush by a `감시자` and the finding of a lighthouse log with a blanked night. It names `등대지기 오 노인` and says the log shows the keeper may be tied to `침몰 당일`. The R2 delta puts PC HP 40 to 34.
- R3 narration: it states that the watcher belongs to customs (`세관의 하수인`). It also states that a customs ship blocked the vessel's route and that the lighthouse light was ordered out. The R3 delta puts PC HP 34 to 28.
- Neither round repeats the completed task. The GM line of each round ends on the immediate threat and a how-to-respond question.
- Secret literals found in raw output (crude substring list, see `summary.json`): R2 `침몰`, `장부`, `오 노인`; R3 `침몰`, `오 노인`, `지시`. The scenario's GM-only `secret` and `plan.goal` contain `강도현`, `밀수`, `장부`, `오 노인`, `침몰`. `강도현` and `밀수` did not appear in any raw output.

## Not verified here

- Case A (scenario R0 secrecy, goal creation, forced-action check): no model output exists.
- C R0 and R1 are scripted constructions. R2 and R3 are the real post-completion observations. Only two post-completion rounds were sampled.
