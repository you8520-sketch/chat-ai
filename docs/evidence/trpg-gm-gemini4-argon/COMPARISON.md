# 원문 대조 (점수 없음)

동일 final wire 아님. 아래는 사실만 나란히 둔다. 품질 판단은 GPT.

## 장면 선택

캠페인 44. 최소 2장면: R1 강이현 FAILURE, R3 권태현 PARTIAL_SUCCESS.

서버 위치는 세 라운드 모두 전원 현관홀, 지도 `r6`, AP 3, risk 0, alarm false.

## R1 판정 (서버)

| 이름 | d20 | stat | total | DC | tier |
|---|---|---|---|---|---|
| 강이현 | 2 | int | 3 | 9 | FAILURE |
| 렌 | 13 | int | 14 | 9 | SUCCESS |
| 권태현 | — | — | — | — | stay, no roll |

## R1 위치

| | Flash 원문 | Argon 비교 | 서버 |
|---|---|---|---|
| 전원 위치 | 현관홀에서 서술 | delta 전원 현관홀 | 현관홀 / `r6` |
| 강이현 조사 | 회로 허탕, 보안 잠금 | 차폐·셔터로 선로 추적 실패 | FAILURE 와 같은 방향 |
| 렌 | 기둥 뒤 엄호 성공 | 기둥 뒤 엄호 성공 | SUCCESS |

Flash R1 전문: `rounds/r1-flash.md`  
Argon R1 전문: `rounds/r1-argon.md`

## R3 판정 (서버)

| 이름 | d20 | stat | total | DC | tier |
|---|---|---|---|---|---|
| 권태현 | 4 | str | 7 | 9 | PARTIAL_SUCCESS |
| 렌 | 14 | dex | 15 | 9 | SUCCESS |
| 강이현 | — | — | — | — | stay, no roll |

## R3 위치

| | Flash 원문 | Argon 비교 | 서버 |
|---|---|---|---|
| 권태현 | `순환로 통로의 입구를 향해 과감하게 전진` / `순환로 모퉁이에 어깨를 기댄 채` | `순환로 초입 쪽을 향해 반 걸음` 이나 `아직 통로 안으로 완전히 진입한 것은 아니었` / delta `현관홀` | 시트 현관홀, 지도 `r6` |
| 렌 | 현관홀 후방 엄호 | 현관홀 후방 엄호, delta 현관홀 | 현관홀 |
| 강이현 | 현관홀 중앙 | 제자리, delta 현관홀 | 현관홀 |

Flash R3 전문: `rounds/r3-flash.md`  
Argon R3 전문: `rounds/r3-argon.md`

## Structured / stream

두 Argon 호출 모두 `narration` + `delta` 파싱 성공, SSE `[DONE]`, `finish_reason=stop`. `localScene` 은 빈 객체. `questsAdd` 등 변경 리스트는 비어 있다.

## 사고 토큰

요청은 medium. 응답 `reasoning_tokens=0`. 완료 과금은 출력 토큰만 $10/M. thinking이 숨겨졌거나 OpenRouter가 0으로 보고한 것이며, Google native `thinking_level` 사용량은 이 경로에서 확인되지 않았다.
