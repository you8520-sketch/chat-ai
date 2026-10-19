# #51 RP·에셋 전환 검증 준비

14장 교체와 로그인한 상세·에디터·대표 미리보기 확인은 끝났다. 이 문서는 그 다음 유료 실행의 준비다. 이번 작성에서는 provider POST, 운영 대화 생성·변경, 원고·이미지 수정, 공개·알림을 하지 않았다.

편집 경로는 `/create?edit=51`이다. `/character/51/edit`는 라우트가 아니다.

## 1. 운영에 고정한 기준

읽기 전용으로 운영 DB를 직접 읽었다. 배포 health의 이전 확인 SHA는 `460adb6`이고, 이 준비 브랜치의 기준은 그 뒤의 `origin/main`이다. 캐릭터 행은 그 배포에 적용된 상태 그대로다.

| 항목 | 값 |
|---|---|
| 캐릭터 | #51 볼프강 폰 발켄하임 |
| draft | `pilot-rf-v4-02`, `staged_private` |
| `official` / `visibility` / `creator_id` | `0` / `private` / `1` |
| Text Lock | `599854610891ee4e09224d1bec863501227157584b66068f0e1cab5e0e1ca89c` |
| Appearance Lock | `1c3ccd134203a6dea6ae869c27cc443c42ff5498d1d0130c6f9765407c24dcc3` |
| 대표 참조 정책 | `representative_identity_and_style` |
| 참조 URL | `/uploads/official-pilot-rf-v4-02__rep-ext-6baa8d35-d1aa-4dfc-bf6e-04ead314cb2e.webp` |
| 참조 SHA-256 | `a95f9aca91a09a4bf1cd2e13bab5c0bd226f8972bb2bf60990a66891150f8032` |
| 14칸 | replacement `applied`. 태그는 아래 목록과 같고 옛 제목 태그는 저장 태그에 없다 |
| 키워드 로어북 | 8개, `entries_json` 합계 1,140자 |
| 계정 1 `selected_ai` | `gpt-6.1-sol` |
| 기존 채팅 784 | `character_id=51`, `gemini_model` 빈 문자열. 재사용하지 않는다 |

저장 태그: 기본 초상, 지도를 짚음, 턱을 괴고 생각, 열쇠를 확인함, 옅은 미소, 의심, 분노, 진지함, 당황, 편안함, 안도, 문서를 대조함, 기록을 맞춤, 긴장.

대표 참조 정책은 이후 이미지 생성의 identity/style 참조다. 이번 RP 턴의 화면 이미지 선택이 아니다.

### 실제 RP에 쓸 모델

새 채팅의 모델 owner는 `getUserChatSelectedAI`다. 계정 1의 저장값은 `gpt-6.1-sol`이고 provider는 `cheaperinference`다. 실행 직전에 이 값이 그대로인지 다시 읽고, 다르면 POST하지 않는다.

출력 설정은 기존 조립 owner 기준이다.

- `assemblePrimaryRpRequest` → `buildOpenRouterRequestBody` → `applyCheaperInferenceModelReasoningPolicy`
- `temperature` 0.7
- `reasoning` / `reasoning_effort` `low`
- `stream` true
- `max_tokens` 없음. `resolveMaxOutputTokensForTarget`는 RP에서 `undefined`다
- 스트림 글자 상한 owner `resolveStreamCharCap`는 `Number.MAX_SAFE_INTEGER`다
- 분량 목표는 `UNIFIED_TIER_AIM_CHARS` 3200이다. 상한이 아니다

가격 owner는 `publishedModelPricing`의 `gpt-6.1-sol`이다. 입력 $2 / 1M, 출력 $10 / 1M, cache read $0.10 / 1M, cache write $2.50 / 1M. `targetMargin` 0.45. 272,000 토큰 미만은 기본 단가다. 사용자 포인트는 이 표와 기존 청구 owner를 쓰고, 이번 준비에서 단가를 바꾸지 않는다.

### 태그가 최종 요청에 들어가는 경로

에셋 목록을 읽는 함수와 모델이 고른 뒤의 화면 연결은 다르다.

1. `chatAssets`가 채팅에 넣을 에셋을 고른다. 이것은 조회다.
2. `buildEmotionTagPrompt` / `buildFlashOwnedEmotionTagUserOverlay`가 그 태그 문자열만 사용자 턴 overlay에 넣는다. `contextBuilder`가 이 overlay를 최종 사용자 턴에 붙인다.
3. 모델이 `[태그: …]`를 쓰면 `resolveEmotionTag`가 허용 목록과 정확히 같은 문자열만 남긴다.
4. 화면 URL은 `resolveSelectableCharacterImages`와 인라인 태그 분할이 그 태그의 저장 URL로 연결한다.

운영 행으로 `assemblePrecallFinalWireWithSealedRequests`를 돌렸다. provider POST는 없다. 로어북 8개가 붙은 상태로는 이 owner가 `CREATOR_LOREBOOK_ATTACHED_UNSUPPORTED`로 멈춘다. 그래서 크기 측정은 로어북을 뺀 dry wire다. 라이브 채팅은 키워드가 맞는 로어북을 더할 수 있다. 원문 합계는 1,140자다.

그 dry wire의 `[DISPLAY ASSET TAG]` 구간에 새 태그 14개가 모두 있고, 옛 제목 태그 14개는 없다. 측정한 요청 본문 컨트롤은 `model=gpt-6.1-sol`, `temperature=0.7`, `reasoning.effort=low`, `reasoning_effort=low`, `stream=true`, `max_tokens` 없음이다.

PRECALL 유료 runner는 캐릭터 18·페르소나 렌 전용이다. #51 측정에 그 runner를 쓰지 않는다. 실행 시 최종 요청 조립은 운영 채팅의 `buildContext`와 `assemblePrimaryRpRequest`다.

dry wire의 입력 크기는 fixture 3종 기준 총 23,869–23,907자, owner 추정 21,483–21,517토큰(`ceil(chars * 0.9)`)이다. 시스템 프롬프트는 약 20,400자, contextBuilder 로그의 시스템 추정은 18,437토큰이다. 이 fixture 문장은 아래 4턴이 아니다. 4턴 사용자 문장은 더 짧다.

## 2. 고정 4턴

한 대화의 사용자 입력이다. 승인 원고의 시작점(위조 처형 명령, 집무실, 당직 병사, 봉인고 기록) 안에 둔다. 원하는 태그나 정답 대사를 넣지 않았다. 성인 장면이 아니다.

새 채팅만 쓴다. 채팅 784와 그 이전 운영 대화를 열거나 이어가지 않는다. 방의 성인 모드는 끈다. `resolveEffectiveAdultRp`는 사용자 성인 인증과 방의 성인 모드가 모두 켜져 있을 때만 성인 RP다. 페르소나는 계정 1의 페르소나 1 `렌`이다. 설명 840자에서 연인·부하·가족·상관·라이벌·아내·남편·약혼은 찾지 못했다. 설명 전문은 여기 적지 않는다.

1. `저는 명령서에 적힌 그 사람이 맞습니다. 죄목이 무엇인지, 인장이 있는 문서와 다른 기록이 왜 다른지는 모릅니다. 두 문서를 같이 보여 주십시오.`
2. `(문이 열리고 당직 병사가 봉인된 서류철을 들고 문간에 선다.) 저 병사가 무엇을 가져왔는지 저는 모릅니다. 저는 그 서류를 받지 않겠습니다.`
3. `이 방을 떠나지는 않겠습니다. 다만 무장 해제나 결박, 구금은 거절합니다.`
4. `처형 명령을 밖에 공개하지는 않겠습니다. 먼저 봉인고의 인계 기록을 대조하는 쪽을 택하겠습니다.`

검수 때 볼 기준이다. 프롬프트에 넣지 않는다. 원고에 없는 의무나 관계를 더하지 않는다.

- 사용자에게는 공식 심문의 존댓말, 당직 병사에게는 부하에게 쓰는 짧은 반말이 구분되는가.
- 무장 해제·결박·구금 거절을 무시하고 강제하지 않는가.
- 볼프강이 확인과 기록, 다음 조치를 스스로 진행하는가.
- 성격과 이미 원고에 있는 비밀·설정과 어긋나지 않는가.
- 고른 `[태그:]`가 위 14개 중 정확한 문자열이고, 화면 URL이 그 태그의 적용 파일인가. 어느 태그가 나와야 하는지는 정하지 않는다.

## 3. 실행 계획과 견적

호출은 4회다. 턴마다 POST 하나다. 자동 재시도, 재생성, 재추첨은 없다. 분량이 3200자에 못 미쳐도 같은 턴을 다시 호출하지 않는다. 실패하면 남은 턴을 호출하지 않는다. 이어서 할 때는 같은 새 채팅의 마지막으로 저장된 턴 다음만 진행하고, 실패한 생성은 다시 보내지 않는다.

입력은 1턴 약 21,500토큰에서 시작해, 응답이 길어지면 4턴째에 약 34,000토큰까지 늘 수 있다. 출력은 3200자 목표가 약 2,200토큰이고, 상한이 없으므로 견적은 턴당 4,000출력 토큰까지를 기본으로 본다. cache 할인은 예산에 넣지 않는다.

| 구분 | 계산 | 금액 |
|---|---|---|
| 입력 4턴 합, cache 없음 | 약 111,000 × $2 / 1M | $0.23 |
| 출력 4 × 4,000토큰 | 16,000 × $10 / 1M | $0.16 |
| 합계 |  | 약 $0.39 |
| 제안 예산 | 출력이 더 길어지는 경우 포함 | **$1.50** |

누적 provider 보고 비용이 $1.50 이상이면 다음 턴을 호출하지 않는다. 비용이 비어 있으면 그 턴을 성공으로 적지 않고 멈춘다.

보존:

- 응답 원문, 모델이 쓴 태그, usage, provider 비용은 새 채팅의 기존 메시지·영수증 owner에 남긴다.
- 렌더 결과는 그 태그의 저장 URL과 HTTP 상태다. 새 이미지를 만들지 않는다.
- 전체 wire와 페르소나 설명은 Git에 넣지 않는다. 캐릭터 18용 `/data/private-golden-fixtures`에도 쓰지 않는다. 이 dry wire는 메모리에서만 확인하고 파일로 남기지 않았다.

이 문서는 실행 승인이 아니다.
