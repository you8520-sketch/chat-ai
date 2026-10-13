# TRPG 소지품 소유권·서술 일치성 조사 (main `b7159ec6`)

관련: #1541 실제 2인간 + 2AI 증거(`docs/evidence/trpg-1541-real-play/` @ `35669f8d`, GM R3 = `call-10-gm-r3`).
결론: 원인은 관측했으나 효과적인 수정은 입증되지 않았다. 티켓 STOP 규칙에 따라 **코드 변경 없음**(조사만).
실제 AI 출력의 품질 판정은 하지 않는다(GPT 원문 평가 대기).

## 1. 결론

- R3 모순은 서버의 적용 단계가 아니라 GM이 낸 구조화 출력(`delta.players[]`)과 같은 호출의 서술이 서로 다른 데서 시작한다. 서버는 delta를 그대로 충실히 적용했다.
- 현재 GM 프롬프트에는 `inventoryAdd`/`inventoryRemove`의 계약(누구 행에 쓰는가, 사용은 소모가 아니다, 인간 PC 소지품은 건드리지 않는다)이 한 줄도 없다. 서버도 GM의 add/remove가 서술·제출 행동과 맞는지 검증하지 않는다.
- 계약 한 단락을 `[OUTPUT]`에 추가해 같은 R3 입력을 유료 Gemini 3.8 Flash로 2회 재생했다(시스템 프롬프트만 변경). 결과는 한 번은 일관, 한 번은 열쇠 제거가 그대로였다. 베이스라인 n=1, 처리 n=2로는 효과를 입증할 수 없어 수정을 폐기했다.
- 입증 가능한 결정적 수정(서버가 GM의 `inventoryRemove`를 소모 근거 없이는 거부)은 소유권·서버 권한 정책 변경이라 티켓 STOP 조건에 해당한다. 선택지만 기록한다.

## 2. 단계별 확인 (현재 main)

| 단계 | owner | 사실 |
| --- | --- | --- |
| GM 출력 | `gmPrompt.ts` `TRPG_GM_SYSTEM`, `asDelta` | 단일 JSON `{narration, delta}`. `players[]` 행에 `participantId`, `inventoryAdd`, `inventoryRemove`. 프롬프트에 소지품 계약 없음. |
| delta 병합 | `mechanicsMerge.ts` `mergeMechanicsOwnedDelta` | GM add/remove를 participantId별로 적용. 기계 소모(`mechanicsConsumed`, 치유 아이템)는 건너뜀. 제거 실패만 `INVALID_GM_INVENTORY_DELTA`. 정당성 검사 없음. |
| 저장 | `engineSheets.ts` `persistSheets`, `inventory.ts` | 이름 정확 일치로 수량 +1/-1. 같은 사전 상태에 같은 delta를 두 번 적용해도 결과가 같다(`repro-inventory-merge.log`). |
| GM 다음 입력 | `memory.ts` `buildTrpgMemoryPromptBlock` | 시트별 `items=` 전달. R4 GM 입력의 `items=`는 R3 delta 적용 결과와 일치. |
| AI 동료 다음 입력 | `memory.ts` `buildTrpgBotMemoryBlock` | 소지품 없음. 의도적으로 바꾸지 않았다(서술과 충돌하는 상태를 노출하면 AI 동료가 잘못된 소유자를 믿게 된다). |
| 재생성 | `engineAdvance.ts` | `regenerate: true`는 서술·`structured_json`만 저장하고 `persistSheets` 전에 반환. 재생성의 새 delta는 폐기된다(별도 위험, 아래). |

## 3. R3 사실 분류

저장된 R3 delta(`live/parsed/call-10-gm-r3-delta.json`)와 R3 서술을 대조했다.

1. 소유자 불일치: 서술은 서하(AI 동료)가 심부름꾼에게서 서류함을 낚아채 살피고, 현이 열쇠로 연다. delta는 장부·지시서를 현(participantId=2)에게 준다. 서술과 delta의 소유자가 갈린다.
2. 열쇠 제거: 현이 열쇠로 자물쇠와 서류함을 열고, 서술은 "황동 열쇠를 주머니에 찔러 넣고"로 끝난다. delta는 `inventoryRemove: ["세관 황동 열쇠"]`다. 사용을 소모로 취급했다.
3. 적용 단계: `repro-inventory-merge.log`. R3 delta를 사전 시트에 병합하면 현이 `세관 밀수 원본 장부`, `강도현의 친필 격침 지시서`를 갖고 열쇠는 없다. 병합은 delta 그대로다. `INVALID_GM_INVENTORY_DELTA=false`.
4. 권한: 서버는 인간 PC 현의 소지품에 대한 add/remove를 GM이 임의로 낼 때 막지 않는다. 이번 건에서 현은 제출 행동으로 서류함 확인을 선언했으므로 취득 자체는 정당했다. 권한 침해 증거는 아니다.
5. 다음 입력: R4 GM 입력은 R3 delta 적용 결과를 그대로 보여 준다. AI 동료 입력에는 소지품이 없다. 소유자 오인식의 원인은 입력이 아니라 R3 출력의 모순이다.

## 4. 처리 재생 (유료, Gemini 3.8 Flash, 자동 재시도·모델 대체 없음)

시스템 프롬프트에 아래 한 단락(`[OUTPUT]`, `questsClaimDone` 문장 뒤)만 추가하고, R3 GM 최종 입력(사용자 블록)은 그대로 재생했다.

> inventoryAdd / inventoryRemove sit on the players[] row of the seat that holds the item when your narration ends, whether that seat is human or AI companion: an item the narration puts in a PC's hands is inventoryAdd on that participantId; a handover is inventoryRemove on the giver plus inventoryAdd on the receiver. Using, showing or pocketing an item the PC still carries (a key that opened a lock) is not inventoryRemove; remove only what is consumed, lost or given away. Do not take or spend a human PC's carried item unless that PC's submitted action does.

| 호출 | 소유자(서술 vs delta) | 열쇠 | 비용 |
| --- | --- | --- | --- |
| 베이스라인(실플레이 R3) | 서술은 서하가 서류함을 잡음 / delta는 현에게 지급 | 제거됨 | - |
| c1 | 서류함은 현의 품에 안겨 줌 / delta 현 (일치). 서하가 품속에 챙긴 편지는 delta 서류함 항목에 포함 (경미한 불일치) | 유지 | 22.7원 |
| c2 | 현이 서류함을 줍고 열고 장부·명령서를 쥠 / delta 현 (일치) | 제거됨 (서술은 열쇠를 계속 사용, 소모 서술 없음) | 16.5원 |

합계 2호출 39.2원(상한 1,000원 이내). 원문: `docs/evidence/trpg-inventory-ownership/paid-gm-replay/`.

해석: 소유자 일치는 처리군 2회 모두 나왔지만, 같은 입력의 서술 자체가 호출마다 달라서(서하가 잡는 장면 vs 현이 줍는 장면) 계약 효과와 서술 변동을 분리할 수 없다. 열쇠 제거는 1/2회 남았다. 베이스라인이 1회뿐이라 비교가 성립하지 않는다. 티켓의 호출 상한(GM 최대 2회) 때문에 표본을 늘리지 않았다. 효과가 입증되지 않아 프롬프트 변경은 반영하지 않았다(`gmPrompt.ts` 변경 없음).

## 5. BEFORE / PROBLEM / AFTER / REMOVED / PRESERVED

- BEFORE: R3에서 서술의 소유자와 delta의 소유자가 갈리고, 사용한 열쇠가 delta에서 제거됐다.
- PROBLEM: GM 출력 계약 부재(1·3번 원인)와 서버의 GM add/remove 무검증(4번). 적용(2번)과 AI 동료 입력(5번)은 원인이 아니다.
- AFTER: 코드·프롬프트 변경 없음.
- REMOVED: 없음. 폐기한 시도는 위 계약 단락이다.
- PRESERVED: HP·위치·목표·소지품 canonical owner, 기계 소모 경로, 병합·저장 멱등성, AI 동료의 자율 행동·취득.

## 6. 남은 위험과 선택지 (승인 대기)

1. 열쇠 같은 재사용 아이템의 제거: 프롬프트 계약은 효과 미입증. 결정적 대안은 `mergeMechanicsOwnedDelta`가 소모 근거(기계 소모 또는 제출 행동) 없는 GM `inventoryRemove`를 거부하는 서버 권한 정책 변경이다. 이전 소모 경로·기존 캠페인 데이터에 영향이 있어 승인 없이 하지 않는다.
2. 재생성: `regenerate`는 새 서술을 저장하되 새 delta를 폐기한다. 재생성 후 서술과 시트가 다를 수 있다. 별도 후속.
3. AI 동료 입력에 소지품이 없다. 소유자 일치가 보장된 뒤에만 노출을 검토한다.
4. 모순 발생률은 이 증거(R3 1건 + 재생 2건)로 측정할 수 없다.

## 7. 재현

- `docs/evidence/trpg-inventory-ownership/scripts/invmerge.mts`: R3 delta 병합·멱등성(로그 `repro-inventory-merge.log`).
- `docs/evidence/trpg-inventory-ownership/scripts/replay-gm.mts`: 유료 재생(비용 게이트 포함, 레저 `spend-ledger.json`).
