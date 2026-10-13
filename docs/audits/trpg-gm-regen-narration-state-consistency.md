# TRPG GM 재생성 서술·상태 일치 (main `ff5bcacb`)

관련: #1541 실플레이, #1613 소지품 조사(효과적인 패치 미입증). 이 문서는 재생성 경로만 다룬다.

## 1. 계약과 owner

제품 계약은 **표현만 다시 쓰기**다. 기능 이름이 아니라 UI·엔진·테스트가 같다.

- UI (`TrpgSceneToolbar.tsx`): "주사위와 제출한 행동은 그대로 두고 GM 장면만 다시 씁니다."
- 엔진: `regenerateTrpgNarration` → `runGmForRound({ regenerate: true })` → `commitPendingGmResult`가 시트·원장·스토리 적용 전에 반환
- 주사위·잠긴 행동은 `loadMechanicsResolution`만 읽고 다시 굴리지 않는다
- 과금은 원래 라운드와 별도로 `billRerollGenerationExactlyOnce`

Owner는 `commitPendingGmResult` 하나다. 프롬프트 문장 추가, LLM 검사, 정규식 서술 수정, 새 delta 재적용, 병렬 리롤 시스템은 쓰지 않았다.

## 2. 수정 전 실패

고정 GM 응답으로 티켓 예시를 재현했다(`docs/evidence/trpg-gm-regen-state/repro-regen-inventory-split.txt`).

1. R1 커밋: 현이 장부를 챙긴 서술, 시트도 현
2. 재생성 입력: 이미 장부를 가진 현의 시트 + 같은 라운드 행동 + `[REGENERATE — … Keep CHARACTER SHEETS canon]`
3. 재생성 출력: 서하가 장부를 챙긴 서술, delta는 서하에게 `inventoryAdd`
4. 저장: 시트는 현, 공개 서술과 `structured_json`은 서하
5. 다음 GM/AI 동료 입력: `items=`는 현, 직전 장면은 서하

같은 실행 경로의 위치·목표 테스트(`acceptedLocationSnapshot`, `unauthorizedLocationPersist`, `goalLifecycle`)도 새 JSON을 저장하고 상태는 유지한다. 공개 서술이 확정 사실을 뒤집는 것은 그 저장 방식의 결과다.

## 3. 수정

`regenerateOutputInvertsCommittedCanon`이 새 delta가 확정 시트·원장을 뒤집는지 본다. 뒤집으면 `trpg_gm_messages.narration`은 이전 장면을 유지한다. 시트·원장은 이전과 같이 재적용하지 않는다. `structured_json`은 모델 원문 기록으로 남긴다.

뒤집힘으로 보는 것: 다른 좌석에 이미 있는 아이템 지급, 아직 있는 아이템 제거, 새로운 아이템, HP·상태이상·좌석/캠페인 위치 변경, 없는 목표/NPC/플래그 추가, 있는 목표/NPC/플래그 제거.
뒤집힘이 아닌 것: 같은 좌석에 이미 있는 아이템을 다시 적기, 이미 있는 목표/NPC/플래그/위치를 다시 적기.

서술만 바꾸고 delta는 맞는 리롤은 그대로 공개한다.

## 4. 한계

서술만 서하를 말하고 delta는 현을 가리키면 구조화 검사로는 잡지 못한다. 정규식·추가 LLM 호출은 쓰지 않았다. 뒤집힌 리롤도 과금은 되며, 사용자는 이전 장면을 본다.
