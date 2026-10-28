# HAV G2 — 관리자 비공개 초안과 자동 생성 결함 수정

**Draft / GPT 검수 요청. 유료 모델 호출 0회, 운영 DB 쓰기 0회, 병합·배포 0회.**

## BEFORE

- 시작 시 `origin/main`과 Railway production의 최신 SUCCESS 배포가 모두 `9405606e504dce4f9de88e69b0aed68b1a33e92d`였다. 배포 ID `867c054e-c5bb-4984-bed6-e424c44c8fa5`. 열린 관련 PR을 확인했고 G2 필수 수정의 중복 owner는 없었다. 진행 중 #1737이 병합돼 최종 브랜치는 `7e88efe1`에 충돌 없이 rebase했으며 추가된 TRPG 회귀 15/15를 확인했다. G2 변경 파일은 겹치지 않는다. 오래된 #1425/#1495는 이번 G1 테오 수정이 아니다.
- 이미지 저장 owner: `/api/characters` 및 `/{id}` → `characterFormSave.ts`. 인증은 `getSessionUser`, 관리자는 `isAdminUser`, 기존 공식 편집 접근은 `resolveOfficialCharacterEditorAccess`가 소유한다. 제작 UI는 `CreateCharacter.tsx`다.
- 공식 staging은 Appearance/Text Lock과 완성 asset plan을 요구하고 publish는 대표 이미지를 요구한다. 이 경로를 완화하지 않고 일반 관리자 **본인 소유 private 초안** 경로를 사용한다.
- 관계 시작 owner는 `officialSupply/userRelationStart.ts`, 변환·검증·컴파일은 `author.ts`/`bible.ts`, 최종 RP 조립은 기존 `characterChunks`/`contextBuilder`다.

## PROBLEM

1. 공통 저장기와 공개 정보 수정기가 이미지 0장을 무조건 거절했다. UI도 이미지 1장을 필수로 계산했다.
2. `findAdultTermsInText`는 정규화 과정에서 띄어쓰기·문장부호를 없앤 뒤 부분 문자열을 검색했다. G1의 “사람을 소모품으로 **보지 않으려**”를 성인 명사로 오판했다.
3. G1 브리프에는 필수 공명 능력이 있는데 관계 계획이 없어서 FREE가 됐다. 기존 QA는 관계 필드만 검사하고 능력·현재 상황·공개 원고·greeting의 필수 역할을 검사하지 않았다.
4. 선택적 Voice 보정은 응답 전체를 다시 조립했다. G1 실제 4번째 응답에는 `speech`만 있었는데, 요청한 `publicProfile.description`이 **194 → 0자**로 덮어써졌다. 5번째 응답에서 235자가 됐다.
5. 능력 `level`은 원본과 assembler에는 있으나 RP compiler에서 누락됐다. 외형 14개는 별도 Appearance Lock 원본으로 보존됐으며, G1은 그 단계를 실행하지 않았다.

## AFTER

- `finalizeAssetsForSave`가 이미지 0장 정책을 한 곳에서 처리한다. 서버가 인증한 관리자 + character + private + 일반 소유 편집일 때만 허용한다. `isAdmin`/`is_admin` body 필드는 권한이 아니다. reviewer 계정, 일반 사용자, simulation, public/link는 허용하지 않는다.
- 공식 관리 대상은 이미지 예외에서 제외한다. 특히 공식 편집기의 `preserveListingState`로 private 요청을 보낸 뒤 공개 row의 이미지를 비우는 경로도 차단한다. 기존 소유권·공식 편집 정책과 이미지 moderation은 유지한다.
- `CreatePage`는 기존 editor 접근 판정으로 일반 관리자 초안 여부를 계산한다. 제작 화면은 private 초안에서만 이미지를 선택으로 표시한다. 카드·미리보기는 기존 `CharacterCard` fallback을 사용하며 DB에는 `assets=[]`, `images=[]`를 저장한다.
- “보지/보지는/보지도 + 않/못/말…”의 명확한 부정 동사 구문만 **정규화 전** 구별한다. 독립 명사·조사·문장부호·공백/제로폭 문자 변형은 기존 차단을 유지하고 다른 성인 용어도 계속 검사한다. 문맥이 불명확한 모든 동형어를 자동 허용하는 변경은 아니다.
- 같은 관계 owner가 FREE 브리프의 명시적 필수 능력을 생성 전 거절하고, 생성된 능력·상황·인사말·공개 원고에도 같은 검사를 적용한다. 모델이 보낸 FREE의 잘못된 fixedFacts를 조립기가 지워 숨기지 않는다. 세 단계는 기존 한 계획을 공유하며 보정은 기존 타입·고정 사실을 이어받는다.
- 관계 검사는 명시적 한국어 표현을 겨냥한 제한된 결정적 검사다. 의미적으로 표현 가능한 모든 역할·우회 표현을 판별하는 분류기가 아니다. G1 콘셉트는 **ROLE_BOUND가 적합**하다. 필수 사실은 핵에 공명할 수 있는 협력자라는 점뿐이며 성별·외형·성격·감정·행동·결말을 새로 정하지 않는다. 원본을 이 제안으로 바꾸지는 않았다.
- Voice 보정은 요청한 필드와 이미 채워진 speech 하위 필드가 없거나 비면 `author_voice_revision_incomplete`로 실패한다. 부분 응답으로 유효 원고를 손상시키지 않는다. 유효 보정도 선택한 필드만 반영한다. 기존 accounting은 파싱·보정 실패 전에 성공 응답의 사용량과 비용을 기록한다.
- 새 생성본은 기존 promptStandard의 다음 버전 `compact_rp_v2`로 능력 숙련·권한을 보존한다. v1과 legacy의 컴파일은 그대로여서 기존 원고·잠금 해시를 재작성하지 않는다. 새 템플릿 provenance는 `pilot-rf-01/v4`; 과거 배치 manifest의 v3 provenance는 그대로 보존한다.
- 생성 지침의 기존 문장을 통합 수정해 계약 목표/인물 약속과 실제 보장 가능한 결과를 구별하고, 기존 결핍·모순에서 개인적 관심과 망설임이 드러나게 했다. 관계 단계·고정 로맨스 결말·새 전역 RP 지침·새 모델 단계는 없다.

## REMOVED / PRESERVED

이미지 0장 거부 두 곳을 공통 에셋 저장 owner로 통합했다. 선택적 Voice 보정에서 불필요한 전체 Bible 재조립과 FREE fixedFacts의 묵시적 삭제를 제거했다.

기존 공식 staging/publish, 이미지 moderation·성인 검수, 소유권·인증, Text/Appearance Lock, 일반 사용자 이미지 정책, 3회 생성 + 기존 선택적 Voice 보정 최대 2회, 기존 workflow 재시도·비용 집계는 유지한다. NPC repair의 기존 opt-in/cap도 바꾸지 않았다. 운영 #50/#51과 기존 캐릭터 데이터는 수정하지 않았다.

## PROOF

- 동일한 G2 직접 회귀 **main: 4 PASS / 13 FAIL → G2: 17 PASS / 0 FAIL**.
- 격리 SQLite에서 최초 원고와 자동 보정 후보를 각각 생성 → 로드 → full 수정 → 공개 정보 수정 → 이미지 후첨부했다. 원문·말투·소개·코멘트·세계관·로어북·ID·저장 대화가 유지됐다. pending 이미지는 공개 거부, trusted moderation 완료 후 기존 공개 경로가 작동했다. 이때도 official=0이다. 기존 private listing 상태의 `approved`/화면의 “검수 통과”는 GPT 원고 승인을 뜻하지 않는다.
- 정상 사용자/위조 body 권한/reviewer/simulation/이미지 없는 public·link 거부. 공식 row의 이미지 제거 거부.
- 실제 G1 4번째 provider 응답을 오프라인 재생: 기존 194자 유지 + 명시적 실패 + 기존 settled 비용 `$0.000968` 집계 유지. 요청 필드별 누락/빈 값도 검증했다.
- 관련 회귀 초기 실행은 747개 중 746 PASS, 과거 manifest와 현재 템플릿 버전의 동일성을 가정한 테스트 1개 FAIL이었다. 과거 provenance 보존으로 테스트를 바로잡은 후 핵심 author/pilot/G1/품질 owner **123/123 PASS**, 마지막 저장·에셋·공식 관리 회귀 **92/92 PASS**다.
- lint, `typecheck:app`, build와 전체 regular suite의 최종 결과는 [validation.json](validation.json)에 기록했다. 전체 1,309파일 regular suite는 범위 밖 실패가 계속돼 중단했으며 완주·통과를 주장하지 않는다. 원래 main에서 선별한 179개 중 26개 실패를 재현했다. 나머지 범위 밖 실패는 개별 분류하지 않았다. [관측 목록](regular-suite-observed-failures.json)을 관련 회귀와 분리한다.
- [G1 원본 SHA-256](g1-original-sha256.json): 10개 파일 모두 원본 커밋 `22b798b5704d7ed2b19b92cd2c4b56692bf2993c`와 바이트가 같다. [비교](g1-comparison.json), [최초 전문](g1-original/first-manuscript.md), [최초 JSON](g1-original/first-generation.json), [자동 보정 재구성](g1-original/automatic-final-reconstructed.json)을 함께 검수한다.
- [v2 RP 컴파일 비교 원문](compiled-v2-review.txt)은 compiler 변경의 검수 자료다. 최초/자동 보정 원고와 별개이며 원고 승인본이나 운영 저장본이 아니다.

재현은 저장소 루트에서 기존 regular test 계약으로 실행한다. 이 환경의 `/tmp`는 tmpfs mount라 기존 격리 helper가 persistent volume으로 판정한다. 검증에는 mount 밖 별도 `TMPDIR=/workspace/.hav-g2-tmp`를 썼으며 guard를 변경하지 않았다.

```sh
mkdir -p /workspace/.hav-g2-tmp
TMPDIR=/workspace/.hav-g2-tmp npm run test:regular -- --test-concurrency=6
node --conditions=react-server --import tsx --import ./src/lib/test/regularTestEgressPolicy.ts \
  docs/official-supply/reviews/g2-2026-10-28/replay.ts
```

## UI 원본

390px/1440px에서 실제 session 인증, POST 정책, editor GET, 화면의 변경사항 저장(PATCH), 본인 목록·수정 링크와 기존 placeholder를 확인했다. BEFORE 2/2, AFTER 로컬 production build 2/2 PASS다. AFTER는 실제 private 생성·편집 화면이다. BEFORE는 POST 거부를 확인한 후 **비교 화면만을 위한 격리 SQL fixture**를 사용했다. main이 이미지 없는 초안을 저장했다는 뜻이 아니다. UI 테스트는 `tests/ui/hav-g2-admin-draft.spec.ts`에 있다.

| 화면 | BEFORE 원본 | AFTER 원본 |
| --- | --- | --- |
| 390px 편집 | [PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/refs/heads/codex/hav-g2-draft-quality/docs/official-supply/reviews/g2-2026-10-28/ui/before-editor-390.png) | [PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/refs/heads/codex/hav-g2-draft-quality/docs/official-supply/reviews/g2-2026-10-28/ui/after-editor-390.png) |
| 1440px 편집 | [PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/refs/heads/codex/hav-g2-draft-quality/docs/official-supply/reviews/g2-2026-10-28/ui/before-editor-1440.png) | [PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/refs/heads/codex/hav-g2-draft-quality/docs/official-supply/reviews/g2-2026-10-28/ui/after-editor-1440.png) |
| 390px 목록 | [PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/refs/heads/codex/hav-g2-draft-quality/docs/official-supply/reviews/g2-2026-10-28/ui/before-list-390.png) | [PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/refs/heads/codex/hav-g2-draft-quality/docs/official-supply/reviews/g2-2026-10-28/ui/after-list-390.png) |
| 1440px 목록 | [PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/refs/heads/codex/hav-g2-draft-quality/docs/official-supply/reviews/g2-2026-10-28/ui/before-list-1440.png) | [PNG](https://raw.githubusercontent.com/you8520-sketch/chat-ai/refs/heads/codex/hav-g2-draft-quality/docs/official-supply/reviews/g2-2026-10-28/ui/after-list-1440.png) |

## G1 PREVIEW — 병합 후 비공개 초안 1건 등록 절차

1. 별도 GPT/user 코드 검수·병합 후, 실제 인증된 관리자 본인 계정의 `/my-characters`에서 이미 등록된 테오가 없는지 먼저 확인한다. 저장 응답이 끊겼다면 목록에서 기존 ID부터 확인하고 POST를 반복하지 않는다.
2. 기본 검수 대상은 **최초 원고**의 [preview-first-form.json](preview-first-form.json)이다. [preview-automatic-form.json](preview-automatic-form.json)은 비교용으로 분리한다. 두 canonical 저장 payload는 같다. 자동 보정은 저장 원고에 쓰이지 않는 내부 pitch만 바꿨으며 공개 상세 소개·코멘트·말투·인사말은 같기 때문이다. 원본 Bible의 194/0/235자 변화는 별도 비교 자료로 보존한다. 두 파일을 합치거나 두 건을 운영에 등록하지 않는다. GPT가 다른 후보를 선택하면 선택된 정확한 원고 한 건만 사용한다.
3. `/create` 또는 기존 인증된 `POST /api/characters`를 통해 private/이미지 0장으로 저장한다. payload는 기존 `buildOfficialCharacterFormBody`로 생성한 것이다. 공식 supply staging에 넣지 않고 official 배지·공개 상태를 부여하지 않는다. 이 PR에서는 이 운영 단계를 실행하지 않았다.
4. 반환된 ID와 본인 목록을 확인하고 `/create?edit=<ID>`로 재접속한다. 원고·말투·세계관·기존 로어북을 확인한다. G1의 NPC/추가 관계 로어북은 0개였으므로 임의로 만들지 않는다. 회귀의 로어북·대화는 격리 검증용이다.
5. 나중에 같은 ID에서 **실제 이미지**를 기존 업로드·태깅 경로로 추가하고 대표를 지정한다. 임시 검은 PNG나 placeholder를 에셋으로 저장하지 않는다. private 저장 후 원고와 연결 자료를 확인한다.
6. 공개는 별도 원고 승인과 이미지 moderation/성인 검수 뒤 기존 경로로만 진행한다. 이미지 없는 초안은 공개하지 않는다. 이 절차는 현재 공개나 운영 쓰기 승인이 아니다.

## COST

실제 모델 호출·운영 쓰기는 모두 0이다. 기존 정상 생성 3단계와 선택적 Voice 보정 최대 2회는 그대로다. 누락된 보정은 명시적으로 실패하므로 G1의 4번째 응답 뒤 0자 원고로 다음 보정을 이어가지 않는다. 새 retry controller는 없다.

동일 fixture/원응답을 사용한 입력 **추정치**이며 실제 billed token 측정이 아니다. [이전](input-metrics-before.json) / [이후](input-metrics.json). bound Voice 보정의 증가는 기존 관계 계획을 누락 없이 싣는 비용이다.

| fixture | 3단계 BEFORE | AFTER | 차이 | 선택적 보정 BEFORE → AFTER |
| --- | ---: | ---: | ---: | ---: |
| FREE | 14,656 | 14,762 | +106 | 5,097 → 5,097 |
| RELATIONSHIP_BOUND | 14,861 | 14,939 | +78 | 5,077 → 5,148 |
| ROLE_BOUND | 14,105 | 14,183 | +78 | 4,815 → 4,878 |
| ROLE_BOUND field | 15,018 | 15,097 | +79 | 5,130 → 5,185 |

G1 캐릭터 본문 v2 비교는 3,360 → 3,481 추정 토큰(+121), 설정 잘림 0자다. 외형 원문 전체를 RP에 복제하지 않았다. 이는 최종 persona/history/system을 포함한 실제 RP 전체 요청의 실측치가 아니다. G1 과거 5회 `$0.004887`은 기존 증거이며 이번 비용이 아니다.

## REGRESSION RISKS / REMAINING

- 한국어 동형어와 필수 역할 검사는 제한된 문법 패턴이다. 모호한 동형어·다른 의미 표현은 후속 실제 표본 검수가 필요하다. 이번에는 유료 분류기나 새 생성 단계를 추가하지 않았다.
- 불완전 Voice 보정은 이전보다 일찍 명시적으로 실패한다. 기존 정상값을 보존하므로 유효 원고가 빈 값으로 손상되지는 않는다. 기존 workflow가 실패/격리를 기록한다.
- v2의 추가 숙련도 문장으로 새 원고가 기존 길이 상한을 초과하면 기존 QA가 거절한다. v1·기존 Text Lock은 자동 갱신하지 않는다.
- **G1 원고 승인 없음.** 생존 보장의 모순, 필수 공명 역할, 관계의 감정적 매력은 원문을 보고 GPT가 판단해야 한다. 생성 지침 보완을 실제 문학 품질 개선 실측으로 주장하지 않는다. 원본을 임의로 재집필하거나 문학 점수를 매기지 않았다.
- 실제 신규 반복 생성, 유료 RP, Appearance Lock·자동 이미지, 전체 배치, 자동 공개, 기존 10슬롯 Market Fit 정비는 FOLLOW-UP이다.

**GPT 검수 요청:** 코드의 권한·이미지 정책·정보 보존 회귀를 검토하고, 최초/자동 보정/v2 컴파일 비교 자료에서 남은 역할·생존 약속·감정적 매력을 검수해 주세요. Draft 상태에서 STOP한다.
