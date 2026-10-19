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

`CREATOR_LOREBOOK_ATTACHED_UNSUPPORTED`는 PRECALL 도구가 로어북이 붙은 캐릭터를 거부하는 제한이다. 운영 채팅 장애가 아니고, 로어북을 뺀 요청을 운영과 같은 조건으로 보지 않는다. PRECALL 거부 검사는 그대로 둔다. PRECALL 유료 runner는 캐릭터 18·페르소나 렌 전용이라 #51 측정에 쓰지 않는다.

### 1턴 실제 요청

운영 DB는 읽기만 하고, 컨테이너 `/tmp`에 `app.db`와 WAL, SHM을 복사한 뒤 로컬 격리 사본에서 조립했다. 운영 대화는 만들지 않았다. 배포 SHA는 `4cd12f63`이다. 이 브랜치의 런타임과 그 배포의 차이는 episodic recall 파일이고, 1턴은 저장된 episodic fact가 0이라 그 차이가 프롬프트에 더해지지 않았다.

진입은 함수 호출이 아니라 격리 서버의 `POST /api/chat`이다. 계정 1 세션, 캐릭터 51, 페르소나 1, `adultHandoffEnabled: false`, 아래 1번 문장. `MOCK_MODE=1`이 완료 본문을 만든 뒤 HTTP를 나가지 않게 하고, 그 앞에서도 외부 `fetch`는 예외로 막았다. chat completions POST는 0이다. 카탈로그 `GET /v1/models` 한 번이 시도됐고 차단됐다. 생성 POST가 아니다.

로어북 8개, 항목 8개는 부착된 그대로다. 키워드 규칙으로 주입된 것은 3개이고, 모두 인사말 쪽 `recent_raw` 일치다. 1번 사용자 문장 자체의 일치는 아니다.

| 로어북 id | entry key | 키워드 | 본문 길이 |
|---|---|---|---|
| 3 | `entry_e180nt` | 황실 | 90자 |
| 4 | `entry_tlrjcq` | 발켄하임 | 83자 |
| 7 | `entry_j4asfx` | 북부 방벽 | 78자 |

최종 사용자 턴의 키워드 로어북 블록은 1,614자다. contextBuilder의 dynamic lore prefix 추정은 283토큰이다. 본문은 여기 적지 않는다.

최종 요청 컨트롤은 `model=gpt-6.1-sol`, `temperature=0.7`, `reasoning.effort=low`, `reasoning_effort=low`, `stream=true`, `stream_options.include_usage=true`다. `max_tokens` 키는 없다. 길이 모드 로그는 3200이다. 메시지는 4개다. 시스템 3블록 20,404자, contextBuilder 추정 18,437토큰. 마지막 사용자 턴 1,944자. 그 안의 `[DISPLAY ASSET TAG]` 허용 목록은 새 태그 14개뿐이고 각 1회다. 직렬화한 요청은 24,786자, `estimateTokens` 22,308토큰이다. 페르소나 전문과 로어북 본문은 공개 Git에 두지 않는다.

로어북을 빼고 잰 fixture 측정(23,869–23,907자, 21,483–21,517토큰)은 참고값이다. 그 문장은 이 4턴이 아니다.

2–4턴은 응답이 없으므로 wire를 미리 확정하지 않는다. 실행 때 각 턴의 전송문은 기존 `PROMPT_DEBUG=1`이 `dumpOpenRouterRequest`로 남기는 `debug/prompt_dump.txt`와 `debug/token_breakdown.json`으로 보존한다. 운영의 현재 값은 `PROMPT_DEBUG=0`이라, 승인된 실행 구간에만 켜고 파일을 로컬 비공개 경로로 복사한 뒤 다시 끈다. 그 파일은 Git에 넣지 않는다.

## 2. 고정 4턴

한 대화의 사용자 입력이다. 승인 원고의 시작점(위조 처형 명령, 집무실, 당직 병사, 봉인고 기록) 안에 둔다. 원하는 태그나 정답 대사를 넣지 않았다. 성인 장면이 아니다.

새 채팅만 쓴다. 채팅 784와 그 이전 운영 대화를 열거나 이어가지 않는다. 방의 성인 모드는 끈다. `resolveEffectiveAdultRp`는 사용자 성인 인증과 방의 성인 모드가 모두 켜져 있을 때만 성인 RP다. 페르소나는 계정 1의 페르소나 1 `렌`이다. 설명 840자에서 연인·부하·가족·상관·라이벌·아내·남편·약혼은 찾지 못했다. 설명 전문은 여기 적지 않는다.

1. `저는 명령서에 적힌 그 사람이 맞습니다. 죄목이 무엇인지, 인장이 있는 문서와 다른 기록이 왜 다른지는 모릅니다. 두 문서를 같이 보여 주십시오.`
2. `(문이 열리고 당직 병사가 봉인된 서류철을 들고 문간에 선다.) 저 병사가 무엇을 가져왔는지 저는 모릅니다. 저는 그 서류를 받지 않겠습니다.`
3. `이 방을 떠나지는 않겠습니다. 다만 무장 해제나 결박, 구금은 거절합니다.`
4. `처형 명령을 밖에 공개하지는 않겠습니다. 먼저 봉인고의 인계 기록을 대조하는 쪽을 택하겠습니다.`

검수 때 볼 기준이다. 프롬프트에 넣지 않는다. 원고에 없는 의무나 관계를 더하지 않는다.

- 사용자에게는 공식 심문의 존댓말, 당직 병사에게는 부하에게 쓰는 짧은 반말이 구분되는가.
- 사용자의 행동, 내면, 동의, 복종을 모델이 대신 확정하는가. 거절 뒤에도 사용자가 다음 행동을 고를 여지가 있는가. 볼프강의 반대, 명령, 대응은 승인 원고와 그 장면으로 따로 본다. 거절하면 캐릭터가 물러나야 한다는 기준으로 채점하지 않는다.
- 볼프강이 확인과 기록, 다음 조치를 스스로 진행하는가.
- 성격과 이미 원고에 있는 비밀·설정과 어긋나지 않는가.
- 고른 `[태그:]`가 위 14개 중 정확한 문자열이고, 같은 턴의 화면 이미지가 그 태그인가. 어느 태그가 나와야 하는지는 정하지 않는다. 태그가 없거나 장면과 맞지 않으면 실패 또는 미확인이다.

## 3. 실행 경로

승인 후 진입은 로그인한 계정 1의 브라우저다. `#51`에서 새 채팅을 연다. 페르소나는 `렌`, 방의 성인 모드는 끈다. 모델은 계정 저장값 `gpt-6.1-sol`만 허용한다. 실행 직전에 저장값이 다르거나 Text Lock, Appearance Lock이 위 표와 다르면 POST하지 않는다. 채팅 784는 열지 않는다.

브라우저가 호출하는 owner는 운영 `POST /api/chat`이다. 서버가 `buildContext` 뒤에 `streamOpenRouterAdult` → `assemblePrimaryRpRequest`로 본문을 만든 다음 한 번 전송한다. `gpt-6.1-sol`은 DeepSeek failover 대상이 아니다. 메인 RP는 시도 1회이고, 빈 스트림이나 거절도 같은 턴의 두 번째 완료 POST로 이어가지 않는다.

RP 4턴과 provider POST 총수는 다르다. 캐릭터 51에는 상태창 정의가 있고, 새 채팅의 엔진 기본값은 `character_only`다. 메인 응답이 저장된 뒤에 `resolveStatusWidgetTurnValues`가 `gpt-6-luna` 공유 호출을 한 번 한다. 관계 메모, 추천 답장, episodic 구간은 그 호출에 실린다. 별도 관계 추출 POST로 다시 나가지 않는다. 이 준비의 mock 응답은 길이 가드에서 버려져 그 Luna 호출까지는 실행되지 않았다. 성공한 라이브 턴에서는 실행된다.

에피소드 요약 봉인은 5턴 간격이고, 방금 끝난 창은 다음 요청에서 봉인된다. 4턴에서 멈추면 요약 완료 POST는 없다. 시맨틱 인덱스가 생기기 전 1턴 질의 임베딩은 `no_usable_index`로 나가지 않았다. 운영은 `EPISODIC_SEMANTIC_DISCOVERY_ENABLED=1`, 모델 `baai/bge-m3`다. 이후 턴에서 fact가 쓰이면 인덱스 또는 질의 임베딩 POST가 더 생길 수 있다. 그 단가는 `publishedModelPricing`에 없다. 비용이 비거나 실패하면 다음 호출을 하지 않는다.

그래서 승인 범위는 메인 4회에 더해, 성공 턴마다 Luna 1회, 그리고 생길 수 있는 임베딩 POST다. 재생성, 재추첨, 원하는 태그를 입력에 넣는 일은 승인에 없다. 분량이 3200자에 못 미쳐도 같은 턴을 다시 호출하지 않는다. 출력 상한은 넣지 않는다.

## 4. 견적

1턴 측정 입력은 22,308토큰이다. 이후 턴은 저장된 응답만큼 입력이 커진다. 출력은 3200자 목표가 약 2,200토큰이고, 상한이 없으므로 메인 견적은 턴당 4,000출력 토큰까지를 본다. 4턴 입력 합은 약 111,000토큰으로 두고 cache 할인은 빼지 않는다. 단가는 `publishedModelPricing`의 `gpt-6.1-sol`이다.

| 구분 | 계산 | 금액 |
|---|---|---|
| 메인 입력 4턴, cache 없음 | 약 111,000 × $2 / 1M | $0.23 |
| 메인 출력 4 × 4,000토큰 | 16,000 × $10 / 1M | $0.16 |
| 메인 합계 |  | 약 $0.39 |
| Luna 4회 | `openRouterModelPricing` 폴백 입력 $0.07 / 1M, 출력 $0.35 / 1M. 라이브 카탈로그가 있으면 그 단가. 호출 크기는 미측정 | 메인 합계보다 작을 것으로 보나 미측정 |
| 제안 중단선 | 누적 정산 후 다음 호출을 멈춤 | **$1.50** |

$1.50은 진행 중인 무제한 출력의 청구 상한이 아니다. 한 턴의 완료가 끝난 뒤 provider가 보고한 누적이 $1.50 이상이면 다음 POST를 하지 않는다. usage나 비용이 비어 있거나 생성이 실패하면 그 턴을 성공으로 적지 않고 멈춘다. 사용자 포인트 단가와 3200+ soft target은 바꾸지 않는다.

## 5. 에셋 전환 증거

합격은 저장 URL의 HTTP 200이 아니다. 턴마다 다음을 한 줄로 잇는다.

1. 모델 원문 그대로의 `[태그: …]`.
2. 저장 본문에서 `resolveEmotionTag`가 남긴 태그. 허용 목록과 글자가 다를 때 남는 값.
3. 그 채팅 화면이 실제로 그린 이미지와 브라우저가 요청한 URL.

확인은 로그인한 그 새 채팅에서 한다. 세션이 끊기면 같은 브라우저의 로그인 인계를 요청하고, 다른 계정으로 바꾸지 않는다. 태그가 없거나 장면과 맞지 않으면 실패 또는 미확인으로 적고, 입력을 고치거나 다시 뽑지 않는다.

## 6. 승인안

이번 문서는 아직 실행이 아니다. 승인되면 위 브라우저 경로로 새 채팅 4턴만 진행한다. 범위는 메인 `gpt-6.1-sol` 4회, 성공 턴의 `gpt-6-luna` 상태창 공유 호출, 그때 실제로 발생하는 임베딩 POST, 그리고 실행 구간의 `PROMPT_DEBUG=1` 보존이다. 누적 정산 $1.50, 비용 미확인, 실패 중 하나이면 다음 호출을 멈춘다. 이미지, 원고, 공개 상태는 그대로 둔다.
