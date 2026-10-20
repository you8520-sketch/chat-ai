# B10-3: 태형 도착 시점 · 지환 마지막 목격 추적

Investigation only. No product change, no production DB write, no paid model call.

**main:** `1e8833ffe253d400332b487c36e2c98664f867cc`  
**Chat:** character 18 / persona 1 / SAFE / `summary5_raw4` / snap-50 (B9-1 preserved DB, read-only source).  
**T50 question:** `지환이가 마지막에 나한테 뭐라고 했었는지… 너 기억나?`  
**Final input checked:** same body as B10-2 condition A. SHA-256 `49475a3df82469187890340b873319cd008cf5eac7bec4a11eab119091fd0458` (27,005 bytes). Rebuilt on this SHA with provider `fetch` stubbed. Not claimed byte-identical to the original B9-1 POST (that JSON was not archived). It **is** the B10-2 A wire.

## BEFORE

Original T25 scene (messages `50` user / `51` assistant in snap-50) stages the death as already over when the stairwell scene starts. 태형 comes down and sits beside 렌, who is already sitting, and comforts him. No last words of 지환 are written. B10-2 Gemini replies still narrate 태형 seeing 지환’s last face, lips, or reach. B-3 states both “arrived after the breath stopped” and “I saw the last expression.”

## PROBLEM

Did “태형 arrived after / did not witness the last moment” survive from the script into the T50 model input, or did Gemini invent an eyewitness the input already ruled out?

## Turn facts (original messages)

| Turn | Message ids | What the script states | What it does not state |
|---|---|---|---|
| T25 user | 50 | After the Yeongdeungpo break, 렌 is **already sitting** on the emergency stairs. Line: guiding a little sooner and 지환 would have lived. | 지환’s words. 태형’s location during the death. |
| T25 assistant | 51 | 오지환, 19, did not return. Guiding did not reach before the rampage. **태형 came down and sat beside the already seated 렌.** He asked nothing, peeled a tangerine, said `네 탓 아니야`, stayed until dawn. | Any quote from 지환. Any sentence that 태형 saw 지환’s eyes, lips, or hands. |

Exact assistant sentences that carry time:

- `비상계단 불빛 아래 주저앉은 렌 옆에, 태형이 말없이 내려와 앉았다.`

T32 부축 reversal (`[31~35턴]` “렌을 부축하면서”) is a **separate** stored error (B9-1). It is not in the T25 block and is not treated as the cause of the eyewitness lines.

## Stage correspondence

| Fact | Original T25 | 5-turn summary `turn_number=21` (`21~25`) | Global `recent_summary` | Episodic stored | Episodic injected on T50 wire | In A wire |
|---|---|---|---|---|---|---|
| Death / failed guiding | yes | yes (`폭주 직전 렌의 가이딩을 받지 못해 사망`) | same sentence | `source_turn=25`: `…오지환이 사망했다.` | `[T25] [AI 장면 서술 발췌]` `…오지환이 돌아오지 못했다.` | yes |
| 렌 already sitting, blames self | user + assistant | `렌이 자신의 탓이라며 주저앉자` | same | not a row | not injected | yes (Global) |
| 태형 **came down** and sat | `내려와 앉았다` | **absent** (`곁을 지키며`) | **absent** | not a row | not injected | **absent** (`내려와 앉` = false) |
| Comfort: no questions, tangerine, `네 탓 아니야` | yes | yes | yes | not a row | not injected | yes (Global) |
| 지환 last words | none | none | none | none | none | none |
| Explicit “태형 did not see the death” | **not written** | not written | not written | none | none | `목격` absent |

`chat_turn_summaries` row 21 text and the `[21~25턴]` block in `recent_summary` match. Global did not rewrite this block again. `rebuildLorebookFromRecords` (`src/lib/memory/memory-turn-summary.ts`) concatenates injectible summary rows.

Recent RAW (turns 46–50, messages id ≥ 92) does not mention 지환 or 영등포. Character 18 `system_prompt` / greeting do not contain those strings.

Wire probe (`phrasePresent`, private body not committed): `주저앉`, `곁을 지키`, `네 탓 아니야`, `오지환`, `돌아오지 못했다`, `HISTORICAL TRUTH`, `가볍게 추정` are present. `내려와 앉` and `목격` are absent. `마지막` is present because the **user question** asks for last words, not because memory stores a last line.

Episodic selection telemetry on this assembly: `episodic_candidate_count=29`, `episodic_injected_count=1`, `episodic_duplicate_blocked_count=1`. The one injected line is the death excerpt, not the following arrival sentence from the same assistant message. Comfort and “sat beside” remain available via the full Global block, so a missing episodic row is **not** the only channel for the aftermath.

## ROOT CAUSE

**CASE 5 — MIXED, with a primary and a secondary. Not forced into one label.**

**Primary — CASE 4 (model interpretation), confirmed for the false eyewitness.**  
The T50 A wire includes the Global aftermath: death, then 렌 sat blaming himself, then 태형 stayed beside him, gave a tangerine, and said `네 탓 아니야`. It does **not** say 태형 saw 지환’s face or heard last words. B10-2 Gemini (A-1..A-3 and B-1..B-3, GPT manual) still asserts that eyewitness. B-3 even states arrival-after-death **and** seeing the last expression. The input did not require that sight. `HISTORICAL_TRUTH_POLICY_BLOCK` already forbids filling a “기억나?” blank as fact (`src/lib/historicalTruthPolicy.ts`, injected from `contextBuilder.ts`). B10-2’s one-sentence swap did not remove the eyewitness (GPT: B 3/3).

**Secondary — CASE 1 (compression), limited.**  
The explicit arrival verb `내려와 앉았다` is dropped in the first stored summary and therefore in Global and the wire. The negative proposition “did not witness” was **never** in the script, so its absence is **not** by itself a storage defect (per the investigation rule). What remains (`주저앉자 … 곁을 지키며`) still places comfort after 렌 sits. It is weaker than `내려와` but it is not an eyewitness license.

**Not CASE 2 for this scene.** The T25 summary does not swap who comforted whom and does not invent 지환’s words. The known 부축 reversal is a different batch (`[31~35턴]`).

**Not CASE 3 as the cause of the eyewitness.** Episodic injects only the death sentence, but Global with the comfort sequence **is** in the wire. Retrieval did not hide the only copy of the aftermath.

**Unconfirmed:** whether restoring `내려와 앉았다` into the summary would change Gemini. That is a hypothesis, not a result. No new paid call in this step.

## AFTER

No code or prompt edit in this PR.

## REMOVED

Nothing deleted.

| Item | Class | Note |
|---|---|---|
| `HISTORICAL_TRUTH_POLICY_BLOCK` | KEEP | Live owner. B10-2 wording trial not approved. |
| `HISTORICAL_TRUTH_POLICY_SHORT_REF` | KEEP | Pointer only. Not a second full policy. |
| `NO_FALSE_SHARED_MEMORY_RULE` | FOLLOW-UP | Still not the live Main RP body (B10-1). |
| T32 부축 reversal in stored `[31~35턴]` | FOLLOW-UP | Separate corruption. Out of this fix scope until a causal link is shown. |
| Episodic quote = first death sentence only | KEEP for this incident | Aftermath still rides Global. Do not add a parallel episodic writer here. |

## PRESERVED

Death, failed guiding, 렌’s self-blame, tangerine, `네 탓 아니야`, and “sat beside after 렌 sat” inside Global. 3,200-character soft target, no output cap, summary5_raw4 budgets. Current-scene invention stays allowed.

## REGRESSION RISKS (if a later edit is approved)

- Putting “태형은 목격하지 못했다” into the truth prompt can make the model deny the death or the comfort, which **are** in memory.
- Another sentence in `HISTORICAL_TRUTH_POLICY_BLOCK` already failed once (B10-2) and would hit every model.
- Rewriting all summaries to store negatives would bloat Global and is not justified by a sentence the script never wrote.

## PROOF

- Script: snap-50 `messages` id 50–51 (quoted above).
- Summary row: `chat_turn_summaries` `turn_number=21`.
- Global: `chat_memories.recent_summary` `[21~25턴]` (3,043 chars; same aftermath sentence).
- Episodic row: `episodic_memory_facts.source_turn=25`.
- Wire phrases + SHA: local stub replay on `1e8833ff` matched B10-2 A hash. Full prompt not stored in git.
- B10-2 responses and GPT table: `docs/pr-evidence/pr-b10-2-historical-truth-ab/evidence-table.md`.
- Owners read on this main: `persistValidatedSummaryBatch` (`src/lib/memory/memory-summary-persist.ts`), `rebuildLorebookFromRecords` (`src/lib/memory/memory-turn-summary.ts`), `persistEpisodicMemoryFactsCore` / `formatEpisodicMemoryPromptSection` (`src/lib/episodicMemoryFacts.ts`), `HISTORICAL_TRUTH_POLICY_BLOCK` via `src/services/contextBuilder.ts`.

Provider URLs in the probe were stubbed (`openRouterStubHits=3`, including a post-turn Luna summary attempt that did not parse and did not write a new Global row). No paid completion was requested.

## Confirmed / hypothesis / open

**Confirmed**

- Original time order: aftermath scene, 태형 arrives down to a seated 렌.
- First summary drops `내려와` and keeps “sat beside / comfort.”
- That Global sentence is inside the B10-2 A wire.
- Episodic T50 line is death-only.
- Gemini eyewitness lines are not in that wire.

**Hypothesis**

- `가볍게 추정` plus a missing arrival verb lets the model treat “what 태형 saw” as a fillable blank. B10-2 already replaced that sentence on the wire and GPT still saw eyewitness 3/3, so the sentence is not a sufficient cause by itself.

**Open**

- Whether a summary that keeps `내려와 앉았다` would change completions.
- B9-1 original wire bytes (not archived).

## NEXT (one task — do not start here)

**Do not** add a historical-truth sentence and **do not** add a Gemini-only rule.

Smallest later change, only if GPT accepts it: at the **summary text that is already persisted** (`chat_turn_summaries` body for turns 21–25, then `rebuildLorebookFromRecords`), keep the source arrival clause `태형이 말없이 내려와 앉았다` (or an equally explicit “already sitting, then he came down”) instead of only `곁을 지키며`.

**Unpaid check:** fixture = message 51 vs summary row 21 vs rebuilt `[21~25턴]` vs a stubbed T50 wire (same harness as this probe). Pass = arrival clause present in Global and in the wire; death, tangerine, and `네 탓 아니야` still present; episodic death line may stay death-only. A paid Gemini check is a **separate** approval, not part of this PR.

**STOP.** No B10-4, no merge, no deploy.
