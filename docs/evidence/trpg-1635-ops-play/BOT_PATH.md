# 대기 fallback — 공개 경로에서 원문이 있는가

기준: 운영 health `b6b7470` (#1635 `ddba38d5` 포함). 코드 변경 없음. 운영 DB는 열지 않았다.

## 결론

이번 플레이의 대기 3건(권태현 R1·R2, 강이현 R3)은 공개 캠페인 스냅샷에서 **모델 원문과 거절 이유가 없다.** #1635 이후에도 대기 문장이 locked body를 덮어쓰면 그 슬롯의 raw text는 스냅샷에 남지 않는다.

확인한 공개 필드:

- `GET /api/trpg/campaigns/44` → `log[].actions[].body` 는 최종 locked 문구만
- 같은 응답에 `error_json` / `usage_json` 키 없음
- `botRetryRequired` 는 false
- `GET /api/admin/finance` slim 의 `aiCost.byCenter[trpg]` 는 호출 수·KRW만

## #1635가 바꾸는 것 / 안 바꾸는 것

#1635는 거절된 이동이 있어도 합법 명령과 위치 의존 remainder를 남기려 한다. 전부 거절되면 기존처럼 `stayWatchingInPlace` 한 줄이 locked body가 된다. 이번 3건은 그 한 줄만 보인다. remainder salvage가 적용됐는지는 공개 경로로 확인할 수 없다.

수락된 3건(강이현 R1·R2, 권태현 R3)은 긴 본문이 그대로 잠겼다. 이 세 슬롯은 대기 경로가 아니다.

## owner (경로만, 이번 슬롯의 원인 배정 아님)

`generateBotActions` → `prepareTrpgBotActionBody` → `explorationCommandsFromMovementBody` → `prepareLockedExploration` → 거절 시 salvage 또는 `stayWatchingInPlace` → `upsertLockedAction`.
