# Main RP — run3 vs run5 실제 출력 원문

문서·증거 전용 자료다. 코드, 설정, 운영 데이터는 포함하지 않는다.

## 대상

- 장면: `A_relationship_emotion` (Main RP, 캐릭터 18 라이크 / 페르소나 1 렌)
- 모델 4종: `deepseek-v4.1-flash`, `gemini-3.8-flash`, `gpt-6.1-sol`, `claude-opus-5.5`
- 각 `.txt`는 provider가 반환한 가시 출력 원문 전문이다. 오탈자, 문장, 줄바꿈, 태그를 수정하거나 축약하지 않았다. UTF-8 (BOM 없음), LF.

## Run

| 구분 | run ID (manifest fingerprint) | production SHA | 장면 진행(pacing) 조건 |
| --- | --- | --- | --- |
| BEFORE (run3) | `6f6984a386731000822b6fb20d8d0725f499fa0f67cfb71546d6a6e71df2b039` | `da69756ede83e7790e8f7293a1157c4cff102373` | 조용한 장면에서도 `ESCALATE` 강제 (#1587 이전) |
| AFTER (run5) | `36001f4ecb84faaf8abcc9a84ce52560e94b8c3c720466435681f45db262fc9f` | `59fb6ddcef30966588281220509a593d8ef6ff94` | `MICRO_MOTION` / `DYAD` (#1587 이후) |

두 run 모두 4개 모델이 `SETTLED` 상태로 완료되었다.

## 원문 파일과 검증된 SHA-256

SHA-256은 저장소에 커밋된 파일 바이트에서 계산했고, 해당 run의 Journal `artifactFingerprint` 및 `visibleChars`와 모두 일치했다.

### BEFORE — run3

| 모델 | 파일 | 전체 글자 수 | 한글 음절 수 | SHA-256 |
| --- | --- | ---: | ---: | --- |
| DeepSeek V4.1 Flash | [BEFORE_run3_deepseek-v4.1-flash.txt](BEFORE_run3_deepseek-v4.1-flash.txt) | 3,374 | 2,282 | `78cd2be6dea66795c58770c49c3682026ec9ba9021d7ae5405a79b772e6c852a` |
| Gemini 3.8 Flash | [BEFORE_run3_gemini-3.8-flash.txt](BEFORE_run3_gemini-3.8-flash.txt) | 4,074 | 2,867 | `c6af438bab15e74c556ee253e74393e9f28d1f0d4c8d173f1eca5f116adf22ad` |
| GPT-6.1 Sol | [BEFORE_run3_gpt-6.1-sol.txt](BEFORE_run3_gpt-6.1-sol.txt) | 4,241 | 2,964 | `17a681c6fbdd5769959d521d1bc419c36a9b31e71e492eb86bf6fec69decfffb` |
| Claude Opus 5.5 | [BEFORE_run3_claude-opus-5.5.txt](BEFORE_run3_claude-opus-5.5.txt) | 3,040 | 2,089 | `69532ace133ec2fd40e39c4ac6d218595fba6ec33b2df64199c091d9b47c82cc` |

### AFTER — run5

| 모델 | 파일 | 전체 글자 수 | 한글 음절 수 | SHA-256 |
| --- | --- | ---: | ---: | --- |
| DeepSeek V4.1 Flash | [AFTER_run5_deepseek-v4.1-flash.txt](AFTER_run5_deepseek-v4.1-flash.txt) | 2,727 | 1,841 | `19b68ad4a2f495c710adafe5e97945157a97ee7f91b66b4ac2cb27021bd1e6f3` |
| Gemini 3.8 Flash | [AFTER_run5_gemini-3.8-flash.txt](AFTER_run5_gemini-3.8-flash.txt) | 4,399 | 3,123 | `f15cde5fd34531df153f29a66f6460b37f5dccf4a84209d57d09e07d9b8b12d2` |
| GPT-6.1 Sol | [AFTER_run5_gpt-6.1-sol.txt](AFTER_run5_gpt-6.1-sol.txt) | 3,973 | 2,778 | `abfac3e66336bbe594a416b0364ee1852eed84126656cc708985b9f56e119b0e` |
| Claude Opus 5.5 | [AFTER_run5_claude-opus-5.5.txt](AFTER_run5_claude-opus-5.5.txt) | 3,395 | 2,348 | `f0bb84bb67094c5454d14976c23c40b0c6ac853dc352ffc6e63d77e2e458df91` |

## 출력 길이 전후 비교 (전체 글자 수)

| 모델 | BEFORE | AFTER | 증감 |
| --- | ---: | ---: | ---: |
| DeepSeek V4.1 Flash | 3,374 | 2,727 | -647 (-19.2%) |
| Gemini 3.8 Flash | 4,074 | 4,399 | +325 (+8.0%) |
| GPT-6.1 Sol | 4,241 | 3,973 | -268 (-6.3%) |
| Claude Opus 5.5 | 3,040 | 3,395 | +355 (+11.7%) |

## GPT 평가 항목

문체 점수와 품질 합격 여부는 Cursor가 판단하지 않는다. 아래 항목은 GPT가 원문을 직접 읽고 평가한다.

1. 조용한 장면에서 불필요한 사건·고조(escalation)가 사라졌는가.
2. 사용자의 입력과 장면 분위기에 맞는 속도로 진행되는가.
3. 캐릭터 음성과 관계 감정의 일관성.
4. 문장 품질: 반복, 어색한 표현, 설명 과잉, 모델별 문체 차이.
5. 태그·형식 규칙 준수.
6. 길이 변화가 품질에 미친 영향 (과소 또는 과다).
7. 모델별 전후 차이와 어느 모델이 개선, 유지, 악화되었는가.

## VERIFY — post-#1612 A-scope reseal (`08711b9d`)

#1602 / #1595 입력이 반영된 최신 canonical seal(#1612)을 배포 SHA `08711b9d97d2309f26f5ca7631a26b28f9fe55b1`에서 재조립했다. 12호출 body/wire는 봉인과 일치했고, 판정은 `EXPECTED_DEPLOY_SHA_ROTATION`이었다. 기존 검증 경로로 라이크·렌 A 장면 4모델을 각 1회 실행했다. Gemini 4 Argon은 선택 목록에만 있고 이번 실행에는 넣지 않았다.

| 항목 | 값 |
| --- | --- |
| Railway | SUCCESS, 컨테이너 SHA `08711b9d97d2309f26f5ca7631a26b28f9fe55b1` |
| 사용자 선택 모델 | 5 (DeepSeek / Gemini 3.8 / GPT-6.1 Sol / Opus 5.5 / Gemini 4 Argon) |
| 품질 검증 모델 | 4 (`MAIN_RP_QUALITY_BENCHMARK_MODEL_IDS`) |
| PRECALL | 12호출 (Gemini 4 없음) |
| A-scope manifest fingerprint | `fe446e442c0218c8fa711aade78fe6db76c83ab0cf915135a20f09a653957d21` |
| identity hash | `5f400d361ffd7eba0747cada89726d43ee38a36677768beac048c8732af02ded` (변경 없음) |
| seal verdict | `EXPECTED_DEPLOY_SHA_ROTATION` (12/12 body·wire 일치) |
| Provider POST | 4 (retry 0) |
| 정산 | 4회 모두 `SETTLED` / `provider_exact` |
| 합계 billed USD | 0.207194 (약 290원, 1 USD = 1,400원 가정) |

### 원문 파일과 검증된 SHA-256

SHA-256은 저장소에 커밋된 파일 바이트에서 계산했고, 해당 run Journal `artifactFingerprint` 및 `visibleChars`와 모두 일치했다. 대사 블록 수는 `extractDialogueBlockSpans` 집계이며 품질 점수가 아니다.

| 모델 | 파일 | 전체 글자 수 | 한글 음절 수 | 대사 블록 | SHA-256 |
| --- | --- | ---: | ---: | ---: | --- |
| DeepSeek V4.1 Flash | [VERIFY_08711b9d_deepseek-v4.1-flash.txt](VERIFY_08711b9d_deepseek-v4.1-flash.txt) | 2,811 | 1,884 | 13 | `6c12b8d1dded3725d189e4f34352dc5185b64bab26e53a56a10988c988a27b82` |
| Gemini 3.8 Flash | [VERIFY_08711b9d_gemini-3.8-flash.txt](VERIFY_08711b9d_gemini-3.8-flash.txt) | 4,796 | 3,348 | 13 | `290e75c608dee5df5f95d679f82542228114151261575119a2e875db52230344` |
| GPT-6.1 Sol | [VERIFY_08711b9d_gpt-6.1-sol.txt](VERIFY_08711b9d_gpt-6.1-sol.txt) | 4,186 | 2,921 | 4 | `869856d45fc77cc35ae73722a9f40f59b25348debe6b113f7240228ca2dc7aca` |
| Claude Opus 5.5 | [VERIFY_08711b9d_claude-opus-5.5.txt](VERIFY_08711b9d_claude-opus-5.5.txt) | 3,819 | 2,635 | 6 | `8b781196366a434643977da1916948bfc2867ea47650e86455906cbf29db6255` |

### 토큰·비용·시간

| 모델 | prompt | completion | cache read | cache write | reasoning | billed USD | elapsed ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DeepSeek V4.1 Flash | 8,035 | 2,176 | — | — | — | 0.001255 | 16,652 |
| Gemini 3.8 Flash | 12,028 | 3,125 | 10,487 | — | — | 0.007049 | 37,664 |
| GPT-6.1 Sol | 12,502 | 2,699 | — | 12,499 | 25 | 0.039628 | 69,550 |
| Claude Opus 5.5 | 20,109 | 5,109 | — | 14,595 | — | 0.159262 | 72,219 |

Cursor는 문체 점수를 매기지 않는다. GPT가 위 원문을 읽고 기존 평가 항목으로 판단한다.

## VERIFY — post-#1616 DeepSeek axis line (`65119ae9`)

#1618 봉인이 반영된 운영 SHA `65119ae9eecf493b3922923863813203de94013a`에서 기존 production live paid-runner로 라이크·렌 A 장면을 재실행했다. 12호출 body/wire는 #1618 정본과 일치했고, 배포 SHA 회전만 `EXPECTED_DEPLOY_SHA_ROTATION`이었다. Gemini 4 Argon은 호출하지 않았다. 장면·캐릭터 18·페르소나 렌·A-scope 자극은 `VERIFY_08711b9d`와 같다.

| 항목 | 값 |
| --- | --- |
| origin/main = Railway SUCCESS = 컨테이너 SHA | `65119ae9eecf493b3922923863813203de94013a` (#1618) |
| 사용자 선택 모델 | 5 (DeepSeek / Gemini 3.8 / GPT-6.1 Sol / Opus 5.5 / Gemini 4 Argon) |
| 품질 검증 모델 | 4 (`MAIN_RP_QUALITY_BENCHMARK_MODEL_IDS`) |
| PRECALL | 12호출 (Gemini 4 없음) |
| A-scope manifest fingerprint | `abb884c2d93ec98076bd13dc1527070b6273a4119f6f89aa00ec9fdb9d21ae41` |
| identity hash | `9b89bf89c2f13130346de56eb150370b0930b44b3771bcf366edd8a6153cf53b` |
| settingChunksSha256 | `5bc7fcea4a29129190a89622414c60c849de7b1a4e48b70d0abcf31fd906e2a3` (stored === fresh parse) |
| seal verdict | `EXPECTED_DEPLOY_SHA_ROTATION` (identity·12/12 body·wire 일치, SHA만 회전) |
| Provider POST | 4 (retry 0) |
| 정산 | 4회 모두 `SETTLED` / `provider_exact` |
| 합계 billed USD | 0.175327 (약 245원, 1 USD = 1,400원 가정) |

### 원문 파일과 검증된 SHA-256

SHA-256은 저장소에 커밋된 파일 바이트에서 계산했고, 해당 run Journal `artifactFingerprint` 및 `visibleChars`와 모두 일치했다. 대사 블록 수는 `extractDialogueBlockSpans` 집계이며 품질 점수가 아니다. 사용자 재인용은 유저 입력 `오늘은 그냥 이렇게 있자`를 다시 인용한 블록이다.

| 모델 | 파일 | 전체 글자 수 | 한글 음절 수 | 대사 블록 (재인용) | SHA-256 |
| --- | --- | ---: | ---: | ---: | --- |
| DeepSeek V4.1 Flash | [VERIFY_65119ae9_deepseek-v4.1-flash.txt](VERIFY_65119ae9_deepseek-v4.1-flash.txt) | 2,919 | 1,979 | 13 (1) | `ee3fff959cb55fbd2c1379614e0c5b8a6f1259968343cd741939a2de992583cf` |
| Gemini 3.8 Flash | [VERIFY_65119ae9_gemini-3.8-flash.txt](VERIFY_65119ae9_gemini-3.8-flash.txt) | 4,020 | 2,849 | 7 (1) | `a3be0013467093106943bbd136a5eac82b5a9eb03e54a2026817ed54416a91b2` |
| GPT-6.1 Sol | [VERIFY_65119ae9_gpt-6.1-sol.txt](VERIFY_65119ae9_gpt-6.1-sol.txt) | 4,087 | 2,861 | 3 (0) | `6675de32f2b29f7f81563abd1b98022356715a98c072c9de60314e98bd8b9ec5` |
| Claude Opus 5.5 | [VERIFY_65119ae9_claude-opus-5.5.txt](VERIFY_65119ae9_claude-opus-5.5.txt) | 2,965 | 2,025 | 5 (1) | `29f583d8f2e72867acf0214395fbd9e8460020875ce567aa40216a2054dc5e0d` |

### `VERIFY_08711b9d` 대비 집계 (사실만, 점수 아님)

| 모델 | 글자 08711b9d → 65119ae9 | 대사 블록 | 캐릭터 대사 질문(?) |
| --- | ---: | ---: | ---: |
| DeepSeek V4.1 Flash | 2,811 → 2,919 | 13 → 13 | 5 → 4 |
| Gemini 3.8 Flash | 4,796 → 4,020 | 13 → 7 | 7 → 4 |
| GPT-6.1 Sol | 4,186 → 4,087 | 4 → 3 | 0 → 0 |
| Claude Opus 5.5 | 3,819 → 2,965 | 6 → 5 | 2 → 1 |

### 질문·제안 원문 (캐릭터 대사, 사용자 재인용 제외)

DeepSeek V4.1 Flash (4):

- `이렇게 있으라며. 근데 이렇게만 있으면 심심하지 않아?`
- `임무는 잘 끝났어?`
- `나 참. 가이드면 가이드답게 좀 피곤한 티를 내든가. 낮에 로비에서 완전 무표정이었잖아. 직원들이 너 보면서 뭐라 그런 줄 알아?`
- `그래서. 이렇게 있자고 한 건 내가 조용히 있어줘야 한다는 뜻이야, 아니면 네가 조용히 있고 싶다는 뜻이야?`

동일 문장의 되풀이는 없다. `이렇게 있자` 계열 질문이 2개다.

Gemini 3.8 Flash (4):

- `흐응…… 그래?`
- `임무 나가서 뛰어다니느라 기운 다 빠졌어?`
- `아니면 뭐, 저 창밖에 있는 빌딩 불빛이라도 세고 있었냐?`
- `몇 개나 켜졌는데?`

GPT-6.1 Sol: 캐릭터 대사 질문 0.

Claude Opus 5.5 (1):

- `계속 거기 서 있을 거야?`

### 토큰·비용·시간

| 모델 | prompt | completion | cache read | cache write | reasoning | billed USD | elapsed ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| DeepSeek V4.1 Flash | 8,109 | 2,203 | — | — | — | 0.001269 | 14,027 |
| Gemini 3.8 Flash | 12,028 | 2,619 | 10,487 | — | — | 0.006100 | 32,181 |
| GPT-6.1 Sol | 12,502 | 2,710 | — | 12,499 | 35 | 0.037929 | 65,514 |
| Claude Opus 5.5 | 20,109 | 3,627 | — | — | — | 0.130029 | 55,666 |

### GPT가 #1616에 대해 볼 항목

Cursor는 KEEP / REVERT / 추가 검증을 판정하지 않는다. GPT가 DeepSeek의 `VERIFY_08711b9d` 원문과 `VERIFY_65119ae9` 원문을 직접 비교한다.

1. 불필요한 질문·제안·같은 화자 대사 분절이 줄었는가.
2. 캐릭터 특유의 장난기와 자연스러운 말투가 유지되는가.
3. 행동·내면·감각·관계의 실제 전개가 있는가.
4. 설명 반복·문장 늘리기가 생겼는가.
5. 근거 없는 과거 공유 사건을 만들었는가.
6. 3,200+ 소프트 길이 목표와 출력 하드 상한 없음이 유지되는가.

Gemini·Sol·Opus는 같은 장면의 인접 정상 품질 확인용이다.
