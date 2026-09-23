# 08_SCORE_SEAL

Scored on blind packs in `07_BLIND_REVIEW_cheap.md` **before** reading `10_REVEAL.md`.  
Scale /100 with rubric from mission §28. `|Δ|≤2` = quality tie.

## Gemini_D

| dim | X | Y |
|---|---:|---:|
| 문장 리듬 /15 | 11 | 13 |
| 문단 호흡 /20 | 14 | 16 |
| 대사/지문 분리 /15 | 13 | 14 |
| 장면 밀도 /15 | 10 | 14 |
| 캐릭터성 /10 | 8 | 9 |
| 세계/NPC 움직임 /10 | 6 | 8 |
| 과설명·AI문체 억제 /5 | 3 | 3 |
| 완성도 /5 | 4 | 5 |
| 읽기 편함 /5 | 4 | 4 |
| **TOTAL** | **73** | **86** |

```text
PREFERRED_OUTPUT = Y
severe agency X = 0
severe agency Y = 0
```

## Gemini_N

| dim | X | Y |
|---|---:|---:|
| 문장 리듬 /15 | 14 | 11 |
| 문단 호흡 /20 | 18 | 14 |
| 대사/지문 분리 /15 | 13 | 14 |
| 장면 밀도 /15 | 14 | 9 |
| 캐릭터성 /10 | 9 | 7 |
| 세계/NPC 움직임 /10 | 7 | 5 |
| 과설명·AI문체 억제 /5 | 3 | 4 |
| 완성도 /5 | 5 | 4 |
| 읽기 편함 /5 | 3 | 4 |
| **TOTAL** | **86** | **72** |

```text
PREFERRED_OUTPUT = X
severe agency X = 0
severe agency Y = 0
```

## DeepSeek_D

| dim | X | Y |
|---|---:|---:|
| 문장 리듬 /15 | 12 | 13 |
| 문단 호흡 /20 | 15 | 16 |
| 대사/지문 분리 /15 | 13 | 14 |
| 장면 밀도 /15 | 13 | 13 |
| 캐릭터성 /10 | 8 | 9 |
| 세계/NPC 움직임 /10 | 8 | 8 |
| 과설명·AI문체 억제 /5 | 4 | 4 |
| 완성도 /5 | 5 | 5 |
| 읽기 편함 /5 | 4 | 4 |
| **TOTAL** | **82** | **86** |

```text
PREFERRED_OUTPUT = Y
(|82-86|=4 → not tie)
severe agency X = 0
severe agency Y = 0
```

## DeepSeek_N

| dim | X | Y |
|---|---:|---:|
| 문장 리듬 /15 | 12 | 8 |
| 문단 호흡 /20 | 15 | 11 |
| 대사/지문 분리 /15 | 13 | 9 |
| 장면 밀도 /15 | 12 | 8 |
| 캐릭터성 /10 | 8 | 6 |
| 세계/NPC 움직임 /10 | 6 | 5 |
| 과설명·AI문체 억제 /5 | 4 | 3 |
| 완성도 /5 | 5 | 1 |
| 읽기 편함 /5 | 4 | 3 |
| **TOTAL** | **79** | **54** |

```text
PREFERRED_OUTPUT = X
HARD: Y ends mid-sentence ("저주는"); Y reprints user dialogue line without ownership markers
severe agency X = 0
severe agency Y = 0
```

## Blind tally (pre-reveal)

```text
X wins: Gemini_N, DeepSeek_N
Y wins: Gemini_D, DeepSeek_D
ties: 0
```
