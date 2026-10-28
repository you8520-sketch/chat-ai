# HAV 여성향 로판 자동 생성 G1 — 최초 원고 검수 패킷

**결과: 최초 원고 1명 확보 / 자동 QA 불합격·격리 / 품질 승인 대기.** 원고와 모델 응답은 수정하지 않았다. 재생성·등록·공개·이미지 생성·운영 DB 쓰기는 실행하지 않았다.

실측: **2026-10-27 00:43:47–00:52:34 KST**. 증거 정리: 2026-10-28 KST.

## BEFORE

- 전달된 기준 main은 `1414abf105ab2ef8e7a387530125cbf28628a82a`였다. 실행 전 최신 main은 그 직계 후속인 `9405606e504dce4f9de88e69b0aed68b1a33e92d`(#1732 병합)로 확인했다. A1의 `author.ts`와 `official-supply-pilot-author.ts`는 두 SHA에서 동일했다.
- 최신 코드의 Railway 배포 SUCCESS와 컨테이너의 전체 `RAILWAY_GIT_COMMIT_SHA`를 확인한 후 실행했다. 이번 작업에서 병합·배포·Railway 변수 변경을 하지 않았다.
- 현행 생성 모델 **`gpt-6-luna`**, provider **CheaperInference**. `OFFICIAL_AUTHOR_MODEL`은 미설정이며 기존 background resolver를 그대로 사용했다. `/v1/models` 인증 조회 HTTP 200. 카탈로그 기본 입력 **$0.065/M**, 출력 **$0.325/M**, cache write **$0.1625/M**를 확인했다.
- 기존 owner: `scripts/official-supply-pilot-author.ts` → `generateOfficialCharacterBible` → `liveOfficialAuthorTransport` → `callBackgroundMemory` → `callOpenRouterCompletion`; 비용은 기존 provider usage parser와 accounting owner를 사용한다.
- 스크립트에 별도 신규 브리프 입력 경로가 없으므로, 미공개 기존 슬롯 **pilot-rf-07**을 격리 복사본에서 처음부터 재생성했다. 따라서 **기존 콘셉트의 신규 생성 원고 실측**이다. 완전히 새로운 콘셉트를 만든 실험이 아니다.
- 브리프 상태는 `asset_plan_locked`, `staged_character_id=null`로 읽기 전용 확인했다. #50 루시안과 #51 볼프강을 대상으로 하지 않았다.
- World / 시장 리서치 snapshot / Market Fit / Brief는 기존 입력을 재사용했다. 유료 World·Brief 재생성은 없었다. 이어서 현행 Part1 → Voice → Bonds → Bible → Compile → QA를 실행했다.

```sh
OFFICIAL_PILOT_LIVE=1 node --conditions=react-server --import tsx \
  --import ./g1-observe.ts scripts/official-supply-pilot-author.ts \
  --step=character --slot=7 --attempts=1
```

원격 `/app`의 소스·스크립트를 `/tmp/hav-g1.yTxPu2`에 복사하고 dependencies만 링크한 기존 격리 방식을 사용했다. `.env.local`과 운영 DB는 복사하지 않았다. 실행 자식 프로세스의 DATA_DIR은 해당 임시 디렉터리의 새 DB이고 remote DB 설정은 비웠다. 기존 10개 캐릭터 파일은 별도 baseline에 보존했다. 관측 코드는 실제 요청을 수정하지 않고 기본 3회와 기존 Voice 보정 최대 2회의 요청·원응답만 기록했다. NPC repair는 OFF, 전체 workflow 재시도는 0회다.

보수적 사전 비용 상한은 최대 5 POST·42,000 출력 토큰·요청당 80,000 UTF-8 prompt bytes를 모두 사용하는 조건에서 **$0.07865 / 약 106.21원**이었다. 입력·출력 분량이나 문체 설정은 바꾸지 않았다.

## GENERATED

- **테오 / 남성 / 28세 / 인간 / 181cm / 황실 마도공학 현장 총책임자**.
- 세계: 기존 에테르노스 제국. 경험 축: 능력 의존·공동 생존·현장 책임자와의 위험한 공동 작업.
- 최초 tagline: **“황실 현장 책임자 테오, 당신의 공명 없이는 핵을 살릴 수 없다”**.
- 구조화 secrets, NPC, 다른 캐릭터 관계 배열은 각각 0개다. 별도 인물을 자동으로 채우거나 비밀을 추가하지 않았다. 과거·현재 상황에 서술된 설계 책임과 비공개 정보의 정합성은 GPT 검수 대상이다.

**우선 검수할 최초 원문:**

1. [first-manuscript.md — 최초 3응답·첫 Bible·컴파일 입력층·QA 전문](first-manuscript.md)
2. [first-generation.json — 최초 응답 문자열·Bible·Draft 전체](first-generation.json)
3. [compiled-main-rp-character-first.txt — 실제 정본 owner로 조립한 캐릭터 설정 입력층](compiled-main-rp-character-first.txt)
4. [compiled-first.json — 컴파일 JSON·runtime canon·speech examples 전체](compiled-first.json)
5. [canon-review-first.json — 현행 canon 검수 증거, 의미·품질 승인 없음](canon-review-first.json)

원문 파일의 `rawTexts`는 provider의 `choices[0].message.content`를 그대로 보존한 값이다. Bible은 기존 assembler가 최초 Part1·Voice·Bonds 응답을 기계적으로 조립한 결과다. 사람이 문장을 고치거나 설정을 덧붙이지 않았다. 도입부 greeting, 공개 상세 소개, 짧은 소개, 제작자 코멘트, 말투·대사 예시, selfDrive와 과거 인과 정보는 위 전문에 모두 들어 있다.

[provider-responses](provider-responses)의 5개 JSON은 원응답 바이트를 보존했다. [provider-requests](provider-requests)는 실제 outbound body이며 인증 헤더를 포함하지 않는다. 1–3번이 최초 생성, 4–5번은 기존 파이프라인의 자동 Voice 보정이다. 보정 후 결과는 [automatic-final-reconstructed.json](automatic-final-reconstructed.json)으로 분리했다. 이 파일은 실제 저장 성공본이 아니라 캡처된 보정 응답을 기존 owner에 오프라인 재생해 복원한 격리 후보다. 두 보정의 조립 입력이 캡처된 실제 요청과 동일함을 대조했다.

## QA

| 항목 | 최초 후보 | 자동 보정 후 / 해석 |
|---|---|---|
| validateCharacterBible | FAIL: 짧은 소개 194자, 기준 200–500자 | PASS: 최종 235자 |
| 관계·selfDrive | PASS | PASS |
| 공개 상세 소개 / 제작자 코멘트 | PASS / PASS | 해당 원고 유지 |
| 성별 중립 자동 검사 | PASS | 자연스러운 유저 권한·행동까지 보장하는 문학적 승인 아님 |
| Text Lock 상당 Draft QA | FAIL: sfw_public_text_has_adult_terms | 동일 사유 FAIL, 실제 Text Lock 생성 안 함 |
| 저장 길이 / RP 설정 상한 잘림 | PASS / 0자 | 0자는 상한 잘림만 의미함 |
| 기존 World Bible / 지역 일관성 | PASS / PASS | 기존 World 입력 재사용 |
| 선택 브리프 Market Fit / discovery tags | PASS / PASS | 시장 흥행·매력 점수 아님 |
| 10슬롯 전체 Market Fit metadata | FAIL | 기존 7개 슬롯의 marketFit 누락; 이번 신규 원고 결함과 분리 |
| 리서치 snapshot 대비 독창성 검사 | PASS | 최신 시장 조사나 창작 독창성의 최종 승인 아님 |

자동 Voice 보정은 `publicProfile.description`에 한정됐다. **194자 → 1차 보정에서 필드 누락으로 0자 → 2차 보정에서 235자**였다. 1차 보정 응답은 `speech`만 반환했으며, 기존 owner의 조립 결과가 빈 소개로 바뀌었다. 이 결함도 원응답 그대로 보존했다. 모델이 보정 응답에 다른 필드를 함께 반환했더라도 기존 owner가 선택한 짧은 소개 이외에는 반영하지 않았다.

최종 차단의 직접 원인은 공개 상세 소개의 다음 정상 문장이다.

> 사람을 소모품으로 보지 않으려 위험을 먼저 떠안지만, 시간이 촉박하면 상대의 동의를 기다리지 않고 조치하는 버릇이 있다.

현재 `findAdultTermsInText`의 부분 문자열 검사에서 일반 동사 **‘보지’**가 같은 문자열의 성인 금칙어와 일치했다. 캡처된 첫 상세 소개는 두 Voice 보정에서도 바뀌지 않았고 최종 격리를 일으켰다. 이 매칭은 성행위 묘사의 존재를 증명하지 않는다. 이번에는 금칙어·QA·원문 어느 것도 수정하지 않았다.


Text Lock 후보 해시(승인·저장 아님): `8e325a8b7a2be06a65b2d976857171a9eaa6011c6b6ac42965818cd1483576e6`. 자동 보정은 Draft에 쓰이지 않는 짧은 소개만 변경했으므로 보정 후 후보 해시도 동일하다.

전체 결과는 [qa-first.json](qa-first.json), 최종 격리 경로는 [generation.log](logs/generation.log), 자동 보정 재구성은 [automatic-final-reconstructed.json](automatic-final-reconstructed.json)에 있다. 최초 경고에는 외형 서술 798자(권장 250–500), 행동 서술 coverage 키워드, 총 분량·말투 분량의 soft band가 포함된다. 자동 검사 통과를 RP 문체·상품성 승인으로 취급하지 않는다.

## COST

| 호출 | 작업 | 입력 토큰 | 출력 토큰 | provider 정산 USD |
|---|---|---:|---:|---:|
| 1 | Part1 | 3,404 | 3,145 | $0.001298 |
| 2 | Voice | 4,451 | 3,141 | $0.001310 |
| 3 | Bonds | 2,908 | 527 | $0.000407 |
| 4 | Voice 자동 보정 1 | 3,505 | 2,104 | $0.000968 |
| 5 | Voice 자동 보정 2 | 3,383 | 2,107 | $0.000904 |
| 합계 | **5회** | **17,651** | **11,024** | **$0.004887** |

모든 호출은 HTTP 200, provider billing 상태는 `settled`다. 전체 workflow attempt는 1회, 전체 재시도 0회, provider 실패 0회, NPC repair·이미지·추가 모델 평가 호출 0회다. API 응답 성공 5건과 최종 원고 QA 불합격을 구분한다.

실행 당시 기존 환율 owner: 1 USD = 1,323.904108 KRW, 수수료 반영 effective rate = 1,350.38219016 KRW. **정산된 $0.004887을 환산하면 약 6.60원**이다. 원화는 이 owner snapshot을 적용한 환산액이며 별도 카드 청구서를 조회한 값은 아니다.

[cost-usage.json](cost-usage.json)은 실제 캡처된 provider 사용량·정산 금액을 현행 `parseCompatibleUsage`와 `withAuthorAccounting`로 다시 집계한 증거다. 재생은 network를 차단하고 수행했으며 유료 호출을 추가하지 않았다. 원격 `cost.json` 자체는 터미널 충돌·도구 연결 중단으로 확보하지 못했다. provider 정산 응답 5건과 HTTP 영수증은 모두 확보했고, parser 결과와 각 응답의 settled USD가 일치함을 확인했다.

## RISKS

- **자동 제작 합격이 아니다.** 첫 원고는 확보했지만 최종 Draft QA에서 격리됐고 승인·등록·공개할 수 없다. 문학·시장성 점수를 매기지 않았다.
- **0자 상한 잘림은 정보 완전 보존과 다르다.** [preservation-first.json](preservation-first.json)은 원문과 캐릭터 입력층의 문자 대조다. 공백·문장부호를 제외하면 검사한 43개 문자열 중 26개가 확인됐다. 나머지는 외형 14개 필드와 능력 level 3개 문장이다. Appearance Lock은 이번 단계에서 생성하지 않았으므로 세부 외형 블록이 비어 있다. 능력 level 문장이 다른 scope/usage/현재 상황과 의미상 중복되는지, 중요한 정보가 빠지는지는 GPT가 원문과 컴파일을 대조해야 한다. 이 수치는 문학 점수나 의미 손실 확정 수치가 아니다.
- 제공된 RP 텍스트는 실제 정본 compile/save/parser owner로 조립한 **캐릭터 설정 입력층**이다. 운영 저장과 실제 Main RP 모델 호출은 하지 않았으므로 사용자 페르소나·대화·기억·최종 buildContext 전체를 포함하는 live wire는 아니다.
- 시장 적합성은 기존 2026-09 snapshot과 기존 Brief를 재사용했다. 최신 시장 조사나 새 World/Brief 작성 실험이 아니다. 10슬롯 전체 metadata 검사는 기존 7개 입력 누락으로 완전 통과하지 못했다.
- 기존 10개 파일의 원격 사전 SHA와 동일 실행 SHA의 로컬 원본·baseline SHA가 모두 일치한다. 원격 실행은 별도 복사본만 쓰도록 제한했다. 터미널이 다른 탭에 연결된 후 명령 입력을 멈췄고, 이후 Work 브라우저 transport가 끊겼다. 따라서 별도의 원격 사후 10파일 스냅샷 및 운영 DB 재조회는 미확보다. [보존 범위](metadata/original-file-preservation.json)를 과장하지 않았다.
- 원격에서 공유 터미널 문제가 생긴 뒤에는 신규 생성·재호출·운영 변경을 하지 않았다. 보존된 원문에 대한 무료 오프라인 QA만 같은 고정 소스로 수행했다.

## EVIDENCE

- [최초 원고 Markdown 전문](first-manuscript.md) / [최초 생성 JSON 전문](first-generation.json)
- [World 입력](inputs/world-bible.json) / [Brief 입력](inputs/brief.json)
- [실행 코드·격리·가격 사전 검증](metadata/preflight.json) / [실행 시점과 범위](metadata/execution.json)
- [실제 요청](provider-requests) / [원응답](provider-responses) / [HTTP 영수증](http)
- [관측 코드](audit/observer-source.txt) / [무료 QA 호출 코드](audit/offline-qa-source.txt) / [보정·비용 오프라인 재생](audit/replay-audit-source.txt)
- [파일별 SHA256 및 Git blob SHA](manifest.json)

이 증거 브랜치에는 허구 캐릭터 생성 입력·출력과 검증 자료만 올린다. API 키·인증 헤더·관리자 인증 정보·개인 데이터·운영 DB·이미지는 포함하지 않는다. 런타임 코드와 기존 원고는 변경하지 않고 기능 PR도 만들지 않는다.

## NEXT

**GPT가 먼저 first-manuscript.md와 first-generation.json을 읽고 여성향 로판 매력, 인과성, 목소리, 한국어, 도입부, 유저 권한, 비밀·세계관 일관성, 반복·메타규칙, 공개 상품성, 컴파일 정보 보존을 검수해야 한다.** 보정 후 자료는 최초 결과와 구분해 참고한다.

이번 제출은 품질 승인이나 수정·등록 승인 요청을 대신하지 않는다. 후속 코드 수정, 유료 재시험, Text Lock 승인, 캐릭터 등록·공개는 이번 실행에서 진행하지 않는다. **G1 원문 확보와 증거 제출 후 STOP.**
