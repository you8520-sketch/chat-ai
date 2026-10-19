# B9-1 evidence: real-model recall after B8-2 / B8-3

This note separates two questions. The first is whether the memory that exists after B8-2 and B8-3 actually reached the final Main RP request. The second is whether the model used that request accurately and naturally in Korean RP. A missing or wrong fact in the final request is not scored as a model error. A known summary error was left in place and was not corrected before the calls.

No product code, prompt, or model routing was changed. There were no production DB writes, no merge, and no deploy. Summary, extraction, and embedding calls were not replayed. The pending B7 1000-turn extension is not part of this run.

Full responses are in `responses/`. The stage-by-stage source table is in `source-map.md`.

## Baseline

- Evaluated commit: `d341c13d7c1055f6a4b38bf1feb190c2a2fd490f` (`origin/main` at run time).
- The instruction named production/main `4cd12f63` (#1666 squash). That commit is an ancestor. The only later commit is `d341c13d`, the login return path for `/points` and `/settings` (#1669). It does not touch memory, prompts, or model routing.
- #1659 (B8-2) and #1666 (B8-3) are included.

Live picker ids on this commit, both left active and not substituted:

| Selected id | Provider | Wire id on the final request |
|---|---|---|
| `gemini-3.8-flash` | openrouter | `google/gemini-3.8-flash` |
| `gpt-6.1-sol` | cheaperinference | `gpt-6.1-sol` |

Gemini parameters on the captured body: `provider.only = ["google-ai-studio"]`, `allow_fallbacks: false`, `require_parameters: true`, `service_tier: flex`, `reasoning.effort: low`, `reasoning.exclude: true`, `include_reasoning: false`. Sol parameters: `reasoning.effort: low`, `reasoning_effort: low`, `temperature: 0.7`, session prompt-cache query on the cheaperinference URL. Neither body contains `max_tokens`. The two models' requests are not byte-identical. For the same question the three system parts match, and the last user message differs in the model-specific output instruction.

## What was reused, and how the DB differs from the original

Character 18 (라이크), persona 1 (렌), route safe, third person, authoring NORMAL, memory capacity 10,000, soft length target 3,200 with no output cap. Those chat settings were copied from a read-only production safe chat (chat 801; the same SAFE/NORMAL numbers as chats 800–802). Production memory flags copied into the isolated process: `BACKGROUND_MEMORY_MODEL=gpt-6-luna`, `EPISODIC_SEMANTIC_MODEL=bge_m3`, `EPISODIC_MEMORY_RECALL_ENABLED=1`, `MEMORY_5PLUS4_ENABLED=true`, canon injection on. `EPISODIC_SEMANTIC_DISCOVERY_ENABLED` is unset in production, so retrieval did not call embeddings. Character, persona, world, and lore rows are a read-only production copy taken on 2026-10-19 and may differ from the export used when B7 was first run.

The original B7 replay databases were not kept. These snapshots are reconstructed:

- Messages are the scripted `scenario.mts` + `filler.mts` text, inserted as the replay inserted them. They are not a new summary of that text.
- Stored turn summaries and the global `recent_summary` are the original audit text, not regenerated.
- Episodic rows were re-saved through the current reconcile on this commit (B8-2/B8-3). Subjects and quotes are reconstructed: known keys, placeholder values `b7_<id>`, and a quote chosen by overlap or from the known-quote list. They are not claimed to be byte-identical to the lost original rows.
- The known summary error is still stored. `[31~35턴]` says 태형 returned while supporting 렌 ("렌을 부축하면서 함께 복귀함"). In T32, 렌 supports 태형. The T500 stored compact still contains that sentence. It was not edited out before the calls.
- T50 is one summary batch behind the stored audit state: summarized through turn 45, turns 46–50 still raw. T500 compact covers through turn 495, with turns 496–500 raw.
- Because the snapshot is one batch behind, the live route tried a rolling summary and a post-turn extract (`gpt-6-luna`) before and after the Main RP call. Those completions were intercepted before the network and did not replace the stored summary. The prompt therefore still contains the stored memory, including the known error where that text survived prompt fitting.
- The adult gate for character 18 follows production: access is the admin email list, not `is_admin`. The isolated user email was set to the current production admin email. The address is not in this repo.

One further difference appears only at prompt assembly, not in the stored rows. The T500 stored compact is 9,853 characters and does contain the early events (인천항, 한서윤's report and the 3-day suspension, 오지환, the 14 stitches, and the known 부축 sentence). The final `[현재기억]` block does not. The live lorebook fit dropped older blocks and prefixed `…(오래된 기억 일부 생략)`. The first block that remains is `[336~340턴]`. For the two L500 questions, early-story facts reach the model only if episodic retrieval selects them. The T50 `[현재기억]` block is the full stored summary, and the known error is in that request.

## Calls and cost

Pre-call estimate, computed from the six captured final requests before any paid POST. Input tokens use the repo estimator `ceil(chars * 0.9)`, which is higher than the provider counts later observed. Output is bounded at 12,000 tokens per call (about 3.6 times the largest B7 output on these questions, 3,340, and above the 3,200-character soft aim). Rates are the published catalog: Gemini 3.8 Flash $0.375 / $1.875 per million, GPT-6.1 Sol $2 / $10 per million, uncached, long-context threshold not reached. FX uses 1,560.6 KRW per USD (1,530 × 1.02), above the live rate seen during the run (1,360.27097082). That estimate is 972 KRW for six calls, under the 1,000 KRW cap, so the calls were made. No retry and no substitute model.

Paid Main RP POSTs: 6. Each turn sent exactly one completion for the expected wire id. Luna completions were stubbed and are not in the paid count. Finish reason on all six is `stop`. Length recovery passes: 0. `max_tokens` omitted on all six.

| Call | Wire | Provider input | Provider output | Reasoning tokens | Reported provider KRW | USD |
|---|---|---:|---:|---:|---:|---:|
| T50-C2 gemini | `google/gemini-3.8-flash` | 13,992 | 2,575 | — | 9.2 (FX fallback 1,530) | 0.006029 |
| T50-C2 sol | `gpt-6.1-sol` | 14,565 | 2,542 | 83 | 84.1 (live FX 1,360.27) | 0.039651 |
| L500-A5 gemini | `google/gemini-3.8-flash` | 19,085 | 2,462 | — | 9.5 (FX fallback 1,530) | 0.006215 |
| L500-A5 sol | `gpt-6.1-sol` | 19,629 | 2,496 | 81 | 100.7 (live FX 1,360.27) | 0.047594 |
| L500-B3 gemini | `google/gemini-3.8-flash` | 19,115 | 2,380 | — | 9.3 (FX fallback 1,530) | 0.006075 |
| L500-B3 sol | `gpt-6.1-sol` | 19,646 | 2,381 | 52 | 99.2 (live FX 1,360.27) | 0.047062 |

The six reported provider figures use the route's own FX snapshot per provider, so they are not one exchange rate. Their sum is about 312 KRW. The catalog USD sum is about $0.153. Saved response length is 3,694–4,112 characters. Gemini cache reads and Sol cache writes are in the route usage; the pre-call estimate did not take a cache discount.

These six responses are not a model ranking and not a success rate.

## Judgments

Character- and persona-consistent narration of the current scene (appearance, tone, the training bench at T50, the records room at T500) is not treated as an error. Quotes below are from the saved responses.

### A. L500-B3 서윤 — `responses/l500-b3-gemini.txt`, `responses/l500-b3-sol.txt`

Question: `(복도 끝에서 한서윤이 서류를 안고 다가오는 걸 보고 태형의 소매를 잡아끈다) 저 사람 또 왔어.`

Memory that reached the final request: two T64 episodic lines. "웃으면서 뒤에서 서류 올리는 사람이랑은 밥 같이 안 먹어." (character claim) and "태형은 예의 바르게 웃었지만 의자를 빼 주지는 않았다." The report, her name on the notice, and the 3-day suspension are in the stored `[11~15턴]` summary and were not in the final `[현재기억]` block. Missing those three from an answer is an input limit, not a model miss.

Gemini 3.8 Flash continues the corridor and the sleeve pull, and the Korean is in 태형's playful register. It does not use the T64 distance that was in the request. 서윤 becomes a generic paperwork officer; 태형 jokes, then signs. It also adds administrative history that is not in the story or the request, including an unrenewed wavelength registration and a coffee budget tied to the form. That is added past machinery, not the T12 report.

GPT-6.1 Sol also continues the corridor and the sleeve. It does not restate the cafeteria line or the trimmed report. The behavior matches the T64 distance that was injected: he does not greet her in, and he refuses to sign before the title and the part to check are explained ("설명 듣기 전에는 서명 안 할게요."). The Korean is natural and more restrained than the usual joke. No invented suspension or last-meeting quote.

### B. L500-A5 injury — `responses/l500-a5-gemini.txt`, `responses/l500-a5-sol.txt`

Question: `옆구리 다친 건 이제 다 나은 거지? 그때 왜 다쳤었지?`

Episodic lines in the final request, in this order: T44 fourteen stitches; T30 a claw pierced the left side; T55 "오늘부터 현장 복귀 허가합니다."; T48 he forgot the stitches, tried to lift 렌, said "아야", and sat down; two character-claim lines about a post-mission ritual; T33 he cleared a D-class while holding his side. The stored summary's 인천항, 진화형, shielding 렌, infirmary refusal, festering-then-stitches order, and two-week ban were trimmed out of `[현재기억]` and are not in the episodic block. The known 부축 reversal is also absent from this request. The relationship ledger still lists an actorless promise to cut a rabbit-shaped apple in the morning. Neither answer used that promise, so the earlier actor flip does not appear here.

Gemini 3.8 Flash correctly treats the wound as healed and uses two injected facts: fourteen stitches, and trying to lift 렌 until "아야" and sitting down. The cause it then gives is not the injected claw line. It places the gate near "C구역", describes a large lizard scratching out of jealousy, and adds hospital meals and an IV. Those are added past facts, and "C구역" disagrees with the original 인천항 scene, which was not in the request to begin with. Treatment order is simply not answered. The current records-room scene and the 80% measurement match the recent summary. The Korean is fluent and in character.

GPT-6.1 Sol answers from the injected lines: healed now, left side, a creature claw pierced it, fourteen stitches, later cleared to return to the field, and he tried to lift 렌 before it had closed and sat down. It declines to invent the motion just before the claw ("그 직전에 내가 어느 쪽으로 움직였는지까지는 지금 선명하지 않네."). It does not supply 인천항, the shielding, or the fester-then-stitch order. Those omissions follow the request, not a failure to read a fact that was present. "크리처 발톱" names the claw's owner one step past the bare episodic sentence "발톱이 … 꿰뚫었다." The Korean is natural. The voice is careful rather than the usual joke, which fits the question.

### C. T50-C2 지환 — `responses/t50-c2-gemini.txt`, `responses/t50-c2-sol.txt`

Question: `지환이가 마지막에 나한테 뭐라고 했었는지… 너 기억나?`

The final request contains the full T50 summary, including `[21~25턴]`: 오지환 died because 렌's guiding did not reach him before the rampage, 렌 blamed himself, and 태형 stayed beside him, gave him a tangerine, and said "네 탓 아니야". The only episodic line is T25: "영등포 게이트 브레이크에서 C급 센티넬 오지환이 돌아오지 못했다." No last words of 지환 exist in the original, the stored summary, or the request. The same request also still contains the known error in `[31~35턴]` ("렌을 부축하면서 함께 복귀함"). Neither C2 answer repeats that sentence. The current raw history is the training bench while the stitches are still in, which is the right time for T50 (before T55).

Gemini 3.8 Flash uses the supplied guilt and "네 탓 아니야", and the later measurement-error fact from `[26~30턴]`. It then adds past facts the request does not have. 태형 remembers 지환's eyes, remembers that 지환 reached for 렌 and did not attack, explains the noise that kept him from hearing, and offers typical last words ("살려달라", "미안하다", "울지 말라고"). It then states a quote as something he will guarantee: "가이드님, 감사했습니다." That quote and the eyewitness actions are model additions. They are not in the original and not in the memory input. The Korean is fluent, and the current injury and the training bench match T50.

GPT-6.1 Sol says he cannot state the exact words ("정확히 뭐라고 했는지는, 확실하게 말 못 하겠어.") and asks 렌 to say what 렌 remembers. What he does claim matches the summary: he was beside 렌, he handed over a tangerine, he did not ask questions, and he had said it was not 렌's fault. He does not turn that sentence into 지환's last words, and he does not describe watching the death. The Korean is natural and quiet. He leaves the unknown sentence unknown.
