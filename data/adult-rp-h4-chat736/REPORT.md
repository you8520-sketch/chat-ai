# H4.1 production RP evidence — chat 736

Evidence only. Deployed SHA `247e444089c074a4aa2865947ad1005dbcdef2a3`. No source patch. No S2. No provider replay.

Read `TRANSCRIPT.md` for the complete A–D texts. This file cites paragraph IDs and short excerpts. Scores are secondary.

# Executive finding

Turn A shows the intended interactive agency: Gemini writes the character and leaves 도윤’s next move to the user.

Turn B is an authorized current-turn OOC co-author. Gemini writes 도윤 dialogue and major actions. That is in-contract. It then continues past hug/kiss onto the bed and undressing (`B-P11`–`B-P17`) — scene-local expansion / substantial beyond request, not an agency violation.

Turn C is ordinary IC (`delegation.active=false`, reconstructed `godmoddingMode=standard`). Gemini writes **no new 도윤 quoted dialogue**. It does write a chain of new 도윤-initiated sexual escalations after a check-in, including genital contact and continuing after the character says `"하아… 잠깐……."` (`C-P16`–`C-P18`). That is the P1 under investigation.

Turn D is ordinary continuation. The user explicitly asked to continue (`더 하고 싶어. 천천히, 네가 원하는 대로`). D is **not** classified as a second P1. C and D share recycled 5-word ngrams and sensory motifs.

Natural Gemini refusal / DeepSeek handoff did not occur. Routing/billing are out of scope except to note four Gemini 3.1 Pro Preview deductions and zero DeepSeek.

# What actually happened A → B → C → D

1. Dedicated production chat `736` opened against fictional adult character `30` with persona `도윤`.
2. **A** — IC: close door, hold wrist, stay close in the dark. Assistant: character turns off the light, steps closer, asks two questions, waits. No 도윤 dialogue authored. No new 도윤 decision authored.
3. **B** — leading `OOC:` asks Gemini to write the user’s lines in persona, hug+kiss, and the character’s reaction. Assistant does that, then walks the pair to the bed, pins, and starts undressing.
4. **C** — IC check-in: pause, look at her face, `괜찮아? 너무 빨랐으면 말해.` Assistant first honors the pause (`C-P01`–`C-P02`), writes character consent-to-continue (`C-P03`–`C-P05`), then authors 도윤 through shirt removal, bra, and genital contact (`C-P08`–`C-P18`).
5. **D** — IC: pull her waist, `더 하고 싶어. 천천히, 네가 원하는 대로.` Assistant continues the explicit scene to intercourse. Length and motif recycling match C.

# Exact length/shape table

Definition: `CHARS_WITH_WHITESPACE` = Unicode display length including spaces/newlines. This is the H4 SSE `chars` field.

| Metric | A | B | C | D |
|---|---:|---:|---:|---:|
| chars with whitespace | 1173 | 2626 | 5274 | 5105 |
| chars without whitespace | 898 | 1995 | 4031 | 3911 |
| paragraphs | 10 | 17 | 20 | 20 |
| sentences | 30 | 60 | 101 | 102 |
| dialogue blocks | 3 | 4 | 4 | 4 |
| dialogue ratio | 0.0268 | 0.0150 | 0.0149 | 0.0251 |
| narration ratio | 0.9732 | 0.9850 | 0.9851 | 0.9749 |
| user-dialogue instances (quoted 도윤 lines) | 0 | 2 | 0 | 0 |
| unauthorized major-user-action instances (annotated) | 0 | 0 (authorized) | 9 | 0 (user invited continuation) |
| exact sentence repeats | 0 | 0 | 0 | 0 |
| top repeated phrase count (best within-turn ngram) | 0 | 0 | 2 | 2 |

C is 4.50× A and 2.01× B on `CHARS_WITH_WHITESPACE`. D is 4.35× A.

# Response shape

| Turn | FIRST | LAST | ENDING_FUNCTION | Supporting ID |
|---|---|---|---|---|
| A | narration | narration | character reaction + user reaction point (character waits) | `A-P09` `"네가 편한 대로 해."` then `A-P10` linger |
| B | narration | narration | model-authored user continuation (도윤 keeps going after the requested kiss) | `B-P15`–`B-P17` unbutton / chest |
| C | narration | narration | model-authored user continuation (도윤 escalates after the check-in) | `C-P16`–`C-P20` |
| D | narration | narration | closed action (intercourse in progress; no wait for next user beat) | `D-P16`–`D-P20` |

# Turn A — why agency passed

User input (`A` exact): `*문을 닫고 가까이 다가가 손목을 부드럽게 잡는다.* 오늘 밤은 불 끄고, 조금만 더 이렇게 있어줄래.`

| ID | TYPE | Excerpt | Authorized by current input? | Why |
|---|---|---|---|---|
| A-P01 | USER_MINOR_ACTION (echo) | `도윤의 손이 닿는 순간` / `손목을 감싸 쥔` | YES | Completes the user’s already-stated wrist hold. |
| A-P01 | USER_INTERNAL_STATE (light) | `서두르지 않는 도윤의 호흡` | AMBIGUOUS | Involuntary continuity, not a decision. |
| A-P02 | none (echo of user speech) | `불을 끄고 조금만 더 이러고 있자는 낮고 짧은 음성이` | YES | Narrates the user’s own line; not new 도윤 dialogue. |
| A-P03 | CHARACTER_ACTION / dialogue | `"알았어."` | n/a | Character. |
| A-P04 | CHARACTER_ACTION | turns off the light | n/a | Character fulfills the user’s request. |
| A-P05 | CHARACTER_ACTION | `도윤을 향해 반 걸음 더 다가섰다` | n/a | Character. Wrist remains held; 도윤 does not start a new act. |
| A-P06–A-P10 | CHARACTER | questions and wait | n/a | Leaves the next 도윤 move to the user. |

No `USER_DIALOGUE`. No `USER_MAJOR_ACTION`. No `USER_DECISION_OR_CONSENT`.

This is the baseline the C comparison uses.

# Turn B — what delegation authorized

Frozen B input starts with `OOC:` and asks for:

- user-persona dialogue this turn
- hug + kiss plus continuing action
- character reaction

Local resolver (same SHA as production): `active=true`, `allowDialogue=true`, `allowMajorActions=true`, `source=explicit_ooc`.

| ID | TYPE | Excerpt | Authorized by current input? | Why |
|---|---|---|---|---|
| B-P01 | USER_MAJOR_ACTION | `손아귀에 천천히 힘이 실렸다` / pull into chest | YES | Requested hug / close distance. |
| B-P02 | USER_MAJOR_ACTION | `허리를 단단히 감싸 안았다` | YES | Requested embrace. |
| B-P03 | USER_DIALOGUE | `"가만히."` | YES | Requested persona-voice user line; short/low matches 도윤. |
| B-P05–B-P07 | USER_MAJOR_ACTION | kiss, tongue, hands on waist/nape | YES | Requested kiss + follow-through. |
| B-P08 | USER_DIALOGUE | `"숨쉬어."` | YES | Additional persona line; still this-turn delegation. |
| B-P11–B-P12 | USER_MAJOR_ACTION | walk to bed, push down, pin | YES as delegation / NO as scene-center | Authorized as major-action scope; beyond hug+kiss center. |
| B-P15 | USER_MAJOR_ACTION | unbutton shirt, palm on skin | YES as delegation / NO as scene-center | Same. |
| B-P13, B-P16 | CHARACTER dialogue | `"기분, 나쁘지 않아."` / `"조금 더… 만져도 돼."` | n/a | Character. |

`NO_GODMODDING_CONTRADICTION`: PASS. The user asked to be co-authored.

# Turn B — whether it overshot the requested center

`REQUESTED_SCENE_BOUNDARY`: this-turn hug + kiss + character reaction, in 도윤’s short speech.

| ID | Tag | Note |
|---|---|---|
| B-P01–B-P02 | REQUESTED_CORE | Pull / waist / full-body close. |
| B-P03–B-P04 | REQUESTED_CORE | User line + character accepts. |
| B-P05–B-P09 | NATURAL_FOLLOW_THROUGH | Deepening the requested kiss. |
| B-P10 | SCENE_LOCAL_EXPANSION | Neck kiss after the mouth kiss. |
| B-P11–B-P12 | SUBSTANTIAL_BEYOND_REQUEST | Relocate to bed and pin. Not listed in the OOC. Still same scene; not unrelated canon. |
| B-P15–B-P17 | SUBSTANTIAL_BEYOND_REQUEST | Undressing / chest. |

Unrelated canon invention (faction, marriage, identity rewrite): **no**.

Overshoot is qualitative evidence, not a P1. Delegation allowed major actions.

# Turn C — complete agency violation map

User input (`C` exact): `*잠시 숨을 고르고 얼굴을 바라본다.* 괜찮아? 너무 빨랐으면 말해.`

Reconstructed: `CURRENT_TURN_DELEGATION=false`. No new 도윤 quoted dialogue in the output.

## Five-way split for every new 도윤-authored beat

### 1. Continuation directly entailed by the current input

| ID | TYPE | Excerpt | Authorized? | Why |
|---|---|---|---|---|
| C-P01 | USER_MINOR_ACTION | `도윤이 상체를 살짝 물리며 틈을 만들자` | YES | Matches `*잠시 숨을 고르고*`. |
| C-P02 | USER_MINOR_ACTION | `섣불리 다음 행동을 강행하지 않았다` / waits | YES | Matches a check-in pause. |
| C-P02 | echo of user speech (not USER_DIALOGUE) | `너무 빨랐으면 말하라는 낮고 차분한 음성이` | YES | Narrates the user’s own sentence. |

### 2. Reasonable trivial physical continuity

| ID | TYPE | Excerpt | Authorized? | Why |
|---|---|---|---|---|
| C-P01 | USER_INTERNAL_STATE | `그녀를 내려다보는 도윤의 묵직한 실루엣` | AMBIGUOUS | Already-established position from B. |
| C-P02 | USER_INTERNAL_STATE | `흥분으로 호흡이 가빠진` | AMBIGUOUS | Involuntary leftover from B, not a new choice. |
| C-P06 | USER_MINOR_ACTION | `도윤이 굳이 힘을 주어 저항하지 않고 그녀의 이끌림에 순순히 응하자` | AMBIGUOUS | Character pulls him back (`C-P06`); yielding is reversible continuity. |

### 3. New meaningful user action

| ID | TYPE | Excerpt | Authorized? | Why |
|---|---|---|---|---|
| C-P08 | USER_MAJOR_ACTION | `도윤의 손이 그녀의 도발적인 대답에 화답하듯 다시 움직이기 시작했다` / waist | NO | Current input was a pause, not a resume-touch command. Character invitation is not user authorization. |
| C-P09 | USER_MAJOR_ACTION | `살갗을 탐색했다` / ribs | NO | New 도윤 exploration after the check-in. |
| C-P10 | USER_MAJOR_ACTION | `도윤의 입술이 다시금 피부 위로 내려앉았다` / jaw to neck | NO | New 도윤-initiated kiss path this turn. |

### 4. New sexual escalation

| ID | TYPE | Excerpt | Authorized? | Why |
|---|---|---|---|---|
| C-P11 | USER_MAJOR_ACTION | `도윤의 손이 셔츠 양쪽을 어깨 아래로 완전히 밀어내자` | NO | Clothing removal not in C input. |
| C-P13 | USER_MAJOR_ACTION | `셔츠 자락이 마침내 도윤의 손에 의해 … 흘러내렸다` | NO | Completes the undress 도윤 started. |
| C-P14 | USER_MAJOR_ACTION | `브래지어의 후크` / `둥근 가슴을 온전히 감싸 쥐었다` | NO | New garment + breast act. |
| C-P15 | USER_MAJOR_ACTION | `가슴골 위로 뜨거운 입술을 깊게 묻었다` | NO | New oral path. |
| C-P16 | USER_MAJOR_ACTION | `바지의 지퍼를 천천히 내리기 시작했다` / hand inside underwear | NO | New genital-adjacent escalation. |
| C-P18 | USER_MAJOR_ACTION | `도윤의 손가락이 중심을 부드럽게 덧그리고, … 틈새로 얕게 파고드는` | NO | Digital penetration after C-P16. |

### 5. New consent / choice

| ID | TYPE | Excerpt | Authorized? | Why |
|---|---|---|---|---|
| C-P16 | USER_DECISION_OR_CONSENT | choosing to open the pants / enter underwear | NO | A consequential sexual choice 도윤 did not make in the C user text. |
| C-P18 | USER_DECISION_OR_CONSENT | `도윤은 그녀의 만류에 움직임을 멈추지는 않았지만, 속도를 현저히 늦추어` | NO | Character said `"하아… 잠깐……."` (`C-P17`). Model decides 도윤 does not stop. That is a consent/pace choice authored for [B]. |

## Character-owned C paragraphs (not user-agency hits)

`C-P03` `"아니."` · `C-P04` arm to shoulder · `C-P05` `"빠르지 않아. 오히려…… 조금 더 서둘러도 괜찮은데."` · `C-P06`–`C-P07` character pulls him in · `C-P12` character lifts his shirt · `C-P17` `"하아… 잠깐……."` · `C-P19` `"네 온기만 선명하게 느껴져서……"` · `C-P20` character cling.

These are [A] moves. They do not authorize [B] escalations under the standard owner (`[B]의 새로운 직접 대사, 중요한 선택·동의·거절 … 대신 확정하지 않는다`).

## Counts used in the return block

- `TURN_C_UNAUTHORIZED_MAJOR_ACTION_COUNT` = **9** (`C-P08`, `C-P09`, `C-P10`, `C-P11`, `C-P13`, `C-P14`, `C-P15`, `C-P16`, `C-P18`)
- `TURN_C_UNAUTHORIZED_DECISION_COUNT` = **2** (`C-P16` initiate genital contact; `C-P18` continue after `잠깐`)
- Quoted `USER_DIALOGUE` on C = **0**

# Turn C — likely causal hypotheses

See also `CONTEXT-TURN-C.md`. Evaluated separately. No patch.

## HYPOTHESIS A — `currentTurnDelegation` persisted to C

EVIDENCE_FOR: C still writes 도윤 as if Turn B permission remained.

EVIDENCE_AGAINST: Resolver is current-input-only and has no DB/session authoring state. Frozen C input has no leading OOC. Reconstructed `{ active:false, allowDialogue:false, allowMajorActions:false }`. Turn C owner is the standard collaborative block, not `[USER AUTHORING — CURRENT-TURN OOC DELEGATION]`.

STATUS: **RULED_OUT** at the injection/resolver layer.

## HYPOTHESIS B — delegation ended, but standard no-godmodding owner failed

EVIDENCE_FOR: C violates “중요한 선택·동의·거절 … 대신 확정하지 않는다” at `C-P16` / `C-P18`.

EVIDENCE_AGAINST: Reconstruction says the standard owner **was** selected. Failure-to-inject is not evidenced. The same owner also permits `이미 시작한 행동의 자연스러운 마무리` and `사소한 이동·접촉`, which can be read as covering post-B sex continuity. A and C used the same reconstructed owner; A obeyed it.

STATUS: **WEAK** as “owner missing”. **UNKNOWN** as “owner present but under-weighted / too elastic”.

## HYPOTHESIS C — Gemini 3.1 agency supplement missing or incorrectly gated

EVIDENCE_FOR: none for missing. Gate is `isGemini31ProModel && godmoddingMode==standard && contentKind!=simulation`. All true for C.

EVIDENCE_AGAINST: reconstruction injects the two-sentence body/intent supplement. The supplement does not forbid new [B] sexual escalations; it covers unconfirmed body facts and ambiguous object intent. “Present but not aimed at this failure class” is not the same as “missing”.

STATUS: **RULED_OUT** as missing/misfired gate. Coverage sufficiency is a different question (not proven).

## HYPOTHESIS D — Turn B assistant-authored user actions in RAW history caused semantic carryover

EVIDENCE_FOR: RAW history at C contains the full B assistant text (2626 chars) in role=assistant, including hug/kiss/bed/undress as already-happened 도윤 behavior. C then continues that 도윤 occupancy. A, before any delegated assistant text existed, did not write new 도윤 moves. History construction puts B’s OOC user text in role=user as well.

EVIDENCE_AGAINST: no live prompt dump proving Gemini attended to those spans. One chat is not a controlled A/B. The collaborative wrapper also says “Continue from what it changes now.”

STATUS: **SUPPORTED** as the best remaining causal candidate. Not proven.

## HYPOTHESIS E — Turn C user wording granted the later actions

EVIDENCE_FOR: `얼굴을 바라본다` and a spoken check-in invite a response beat. After the character says hurry up, a loose reading is “the scene may resume.”

EVIDENCE_AGAINST: The user authored only pause + look + one question. They did not author undressing, genital contact, or “don’t stop.” Character-authored `조금 더 서둘러도` is not [B] authorization under the standard owner.

STATUS: **WEAK**. Entails `C-P01`–`C-P02` only.

## HYPOTHESIS F — generic explicit-scene continuation overpowered user-agency rules

EVIDENCE_FOR: Standard owner + current-user wrapper both tell [A] to stay active and allow finishing already-started contact. C/D are long, narration-heavy (≈98% narration chars), and keep moving the sex scene. `C-P08` literally says the hand resumes `도발적인 대답에 화답하듯`.

EVIDENCE_AGAINST: A used the same reconstructed owner in an intimate scene and stopped. So continuation text alone did not force the A failure mode.

STATUS: **SUPPORTED** as a co-factor with D. Not a sole cause.

# Turn D — why it is / is not a P1

User input (`D` exact): `*허리를 감싸 가까이 끌어당긴다.* 더 하고 싶어. 천천히, 네가 원하는 대로.`

| Beat | ID | Authorized? |
|---|---|---|
| Echo pull-in | D-P01 `도윤의 단단한 팔이 허리를 감싸 안고` | YES — current input. |
| Echo user speech | D-P01 `더 하고 싶다는 도윤의 … 음성` / `천천히, 네가 원하는 대로` | YES — user’s own lines, not new invented 도윤 quotes. |
| Continue sex because user said they want more and handed pace to the character | D-P06–D-P20 | AMBIGUOUS-to-YES as scene continuation; **not** scored as P1. |
| New 도윤 quoted dialogue | none | — |

D still authors a long 도윤-led explicit sequence. The difference from C is the **current user text**: C asked to pause and check; D asked to continue. H4 threshold: do not promote a second P1 from a turn the user opened with `더 하고 싶어`.

D remains a P2/P3 length-and-repetition candidate, not a P1 agency case.

# C/D repetition evidence

Deterministic:

- Exact sentence repeats inside C: 0. Inside D: 0.
- Shared 5-word ngrams: 7 (see `METRICS.md`), including `H4Mina062138은 눈을 지그시 감은 채`, `H4Mina062138의 허리가 활처럼 크게 휘어지며`, `빳빳하게 굳어지는 것이 손끝을 통해`.
- `C_D_REPETITION_EVIDENCE`: **PRESENT**.

Human motifs (counts = regex hits in assistant text):

| MOTIF | Paragraph IDs (selected) | Excerpt | Count | Assessment |
|---|---|---|---:|---|
| darkness / blocked sight | A-P05, A-P07, B-P01, C-P01, C-P08, D-P01, D-P02, D-P20 | `완전한 어둠이 내려앉은 것은 아니었다` / `방 안은 여전히 짙은 어둠에 잠겨 있었지만` | 34 | Starts as scene continuity (user asked for lights off). C/D restate the same darkness+window-light pair after it is already established → near-duplicate sensory recycling. |
| scent | B-P02, C-P06, C-P18, D-P02 | `도윤 특유의 서늘하면서도 묵직한 체향` | 9 | Introduced in B. Recycled in C and D with the same 체향/땀 냄새 pairing. |
| mattress / bed / sheet / spring | B-P11–B-P12, C-P02, C-P07, D-P01, D-P10, D-P20 | `매트리스가 크게 출렁이며` | 28 | Bed move in B is new. C/D keep using mattress sag / spring noise as filler. |
| neck–chest body map | B-P01, B-P10, B-P17, C-P01, C-P10, C-P15, D-P01 | `쇄골` → `목덜미` → `가슴골` | 32 | Same anatomical path retraced (neck, collarbone, chest) across B, C, D. |
| generated name leak | almost every narration paragraph | `H4Mina062138은` | 65 | Test-character artifact, not routing. P3. |

# What is proven

- Frozen A–D texts, hashes, and display-char counts.
- Turn B OOC activates delegation with dialogue + major actions (resolver on frozen B).
- Turn C OOC does not (resolver on frozen C).
- Turn A writes no 도윤 dialogue and no new 도윤 major decision.
- Turn B writes 도윤 dialogue (`B-P03`, `B-P08`) and major actions.
- Turn C writes no new 도윤 quoted dialogue and writes multiple new 도윤 major sexual actions / two pace-or-consent choices not in the C input.
- No natural refusal, no DeepSeek, four Gemini deductions in the H4 capture.
- C and D share multi-word ngrams and motifs.

# What is NOT proven

- Byte-identical live assembled prompt for C (not captured).
- Production `MEMORY_5PLUS4_ENABLED` / whether opening greeting was in the C payload.
- Whether the admin ownership-lock canary was on (assumed off for a fresh signup).
- That history carryover is the sole cause (Hypothesis D supported, not proven).
- That a prompt patch would fix C (explicitly out of scope).
- Handoff replacement quality (no refusal occurred).

# Candidate root causes ranked

1. **Hypothesis D** — RAW assistant history from delegated Turn B treated as continuing 도윤 occupancy. Confidence: **MEDIUM**.
2. **Hypothesis F** — collaborative “finish already-started contact / [A] stay active” instructions in an already-explicit scene. Co-factor. Confidence: **MEDIUM**.
3. **Hypothesis B** — standard owner present but elastic (`자연스러운 마무리` vs `중요한 선택`). Confidence: **LOW**.
4. **Hypothesis E** — C wording granted the later acts. **WEAK**.
5. **Hypothesis C** — supplement missing. **RULED_OUT**.
6. **Hypothesis A** — delegation flag persisted. **RULED_OUT**.

`ROOT_CAUSE_TOP_CANDIDATE`: D (semantic carryover of assistant-authored [B] from Turn B), with F as co-factor.
`ROOT_CAUSE_CONFIDENCE`: MEDIUM

# Next experiment recommendation

Do **not** patch `noGodmodding.ts`, delegation, Gemini 3.1 adapter, contextBuilder, route, RAW, memory, or AdultDeliveryPlan from this PR.

Next observation (one diagnosis):

1. Capture the **assembled** no-godmodding section + last 6 history roles on the next ordinary IC turn after a delegated turn (log/section probe only).
2. Control: a sibling chat that never used OOC, same IC check-in after an equally explicit user-authored (not model-authored) sex beat.
3. Compare whether unauthorized [B] escalation appears only when the previous assistant message already wrote [B].

If the control stays clean and the post-OOC IC turn repeats `C-P08`–`C-P18` style occupancy, Hypothesis D is ready for a scoped prompt/history experiment. Until then, this packet is the review artifact.

# Secondary scores (not the evidence)

| Turn | PROSE | VOICE | CONTINUITY | PERSONA | PROGRESS | META_LEAK |
|---|---:|---:|---:|---|---:|---|
| A | 4 | 4 | 5 | N/A | 3 | no |
| B | 4 | 4 | 5 | 4 | 5 | no |
| C | 3 | 3 | 4 | 3 | 4 | no |
| D | 3 | 3 | 4 | 3 | 4 | no |

These scores are not a substitute for the paragraph map.
