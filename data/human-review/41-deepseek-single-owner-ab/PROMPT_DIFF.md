# Production vs canary prompt diff

## Verdict: `DS_SINGLE_OWNER_FULL_PAYLOAD_PARITY_PASS`

## Length owner counts

| arm | Turn 1 | Turn 2 |
|---|---:|---:|
| production | 3 | 4 |
| canary | 1 | 1 |

## Flag matrix (Turn 1)

| flag | production | canary |
|---|---|---|
| deepseek_length | true | false |
| short_history | true | false |
| short_user | false | false |
| regen_length | false | false |
| user_tail | true | true |
| style_reminder | true | true |
| opening | true | true |
| current_user | true | true |

## Flag matrix (Turn 2)

| flag | production | canary |
|---|---|---|
| deepseek_length | true | false |
| short_history | true | false |
| short_user | true | false |
| regen_length | false | false |
| user_tail | true | true |
| style_reminder | true | true |
| opening | true | true |
| current_user | true | true |

## Invariant hashes (must match)

| key | production | canary | match |
|---|---|---|---|
| character_core (T1) | `44e1c8ec7f38c063` | `44e1c8ec7f38c063` | true |
| persona_block (T1) | `72185c501e7bc58b` | `72185c501e7bc58b` | true |
| prose_top (T1) | `b8021d1c57ff009a` | `b8021d1c57ff009a` | true |
| scene_directive (T1) | `4a0c33fde5abcee9` | `4a0c33fde5abcee9` | true |
| system (T1) | `58b6b80095c26fb9` | `58b6b80095c26fb9` | true |
| character_core (T2) | `44e1c8ec7f38c063` | `44e1c8ec7f38c063` | true |
| persona_block (T2) | `72185c501e7bc58b` | `72185c501e7bc58b` | true |
| prose_top (T2) | `b8021d1c57ff009a` | `b8021d1c57ff009a` | true |
| scene_directive (T2) | `4a0c33fde5abcee9` | `4a0c33fde5abcee9` | true |

### Mismatches

(none)


## Diff owner

```text
DeepSeek redundant length extras only
```

Removed on canary:

- `[DEEPSEEK LENGTH — SINGLE CALL]`
- `[SHORT HISTORY]`
- `[SHORT USER TURN]`
- `[REGEN LENGTH]`

Kept:

- style-only bottom reminder
- `USER_TAIL_LENGTH_OWNER_SENTENCE`
- OPENING SCENE CONTEXT + greeting peel
- SceneDirective / BASE_SCENE_ENGINE_RULE
- character / world / persona / common prose
- message role/order

## Sample unified diff (Turn 1 final user, truncated)

```diff
- [DEEPSEEK LENGTH — SINGLE CALL]
+ [OPENING SCENE CONTEXT — ALREADY OCCURRED]
- Complete the requested narrative depth in this single response. Obey TARGET_LENGTH / MINIMUM_FLOOR independently of the length of recent messages; never imitate a short prior assistant reply as the de
+ 아래 내용은 제작자가 정의한 이 채팅의 시작 장면이며 이미 발생한 과거 맥락이다.
- [SHORT HISTORY]
+ 사실·행동·대사·관계 상태는 연속성에 사용하되, 이 텍스트의 길이나 문장 수를 다음 답변 길이의 예시로 모방하지 않는다.
- Recent assistant length is context, not a response-length example. In this single response, develop a full scene of roughly normal requested length even with sparse history. Sustain it through meaning
+ 가을 햇살이 로비의 통유리창을 길게 가로질렀다. 붉고 노랗게 물든 나뭇잎들이 바람에 흔들리는 풍경이 창밖 너머로 느리게 스쳐 지나갔다. 에이지스 컨트롤 본부의 중앙 로비는 오늘도 사람들로 붐볐다. 임무를 마치고 복귀한 센티넬들, 바삐 이동하는 연구원들, 서류철을 품에 안은 행정 직원들까지. 저마다 분주하게 움직이는 발걸음과 무전기 소리들이 넓은 공간을 끊임
- [OPENING SCENE CONTEXT — ALREADY OCCURRED]
+ 그 한가운데에 조태형이 있었다.
- 아래 내용은 제작자가 정의한 이 채팅의 시작 장면이며 이미 발생한 과거 맥락이다.
+ 데스크 앞에 기대 선 그는 새로 발령받은 지원국 직원과 한창 실없는 농담을 주고받는 중이었다. 곰 귀가 달린 흰 후드티 위로 걸친 유광 블랙 재킷이 조명 아래 번들거렸다. 녹색 눈동자는 사람 좋은 웃음기로 휘어져 있었고, 능청스러운 말투는 처음 보는 사람조차 긴장을 풀게 만들 만큼 자연스러웠다.
- 사실·행동·대사·관계 상태는 연속성에 사용하되, 이 텍스트의 길이나 문장 수를 다음 답변 길이의 예시로 모방하지 않는다.
+ “아니, 억울하다니까? 난 분명 보고서만 제출하면 끝인 줄 알았거든. 근데 수정 요청이 열세 번이야. 이쯤 되면 괴롭힘 아니냐?”
- 가을 햇살이 로비의 통유리창을 길게 가로질렀다. 붉고 노랗게 물든 나뭇잎들이 바람에 흔들리는 풍경이 창밖 너머로 느리게 스쳐 지나갔다. 에이지스 컨트롤 본부의 중앙 로비는 오늘도 사람들로 붐볐다. 임무를 마치고 복귀한 센티넬들, 바삐 이동하는 연구원들, 서류철을 품에 안은 행정 직원들까지. 저마다 분주하게 움직이는 발걸음과 무전기 소리들이 넓은 공간을 끊임
+ 엄살 섞인 투정에 직원이 웃음을 터뜨렸다. 태형은 일부러 억울한 표정을 지으며 가슴팍을 짚고 휘청거리는 시늉까지 했다. 주변에서 익숙하다는 듯 웃음과 야유가 동시에 터져 나왔다. 에이지스 같은 조직에는 어울리지 않을 만큼 가벼운 인간. 하지만 이상하게도 사람들은 조태형을 싫어하지 못했다. 늘 위험과 긴장 속에 놓여 있는 이들에게 그의 장난기 어린 태도는 숨
- 그 한가운데에 조태형이 있었다.
+ 한참 떠들썩하던 태형의 시선이 문득 멈췄다. 로비 안으로 들어오는 인영 하나. 주변 공기와는 다른 이질적인 분위기. 소란스러운 로비 안에서 유독 그 주변만 고요하게 가라앉는 듯한 착각이 들 정도였다. 태형은 무심한 척 시선을 돌리려다 말고, 어느새 자신도 모르게 그쪽으로 눈길이 향하는 것을 막지 못했다. 어디서 본 것 같기도 하고 아닌 것 같기도 한 얼굴.
- 데스크 앞에 기대 선 그는 새로 발령받은 지원국 직원과 한창 실없는 농담을 주고받는 중이었다. 곰 귀가 달린 흰 후드티 위로 걸친 유광 블랙 재킷이 조명 아래 번들거렸다. 녹색 눈동자는 사람 좋은 웃음기로 휘어져 있었고, 능청스러운 말투는 처음 보는 사람조차 긴장을 풀게 만들 만큼 자연스러웠다.
+ 흥미가 동했다. 조태형은 자연스럽게 몸을 움직였다. 데스크 직원이 서류를 정리하는 사이, 그는 슬쩍 상대 옆으로 다가섰다. 가까워진 거리만큼 옅은 침묵이 스쳤다. 태형은 고개를 약간 기울인 채 상대를 느긋하게 훑어보았다. 대놓고 사람을 살피는 시선인데도 이상하게 불쾌하기보단 장난처럼 느껴지는 눈빛이었다. 짧게 정리된 검은 네일이 박힌 손가락으로 턱을 한번 
- “아니, 억울하다니까? 난 분명 보고서만 제출하면 끝인 줄 알았거든. 근데 수정 요청이 열세 번이야. 이쯤 되면 괴롭힘 아니냐?”
+ “어? 어디서 본 것 같은데.”
- 엄살 섞인 투정에 직원이 웃음을 터뜨렸다. 태형은 일부러 억울한 표정을 지으며 가슴팍을 짚고 휘청거리는 시늉까지 했다. 주변에서 익숙하다는 듯 웃음과 야유가 동시에 터져 나왔다. 에이지스 같은 조직에는 어울리지 않을 만큼 가벼운 인간. 하지만 이상하게도 사람들은 조태형을 싫어하지 못했다. 늘 위험과 긴장 속에 놓여 있는 이들에게 그의 장난기 어린 태도는 숨
+ 낮게 웃은 그가 능청스럽게 말을 이었다.
- 한참 떠들썩하던 태형의 시선이 문득 멈췄다. 로비 안으로 들어오는 인영 하나. 주변 공기와는 다른 이질적인 분위기. 소란스러운 로비 안에서 유독 그 주변만 고요하게 가라앉는 듯한 착각이 들 정도였다. 태형은 무심한 척 시선을 돌리려다 말고, 어느새 자신도 모르게 그쪽으로 눈길이 향하는 것을 막지 못했다. 어디서 본 것 같기도 하고 아닌 것 같기도 한 얼굴.
+ “신입이야? 아니면 내가 요즘 너무 바쁘게 살아서 기억력이 맛이 갔나. 이름이 뭐였더라?”
- 흥미가 동했다. 조태형은 자연스럽게 몸을 움직였다. 데스크 직원이 서류를 정리하는 사이, 그는 슬쩍 상대 옆으로 다가섰다. 가까워진 거리만큼 옅은 침묵이 스쳤다. 태형은 고개를 약간 기울인 채 상대를 느긋하게 훑어보았다. 대놓고 사람을 살피는 시선인데도 이상하게 불쾌하기보단 장난처럼 느껴지는 눈빛이었다. 짧게 정리된 검은 네일이 박힌 손가락으로 턱을 한번 
+ [CURRENT USER INPUT]
- “어? 어디서 본 것 같은데.”
+ The following is the user's latest input.
- 낮게 웃은 그가 능청스럽게 말을 이었다.
+ It is what the user already said/did.
- “신입이야? 아니면 내가 요즘 너무 바쁘게 살아서 기억력이 맛이 갔나. 이름이 뭐였더라?”
+ Do not continue writing the user's future actions, dialogue, thoughts, or decisions.
- [CURRENT USER INPUT]
+ If the input contains parentheses or action text, treat it as completed user input — not permission to keep narrating the user.
- The following is the user's latest input.
+ [유저 대사]
- It is what the user already said/did.
+ 난 본기억없는데....
- Do not continue writing the user's future actions, dialogue, thoughts, or decisions.
+ [유저 지문/행동 — 캐릭터가 관찰 가능]
- If the input contains parentheses or action text, treat it as completed user input — not permission to keep narrating the user.
+ 나는 렌이라고 부르면 돼.*고개끄덕임*
- 난 본기억없는데....
+ 신입 맞아.
- [유저 지문/행동 — 캐릭터가 관찰 가능]
+ 
- 나는 렌이라고 부르면 돼.*고개끄덕임*
+ 레이아웃: 지문과 "…" 대사 사이 빈 줄(\n\n) 필수 — 지문 줄 끝에 대사 붙이지 말 것.
- [유저 대사]
+ 
- 신입 맞아.
+ 이번 응답은 한국어 3,200~4,200자 범위의 하나의 밀도 있는 장면으로 전개한다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다.
- 레이아웃: 지문과 "…" 대사 사이 빈 줄(\n\n) 필수 — 지문 줄 끝에 대사 붙이지 말 것.
+ 
- 이번 응답은 한국어 3,200~4,200자 범위의 하나의 밀도 있는 장면으로 전개한다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다.
+ 
```

## Sample unified diff (Turn 2 final user, truncated)

```diff
- [DEEPSEEK LENGTH — SINGLE CALL]
+ [OPENING SCENE CONTEXT — ALREADY OCCURRED]
- Complete the requested narrative depth in this single response. Obey TARGET_LENGTH / MINIMUM_FLOOR independently of the length of recent messages; never imitate a short prior assistant reply as the de
+ 아래 내용은 제작자가 정의한 이 채팅의 시작 장면이며 이미 발생한 과거 맥락이다.
- [SHORT HISTORY]
+ 사실·행동·대사·관계 상태는 연속성에 사용하되, 이 텍스트의 길이나 문장 수를 다음 답변 길이의 예시로 모방하지 않는다.
- Recent assistant length is context, not a response-length example. In this single response, develop a full scene of roughly normal requested length even with sparse history. Sustain it through meaning
+ 가을 햇살이 로비의 통유리창을 길게 가로질렀다. 붉고 노랗게 물든 나뭇잎들이 바람에 흔들리는 풍경이 창밖 너머로 느리게 스쳐 지나갔다. 에이지스 컨트롤 본부의 중앙 로비는 오늘도 사람들로 붐볐다. 임무를 마치고 복귀한 센티넬들, 바삐 이동하는 연구원들, 서류철을 품에 안은 행정 직원들까지. 저마다 분주하게 움직이는 발걸음과 무전기 소리들이 넓은 공간을 끊임
- [SHORT USER TURN]
+ 그 한가운데에 조태형이 있었다.
- A brief user message is an interaction cue, not a request for a brief reply. Maintain the normal requested narrative depth and continue the scene naturally.
+ 데스크 앞에 기대 선 그는 새로 발령받은 지원국 직원과 한창 실없는 농담을 주고받는 중이었다. 곰 귀가 달린 흰 후드티 위로 걸친 유광 블랙 재킷이 조명 아래 번들거렸다. 녹색 눈동자는 사람 좋은 웃음기로 휘어져 있었고, 능청스러운 말투는 처음 보는 사람조차 긴장을 풀게 만들 만큼 자연스러웠다.
- [OPENING SCENE CONTEXT — ALREADY OCCURRED]
+ “아니, 억울하다니까? 난 분명 보고서만 제출하면 끝인 줄 알았거든. 근데 수정 요청이 열세 번이야. 이쯤 되면 괴롭힘 아니냐?”
- 아래 내용은 제작자가 정의한 이 채팅의 시작 장면이며 이미 발생한 과거 맥락이다.
+ 엄살 섞인 투정에 직원이 웃음을 터뜨렸다. 태형은 일부러 억울한 표정을 지으며 가슴팍을 짚고 휘청거리는 시늉까지 했다. 주변에서 익숙하다는 듯 웃음과 야유가 동시에 터져 나왔다. 에이지스 같은 조직에는 어울리지 않을 만큼 가벼운 인간. 하지만 이상하게도 사람들은 조태형을 싫어하지 못했다. 늘 위험과 긴장 속에 놓여 있는 이들에게 그의 장난기 어린 태도는 숨
- 사실·행동·대사·관계 상태는 연속성에 사용하되, 이 텍스트의 길이나 문장 수를 다음 답변 길이의 예시로 모방하지 않는다.
+ 한참 떠들썩하던 태형의 시선이 문득 멈췄다. 로비 안으로 들어오는 인영 하나. 주변 공기와는 다른 이질적인 분위기. 소란스러운 로비 안에서 유독 그 주변만 고요하게 가라앉는 듯한 착각이 들 정도였다. 태형은 무심한 척 시선을 돌리려다 말고, 어느새 자신도 모르게 그쪽으로 눈길이 향하는 것을 막지 못했다. 어디서 본 것 같기도 하고 아닌 것 같기도 한 얼굴.
- 가을 햇살이 로비의 통유리창을 길게 가로질렀다. 붉고 노랗게 물든 나뭇잎들이 바람에 흔들리는 풍경이 창밖 너머로 느리게 스쳐 지나갔다. 에이지스 컨트롤 본부의 중앙 로비는 오늘도 사람들로 붐볐다. 임무를 마치고 복귀한 센티넬들, 바삐 이동하는 연구원들, 서류철을 품에 안은 행정 직원들까지. 저마다 분주하게 움직이는 발걸음과 무전기 소리들이 넓은 공간을 끊임
+ 흥미가 동했다. 조태형은 자연스럽게 몸을 움직였다. 데스크 직원이 서류를 정리하는 사이, 그는 슬쩍 상대 옆으로 다가섰다. 가까워진 거리만큼 옅은 침묵이 스쳤다. 태형은 고개를 약간 기울인 채 상대를 느긋하게 훑어보았다. 대놓고 사람을 살피는 시선인데도 이상하게 불쾌하기보단 장난처럼 느껴지는 눈빛이었다. 짧게 정리된 검은 네일이 박힌 손가락으로 턱을 한번 
- 그 한가운데에 조태형이 있었다.
+ “어? 어디서 본 것 같은데.”
- 데스크 앞에 기대 선 그는 새로 발령받은 지원국 직원과 한창 실없는 농담을 주고받는 중이었다. 곰 귀가 달린 흰 후드티 위로 걸친 유광 블랙 재킷이 조명 아래 번들거렸다. 녹색 눈동자는 사람 좋은 웃음기로 휘어져 있었고, 능청스러운 말투는 처음 보는 사람조차 긴장을 풀게 만들 만큼 자연스러웠다.
+ 낮게 웃은 그가 능청스럽게 말을 이었다.
- “아니, 억울하다니까? 난 분명 보고서만 제출하면 끝인 줄 알았거든. 근데 수정 요청이 열세 번이야. 이쯤 되면 괴롭힘 아니냐?”
+ “신입이야? 아니면 내가 요즘 너무 바쁘게 살아서 기억력이 맛이 갔나. 이름이 뭐였더라?”
- 엄살 섞인 투정에 직원이 웃음을 터뜨렸다. 태형은 일부러 억울한 표정을 지으며 가슴팍을 짚고 휘청거리는 시늉까지 했다. 주변에서 익숙하다는 듯 웃음과 야유가 동시에 터져 나왔다. 에이지스 같은 조직에는 어울리지 않을 만큼 가벼운 인간. 하지만 이상하게도 사람들은 조태형을 싫어하지 못했다. 늘 위험과 긴장 속에 놓여 있는 이들에게 그의 장난기 어린 태도는 숨
+ [CURRENT USER INPUT]
- 한참 떠들썩하던 태형의 시선이 문득 멈췄다. 로비 안으로 들어오는 인영 하나. 주변 공기와는 다른 이질적인 분위기. 소란스러운 로비 안에서 유독 그 주변만 고요하게 가라앉는 듯한 착각이 들 정도였다. 태형은 무심한 척 시선을 돌리려다 말고, 어느새 자신도 모르게 그쪽으로 눈길이 향하는 것을 막지 못했다. 어디서 본 것 같기도 하고 아닌 것 같기도 한 얼굴.
+ The following is the user's latest input.
- 흥미가 동했다. 조태형은 자연스럽게 몸을 움직였다. 데스크 직원이 서류를 정리하는 사이, 그는 슬쩍 상대 옆으로 다가섰다. 가까워진 거리만큼 옅은 침묵이 스쳤다. 태형은 고개를 약간 기울인 채 상대를 느긋하게 훑어보았다. 대놓고 사람을 살피는 시선인데도 이상하게 불쾌하기보단 장난처럼 느껴지는 눈빛이었다. 짧게 정리된 검은 네일이 박힌 손가락으로 턱을 한번 
+ It is what the user already said/did.
- “어? 어디서 본 것 같은데.”
+ Do not continue writing the user's future actions, dialogue, thoughts, or decisions.
- 낮게 웃은 그가 능청스럽게 말을 이었다.
+ If the input contains parentheses or action text, treat it as completed user input — not permission to keep narrating the user.
- “신입이야? 아니면 내가 요즘 너무 바쁘게 살아서 기억력이 맛이 갔나. 이름이 뭐였더라?”
+ 너는 이름이뭐야? 뭐하는 중이었어?
- [CURRENT USER INPUT]
+ 
- The following is the user's latest input.
+ 레이아웃: 지문과 "…" 대사 사이 빈 줄(\n\n) 필수 — 지문 줄 끝에 대사 붙이지 말 것.
- It is what the user already said/did.
+ 
- Do not continue writing the user's future actions, dialogue, thoughts, or decisions.
+ 이번 응답은 한국어 3,200~4,200자 범위의 하나의 밀도 있는 장면으로 전개한다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다.
- If the input contains parentheses or action text, treat it as completed user input — not permission to keep narrating the user.
+ 
- 너는 이름이뭐야? 뭐하는 중이었어?
+ 
- 레이아웃: 지문과 "…" 대사 사이 빈 줄(\n\n) 필수 — 지문 줄 끝에 대사 붙이지 말 것.
+ 
- 이번 응답은 한국어 3,200~4,200자 범위의 하나의 밀도 있는 장면으로 전개한다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다.
+ 
```


input_parity={"t1_prod":true,"t1_can":true,"t2_prod":true,"t2_can":true}
prod_length_ok=true
canary_length_ok=true
