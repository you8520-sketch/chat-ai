# TRPG GM 재생성 서술·상태 일치 (main `ff5bcacb`)

관련: #1541 실플레이, #1613 소지품 조사(효과적인 패치 미입증). 이 문서는 재생성 경로만 다룬다.

## 1. 계약과 owner

제품 계약은 **표현만 다시 쓰기**다. 기능 이름이 아니라 UI·엔진·테스트가 같다.

- UI (`TrpgSceneToolbar.tsx`): "주사위와 제출한 행동은 그대로 두고 GM 장면만 다시 씁니다."
- 엔진: `regenerateTrpgNarration` → `runGmForRound({ regenerate: true })` → `commitPendingGmResult`가 시트·원장·스토리 적용 전에 반환
- 주사위·잠긴 행동은 `loadMechanicsResolution`만 읽고 다시 굴리지 않는다
- 과금은 원래 라운드와 별도로 `billRerollGenerationExactlyOnce`

채택 여부는 `regenerateOutputInvertsCommittedCanon`이 맡고, 저장과 실패는 기존 `commitPendingGmResult` / 리롤 실패 owner를 탄다. 재생성 유저 블록의 REGENERATE 지시는 그 재작성 계약으로 교체했다. 공통 GM 시스템 프롬프트 뒤에 예외 문장을 덧붙이지 않았다. LLM 검사, 정규식 서술 수정, 새 delta 재적용, 병렬 리롤 시스템은 쓰지 않았다.

## 2. 수정 전 실패

고정 GM 응답으로 티켓 예시를 재현했다(`docs/evidence/trpg-gm-regen-state/repro-regen-inventory-split.txt`).

1. R1 커밋: 현이 장부를 챙긴 서술, 시트도 현
2. 재생성 입력: 이미 장부를 가진 현의 시트 + 같은 라운드 행동 + `[REGENERATE — … Keep CHARACTER SHEETS canon]`
3. 재생성 출력: 서하가 장부를 챙긴 서술, delta는 서하에게 `inventoryAdd`
4. 저장: 시트는 현, 공개 서술과 `structured_json`은 서하
5. 다음 GM/AI 동료 입력: `items=`는 현, 직전 장면은 서하

같은 실행 경로의 위치·목표 테스트(`acceptedLocationSnapshot`, `unauthorizedLocationPersist`, `goalLifecycle`)도 새 JSON을 저장하고 상태는 유지한다. 공개 서술이 확정 사실을 뒤집는 것은 그 저장 방식의 결과다.

## 3. 수정 (B+A)

재생성 유저 블록의 REGENERATE owner는 확정 장면과 확정 결과를 원본으로 한 표현 재작성이다. 같은 라운드를 새 사건으로 판정하지 않는다. 공통 GM 시스템 프롬프트는 그대로 두고, 재생성 호출에서는 라운드 실행·스토리 델타 계약을 그 재작성 지시로 교체한다.

채택된 재작성만 `narration`과 `structured_json`을 함께 갱신한다. 구조화 결과가 확정된 소지품·HP·위치·목표·NPC·플래그·엔딩·인카운터 종료·스토리 진행을 바꾸면 `UnadoptedTrpgRegenerateError`로 실패한다. 이미 커밋된 메시지의 목표 추가·제거·완료 제안과 같은 값은 재서술로 본다. 실패는 기존 리롤 실패 owner를 탄다. 포인트는 차감하지 않고, 사용량 기록은 남긴다. 직전 리롤이 과금된 뒤 다음 리롤이 시작되면 기존 owner가 `gm_reroll_usage_json`을 비운 다음 그 호출의 사용량만 남긴다. 자동 재시도는 없다.

리롤 lease는 `gm_committed_generation_id`를 지우지 않는다. 성공한 재작성만 그 값을 새 generation으로 바꾼다. 실패와, 커밋 전에 끊긴 stale reroll은 이전 narration, structured_json, committed generation을 유지한다. 커밋된 id가 현재 lease와 다르더라도 그 id의 리롤 사용량이 있으면 기존 복구 과금 경로가 그 generation을 한 번 정산한다.

## 4. 한계

서술만 모순이고 delta가 확정 사실을 다시 적거나 비워 두면 구조화 검사는 통과한다. 그 경우는 재작성 프롬프트가 막는 범위이고, 정규식이나 추가 LLM 검사로는 거절하지 않는다. 성공한 재생성의 과금은 유지한다.
