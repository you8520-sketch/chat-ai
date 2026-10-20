# B17 — Sol 장기 감정 회상: 동일 사건 인용 연결 A/B

조사만. 제품 코드 변경 없음. 병합·배포 없음. B18 시작 없음.

**결과 (B17-4 재개): `READY_FOR_GPT_REVIEW`**

B17-4 resume (2026-10-20): 사용자 승인 경로 **`CHEAPER_INFERENCE_BENCHMARK_API_KEY`** only (`scripts/lib/benchmarkCheaperInferenceCredential.ts` → `buildCheaperInferenceHeaders`). 이 실행 VM에서 BENCHMARK ≠ `CHEAPER_INFERENCE_API_KEY` (각 56자, `ci_` prefix). `PRODUCTION_KEY_FALLBACK_FORBIDDEN` / paid-runner `RP_QUALITY_PAID_*` 경로는 사용하지 않음.

| 단계 | 결과 |
|---|---|
| wire SHA A/B | `47aa634…7761ff` / `fca4a547…7820ac` (재확인) |
| 2-call 비용 상한 (게시 단가) | ≈488원 (<1,000원) |
| Arm A (current) | HTTP 200, finish `stop`, 4457 chars |
| Arm B (group) | HTTP 200, finish `stop`, 4003 chars |
| provider calls | 2 (Luna·embedding 0) |
| 실제 비용 (게시 단가+실행 시 FX) | **131.4원** (A 67.7 + B 63.7) |

**GPT 블라인드 원문 (레이블만, arm 비공개):**

- X: https://github.com/you8520-sketch/chat-ai/blob/cursor/b17-sol-event-link-ab-04e1/docs/pr-evidence/pr-b17-sol-event-link-ab/blinded/output-X.txt
- Y: https://github.com/you8520-sketch/chat-ai/blob/cursor/b17-sol-event-link-ab-04e1/docs/pr-evidence/pr-b17-sol-event-link-ab/blinded/output-Y.txt

매핑(운영자/GPT 채점 후): `blinded/OPERATOR-ONLY-mapping.json` — X=Arm A(current), Y=Arm B(group).

**원문 전체 (비블라인드):** `live-b17-4/arm-a-output.txt`, `live-b17-4/arm-b-output.txt` · trace `arm-a-trace.json`, `arm-b-trace.json`.

**Cursor는 RP 점수를 매기지 않음.** GPT 검수 요청 후 STOP (제품 memory 코드·병합·배포·B18 없음).

---

**B17-4 (초기 VM, 차단): `BLOCKED`**

동일 지시의 첫 VM에서는 BENCHMARK=운영 키로 판정되어 Arm A 전 STOP (Sol 0회). 아래 재개 실행이 정본 live 결과.

---

**결과 (B17-3): `BLOCKED`**

B17-3 (2026-10-20): 사용자가 교체했다고 한 `RP_QUALITY_PAID_CHEAPERINFERENCE_KEY`가 이 실행 VM 프로세스에는 주입되어 있으나, 값이 `CHEAPER_INFERENCE_API_KEY`와 **동일**하다. `readPaidRunnerLiveInferenceKeys` → `assertPaidRunnerExperimentInferenceKeys` / `experimentSecretUsesProductionKey`가 **`PRODUCTION_KEY_FALLBACK_FORBIDDEN`** 을 반환한다. 운영 키로 실험 경로를 대체하지 않았고, **Arm A/B 유료 호출 0회**. wire `requestBody` SHA256은 Arm A/B 모두 기대값과 일치(아래 §4). 증거: `live-b17-3/key-audit.json`, `live-b17-3/run-status.json`.

**필요 조치:** Cursor Cloud 환경 `chat-ai`에서 `RP_QUALITY_PAID_CHEAPERINFERENCE_KEY`를 **운영 키·벤치마크 키와 다른** 유효한 Cheaper Inference 실험 키로 설정한 뒤, **새 Cloud Agent 실행(또는 환경 스냅샷 재빌드)** 으로 주입을 갱신한다. 같은 문자열을 넣으면 B17-3과 동일하게 차단된다.

---

**이전 (B17-2): `BLOCKED`**

무호출 wire 조건은 성립했다. 정본은 저장해 둔 두 request JSON이다. 최초 `gate-report.json`의 `episodic_policy_same: false`는 섹션을 잘못 자른 스크립트 결과이고, 다시 비교한 판정은 통과다. Sol 생성은 시작되지 않았다.

B17-2 인증: 오픈코드 설치·로그인이 이 401의 원인은 아니다. 거절된 값은 Cursor Cloud에 주입된 `RP_QUALITY_PAID_CHEAPERINFERENCE_KEY`이고, Cheaper Inference가 그 키 문자열을 `invalid_api_key`로 거절했다. 이 VM에는 OpenCode가 없다. 운영 키 자동 대체는 하지 않는다. 재호출 없음. 비용 0원.

사용자 조치: Cursor Cloud 환경 `chat-ai`의 비밀 `RP_QUALITY_PAID_CHEAPERINFERENCE_KEY`를, 지금 유효하고 운영 키와 다른 Cheaper Inference 키로 바꾼다. 운영 키를 그 이름에 넣지 않는다. 오픈코드를 지우거나 다시 로그인할 필요는 없다. 오픈코드 설정 중에 Cheaper Inference 대시보드에서 그 실험 키를 지웠거나 재발급했다면, 새 실험 키만 같은 비밀 이름에 넣으면 된다.

저장된 Arm A/B request는 그대로 다시 보낼 수 있다. SHA는 아래와 같다.

최종 질문 — “같은 과거 사건의 유저 발언과 캐릭터 반응을 연결해 보여주는 것만으로, Sol이 오래전 감정을 더 자연스럽고 정확하게 기억하며 RP를 진행하는가?” — 에는 이번 호출의 원문이 없다. 과거 Gate 2 출력과의 비동시 비교는 통제 A/B가 아니다.

## 1. 최종 목표 / 완료 조건 / 달성 / 현재 단계

최종 목표(변경 없음): 30·50·80·150·500·1,000턴 뒤에도 중요한 사건·감정·관계·약속·취소·NPC·행동 주체·시간 순서를 기억하고 현재 장면에서 쓰는 장기기억.

이번 완료 조건: 기존 Gate 2 CURRENT wire에서 T1 두 인용의 표시만 묶은 뒤, 무호출 동일 조건을 통과하면 Sol 1쌍(개선 가능성이 보일 때만 한 쌍 추가, 최대 4회, 1,000원 미만)을 받아 GPT가 볼 블라인드 원문을 남긴다.

달성: A/B request SHA·episodic diff·**Sol 1쌍 원문**(B17-4 resume).

현재 단계: B17 출력 1쌍 확보 → **GPT 블라인드 검수 대기**. 제품 renderer 변경·B18 없음.

## 2. BEFORE — 현재 Episodic 입력

재사용 원본: PR #1564 Gate 2, 증거 커밋 `32dbe4e55658226ea954116b071405cb9d69b179`, 브랜치 `cursor/gate2-main-rp-memory-evidence-30ef`.

파일: `docs/evidence/main-rp-memory-gate2/final-wire/requests/g2_B_npc_no_cue_cur_gpt-6.1-sol.json`

합성 80턴 fixture. 운영 채팅이 아니다. Global은 유저 문장을 중복 추출한 대역이며 정상 서비스 Global 품질이 아니다.

장면 B 마지막 유저 입력의 노파 대사:

`저 젊은이, 허리춤에 찬 칼이 아깝구먼. 폼만 잡지 제대로 휘둘러 본 적은 없어 보이는데.`

Arm A episodic 사실 줄 (정책 헤더 아래, 8줄):

- `[T40] [유저가 직접 쓴 원문] “미안, 우리 그만 헤어지자.”`
- `[T1] [AI가 쓴 장면 원문] “라이크는 입술을 깨물며 시선을 피했다.”`
- `[T1] [유저가 직접 쓴 원문] “솔직히 너 좀 아마추어 같아.”`
- `[T75]` … `[T63]` 장작 서술 5줄

T1 두 줄은 이미 최종 입력에 있다. 순서는 AI 서술 다음 유저 대사다.

## 3. HYPOTHESIS

같은 턴의 유저 비판과 캐릭터 반응을 별도 두 줄 대신 한 표시 묶음으로 두면, Sol이 간접 장면에서 둘의 연결을 사용할 가능성이 있다. 검증 전 가설이다.

Arm B는 그 두 원문만 다음으로 바꾼다.

```
[T1 · 같은 장면의 연속된 기록]
[유저 입력] “솔직히 너 좀 아마추어 같아.”
[AI 장면 서술] “라이크는 입술을 깨물며 시선을 피했다.”
```

저장 fact를 하나로 합치지 않았다. 검색·순위·중복 제거는 호출하지 않았다. 상처, 원망, 망각 실패, 트라우마, 회상 강제는 넣지 않았다.

## 4. A/B WIRE DIFF

전체 request SHA256 (canonical JSON, sort_keys, 공백 없음):

| arm | sha256 | JSON bytes |
|---|---|---|
| A current | `47aa63445a79506b17f32a3f4c7bbadc0f8aa758fe59544479993253d17761ff` | 22153 |
| B group | `fca4a547fb1adbff4ae64df66372f09aa47744d84d1956b871325cea3c7820ac` | 22161 |

시스템 블록 SHA256:

| arm | system | episodic section |
|---|---|---|
| A | `4146b360bad89015ebbee7dd15c98c17d8c8d5abddf661dfb2b447e688b6c328` | `53cf72428a0bc36a637cf8f9a403bc912189b42fa4895156b36cff26ce5710a9` |
| B | `da3fd04b9f774359b4235e9422467957be9682a124f9371143ad3d49511aeb68` | `d3fd262a35c6663d5ca3bdd4be2efef36eb5dcf8f82452889e9e29922fba7dd2` |

바이트 차이는 +8. 차이는 시스템 part 2의 T1 표시뿐이다. part 0·1, 메시지 1–9, model, temperature 0.7, reasoning low, stream, endpoint가 같다. `max_tokens` 없음.

에피소드 섹션 길이 1043 → 1041. 대시 불릿은 8 → 6이고, 빠진 2개는 T1 두 줄이며 그 자리에 3줄 묶음이 있다. T40·T75·T72·T69·T66·T63 원문은 그대로다.

사실 텍스트 예산(렌더러가 세는 본문, 상한 1000, 이번 선택 8개):

| 항목 | chars |
|---|---|
| Arm A 8개 사실 텍스트 합 | 270 |
| Arm B 나머지 6개 + T1 묶음 3줄 | 281 |

281은 1000 아래다. 헤더 때문에 다른 사실이 빠지지 않는다. 묶음을 더 줄이지 않았다.

인용 `솔직히 너 좀 아마추어 같아.` 와 `라이크는 입술을 깨물며 시선을 피했다.` 의 출현 횟수는 양쪽 시스템 텍스트에서 같다. B에서 유저 대사가 AI 서술보다 앞이고, 줄 라벨은 `유저 입력` / `AI 장면 서술`이다.

Global `[1~5턴]`의 동일 문장 중복은 양쪽이 같다. 에피소드 정책 문장(`Use them only when relevant to the current scene.` 포함)은 양쪽이 같다. `gate-report.json`의 최초 스크립트는 `episodic_policy_same: false`, `gate_pass_structural: false`로 남겼다. 원인은 섹션 분리였다. Arm B를 `[T1 ·`에서 잘라 T40 줄이 정책 쪽에 들어갔다. 저장해 둔 두 JSON을 다시 비교하면, T1 두 줄의 문자열 교체 외 바이트는 같다. 정책 문장, Global, T40, 장작 기록, 다른 메시지가 그대로다. 정정 판정은 `corrected_judgment.gate_pass_structural: true`다. 처음의 false를 지워서 성공으로 바꾸지는 않았고 `original_script`에 남겨 두었다.

입력 토큰 추정: Gate 2 scene B CURRENT Sol prompt 5882. 본문 바이트 비율로 Arm B는 약 5884. 긴 문맥 단가(272,000 토큰)에는 닿지 않는다.

## 5. RAW OUTPUT (B17-4 resume)

고정 wire `requestBody` 그대로 Cheaper Inference streaming 1회씩. 재시도 없음.

| arm | finish | completion chars | prompt tok | completion tok | cache write | reasoning tok |
|---|---|---:|---:|---:|---:|---:|
| A current | `stop` | 4457 | 5873 | 2955 | 5870 | 27 |
| B group | `stop` | 4003 | 5867 | 2694 | 5864 | 37 |

전문: `live-b17-4/arm-a-output.txt`, `live-b17-4/arm-b-output.txt`.

B17-2 (401 `invalid_api_key`, RP_QUALITY 실험 키): Sol 0회 — 아래 §6 하단 참고.

## 6. COST

호출 전 보수 상한 (게시 단가 2026-10-02, `gpt-6.1-sol` input $2 / output $10 per 1M, 캐시 읽기 $0.1, FX 1,700):

- 과거 scene B 크기(prompt 5882, completion 상한 6000) × 4회, 캐시 없음 ≈ 488원
- JSON 글자 수를 토큰으로 치는 더 큰 상한 × 4회 ≈ 709원

1,000원 미만이라 호출 조건은 통과했다. 라우트는 고정 wire 그대로 `gpt-6.1-sol`, provider `cheaperinference`, endpoint `https://api.cheaperinference.com/v1/chat/completions` + 기존 `g2pilot` 캐시 쿼리.

**B17-4 resume 실제:** 2 calls, **131.4 KRW** (published `gpt-6.1-sol` rates × 실행 시 `getEffectiveKrwPerUsd()` ≈1530; upstream USD A 0.044231 + B 0.041606). Luna·embedding 0.

**B17-4 resume 인증:** `CHEAPER_INFERENCE_BENCHMARK_API_KEY` present, ≠ production env, Bearer via `buildCheaperInferenceHeaders`. paid-runner 미사용.

**B17-2/B17-3/B17-4(초기) (0원):** `RP_QUALITY_PAID_*` 또는 BENCHMARK=운영 동일 문자열 → 호출 0 또는 401. `PRODUCTION_KEY_FALLBACK_FORBIDDEN` 유지.

#1679 B9-3의 Sol 성공은 이 실험 키가 아니다. 그 경로는 앱의 `resolveCheaperInferenceApiKey()`가 읽는 운영 키로 `POST /api/chat`을 보냈다.

B17-2에서 Sol은 다시 호출하지 않았다. 401 이후 재시도 없음. 독립된 유효 실험 키는 이 환경에 없다. OpenRouter 실험 키는 다른 provider라 이번 Cheaper Inference 경로의 대체로 쓰지 않았다.

## 7. REGRESSION RISKS

선택 로직은 이번 표시 변경과 무관하다. B11 무호출 재현(`docs/pr-evidence/pr-b11-long-emotion-recall/probe-results.json`, base `7b7a6f11`)에서 이 18행 fixture의 장면 B는 이름 겹침과 milestone로 T1 두 인용을 이미 주입했다. 최근 lane이 작은 코퍼스 전체를 덮는다. 무관 장면이 T1을 빼는지는 그 fixture로 분리되지 않았고, 이번에도 모델 호출로 확인하지 않았다. 그룹 표시를 모든 RP 장면에 안전한 제품 변경으로 볼 수 없다.

장면 A 고정 wire(`g2_A_direct_quote_cur_gpt-6.1-sol.json`)는 T1 두 인용만 있고 장작 줄은 없다. 화자 라벨은 유저 원문 / AI 장면 원문이다. 직접 질문 `아마추어 같다는 말 기억나?`의 주입은 그 wire에 남아 있다. 장면 A는 호출하지 않았다.

## 8. RESULT

`READY_FOR_GPT_REVIEW` (B17-4 resume)

Cursor는 개선/무차이/악화를 판정하지 않는다. 제품 renderer 수정·실험안 채택/폐기 없음.

## 9. GPT 블라인드 원문

- X: https://github.com/you8520-sketch/chat-ai/blob/cursor/b17-sol-event-link-ab-04e1/docs/pr-evidence/pr-b17-sol-event-link-ab/blinded/output-X.txt
- Y: https://github.com/you8520-sketch/chat-ai/blob/cursor/b17-sol-event-link-ab/blinded/output-Y.txt

Gate 2 블라인드(`docs/evidence/main-rp-memory-gate2/blinded/outputs/`)는 이번 A/B 대조군이 아님.

이번 wire:

- `docs/pr-evidence/pr-b17-sol-event-link-ab/wire/arm-a-request.json`
- `docs/pr-evidence/pr-b17-sol-event-link-ab/wire/arm-b-request.json`
- `docs/pr-evidence/pr-b17-sol-event-link-ab/wire/episodic-diff.txt`

## 10. main · 실험 HEAD · 환경 차이

- **origin/main (live call 시점):** `02ed2c8b8376b121678f4657a2b8e8dc29a293f3`
- **PR HEAD (evidence + live):** `581c04a68e4331113e820e74ef70eb9cf4ecbcfb` → B17-4 resume 커밋 후 갱신
- B17 시작 기준 `671d3925e0745ad283c98f6a000ed47c30b6ad35`
- B17-2 시점 `origin/main` `94639d6e7cddc45025eca307b37692cdab014475` (#1695, #1696, #1697). episodic renderer·Cheaper Inference 헤더·Sol 게시 단가 파일은 그 구간에서 바뀌지 않았다.
- Gate 2 증거 `32dbe4e55658226ea954116b071405cb9d69b179` (main에 없음)
- 실험 브랜치는 그 main에서 evidence 파일만 추가한다. 제품 소스는 그 SHA와 같다.

체크 7: main의 memory owner는 #1564 wire를 만든 시점과 다르다. 해석을 막지는 않는다. A/B는 그 고정 request를 다시 렌더하지 않고, 바이트 차이가 T1 표시뿐임을 확인했다.

같은 구간의 표시 차이는 다음이다.

- `renderVerifiedEvidenceText` 라벨: `유저가 직접 쓴 원문` / `AI가 쓴 장면 원문` → 현재 main `유저 입력 발췌` / `AI 장면 서술 발췌`
- `episodicMemoryFacts.ts`: 정정 링크, 검색 토큰 가중. 상한은 여전히 8 fact / 1000자. 주입 형식은 여전히 `- [T${turn}] ${text}`
- `historicalTruthPolicy.ts`: 빈 과거 세부를 열린 상태로 둔다는 문장이 상수로 빠져 있다. 고정 wire의 시스템 텍스트는 양쪽이 같고, 장면 B 유저 입력은 `기억나` 류 패턴이 아니다
- `memory-rolling-summary.ts`, `chatModels.ts`도 그 구간에서 바뀌었다. 이번 두 request에는 반영하지 않았다

나중 제품 수정이 승인되면 대상은 현재 renderer 한 곳이다. 새 요약 지시, 모델별 회상 강제, Memory Graph, DB 필드, 병렬 기억 시스템은 이번 범위가 아니다.

소유자(수정하지 않음):

- 에피소드 프롬프트 문자열: `formatEpisodicMemoryPromptSection`
- 검증 원문·화자 라벨: `renderVerifiedEvidenceText`
- fact 수·문자 예산: 같은 포맷터의 8 / 1000, 동적 총량 2500
- 최종 배치: context builder가 그 블록을 시스템 파트에 넣는다

## 환경

모델 ID `gpt-6.1-sol`. temperature 0.7. reasoning effort low. stream. 출력 상한 추가 없음. 합성 fixture. **N=1 per arm** (B17-4 resume).

---

## BEFORE / AFTER / REGRESSION RISKS / PROOF (B17-4 resume)

**BEFORE:** Gate 2 scene B CURRENT wire + T1 두 인용이 별도 `- [T1]` 불릿(Arm A). 동일 사실·동일 장면·동일 모델 조건.

**AFTER (실험안 Arm B only, 제품 미반영):** T1 유저/AI 두 줄을 `[T1 · 같은 장면의 연속된 기록]` 블록 3줄로 표시만 변경.

**REGRESSION RISKS:** §7 동일. 이번 1쌍으로 선택/검색 회귀는 검증하지 않음.

**PROOF:** wire SHA gate `wire/gate-report.json`; live `live-b17-4/*`; runner `run-live-b17-4.ts` (evidence-only, benchmark key guard); auth `live-b17-4/key-audit.json`.
