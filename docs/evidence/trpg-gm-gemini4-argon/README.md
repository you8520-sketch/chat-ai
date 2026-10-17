# TRPG GM → Gemini 4 Argon 검증 (도입 보류)

운영 GM 모델은 바꾸지 않는다. Cursor는 품질 점수를 매기지 않는다. GPT가 원문을 읽고 판단한다.

자동 병합·배포 금지.

## SHA

| 대상 | 값 |
|---|---|
| `origin/main` | `fe9db4839d2c6d97aca931b1450b3c61e7a519f9` |
| production `GET https://hav.chat/api/health` `gitCommit` | `fe9db48` |
| 캠페인 44 Flash 원문 | `cursor/trpg-1635-ops-play-evidence-9d27` |

## BEFORE

- TRPG 메인 GM / Bot 좌석은 `TRPG_GM_MODEL` = `TRPG_BOT_MODEL` = `gemini-3.8-flash`.
- 전송 소유자는 CheaperInference 전용이다. `TrpgProviderRequest.provider` 는 `"cheaperinference"` 만 허용한다. `resolveTrpgCheaperInferenceModel` 은 `isCheaperInferenceModel` 이 아니면 throw 한다.
- `isCheaperInferenceModel("gemini-4-argon")` 는 false. 2026-10-17 CI live catalog 98개 중 Argon 없음. Gemini 상한은 `gemini-3.8-flash`.
- GM adapter는 `reasoning_effort: "low"` 를 보내고 `thinking` 을 지운다. `GM_PROVIDER_TIMEOUT_MS=180000`, 5xx 재시도 2회. `max_tokens=65535`.
- 사용자 포인트는 `computeTrpgRoundPoints` → `computeOpenRouterTurnBilling(modelId)`. `TRPG_GM_GROSS_MARGIN=0.65` 는 스냅샷 표시 상수이고 청구 함수에 쓰이지 않는다.
- 일반 RP Argon은 OpenRouter `google/gemini-4-argon`, `google-ai-studio` default, `{effort:"low", exclude:true}`. 이 RP 정책을 GM에 복사하면 안 된다.

## PROBLEM

다음 작업의 기준 GM을 Gemini 4 Argon으로 확정하려면, CI 지원·structured/stream/thinking·비용·동일 입력 비교가 모두 통과해야 한다.

## AFTER (이번 작업이 한 일)

- 운영 `TRPG_GM_MODEL` / Bot / 일반 RP / 시나리오 초안 모델은 그대로다.
- 캠페인 44 R1(강이현 FAILURE)·R3(권태현 PARTIAL_SUCCESS) 를 라이브 소유자로 재구성한 **불완전 wire** 로 Argon 비교 호출 2회만 했다.
- structured JSON + SSE `[DONE]` + `finish_reason=stop` 은 OpenRouter 경로에서 성립했다.
- 도입 조건이 모두 성립하지 않아 **최소 교체 패치는 제출하지 않는다.**

## REMOVED

없음. 제품 코드 삭제 없음.

## PRESERVED

- `TRPG_GM_MODEL` / `TRPG_BOT_MODEL` = Gemini 3.8 Flash
- CheaperInference GM/Bot 전송
- 기존 GM JSON Schema, `TRPG_GM_MAX_TOKENS=65535` (출력 임의 상한 추가 없음)
- `computeTrpgRoundPoints` / published pricing owner
- AI 동료 모델, 1:1 RP Argon 등록, 시나리오 초안 모델

## REGRESSION RISKS

도입을 강행하면:

- GM 전송을 OpenRouter로 열어야 한다. 새 billing owner를 안 만들어도 `TrpgProviderRequest` 계약이 바뀐다.
- 같은 fallback 토큰에서 사용자 포인트가 Flash 9P → Argon 85P (약 9.4배). 실제 비교 호출은 GM 단독 51P / 72P. 캠페인 44 Flash 라운드 전체(GM+Bot 2)는 33 / 41P 였다.
- `TRPG_GM_GROSS_MARGIN=0.65` 는 청구에 적용되지 않는다. Argon published `targetMargin=0.55` 가 따른다.
- 2026-11-30 이후 Standard 원가는 $2/$10 → $4/$20. 비교 호출 기준 사후 원가는 약 2배.
- 동일 final wire를 복원하지 못했다. 비밀·페르소나·플랜·디렉터·로컬신·메카닉스·탐험 commit·메모리 horizon 이 스냅샷에 없다.
- 이 VM의 생산 `OPENROUTER_API_KEY` 는 `GET /key` 401 `User not found.` 다. 비교는 JEV benchmark key 로만 됐다. 생산 OpenRouter 경로의 운영 키는 이 환경에서 검증되지 않았다.

## PROOF

| 항목 | 결과 |
|---|---|
| CI Argon | 없음 (`/opt/cursor/artifacts/ci-models-ids.json`, 98 models) |
| OpenRouter Argon structured+stream | R1/R3 HTTP 200, `structuredOk=true`, `semanticDone=true`, `finish_reason=stop` |
| thinking medium | 요청 `{effort:"medium", exclude:true}`. 응답 `reasoning_tokens=0`. 완료 단가는 출력 토큰 $10/M 와 일치 |
| latency | R1 47280ms, R3 46104ms (현행 180s 타임아웃 안) |
| 비교 원가 | $0.036826 + $0.050264 = $0.08709 ≈ 118.6 KRW (한도 800) |
| 사용자 포인트 시뮬 | Argon GM 51P / 72P (`computeTrpgRoundPoints`) |
| 지도/위치 | Argon delta 전원 `현관홀`. 서버 시트·지도도 전원 현관홀/`r6` |
| 품질 점수 | 없음. 원문은 `rounds/` |

도입 6항 판정:

1. 유의미한 진행·일관성 개선 — Cursor 미채점. GPT 판단 필요. 동일 wire 아님.
2. structured/streaming — 비교 경로에서 정상. CI 경로는 불가.
3. 서버 판정·지도 정본 — 비교 출력 delta는 현관홀 유지. 엔진은 바꾸지 않음.
4. 정상 비용·정산 — **실패.** 기존 청구 함수에 올리면 포인트가 크게 오른다. 65% TRPG 상수는 청구 owner가 아니다.
5. 동료·일반 RP 영향 — 패치를 안 넣었으므로 없음.

**STOP.** 운영 GM은 Gemini 3.8 Flash 유지.
