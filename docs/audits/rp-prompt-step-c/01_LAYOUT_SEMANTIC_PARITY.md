# 01_LAYOUT_SEMANTIC_PARITY

```text
layout_A_est_tokens = 670
layout_B_est_tokens = 281
reduction = 389 (58.1%)
semantic_parity = PASS
LAYOUT_PRIMARY_OWNER = 1
LAYOUT_RECENCY_ECHO = 1 (user-tail unchanged)
```

| id | meaning | A | B | class |
|---|---|---|---|---|
| same_beat_grouping | 같은 비트 지문을 한 문단에서 연결 | true | true | PRESERVED |
| no_sentence_per_paragraph | 지문 한 문장마다 새 문단 금지 | true | true | MERGED |
| intentional_one_sentence_emphasis | 의도적 한 문장 문단 예외 | true | true | MERGED |
| speaker_change_boundary | 화자 변경 → 새 문단 | true | true | PRESERVED |
| time_place_situation_boundary | 시간·장소·중심 상황 전환 → 새 문단 | true | true | PRESERVED |
| dialogue_own_paragraph | 대사는 독립 문단 | true | true | MERGED |
| blank_line_separation | 지문/대사 빈 줄(\n\n) | true | true | PRESERVED |
| no_append_dialogue | 지문 끝에 대사 붙이지 않음 | true | true | PRESERVED |
| no_mid_utterance_narration | 대사 중간 지문 분절 금지 | true | true | PRESERVED |
| wrong_right_example | Wrong/Right production example | true | false | REMOVED_DUPLICATE |
| separate_dialogue_narration_header | [DIALOGUE & NARRATION] second owner header | true | false | REMOVED_DUPLICATE |
| user_tail_echo | user-tail layout recency echo unchanged | true | true | PRESERVED |

## NEW_MEANING scan

PASS — no out-of-scope stylistic policies detected

## Candidate body

```text
[OUTPUT LAYOUT]
같은 인물·장소·순간의 하나의 연속 서술 비트는 행동·감각·생각·기억·판단 사이에서 초점이 조금 바뀌더라도 한 문단 안에서 자연스럽게 연결한다. 지문 한 문장이 끝났다는 이유만으로 습관적으로 새 문단을 만들지 않는다.
새 문단은 화자 변경, 뚜렷한 시간·장소 또는 중심 상황 전환, 혹은 충격·반전·결정적 발견·의도적 정적처럼 실제 강조가 필요할 때 시작한다.
대사는 화자별 독립 문단으로 두며 지문과 빈 줄(\n\n)로 분리한다. 지문 끝에 대사를 붙이지 않고, 대사 중간에 지문을 끼워 같은 발화를 불필요하게 분절하지 않는다.
```
