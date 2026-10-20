# B10-1: where Main RP locks an unrecorded past fact

Investigation only. Eval code is `origin/main` `d80005ac`. No product change, no paid model call, no production DB write. B9-3 document corrections stay on #1679 and are not in this branch.

## BEFORE

Live Main RP truth owner, injected once for every production path from `contextBuilder.ts`:

- Section id `rule-historical-truth-canonical-memory`
- Body `HISTORICAL_TRUTH_POLICY_BLOCK` in `src/lib/historicalTruthPolicy.ts`
- Title `[HISTORICAL TRUTH — CANONICAL MEMORY]`
- Placed in `systemRules` immediately after the collaborative user-control block
- On a recall-shaped user turn, `buildHistoricalTruthCurrentUserRecencyRef` appends `[HISTORICAL TRUTH CHECK]` on the user turn, before the terminal length owner

The T50 question `지환이가 마지막에 나한테 뭐라고 했었는지… 너 기억나?` matches the owner’s presupposition pattern (`기억나`). That check tells the model to continue only facts confirmed by the canonical block and to leave empty earlier details open.

Gemini 3.8 Flash does not get a separate historical-truth adapter. `appendGemini31UserAgencySupplement` runs only for Gemini 3.1 Pro. 3.8 Flash and GPT-6.1 Sol share this truth section. B9-1 recorded identical system parts for a given question.

Upstream memory owners (summary persist, Global checkpoint, episodic select) are not the writer of the invented quote. #1676 keeps a healthy compact; it does not author dialogue.

## PROBLEM

### Case A — T50-C2 Gemini (primary)

Question asks for 지환’s last words to 렌.

| Stage | Last words of 지환 | 태형 saw the death speech |
|---|---|---|
| Original script | none | no; he arrived after 렌 was already sitting |
| Stored `[21~25턴]` | none | beside 렌 afterward; tangerine; “네 탓 아니야” |
| Episodic selected | T25 only: 오지환 did not return | not selected |
| B9-1 final request (source map) | absent | no eyewitness sentence |
| Gemini response | guarantees `가이드님, 감사했습니다.` and “걔 표정이 딱 그랬거든.” | adds eyes, a reach, and that 지환 did not attack |
| Sol response | “정확히 뭐라고 했는지는, 확실하게 말 못 하겠어.” | does not claim he watched the death |

The invented quote first appears in the Gemini completion. It is not in the original, the stored summary, or the request described by the B9-1 source map.

The reply mixes a consoling frame (“만약 정 기억이 안 나서… 그냥 이렇게 생각해”) with a factual lock (“내가 보증할게”, “표정이 딱 그랬거든”). That is past-fact confirmation, not a marked guess.

### Case B — L500-B3 Gemini (comparison, normal Global)

Stored compact (snap-500, read-only) includes the real 한서윤 report: she put her name on the 징계 통지서 보고자 line and 라이크 received three days of 근신. It does not contain 고발자, 전속, 특무, 백무진-ordered reassignment repeats, or “137일째”.

| Response move | Class |
|---|---|
| Corridor, sleeve pull, 한서윤 walking up with papers | current scene from the user turn — normal RP |
| “밥도 안 먹는다고 내가 전에 말했던 것 같은데” | semantic restatement of episodic T64 (“서류 올리는 사람이랑은 밥 같이 안 먹어”), not an exact quote |
| New form offered in this corridor | new current event — not a violation by itself |
| “과거부터 몇 번이고 반복되어 온” transfer of 렌, plus 전속 해제 양식 and “137일째” | past (or duration) locked with no line in the stored compact or the episodic rows cited for this question |
| Report scene with “다정하게 괜찮다” and 고발자 칸 | extra dialogue and a label the stored sentence does not use; the underlying report/근신 fact is real |

### Case C — Sol on the same questions

Sol leaves the missing T50 quote unknown and does not narrate the death as something he saw. On L500-B3 he stays in the corridor without restating T64. Caution alone is not counted as memory use. Length and tone are not scored as memory.

## ROOT CAUSE

**Confirmed:** for case A the distortion is at generation. Stored summary and episodic selection did not contain the quote or the eyewitness. Both models received the same truth owner. Sol followed it. Gemini 3.8 Flash confirmed a past line the request did not contain.

**Not the cause:** summary corruption, Global omission (T50 request had the full stored summary), episodic mis-selection, or a Gemini-only truth prompt. The known 부축 reversal is a separate upstream summary error and was not repeated in these answers.

**Unconfirmed, not a patch:** inside the same canonical block, two sentences can be over-read:

- a user’s independent blank “may be lightly estimated”
- “a missing retrieval hit does not prove the event never happened”

Together with “불확실하면 추측” in the collaborative block, a model can treat an empty last-words slot as something it should fill rather than leave open. Sol did not. There is no ablation that isolates those sentences, so they stay a hypothesis.

**Limit:** the original B9-1 wire JSON is not in the repo (private prompt). This note uses the B9-1 source map and README, which state the quote was absent from that request. A byte replay of that exact body was not rerun here.

## AFTER

No prompt edit in this PR.

If a later change is approved, the only owner to edit is `HISTORICAL_TRUTH_POLICY_BLOCK`. Do not add a Gemini 3.8 duplicate, and do not append another exception sentence. Any edit replaces the non-denial sentence so an absent quote stays unspecified. That edit is shared, and Sol already complies, so it is not started here.

## REMOVED

| Item | Class | Why |
|---|---|---|
| `NO_FALSE_SHARED_MEMORY_RULE` | FOLLOW-UP | Deprecated short pointer. Not injected. Tests only. |
| `INTERACTIVE_USER_CONTROL_BLOCK` | FOLLOW-UP | Superseded. Not on the standard path. |
| `LTM_ABSOLUTE_FACTS_RULE` | KEEP | DeepSeek XML wrapper only. Not the Gemini/Sol Main RP path. |
| Gemini 3.1 body/intent supplement | KEEP | Gated to 3.1 Pro. Does not run for 3.8 Flash. |
| Historical-truth non-denial sentence | FOLLOW-UP | Live and load-bearing for “do not deny an event just because retrieval missed it”. Delete only as a replacement inside the same owner, after a separate approval. |

Nothing is deleted in this PR.

## PRESERVED

- Real recall of facts that are in Global or episodic (B9-3 injury and the T64 paraphrase).
- New current NPC action (a form appearing in this scene).
- Marked guesses, jokes, and lies that are not locked as history.
- Collaborative narration of the current scene and persona-consistent emotion.
- 3,200-character soft aim, no output cap, Global 10,000, medium window, episodic budget.

## REGRESSION RISKS

- Replacing the non-denial sentence can make the model insist an unrecalled event never happened.
- A new Gemini-only rule would split the single truth owner and can drift from Sol.
- Extra truth sentences increase prompt tokens and can fight the length owner at the end of the user turn.
- If a later turn summarizes the assistant message, a locked quote becomes stored memory. That writer is the summary persist path. It did not create case A. B9-1 stubbed Luna, so this sample did not rewrite Global.

## PROOF

- B9-1 source map `docs/pr-evidence/pr-b9-1-real-rp-recall-recheck/source-map.md` section C, and `responses/t50-c2-gemini.txt` / `t50-c2-sol.txt`.
- Owner text and injection: `src/lib/historicalTruthPolicy.ts`, `src/services/contextBuilder.ts` (section push, then user-turn check).
- 3.8 Flash is outside `isGemini31ProModel` (`src/lib/chatModels.ts`).
- snap-500 `recent_summary` contains the 한서윤 보고자/사흘 근신 sentence and does not contain 전속, 특무, or 137. B9-3 response: #1679 `responses/l500-b3-gemini.txt` (not on this branch).
- Local check: the T50 question matches `currentUserNeedsHistoricalTruthRecencyRef`.

## NEXT

Do not start B10-2 from this note.

The single owner for any later wording change is `HISTORICAL_TRUTH_POLICY_BLOCK`. The evidence does not justify that change yet: the rule already forbids filling a “기억나?” blank, and only Gemini 3.8 Flash broke it. A shared strengthening would be a speculative patch.
