# AI 동료 "제자리 대기" 11건 — 현재 main 경로 조사

기준 커밋: `eb18d5a8` (#1632 병합). 코드만 읽었다. 추가 모델 호출·운영 쓰기·운영 DB 접근은 하지 않았다.

## 결론 먼저

- 11건 모두 **모델 원문이 남아 있지 않다.** 원인은 이 증거로 확정할 수 없고, 이 문서는 어떤 슬롯에도 원인을 배정하지 않는다.
- 확정되는 것은 "이 슬롯에 도달하려면 어떤 조건이 필요한가"라는 **필요조건**뿐이다.
- 현재 코드에는 이 경로를 사후에 확인할 수 있는 관측 수단(원문 저장, 거절 사유 로그)이 없다.

## 경로와 owner

| 단계 | 코드 owner | 하는 일 |
|---|---|---|
| 1. 생성 | `src/lib/trpg/engineAdvance.ts` `generateBotActions` | 동료마다 순서대로 `botCall(TRPG_BOT_SYSTEM, user)` 호출. `user` 프롬프트에 `explorationBrief`가 들어간다. |
| 1a. 브리프 | `src/lib/trpg/explorationMap.ts` `formatExplorationBotBrief`, `visibleExplorationNeighbors`, `displayExplorationAp` | 현재 방 이름, 파티 위치, 열린 통로, 남은 AP, 경보 여부. **출구 위치는 주지 않는다.** |
| 2. 정리 | `src/lib/trpg/botActions.ts` `prepareTrpgBotActionBody` | `parseTrpgBotAction` → 자산 마커 제거 → `sanitizeBotActionText`. 결과가 비면 `…은 상황을 살피며 한 발 다가선다.` |
| 3. 이동 선언 읽기 | `explorationMap.ts` `explorationCommandsFromMovementBody` ← `src/lib/trpg/movementDeclaration.ts` `declaredMovementGoals`/`describeMovementGoal` | 본문에서 이동 목적지를 뽑아 `move` 명령으로 변환. 방 이름은 `canonicalRoomId`로 정규화. |
| 4. 이동 검사 | `src/lib/trpg/explorationStore.ts` `prepareLockedExploration` → `explorationMap.ts` `spendExplorationAp` | 현재 시트 위치·라운드·AP로 각 `move`를 검사. 거절 시 `throw new Error(...)`. |
| 5. locked action | `engineAdvance.ts` (같은 함수 안) | 성공: `prepared.body`(서버가 붙인 이동 문장 + 모델 본문)를 `upsertLockedAction(..., "bot_model")`. 실패: 아래 대기 문장. |
| 6. 거절 판정 | `engineAdvance.ts` `explorationMoveWasRejected` | 오류 메시지가 `행동력`/`연결되지 않은`/`통로`/`지도와 맞지`/`탐험 지도가 없습니다`/`빗장`/`탐험 명령`/`너무 깁` 중 하나를 포함하면 "거절"로 본다. 아니면 재throw. |

대기 문장: `` `${bot.display_name}은 제자리에 서서 상황을 살핀다.` `` (21자, `actionType: "free"`). 이 문장은 서버가 쓴 것이며 모델 출력이 아니다.

```ts
const declared = latestMap ? explorationCommandsFromMovementBody(latestMap.map, body) : [];
if (declared.length > 0) {
  try { /* prepareLockedExploration → upsertLockedAction → saveExplorationState */ }
  catch (error) {
    if (!explorationMoveWasRejected(error)) throw error;
    spoken = `${bot.display_name}은 제자리에 서서 상황을 살핀다.`;
    upsertLockedAction(db, opts.roundId, bot.id, spoken, "free", null, "bot_model");
  }
} else {
  upsertLockedAction(db, opts.roundId, bot.id, spoken, parseTrpgBotAction(spoken).actionType, null, "bot_model");
}
```

## 확정되는 필요조건

대기 문장은 `declared.length > 0`(모델 본문에서 이동 선언이 1개 이상 읽힘)이고 `prepareLockedExploration`(또는 그 안의 길이 검사)이 `explorationMoveWasRejected`에 걸리는 오류를 던졌을 때만 나온다. 이동 선언이 0개이면 본문이 그대로 저장되므로 대기 문장이 나올 수 없다.

`spendExplorationAp`/`prepareLockedExploration`가 던지는, 필터에 걸리는 메시지(코드에 있는 목록일 뿐 슬롯별 원인이 아니다):

- `행동력이 부족합니다.`
- `연결되지 않은 곳으로는 이동할 수 없습니다.`
- `아직 발견하지 못한 통로입니다.` (`통로` 포함)
- `출구 빗장은 경보가 울린 뒤에만 풀립니다.`
- `현재 위치가 지도와 맞지 않습니다.`
- `탐험 지도가 없습니다.`
- `행동이 너무 깁니다.` (정리된 본문이 1500자 초과; 증거의 수락 본문은 649~905자)

참고(관측만): `explorationCommandsFromMovementBody`는 `try` 밖에서 호출되며 명령이 한도를 넘으면 `한 번에 너무 많은 탐험 명령입니다.`를 던진다. 이 경우는 대기 문장이 아니라 동료 생성 오류로 전파된다.

## 모델 원문이 없는 이유

- `text`는 `botCall`의 반환값으로 `prepareTrpgBotActionBody`에 들어가고, 대기 경로에서는 `body`가 `upsertLockedAction`에 저장되지 않는다. `spoken`이 대기 문장으로 덮어써진다.
- `catch` 블록에는 로그가 없다. `engineAdvance.ts`의 `console.warn`은 director/exploration map/threat shadow/goal에만 있다.
- `appendRoundUsage`는 `trpg_rounds.usage_json`에 `{...usage, seat: "bot"}`를 쌓는다. 토큰·비용 계열 메타데이터이며 텍스트와 거절 사유는 없다. 이 컬럼을 읽는 공개 API도 확인되지 않았다(`src/app/api/trpg`에서 `usage_json` 참조 없음). 따라서 "그 슬롯에서 모델 호출이 있었다" 정도만 DB에서 셀 수 있고, 운영 DB를 읽지 않았으므로 이번에는 세지 않았다.
- 증거 스냅샷 API가 노출하는 것은 locked action 최종 문구뿐이다.

## 증거에서 관측되는 사실(원인 아님)

- 이동 선언을 읽은 수락 본문의 파서 결과 표: [COMPARISON.md 2절](COMPARISON.md). 라운드 1/4/8의 수락 본문 5건에서 `move` 명령이 읽혔고, 나머지 8건(수락 13건 중)은 0건이었다. 이동 문장이 없는 라운드에서도 대기가 나온 슬롯이 있다(직전 라운드가 대기였던 슬롯 포함). **그 슬롯들의 모델 본문에 이동 선언이 있었는지는 알 수 없다.**
- 브리프에는 출구 위치가 없고, GM 서술은 출구를 중앙홀 부근으로 묘사한 장면이 있다([COMPARISON.md 4절](COMPARISON.md)). 이것이 동료의 이동 선언과 관련 있는지는 확인되지 않았다.
- 슬롯별 재구성 브리프는 `rounds/round-NN.md`에 있다. 재구성은 라운드 시작 스냅샷 + 현재 `formatExplorationBotBrief` 코드로 만든 것이며 운영에서 실제로 전송된 문자열과 바이트 단위로 같다고 확인하지는 않았다.

## 현재 코드가 허용하는 확인 방법(실행하지 않음)

1. 이후 플레이에서 같은 경로를 확인하려면 `catch` 직전에 `text`/`declared`/`error.message`를 남기는 관측이 필요하다. 이번 티켓은 코드 변경 금지이므로 하지 않았다. 후속 제안으로만 기록한다.
2. 운영 DB `trpg_rounds.usage_json`의 `seat: "bot"` 항목 수로 슬롯당 모델 호출 여부는 셀 수 있으나 원문·사유는 복원되지 않는다.

## 이번 PR(#1632)과 무관한 후속 후보

- 대기 경로 관측 부재(위).
- `formatMechanicsHudLines`가 `threatStrikes`를 렌더링하지 않아 `mechanicsLines`가 항상 비어 보임([COMPARISON.md 5절](COMPARISON.md)).
- 출구 도달을 종료로 연결하는 서버 경로 없음(`goalConfirm.ts`/GM `campaign_finished` 의존).
