# TRPG vNext Phase 2 — OLD vs NEW real-play evidence (raw)

Evidence only. No scoring (GPT evaluates). No product code changed on this branch.

- OLD `05f5220e77c634840353cfed25b2d1ff2a4b943f`
- NEW `928369a6a22842d493e477c7cc9ab22d0a7e5c98`
- Models: GM and AI-companion bot `gemini-3.8-flash` via the existing CheaperInference adapter, real `callTrpgGm` / `callTrpgBot` / real final prompt assembly (`engineAdvance`).
- Credential: `CHEAPER_INFERENCE_BENCHMARK_API_KEY` (manual-probe key). Test state in a throwaway SQLite copy; production DB untouched; test users only.

## Directories

| dir | what | calls | est. cost (KRW @1450/USD) |
| --- | --- | --- | --- |
| `live-new` | NEW, scenario with approved encounter, 2 humans + 2 AI, 5 rounds (R1-R4 comparison + R5 extension) | 19 (6 GM, 10 bot, 3 memory) | 112.51 |
| `live-old` | OLD, same story/characters/input order/dice, no encounter field | 15 (5 GM, 8 bot, 2 memory) | 91.08 |
| `live-old-attempt1` | OLD first attempt, R4 GM provider timeout (180s) — kept as evidence | 14 | 82.64 |
| `live-free-new` | NEW, world-only free play (no scenario, no Blueprint), 10 rounds | 19 (11 GM, 8 memory) | 136.63 |

Total est. 422.86 KRW (< 1,000 KRW threshold). Zero errors except the one OLD timeout.

Each dir: `prompts/` (exact system+user text sent per call), `raw/` (full raw model response per call), `rounds.json` (per-round sheets before/after, dice, resolved actions, context), `messages.json` (GM narration + structured_json), `summary.json` (calls, tokens, cost, fetch log, dice), `run.log`.

`harness/` and `probes/` are the throwaway drivers (outside the product tree) used to produce this.

## Combat A/B quick facts (objective, unscored)

| round | NEW 서하 HP | OLD 서하 HP |
| --- | --- | --- |
| R1 | 40 | 40 |
| R2 | 34 | 40 |
| R3 | 28 | 40 |
| R4 | 22 | 40 (OLD GM ended campaign at R4) |
| R5 | 22 (strikes stopped after `encountersEnded`) | n/a |

## World-only free play (NEW) — server vs narrated location

Players declared these moves; GM narration/structured location followed; ledger (server) location did not.

| round | player move declared | GM proposed location | server ledger location after |
| --- | --- | --- | --- |
| R0 | opening | 마레노 부두 | 마레노 부두 |
| R2 | 어시장으로 가서... | 마레노 어시장 | 마레노 부두 (declared move not persisted) |
| R3 | 선원 조합 회관으로 향한다 | 선원 조합 회관 | 선원 조합 회관 |
| R5 | 곶 끝의 등대로 이동한다 | 곶 끝의 등대 외곽 | 선원 조합 회관 |
| R6 | 등대 위로 올라가... | 곶 끝의 등대 내부 | 선원 조합 회관 |
| R7 | 세관으로 향한다 | 세관 청사 1층 | 선원 조합 회관 |
| R9 | 어시장으로 돌아가 | 어시장 | 선원 조합 회관 |
| R10 | 가장 의심스러운 인물을 찾아가 | 마레노 어시장 외곽 부두 | 선원 조합 회관 |

`trpg_campaign_state.next_round_context` is the R4 text from R4 through R10. `trpg_campaign_context`: `story_phase=INTRO`, threads empty, `local_scene_progress_json=NULL`, `director_plan_json=NULL` for all rounds. Quests/flags did grow (flags 24 by R8).

Probe (`probes/_probe-bind.ts`, current main `campaignLedger.submissionAuthorizesLocation`):

| body | dest | authorizes |
| --- | --- | --- |
| ...선원 조합 회관으로 향한다 | 선원 조합 회관 | true |
| ...곶 끝의 등대로 이동한다 | 곶 끝의 등대 외곽 | false (`외곽` is taken as the place token; not in `INTERIOR_SUFFIXES`) |
| ...곶 끝의 등대로 이동한다 | 곶 끝의 등대 | true |
| 등대 위로 올라가... | 곶 끝의 등대 내부 | false (`올라가` not in traversal verbs) |
| ...세관으로 향한다 | 세관 청사 1층 | false (last place token `청사` not in body) |
| ...세관으로 향한다 | 세관 | true |
| ...어시장으로 돌아가... | 어시장 | false (`돌아가` not in traversal verbs) |
| ...어시장으로 돌아가... | 마레노 어시장 외곽 부두 | false |

`probes/_probe-move2.ts`: `declaresTraversalIntent` is false for 마을로 돌아간다 / 어시장에 가 본다 / 어시장으로 돌아가 / 위층으로 올라간다 / 항구로 출발한다 / 마을을 떠난다 / 도망친다 / 걸어 나간다.
