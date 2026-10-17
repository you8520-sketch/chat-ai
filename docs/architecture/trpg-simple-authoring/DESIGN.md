# 하브 TRPG 초간편 제작 · 단일 모험 정본 — 설계 보고 (STOP)

- 기준: main `abe9e8a6` (운영 health `fe9db48`). 코드 변경 없음. provider 호출 0, 운영 DB 읽기·쓰기 0.
- 캠페인 43·44 추가 재플레이 없음. #1635 원문 증거(`docs/evidence/trpg-1635-ops-play/`, 브랜치 증거)와 현재 코드만 사용했다.
- 관련 설계: `docs/architecture/trpg-vnext/RFC.md`(결과 권한). 이 문서는 그 RFC의 결과 권한 계약을 바꾸지 않고, **제작 입력과 장소 정본**만 다룬다.

## 0. 결론

**STOP.** 단일 게임 정본(티켓 C, 수직 경로 성공 조건 4)은 현재 탐험 엔진의 근본 변경을 요구한다. 지도·이벤트·규칙이 테스트용 "센터 봉쇄" 한 시나리오에 하드코딩되어 있고, GM은 지도 인접 관계를 아예 받지 않는다. DB 마이그레이션은 필요 없지만(JSON 컬럼) 엔진 의미 변경 범위가 "안전한 최소 수직 경로"를 넘는다.

반면 **제작 UX 단순화(티켓 B, 성공 조건 1·2·3·6)는 엔진 변경 없이 가능**하다. 저장 게이트가 이미 "제목 + 본문"만으로 통과하고, AI 초안 route가 자유 텍스트와 세계관을 이미 받는다.

승인 요청: §6 선택지 중 하나.

## 1. 현재 경로 (owner map)

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
| 기본 화면에 이야기·게임 규칙·NPC·공개 4개 카드 + 상태값 칩·난이도·길이·시작 장소·소지품·특별 규칙이 처음부터 노출 | `TrpgScenarioEditor` 섹션 `세계관 / 이야기 / 게임 규칙 / 보스·조연 NPC / 표시·공개` | 새 화면에서 "AI가 구성한 내용" 접힘 영역으로 이동 |
| `필수 이야기 n / 5` 문구 | 편집기 `:709` vs `FIRST_CREATE_VISIBLE_FIELDS` 길이 3 | 오래된 문구 — 새 화면에서 제거 |
| `plan.secret` 와 `secretContent` | 둘 다 `gm_secret` 으로 합쳐짐 (`engineCreate`) | 중복 비밀 채널 |
| `plan.boss` 와 NPC `role=boss` | serialize가 boss NPC 있으면 plan.boss 생략 | 중복 |
| `characterIds` | 저장 payload에만 있고 선택 UI 없음 | UI 없는 필드 |
| `npc.stats` | 초안이 항상 `null`, 런타임 reader 없음 | 미사용 |
| `plan.exploration` | UI 없음, 테스트만 `true` 설정 (`scenarioPlan.ts` 주석 "Absent on every existing scenario") | 테스트 전용 opt-in |
| `plan.encounters` | AI 초안이 제거, UI 없음, 테스트/API만 | 런타임 권한 owner(`governedEncounters`)는 살아 있음 |
| 동료 프롬프트 | 시나리오 plan·NPC·장르를 읽지 않음 (`world_brief` + 캐릭터 카드 + 탐험 brief) | 정본 소비 불일치 |

## 2. 캠페인 44 증거 → 원인 경로

### 2.1 GM 이동 경로 ≠ 서버 지도 (확정)

캠페인 44 지도는 layout 0: `r6=현관홀`, 인접 `r7=중앙홀`, `r4=남쪽복도` (공개 edges r6–r7, r6–r4, r7–r4 와 정확히 일치).
GM 오프닝은 "정면 기록실, 오른쪽 순환로·보관실" 을 출구로 서술했다. 세 장소 모두 현관홀과 연결되어 있지 않다(순환로는 숨은 통로).

소비자별 인접 정보:

| 소비자 | 받는 것 | 현관홀 출구 |
|---|---|---|
| 서버 이동 판정 | `map.edges` | 중앙홀, 남쪽복도 |
| UI | 같은 edges, 미방문은 `?` | r7 `?`, r4 `?` |
| 동료 | `formatExplorationBotBrief` → `Open passages:` 이름 | 중앙홀, 남쪽복도 |
| **GM** | `formatExplorationGmBlock` — **인접 목록 없음** | "At least two passages leave this room." |

GM이 장소 이름을 얻는 경로: 시나리오 본문/GM 비밀(운영 템플릿 텍스트), 그리고 **모든 탐험 GM 블록에 항상 들어가는 서버 플래그 이름** `숨은 통로: 순환로와 현관홀이 연결되었다` (`EXPLORATION_PASSAGE_FLAG`, `explorationMap.ts` `:749–751`). 블록은 "Visible passages may be atmosphere" 라고 허용하므로 GM은 실제 인접과 다른 출구를 자유롭게 묘사한다.

→ 원인은 GM 문장 규칙 부족이 아니라 **GM에게 정본 인접이 주입되지 않는 구조**다. 프롬프트 문장 추가로 고치지 않는다.

### 2.2 R3 지도 클릭이 locked 이동으로 남지 않음 (원인 미확정 — 수정 없음)

locked body가 이동 문장 없는 자유 텍스트 + `actionType=free` 인 것은 서버가 `submitTrpgAction` 의 **priced command 없음 분기**를 탔다는 뜻이다(`engineAdvance.ts` `:509–547`). 이 분기에 도달하는 경로:

| # | 지점 | 유형 |
|---|---|---|
| 1 | 지도 접힘 상태에서 클릭 → 헤더 토글만 | silent |
| 2 | 비인접/현재 방/locked → 버튼 disabled | silent |
| 3 | `useEffect(() => setExplorationQueue([]), [snap.round.number, snap.myDraft?.locked])` — 폴링 중 `myDraft.locked` 값이 `undefined→false` 등으로 바뀌면 큐가 비워짐 (`TrpgRoomClient.tsx` `:121–124`) | silent (후보) |
| 4 | 큐가 비면 `explorationCommands` 키 자체를 생략 | silent |
| 5 | 서버: 생략 → `[]`, 자유 텍스트에 이동 선언 없음 → else 분기 | silent |
| 6 | 비인접·AP·숨은 통로·출구 → HTTP 400 | 사용자에게 보임 (R3 은 200) |

잠금 직후 위치가 `현관홀/r6` 인 것은 정상 큐에서도 같다(위치는 라운드 commit에서만 바뀜). 1·2·3·4는 공개 스냅샷에서 구분 불가하다.
판정에 필요한 데이터: 캠페인 44 `exploration_json.pending/appliedKeys` 에 R3 렌의 move 기록이 있는지(운영 DB 읽기 — 승인 필요), 또는 요청 JSON(현재 저장되지 않음). 테스터가 실제로 펼친 지도에서 도달 가능한 방을 눌렀는지도 증거에 없다.
**조치: 원인 확정 전 수정하지 않는다.** 3번은 의심 후보로만 기록한다.

### 2.3 동료 대기 3/6 (fallback 수정 없음)

R1·R2(권태현)·R3(강이현) 대기 슬롯의 모델 원문·거절 사유는 공개 경로에 없다(`BOT_PATH.md`).
관찰 가능한 사실: 같은 캠페인 R3 권태현 수락 본문은 "순환로 쪽 뚫고 경보실로" 를 목표로 썼다 — GM 서술이 만든 이름이고, 그의 서버 brief는 `중앙홀, 남쪽복도` 였다. GM 서술이 동료를 비인접 목표로 유도하면 이동이 거절되고 대기로 떨어질 수 있다. 이것은 **가설**이며 대기 3건의 원인 배정이 아니다. #1635 fallback에 정규식·보정을 추가하지 않는다. 정본 주입(§4.2)이 같은 상류 원인을 없애는지 이후 증거로 확인한다.

## 3. 설계 원칙 (티켓 고정)

1. 기본 화면 = 자유 설명 1칸 + 기존 세계관 선택(선택) + `모험 만들기`.
2. 그 외 모든 항목은 AI 기본값. 펼치지 않아도 플레이 가능.
3. 모드 선택 없음. 지도는 정본에 장소가 2곳 이상일 때만 보조 패널로 표시.
4. 장소·연결·이벤트의 정본은 하나. GM·동료·UI·이동 판정이 같은 projection을 소비.

## 4. 목표 설계

### 4.1 제작 (엔진 변경 없음)

```
[어떤 모험을 만들고 싶나요?]  (textarea, 필수: 설명 또는 세계관 중 하나)
[기존 세계관 불러오기 ▾]       (선택, 본인 세계관만 — 기존 assertScenarioWorldAccess 유지)
[모험 만들기]
  → POST ai-draft (fill_empty, existingDraft.content = 설명, worldId)
  → 응답을 비공개로 바로 저장 (insertScenarioTemplate) — 저장 게이트: AI 제목 + content
  → 결과 화면: 제목·한 줄 소개·시작 상황 + [이 모험 시작] [AI가 구성한 내용 보기·수정 ▸]
```

- "AI가 구성한 내용" 펼침 = 현재 편집기 항목(목표, NPC, 규칙, 소지품, 공개 설정 등)을 그대로 재사용. 새 owner를 만들지 않는다.
- 공개(게시)는 현행 게이트(소개 필수) 유지 — AI가 소개를 채우므로 추가 입력 없음.
- 초안 실패/타임아웃: 입력 보존(현행 `FORM_PRESERVED_ON_TIMEOUT`), 저장하지 않음.
- 비용: 기존 초안 호출 1회와 동일(현재도 "AI로 시나리오 초안 만들기" 1회). 새 provider·과금 구조 없음.
- 정리 대상(새 화면 도입과 같은 PR): `필수 이야기 / 5` 문구, 기본 화면의 상세 카드 노출.

### 4.2 단일 모험 정본 (엔진 변경 — 승인 필요)

**저장 위치(마이그레이션 없음):**
- 템플릿: `scenario_plan_json.adventure` (AI 초안이 생성, 펼침 영역에서 수정 가능)
- 캠페인: 시작 시 `exploration_json` **version 2** 로 스냅샷 복사 (템플릿 수정이 진행 중 캠페인을 바꾸지 않게 — RFC C2b 와 같은 문제)

```ts
type AdventureCanon = {
  places: { key: string; name: string; summary: string; role: "start" | "hub" | "site" | "goal" }[]; // 1~9
  links: { from: string; to: string; hiddenUntil?: string /* event key */ }[];
  startPlace: string;
  events: { key: string; place: string; kind: "clue" | "item" | "passage" | "hazard" | "gate";
            text: string; search: "normal" | "careful"; unlocks?: string }[];
  // NPC·목표·엔딩은 기존 owner(npcs_json, plan.goal/endingConditions, encounters)를 그대로 쓴다.
};
```

**단일 projection:** `explorationFactsForSeat(state, seat)` → `{ place, openExits[], knownPlaces[], party[], ap }`.
- GM 블록: 좌석별 현재 장소 + **이름 있는 열린 출구** + 이번 라운드 결과. 서버 플래그 이름은 해당 이벤트가 실제로 열렸을 때만 노출.
- 동료 brief: 같은 projection (현행 `formatExplorationBotBrief` 를 projection 소비로 교체).
- UI: 같은 projection의 공개 부분(미방문 이름 가림 정책은 유지 여부 결정 필요 — GM이 출구 이름을 말하면 UI `?` 와 충돌).

**엔진 변경 범위:**

| 파일 | 변경 |
|---|---|
| `explorationMap.ts` | 고정 `ROOM_IDS`/`LAYOUTS`/`eventsForMap`/경보·출구 빗장 상수 → 정본 데이터 구동. `assertPlayable`(7–9방, 순환, 2 갈림, 탈출 가능) → 정본 검증(연결성, 시작 존재, gate 해제 가능) |
| `explorationStore.ts` | v2 생성(정본 → state), v1 reader 처리 방침 |
| `engineAdvance.ts` | commit의 위치/아이템/플래그 적용이 정본 이벤트 기반으로; 봇 brief 교체 |
| `gmPrompt` 입력 | `explorationBlock` 내용 교체(새 섹션 추가 아님) |
| `filterExplorationFlagsAdd/Remove` | 고정 3개 플래그 → 정본 이벤트에서 파생 |
| `scenarioDraft.ts` | 초안 JSON에 `adventure` 추가 + 파서/복구 |
| 비탐험 경로 | 정본 장소 1곳(또는 생성 실패) → 지도 없음, 현행 ledger/openRoutes 위치 owner 유지 |

**모드 없는 흐름:** 대화·협상·조사·전투는 현행 행동 유형 + mechanics + encounter 권한이 담당. 정본은 "어디서 무엇이 가능한가"만 공급한다. 정본 hazard → `plan.encounters` 연결은 RFC §6(위협 권한)과 겹치므로 별도 단계.

## 5. 위험

- **v1 진행 캠페인**: 운영에 `exploration_json` v1 행이 있으면 reader 유지 또는 종료 처리 필요. 수 확인에 운영 DB 읽기 필요(미실행).
- **GM 출구 서술 vs UI 안개**: 이름 있는 출구를 GM에 주면 UI `?` 정책과 충돌 — 제품 결정 필요.
- **초안 출력 증가**: places/links/events 추가로 출력 토큰 증가(같은 모델·같은 호출, 과금 구조 불변). 잘림 시 현행 truncation 오류 경로.
- **정본 생성 품질**: 연결 불가·gate 해제 불가 그래프 → 서버 검증 실패 시 "지도 없음" 으로 강등(플레이는 계속).
- **테스트 데이터 삭제**: 운영의 테스트 템플릿·캠페인 목록과 참조(`trpg_campaigns.template_id`, rounds, ledger, billing)를 먼저 조회해야 한다. 미실행. 공용 세계관·캐릭터·결제 데이터는 대상 아님.

## 6. 선택지

| | 내용 | 엔진 | 성공 조건 충족 |
|---|---|---|---|
| **A** | §4.1 제작 화면만. 새 모험은 지도 없이(현행 비탐험 경로) 시작 | 없음 | 1·2·3·5·6. 4는 "서버 지도 없음 → GM이 위치 owner(현행 ledger 바인딩)"로만 일치. 티켓 C 미충족 |
| **B (권장)** | A 후 정본을 단계별로: **B1** GM 블록이 동료와 같은 열린 출구 이름을 받고 플래그 이름 상시 노출 제거(현 9방 지도 그대로, `explorationBlock` 교체) → **B2** `adventure` 정본 + 초안 생성 + v2 state → **B3** 이벤트·플래그 데이터 구동, 고정 경보/빗장 제거 → **B4** 9방 layout·테스트 상수·`plan.exploration` opt-in 삭제(v1 행 0 확인 후) | 단계별 | B2 이후 전부 |
| **C** | vNext RFC와 묶어 전면 재작성 | 대 | 전부, 범위 최대 |

B1은 캠페인 44 문제 1의 직접 원인(GM 미주입)을 현 지도에서 제거하는 가장 작은 단위이며, 동료 대기 가설(§2.3)을 검증할 수 있게 한다.

## 7. 승인 요청

1. 선택지 A / B / C.
2. B라면: GM에 출구 이름을 줄 때 UI 미방문 `?` 를 유지할지.
3. 운영 DB 읽기 허용 여부: (a) 캠페인 44 `exploration_json` R3 pending/appliedKeys 확인, (b) `exploration_json` v1 행 수, (c) 테스트 템플릿·캠페인 삭제 후보와 참조 수. 읽기 전용, 삭제는 별도 승인.
4. R3 지도 클릭: 위 (a) 결과 전까지 수정 보류 유지.
