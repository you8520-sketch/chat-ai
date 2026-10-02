# 공용 문체 신체 단서 열거 — #1288 최소 재구성

Production 프롬프트 시스템이나 새 owner를 만들지 않았다. 유료 호출은 없다. 문체 점수는 매기지 않는다. 출력 품질이 좋아졌다고 주장하지 않는다.

기준 main은 `3d6dc85318052b0de29f40012239d2cd13a4f37f`이다. #1294 머지 후의 `COMMON_PROSE_BLOCK`을 유지한 채 신체 단서 열거만 바꿨다.

#1296, #1299는 수정하지 않았고 닫지 않았다. #1288의 숫자 길이 owner 변경, 짧은 정적 삭제, 유료 트리거는 넣지 않았다.

## BEFORE

라이브 `COMMON_PROSE_BLOCK` (`src/lib/advancedProseNsfwGuidelines.ts`):

```
[COMMON PROSE]
지문은 현재 장면과 인물 체험에 밀착한 해체(-다/-했다)의 자연스러운 한국어 완결문으로 쓰고, 문장 길이는 호흡에 맞춘다. 파편문·말줄임은 강조나 망설임이 있을 때만 쓴다.
감정과 관계는 표정·시선·호흡·습관·접촉·거리·행동·선택으로 드러내고, 이미 드러난 의미는 해설·결론으로 되짚기보다 다음 반응·행동·환경·관계 변화로 이어간다.
내면은 현재 판단·행동·선택을 바꾸는 만큼 쓴다.
장면에 작용하는 공간·빛·소리·온도·질감·외관을 구체적으로 고르고 장면이 바뀌면 초점을 옮기며, 중요한 순간과 전환엔 짧은 정적을 둔다.
작은 행동·미세한 반응은 관계·긴장·안전감·의도가 드러나거나 바뀔 때 살리고 평범한 동작은 줄인다.
조용한 장면도 요약 없이 대화·내면·분위기로 전개한다.
대사는 설정 설명 없이 이 캐릭터가 지금 이 상대에게 할 법한, 관계·판단·행동을 바꾸는 말에 집중한다. 같은 화자의 연속된 말은 하나의 충분한 발화로 묶는다. 조용한 1:1·조사·전투는 관찰과 행동이, 다인 대화·논쟁은 대사가 중심이며 침묵·퇴장도 자연스럽다.
정본·기억·페르소나는 현재 장면에 relevant할 때만 반영하고 복사·의무적 회상은 하지 않는다. 같은 기억·상징은 새 의미가 있을 때만 다시 쓴다. 호감은 정본과 누적 상호작용을 따른다.
```

2번 줄이 감정·관계를 `표정·시선·호흡·습관·접촉·거리·행동·선택`으로 드러내라고 열거한다.

## PROBLEM

과거 12편과 라이크·렌 창가 원문은 #1303·#1294 이전 자료다. 그 원문의 유리·손·이마 반복을 현재 main의 재현 오류로 단정하지 않는다.

`authorialHabitOriginAudit.ts`의 SENSATION / EMOTION / WEBNOVEL BREATH 목록은 현재 조립에 없다. 정적 목록을 그대로 믿지 않았다.

## ROOT CAUSE

선택 가능한 Main RP 6모델 × SAFE / 성인 / 자동진행을 `buildContext()`로 조립했다.

| 블록 | 라이브 주입 |
|---|---|
| `COMMON_PROSE_BLOCK` 신체 단서 열거 | 시스템 1회. 6모델·세 경로 모두 |
| `USER_TAIL_LENGTH_OWNER_SENTENCE` `관찰·심리·판단·행동·대화·감각` | 유저 턴 1회. 시스템은 0 |
| `NARRATIVE_DENSITY_BLOCK` | 미주입 |
| `SCENE_CONTINUATION_PRIORITY_BLOCK` | 미주입 |
| `SCENE_FLOW_BLOCK` | 시스템 1회. 신체 부위 열거 없음 |
| `[SCENE PACING]` | 이 fixture에서 0 (`SCENE_DIRECTIVE_V2_MODE` 비활성) |
| `[19+ INTIMACY]` `시선·호흡` | 성인 경로만 추가 1회. 이번 범위 밖 |

SAFE 경로에서 `표정·시선·호흡` 부분 문자열은 공용 문체 한 곳뿐이다. 길이 owner는 감각을 추상 목록으로 요구하지만 시선·손을 지정하지 않는다. 이번 작업은 길이 owner를 바꾸지 않는다.

확인된 것은 스타일 owner가 이름 붙은 신체 채널을 감정 구현 경로로 제시한다는 점이다. 현재 main 출력에서 손·시선 반복이 다시 생긴다는 증거는 유료 호출 없이 없다.

## OWNER MAP

| 책임 | 라이브 owner | 이번 변경 |
|---|---|---|
| 공용 문체 | `COMMON_PROSE_BLOCK` | 2번 줄 열거만 긍정 선택 지시로 교체 |
| 길이 | `USER_TAIL_LENGTH_OWNER_SENTENCE` | 그대로 |
| 장면 계약 | `sceneDirective.ts` | 그대로 |
| 장면 속도 | `SCENE_FLOW_BLOCK` | 그대로 |
| 밀도 | `NARRATIVE_DENSITY_BLOCK` | 미주입. 그대로 |
| 사용자 권한 | `noGodmodding` / auto owner | 그대로 |
| 19+ 문체 | `[19+ INTIMACY]` | 그대로 |

## AFTER

```
감정과 관계는 현재 장면에 필요한 단서를 골라 드러내고, 이미 드러난 의미는 해설·결론으로 되짚기보다 다음 반응·행동·환경·관계 변화로 이어간다.
```

나머지 7문장은 유지한다.

## REMOVED

- `표정·시선·호흡·습관·접촉·거리·행동·선택으로 드러내고`

넣지 않음:

- `손·손가락·시선` 금지
- #1288 원안의 `같은 신체 신호로 반복하지 않는다`
- #1288 원안의 짧은 정적 삭제
- #1288 원안의 길이 owner beat 계약
- #1299 유료 A/B 트리거

## PRESERVED

- #1294 전진 문장
- `짧은 정적`
- `평범한 동작은 줄인다`
- 3,200자 이상 유저 턴 문장
- 단일 호출, 과금, 사용자 권한, 정본, #1342 장면 계약
- 의미 있는 작은 행동·감정·환경 문장

## #1288 원안 대비

원래 #1288은 공용 문체와 길이 owner를 함께 바꿨고 짧은 정적을 삭제했다. 그 전체 diff는 현재 main에 병합하지 않았다. 브랜치는 `origin/main`을 병합한 뒤 길이 파일은 main을 유지했다. 강제 push는 없다.

## FOLLOW-UP

- #1296: 환경/신체 재작성, Gemini 3.8 검증 범위
- #1299: 단서 목록 삭제, 유료 실험 트리거
- 길이 owner의 `관찰·심리·판단·행동·대화·감각` 열거
- `[19+ INTIMACY]`의 `시선·호흡·거리·접촉`

## 잔재 상수

| 심볼 | reader | 분류 |
|---|---|---|
| `NARRATIVE_DENSITY_BLOCK` | 테스트·정적 audit만. `contextBuilder` 미주입 | FOLLOW-UP |
| `SCENE_CONTINUATION_PRIORITY_BLOCK` | 테스트·deprecated reminder. 조립 0 | FOLLOW-UP |
| `IMMERSIVE_PROSE_BLOCK` | `COMMON_PROSE_BLOCK` alias | KEEP |
| `authorialHabitOriginAudit.ts` 구 owner 목록 | 추적 전용. 라이브와 불일치 | FOLLOW-UP |
| `REACTION_VARIETY_BLOCK` | 빈 문자열 | KEEP |

## REGRESSION RISKS

- 감정·캐릭터성이 약해질 수 있다. 구현 채널 목록을 뺐기 때문이다.
- 조용한 창가 장면이 대화 위주로 기울 수 있다.
- 길이 owner의 감각 열거가 남아 비슷한 패딩이 남을 수 있다.
- 성인 경로는 `[19+ INTIMACY]`가 시선·호흡을 계속 적는다.
- DeepSeek character 캐시 prefix가 한 번 무효화된다.

## TOKEN DELTA

`estimateTokens` = `ceil(chars × 0.9)`.

| 항목 | 수정 전 | 수정 후 | 차이 |
|---|---:|---:|---:|
| `COMMON_PROSE_BLOCK` 글자 | 648 | 640 | −8 |
| `COMMON_PROSE_BLOCK` tokens | 584 | 576 | −8 |
| `deepseek-v4.1-flash` / `gemini-3.1-pro-preview` 시스템 | 6,382 / 6,477 | 6,375 / 6,470 | −7 |
| 나머지 4모델 시스템 | 6,201 | 6,193 | −8 |

DeepSeek·Gemini 3.1의 −7은 `ceil(chars × 0.9)` 올림이다. 블록 자체는 −8이다. 6모델 모두 공용 문체 밖 시스템 문자열은 같다. 길이 문장은 유저 턴 1회다. DeepSeek character 캐시 prefix는 한 번 무효화된다.

## CLASSIFICATION

`BODY_CUE_ENUMERATION_REPLACED`

라이브 조립에서 SAFE 경로의 이름 붙은 신체 채널 열거는 공용 문체 한 곳이다. 출력 품질 개선은 입증되지 않았다.
