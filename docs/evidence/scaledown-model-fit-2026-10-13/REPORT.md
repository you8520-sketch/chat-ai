# ScaleDown 신규 모델 적합성 비교 — classify-1 / extract / summarize

범위: 비교 보고서만. 코드 수정·모델 교체·제품 PR·병합·배포 없음. 이 Draft PR은 증거 전용(docs only)이다.
기준: main `HEAD`(작업 브랜치 `cursor/scaledown-model-fit-comparison-a54d`) 코드 경로를 그대로 재사용.

> 품질 점수는 Cursor가 매기지 않는다. 아래 "결정적 검사"(스팬 일치, offset→메시지 ID, 가드 통과 등)와 원문 증거만 제공하고, 기억 품질 판정은 GPT가 `analysis/`의 원문을 보고 한다.

## 0. 전제·한계 (먼저 읽을 것)

- **B-2 S2-lite 선행 조사**: 이 저장소/PR 이력에서 "in-progress S2-lite" 산출물을 찾지 못했다. 가장 가까운 PR #1571(B-2 core valid-promise-state / luna-summary / S1 isolated validation)의 fixture·실제 Luna 기록을 BEFORE로 사용했다. S2-lite 자체는 완료하지 못했음.
- **실제 Luna 라이브 호출은 이번 작업에서 불가**: `hav_luna_memory50_test` 키는 401(만료), `RP_QUALITY_PAID_CHEAPERINFERENCE_KEY`는 `gpt-6-luna`에 403. `CHEAPER_INFERENCE_BENCHMARK_API_KEY`는 운영 키와 동일하므로 의도적으로 사용하지 않았다(`regularTestEgressPolicy` 취지). 따라서 **BEFORE(Luna/JEV)는 PR #1571에 기록된 실제 `gpt-6-luna` 원문**(`data/baseline-*.json`)이고, JEV `typesafe/jev-1.13`은 이번에 라이브로 재측정했다. 실패한 Luna 호출 22건은 `raw/extract.jsonl`/`results/b.log`에 그대로 남아 있다.
- **데이터 안전**: 모든 입력은 합성·비민감 fixture(G8, PR #1591 K1591, PR #1571 27개 5턴 window). 실제 사용자 원문·성인 RP 없음. ScaleDown 호출에는 `provider.zdr=true`, `data_collection="deny"`를 지정했다. ScaleDown 자체의 보관·학습 약관 페이지는 직접 확인하지 못했다(privacy/terms URL 404). 근거는 OpenRouter의 ZDR 엔드포인트 목록뿐이며, **실제 사용자 원문 전송 전에 약관 확인이 선행되어야 한다**.
- 키: 비교 전용 `OPENROUTER_JEV_BENCHMARK_API_KEY`만 사용(운영 `OPENROUTER_API_KEY`/`OPENAI_API_KEY`/`CHEAPER_INFERENCE_API_KEY`는 실행 시 unset).
- 표본이 작다(turn 11개×2rep×2arm, 27 window×1~2rep). 통계적 결론이 아니라 방향성 증거다.

## 1. BEFORE

| 항목 | 기존 | 근거 |
|---|---|---|
| 결정 모델 | `typesafe/jev-1.13` (`JEV_DECISIONS_MODEL`, `DECISION_RADAR_BASELINE_MODEL`) | `src/lib/jevDecisions.ts`, `src/lib/decisionModelRadar.ts` |
| 이벤트 추출 | `gpt-6-luna` shared-initial (`runPostTurnRelationshipOnlyInitial`): relationship delta(promisesAdd/Remove) + episodic fact(quote·role·evidence_type) | `src/lib/postTurnSharedInitial/run.ts` |
| 5턴 요약 | `gpt-6-luna` `summarizeTurnBatch` (system = `buildRollingSummarySystemPrompt(5)` + `ROLLING_SUMMARY_EPISTEMIC_POLICY`, 가드 `validateSummaryNarrative`/`isRollingSummaryGroundedInDialogue`) | `src/lib/memory/memory-rolling-summary.ts` |
| 기록된 Luna 비용 | extractor 1호출 $0.000209 (입력 2,273 tok), 요약 1회 평균 $0.00026 | `data/baseline-luna-*.json` |
| 기존 benchmark 재사용 | `runDecisionModelComparison`(+ `decisionModelRadar` baseline pin) 그대로 사용, 새 runner/DB/owner 없음. 하네스는 `probes/*.ts.txt`(증거 전용, `src/` 밖) | `probes/` |

## 2. COMPARISON

### A. classify-1 vs JEV 1.13

방법: 기존 `runDecisionModelComparison` 표준 fixture 43문항(authorial_habit 24 / completion_integrity 9 / scene_boundary 10) × 2rep, 동일 입력·동일 선택지. 추가로 티켓 시나리오 probe 11개(P01–P11) × 2rep(`results/decisions-results.json`).

| 항목 | JEV 1.13 | classify-1 (제품 payload 그대로) | classify-1 (하네스 한정 flatten 어댑터) |
|---|---|---|---|
| Decisions API 호환 | OK | **HTTP 400 43/43 (2rep 모두)**: `ScaleDown state must be a string or an object with only text, document, and document_mime_type` | `state={text: JSON.stringify(state)}`로 보내 호환시킴 |
| 정확도(표준 43) | 33/43, 34/43 (76.7%, 79.1%) | 0/43 (전량 실패) | 23/43, 21/43 (53.5%, 48.8%) |
| 치명 오류(critical miss) | 2, 3 | (실패를 miss로 집계) | 5, 6 |
| 실패/형식오류 | 0 | 43 | 4/43 per rep (HTTP 504, 약 29초 타임아웃) |
| 지연 p50 / p95 / max | 144–152 ms / 178–315 ms / 218–806 ms | — | 261–276 ms / 1.3–7.9 s / 24–29 s |
| 실비용(reported) | 호출당 약 $2.5e-5 (약 $0.042/M 입력 환산) | $0 (400) | 호출당 약 $2.2e-5 ($0.04/M) |
| 시나리오 probe P01–P11 (문자열 state, 양 모델 호환) | 전부 정답 (P04 gesture-only는 AMBIGUOUS로 사전 정의, 두 모델 모두 DEFERRED_OR_UNCLEAR) | 9개 정답 + P04 동일 + P08/P09 위반. 아래 참조 | **P08 행위자 뒤집힘**: 정답 `USER_HELD_CHARACTER_HAND`를 `CHARACTER_HELD_USER_HAND`로 답함(2/2). **P09 존재하지 않는 스승/연인 관계 확률 0.48 / 0.20** (사전 선언 상한 0.3 초과 2/4), JEV는 0.06–0.13 |

해석(결정적 사실만): (1) 제품이 쓰는 다중 필드 `state`는 classify-1에서 400. (2) 어댑터를 붙여도 표준 fixture 정확도가 JEV보다 크게 낮고, 행위자 뒤집힘·없는 관계 부여 사례가 있다. (3) **classify-1의 단가는 JEV와 사실상 동일**(입력 $0.04/M)이므로 비용 우위가 없다. JEV pin·정산 owner는 변경하지 않았다.

### B. Extract vs Luna 이벤트 추출

방법: (B1) G8/K1591 turn 11개(검 손질 약속, 캐릭터 북문 약속, 연인 제안+보류, 약속 취소, 원문에 없는 평생 약속 전제, 제스처만 있는 연인 제안, NPC 입장, 누나 과거 친분 전언, 정상 감정, 음성 대조군 2개) × 2rep × 2arm(entities만 / +instruction). (B2) 27개 5턴 window 전체에서 메시지 ID(`[msg id · role · name]`) 블록 입력으로 호출. 반환 span의 `start/end`를 입력에 대고 `slice===text`, offset→메시지 ID/role 매핑, 메시지 본문 내 text 존재 여부를 결정적으로 검사. 원문: `results/extract-results.json`, `results/windows-results.json`, `analysis/B-extract-*.md`.

| 검사 | ScaleDown Extract |
|---|---|
| B1 must 이벤트 타입 탐지 | 11개 중 해당 case 전부 탐지(예: 검 약속 user, 북문 약속 assistant, 취소 user, NPC 서린) |
| B1 mustNot 위반 | `G8_T24_false_premise`에서 4/4회 `promise`로 라벨(원문에 없는 평생 약속을 렌이 주장하고 라이크가 부인하는 턴). Luna(기록)는 4/4 promisesAdd 없음 |
| B1 스팬 정확도 | 98개 중 76개만 `input.slice(start,end)===text`. 불일치 22개는 영어 번역 span(`small smile`, `nodded`, `embarrassed`), 문자열 `"true"`, 추출 span 변형 등 |
| B2(27 window) 스팬 | 156개 중 137개 정확 일치, **17개(11%)는 원문 어느 메시지에도 그대로 존재하지 않음**(`true` 5개, `embarrassed`/`uncomfortable` 영어, 의역·합성 문장). `"true"` span은 confidence 0.90~0.99로 반환된 경우도 있음(예: N05 `true` ×4 confidence 0.90–0.99) |
| 메시지 ID 연결 | 스팬 offset으로 msgId/role 산출은 가능(경계 교차 0). 단 모델이 반환한 text와 offset이 어긋난 경우(위 불일치) 연결 불가 |
| 화자/행위자 구분 | entity에 행위자 필드가 없고 role은 offset으로만 알 수 있음. `npc_action` 타입이 NPC가 아닌 주인공 라이크의 행동(`nodded`, 도끼 두드리기, 장작 쌓기)에도 광범위하게 붙음(B2: npc_action 63개; B1 음성 대조군 G8 T3/T50에서도 라이크의 장작 쌓기를 npc_action으로 추출) → "제3의 인물" 정의를 모델이 지키지 못함 |
| 상태/관계 의미 | 타입 라벨과 span만 반환. 약속의 상태(활성/취소), 제안 보류 vs 수락, 전언의 귀속(누가 주장) 같은 의미는 반환하지 않음. G8 T10(보류)은 제안만 잡고 보류 여부 없음 |
| 누락 | N08(서린 전언 → 누나), A04(서린 어린 시절 주장)에서 핵심 주장 span을 놓치거나 `"true"`로 반환 |
| 허위 사건 | N17 취소 window에서 "내가 직접 갈게"를 별도 `promise` 3개로 라벨. N20 비밀 고백 window의 "……알겠다."를 `relationship_acceptance`로 라벨(연애 제안이 없는 장면; GPT 확인 필요) |
| 신뢰도 | 정답 span도 0.25–0.55, 오답(`true`)은 0.9 이상 → **confidence/quote 존재는 진실의 증거가 아님** |
| 지연 | B1 대부분 0.7–2 s, 일부 5–13 s, 최악 78 s. B2 p50 3.0 s, max 72 s |
| 비용 | 1호출 $1.7e-5–$2.4e-5 (입력 약 450–610 tok) |

Luna 기록(`data/baseline-luna-extractor-g8-cur-k2.json`, 동일 G8 turn): T2/T6 promisesAdd 정확(4/4 각각), T15 promisesRemove 3/4, T24 허위 약속 없음 4/4, T10 보류는 episodic fact로 2/4(수락으로 기록한 경우 없음). Luna 역시 완벽하지 않다(episodic fact 누락 존재). 27 window episodic 기록은 `analysis/B-extract-vs-luna-digest.md`.

### C. Summarize vs Luna 5턴 요약

방법: 27개 5턴 window(정상 22 + 적대 5)에 대해 `scaledown/summarize`를 (a) **제품 system prompt + 기록된 제품 user prompt 그대로**(2rep, 54호출), (b) instruction 없이 대화만(1rep, 27호출)으로 호출. 제품 가드(`validateSummaryNarrative`, `isRollingSummaryGroundedInDialogue`)를 통과시켜 결정적으로 검사. 가드 외 `normalizeSummaryText`/`clampMemoryRecordSummary`는 적용하지 않았다(원문 비교 목적). 원문 전체: `analysis/C-summarize-side-by-side.md`(소스 대화 + Luna + ScaleDown 2rep + bare).

| 항목 | Luna (기록) | ScaleDown 제품 프롬프트 | ScaleDown bare |
|---|---|---|---|
| 호출 성공 | — | 54/54 HTTP 200 | 27/27 |
| 가드 통과(narrative ∧ grounded) | 기록상 sealed 27/27 | 51/54 (N05 2rep grounded 실패, N19 rep1 narrative invalid) | 16/27 (SUMMARY_INVALID 9: 9–76자 초단문 등) |
| 길이(중앙값) | 276자 | 259.5자 (600자 초과 3건: 624, 837, 839) | 118자 |
| 요약 토큰/비용 | 평균 $0.00026/요약 | 평균 입력 2,314 tok·출력 235 tok·**$0.0000926/요약** (Luna 대비 약 36%) | 1회 약 $0.00004 |
| 지연 | — | p50 1.1 s, max 3.2 s | p50 0.67 s |
| 결정적 오염 | — | 한자 혼입 1건(`用户的`, N05 rep2), 금지된 `[N턴]` 라벨 노출 4건(N15 ×2, A04 ×2), 프롬프트 헤더(`[5턴 히스토리 요약]`) 에코 7건 (모두 이 하네스의 가드가 잡지 못함) | — |

정성(원문은 side-by-side 문서, 판정은 GPT):
- N10 약속(북문 새벽): ScaleDown은 약속·만남을 보존하지만 원문에 없는 "안개 낀"/"장비 점검"이 추가됨.
- N17 약속 취소: ScaleDown이 "렌은 라이크에게 직접 숫돌을 갈아주겠다고 제안했다"로 방향·취소를 흐리게 서술(두 rep 모두 취소 사실 불명확). Luna는 "제안을 거두고 직접 갈겠다"로 명시.
- N05 연인 제안: ScaleDown이 수락/보류 순서를 섞음("천천히라면……" 응답을 미룸 → 손 맞잡음 → "나쁘지 않아").
- N07 가족: ScaleDown이 "렌이 지난달 북쪽 항구를 방문했다"로 주체를 뒤집음(원문은 누나가 마을을 다녀감). 2rep 모두 유사 오류.
- A02: ScaleDown rep1이 "자신의 누나와 친구였다"로 주체 오귀속, rep2는 "사실임을 인정하며"로 주장을 사실처럼 서술. Luna는 "단언함 … 진실은 미해결".
- A01/A03/A04: A04에서 `[1턴]…[5턴]` 라벨을 노출하며 라이크의 내면 의도(불쾌·보호)를 만들어냄(원문에 없음). A03에서 두 rep 모두 "평생 지키겠다고 약속한 적이 없다고 단정"처럼 화자·내용이 뒤섞임.
- N19 정확 인용: ScaleDown은 핵심 대사("네가 돌아올 곳은 내가 지킨다")를 두 rep 모두 누락(Luna는 보존).
- N06 OOC 공유 과거: 양쪽 모두 3년 전 용병단 정보를 보존.
- 짧음은 우위가 아님: bare arm은 짧지만 가드 통과 16/27, 사건 대부분 누락.

## 3. QUALITY RISKS

1. classify-1: 제품 payload와 비호환(400). 호환시켜도 정확도 저하·행위자 뒤집힘·없는 관계 확률 부여·504/지연 꼬리.
2. Extract: 반환이 "span+타입"뿐이라 약속 상태·귀속(전언/주장)·행위자 의미가 없다. 번역/허위 span 11%, `"true"` 고신뢰 span, 타입 오분류(`npc_action`, 허위 `promise`)로 **quote 존재 ≠ 사실** 문제를 그대로 보여 준다. 메시지 ID 연결은 offset이 정확할 때만 가능하다.
3. Summarize: 주체 뒤집힘(N07), 약속 취소 모호화(N17), 핵심 인용 누락(N19), 허위 디테일 추가, 턴 라벨·헤더 에코·한자 혼입. 일부는 현 제품 가드를 통과한다. 2rep 간 사건 내용이 달라지는 window가 있다(N03, A02, N05).
4. 공통: 지연 꼬리(Extract max 78 s, classify 504). ScaleDown 약관(보관·학습)은 미확인.
5. 이번 평가 자체의 한계: Luna 라이브 미재측정(기록 기반 비교), 표본 작음, 같은 fixture로 PR #1571에서 Luna 프롬프트가 튜닝된 이력이 있어 Luna에 유리할 수 있음.

## 4. COST

| 항목 | 값 |
|---|---|
| 이번 작업 총 provider 보고 비용 | **$0.01357 (약 23원, 환율 1,700 가정)** — 상한 1,000원 대비 2.3% |
| 호출 수 | 485회 (JEV 108 · classify 194 (HTTP 400 86 · 200 100 · 504 8) · Extract 77 · Summarize 84 · 실패 Luna 22는 비용 0) |
| 실제 호출 모델 ID | `typesafe/jev-1.13-20260917`, `scaledown/classify-1-20260928`, `scaledown/extract`, `scaledown/summarize`, (실패) `gpt-6-luna` |
| 단가(관측) | classify-1 입력 $0.04/M·출력 0 (JEV와 거의 동일). Extract 1호출 $1.7e-5–2.4e-5 vs Luna extractor 1호출 $2.09e-4 (단, Luna는 relationship+episodic을 한 번에 생성). Summarize $9.3e-5 vs Luna $2.6e-4 |
| 월 환산 | 이 표본으로는 의미 있는 월 환산 불가(품질 미달 조건에서 단가만 비교됨). 모델 교체 판단 근거로 쓰지 말 것 |

각 호출의 토큰·지연·응답 원문은 `raw/*.jsonl`(요청/응답 바디 전체), 모델별 집계는 `results/*.json`에 있다.

## 5. RECOMMENDATION

제품 기억 품질 개선 근거가 확인되지 않았으므로 **세 모델 모두 교체 권고 없음(현행 유지)**. 자동 교체 없음.

- classify-1 → JEV 1.13: 교체 불가. 제품 payload 400, 호환 시에도 정확도·지연·안정성에서 뒤처지고 단가 이점 없음. 재검토 조건: ScaleDown이 다중 필드 `state`를 지원하고 동일 fixture에서 JEV 이상.
- Extract → Luna extractor: 교체 불가. 스팬 탐지기로서 "후보 문장 찾기" 보조 용도의 가능성은 있으나, 의미 판정(상태·귀속·행위자)을 대체하지 못하고 허위 span/타입이 있다. 사용한다면 후보 검색 한정 + 별도 검증이 필수이며 이번 증거로는 권고하지 않는다.
- Summarize → Luna 요약: 교체 불가. 단가는 낮지만 주체 뒤집힘·취소 모호화·인용 누락·가드 통과 오염이 있다. 재검토한다면 shadow-only 비교(제품 경로 변경 없이)부터.
- 다음 선택지(GPT 판단): (a) `analysis/`의 원문으로 기억 품질을 GPT가 직접 채점, (b) ScaleDown 약관 확인 후에만 추가 비교, (c) 새 비교가 필요하면 `CHEAPER_INFERENCE_BENCHMARK_API_KEY` 분리 발급 후 Luna 라이브 재측정.

## 6. PROOF

- 증거 디렉터리: `docs/evidence/scaledown-model-fit-2026-10-13/`
  - `data/` — 재사용한 fixture와 PR #1571의 실제 Luna 기록(BEFORE)
  - `probes/*.ts.txt` — 사용한 일회성 하네스(`src/` 밖, 새 runner/DB/owner 아님). `zz-sd-common`에 fetch tap, `zz-sd-decisions`(기존 `runDecisionModelComparison` 재사용), `zz-sd-extract`, `zz-sd-windows`
  - `raw/*.jsonl` — 모든 호출의 원본 요청/응답 바디, 지연, 상태코드(키/헤더는 저장하지 않음). `raw/windows.jsonl` 앞 4줄은 smoke(`results/windows-results-smoke.json`)
  - `results/*.json` — 결정적 검사 포함 결과, `results/b.log`(실패한 Luna 401/403 로그 포함)
  - `analysis/B-extract-27windows.md`, `analysis/B-extract-vs-luna-digest.md`, `analysis/C-summarize-side-by-side.md` — GPT 평가용 원문
- 실행 방식: `SD_OUT=… REGULAR_TEST_REAL_PROVIDER_CALLS=1 env -u OPENROUTER_API_KEY -u OPENAI_API_KEY -u CHEAPER_INFERENCE_API_KEY node --conditions=react-server --import tsx scripts/zz-sd-<name>.ts` (스크립트는 커밋하지 않고 `.ts.txt`로만 보존).
- 제품 코드·모델 pin·정산 owner 변경 없음(`git diff` 대상은 이 디렉터리뿐).
