# #1574 post-attempt run: one contract sentence changed, 2 new real Gemini calls (raw, unscored)

Evidence only. No score. GPT evaluates the raw text.

- PR: https://github.com/you8520-sketch/chat-ai/pull/1574
- Attempted wording change: commit `18ba9adf44b1c174c72ee0d24d1c417fa4b4b072` on top of `91077e7f2063f7873370730d19309c8583365779` (`prompt-change-attempted.diff`). It replaced the quest sentence in `[OUTPUT]`, the only place that sentence lives. The 2 calls below ran with this wording.
- That wording was then reverted in the PR (`53315216`). The new tests were kept (`67f3249d0e80099d665ab1c1d5354a6dc9bcca09`).
- main when checked: `f122d3660aa3773b12a8ff8d8ec5ce9a3a5f5c91`. Its new commits touch only UI, admin and recent-chats files, nothing in `src/lib/trpg`.
- Model `gemini-3.8-flash`, existing `callTrpgGm` and real prompt assembly, benchmark key as override. Throwaway SQLite copy, test users, no production access.
- Limit 2 calls, no retry: the harness blocks a 3rd fetch (`fetchLog`: 2 fetches, 0 blocked). Reachability was checked first with a free `GET /v1/models` (HTTP 200, 0.4 s). That is not a model call.
- Harness: `harness/_tmp-1574-goal-quality-v2.ts`. Same fixtures as the earlier run. It also records every streamed chunk (`chunkTelemetry` in `summary.json`) and saves the request body and partial text if a call fails.

## Calls

| # | case | finish | elapsed | chunks (first/last) | tokens in/out | est KRW |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | A scenario R0 | stop | 24.9 s | 66 (6.6 s / 24.8 s) | 3,823 / 1,706 | 6.72 |
| 2 | C R2 after the server completed `reach_location` | stop | 15.9 s | 44 (3.3 s / 15.8 s) | 4,409 / 1,158 | 5.55 |

Total est 12.26 KRW at 1,450 KRW/USD. Earlier-run total was 23.98 KRW (A uncounted).

Files: `prompts/` (final system/user), `wire/` (provider request bodies), `raw/` (unmodified output), `parsed/`, `states.json`, `summary.json`, `run.log`.

## Facts: A scenario R0 (previously no output)

- This run completed normally with a steady stream. The earlier stall did not recur.
- `questsAdd`: one goal, `해오라기호의 행방 추적: 선원의 가족이나 부두 사람들에게서 실종 정황을 파악한다`. It has no `criterion`. It is stored active and shown as the only player-visible goal. `plan.goal` text is not in the snapshot.
- `강도현`, `침몰` and `오 노인` do not appear in the output. Literal `밀수` appears once, in a sailor's line (`밀수 단속이네 뭐네 하면서 해오라기호의 항로를 트집 잡던 게 엊그제요.`). Public scenario text has no `밀수`; the GM-only secret and endings do.
- The narration points to customs (a sailor says customs blocks departure), to the lighthouse signal (`등대의 신호에 문제가 있었다는 소문`) and to the family's grief. It ends with a `GM:` line asking the PC whom to approach.
- `delta.players` is empty. `npcsAdd` is plain strings. `threadsAdd` has two entries.

## Facts: C R2 before and after the wording

Same fixture and same user text. The two final user wires differ only in participant id (`10` vs `9`); the system wire differs only in the changed sentence.

| | before (`../raw/call-03-*`) | after (`raw/call-02-*`) |
| --- | --- | --- |
| user wire has `quests:` and `goals_done:` | yes | yes |
| `questsAdd` in delta | key absent | key absent |
| `threadsAdd` | `등대 신호등 기록 공백의 진실`, `위층에 숨어 있는 등대지기` | `등대 신호등 기록 공백의 진실` |
| active goals after the round | `부두 사람들에게 해오라기호 소문을 묻는다` | same |
| PC HP | 40 to 34 | 40 to 34 |
| narration chars | 1,806 | 1,416 |
| content | ambush by a lighthouse watcher, a log with the night blanked, the keeper upstairs | ambush by a watcher, a log with the night blanked and torn pages, a torn ledger corner, the keeper upstairs |
| names `오 노인` | yes | yes (says the attacker is not him) |

With the attempted wording the model still registered no new goal. This is one sample at temperature 0.7, so it shows no effect and does not rule one out.

## Not verified

- Whether any wording moves the model to register new goals: n=1 per arm, and the scene contains an ambush and an in-scope clue, which the attempted sentence itself excludes from goal-worthy events.
- Real R3 and later rounds after the attempt.
- Whether the earlier A stall repeats: this run did not reproduce it.

## Call-path audit of the earlier A stall (code reading + the telemetry above)

- `postTrpgGmStream` in `src/lib/trpg/gmCall.ts` sets one `AbortSignal.timeout(180_000)` on the fetch. It covers the response headers and the whole SSE body.
- Only an HTTP error status that `isGmRetryableHttpStatus` accepts is retried. A stall after HTTP 200 is not retried.
- There is no first-chunk or idle timeout, and the partial text is discarded when the abort fires.
- Earlier A: HTTP 200 after 3.6 s, then no completed body for 180 s. The harness had no chunk telemetry then, so it is unknown whether any chunk arrived.
- Request size does not explain it: the stalled A body was 17,371 bytes; calls of 15,077, 19,346 and 24,353 bytes completed. The final prompt for A here differs from the earlier A prompt only in the changed sentence, and it completed in 24.9 s.
- The code path is unchanged by PR #1574 (`gmCall.ts` is not in the diff). One stall in 6 real GM calls is consistent with a provider-side stall. This run's telemetry cannot attribute it to the provider or to the request.
