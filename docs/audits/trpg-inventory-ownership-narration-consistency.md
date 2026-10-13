# TRPG 소지품 소유권·서술 일치성 조사 (main `b7159ec6`)

관련: #1541 실제 2인간 + 2AI 증거(`docs/evidence/trpg-1541-real-play/` @ `35669f8d`, GM R3 = `call-10-gm-r3`).
결론: 실패 지점(GM 원본의 narration/delta 모순)은 확인했으나, 프롬프트 계약 부재의 인과와 효과적인 수정은 입증되지 않았다. 티켓 STOP 규칙에 따라 **코드 변경 없음**(조사만).
실제 AI 출력의 품질 판정은 하지 않는다(GPT 원문 평가 대기).

## 1. 결론

확인된 사실과 미확정 원인을 구분한다.

확인된 실패 지점 (실증됨):
- 실플레이 R3 GM 원본(`live/raw/call-10-gm-r3.txt`)에서, 같은 응답의 narration과 delta가 서로 모순된다. 서술은 서하가 서류함을 잡고 현이 열쇠를 주머니에 넣는데, delta는 장부·지시서를 현에게 주고 열쇠를 제거한다.
- 서버는 그 delta를 적용했다. 같은 delta·같은 사전 시트에 대한 병합 결과는 결정적이다(`repro-inventory-merge.txt`). 적용 단계에서 값이 바뀌지는 않았다.

미확정 (인과 미입증):
- 프롬프트에 `inventoryAdd`/`inventoryRemove` 계약이 없다는 것은 설계 공백이라는 정황이다. 그 부재가 모순의 원인이라는 인과는 입증되지 않았다.
- 계약 단락을 추가한 유료 재생 2회(c1, c2)는 효과를 입증하지 못했다. c2는 서술 내부의 소지 동작이 서로 달라 소유권이 일치한다고 판정할 수 없고, 열쇠 제거도 남았다(4절). 이전 판 문서의 "c2 소유자 일치" 판정은 철회한다.
- 서버가 GM의 add/remove를 서술·제출 행동과 대조하지 않는다는 점도 코드 사실일 뿐, 이번 모순의 원인으로 입증되지 않았다.

결과: 제품 코드·프롬프트·DB·비용·권한 정책은 변경하지 않았다. 서버 소모 권한 변경은 별도 승인 전 STOP이다.

## 2. 단계별 확인 (현재 main)

| 단계 | owner | 사실 |
| --- | --- | --- |
| GM 출력 | `gmPrompt.ts` `TRPG_GM_SYSTEM`, `asDelta` | 단일 JSON `{narration, delta}`. `players[]` 행에 `participantId`, `inventoryAdd`, `inventoryRemove`. 프롬프트에 소지품 계약 없음. |
| delta 병합 | `mechanicsMerge.ts` `mergeMechanicsOwnedDelta` | GM add/remove를 participantId별로 적용. 기계 소모(`mechanicsConsumed`, 치유 아이템)는 건너뜀. 제거 실패만 `INVALID_GM_INVENTORY_DELTA`. 정당성 검사 없음. |
| 저장 | `engineSheets.ts` `persistSheets`, `inventory.ts` | 이름 정확 일치로 수량 +1/-1. 병합 함수는 `(사전 시트, delta)`에서 결정적이다. 그러나 이미 적용된 시트에 같은 delta를 다시 적용하는 경우는 검증하지 않았고, `addInventoryItem`은 같은 이름이 있으면 수량을 +1 하므로 중복 적용은 수량을 늘린다. 정확히 1회 커밋 보호(`engineAdvance.ts`의 `trpg_state_change_log` `INSERT OR IGNORE` `delta:${roundId}`)가 시트 중복 적용까지 막는지는 이 증거로 입증하지 않았다. |
| GM 다음 입력 | `memory.ts` `buildTrpgMemoryPromptBlock` | 시트별 `items=` 전달. R4 GM 입력의 `items=`는 R3 delta 적용 결과와 일치. |
| AI 동료 다음 입력 | `memory.ts` `buildTrpgBotMemoryBlock` | 소지품 없음. 의도적으로 바꾸지 않았다(서술과 충돌하는 상태를 노출하면 AI 동료가 잘못된 소유자를 믿게 된다). |
| 재생성 | `engineAdvance.ts` | `regenerate: true`는 서술·`structured_json`만 저장하고 `persistSheets` 전에 반환. 재생성의 새 delta는 폐기된다(별도 위험, 아래). |

## 3. R3 사실 분류

저장된 R3 delta(`live/parsed/call-10-gm-r3-delta.json`)와 R3 서술을 대조했다.

1. 소유자 불일치: 서술은 서하(AI 동료)가 심부름꾼에게서 서류함을 낚아채 살피고, 현이 열쇠로 연다. delta는 장부·지시서를 현(participantId=2)에게 준다. 서술과 delta의 소유자가 갈린다.
2. 열쇠 제거: 현이 열쇠로 자물쇠와 서류함을 열고, 서술은 "황동 열쇠를 주머니에 찔러 넣고"로 끝난다. delta는 `inventoryRemove: ["세관 황동 열쇠"]`다. 사용을 소모로 취급했다.
3. 적용 단계: `repro-inventory-merge.txt`. R3 delta를 사전 시트에 병합하면 현이 `세관 밀수 원본 장부`, `강도현의 친필 격침 지시서`를 갖고 열쇠는 없다. 병합은 delta 그대로다. `INVALID_GM_INVENTORY_DELTA=false`. 스크립트가 출력하는 `same pre-state twice equal: true`는 동일한 사전 시트에 각각 delta를 적용한 두 결과가 같다는 결정성 확인이며, 멱등성 증거가 아니다.
4. 권한: 서버는 인간 PC 현의 소지품에 대한 add/remove를 GM이 임의로 낼 때 막지 않는다. 이번 건에서 현은 제출 행동으로 서류함 확인을 선언했으므로 취득 자체는 정당했다. 권한 침해 증거는 아니다.
5. 다음 입력: R4 GM 입력은 R3 delta 적용 결과를 그대로 보여 준다. AI 동료 입력에는 소지품이 없다. 소유자 오인식의 원인은 입력이 아니라 R3 출력의 모순이다.

## 4. 처리 재생 (유료, Gemini 3.8 Flash, 자동 재시도·모델 대체 없음)

시스템 프롬프트에 아래 한 단락(`[OUTPUT]`, `questsClaimDone` 문장 뒤)만 추가하고, R3 GM 최종 입력(사용자 블록)은 그대로 재생했다.

> inventoryAdd / inventoryRemove sit on the players[] row of the seat that holds the item when your narration ends, whether that seat is human or AI companion: an item the narration puts in a PC's hands is inventoryAdd on that participantId; a handover is inventoryRemove on the giver plus inventoryAdd on the receiver. Using, showing or pocketing an item the PC still carries (a key that opened a lock) is not inventoryRemove; remove only what is consumed, lost or given away. Do not take or spend a human PC's carried item unless that PC's submitted action does.

| 호출 | 소유자(서술 vs delta) | 열쇠 | 비용 |
| --- | --- | --- | --- |
| 베이스라인(실플레이 R3) | 서술은 서하가 서류함을 잡음 / delta는 현에게 지급 | 제거됨 | - |
| c1 | 서류함은 서하가 닫아 현의 품에 안겨 줌 / delta 현. 서하가 편지를 품속에 챙긴 서술이 있으나 delta는 편지를 서류함 항목에 포함해 현에게 준다 (경미한 불일치) | 유지 | 22.7원 |
| c2 | 서술 내부의 소지 동작이 서로 다름(아래) / delta는 현에게 지급 | 제거됨 (서술은 열쇠를 계속 사용, 소모 서술 없음) | 16.5원 |

합계 2호출 39.2원(상한 1,000원 이내). 원문: `docs/evidence/trpg-inventory-ownership/paid-gm-replay/`.

### c2 장부 소지 장면 (`c2-r3-after-narration.txt` 원문)

1. 서하: "서하는 안경을 고쳐 쓰며 손가락으로 장부의 행들을 빠르게 짚어 내려갔다."
2. 서하: "서하가 장부의 다른 서류 한 장을 불빛 쪽으로 비추며 미간을 찌푸렸다."
3. 현: "현의 손에는 강도현의 범죄를 입증할 결정적인 밀수 장부 원본과 특수 출동 명령서가 쥐어져 있었다."
4. 서하: "서하가 장부를 단단히 방수포에 싸서 가슴에 품으며 낮게 속삭였다." (바로 뒤 대사: 서하: "장부는 확보했어요.")
5. GM 요약: "세관장 강도현의 밀수 장부와 침몰 공작 명령서를 손에 넣었으나" (소유자 미지정).

3번에서 장부는 현의 손에 있고 4번에서 서하의 품에 있다. delta는 현(participantId=2)에게만 장부·명령서를 준다(`inventoryAdd: ["세관 밀수 장부 원본", "특수 출동 명령서"]`). 서술 내부의 소지가 현과 서하로 갈리고 delta는 그중 한쪽만 반영하므로, c2의 소유권이 확정적으로 일치한다고 판정할 수 없다. 모순 또는 모호함이 잔존한다. 이는 베이스라인의 장부 소지 모순 유형이 처리군에서도 남은 것으로 본다.

### c2 인간 PC 선택권 침해

현의 제출 행동은 "주운 황동 열쇠를 들고 심부름꾼이 사라진 폐창고 골목으로 들어가, 열쇠가 맞는 문을 찾아 조심스럽게 연다. 안에서 철제 서류함을 찾아 확인한다."(`c2-r3-after-user.txt` `[ACTION participantId=2]`)이다. 심문은 포함하지 않았다. 그런데 c2 서술은 현의 대사를 생성했다.

> 현: "강도현이 네놈에게 이 서류함을 어디로 빼돌리라고 지시했지? 소각조차 하지 못하고 서둘러 챙겨 나온 걸 보면, 누군가에게 직접 넘기려던 것 아닌가?"

미제출 인간 PC 대사·행동을 GM이 대신 쓴 사례이며, 인간 PC 선택권 침해 회귀 위험으로 기록한다. 이 수정(계약 단락)은 이 위험을 해결하지 못했고 오히려 관측됐다. 이는 소지품 계약과 별개의 기존 인간 PC 권한 문제의 재현이다(R4 조사와 같은 유형). 이번 문서는 원인을 규명하지 않는다.

### 해석

처리군은 c1 기준 서류함 소유자가 일치했으나 편지에서 경미한 불일치가 있고, c2는 소유자 일치를 판정할 수 없으며 열쇠 제거와 인간 PC 대사 침해가 함께 관측됐다. 같은 입력의 서술 장면 자체가 호출마다 달라(c1: 서하가 열고 현에게 안김, c2: 현이 줍고 연 뒤 서하가 품에 안김) 계약 효과와 서술 변동을 분리할 수 없다. 베이스라인이 1회뿐이라 비교가 성립하지 않는다. 티켓의 호출 상한(GM 최대 2회) 때문에 표본을 늘리지 않았다. 효과가 입증되지 않아 프롬프트 변경은 반영하지 않았다(`gmPrompt.ts` 변경 없음).

## 5. BEFORE / PROBLEM / AFTER / REMOVED / PRESERVED

- BEFORE: R3에서 서술의 소유자와 delta의 소유자가 갈리고, 사용한 열쇠가 delta에서 제거됐다.
- PROBLEM: 확인된 것은 GM 원본 한 응답 안의 narration/delta 모순이다. 프롬프트 계약 부재와 서버의 GM add/remove 무검증은 인과 미확정인 설계 공백이다. 병합의 결정적 결과와 AI 동료 입력은 원인이 아니다.
- AFTER: 코드·프롬프트 변경 없음. c2에서 소유권 모호함, 열쇠 제거, 미제출 인간 PC 대사가 관측됐다.
- REMOVED: 없음. 폐기한 시도는 위 계약 단락이다.
- PRESERVED: HP·위치·목표·소지품 canonical owner, 기계 소모 경로, AI 동료의 자율 행동·취득.

## 6. 남은 위험과 선택지 (승인 대기)

1. 열쇠 같은 재사용 아이템의 제거: 프롬프트 계약은 효과 미입증. 결정적 대안은 `mergeMechanicsOwnedDelta`가 소모 근거(기계 소모 또는 제출 행동) 없는 GM `inventoryRemove`를 거부하는 서버 권한 정책 변경이다. 이전 소모 경로·기존 캠페인 데이터에 영향이 있어 승인 없이 하지 않는다.
2. 인간 PC 선택권: c2의 미제출 현 심문 대사는 별도 후속 조사 대상이다.
3. 중복 적용: 정확히 1회 커밋 보호가 시트 중복 적용까지 막는지는 미입증이다(별도 증거 필요).
4. 재생성: `regenerate`는 새 서술을 저장하되 새 delta를 폐기한다. 재생성 후 서술과 시트가 다를 수 있다. 별도 후속.
5. AI 동료 입력에 소지품이 없다. 소유자 일치가 보장된 뒤에만 노출을 검토한다.
6. 모순 발생률은 이 증거(R3 1건 + 재생 2건)로 측정할 수 없다.

## 7. 재현

- `docs/evidence/trpg-inventory-ownership/scripts/invmerge.mts`: R3 delta 병합 결정성(출력 `repro-inventory-merge.txt`; `.log` 확장자는 `.gitignore`가 제외해 `.txt`로 둔다).
- `docs/evidence/trpg-inventory-ownership/scripts/replay-gm.mts`: 유료 재생(비용 게이트 포함, 레저 `spend-ledger.json`).
