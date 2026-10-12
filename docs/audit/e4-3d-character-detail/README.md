# E4-3D 캐릭터 상세·프로필 디자인 — 증거

- Base: main `1945e2de` (E4-3C #1578 merged). 작성 중 main은 무관한 paid-runner 변경으로 `da69756e`까지 전진했다 (이 PR의 파일과 겹치지 않음).
- Candidate A (PR head): branch `cursor/character-detail-e4-3d-78cc` @ `1f82074f`
- Candidate B (stacked on A): branch `cursor/character-detail-e4-3d-cand-b-78cc` @ `88e1124c`
- 증거는 **격리 fixture** (`/tmp/e43d-data`, `scripts/e43d-seed.ts`) 에서 production build 3종(BEFORE/A/B)으로 측정했다. 실제 운영 캐릭터는 접근할 수 없다.
- 점수와 최종 후보 선택은 GPT 몫이다. 이 문서는 측정값과 화면만 기록한다.

## Fixture

| key | id | 용도 |
|---|---|---|
| rich | 10 | 갤러리 6장(잠김 포함), 태그 6, world/gender/키/몸무게, 기존 대화 2개, 페르소나 2개 |
| long | 11 | 긴 이름 · 4줄 tagline · 태그 12 |
| noimg | 12 | 이미지 없음(emoji placeholder) |
| single | 13 | 이미지 1장 |
| adult | 14 | 성인 (std 사용자는 `/verify`로 이동) |
| private | 15 | 비공개 (제작자 외 차단 카드) |
| official | 16 | 공식 캐릭터 + TRPG |
| sim | 17 | 다인 시뮬레이션 |

사용자: std(일반), owner(제작자), adminOn/adminOff.

## BEFORE 측정 요약 (`data/e43d-probe-before.json`)

- 대화 시작 버튼이 첫 화면(하단 내비 제외)에 보이는 경우: 7개 폭 × 6 캐릭터 = 42 상태 중 **0**.
- 모바일 시작 버튼 위치(페이지 상단 기준): 360–576px에서 약 1150–1970px (첫 화면 fold는 791–844px).
- 모바일 첫 화면에 tagline이 완전히 보이는 경우 0 / 12.
- 액션 행: 모바일에서 5개 버튼이 동일한 outline pill, 높이 96px(2줄), 시작 버튼이 주 CTA로 구분되지 않는다.
- **768–약 930px 구간 hero 붕괴**: 좌측 레일이 본문을 줄이는데 hero가 `md`(768px, viewport 기준)에서 2열로 전환되어 텍스트 열이 83px까지 줄어든다 (768px, 긴 이름: 이름 font 8px, tagline 14줄). `data/e43d-probe-bw.json`
- 가로 오버플로, 클리핑 텍스트: 0 (sr-only 중복 span은 제외).

## 후보 요약

| | BEFORE | A Character Spotlight | B Cinematic Character Profile |
|---|---|---|---|
| 시작 버튼 첫 화면 (42 상태) | 0 | 12 (PC ≥1024 12/12, 모바일 0/12) | 39 (PC 12/12, 모바일·태블릿 ≤768 27/30) |
| 모바일 tagline 완전 노출 | 0/12 | 0/12 | 12/12 |
| 액션 행 높이 @390 | 96px | 42px | 42px |
| 768px 긴 이름 h1 폭/폰트 | 83px / 8px | 457px / 45px | 256px / 25px |
| 포스터 | 2:3, 74vw | 2:3, 74vw | 2:3, 72vw + 이름 오버레이, PC ≥1280에서 24rem |

## 회귀 검사

`scripts/e43d-flow.mjs` — BEFORE / A / B 모두 34/34 PASS (`data/e43d-flow-*.json`).
시작 dialog, Escape, 기존 대화 이어가기, 페르소나 드롭다운(클립 없음)·변경·TRPG 링크 persona 반영, 갤러리 lightbox·잠김 유지, like/follow/gift/share/comments 존재,
모바일 하단 내비 비겹침, 키보드 포커스 순서, guest→login, 비공개 차단, 성인 `/verify`, embed(`chat-intro`), creator edit/preview, owner/admin 링크, D-1 reveal(착지·hero 숨김 해제).
`scripts/e43d-a11y.mjs` — reduced-motion 시 veil 없음·hero 정상, 시작 버튼 `:focus-visible` outline 확인.

착수 스모크: 활성 홈 팝업 위치(중앙)·× 닫기·"오늘 하루 보지 않기" 모두 정상 (`data/popup-smoke.json`, 390/768/1440). E4-3C 관련 문제 없음.
