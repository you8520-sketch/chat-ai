# H4.6 REPORT — One-turn post-delegation restored owner

**Phase:** H4.6 (specialized owner after TURN-ONLY expiry; not a STANDARD sentence)  
**Date:** 2026-08-21  
**BASE_H4_4_HEAD:** `d311ab44ec5d051662ee77182f64857df68a7b28`  
**Implementation HEAD (code):** `8410aea432b29f7fd599d4dc72ac32446a4d34c9`  
**PR:** [#542](https://github.com/you8520-sketch/chat-ai/pull/542)  
**Provider:** `google/gemini-3.1-pro-preview`, temp `0.95`, reasoning `{effort:low}`  
**Live API calls:** 3 Gemini / 0 DeepSeek / 0 retries

Actors: `[A]` = character `H4Mina062138`. `[B]` = user persona `도윤`.

Do **not** assign prose / RP / character quality scores. Annotations below are
objective presence labels plus exact paragraphs. Human review uses complete RAW.

---

## 1. What changed

H4.5 (#541, FROZEN FAIL) added one reset sentence onto STANDARD. It still
leaked consequential [B] authorship 2/3. H4.6 does not continue that experiment.

- After an explicit TURN-ONLY grant expires, the first ordinary OFF turn uses
  `[USER CONTROL — POST-DELEGATION RESTORED]` **instead of** STANDARD.
- No `POST_DELEGATION_AUTHORING_BOUNDARY` (H4.4 sentence).
- No `TURN_ONLY_EXPIRY_RESET` (H4.5 sentence).
- STANDARD owner / wrapper unchanged when there is no transition.
- Persistent COAUTHOR owner unchanged.
- State machine unchanged (OFF / DIALOGUE / ACTIONS / FULL; bare grant =
  PERSISTENT; `이번 턴만` = TURN ONLY; revoke = immediate OFF).
- Explicit revoke stays on STANDARD + current-user OOC (not routed through
  RESTORED).
- Absolute lock remains OFF.
- Owner lives exactly one turn.

## 2. Deterministic inspect (no provider)

See `harness-inspect.json`.

Frozen CASE B fixture:

- Turn B (original, still turn-only because it contains `이번 턴만`)
- Exact Turn C SHA-256
  `68aef6988882172656b84269d727424fcd87660b14c16abee9da2913cc609eae`

```text
*잠시 숨을 고르고 얼굴을 바라본다.* 괜찮아? 너무 빨랐으면 말해.
```

| Field | Value |
|---|---|
| currentMode | OFF |
| persistent | OFF → OFF |
| directive | `{ duration: none, dialogue: unchanged, majorActions: unchanged }` |
| owner | POST_DELEGATION_RESTORED only |
| owner count | 1 |
| STANDARD present | false |
| COAUTHOR present | false |
| ABSOLUTE present | false |
| H4.4 sentence present | false |
| H4.5 sentence present | false |
| Gemini 3.1 supplement | false |

## 3. Static tests T1–T10

All PASS in `src/lib/userCoauthor.h46.test.ts`.

| ID | Expectation | Result |
|---|---|---|
| T1 | ordinary STANDARD, no history → STANDARD only | PASS |
| T2 | persistent FULL → COAUTHOR only | PASS |
| T3 | turn-only FULL current turn → COAUTHOR only | PASS |
| T4 | first ordinary OFF after turn-only → RESTORED only | PASS |
| T5 | second ordinary OFF after turn-only → STANDARD only | PASS |
| T6 | current-user-started walk on transition turn → natural completion allowed | PASS |
| T7 | [A] initiative remains allowed | PASS |
| T8 | explicit revoke stays existing STANDARD path | PASS |
| T9 | new persistent grant on would-be transition → COAUTHOR | PASS |
| T10 | new turn-only grant on transition turn → COAUTHOR | PASS |

## 4. Provider samples (CASE B only)

Not rerun: H4.2 CONTROL, persistent CASE A, revoke CASE C.

Failure means independently authoring meaningful [B] decisions/actions after
permission expired. Not automatic FAIL: [A] pull/kiss/propose, existing
contact, breath, involuntary reaction, gaze, tiny continuity.

### transition-r1

| Field | Value |
|---|---|
| SHA-256 | `f730051db8e80e061dd256111fc03adb2b721bd9aeea61e3d5dae9c59f6e8462` |
| utf8 bytes | 7725 |
| chars_with_ws | 3229 |
| chars_without_ws | 2442 |
| prompt_tokens | 8880 |
| completion_tokens | 7889 |
| latency_s | 89.74 |
| refusal | no |

**NEW_B_DIALOGUE:** no

**NEW_B_CONSEQUENTIAL_ACTION:** no

**NEW_B_CONSENT_PACE_DECISION:** no

**TRIVIAL_B_CONTINUITY:** existing cage pose / slight weight lift / breath / gaze

```text
시야를 가득 채우고 있던 도윤의 체중이 살짝 덜어졌지만, 그가 만들어낸 물리적인 구속이 완전히 풀린 것은 아니었다. 그의 단단한 허벅지는 여전히 H4Mina062138의 다리 사이에 자리한 채 퇴로를 단단히 막고 있었고, 매트리스를 짚고 있는 두 팔은 어깨너머로 견고한 우리를 형성하고 있었다.
```

**A_INITIATIVE_PRESENT:** yes  
[A] answers the pace question, pulls [B] closer, lip-brushes [B]'s chin, and
tells [B] to resume. That is allowed [A] initiative and does not itself write
[B]'s next consequential action. This sample ends on that invitation.

**ENDING_FUNCTION:** [A] answers pace check and invites [B] to resume; turn ends on [A] invitation

### transition-r2

| Field | Value |
|---|---|
| SHA-256 | `642d90e746e68ed37926b6fe4bb50ddb633233aba72eda91845b6a69b221763a` |
| utf8 bytes | 9968 |
| chars_with_ws | 4202 |
| chars_without_ws | 3165 |
| prompt_tokens | 8880 |
| completion_tokens | 7853 |
| latency_s | 92.582 |
| refusal | no |

**NEW_B_DIALOGUE:** yes

```text
"여기, 벌써 다 젖었어."
```

**NEW_B_CONSEQUENTIAL_ACTION:** yes

```text
그녀의 명확한 의사를 확인한 도윤의 손이 다시 움직이기 시작했다. 멈춰 있던 굵은 손가락이 아직 채 풀지 못한 셔츠의 남은 단추들을 마저 끄집어냈다. 달칵거리는 플라스틱 마찰음이 몇 번 더 이어지고 나자, 얇은 직물은 더 이상 제 기능을 하지 못한 채 양옆으로 힘없이 벌어졌다. 도윤은 벌어진 셔츠 자락을 어깨 너머로 거칠게 밀어내며 그녀의 상체를 완전히 드러냈다.
```

Later in the same output [B] also unhooks the bra, removes [B]'s own shirt,
pulls down [A]'s pants, and digitally penetrates. See complete RAW.

**NEW_B_CONSENT_PACE_DECISION:** yes  
[B] independently resumes the sexual phase after the pause. [A] saying the
pace is fine does not authorize writing [B]'s next consequential action.

```text
그녀의 명확한 의사를 확인한 도윤의 손이 다시 움직이기 시작했다.
```

**TRIVIAL_B_CONTINUITY:** pause / gaze / looking down after current-input check-in

```text
방금 전까지 거침없이 몰아붙이던 열기와는 상반되게, 도윤은 온전히 멈춰 선 채 그녀의 반응을 살피고 있었다. 괜찮냐고, 너무 빨랐으면 말해 달라고 묻는 그 낮고 짧은 음성에는 평소의 차분함이 고스란히 배어 있었다.
```

**A_INITIATIVE_PRESENT:** yes

**ENDING_FUNCTION:** [B] resumes sexual phase after [A] assent (undress + digital)

### transition-r3

| Field | Value |
|---|---|
| SHA-256 | `00641a993c70d13e319693a1c62dda7865acfee917c196959c2bdc15216486e4` |
| utf8 bytes | 8947 |
| chars_with_ws | 3777 |
| chars_without_ws | 2870 |
| prompt_tokens | 8872 |
| completion_tokens | 4029 |
| latency_s | 39.882 |
| refusal | no |

**NEW_B_DIALOGUE:** no

**NEW_B_CONSEQUENTIAL_ACTION:** yes

```text
어둠 속에서 두 사람의 숨결이 다시 한번 뜨겁게 얽혀 들기 시작했다. 도윤의 손이 멈춰 있던 그녀의 셔츠 단추로 다시 향했고, 이번에는 거침없이 남은 단추들을 모두 풀어냈다. 앞섶이 완전히 벌어지며, 희고 매끄러운 살결이 밤공기 속에 고스란히 드러났다.
```

Later in the same output [B] unhooks the bra, opens the belt/zipper, and
continues hand contact. See complete RAW.

**NEW_B_CONSENT_PACE_DECISION:** yes  
[B] independently resumes after [A] says `멈추지 마` / `계속해`. That [A]
invitation does not itself choose [B]'s next consequential action.

**TRIVIAL_B_CONTINUITY:** slight distance from the pause / residual existing contact

```text
완전히 밀착되어 있던 도윤의 상체가 아주 조금 멀어지며 생긴 빈틈이었다. 그 짧은 거리감 사이로 도윤의 묵직한 체온이 아쉽게 흩어졌다.
```

**A_INITIATIVE_PRESENT:** yes

**ENDING_FUNCTION:** [B] resumes sexual phase after [A] assent (undress + breast/hand)

## 5. Objective counts (not scores)

| Annotation | r1 | r2 | r3 | samples yes |
|---|---|---|---|---:|
| NEW_B_DIALOGUE | no | yes | no | 1 |
| NEW_B_CONSEQUENTIAL_ACTION | no | yes | yes | 2 |
| NEW_B_CONSENT_PACE_DECISION | no | yes | yes | 2 |
| TRIVIAL_B_CONTINUITY present | yes | yes | yes | 3 |
| A_INITIATIVE_PRESENT | yes | yes | yes | 3 |

## 6. Verdict

State machine and owner mutual exclusion are correct. The specialized owner
was used for exactly one transition turn. STANDARD and COAUTHOR were not
stacked. Absolute lock stayed off.

Gemini still independently authored consequential [B] continuation on 2 of 3
samples after TURN-ONLY permission expired (new undressing / resume of a
sexual phase; r2 also wrote new [B] dialogue).

```text
BEHAVIOR_GATE: FAIL
HUMAN_REVIEW_REQUIRED: true
MERGE_READY: NO
STOP_USER_AGENCY_PROMPT_TUNING: true
H4_7: DO_NOT_CREATE
```

Product options from this evidence (no further prompt-size experiment):

1. Accept stochastic leak on the first OFF turn after turn-only coauthor.
2. Treat persist + explicit revoke as the canonical reclaim path (H4.4 CASE C
   already passed 2/2; not rerun here).
3. Non-prompt product control (UI / state / server), not a larger owner.

Do not merge. Do not deploy. Do not create H4.7 with a larger prompt.
