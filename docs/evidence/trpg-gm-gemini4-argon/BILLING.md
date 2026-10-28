# 비용·정산

FX: 비교 호출 시 `getEffectiveKrwPerUsd()` = 1361.59001238 (2026-10-17 daily KST).

## Published rates

| 모델 | in $/M | out $/M | cache read $/M | targetMargin | floor |
|---|---|---|---|---|---|
| gemini-3.8-flash | 0.375 | 1.875 | — | 0.55 | 0.5 |
| gemini-4-argon intro (~2026-11-30) | 2 | 10 | 0.1 | 0.55 | 0.5 |
| gemini-4-argon after 2026-11-30 | 4 | 20 | 0.20 | 동일 row를 올리기 전 코드 정적 값은 아직 $2/$10 | |

`TRPG_GM_GROSS_MARGIN=0.65` 는 `computeTrpgRoundPoints` 에 사용되지 않는다. 청구는 published `targetMargin` (Flash/Argon 모두 0.55) 이다.

## Fallback 10k in / 3.5k out (`TRPG_GM_USAGE_FALLBACK`)

| | Flash | Argon intro | Argon post-intro |
|---|---|---|---|
| 원가 USD | 0.0103125 | 0.055 | 0.110 |
| 사용자 포인트 (`computeTrpgRoundPoints`) | 9 | 85 | (rate row 갱신 전엔 intro와 같음) |

포인트 비율 ≈ 9.4배.

## 실제 비교 호출 (GM 단독, 재시도 없음)

| 장면 | in | out | reasoning | cache | USD | KRW | 사후 KRW | 사용자 P | ms |
|---|---|---|---|---|---|---|---|---|---|
| R1 | 7403 | 2202 | 0 | 0 | 0.036826 | 50.14 | 100.28 | 51 | 47280 |
| R3 | 12247 | 2577 | 0 | 0 | 0.050264 | 68.44 | 136.88 | 72 | 46104 |
| 합 |  |  |  |  | 0.08709 | 118.58 | 237.16 |  |  |

`cost_details` 는 intro list와 일치한다. R1 prompt 7403 × $2/M = $0.014806, completion 2202 × $10/M = $0.02202.

캠페인 44 Flash 라운드 사용자 포인트(GM+Bot 2): R1 33, R2 38, R3 41. Argon GM 단독 51/72 가 이미 그 전체 라운드보다 크다.

## STOP 이유

모델 id 만 바꾸면 기존 청구 owner가 Argon 단가·55% 마진을 자동 적용한다. 운영 과금(사용자 체감 포인트)이 구조적으로 오른다. 티켓 5항: 65% 마진이 잘못 적용되거나 운영 과금 구조 변경이 필요하면 STOP.
