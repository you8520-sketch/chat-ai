# E4-3E 채팅방 프리미엄 디자인·사용성 — 증거

- Base main: `8b85f97f` (E4-3D #1581 merged)
- Candidate A (PR head, Quiet Reading): `cursor/chat-room-e4-3e-78cc` @ `386ecf20`
- Candidate B (A `b1237ddc` 위에 B 커밋 + 동일 테스트 수정 cherry-pick, Cinematic Dialogue): `cursor/chat-room-e4-3e-cand-b-78cc` @ `463846a3`
- Evidence: 이 브랜치 `cursor/chat-room-e4-3e-evidence-78cc` @ 이 문서의 이미지 커밋 `62b4da59`
- 측정은 **격리 fixture**(`/tmp/e43e-data`, `scripts/e43e-seed.ts`)에서 production build 3종(BEFORE/A/B)으로 했다. 모든 응답은 저장된 원문 fixture이고 `/api/chat` POST는 Playwright route가 SSE로 대신 응답한다. 서버의 `OPENROUTER_API_KEY`는 빈 값이며 브라우저에서 관측된 provider POST는 **0건**이다.
- 점수와 후보 선택은 GPT 몫이다. 이 문서는 측정값과 화면만 기록한다.

## 파일 구성
- `images/composite/` — BEFORE | A | B 합성(라벨 포함)
- `images/raw/{before,a,b,hue}/` — 원본 화면(고품질 webp, 모바일 DPR2)
- `data/` — 메트릭 JSON, 배경 대비 JSON, flow 결과, `summary.txt`
- `scripts/` — 하네스 (`e43e-seed.ts`, `e43e-shots.mjs`, `e43e-states.mjs`, `e43e-flow.mjs`, …)
- `logs/` — 테스트/스위트 로그

## 합성 화면
### 모바일 전체 채팅
![390 3,200자 읽기](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mobile-c3200-390-read.webp)
![390 하단](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mobile-c3200-390-bottom.webp)
![360 5,200자](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mobile-c5200-360-read.webp)
![390 rich](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mobile-rich-390-read.webp)
![390 표](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mobile-table-390-bottom.webp)
![390 실패](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mobile-failed-390-bottom.webp)
![390 짧은 대화](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mobile-short-390-bottom.webp)
![390 새 채팅](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mobile-new-390-bottom.webp)

### 태블릿·PC 전체 채팅
![576 짧은 대화](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/tablet-short-576-bottom.webp)
![576](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/pc-c3200-576-read.webp)
![768](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/pc-c3200-768-read.webp)
![1024](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/pc-c3200-1024-read.webp)
![1440 3,200자](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/pc-c3200-1440-read.webp)
![1440 5,200자](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/pc-c5200-1440-read.webp)
![1440 짧은 대화](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/pc-short-1440-bottom.webp)

### 입력창 확대 비교
![360/390 입력창(추정 표시)](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/input-dock-360-390.webp)
![390 입력창(추정 숨김)](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/input-dock-hidden-390.webp)
![576/768 입력창](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/input-dock-576-768.webp)
![1440 입력창](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/input-dock-1440.webp)

### 전송 중 / 스트리밍 / 키보드 (시간순)
![390 준비 → 생성 중](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/input-locked-390.webp)
![1440 준비 → 생성 중](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/input-locked-1440.webp)
![390 스트리밍 BEFORE](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/stream-390-before.webp)
![390 스트리밍 A](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/stream-390-a.webp)
![390 스트리밍 B](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/stream-390-b.webp)
![1440 스트리밍 BEFORE](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/stream-1440-before.webp)
![1440 스트리밍 A](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/stream-1440-a.webp)
![1440 스트리밍 B](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/stream-1440-b.webp)
![키보드 닫힘/열림(짧은 대화, 에뮬레이션)](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/keyboard-short.webp)
![키보드 닫힘/열림(긴 대화, 에뮬레이션)](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/keyboard-c5200.webp)

### 모바일 배경 이미지 모드 (사용자 설정 opacity 0.22 / 0.5 / 0.8 / 1)
![opacity 0.22(기본)](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mobile-bg-text-390-0.22.webp)
![opacity 0.5](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mobile-bg-text-390-0.5.webp)
![opacity 0.8](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mobile-bg-text-390-0.8.webp)
![opacity 1](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mobile-bg-text-390-1.webp)

### 폰트·표시 모드·성인
![폰트 small 390](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/font-small-390.webp)
![폰트 xlarge 390](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/font-xlarge-390.webp)
![폰트 small 1440](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/font-small-1440.webp)
![폰트 xlarge 1440](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/font-xlarge-1440.webp)
![표시 모드 left](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mode-left-390.webp)
![표시 모드 inline](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mode-inline-390.webp)
![표시 모드 off](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/mode-off-390.webp)
![성인 접근 가능](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/adult-adult-390.webp)
![성인 차단](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/composite/adult-blocked-390.webp)

### Candidate B — 캐릭터 hue 연결 (fixture 캐릭터 hue 260 → 18로 바꾼 임시 상태, 이후 복구)
![B hue 18, 1440](https://raw.githubusercontent.com/you8520-sketch/chat-ai/62b4da59c74cd676a08cc743775ac9c2aca31703/docs/audit/e4-3e-chat-room/images/raw/hue/b-hue18-1440.webp)

## 측정 요약 (`data/summary.txt`, `data/e43e-metrics-*.json`)

| 항목 | BEFORE | A | B |
|---|---|---|---|
| 모바일 입력창(dock) 높이 360/390 | 150.2px | 149px | 149px |
| 768 / 1440 입력창 높이 | 193.1 / 157.1px | 149.7 / 141.9px | 149.7 / 141.9px |
| 모바일 전송·자동진행 버튼 높이 | 30px | 40px | 40px |
| 모바일 메시지 도구 버튼 (재생성/수정/삭제/분기/북마크/이미지) | 32px | 40px (≥576px는 32px 유지) | 40px |
| 짧은/새 대화에서 입력창이 화면 하단에 붙지 않은 경우 (측정한 폭×시나리오 상태 중) | 11건 (최대 652px 뜸) | 0건 | 0건 |
| 가로 오버플로 / 클리핑 | 0 | 0 | 0 |
| 본문 한 줄 글자 수 @1024 (추정) | 32.6 | 40.2 | 40.2 |
| 본문 한 줄 글자 수 @768 | 32.6 | 32.6 (360px 하한 유지) | 32.6 |
| 선택기 라벨 잘림 (추정 표시, 360) | 없음 | 없음 | 없음 |
| 회귀 flow (23항목) | 22/23 | 23/23 | 23/23 |

BEFORE flow 실패 1건은 `suggest-switch-390`: 성인모드 토글이 추천 스위치 위에 겹쳐 클릭을 가로챈다 (`data/e43e-flow-before.json`). A/B에서는 별도 행으로 분리되어 통과한다.

### 모바일 배경 모드 본문 대비 (배경 밝은 5% 픽셀 기준 최저 대비, 대사/서술; `data/e43e-bgcontrast-*.json`)

| opacity | BEFORE | A | B |
|---|---|---|---|
| 0.22 (기본) | 6.17 / 11.16 | 6.17 / 11.16 | 6.17 / 11.66 |
| 0.5 | 2.62 / 4.87 | 4.10 / 7.51 | 5.49 / 10.46 |
| 0.8 | 1.14 / 2.16 | 2.95 / 5.45 | 6.42 / 11.96 |
| 1.0 | 1.29 / 1.31 | 2.34 / 4.37 | 5.60 / 10.65 |

A는 이미지 자체를 덜 밝게 눌러 대비를 올리고(밝기 슬라이더가 높을수록 이미지가 어두워짐), B는 이미지는 사용자가 정한 밝기로 두고 메시지 본문 뒤에만 캡션 패널을 둔다(패널 사이에서는 이미지가 보이지만 패널 안에서는 보이지 않음).

### 스트리밍 (`data/e43e-metrics-states-seq-*.json`, 후보를 순차 실행)
- 세 변형 모두 `data-chat-follow-latest=true`, `data-chat-live-reading-active=true` 유지, 수동 스크롤 후 detach 유지(2.5초간 y 불변).
- 1440에서 꼬리 여백은 A/B가 BEFORE보다 약 8~33px 크다(입력창이 15px 낮아진 만큼 viewport 비례 spacer가 달라짐). 마지막 문단은 모든 프레임에서 입력창 위에 보인다.

## 테스트
- 채팅 관련 43개 test 파일(ChatClient/chatDisplayPrefs/MessageBubbleToolbar/NovelText/ChatRoom 참조): main · A · B 모두 fail 0 (`logs/chat-related-tests-*.txt`). 신규 `chatRoomReading.regression.test.ts`: A 18개 · B 22개 모두 통과, A 변경 전 소스에서는 14개 실패.
- `chatAdultHandoff.test.ts`의 소스 핀 정규식이 성인 토글 분리 배치(`</select></label><ChatRoomAdultModeToggle`)를 못 읽어 실패 → 불변조건(모델 select 바로 뒤 토글 1개)은 유지한 채 정규식만 수정.
- `npm run test:regular` 전체 스위트: main `8b85f97f` 289 fail / B 311 fail. 차이는 point/gift/refund/persona-secret 등 공유 `data/app.db` 상태에 의존하는 DB 테스트로, 해당 파일을 단독 실행하면 B에서 모두 통과한다 (`personaSecretIsolation.s0`, `chatImageGenerationAdminAverageCost`, `pointPolicyUnification`). 채팅 UI 소스와 무관한 실행 순서/DB 상태 차이로 보이며 원인 분석은 이번 범위 밖. 목록: `logs/regular-suite-failures-*.txt`.
- `git diff --check`, `npm run lint`, `npm run typecheck:app`: A/B 통과. `next build`: BEFORE/A/B 모두 성공.

## 미검증 / 범위 밖
- 실제 iOS/Android 기기, 실제 소프트 키보드: 미검증. 키보드는 viewport 축소 에뮬레이션(390×508)이다.
- 실제 유료 모델 응답: 사용하지 않았다(저장된 원문 fixture 3,200/5,200자). 응답 길이·모델 라우팅·과금은 변경하지 않았다.
- 앱에는 생성 중단 버튼이 없다. 추가하면 동작 변경이므로 하지 않았고, 생성 중 상태는 버튼 표현(`aria-busy`, pulse)만 바꿨다.
- B의 hue 연결은 fixture 캐릭터 hue가 기본값 260이라 화면 차이가 작다. hue를 바꾼 임시 상태 캡처만 첨부했다.
