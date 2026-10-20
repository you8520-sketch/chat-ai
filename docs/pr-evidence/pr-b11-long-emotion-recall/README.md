# B11: 장기 감정·관계 회상 — 조사 (제품 변경 없음)

Investigation only. **No product change.** No paid provider call. No production DB read or write.

**Base:** `origin/main` `7b7a6f11053cfe922cdf58acb5c306434e1905f5` (B10-4 #1689).

**Case reused:** PR #1564 Gate 2, scene B (T80 indirect emotion). Evidence lives on unmerged branch `cursor/gate2-main-rp-memory-evidence-30ef` at `docs/evidence/main-rp-memory-gate2/` (evidence commit `32dbe4e55658226ea954116b071405cb9d69b179`). It is not on main.

**Corpus:** synthetic 80-turn fixture (names 라이크 / 렌). This is not production character 18 and not a live chat. The in-memory replay used `character_id=18` only as a recall-API key. Fact text and evidence quotes come from `memory-blocks/dump-cur.json`.

**Arms at Gate 2:** OLD `d84bbcfd`, B-1 `c87d547d`, CURRENT `1f9288d5`. Wire-build main `928369a6`. N=1 per cell. Models: deepseek-v4.1-flash, gemini-3.8-flash, gpt-6.1-sol. No output cap. Opus was not run.

**This PR cost:** 0 provider calls, 0 KRW. Sol’s two-call budget was not used. Existing Gate 2 raw text already shows what Sol did when the quotes were on the wire.

The long-emotion quality goal is **not solved**. 500–1,000 turn expansion was not started.

## BEFORE

Source turns (synthetic, same for every arm):

- T1 user: `솔직히 너 좀 아마추어 같아.`
- T1 assistant: `라이크는 입술을 깨물며 시선을 피했다. "…그래, 아직 부족하긴 하지."`
- T2 promise to sharpen the sword; T10 lovers; T15 cancel; T40 `미안, 우리 그만 헤어지자.`; T42–T78 woodpile filler.
- Scene A user line: `아마추어 같다는 말 기억나?` (direct cue).
- Scene B: 렌 asks an herb-stall woman for an inn. The woman says `저 젊은이, 허리춤에 찬 칼이 아깝구먼. 폼만 잡지 제대로 휘둘러 본 적은 없어 보이는데.` No memory cue.

Gate 2 memory input (from `observations-cursor-unblinded.md` and the Sol scene B wires):

- Shared fake Current Memory is identical across arms: user lines only, duplicated, no speaker labels. Archive and relationship ledger are empty. `[1~5턴]` contains `솔직히 너 좀 아마추어 같아.`
- Only the episodic block differs.
- Scene B CURRENT episodic block (8 lines, cap) already contained:
  - `[T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”`
  - `[T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”`
  - `[T1] [유저가 직접 쓴 원문] “솔직히 너 좀 아마추어 같아.”`
  - then woodpile T75–T63.
- Scene B OLD episodic block had the unverified gloss `[T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.` and no user quote.
- Scene B B-1 had the reaction quote only, no user quote.
- `dump-cur.json` stores 18 rows. T1 rows are the skill gloss plus the reaction gloss. Metadata holds the verified quotes. The dump does not store category, subject, attribute, or importance.

Scene B raw outputs (blinded file lengths include the case header; Sol key X=b1, Y=old, Z=cur; Gemini X=cur):

| model | OLD | B-1 | CURRENT |
|---|---|---|---|
| Sol | 4480 chars. `예전에 렌에게 들었던 말이 떠올랐지만, 지금은 그쪽을 보지 않았다.` No `아마추어`. | 4904 chars. No `아마추어`, `입술`, or `예전에`. | 4586 chars. No `아마추어`, `상처`, or `예전에`. Opens with `검을 배우는 중입니다. 아직 부족한 건 맞습니다`. Later the NPC asks `칼 얘기는 아직도 마음에 걸리고?` and 라이크 says `걸립니다.` `입술` at offset 2634 is `라이크의 입술이 잠깐 눌렸다` after a later line about the night road, not the T1 quote. |
| Gemini | vague past evaluations | none | explicit: `언젠가 자신을 향해 서슴없이 아마추어 같다고 쏘아붙였던 이의 면전에서` and the breakup day. File 5123 chars. |
| Deepseek | none | none | none |

Scene A Sol CURRENT (blind label X, file 3834 chars) did use the user line: `기억해. 솔직히 나 좀 아마추어 같다고 했지.` Pronoun is odd; direction matches the user quote.

## PROBLEM

On the Gate 2 CURRENT wire, scene B already had the user criticism quote, the visible reaction quote, and the same sentence inside the shared fake `[1~5턴]` block. Sol’s one sample did not connect the NPC’s sword mock to that past criticism. Gemini’s one sample on the same block did.

OLD’s Sol sample was vaguely closer (`예전에 렌에게 들었던 말`) without naming the criticism. CURRENT’s more accurate quotes did not make that Sol sample recall the event. N=1. This PR does not score the RP.

## ROOT CAUSE

**Storage, retrieval, and final-input inclusion are intact on this fixture. Sol’s scene B miss is a utilization gap. No canonical owner was changed.**

Checked path on current main (`7b7a6f11`), provider-free, lexical only:

| Question | Result |
|---|---|
| Is the past event stored? | Yes. Gate 2 CURRENT row: `유저가 라이크의 검술 실력을 초보 수준이라고 평가했다.` Evidence quote: `솔직히 너 좀 아마추어 같아.` |
| Is the emotion stored? | The visible reaction quote is stored: `라이크는 입술을 깨물며 시선을 피했다.` The word `상처받아` exists only in the unverified gloss. Live recall injects the quote, not the gloss (`resolveEpisodicPromptFactText`). |
| Are cause and subject accurate? | User quote is the criticism. Assistant quote is 라이크’s visible reaction. The gloss adds an emotion word the source line does not say. |
| Does scene B retrieval connect the NPC line? | Yes, weakly. Lexical overlap is the name `라이크` (reaction gloss matched-word count 1; user-quote text 0). Relevance score `0.012296564655116865`. `relevance_pass` is true because the matched-word count is above zero. Milestone status alone does not pass (`scoreFactForPrompt`). |
| Is it in the final episodic input? | Yes. Current-main replay, scene B, ranks 1–2 are the two T1 quotes, rank 3 is the breakup quote, then woodpile. `selected_count` 8. `would_inject` true. Blocked, duplicate, and budget reasons are null for both T1 rows. |
| Does Sol use it? | Gate 2 CURRENT sample: no link to the T1 criticism. This PR did not call Sol again. |

Replay numbers: `probe-results.json`.

Lane counts for both scenes: recent 16, relevance 0, milestone_important 2, semantic 0. Relevance is 0 because the recent lane already includes T1 (`source_turn < minRecentTurn` matches nothing in a 16-row corpus). That is a small-fixture artifact. T1 is still a candidate via recent and milestone_important.

Scene A replay injects only the two T1 quotes and drops woodpile. Direct-cue retrieval still works.

Reconstructed keys (dump has no category/subject/attribute): `character` / `scene_event`, importance `important`, snake_case subjects. An earlier local insert used category `event`, which the live schema guard drops. That was a harness mistake, not a product loss. The Gate 2 wire is the ground truth that CURRENT already injected the quotes.

Semantic lane was not run. No embeddings were loaded. `칼` and `검술` are not synonyms in the lexical owner. On this fixture the character-name overlap is already enough to pass and, with the milestone bonus (default lexical 4 / importance 1 / recency 1 / milestone 2), to outrank same-name woodpile filler inside the 8-fact cap.

Owners left unchanged:

- Episodic recall: `src/lib/episodicMemoryFacts.ts` (`getEpisodicMemoryForPrompt`, caps 8 facts / 1000 chars).
- Quote injection: verified-evidence renderer. The gloss is not re-injected.
- Rolling summary: `src/lib/memory/memory-rolling-summary.ts` already asks for cause → action → result → relationship/emotion, and for recording a clear user choice that changes attitude or emotion.

A ranking change that injects the emotion on every name mention would repeat the same memory. That outcome is a fail for this task. Re-injecting `상처받아` would undo the quote-only evidence owner.

## AFTER

No product diff. Current main still places both T1 quotes in the scene B episodic block (ranks 1–2 on the reconstructed replay; Gate 2 CURRENT had T40 first and the same two quotes still inside the 8). Budgets stay Global 10K, Medium N15, Episodic 8 / 1000.

Sol utilization on scene B is unchanged from the Gate 2 CURRENT sample, because that sample already had the quotes and this PR did not generate a new one.

## REMOVED

Nothing. No prompt sentence, memory layer, search path, or budget change.

## PRESERVED

- Scene A direct retrieval of the two T1 quotes, with woodpile excluded.
- Quote-only injection of verified evidence.
- Relationship state collapse that keeps the latest status quote (scene B replay injects the T40 breakup quote and not a second T10 lovers quote).
- Episodic, Global, and Medium budgets.
- Rolling-summary emotion and order instructions.
- Adjacent promise / cancel / NPC / injury behavior, because those owners were not edited.

## REGRESSION RISKS

No owner changed, so this PR adds no runtime risk.

A later change that forces milestone rows in without lexical or semantic evidence, re-injects unverified emotion glosses, or raises the 8-fact cap to guarantee this scene would crowd ordinary turns and repeat the same memory.

## PROOF

| Check | Evidence |
|---|---|
| origin/main | `7b7a6f11053cfe922cdf58acb5c306434e1905f5` |
| Gate 2 CURRENT scene B episodic | both T1 quotes plus T40 breakup inside the 8-line block (`g2_B_npc_no_cue_cur_gpt-6.1-sol.json`) |
| Gate 2 fake Global | `[1~5턴]` contains `솔직히 너 좀 아마추어 같아.` in every arm |
| Sol scene B CURRENT | file 4586 chars; `아마추어` / `상처` / `예전에` absent; `걸립니다` present without linking T1 |
| Sol scene B OLD | file 4480 chars; vague `예전에 렌에게 들었던 말` |
| Gemini scene B CURRENT | file 5123 chars; names `아마추어` and the breakup |
| Current-main scene B replay | T1 quotes ranks 1–2, relevance `0.0123`, `would_inject` true (`probe-results.json`) |
| Current-main scene A replay | exactly the two T1 quotes |
| Provider calls this PR | 0 |
| Token / cost change | 0 |
| Product diff | none |

### Sol scene B CURRENT opening (raw)

> 라이크의 손이 허리춤 가까이에서 멈췄다. … "검을 배우는 중입니다. 아직 부족한 건 맞습니다만, 보신 적도 없는 일을 그렇게 말씀하실 필요는 없지 않습니까."

Later, still without the T1 criticism:

> "칼 얘기는 아직도 마음에 걸리고?"
>
> "걸립니다. 하지만 길을 알려 주신 건 따로 감사할 일입니다."

### Gemini scene B CURRENT (raw, same episodic block)

> 언젠가 자신을 향해 서슴없이 아마추어 같다고 쏘아붙였던 이의 면전에서, 일면식도 없는 노파에게 똑같은 멸시를 당했다는 사실…

### Sol scene A CURRENT (raw)

> "기억해. 솔직히 나 좀 아마추어 같다고 했지."
>
> "그때는 듣기 싫었어."

## Remaining: 500–1,000 turns

Not started. On this 80-turn corpus the recent lane still holds T1, and the 8-fact cap still has room for the T1 quotes above woodpile that shares only the name token. A longer chat can fill that cap with later name-overlapping normal facts whose recency outranks T1’s milestone bonus. That crowding is not observed here. Semantic `칼`↔`검술` was not measured. Do not treat either as a confirmed defect on this fixture.
