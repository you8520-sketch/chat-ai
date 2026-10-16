# TRPG #1635 운영 실전 검증 증거 (검수용)

코드 변경 없음. 평가 점수 없음. Draft PR 없음. GPT가 원문을 읽고 판단한다.

배포 게이트: `GET https://hav.chat/api/health` 의 `gitCommit` 은 플레이 시 `b6b7470` 이었다. `ddba38d5` (#1635) 는 `origin/main` 조상이다 (`git merge-base --is-ancestor ddba38d origin/main`).

| 파일 | 내용 |
|---|---|
| [COMPARISON.md](COMPARISON.md) | 라운드별 사람·동료 locked 원문, 대기 여부, 시트 위치, 지도, 판정, GM 서술을 나란히 놓은 자료 |
| [rounds/](rounds/) | 라운드별 `round-NN.md` / `round-NN.json`. 시작 전·종료 후 서버 상태와 원문 |
| [BOT_PATH.md](BOT_PATH.md) | 대기 fallback 때 원문·거절 이유를 공개 경로에서 찾을 수 있는지 |
| [ORIGINALS.sha256](ORIGINALS.sha256) | 공개하지 않은 원본 스냅샷·finance slim의 sha256 |

## 공개본에서 제거한 것

원본 스냅샷과 finance 전체 응답은 저장소에 올리지 않았다.

- 제거: 초대 코드·경로, 사용자·호스트 id, 세계관 브리프 전문, 포인트 잔액, 세션·쿠키, 브라우저 크롬, finance 전체(매출·정산·레일웨이 등).
- 유지(편집 없이 원문): GM 서술, 사람·동료 locked action, 판정 숫자, HP·위치·소지품, 공개 지도.
- 비밀번호·키는 사용하지 않았다. 로그인은 기존 관리자 세션이다.
- 원본은 Cursor 아티팩트 `trpg-1635-ops-play/raw/` 에 있고 sha256이 `ORIGINALS.sha256` 과 같다.

## 읽을 때 알아야 할 것

- 플레이한 캠페인은 **44** 다. 캠페인 43은 열지 않았다.
- 사람 입력은 렌이다. 라운드 1 본문 `권현`, 라운드 2 본문 `제어 패을` 은 제출된 locked 원문 그대로다.
- 동료 locked action `…은 제자리에 서서 상황을 살핀다.` 는 서버가 쓴 문장이다. 해당 슬롯의 모델 원문·거절 이유는 공개 스냅샷에 없다.
- 라운드 3에서 에이전트는 탐험 지도 이웃 칸을 눌렀다고 보고했으나, 렌의 locked body에는 서버가 붙이는 이동 문장이 없고 세 PC 시트와 공개 지도는 모두 현관홀/`r6`에 남았다.
- Cursor는 품질 점수를 매기지 않는다.

## 비용 (상한, 캠페인 단독 원장은 없음)

공개 가능 필드만:

- 플레이 직전 slim (`finance-slim-now.json`): `aiCost.totalKrw` 1771.1, `trpg` center 110.2+39.4=149.6 (calls 43)
- 3라운드 후 slim (`finance-slim-end.json`): `aiCost.totalKrw` 2171.7, `trpg` center 0.8+518.3=519.1 (calls 52)
- 이 구간 trpg-center 증분: 369.5 KRW. 전역 `aiCost.totalKrw` 증분: 400.6 KRW. 티켓 한도 800 KRW 이내.
- 전역 숫자는 다른 센터(image 등)와 다른 TRPG를 포함한다. 캠페인 44 단독 원장은 공개 API에 없다.
- 사용자 포인트 차감(스냅샷 `billedPoints`): R1 33, R2 38, R3 41. 공급자 KRW가 아니다.

## 확인된 사실 / 원인 미확정 / 별도 후속

확인된 사실(증거 파일에서 직접 확인):

- 동료 생성 6건 중 대기 문장은 3건(권태현 R1·R2, 강이현 R3)이다.
- 수락된 동료 본문 3건(강이현 R1 investigate, 강이현 R2 support, 권태현 R3 support)은 locked body에 그대로 남아 있다. `<<<ACTION_TYPE>>>` / `<<<INTENT>>>` 마커도 본문에 남아 있다.
- 세 라운드 종료 후 시트 위치는 전원 현관홀, 공개 지도 `currentRoomId=r6`, 미방문 `r7`/`r4` 유지, risk 0, alarm false.
- 라운드 3 GM 서술은 권태현이 우측 순환로 입구로 전진한 것으로 읽고, 서버 시트·지도는 현관홀/`r6`이다. 권태현 R3 판정은 STR d20=4, final=7, DC=9, `PARTIAL_SUCCESS`.
- 대기 3건의 모델 원문·거절 이유는 공개 경로에 없다.

원인 미확정(추측하지 않음):

- 대기 3건의 거절 사유.
- 라운드 3에서 지도 클릭이 서버 `explorationCommands`로 전달됐는지.
- 권태현 R3 본문의 순환로 이동 의도가 파서에 이동 선언으로 읽혔는지. 읽혔다면 거절 시 #1635 salvage가 본문을 남겼을 수 있고, 안 읽혔다면 본문 전체가 그냥 잠긴 것이다. 공개 스냅샷만으로는 둘을 가르지 못한다.

이번 작업과 별개인 후속 후보(착수하지 않음):

- 대기 경로에 원문·거절 사유 관측이 없음.
- 추가 코드, Draft PR, 자동 병합은 이 티켓에서 하지 않았다.
