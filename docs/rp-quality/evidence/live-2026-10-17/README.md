# Claude Opus 5.5 운영 Main RP 원문 — 채팅 802

진단 전용 자료다. 코드, 프롬프트, 파라미터, 비공개 페르소나 전문, 시스템 프롬프트는 포함하지 않는다. 문체 점수와 KEEP/REVERT는 정하지 않았다.

## 운영 기준

| 항목 | 값 |
| --- | --- |
| GitHub main | `83b9bd60e4607f135ba6e7098b32d90205ca7e36` |
| Railway production SUCCESS | 동일 SHA |
| `/api/health` gitCommit | `83b9bd6` |
| 캐릭터 | 라이크 id 18, 조태형 |
| 페르소나 | 렌 (id 1) |
| 권한 | NORMAL. 자동진행 권한 레벨도 NORMAL. 자동진행 실행 0 |
| 모드 | `safe`. `initialAdultHandoffEnabled=false` |
| 선택·실제 호출 모델 | `claude-opus-5.5` / Claude Opus 5.5 / CheaperInference |
| 계정 모델 | 전송 전후 모두 `gpt-6.1-sol` |
| 채팅 | https://hav.chat/chat/18?chat=802 |
| 메시지 | user 4124, assistant 4125 |
| 종료 | `generationStatus=completed`, `finishReason=stop`, latency 62,131 ms |
| 폴백 | 없음. `activeRoute=general` |

## 원문

- 본문: [OPUS_chat802_A.txt](OPUS_chat802_A.txt)
- 저장된 유저 입력: [OPUS_chat802_user_input_stored.txt](OPUS_chat802_user_input_stored.txt)
- 인사말(캐릭터 공개 오프닝): [OPUS_chat802_greeting.txt](OPUS_chat802_greeting.txt)
- 영수증 수치: [OPUS_chat802_receipt_public.json](OPUS_chat802_receipt_public.json)

본문 UTF-8 SHA-256 `0c5557b9142d2009dcbcbe6d4515026fa04d5c471c072d3386c0069d2745f5bc`.

저장 본문 3,603자. 영수증 `mainRpOutputVisibleChars`도 3,603. `savedOutputChars`는 3,599라서 두 숫자를 그대로 둔다. 한글 음절 2,402. ASCII 따옴표 대사 블록 5. 물음표 3개 중 대사 안은 2개(`올랐다?`, `괜찮지?`). 나머지 `야, 그럼 밥은?`는 태형이 삼킨 말로 서술 안에 있다. `[태그:]` 줄은 없다.

## 실제 전송 입력

요청문은 `창틀에서`였다. 채팅 802에 저장된 입력은 `창틀서`다. `에` 한 글자가 빠졌다. 재전송하지 않았다. 모델 출력은 렌의 위치를 `창틀에서 한 걸음 떨어진 자리`로 썼다.

## 영수증

원본은 관리자 영수증 API와 메시지 API다. 화면 스크린샷은 `receipt_opus.webp`.

| 항목 | 값 |
| --- | ---: |
| Main RP 입력 / 출력 토큰 | 19,970 / 4,248 |
| reasoning / content 출력 토큰 | 255 / 3,993 |
| 캐시 저장 | 14,595 |
| 일반 입력 | 5,555 |
| 캐시 읽기 | 필드 없음. 캐시 읽기 비용 0원 |
| Main RP 확정 원가 | $0.1171 (`cheaper_inference_usage_api`) |
| Main RP 카탈로그 추정 | $0.11378575 (`live_catalog_estimated`) |
| 공개 기준가 | $0.112322 |
| 자동 후처리 helper | `gpt-6-luna`, 입력 6,409 / 출력 546, $0.000698, 사용자 포인트 0 |
| 턴 합계 확정 원가 | $0.117798, 160.9원 |
| 사용 포인트 | 287 (무료 슬라이스 287, 유료 슬라이스 0) |
| 기여 마진 | 126.1원, 44% |

Main RP 호출은 1회다. Luna 호출은 그 전송에 붙은 상태창·추천입력 후처리이며, 두 번째 장면 생성이 아니다.

전송 전 비용 확인: 같은 A 장면의 이전 Opus 확정 원가는 $0.130029와 $0.159262였다. 조달 기준은 입력 $2.80/M, 출력 $14/M, 목표 마진 0.45다. 예상 사용자 청구는 1,000원 미만이었고, 실제 포인트는 287이다.

## 비교용 기존 원문

과거 결함을 현재 결함으로 확정하지 않는다. 파일은 `cursor/rp-main-run3-vs-run5-evidence-73c8`의 `docs/rp-quality/evidence/`에 있다. 로컬 SHA-256은 아래와 같다.

| 파일 | 글자 | 한글 음절 | SHA-256 |
| --- | ---: | ---: | --- |
| BEFORE_run3_claude-opus-5.5.txt | 3,040 | 2,089 | `69532ace133ec2fd40e39c4ac6d218595fba6ec33b2df64199c091d9b47c82cc` |
| AFTER_run5_claude-opus-5.5.txt | 3,395 | 2,348 | `f0bb84bb67094c5454d14976c23c40b0c6ac853dc352ffc6e63d77e2e458df91` |
| VERIFY_08711b9d_claude-opus-5.5.txt | 3,819 | 2,635 | `8b781196366a434643977da1916948bfc2867ea47650e86455906cbf29db6255` |
| VERIFY_65119ae9_claude-opus-5.5.txt | 2,965 | 2,025 | `29f583d8f2e72867acf0214395fbd9e8460020875ce567aa40216a2054dc5e0d` |

사실만 적는다.

- run3 본문에는 감각 과부하 모니터링 등록, 30분 내 응급 가이드 파견, 경계등 색 변경이 들어 있다. 대사 질문은 가이딩을 요청한다.
- run5와 08711b9d, 65119ae9는 파견·경보를 넣지 않는다. 셋 다 끝에 앉을지 서 있을지를 묻거나 고르라는 대사가 있다. 08711b9d와 65119ae9에는 먼 사이렌이 한 번 있다.
- 802에는 파견 문구와 `[태그:]` 줄이 없다. 손목 밴드 수치가 오르고 진동한다. 관측탑 불빛은 깜빡인다. 대사 물음표는 2개다.
- 802 대사는 따옴표 블록 안에서 짧은 줄로 나뉜다.

## 화면

`01_character18.webp`, `03_settings_opus.webp`, `04_reply_top.webp`, `05_reply_mid.webp`, `06_reply_bottom.webp`, `receipt_opus.webp`, `07_model_restored.webp`.
