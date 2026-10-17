# 하브 TRPG 초간편 제작 · 단일 모험 정본 — 설계와 구현 상태

- 최초 설계: #1642 (main `abe9e8a6`, 문서만, STOP). 이 문서는 #1642 원문을 B2+B3 구현 PR에 합친 갱신본이다.
- 현재 기준: main `28d6337d` (#1650 병합 후). B2+B3 구현 PR에서 갱신.
- 관련 설계: `docs/architecture/trpg-vnext/RFC.md`(결과 권한). 이 문서는 RFC의 결과 권한 계약을 바꾸지 않고 **제작 입력과 장소 정본**만 다룬다.

## 0. 상태

| 단계 | 내용 | 상태 |
|---|---|---|
| A | 제작 화면 = 설명 1칸 + 세계관 선택 + `모험 만들기`, AI 초안 → 비공개 저장 | #1650 병합 |
| B1 | GM이 동료·지도와 같은 열린 출구 이름을 받고, 미발견 통로 플래그 이름을 보지 않음 | #1647 병합 |
| B2 | `scenario_plan_json.adventure` 정본 + AI 초안 생성 + 시작 시 `exploration_json` v2 스냅샷 | 이 PR |
| B3 | 이벤트·통로·아이템·위험을 정본 데이터로 구동. v2에는 고정 경보/빗장/세계 플래그 없음 | 이 PR |
| B4 | 9방 layout·센터 봉쇄 상수·`plan.exploration` opt-in·v1 reader 삭제 | FOLLOW-UP (운영 v1 행 0 확인 후) |

§1~§2는 #1642 당시(`abe9e8a6`)의 분석 기록이다. 현재 구조는 §4와 §8을 본다.

## 1. 현재 경로 (owner map, #1642 당시)

| 책임 | owner |
|---|---|
| 제작 진입 | `/trpg/scenarios/new` → `/world/create?tab=scenario` → `CreateWorld` → `TrpgScenarioEditor` |
| 편집 | `/trpg/scenarios/[id]` → `TrpgScenarioEditor` |
| 저장·플레이 게이트 | `scenarioReadiness.evaluateScenarioReadiness` (제목 필수, `content` 또는 시작상황+목표) |
| AI 초안 | `POST /api/trpg/scenarios/ai-draft` → `scenarioDraft.ts`(프롬프트·파싱·병합) → `scenarioDraftCall.ts` (`deepseek-v4-flash-0731`) |
| 저장 | `scenarioTemplates.insert/updateScenarioTemplate` → `trpg_scenario_templates` (`scenario_plan_json` 등) |
| 캠페인 생성 | `POST /api/trpg/campaigns` → `engineCreate.createTrpgCampaign` (world_brief / gm_secret / scenario snapshot 복사) |
| 세계관만으로 시작 | 같은 route `worldId` → `sandboxDirector` + `worldBlueprintPregen`(derived cache, flag) |
| 시작 | `engineAdvance.startTrpgCampaign` → `ensureCampaignDirectorContext` → `ensureExplorationMap`(plan.exploration === true 일 때만) |
| GM 조립 | `engineAdvance.runGmForRound` → `gmPrompt.buildTrpgGmUserBlock` (`[WORLD]`, `[GM SECRET]`, `[SCENARIO PLAN]`, director, local scene, `explorationBlock`) |
| 동료 | `engineAdvance.generateBotActions` → `botActions.buildTrpgBotActionUserBlock` + `formatExplorationBotBrief` |
| 지도 정본 | `explorationMap.ts`(순수) / `explorationStore.ts` → `trpg_campaign_context.exploration_json` |
| 위치 | 탐험: `trpg_character_sheets.location` (라운드 commit). 비탐험: `campaignLedger` location + `localSceneProgress.openRoutes` |

### 1.1 제작 화면의 불필요·중복·테스트 전용 항목

| 항목 | 근거 | 분류 |
|---|---|---|
| 기본 화면에 이야기·게임 규칙·NPC·공개 4개 카드 + 상태값 칩·난이도·길이·시작 장소·소지품·특별 규칙이 처음부터 노출 | `TrpgScenarioEditor` 섹션 | #1650에서 "AI가 구성한 내용" 펼침으로 이동 |
| `필수 이야기 n / 5` 문구 | 편집기 vs `FIRST_CREATE_VISIBLE_FIELDS` 길이 3 | #1650에서 정리 |
| `plan.secret` 와 `secretContent` | 둘 다 `gm_secret` 으로 합쳐짐 (`engineCreate`) | 중복 비밀 채널 (FOLLOW-UP) |
| `plan.boss` 와 NPC `role=boss` | serialize가 boss NPC 있으면 plan.boss 생략 | 중복 (FOLLOW-UP) |
| `characterIds` | 저장 payload에만 있고 선택 UI 없음 | UI 없는 필드 (KEEP) |
| `npc.stats` | 초안이 항상 `null`, 런타임 reader 없음 | 미사용 (FOLLOW-UP) |
| `plan.exploration` | UI 없음, 테스트만 `true` | v1 opt-in. B4에서 삭제 |
| `plan.encounters` | AI 초안이 제거, UI 없음 | 런타임 권한 owner(`governedEncounters`)는 살아 있음 (KEEP) |
| 동료 프롬프트 | 시나리오 plan·NPC·장르를 읽지 않음 | 탐험 사실은 B2+B3에서 store 소유 brief로 일치. 그 외는 범위 밖 |

## 2. 캠페인 44 증거 → 원인 경로 (#1642 당시)

### 2.1 GM 이동 경로 ≠ 서버 지도 (확정 → B1에서 수정)

캠페인 44 지도는 layout 0: `r6=현관홀`, 인접 `r7=중앙홀`, `r4=남쪽복도`.
GM 오프닝은 "정면 기록실, 오른쪽 순환로·보관실" 을 출구로 서술했다. 세 장소 모두 현관홀과 연결되어 있지 않다(순환로는 숨은 통로).

| 소비자 | 받는 것 | 현관홀 출구 |
|---|---|---|
| 서버 이동 판정 | `map.edges` | 중앙홀, 남쪽복도 |
| UI | 같은 edges, 미방문은 `?` | r7 `?`, r4 `?` |
| 동료 | `formatExplorationBotBrief` → `Open passages:` 이름 | 중앙홀, 남쪽복도 |
| **GM** | `formatExplorationGmBlock` — **인접 목록 없음** | "At least two passages leave this room." |

→ 원인은 GM 문장 규칙 부족이 아니라 **GM에게 정본 인접이 주입되지 않는 구조**였다. B1(#1647)이 GM 블록에 동료와 같은 열린 출구 목록을 넣고 미발견 통로 플래그 상시 노출을 제거했다.

### 2.2 R3 지도 클릭이 locked 이동으로 남지 않음 (원인 미확정 — 수정 없음)

locked body가 이동 문장 없는 자유 텍스트 + `actionType=free` 인 것은 서버가 `submitTrpgAction` 의 priced command 없음 분기를 탔다는 뜻이다. 후보(접힌 지도 클릭, disabled 버튼, `setExplorationQueue([])` effect, 큐 생략)는 공개 스냅샷에서 구분 불가하다. 운영 DB 읽기 승인 전까지 수정하지 않는다. B2+B3도 이 경로를 바꾸지 않았다.

### 2.3 동료 대기 3/6 (fallback 수정 없음)

대기 슬롯의 모델 원문·거절 사유는 공개 경로에 없다. "GM 서술이 동료를 비인접 목표로 유도" 는 가설로만 남긴다. #1635 fallback에 정규식·보정을 추가하지 않는다.

## 3. 설계 원칙 (티켓 고정)

1. 기본 화면 = 자유 설명 1칸 + 기존 세계관 선택(선택) + `모험 만들기`. 제작자는 지도·NPC·이벤트 JSON을 쓰지 않는다.
2. 그 외 모든 항목은 AI 기본값. 펼치지 않아도 플레이 가능.
3. 모드 선택 없음. 지도는 정본에 장소가 2곳 이상일 때만 보조 패널로 표시. 자유 텍스트는 그대로.
4. 장소·연결·이벤트의 정본은 하나. GM·동료·UI·이동 판정이 같은 상태를 소비.
5. HP·아이템·위치·판정은 기존 서버 owner만 결정한다. GM 주장은 상태에 적용하지 않는다.

## 4. 구현된 설계 (B2+B3)

### 4.1 제작 (A, #1650)

설명 → `POST ai-draft` → 비공개 저장 → 결과 화면. B2+B3에서 바뀐 점:
- 초안 계약에 `adventure` 가 추가됐다(같은 모델·같은 1회 호출, `json_object` 모드 미사용 유지).
- 초안과 저장은 같은 엄격 검증(`evaluateAdventure`)을 쓴다. 잘못된 다중 장소 정본은 오류로 돌려주고 자동 재시도하지 않는다. 입력은 보존된다.
- 정본을 요청한 초안(`expectedFields` 에 `adventure`)이 정본을 빠뜨리거나 `null` 로 돌려주면 `SCENARIO_DRAFT_ADVENTURE_MISSING` 422로 실패한다(재호출 없음, 입력 보존). 목표만 다시 만들기 같은 부분 재생성과 기존 수동 시나리오는 정본을 요구하지 않는다.
- 정본이 있으면 `startLocation` 은 정본 시작 장소에서 파생되고 편집기에서 읽기 전용이다.
- 편집기 "AI가 구성한 내용" 에 **장소와 사건** 카드(장소, 숨은/잠긴 길, 사건, 고정/다시 생성, "장소 구성 없이 진행하기")가 추가됐다.

### 4.2 단일 모험 정본

**저장 위치(마이그레이션 없음):**
- 템플릿: `scenario_plan_json.adventure`
- 캠페인: `ensureCampaignDirectorContext` 가 시작 시 plan을 동결하고, `ensureExplorationMap` 이 동결된 정본을 `exploration_json` **version 2** 로 컴파일한다. 템플릿 수정은 진행 중 캠페인을 바꾸지 않는다.

```ts
type TrpgAdventure = {
  start: string;                                   // place key
  places: { key: string; name: string; summary: string; role: "start" | "hub" | "site" | "goal" }[]; // ≤12
  links: { from: string; to: string; hidden?: boolean; opensBy?: string }[];                          // ≤24, 무방향
  events: { key: string; place: string; trigger: "enter" | "search" | "careful_search";
            kind: "clue" | "item" | "hazard"; text: string; item?: string; requires?: string[] }[];  // ≤16
};
```

- 길을 여는 것은 사건 종류가 아니라 **링크 데이터**다. `hidden + opensBy` = 숨은 길(발견 전 비공개), `opensBy` 만 = 보이는 잠긴 길. #1642의 `passage`/`gate` 종류와 초기 구현의 `open` 종류는 링크와 모순될 수 있어 제거했다.
- 검증(`evaluateAdventure`): 형식, key·이름 중복, 없는 장소/사건 참조, 숨은 길의 여는 사건 필수, 시작 장소 enter 사건 금지, 2곳 이상이면 사건 존재 + 사건이 길/다음 사건으로 이어짐 + 모든 장소·사건 도달 가능(고정점 계산). 선택 필드(`requires`, `hidden`, `opensBy`, `trigger`)는 생략하면 없음으로 읽지만, 값이 있는데 타입이 틀리면 기본값으로 바꾸지 않고 오류로 돌려준다.
- 1곳 정본은 지도 없는 정상 모험이다. 사건이 있으면 지도 없이 v2 상태를 저장하고 조사(`조사 1`/`정밀 조사 2`)로 같은 판정 owner가 사건을 실행한다. 공개 projection은 `singlePlace` 로 지도·길 대신 "현장 조사" 패널을 보여 주고, 자유 텍스트 이동은 파싱하지 않는다. 사건 없는 1곳 정본과 정본이 없는 경우(구 템플릿, 세계관 직접 시작, 제작자가 "장소 구성 없이 진행하기"로 지운 경우)는 기존 비탐험 경로.

**한 상태, 여러 소비자:**

| 소비자 | 경로 | 받는 것 |
|---|---|---|
| 이동·조사 판정 | `legalExplorationCommands` / `settleExplorationActor` | v2 map edges, `revealedEdgeIds`, 사건 trigger·requires |
| GM | `explorationPromptForRound` → `formatExplorationGmBlock` | 좌석별 시작/현재 장소, 장소 요약, 열린 길 이름, 닫힌 길 이름, 이미 기록된 발견, 이번 라운드 결과 |
| 동료 | `explorationBriefForBot` → `formatExplorationBotBrief` (store 소유) | 같은 열린/닫힌 길, 일행 위치, 발견, AP |
| UI | `projectExplorationForViewer` → `projectPublicExploration` | 방문한 곳 + 열린 길로 이어진 곳의 이름, 발견 목록, AP |

- 공개 projection: 열린 길로 이어진 장소 이름은 방문 전에도 보인다(티켓 고정, #1642 §7-2 결정). 숨은 길과 그 너머 장소, 발동 전 사건 내용은 projection에 들어가지 않는다.
- 사건 효과: `clue` = 발견 기록, `item` = 기존 인벤토리 owner로 아이템 지급, `hazard` = 결과 줄만 기록(HP·판정 변경 없음, 위협 권한은 RFC §6 별도 단계). `opensBy` 가 가리키는 사건이 발동하면 해당 링크가 `revealedEdgeIds` 에 들어간다.
- 발견 가능한 사실의 owner는 사건이다. 정본에 사건이 있으면 `serializeTrpgScenarioPlanForGm` 은 plan의 자유 `clues` 목록을 GM에 보내지 않고, GM은 서버가 발동한 사건만 EXPLORATION 블록으로 받는다. 사건 없는 계획(구 템플릿, 정본 없는 계획, 세계관 직접 시작)은 기존처럼 단서 목록을 받는다.
- v2는 세계 플래그를 소유하지 않는다(`explorationOwnsWorldFlags`). v1의 경보·빗장·고정 플래그 필터는 v1 상태에만 적용된다.
- AP·라운드·중복 가드·과금·권한은 바꾸지 않았다(이동 1, 조사 1, 정밀 조사 2, 라운드당 3).

## 5. 위험

- **동결된 정본이 잘못된 경우**: 저장·초안 경계에서 막고, 구 데이터나 수동 수정으로 템플릿에 잘못된 정본이 있으면 `loadScenarioSnapshot` 이 관대한 파서보다 먼저 `assertFrozenAdventureValid` 로 검사해 `TrpgAdventureCanonError` 를 던진다. `startTrpgCampaign` 은 이 오류만 다시 던져 GM 호출·라운드·과금 전에 시작을 막고, 플레이어에게는 issue 목록 없이 고정 문구를 보여 준다. 정본과 무관한 director 실패는 기존처럼 경고 후 진행한다.
- **한 라운드 이동 범위**: 공개 projection이 방문한 곳과 열린 길로 이어진 곳만 보여 주므로, UI로는 한 라운드에 지금 위치에서 한 칸 너머까지만 큐에 넣을 수 있다. AP 3이어도 두 칸 떨어진 사건은 다음 라운드에 닿는다(실측 SF 초안). 정책 결정 전 수정하지 않는다.
- **게임방 진입 직후 빈 띠 (#1621, main)**: 탐험 anchor의 `paddingBottom` 과 bottom tail의 `scrollMarginBottom` 이 모두 dock 가림 높이를 써서, 최신 따라가기 위치에서 접힌 탐험 패널이 화면 위로 밀리고 goal 바와 dock 사이가 비어 보인다(390: 패널 top −254, 1440: −153). 스크롤하면 패널이 정상으로 보이고 클릭 경로는 막히지 않는다. 공용 follow owner라 이 PR에서 고치지 않았다(FOLLOW-UP).
- **v1 진행 캠페인**: v1 reader와 고정 9방 지도는 유지했다. 운영 v1 행 수는 확인하지 않았다(운영 DB 읽기 없음). B4 전 확인 필요.
- **초안 출력 증가**: places/links/events 추가로 출력 토큰 증가(같은 모델·같은 호출). 최종 계약 실측 초안 2건(미스터리·SF)은 1,371·1,784 completion tokens, 호출당 약 1.1·1.4원.
- **정본 생성 품질**: 실측 초안 1건(유령 기차)이 링크·사건 모순으로 거절됐다. 그 원인이던 `open` 종류는 제거했다. 거절 시 자동 재시도는 하지 않는다.
- **GM 서술 vs 서버 사실**: GM 블록은 서버 사실만 사실로 서술하게 하지만, GM 텍스트 자체는 상태에 적용되지 않으므로 서술이 어긋나도 상태는 서버 owner가 결정한다.
- **자유 단서 우회 공개 (실측 캠페인 47, 수정함)**: 사건 정본 옆에서 plan `clues`("객차 벽면 낙서에 '세 번째 침대 아래'…")가 GM에 그대로 들어갔다. 1라운드 조사 실패 뒤 GM은 "'세 번째……'"만 암시했지만, 2라운드에는 발동 전 사건 `find_manifest` 의 위치를 director 실마리("3호 객차 세 번째 침대 밑의 비밀")로 저장했고, 3라운드 정밀 조사 실패(서버 "Nothing was found") 뒤에는 침대 밑 서류를 찾았다가 기름에 망가졌다고 서술했다. 서버에서 `find_manifest` 는 미발동이라 이야기와 정본이 어긋난다. GM 입력에서 "세 번째 침대"의 출처는 이 목록뿐이었다. 남은 채널: `gm_secret`("명단 원본은 3호실 침대 밑")과 `majorEvents` 는 여전히 위치를 담는다(비밀 owner, FOLLOW-UP). 이미 저장된 캠페인 47의 실마리·플래그는 바꾸지 않았다.
- **실패 서술이 서버 소유 대상을 파괴·봉쇄 (실측 캠페인 48, FOLLOW-UP)**: SF 정밀 조사 대실패(d20 1) 뒤 GM은 "로그 데이터"와 "방어망 무력화 코드"가 잿더미가 됐다고 서술했고(앞부분은 plan `clues` 의 "유지보수 로그"), 다음 라운드에는 격리 구역 영구 봉쇄를 서술하며 `격리구역_영구봉쇄발령` 플래그를 냈다. 서버에서 `find_maintenance_log`·`unlock_quarantine` 은 미발동이고 격리 구역 길은 여전히 사건으로 열린다. 봉쇄 서술은 단서 채널과 무관한 실패 연출이라 이번에 고치지 않았다.
- **clue 사건 뒤 GM 인벤토리 추가**: 실측 캠페인 47에서 `wet_ticket`(clue, 아이템 없음) 발견 뒤 GM delta `inventoryAdd` "젖은 승차권(첫 사고 날짜)"이 기존 인벤토리 경로로 반영됐다. 사건 아이템 owner와 별개인 GM 인벤토리 경로다(FOLLOW-UP).
- **dev 전용 과금 오류**: dev 모드 `getDb()` 가 호출마다 `migrate()` 를 다시 실행하고, libsql `transaction()` 은 중첩을 지원하지 않는다. 그래서 작성자 있는 캠페인의 라운드 commit(`resolveCreatorRewardRate` → `getDb()`)이 dev에서만 `cannot start a transaction within a transaction` 으로 실패한다. base에서도 재현되고 test/production 모드에서는 재현되지 않는다. 과금 영역이라 수정하지 않았다(FOLLOW-UP).

## 6. 선택지 (#1642) → 결정

#1642 권장안 **B** 가 채택됐다. A(#1650) → B1(#1647) → B2+B3(이 PR) 순서로 진행했고, B4와 전투 미니맵, 장시간 품질 테스트는 자동 시작하지 않는다.

## 7. 승인 질문 (#1642) → 답

1. 선택지: B.
2. GM에 출구 이름을 줄 때 UI 미방문 `?` 유지 여부: 유지하지 않는다. 열린 길로 이어진 장소 이름은 방문 전에도 보인다. 숨은 길 너머는 계속 비공개.
3. 운영 DB 읽기: 미승인. 실행하지 않았다.
4. R3 지도 클릭: 수정 보류 유지.

## 8. 정리 분류 (B2+B3 시점)

| 항목 | 분류 | 근거 |
|---|---|---|
| 사건 종류 `open` | 삭제함 | 링크 `opensBy` 와 중복·모순. writer는 이 PR의 초안 계약뿐, 저장된 데이터 없음 |
| `roomAfterExplorationCommands`, 엔진 안 동료 brief 조립 | 삭제함 | store 소유 `explorationBriefForBot` / `roomNameAfterCommands` 로 대체 |
| v1 생성기(`generateExplorationMap`, LAYOUTS, 센터 봉쇄 상수), 경보·빗장 latch, v1 플래그 필터 | KEEP → B4 | v1 진행 캠페인 reader. 운영 v1 행 수 미확인 |
| `plan.exploration` opt-in | KEEP → B4 | v1 시작 경로의 유일한 writer |
| 미사용 plan key(`npc.stats` 등), `plan.secret`/`plan.boss` 중복 | FOLLOW-UP | 저장 데이터 reader 확인 필요 |
| 세계관 직접 시작의 정본 생성 | FOLLOW-UP | sandbox director 경로는 이번 범위 밖. 지도 없이 기존대로 진행 |
| `adventure_missing` 로그 | KEEP | 진단용. 성공/실패 판단은 `SCENARIO_DRAFT_ADVENTURE_MISSING` 오류가 소유한다 |
| dev `getDb()` 재-migrate 중첩 트랜잭션 | FOLLOW-UP | dev 전용, base에서 재현, 과금 경계라 이번 PR에서 수정하지 않음 |
| 사건 정본 옆 plan `clues` GM 공급 | 좁힘 | 사건이 있으면 보내지 않음. 사건 없는 계획은 유지. writer·저장 데이터는 그대로 |
| `gm_secret`·`majorEvents` 의 사건 위치, clue 사건 뒤 GM `inventoryAdd` | FOLLOW-UP | 비밀·인벤토리 owner 결정 필요 |
| 실패 서술의 사건 대상 파괴·길 영구 봉쇄 | FOLLOW-UP | 서버 사실(미발동 사건·열 수 있는 길)과 이야기의 불일치. 프롬프트 문구가 아닌 owner 설계 필요 |
