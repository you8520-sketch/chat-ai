# Injected memory blocks per arm (80-turn fixture, same scenes)
Arms: OLD d84bbcfd, B-1 c87d547d, CURRENT 1f9288d5. Current Memory text is byte-identical across the three arms and models (fixed synthetic extractive summary; contains USER lines only, duplicated, no assistant text, no speaker labels). Only the episodic block differs. archive/medium-term/relationship-ledger are empty in all arms.

## Scene A_direct_quote
USER INPUT: 아마추어 같다는 말 기억나?

### OLD (d84bbcfd) episodic block (items only; header boilerplate is identical, see dump-old.json)
```
- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.
```

### B1 (c87d547d) episodic block (items only; header boilerplate is identical, see dump-b1.json)
```
- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
```

### CUR (1f9288d5) episodic block (items only; header boilerplate is identical, see dump-cur.json)
```
- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
- [T1] [유저가 직접 쓴 원문] “솔직히 너 좀 아마추어 같아.”
```

## Scene B_npc_no_cue
USER INPUT: 렌은 약초 노점의 노파에게 다가가 말을 건다. "할머니, 이 근처에 묵을 만한 여관이 있을까요? 오늘 밤 안에 북문을 나가야 해서요." 노파가 라이크를 아래위로 훑어보더니 혀를 찬다. "저 젊은이, 허리춤에 찬 칼이 아깝구먼. 폼만 잡지 제대로 휘둘러 본 적은 없어 보이는데."

### OLD (d84bbcfd) episodic block (items only; header boilerplate is identical, see dump-old.json)
```
- [T1] 라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.
- [T75] 라이크는 75번째 장작 더미를 쌓았다.
- [T72] 라이크는 72번째 장작 더미를 쌓았다.
- [T69] 라이크는 69번째 장작 더미를 쌓았다.
- [T66] 라이크는 66번째 장작 더미를 쌓았다.
- [T63] 라이크는 63번째 장작 더미를 쌓았다.
- [T60] 라이크는 60번째 장작 더미를 쌓았다.
- [T57] 라이크는 57번째 장작 더미를 쌓았다.
```

### B1 (c87d547d) episodic block (items only; header boilerplate is identical, see dump-b1.json)
```
- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
- [T75] [AI가 쓴 장면 원문] “라이크는 75번째 장작을 쌓았다.”
- [T72] [AI가 쓴 장면 원문] “라이크는 72번째 장작을 쌓았다.”
- [T69] [AI가 쓴 장면 원문] “라이크는 69번째 장작을 쌓았다.”
- [T66] [AI가 쓴 장면 원문] “라이크는 66번째 장작을 쌓았다.”
- [T63] [AI가 쓴 장면 원문] “라이크는 63번째 장작을 쌓았다.”
- [T60] [AI가 쓴 장면 원문] “라이크는 60번째 장작을 쌓았다.”
- [T57] [AI가 쓴 장면 원문] “라이크는 57번째 장작을 쌓았다.”
```

### CUR (1f9288d5) episodic block (items only; header boilerplate is identical, see dump-cur.json)
```
- [T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”
- [T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”
- [T1] [유저가 직접 쓴 원문] “솔직히 너 좀 아마추어 같아.”
- [T75] [AI가 쓴 장면 원문] “라이크는 75번째 장작을 쌓았다.”
- [T72] [AI가 쓴 장면 원문] “라이크는 72번째 장작을 쌓았다.”
- [T69] [AI가 쓴 장면 원문] “라이크는 69번째 장작을 쌓았다.”
- [T66] [AI가 쓴 장면 원문] “라이크는 66번째 장작을 쌓았다.”
- [T63] [AI가 쓴 장면 원문] “라이크는 63번째 장작을 쌓았다.”
```

## Current Memory text (identical in all arms)
```
[현재기억]
최근 대화(히스토리)에 없는 이전 구간의 요약이다. 연속성은 히스토리와 관계 메모를 우선한다.

[1~5턴] 솔직히 너 좀 아마추어 같아. 내일까지 검을 갈아다 줄게. 약속이야. 오늘의 잡담 3 오늘의 잡담 4 오늘의 잡담 5 솔직히 너 좀 아마추어 같아. 내일까지 검을 갈아다 줄게. 약속이야. 오늘의 잡담 3 오늘의 잡담 4 오늘의 잡담 5

[6~10턴] 오늘의 잡담 6 오늘의 잡담 7 오늘의 잡담 8 오늘의 잡담 9 좋아, 우리 오늘부터 연인하자. 오늘의 잡담 6 오늘의 잡담 7 오늘의 잡담 8 오늘의 잡담 9 좋아, 우리 오늘부터 연인하자.

[11~15턴] 오늘의 잡담 11 오늘의 잡담 12 오늘의 잡담 13 오늘의 잡담 14 그 약속은 취소할게. 검은 내가 직접 갈게. 오늘의 잡담 11 오늘의 잡담 12 오늘의 잡담 13 오늘의 잡담 14 그 약속은 취소할게. 검은 내가 직접 갈게.

[16~20턴] 오늘의 잡담 16 오늘의 잡담 17 오늘의 잡담 18 오늘의 잡담 19 문 쪽을 바라본다. 오늘의 잡담 16 오늘의 잡담 17 오늘의 잡담 18 오늘의 잡담 19 문 쪽을 바라본다.

[21~25턴] 오늘의 잡담 21 오늘의 잡담 22 오늘의 잡담 23 시장에 다녀왔어. 오늘의 잡담 25 오늘의 잡담 21 오늘의 잡담 22 오늘의 잡담 23 시장에 다녀왔어. 오늘의 잡담 25

[26~30턴] 오늘의 잡담 26 오늘의 잡담 27 오늘의 잡담 28 오늘의 잡담 29 커피를 마셨어. 오늘의 잡담 26 오늘의 잡담 27 오늘의 잡담 28 오늘의 잡담 29 커피를 마셨어.

[31~35턴] 오늘의 잡담 31 오늘의 잡담 32 라이크와 함께 걷는다. 오늘의 잡담 34 오늘의 잡담 35 오늘의 잡담 31 오늘의 잡담 32 라이크와 함께 걷는다. 오늘의 잡담 34 오늘의 잡담 35

[36~40턴] 오늘의 잡담 36 오늘의 잡담 37 오늘의 잡담 38 오늘의 잡담 39 미안, 우리 그만 헤어지자. 오늘의 잡담 36 오늘의 잡담 37 오늘의 잡담 38 오늘의 잡담 39 미안, 우리 그만 헤어지자.

[41~45턴] 오늘의 잡담 41 오늘의 잡담 42 오늘의 잡담 43 오늘의 잡담 44 오늘의 잡담 45 오늘의 잡담 41 오늘의 잡담 42 오늘의 잡담 43 오늘의 잡담 44 오늘의 잡담 45

[46~50턴] 오늘의 잡담 46 오늘의 잡담 47 오늘의 잡담 48 오늘의 잡담 49 오늘의 잡담 50 오늘의 잡담 46 오늘의 잡담 47 오늘의 잡담 48 오늘의 잡담 49 오늘의 잡담 50

[51~55턴] 오늘의 잡담 51 오늘의 잡담 52 오늘의 잡담 53 오늘의 잡담 54 오늘의 잡담 55 오늘의 잡담 51 오늘의 잡담 52 오늘의 잡담 53 오늘의 잡담 54 오늘의 잡담 55

[56~60턴] 오늘의 잡담 56 오늘의 잡담 57 오늘의 잡담 58 오늘의 잡담 59 오늘의 잡담 60 오늘의 잡담 56 오늘의 잡담 57 오늘의 잡담 58 오늘의 잡담 59 오늘의 잡담 60

[61~65턴] 오늘의 잡담 61 오늘의 잡담 62 오늘의 잡담 63 오늘의 잡담 64 오늘의 잡담 65 오늘의 잡담 61 오늘의 잡담 62 오늘의 잡담 63 오늘의 잡담 64 오늘의 잡담 65

[66~70턴] 오늘의 잡담 66 오늘의 잡담 67 오늘의 잡담 68 오늘의 잡담 69 오늘의 잡담 70 오늘의 잡담 66 오늘의 잡담 67 오늘의 잡담 68 오늘의 잡담 69 오늘의 잡담 70

[71~75턴] 오늘의 잡담 71 오늘의 잡담 72 오늘의 잡담 73 오늘의 잡담 74 오늘의 잡담 75 오늘의 잡담 71 오늘의 잡담 72 오늘의 잡담 73 오늘의 잡담 74 오늘의 잡담 75

[76~80턴] 오늘의 잡담 76 오늘의 잡담 77 오늘의 잡담 78 오늘의 잡담 79 오늘의 잡담 80 오늘의 잡담 76 오늘의 잡담 77 오늘의 잡담 78 오늘의 잡담 79 오늘의 잡담 80
```

## Fixed extractor replay rows stored per arm (episodic_memory_facts: source_turn, fact_text, metadata)

### OLD (d84bbcfd) rows=17
- T1 fact_text='라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.' metadata={"extraction":"shared_initial_per_turn","assistant_message_id":3,"memory_evidence_type":"explicit_scene_event"}
- T20 fact_text='서린이 문을 열고 들어왔다.' metadata={"extraction":"shared_initial_per_turn","assistant_message_id":41,"memory_evidence_type":"explicit_scene_event"}
- T24 fact_text='라이크의 누나는 유저와 예전부터 알고 지낸 사이다.' metadata={"extraction":"shared_initial_per_turn","assistant_message_id":49,"memory_evidence_type":"explicit_scene_event"}
- T33 fact_text='유저가 라이크의 손을 잡고 함께 걸었다.' metadata={"extraction":"shared_initial_per_turn","assistant_message_id":67,"memory_evidence_type":"explicit_scene_event"}

### B1 (c87d547d) rows=15
- T1 fact_text='라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.' metadata={"extraction":"shared_initial_per_turn","assistant_message_id":3,"memory_evidence_type":"explicit_scene_event","evidence":{"role":"assistant","message_id":3,"quote":"라이크는 입술을 깨물며 시선을 피했다.","authority":"CURRENT_SCENE","match":"normalized_exact"}}
- T20 fact_text='서린이 문을 열고 들어왔다.' metadata={"extraction":"shared_initial_per_turn","assistant_message_id":41,"memory_evidence_type":"explicit_scene_event","evidence":{"role":"assistant","message_id":41,"quote":"서린이 문을 열고 들어왔다.","authority":"CURRENT_SCENE","match":"normalized_exact"}}

### CUR (1f9288d5) rows=18
- T1 fact_text='유저가 라이크의 검술 실력을 초보 수준이라고 평가했다.' metadata={"extraction":"shared_initial_per_turn","assistant_message_id":3,"memory_evidence_type":"explicit_user_statement","evidence":{"role":"user","message_id":2,"quote":"솔직히 너 좀 아마추어 같아.","authority":"USER_EXPLICIT","match":"normalized_exact"}}
- T1 fact_text='라이크는 아마추어 같다는 말에 상처받아 시선을 피했다.' metadata={"extraction":"shared_initial_per_turn","assistant_message_id":3,"memory_evidence_type":"explicit_scene_event","evidence":{"role":"assistant","message_id":3,"quote":"라이크는 입술을 깨물며 시선을 피했다.","authority":"CURRENT_SCENE","match":"normalized_exact"}}
- T10 fact_text='유저와 라이크는 서로 연인이 되기로 명시적으로 합의했다.' metadata={"extraction":"shared_initial_per_turn","assistant_message_id":21,"memory_evidence_type":"explicit_user_statement","evidence":{"role":"user","message_id":20,"quote":"좋아, 우리 오늘부터 연인하자.","authority":"USER_EXPLICIT","match":"normalized_exact"}}
- T20 fact_text='서린이 문을 열고 들어왔다.' metadata={"extraction":"shared_initial_per_turn","assistant_message_id":41,"memory_evidence_type":"explicit_scene_event","evidence":{"role":"assistant","message_id":41,"quote":"서린이 문을 열고 들어왔다.","authority":"CURRENT_SCENE","match":"normalized_exact"}}
- T40 fact_text='유저와 라이크는 서로 헤어지기로 명시적으로 합의했다.' metadata={"extraction":"shared_initial_per_turn","assistant_message_id":81,"memory_evidence_type":"explicit_user_statement","evidence":{"role":"user","message_id":80,"quote":"미안, 우리 그만 헤어지자.","authority":"USER_EXPLICIT","match":"normalized_exact"}}
