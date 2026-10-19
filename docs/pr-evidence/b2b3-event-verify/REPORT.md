# B2+B3 배포 후 사건 효과·GM 서술 검증

이 기록은 사전 작성한 POTION_STALL 시험 모험의 실행 증거다. AI 생성 품질 증거가 아니다. 제품 코드는 바꾸지 않았다.

## 실행 신원

- 실행한 main: `d341c13d7c1055f6a4b38bf1feb190c2a2fd490f`
- 로컬 health `gitCommit`: `d341c13` (`main`의 짧은 SHA)
- #1656 squash `7a3cb9d438d36d73adb08f45204fce2aa6783bb1`는 이 main의 조상이다.
- 격리 DB: `/tmp/trpg-b2b3-event-verify/app.db`. `/workspace/data/app.db`는 시작 시각 `2026-10-19 09:13:35Z` 그대로다.
- production 빌드, `NODE_ENV=production`, 포트 3310. 데모 로그인은 `TRPG_SCROLL_FOLLOW_LAB_ENABLED=1`로만 열었다. `RAILWAY_ENVIRONMENT`와 `RAILWAY_ENVIRONMENT_NAME`은 비웠다. 파생 캐시 워커는 꺼져 있었다.
- 메카닉 플래시와 행동 예시는 꺼져 있었다. 화면의 행동 예시 스위치는 `꺼짐`이다.
- 페르소나 원문은 없다. 관계 설명은 빈칸이다. 시트 표시 이름은 데모 계정 `데모유저`다.

## 판정

사건 효과의 서버 결과는 맞다.

- 약장수 진입에서 사건 `dose`가 한 번 지급되고, 길 `edge-stall-yard`가 열리고, 회복약 수량 1, 지급 id `inv_414c728f`가 생겼다.
- 같은 라운드에 골목으로 나갔다가 약장수에 다시 들어와도 사건 id는 `dose` 하나, 지급 id는 그대로, 수량은 1이다.
- 다시 접속한 화면은 위치 약장수, 발견 1건, 열린 길 골목·마당, 소지품 1, 장비란의 회복약을 유지했다.
- 방식 문장은 GM 입력의 `[EXPLORATION METHOD]`로 들어갔고, 거래로 처리되지 않았다.

GM 서술과 서버가 어긋난 문장은 아래에 그대로 둔다. 제품 수정은 하지 않았다.

## 호출과 비용

유료 호출은 GM 3회뿐이다. 초안 0, 동료 0, 재시도 0, 상한으로 막힌 호출 0.

| 호출 | 역할 | request id | prompt | completion | 원장 KRW |
| --- | --- | --- | --- | --- | --- |
| 1 | 오프닝, 포인트 미과금 | `06477744-f8e2-4ae4-9149-03f4d08b0913` | 3589 | 1290 | 2.65 |
| 2 | 약장수 진입, 5P | `00e6d686-e54c-4eaa-9025-642b1a0d70de` | 4870 | 2112 | 3.80 |
| 3 | 재진입, 5P | `d518ccd1-733d-4784-a8a3-9a958ebbb8be` | 6678 | 1854 | 4.64 |

모델은 `gemini-3.8-flash`, provider `cheaperinference`, `estimated=1`. 환율은 원장 `1360.27097082`. 이번 합계는 약 11.10원이다. 기존 약 104원을 더해도 900원 한도 안이다. 포인트는 2000에서 1990이 되었다. 오프닝 라운드 `billed=0`, 진행 두 라운드 `billed=1`.

## 커밋 후 서버 상태

진입 라운드 행동 본문:

`약장수로 이동한다. 조심스럽게 좁은 골목을 지나 약장수 앞에 선다.`

재진입 라운드 행동 본문:

`골목으로 이동한다. 약장수로 이동한다. 같은 걸음으로 돌아 약장수 앞에 다시 선다.`

재진입 커밋 뒤:

- `grantedEventIds`: `["dose"]`
- `revealedEventIds`: `["dose"]`
- `revealedEdgeIds`: `["edge-stall-yard"]`
- `visitedRoomIds`: `["lane","stall"]`
- `appliedKeys`: `["2:1","3:1"]`
- 시트 위치: `약장수`
- 인벤토리: `inv_414c728f` / `회복약` / quantity `1` / equipped false

마당은 열린 길로만 있고, 방문한 장소에는 없다.

## 서버 입력과 GM 출력

전문은 `GM.md`와 `gm-rounds.json`에 있다.

### 오프닝

서버는 골목, 열린 길 약장수, 이동 없음, 지급 없음이었다. delta도 `inventoryAdd: []`, `location: 골목`이다.

서술은 그 상태에서 열쇠와 주머니, 골목 안의 잠긴 마당 문을 만들었다.

> 골목 안쪽에서 불쑥 내민 손에는 붉은 노끈으로 봉인된 손바닥만 한 가죽 주머니와 놋쇠 열쇠 한 자루가 쥐여 있었다.

> 마당으로 통하는 길목은 높다란 목책과 굳게 잠긴 널빤지로 가로막혀 있어 그냥 지나칠 수 없는 형세였다.

서버 인벤토리는 `[]`, 열린 길은 약장수뿐이었다. 약장수 통로 자체를 막지는 않았다. 지급은 delta와 시트 모두 일어나지 않았다.

### 진입

서버 블록:

`데모유저 started in 골목 and is now in 약장수.`

`Open passages from 약장수: 골목, 마당.`

`entered 약장수 and received item "회복약" exactly once`

방식:

`[EXPLORATION METHOD — how they travel or search, not a trade or item change]`

`조심스럽게 좁은 골목을 지나 약장수 앞에 선다.`

서술은 회복약 하나를 받고 마당 문이 열린 것으로 이어진다. delta `inventoryAdd`는 `["회복약"]` 하나, 위치는 약장수다. 시트 수량은 1이다. 이미 열린 길을 다시 잠그지는 않았다. 문장 끝의 "마당으로 당장 발을 들여놓을지"는 이동을 재촉할 뿐, 서버 위치는 약장수로 남았다.

### 재진입

서버 결과 줄은 `moved 약장수 → 골목 → 약장수`이고, 발견 목록에는 기존 회복약 한 건만 있다. 열린 길은 골목, 마당이다.

같은 블록의 위치 문장은 `데모유저 is in 약장수. They did not move this round.`이다. 왕복이라 시작과 끝이 같아서 `formatExplorationGmBlock`이 이동 없음으로 적고, `settleExplorationActor`의 결과 줄은 실제 경로를 적는다. 서술은 결과 줄을 따라 골목을 다녀온 것으로 말했다.

delta `inventoryAdd`는 `[]`이다. 회복약을 다시 건넨다고 말하지 않았고, 문은 열린 채로 남았다.

> 약장수를 스쳐 골목을 다녀오는 동안에도 마당으로 통하는 목책 문은 서늘한 바람을 뿜어내며 활짝 열려 있다.

시트 지급 id와 수량은 진입 때와 같다.

## 화면

원본 viewport는 1440×900과 390×844이다. 지도 헤더가 하단 명령 독에 가려 클릭이 막혀, 지도 펼치기와 출구·제출은 그 버튼의 click 핸들러로 실행했다. 서버에 도착한 본문은 위 행동 원문과 같다.

- 진입 전 대기열과 방식: `r1-queued-1440-map.png`, `r1-queued-390-map.png`
- 진입 후 지도: `r1-enter-1440-map.png`, `r1-enter-390-map.png`
- 진입 후 회복약: `r1-enter-1440-inventory.png`, `r1-enter-390-inventory.png`
- 재진입 전 방식: `r2-queued-1440-map.png`, `r2-queued-390-map.png`
- 재진입 후 열린 길과 발견 1건: `r2-reentry-1440-map.png`, `r2-reentry-390-map.png`
- 재진입 후 시트: `r2-reentry-1440-inventory.png`, `r2-reentry-390-inventory.png`
- 재접속: `reconnect-1440-map.png`, `reconnect-1440-inventory.png`, `reconnect-390-map.png`, `reconnect-390-inventory.png`

## 찾은 문제

1. 오프닝 서술이 서버에 없는 열쇠·주머니와, 골목에서 잠긴 마당 문을 만들었다. 재현은 이 POTION_STALL 오프닝 1회. 소유자는 오프닝 GM 서술이며, 탐험 블록은 `formatExplorationGmBlock`이 위치와 열린 길만 준다. 영향은 시트 지급 전의 허구 아이템과, 서버가 그 방에서 닫힌 길로 선언하지 않은 문의 봉쇄 묘사다. delta와 인벤토리는 비어 있었다.
2. 같은 방으로 돌아오는 왕복에서 위치 문장이 `They did not move this round`이고 결과 문장이 `moved 약장수 → 골목 → 약장수`이다. 소유자는 `formatExplorationGmBlock`과 `settleExplorationActor`. 이번 서술은 결과 문장을 따랐다. 영향은 다음 모델이 위치 문장만 따르면 왕복을 생략할 수 있다는 점이다.

## 아직 검증하지 않은 것

- 구두점 없는 복합 문장
- B4
- 빈 공간
- 이동 범위
- 동료 이동
- dev 과금
- 이 시험 모험 밖의 모델 행동

#1656은 병합된 상태로 두었다. 제품 수정과 B4는 시작하지 않았다.
