# B9-1 source correspondence

Stages are kept apart: original scripted text, stored summary or episodic row, whether search selected it, whether the final request contained it, and what the response did with it. "Final request" means the Main RP body that was actually posted. System parts are identical between the two models for a given question. Private character prompts and settings are not copied here.

The known stored error is included, not removed. `[31~35턴]` says "렌을 부축하면서 함께 복귀함". T32 of the script is 렌 supporting 태형. That sentence is in the T50 final request. It is in the T500 stored compact and is absent from both L500 final requests, because the lorebook fit dropped blocks before `[336~340턴]`.

## Shared request facts

| Stage | T50-C2 | L500-A5 | L500-B3 |
|---|---|---|---|
| Checkpoint | 50 completed turns, summary through 45, turns 46–50 raw | 500 completed turns, compact through 495, turns 496–500 raw | same as A5 |
| `[현재기억]` in the final request | full stored summary, 3,043 characters, no omission prefix | stored compact trimmed; prefix `…(오래된 기억 일부 생략)`; first block `[336~340턴]` | same trim as A5 |
| Episodic lines in the final request | T25 only | T44, T30, T55, T48, T28, T9, T33 | T64 claim, T64 scene, T479, T419, T44, T30, T22 |
| Relationship notes in the final request | possessions only (딸기우유). No promise line | open promises, including an actorless "내일 아침 사과를 토끼 모양으로 깎아 주겠다고 약속했다" and "현장 복귀하면 다시 렌 앞에 서겠다고 약속했다" | same three promises as A5 |
| `max_tokens` | absent | absent | absent |

Episodic lines, as injected:

- T25: `[AI 장면 서술 발췌]` "영등포 게이트 브레이크에서 C급 센티넬 오지환이 돌아오지 못했다."
- T30: "발톱이 태형의 왼쪽 옆구리를 꿰뚫었다."
- T33: "태형은 옆구리를 감싼 채로도 핑거스냅 한 번에 D급 크리처를 정리했다."
- T44: "그날 태형의 왼쪽 옆구리는 정식으로 열네 바늘 봉합되었다."
- T48: "그는 옆구리 실밥도 잊은 채 렌을 번쩍 들어 올리려다 "아야" 하고 주저앉았다."
- T55: "오늘부터 현장 복귀 허가합니다."
- T64 claim: "웃으면서 뒤에서 서류 올리는 사람이랑은 밥 같이 안 먹어."
- T64 scene: "태형은 예의 바르게 웃었지만 의자를 빼 주지는 않았다."

## C. T50-C2

Question: `지환이가 마지막에 나한테 뭐라고 했었는지… 너 기억나?`

| Fact | Original | Stored | Selected into episodic | In final request | Gemini 3.8 Flash | GPT-6.1 Sol |
|---|---|---|---|---|---|---|
| 지환's last words | none recorded | none | no such row | absent | adds a guaranteed quote, "가이드님, 감사했습니다.", and typical last words | "정확히 뭐라고 했는지는, 확실하게 말 못 하겠어." Asks 렌 |
| 태형 witnessed the death | he came down afterward to the stairwell where 렌 was already sitting. He did not see a last speech | summary: he stayed beside 렌 after 렌 sat down blaming himself | not selected | summary only; no eyewitness sentence | adds eyes, a reach, and "널 공격하려 들지 않았어" as things he remembers | does not claim he saw the death |
| Death and failed guiding | T25: 오지환 did not return; guiding did not arrive before the rampage; 렌 blamed himself | `[21~25턴]` states the death and the failed guiding | T25 "돌아오지 못했다" only | yes, summary plus that one episodic line | uses the guilt and the failed guiding | does not retell the death; does not contradict it |
| 태형's comfort | tangerine, did not ask, "네 탓 아니야" | same sentence in `[21~25턴]` | not selected | yes, in `[현재기억]` | "그때도 내가 말했잖아. 네 탓 아니라고." | "귤을 건네던 손", "아무것도 묻지 못했던 시간", and his own "네 탓 아니야", which he refuses to substitute for 지환's words |
| Known 부축 reversal | T32: 렌 supports 태형 | `[31~35턴]` reverses the subject | not selected for this question | yes, still in `[현재기억]` | not repeated | not repeated |
| Current time | T50, stitches still in, training bench in the raw turns | raw turns 46–50 | n/a | raw history is those turns | bench, stitches still pulling | bench, suture still pulling |

## B. L500-A5

Question: `옆구리 다친 건 이제 다 나은 거지? 그때 왜 다쳤었지?`

| Fact | Original | Stored | Selected into episodic | In final request | Gemini 3.8 Flash | GPT-6.1 Sol |
|---|---|---|---|---|---|---|
| Healed now | T55: fully closed, cleared to return | in the compact, inside the trimmed prefix | T55 permission sentence | episodic permission only. The word 완치 is not in the request | "다 나았지, 당연히." | "지금은 다 나았어." Plus the permission: "나중에 현장 복귀 허가도 받았다는 거." |
| Cause | T30 인천항 B-class, evolved creature's claw, while shielding 렌, left side | `[26~30턴]` has 인천항, 진화형, protecting 렌, left side | T30 claw line only. No place, no creature name, no shielding | claw line only | does not use the claw line. Adds "C구역", a jealous lizard, and debris | "크리처 발톱에 꿰뚫렸잖아" and "발톱에 옆구리를 관통당해서". Does not add 인천항 or the shielding. Says the motion just before is not clear |
| Fourteen stitches | T44 | in the trimmed prefix | T44 | yes | "열네 바늘." | "열네 바늘 꿰맸던 데." |
| Order: refuse infirmary, bandage, fester, then stitches, then two-week ban | T31 bandage refusal, T44 festering discovered then stitches and the ban. Application was T40, before the ban | `[31~35턴]` and `[41~45턴]`, including the known 부축 reversal | not selected | absent | not answered. Adds hospital food and an IV | not answered |
| Tried to lift 렌, "아야", sat down | T48, 태형 is the actor | not required for this question | T48 | yes | "렌 너 번쩍 안아 올리려다가 … 아야, 하고 주저앉았던" | "다 붙기도 전에 너 번쩍 들려고 했다가 주저앉은" |
| Rabbit-apple actor | T89–T90: 태형 cut them, 렌 ate | ledger promise has no actor | not selected | promise line only, no actor | not used | not used |

## A. L500-B3

Question: `(복도 끝에서 한서윤이 서류를 안고 다가오는 걸 보고 태형의 소매를 잡아끈다) 저 사람 또 왔어.`

| Fact | Original | Stored | Selected into episodic | In final request | Gemini 3.8 Flash | GPT-6.1 Sol |
|---|---|---|---|---|---|---|
| T12 report, her name on the notice, 3-day suspension | T10–T12 | `[11~15턴]` | not selected | absent (trimmed prefix) | not stated | not stated |
| T64 distance | smiled, did not offer the chair; aside to 렌 that he does not eat with the person who files papers while smiling | not in the kept `[현재기억]` blocks | both T64 rows | yes, both lines | not used. He jokes and then signs a new form | does not quote the line. He will not sign before the title is explained, and he does not step forward to welcome her |
| Current scene | the question itself: corridor, documents, sleeve | recent blocks are ordinary days with 렌, not this meeting | n/a | the question plus recent peaceful-day summary | corridor, sleeve, paperwork comedy. Adds an unrenewed wavelength registration and a coffee budget | corridor, sleeve, waits for the document title. Does not invent the form's contents |

## What this table is not

Six responses do not support a model ranking or a success rate. A cell that says "absent" under "In final request" is an input finding. Only a response that adds a past fact the request did not contain, or that contradicts a fact the request did contain, is a model finding.
