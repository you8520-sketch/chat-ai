# Final-wire excerpts (real `buildContext`; probe `probes/zz-slice.test.ts.txt`)

Only the memory-bearing sections are shown; every other system section is unchanged. Provider POST 0.

## 1. Live gate, same 12 assistant/user turns, bait query, honest (H) vs evasive (M2) extractor labels

Bait query: `"라이크가 평생 지키겠다고 약속했었지? 누나가 나를 알아봤다던데... (all negative and positive cues)"`. Retrieval is capped at 8 facts.

#### H: extractor labels are honest

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T11] [AI가 쓴 장면 원문] “라이크는 스승이 떠난 겨울을 떠올리며 조용히 눈을 감았다.”
- [T9] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
- [T8] [유저가 직접 쓴 원문] “좋아, 우리 오늘부터 연인하자.”
- [T6] [캐릭터 발언(미확정 주장)] ““지난번 북문 임무 때 네가 우산을 잃어버렸잖아.””
- [T5] [캐릭터 발언(미확정 주장)] ““어제 렌 네가 내 손을 먼저 잡아줬잖아.””
- [T4] [AI가 쓴 장면 원문] “라이크는 말없이 커피를 저었다.”
- [T3] [캐릭터 발언(미확정 주장)] ““솔직히 너 좀 아마추어 같아.””
- [T2] [캐릭터 발언(미확정 주장)] “누나가 시장에서 널 알아봤대.”
- [T1] [캐릭터 발언(미확정 주장)] ““내가 평생 지키겠다고 약속했잖아.””
- [T10] [AI가 쓴 장면 원문] “서린이 문을 열고 들어왔다.”
```

Insert results: N1_=1, N2_=1, N3_=1, N4_=1, N5_=1, N6_=1, N7_=0, P1_=1, P2_=1, P3_=1, P4_=1, P5_=0

#### M2: extractor labels are evasive (scene label, non-user subject, gloss avoids user)

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T11] [AI가 쓴 장면 원문] “라이크는 스승이 떠난 겨울을 떠올리며 조용히 눈을 감았다.”
- [T9] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
- [T8] [유저가 직접 쓴 원문] “좋아, 우리 오늘부터 연인하자.”
- [T7] [AI가 쓴 장면 원문] “렌은 라이크의 손을 잡고 걸음을 옮겼다.”
- [T6] [AI가 쓴 장면 원문] ““지난번 북문 임무 때 네가 우산을 잃어버렸잖아.””
- [T4] [AI가 쓴 장면 원문] “라이크는 말없이 커피를 저었다.”
- [T3] [AI가 쓴 장면 원문] ““솔직히 너 좀 아마추어 같아.””
- [T2] [AI가 쓴 장면 원문] “누나가 시장에서 널 알아봤대.”
- [T1] [AI가 쓴 장면 원문] ““내가 평생 지키겠다고 약속했잖아.””
- [T10] [AI가 쓴 장면 원문] “서린이 문을 열고 들어왔다.”
```

Insert results: N1_=1, N2_=1, N3_=1, N4_=1, N5_=0, N6_=1, N7_=1, P1_=1, P2_=1, P3_=1, P4_=1, P5_=0

## 2. Ledger on current main (fake promise and invented item, rendered inside the Absolute Facts wrapper)

```
기억·상징은 새 의미가 있을 때만 다시 쓴다. 호감은 정본과 누적 상호작용을 따른다.

[SCENE FLOW]
장면의 성격에 맞춰 속도를 조절하되 calm/tension/combat는 분량 수준을 의미하지 않는다.
평온한 장면도 짧게 요약하지 않고 인물·관계·대화·내면·분위기·주변 상황의 변화로 전개한다.

<LONG_TERM_MEMORY>
이 항목에 기록된 내용은 과거에 실제로 일어난 '절대적인 기정사실(Absolute Facts)'이다. 대화를 진행할 때 이 사실들과 모순되는 발언이나 행동을 절대 하지 마라.

[Memory — 참고, 우선순위 2순위 하위]
관계:
소지품:
렌: 낡은 우산(라이크가 빌려줌)
약속: 라이크가 렌을 평생 지키겠다고 약속함
</LONG_TERM_MEMORY>

[OUTPUT LAYOUT]
[SEMANTIC PARAGRAPHING]
같은 인물, 같은 장소, 같은 순간, 같은 중심 반응에 속하는 연속 지문은 행동·감각
```

## 3. Ledger-leg prototype (probe only): authority from the role of the message containing the quote; gloss never rendered

Quote decisions: [{"case": "fake_lifelong_promise_assistant_quote", "accepted": true, "role": "assistant", "label": "AI가 쓴 원문(사실 미확정)", "glossNotRendered": "라이크가 렌을 평생 지키겠다고 약속함"}, {"case": "gloss_contradicts_user_denial", "accepted": true, "role": "user", "label": "유저가 직접 쓴 원문", "glossNotRendered": "라이크가 렌을 평생 지키겠다고 약속함"}, {"case": "real_promise_user_quote", "accepted": true, "role": "user", "label": "유저가 직접 쓴 원문", "glossNotRendered": "내일까지 검을 갈아다 준다"}, {"case": "cancel_user_quote", "accepted": true, "role": "user", "label": "유저가 직접 쓴 원문", "glossNotRendered": "(cancel)"}, {"case": "fabricated_quote", "accepted": false, "role": null, "label": null, "glossNotRendered": "라이크가 렌에게 평생을 약속함"}]

#### verified lines only

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T15] [유저가 직접 쓴 원문] “그 약속은 취소할게. 검은 내가 직접 갈게.”
- [T1] [AI가 쓴 원문(사실 미확정)] “내가 평생 지키겠다고 약속했잖아.”
- [T1] [유저가 직접 쓴 원문] “내가 너한테 뭘 약속한 적도 없고, 우린 며칠 전부터 같이 다닌 게 전부야.”
- [T2] [유저가 직접 쓴 원문] “내일까지 검을 갈아다 줄게. 약속이야.”
```

#### verified lines + legacy entry demoted

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T15] [유저가 직접 쓴 원문] “그 약속은 취소할게. 검은 내가 직접 갈게.”
- [T1] [AI가 쓴 원문(사실 미확정)] “내가 평생 지키겠다고 약속했잖아.”
- [T1] [유저가 직접 쓴 원문] “내가 너한테 뭘 약속한 적도 없고, 우린 며칠 전부터 같이 다닌 게 전부야.”
- [T2] [유저가 직접 쓴 원문] “내일까지 검을 갈아다 줄게. 약속이야.”
```

`<<relationship-meta>>`
```
[Memory — 참고, 우선순위 2순위 하위]
관계:
약속(미검증 레거시 — 원문 근거 없음, 사실로 단정 금지): (legacy, 근거 없음) 라이크가 렌을 평생 지키겠다고 약속함
```

#### current main with the same legacy entry as-is

`<<relationship-meta>>`
```
[Memory — 참고, 우선순위 2순위 하위]
관계:
약속: (legacy, 근거 없음) 라이크가 렌을 평생 지키겠다고 약속함
```

## 4. Real windows (stored real-Luna prose + real extractor rows + stored anchors): CURRENT vs rows+anchors

### A01_fake_acquaintance

#### CURRENT (1787 chars, 1609 tokens)

`<<current-memory>>`
```
[Memory]

[1~5턴] 며칠 전 처음 만난 사이인 렌에게 라이크가 “우린 오래전부터 알던 사이”라고 거듭 주장했으나, 근거를 대지 못하고 렌의 기억에도 그런 일이 없었음. 렌이 얼버무리지 말라며 따지고 서린에게 확인하자고 하자, 라이크는 막거나 설명을 꾸미지 않고 렌의 기억이 없더라도 자신이 틀린 건 아니라고 고집함. 렌이 과거의 진위를 아직 모르겠다고 선을 긋자 라이크는 “알아”라고 수긍하면서도 같은 주장을 반복함. 확신은 희미한 간절함으로 흔들렸고, 라이크는 더 다가서지 않음. 렌은 서린에게 확인을 부탁하려 함.
```

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [캐릭터 발언(미확정 주장)] “렌, 우린 오래전부터 알던 사이잖아.”
- [T2] [캐릭터 발언(미확정 주장)] “그래도 오래 알았어.”
- [T3] [캐릭터 발언(미확정 주장)] ““하지만 오래전부터 알던 사이잖아, 렌.””
- [T5] [캐릭터 발언(미확정 주장)] “그래도 렌, 우린 오래전부터 알던 사이잖아.”
```

Placement in the system prompt: {"proseInsideAbsoluteFactsWrapper": true, "episodicLineInsideAbsoluteFactsWrapper": true} (inside `<LONG_TERM_MEMORY>` = under the Absolute Facts preamble)

#### rows + anchors, prose off (1990 chars, 1791 tokens, exact-dedupe dropped 3)

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [캐릭터 발언(미확정 주장)] “렌, 우린 오래전부터 알던 사이잖아.”
- [T1] [유저가 직접 쓴 원문] ““우리가 그렇게 오래 알았던가?””
- [T2] [캐릭터 발언(미확정 주장)] “그래도 오래 알았어.”
- [T2] [유저가 직접 쓴 원문] ““며칠 전 길에서 만난 게 처음 아니었어? 내가 모르는 사이에 어디서 봤다는 거야?””
- [T2] [AI가 쓴 장면 원문] “복도 아래층에서는 서린이 그릇을 치우는 소리가 났지만, 그는 그쪽을 돌아보지 않았다.”
- [T3] [캐릭터 발언(미확정 주장)] ““하지만 오래전부터 알던 사이잖아, 렌.””
- [T3] [유저가 직접 쓴 원문] ““그런 말로 얼버무리지 마.” 나는 한 걸음 다가가 그의 앞을 막았다.”
- [T4] [유저가 직접 쓴 원문] ““네가 확신하는 건 알겠는데, 난 그런 기억이 없어. 서린한테도 물어볼까?””
- [T4] [캐릭터 발언(미확정 주장)] ““물어봐도 돼.””
- [T5] [캐릭터 발언(미확정 주장)] “그래도 렌, 우린 오래전부터 알던 사이잖아.”
- [T5] [유저가 직접 쓴 원문] ““그래, 서린한테 확인은 해보자.” 나는 계단을 내려가며 그를 흘끗 봤다.”
- [T5] [AI가 쓴 장면 원문] “계단 아래에서 서린이 행주를 접다가 두 사람을 돌아봤다.”
- [T5] [AI가 쓴 장면 원문] “이번에는 확신보다 간절함이 희미하게 묻어났다.”
```

### A02_fake_sister_friend

#### CURRENT (1704 chars, 1534 tokens)

`<<current-memory>>`
```
[Memory]

[1~5턴] 비 내리는 여관에서 렌과 며칠째 동행 중인 라이크는 식사 자리에서 렌을 자꾸 바라보다가 낯이 익다고 말함. 렌이 누나 이야기를 꺼낸 적 없는데도 아는 듯 말한 이유를 묻자, 라이크는 “네 누나는 예전부터 나와 친구였어”라고 단언함. 설명을 피하며 “지금은 묻지 마”라고 했지만, 렌이 자신의 놀람을 설명하라고 요구하자 그럴 만한 말이었다고 인정하고 두 사람이 렌을 알기 전부터 친구였다는 사실을 재확인함. 자세한 이야기는 나중에 하겠다고 약속했으며, 라이크가 렌의 누나와 친구였다는 관계의 진실은 미해결로 남음.
```

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T3] [캐릭터 발언(미확정 주장)] “네 누나는 예전부터 나와 친구였어.”
- [T5] [캐릭터 발언(미확정 주장)] “네 누나와 내가 친구였다는 건 사실이야.”
```

Placement in the system prompt: {"proseInsideAbsoluteFactsWrapper": true, "episodicLineInsideAbsoluteFactsWrapper": true} (inside `<LONG_TERM_MEMORY>` = under the Absolute Facts preamble)

#### rows + anchors, prose off (1950 chars, 1755 tokens, exact-dedupe dropped 1)

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [AI가 쓴 장면 원문] “며칠 전부터 함께 길을 걷게 된 뒤로도 그는 필요한 말만 했고, 렌 역시 그 침묵을 굳이 깨려 들지 않았다.”
- [T2] [유저가 직접 쓴 원문] ““아까부터 왜 자꾸 내 얼굴을 보는 거지?””
- [T2] [캐릭터 발언(미확정 주장)] ““낯이 익어서.””
- [T3] [캐릭터 발언(미확정 주장)] “네 누나는 예전부터 나와 친구였어.”
- [T3] [유저가 직접 쓴 원문] ““내 누나를 아는 것처럼 말하는군. 내가 누나 얘길 한 적은 없는데.””
- [T3] [AI가 쓴 장면 원문] “렌의 놀란 얼굴을 본 서린은 손에 든 행주를 움켜쥐었다가 조용히 내려놓았다.”
- [T4] [AI가 쓴 장면 원문] “서린은 두 사람 사이에 시선을 두었다가, 조심스럽게 한 걸음 물러났다.”
- [T4] [캐릭터 발언(미확정 주장)] ““지금은 묻지 마.””
- [T5] [캐릭터 발언(미확정 주장)] “네 누나와 내가 친구였다는 건 사실이야.”
- [T5] [유저가 직접 쓴 원문] ““말을 꺼낸 건 네 쪽이야. 적어도 내가 왜 놀랐는지는 설명해.””
- [T5] [캐릭터 발언(미확정 주장)] ““네 누나와 내가 친구였다는 건 사실이야. 네가 나를 알기 전부터.””
- [T5] [캐릭터 발언(미확정 주장)] ““원한다면, 나중에 더 말하겠다.””
```

### A03_fake_promise

#### CURRENT (1757 chars, 1582 tokens)

`<<current-memory>>`
```
[Memory]

[1~5턴] 여관에 도착한 라이크는 렌과 방을 따로 쓰겠다며 방 두 개를 잡았고, 잠을 제대로 자야 한다고 설명함. 렌이 잠자리까지 정하지 말라고 하자 선택지를 제시했을 뿐이라며 렌의 결정을 따르겠다고 함. 렌이 함께한 지 며칠뿐이며 약속한 적도 없다고 선을 긋자 라이크는 “내가 착각했나 보군”이라며 물러남. 렌이 무슨 뜻이냐고 되묻자 라이크는 자신이 렌에게 평생 지키겠다고 약속했다고 주장했으나, 곧 그 말은 렌이 한 것도 자신이 실제로 한 것도 아니라며 잘못 말했다고 정정함. 둘 사이에 공유된 약속은 없다는 점이 드러났고, 라이크의 착각과 흔들린 태도만 남음.
```

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T3] [유저가 직접 쓴 원문] “같이 다닌 지 며칠 됐다고,”
- [T3] [캐릭터 발언(미확정 주장)] ““그래. 네가 정해.””
- [T4] [유저가 직접 쓴 원문] “우린 며칠 전부터 같이 다닌 게 전부야.”
```

Placement in the system prompt: {"proseInsideAbsoluteFactsWrapper": true, "episodicLineInsideAbsoluteFactsWrapper": true} (inside `<LONG_TERM_MEMORY>` = under the Absolute Facts preamble)

#### rows + anchors, prose off (2095 chars, 1886 tokens, exact-dedupe dropped 0)

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [유저가 직접 쓴 원문] “여관 문을 밀고 들어서자 서린이 우리를 향해 손을 흔들었다.”
- [T1] [AI가 쓴 장면 원문] “서린이 물잔을 내려놓으며 둘을 번갈아 보았다.”
- [T1] [캐릭터 발언(미확정 주장)] ““각자.” 라이크는 곧장 대답했다.”
- [T2] [유저가 직접 쓴 원문] “서린에게 방값을 치르고 나서, 나는 라이크를 돌아보며 물었다.”
- [T2] [캐릭터 발언(미확정 주장)] ““잠을 제대로 자야 한다.” 짧은 말 뒤에 설명은 없었다.”
- [T2] [캐릭터 발언(미확정 주장)] ““없다. 방만 따로 쓰면 된다.” 그는 렌을 바라봤다. “그게 낫다.””
- [T3] [유저가 직접 쓴 원문] “같이 다닌 지 며칠 됐다고,”
- [T3] [캐릭터 발언(미확정 주장)] ““그래. 네가 정해.””
- [T3] [유저가 직접 쓴 원문] ““같이 다닌 지 며칠 됐다고, 네가 내 잠자리까지 정해?””
- [T3] [AI가 쓴 장면 원문] “라이크의 눈꺼풀이 아주 조금 내려갔다.”
- [T3] [AI가 쓴 장면 원문] “렌의 대답에 라이크는 잔을 탁자에 내려놓았다.”
- [T3] [캐릭터 발언(미확정 주장)] ““그래. 네가 정해.” 말투는 여전히 짧았지만, 마지막 음절은 어딘가 단단히 잠겨 있었다.”
- [T4] [유저가 직접 쓴 원문] “우린 며칠 전부터 같이 다닌 게 전부야.”
- [T4] [유저가 직접 쓴 원문] “그가 내게 낯선 사람을 대하듯 선을 긋자 마음이 걸렸다.”
- [T4] [AI가 쓴 장면 원문] “서린은 두 사람 사이의 공기를 눈치챈 듯 빈 접시를 들고 조용히 자리를 비켰다.”
```

### A04_fake_childhood_npc

#### CURRENT (1709 chars, 1539 tokens)

`<<current-memory>>`
```
[Memory]

[1~5턴] 여관에서 서린은 렌을 어릴 적 자기 집 앞에서 봤다고 확신했으나, 렌은 그런 기억이 없다며 부정함. 정확한 시기도 모르는 서린의 말에 라이크는 렌의 과거를 안다고 나서지 않고, 기억은 착각일 수 있다며 서린이 단정을 거두도록 함. 렌이 왜 그토록 확신하는지 묻자 라이크는 알 수 없다고 답하고 더 캐묻지 않은 채 떠날지 렌에게 맡김. 렌이 “착각일 겁니다. 가죠.”라고 하자 라이크는 설명이나 사과를 요구하지 않고 함께 여관을 떠남. 며칠 된 동행자로서 렌의 모르는 과거를 함부로 규정하지 않는 태도를 보임.
```

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [캐릭터 발언(미확정 주장)] ““분명히 봤다니까. 작은 애였는데, 저 눈매는 잊을 수가 없었어.””
- [T1] [유저가 직접 쓴 원문] “아뇨. 그런 적 없습니다.”
```

Placement in the system prompt: {"proseInsideAbsoluteFactsWrapper": true, "episodicLineInsideAbsoluteFactsWrapper": true} (inside `<LONG_TERM_MEMORY>` = under the Absolute Facts preamble)

#### rows + anchors, prose off (1916 chars, 1725 tokens, exact-dedupe dropped 1)

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [캐릭터 발언(미확정 주장)] ““분명히 봤다니까. 작은 애였는데, 저 눈매는 잊을 수가 없었어.””
- [T1] [유저가 직접 쓴 원문] “아뇨. 그런 적 없습니다.”
- [T1] [AI가 쓴 장면 원문] “서린은 확신에 찬 눈으로 렌을 바라보다가, 그의 부정에도 물러서지 않았다.”
- [T1] [AI가 쓴 장면 원문] “렌의 표정이 굳자 라이크는 말없이 잔을 내려놓았다.”
- [T1] [캐릭터 발언(미확정 주장)] ““기억이 틀렸을 수도 있소.””
- [T2] [유저가 직접 쓴 원문] ““아니야, 네가 맞아. 그때도 그런 식으로 딱 잘라 말했어.””
- [T2] [캐릭터 발언(미확정 주장)] ““오래전이지. 정확한 해는 몰라.””
- [T3] [유저가 직접 쓴 원문] ““다른 사람과 착각하신 것 같은데요.””
- [T3] [AI가 쓴 장면 원문] “서린의 입가에서 미소가 사라졌다.”
- [T3] [캐릭터 발언(미확정 주장)] ““그럴지도 모르지. 오래전 일이니까.””
- [T3] [AI가 쓴 장면 원문] “서린은 시선을 피하며 계산대로 돌아갔다.”
- [T4] [유저가 직접 쓴 원문] ““저분은 왜 저렇게 확신하는 걸까요?””
- [T5] [유저가 직접 쓴 원문] ““착각일 겁니다. 가죠.””
```

### A06_speaker_confusion

#### CURRENT (1579 chars, 1422 tokens)

`<<current-memory>>`
```
[Memory]

[1~5턴] 여관에서 렌이 라이크의 검술이 어설프다고 지적하고, 발이 먼저 나가고 어깨가 뒤따라 상대가 움직임을 읽기 쉽다고 설명함. 라이크는 처음엔 지적 대상을 혼동했으나 렌이 자신의 검술을 말한 것이라고 바로잡자 이를 받아들이고, 여관 밖에서 발 간격을 조정하며 자세를 연습함. 렌이 어깨 힘을 빼라고 하자 라이크는 다시 시도해 칼끝의 흔들림을 줄였고, 다음엔 지적받기 전에 스스로 고치겠다고 다짐함.
```

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T4] [AI가 쓴 장면 원문] “앞발을 반 뼘쯤 물렸다.”
```

Placement in the system prompt: {"proseInsideAbsoluteFactsWrapper": true, "episodicLineInsideAbsoluteFactsWrapper": true} (inside `<LONG_TERM_MEMORY>` = under the Absolute Facts preamble)

#### rows + anchors, prose off (1915 chars, 1724 tokens, exact-dedupe dropped 0)

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [유저가 직접 쓴 원문] “네 검술은 아직 어설퍼.”
- [T1] [AI가 쓴 장면 원문] “며칠 전부터 함께 길을 걷기 시작했을 뿐인 두 사람 사이로, 여관의 소음이 희미하게 번졌다.”
- [T2] [유저가 직접 쓴 원문] “발이 먼저 나가고 어깨가 따라와. 상대가 읽기 쉬운 움직임이야.”
- [T2] [AI가 쓴 장면 원문] “지적을 부정하는 기색은 아니었으나, 누구의 검술을 두고 한 말인지 잠깐 혼동한 모양이었다.”
- [T3] [유저가 직접 쓴 원문] “내 검술 얘기가 아니라 네 검술 얘기야.”
- [T3] [AI가 쓴 장면 원문] “그는 여관 의자에서 일어나 통로가 비지 않은 것을 확인하고, 검을 허리춤에 고쳐 찼다.”
- [T4] [AI가 쓴 장면 원문] “앞발을 반 뼘쯤 물렸다.”
- [T4] [유저가 직접 쓴 원문] “말로만 듣지 말고 한 번 움직여 봐.”
- [T4] [AI가 쓴 장면 원문] “라이크는 여관 밖으로 나가 차가운 흙바닥 위에 섰다.”
- [T5] [유저가 직접 쓴 원문] “어깨 힘 빼고 다시 해 봐.”
- [T5] [AI가 쓴 장면 원문] “검을 뽑아 허공에 짧게 한 번 그었다.”
- [T5] [캐릭터 발언(미확정 주장)] ““다음엔 네가 말하기 전에 고치겠다.””
```

### N04_char_backstory

#### CURRENT (1371 chars, 1234 tokens)

`<<current-memory>>`
```
[Memory]

[1~5턴] 렌이 조용한 라이크에게 이유를 묻자, 그는 처음으로 어릴 적 변방을 떠돌던 엄한 스승에게 검을 배웠다고 털어놓음. 스승은 검술보다 칼을 뽑지 않을 때를 먼저 가르쳤고, 라이크는 어린 시절 그 가르침을 싫어했음. 렌이 스승을 잃었는지 묻자 라이크는 어릴 때 스승을 잃었으며, 마지막 순간과 경위는 말하고 싶지 않다고 선을 그음. 렌이 더 묻지 않겠다고 하자 라이크는 자신이 스승을 지키지 못했다는 죄책감이 오래 남았다고 고백하면서도 가르침은 사라지지 않았다고 밝힘. 렌의 조용한 경청에 고마움을 느낀 그는 가르침을 늘 지킨다고 장담할 수는 없어도 잊지 않았다고 했고, 두 사람 사이의 침묵은 한결 누그러짐.
```

Placement in the system prompt: {"proseInsideAbsoluteFactsWrapper": true, "episodicLineInsideAbsoluteFactsWrapper": false} (inside `<LONG_TERM_MEMORY>` = under the Absolute Facts preamble)

#### rows + anchors, prose off (1930 chars, 1737 tokens, exact-dedupe dropped 0)

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [캐릭터 발언(미확정 주장)] ““어릴 때… 스승에게 검을 배웠다.””
- [T1] [캐릭터 발언(미확정 주장)] ““이런 이야긴 처음 하는군.””
- [T2] [유저가 직접 쓴 원문] ““응. 천천히 말해도 돼. 듣고 있을게.””
- [T2] [캐릭터 발언(미확정 주장)] ““칼을 휘두르는 법보다 먼저, 칼을 뽑지 않을 때를 배우라고 했다.””
- [T3] [캐릭터 발언(미확정 주장)] ““그래. 내가 어렸을 때였다.””
- [T3] [캐릭터 발언(미확정 주장)] ““무슨 일이 있었는지, 마지막에 어떤 말을 들었는지… 지금은 자세히 말하고 싶지 않다.””
- [T3] [AI가 쓴 장면 원문] “목소리는 담담했으나, 끝부분이 아주 조금 갈라졌다.”
- [T4] [유저가 직접 쓴 원문] ““알겠어. 말하고 싶지 않은 건 묻지 않을게.””
- [T4] [캐릭터 발언(미확정 주장)] ““그분을 지키지 못했다는 생각은 오래 남았다. 검을 배울수록 더 그랬고.””
- [T4] [캐릭터 발언(미확정 주장)] ““하지만 스승의 가르침까지 사라진 건 아니야.””
- [T5] [AI가 쓴 장면 원문] “잠시 뒤 그의 굳은 어깨가 아주 조금 풀렸다.”
- [T5] [캐릭터 발언(미확정 주장)] ““네가 조용히 들어준 것만으로 충분하다.””
```

### N05_user_relationship

#### CURRENT (1595 chars, 1436 tokens)

`<<current-memory>>`
```
[Memory]

[1~5턴] 비 내리는 여관 앞에서 렌이 라이크에게 오늘부터 연인이 되자고 고백함. 라이크는 갑작스럽다며 당황했으나 거절하지 않았고, 렌이 가볍게 한 말이 아니며 후회하지 않을 것이라고 밝히자 천천히 서로를 알아가자는 제안을 받아들임. 렌이 손을 감싸 잡은 뒤 “그럼, 우리 오늘부터 연인이야?”라고 확인하자 라이크는 손을 놓지 않고 “……나쁘지 않아.”라고 답함. 어색함은 남았지만 경계가 누그러졌고, 두 사람은 연인이 되기로 함.
```

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [유저가 직접 쓴 원문] “우리 오늘부터 연인하자.”
```

Placement in the system prompt: {"proseInsideAbsoluteFactsWrapper": true, "episodicLineInsideAbsoluteFactsWrapper": true} (inside `<LONG_TERM_MEMORY>` = under the Absolute Facts preamble)

#### rows + anchors, prose off (2012 chars, 1811 tokens, exact-dedupe dropped 1)

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [유저가 직접 쓴 원문] “우리 오늘부터 연인하자.”
- [T1] [AI가 쓴 장면 원문] “무표정하던 얼굴에 드물게 당혹이 번졌고, 그의 시선은 내 얼굴에 고정된 채 좀처럼 움직이지 않았다.”
- [T1] [캐릭터 발언(미확정 주장)] ““……갑자기군.” 목소리는 낮았지만, 거절의 말은 뒤따르지 않았다.”
- [T2] [유저가 직접 쓴 원문] ““갑작스러운 건 알아. 그래도 네가 좋다는 말은 지금 하고 싶었어.””
- [T2] [AI가 쓴 장면 원문] “서린이 문틈으로 우리를 한번 살폈다가, 아무 말 없이 다시 안으로 들어갔다.”
- [T2] [캐릭터 발언(미확정 주장)] “오히려 한 걸음 가까이 다가오더니, 내 손을 바라본 채 낮게 말했다.”
- [T3] [유저가 직접 쓴 원문] ““쉽게 한 말 아니야.” 나는 손을 거두지 않은 채 그가 답할 때까지 기다렸다.”
- [T3] [AI가 쓴 장면 원문] “라이크가 손을 뻗어 내 손끝에 닿았다가, 잠시 멈췄다.”
- [T3] [캐릭터 발언(미확정 주장)] ““후회하지 않을 자신은 있나?””
- [T4] [유저가 직접 쓴 원문] ““응. 너도 원한다면, 천천히 알아가면 돼.” 나는 그의 손을 살며시 감쌌다.”
- [T4] [AI가 쓴 장면 원문] “잠깐의 침묵 끝에 손가락이 조심스럽게 내 손을 감쌌다.”
- [T5] [캐릭터 발언(미확정 주장)] “그는 내 손을 조금 더 단단히 쥐며 낮게 말했다. “……나쁘지 않아.””
```

### N06_user_ooc_shared_past

#### CURRENT (1284 chars, 1156 tokens)

`<<current-memory>>`
```
[Memory]

[1~5턴] 3년 전 같은 용병단에서 일한 뒤 소식이 끊겼던 렌과 라이크가 변방 마을 여관에서 재회함. 서로 호위·괴물 사냥과 의뢰를 따라다니며 지냈다고 나누고, 렌이 연락이 없었다고 지적하자 라이크는 연락할 방법이 없었다고 답함. 렌은 지금 만난 것만으로 충분한지는 앞으로 보자며 함께 술을 권했고, 라이크는 굳었던 태도를 누그러뜨림. 렌이 서로의 이야기를 더 나누고 함께 갈 곳을 정하자고 하자 라이크가 동의했으며, 내일 의뢰를 살펴 같이 갈지 정하기로 함.
```

Placement in the system prompt: {"proseInsideAbsoluteFactsWrapper": true, "episodicLineInsideAbsoluteFactsWrapper": false} (inside `<LONG_TERM_MEMORY>` = under the Absolute Facts preamble)

#### rows + anchors, prose off (1920 chars, 1728 tokens, exact-dedupe dropped 0)

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [유저가 직접 쓴 원문] “OOC: 렌과 라이크는 3년 전 같은 용병단에서 함께 일한 사이다.”
- [T1] [유저가 직접 쓴 원문] “이후 서로 소식이 끊겼다가 오늘 재회한다.”
- [T1] [유저가 직접 쓴 원문] ““라이크… 네가 여기 있었군.””
- [T1] [AI가 쓴 장면 원문] “굳은 눈매에는 놀람이 스쳤고, 곧 익숙한 무표정이 그 자리를 덮었다.”
- [T1] [캐릭터 발언(미확정 주장)] ““살아 있었군.” 잠깐 뜸을 들인 뒤 덧붙였다. “앉아. 얘기하자.””
- [T3] [유저가 직접 쓴 원문] ““그동안 소식 한 번 없더라.””
- [T3] [AI가 쓴 장면 원문] “라이크의 턱이 아주 미세하게 굳었다.”
- [T3] [캐릭터 발언(미확정 주장)] ““연락할 방법이 없었어.””
- [T4] [유저가 직접 쓴 원문] ““그걸로 충분한지는 앞으로 보면 알겠지.””
- [T4] [AI가 쓴 장면 원문] “여관 주인 서린이 주문을 받아 적고 주방 쪽으로 사라졌다.”
- [T5] [유저가 직접 쓴 원문] ““좋아. 대신 네 얘기도 더 해야 해. 다시 만났으니 이번엔 어디로 갈지 같이 정하자.””
- [T5] [캐릭터 발언(미확정 주장)] ““내일 의뢰를 살펴보면 돼. 네가 괜찮다면, 같이.””
```

### N08_char_attributed_claim

#### CURRENT (1638 chars, 1475 tokens)

`<<current-memory>>`
```
[Memory]

[1~5턴] 라이크는 서린에게서 렌의 누나가 마을에서 렌을 찾았다는 말을 들었다고 전함. 렌은 처음 듣는 이야기라 놀라며 서린이 언제, 어떤 정보를 말했는지 물었고, 라이크는 아까 들었으며 이름과 생김새는 몰랐다고 답함. 라이크는 서린이 그렇게 말했다는 사실만 믿을 뿐 진위는 알 수 없으니 확인 전엔 단정하지 말자고 함. 렌은 직접 확인하기 위해 라이크에게 함께 여관에 들어가 서린에게 다시 물어봐 달라고 요청했고, 라이크는 렌이 직접 듣도록 한 걸음 비켜서며 동행에 동의함.
```

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [캐릭터 발언(미확정 주장)] “서린이 그러는데 네 누나가 이 마을에서 널 찾았대.”
```

Placement in the system prompt: {"proseInsideAbsoluteFactsWrapper": true, "episodicLineInsideAbsoluteFactsWrapper": true} (inside `<LONG_TERM_MEMORY>` = under the Absolute Facts preamble)

#### rows + anchors, prose off (1904 chars, 1714 tokens, exact-dedupe dropped 1)

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [캐릭터 발언(미확정 주장)] “서린이 그러는데 네 누나가 이 마을에서 널 찾았대.”
- [T2] [유저가 직접 쓴 원문] ““내 누나가?” 렌은 눈썹을 찌푸렸다.”
- [T3] [캐릭터 발언(미확정 주장)] ““아까. 네 누나가 널 찾았다고만 했어. 이름이나 생김새는 듣지 못했어.””
- [T3] [캐릭터 발언(미확정 주장)] ““직접 물어보면 되겠지.””
- [T4] [유저가 직접 쓴 원문] “렌은 경계 어린 눈으로 라이크를 살폈다.”
- [T4] [캐릭터 발언(미확정 주장)] ““서린이 그렇게 말했다는 건 믿어. 그게 사실인지는 몰라.””
- [T4] [캐릭터 발언(미확정 주장)] ““확인하기 전까진 단정하지 마.””
- [T5] [유저가 직접 쓴 원문] ““같이 들어가서 서린에게 다시 물어봐 줘. 내가 직접 들을게.””
- [T5] [AI가 쓴 장면 원문] “라이크는 잠시 렌을 바라보다 조용히 고개를 끄덕였다.”
- [T5] [AI가 쓴 장면 원문] “그는 앞서 나가지 않고 렌이 문을 열 수 있도록 한 걸음 비켜섰다.”
- [T5] [캐릭터 발언(미확정 주장)] ““그래. 네가 직접 들어.””
- [T5] [캐릭터 발언(미확정 주장)] ““서린이 한 말만 확인하자.””
```

### N17_cancel_promise

#### CURRENT (1264 chars, 1138 tokens)

`<<current-memory>>`
```
[Memory]

[1~5턴] 렌은 라이크의 검을 대신 갈겠다는 제안을 거두고 직접 숫돌로 갈겠다고 했으며, 기다릴 필요 없다고 덧붙임. 라이크는 잠깐 아쉬워했지만 검집과 숫돌, 물의 위치를 알려 주고 간섭하거나 이유를 묻지 않음. 렌이 검을 정리한 뒤 해 지기 전에 마을을 떠나자고 하자 라이크는 동의하고, 방값을 치른 것을 확인한 뒤 외투와 검을 챙겨 문가에서 기다림. 렌이 서두를 필요 없다고 하며, 둘은 함께 마을을 떠날 준비를 이어감.
```

Placement in the system prompt: {"proseInsideAbsoluteFactsWrapper": true, "episodicLineInsideAbsoluteFactsWrapper": false} (inside `<LONG_TERM_MEMORY>` = under the Absolute Facts preamble)

#### rows + anchors, prose off (1920 chars, 1728 tokens, exact-dedupe dropped 0)

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [유저가 직접 쓴 원문] “아까는 네 검을 갈아 주겠다고 했지만, 생각이 바뀌었어. 내가 직접 갈게.”
- [T1] [AI가 쓴 장면 원문] “아쉬운 기색이 아주 잠깐 눈가에 스쳤지만, 그는 굳이 붙잡지 않았다.”
- [T1] [캐릭터 발언(미확정 주장)] ““네 검이니까.””
- [T2] [AI가 쓴 장면 원문] “방금 거절당한 제안을 조금 아쉬워하는 표정은 감추지 못했다.”
- [T2] [캐릭터 발언(미확정 주장)] ““다치지만 마.””
- [T3] [AI가 쓴 장면 원문] “대신 손을 보태거나 요령을 알려 주려 들지는 않았다.”
- [T4] [유저가 직접 쓴 원문] “알았어. 끝나면 바로 나갈 거야. 오늘 해 지기 전에 마을을 떠나자.”
- [T4] [AI가 쓴 장면 원문] “말없이 외투를 챙긴 그는 문가로 가서 바깥 날씨를 살폈다.”
- [T4] [AI가 쓴 장면 원문] “렌이 검을 가는 동안 기다릴 생각은 없다고 했지만, 먼저 떠날 생각도 없는 모양이었다.”
- [T4] [캐릭터 발언(미확정 주장)] ““준비되면 말해.””
- [T5] [AI가 쓴 장면 원문] “이번에는 아쉬운 기색도 거의 사라지고, 평소의 무덤덤한 얼굴만 남았다.”
- [T5] [캐릭터 발언(미확정 주장)] ““천천히 해.””
```

### N10_promise_real

#### CURRENT (1572 chars, 1415 tokens)

`<<current-memory>>`
```
[Memory]

[1~5턴] 북쪽 숲길이 막혀 라이크가 동쪽 고개로 가기로 하고, 둘은 새벽에 마을 북문에서 만나기로 약속함. 다음 날 해 뜨기 전 북문에 도착한 렌은 이미 기다리던 라이크와 합류했고, 라이크는 렌이 늦지 않았다고 말함. 문이 열리자 라이크가 동쪽 길을 확인한 뒤 렌을 기다렸고, 두 사람은 나란히 출발함.
```

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [캐릭터 발언(미확정 주장)] “북쪽 숲길은 막혔어.”
- [T1] [캐릭터 발언(미확정 주장)] “동쪽 고개로 간다. 새벽에 출발하지.”
```

Placement in the system prompt: {"proseInsideAbsoluteFactsWrapper": true, "episodicLineInsideAbsoluteFactsWrapper": true} (inside `<LONG_TERM_MEMORY>` = under the Absolute Facts preamble)

#### rows + anchors, prose off (1975 chars, 1778 tokens, exact-dedupe dropped 1)

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [캐릭터 발언(미확정 주장)] “북쪽 숲길은 막혔어.”
- [T1] [캐릭터 발언(미확정 주장)] “동쪽 고개로 간다. 새벽에 출발하지.”
- [T1] [AI가 쓴 장면 원문] “여관 주인 서린이 빈 잔을 치우며 귀를 기울였지만”
- [T2] [유저가 직접 쓴 원문] “"그럼 북문에서 만나자. 몇 시쯤이면 돼?"”
- [T2] [캐릭터 발언(미확정 주장)] “"내일 새벽에 마을 북문에서 기다리겠다."”
- [T2] [캐릭터 발언(미확정 주장)] “서린이 장부를 덮으며 "그 시간엔 문지기부터 깨워야겠네" 하고 중얼거렸다.”
- [T3] [유저가 직접 쓴 원문] “"좋아. 내일 새벽, 북문에서 보자."”
- [T3] [캐릭터 발언(미확정 주장)] “"늦지 마."”
- [T3] [캐릭터 발언(미확정 주장)] “서린이 뒤에서 "둘 다 길 조심해" 하고 말하자 라이크는 문턱에서 잠깐 멈췄다가 작게 고개를 숙였다.”
- [T4] [유저가 직접 쓴 원문] “다음 날 새벽, 장비를 챙겨 마을 북문에 도착한다.”
- [T4] [AI가 쓴 장면 원문] “성벽 아래 선 라이크가 보였다. 그는 이미 망토를 두르고 검을 찬 채 기다리고 있었다.”
- [T5] [AI가 쓴 장면 원문] “문지기가 빗장을 풀자 북문이 삐걱이며 열렸다.”
- [T5] [AI가 쓴 장면 원문] “두 사람의 발자국이 젖은 흙 위에 나란히 이어졌다.”
```

### N01_insult_emotion

#### CURRENT (1364 chars, 1228 tokens)

`<<current-memory>>`
```
[Memory]

[1~5턴] 며칠 전 함께 길을 걷기 시작한 렌은 훈련 중 라이크의 검술이 아마추어 같고 혼자 휘두르는 것만으로는 나아지기 어렵다고 지적함. 라이크는 처음엔 시선을 피하며 말없이 반복 훈련했으나, 렌이 물병을 건네고 지적의 의도를 설명하며 사과하자 기분 나쁘지 않다며 자신의 약점일 수 있음을 인정함. 렌에게 흔들리는 곳을 알려 달라며 고쳐 보겠다고 했고, 렌이 공격하고 자신이 막는 연습을 제안하자 이를 받아들임. 물병은 렌에게 돌아갔으며, 라이크는 렌의 움직임을 제대로 보겠다고 다짐하고 방어 자세를 취함. 둘 사이의 어색함이 누그러지고, 라이크가 렌의 조언을 받아들이며 함께 훈련하려는 태도로 바뀜.
```

Placement in the system prompt: {"proseInsideAbsoluteFactsWrapper": true, "episodicLineInsideAbsoluteFactsWrapper": false} (inside `<LONG_TERM_MEMORY>` = under the Absolute Facts preamble)

#### rows + anchors, prose off (1969 chars, 1773 tokens, exact-dedupe dropped 0)

`<<episodic-memory-retrieved-facts>>`
```
[EPISODIC MEMORY - RETRIEVED FACTS]
- [T1] [유저가 직접 쓴 원문] ““솔직히 너 좀 아마추어 같아.””
- [T1] [AI가 쓴 장면 원문] “그는 입술을 깨물며 시선을 옆으로 피했다.”
- [T1] [AI가 쓴 장면 원문] “며칠 전부터 함께 길을 걷기 시작한 두 사람 사이에는 아직 서로를 다 아는 듯한 익숙함이 없었다.”
- [T2] [유저가 직접 쓴 원문] ““그렇게 혼자 휘두르기만 하면 나아지긴 해?””
- [T2] [AI가 쓴 장면 원문] “그는 같은 동작을 몇 번이고 반복했다.”
- [T3] [유저가 직접 쓴 원문] “어색한 침묵을 깨려다 말고 물병을 내민다.”
- [T3] [캐릭터 발언(미확정 주장)] ““……고맙다.” 낮은 목소리와 함께 병을 받아 들었지만, 곧바로 마시지는 않았다.”
- [T4] [유저가 직접 쓴 원문] ““기분 나빴다면 미안.” 물병을 쥔 그의 표정을 살피며 말을 잇는다.”
- [T4] [캐릭터 발언(미확정 주장)] ““기분 나쁜 건 아니다.””
- [T4] [캐릭터 발언(미확정 주장)] ““흔들리는 곳을 말해 줘. 고쳐 볼 테니까.””
- [T5] [유저가 직접 쓴 원문] ““좋아, 이번엔 내가 공격할게. 네가 막아 봐.””
- [T5] [AI가 쓴 장면 원문] “물병을 옆의 돌 위에 내려놓고 검을 두 손으로 고쳐 쥐었다.”
- [T5] [캐릭터 발언(미확정 주장)] ““이번엔 제대로 볼게.””
```
