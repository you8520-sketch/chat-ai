# B-2 Core 기억 권위 분리 — 실제 RP 검증 (증거 전용, 코드 변경 없음)

상태: GPT 검수 대기. Cursor는 RP 품질 점수를 매기지 않는다. 아래 "관찰"은 원문에서 확인되는 사실만 적었고 개선/악화 판정은 GPT 몫이다.
구현 코드 변경 0, `src/` 변경 0, feature flag 0, DB migration 0, 새 owner 0, verifier LLM 0. 후보 변환은 임시 harness(`probes/`)에서만 존재한다.

## 0. 기준점 (재확인)

| 항목 | 값 |
|---|---|
| main (실행 시점) | `5a6a950f` (fix(rp-quality) A-scene 4-call, #1572) |
| main (보고 시점) | `2fe855c4` (#1575) |
| production 배포 (Railway deployments API, read-only) | `2fe855c4` SUCCESS (직전 배포 `11e5ab45`, 그 이전 `5a6a950f`) → production = main |
| 실행~보고 사이 main 변경 | `git diff 5a6a950f origin/main -- src` 에서 contextBuilder / memory / deepseekPromptStructure / historicalTruthPolicy / chatModels / episodic / summary 관련 파일 변경 0 (내비/recentChats/automationHealth만) |
| 증거 PR | [#1571](https://github.com/you8520-sketch/chat-ai/pull/1571) Draft, 브랜치 `cursor/b2-core-persona-contract-30ef` |
| 호출 전 고정 커밋 | `5b2c24c5` (wire 24개 + harness 봉인 후 호출) |

### 최종 조립 순서 재확인 (live owner: `src/services/contextBuilder.ts`)

1. 시스템 메시지 안 메모리 구역 순서: current-memory 산문(`[Memory]` + `[현재기억]`) → episodic 블록(`[T##] [라벨] “원문”`) → ledger(`<<relationship-meta>>`, 헤더 `[Memory — 참고, 우선순위 2순위 하위]`).
2. `[HISTORICAL TRUTH — CANONICAL MEMORY]` 규칙(`historicalTruthPolicy.ts`)은 모든 Main RP 경로에 1회. 유저 꼬리에 `[HISTORICAL TRUTH CHECK]`.
3. **정정 (#1571 전제 수정):** `<LONG_TERM_MEMORY>` + `LTM_ABSOLUTE_FACTS_RULE`("절대적인 기정사실(Absolute Facts)") 서문은 `deepSeekXmlMode`(DeepSeek 계열 Main RP)에서만 붙는다. Gemini 3.8 Flash / GPT-6.1 Sol wire에는 그 문구가 없다 (`wire/*.json`에서 확인, `analysis/wire-diff.md`의 Gemini/Sol 구간 참고). #1571에서 "전 모델 공통"으로 읽힐 수 있는 서술이 있었다면 이 보고가 우선한다.
4. CURRENT에는 이미 episodic 행 단위 라벨(`[유저가 직접 쓴 원문]`, `[AI가 쓴 장면 원문]`, `[캐릭터 발언(미확정 주장)]`, 서버 도출)이 있다. 후보가 바꾸는 것은 그 라벨 위의 구역 머리말/그룹핑이다.

## 1. BEFORE (CURRENT)

- 요약(Luna 산문)은 `[현재기억]` 머리말(히스토리 밖 이전 구간 요약, 연속성은 히스토리·관계 메모 우선) 아래 놓이고, DeepSeek에서는 `<LONG_TERM_MEMORY>` 서문이 구역 전체를 "절대적 기정사실"로 선언한다.
- episodic 행은 시간순으로 한 덩어리 (캐릭터 미확정 주장 행도 T24 순서대로 섞임).
- legacy ledger는 `[Memory — 참고, 우선순위 2순위 하위]` 아래 `관계:` 등으로 렌더.

## 2. PROBLEM (이 실험이 보려는 것)

- 근거 없는 과거 약속/지인 관계(synthetic fixture의 legacy ledger "라이크가 렌을 평생 지키겠다고 약속함", 캐릭터 발언 "누나가 시장에서 널 알아봤대")를 모델이 사실로 받아들이는가.
- 동시에 실제 사건(검 약속 취소 T15, 이별 T40, 손잡기 T33), 감정/관계 연속성이 유지되는가.

## 3. CANDIDATE (임시 harness, 텍스트 재배치만)

동일 live-owner 출력의 텍스트 재그룹핑만 수행. 생성 전체 문자열은 `probes/zz-g7-candidate.ts.txt`.

| 대상 | CURRENT | CANDIDATE |
|---|---|---|
| Luna 산문 머리말 | `[현재기억]` 최근 대화에 없는 이전 구간의 요약… | `[서사 요약]` 감정·관계 흐름을 서술로 요약한 것이다. 세부 사건은 이 요약만으로 단정하지 않고 [장면 기록]·정본과 맞춰 쓴다. (산문 본문은 byte-identical) |
| episodic 실제 문장 행 (유저 원문/AI 장면 원문) | 시간순 단일 목록 | `[장면 기록 — 그 장면에 실제로 쓰인 문장]` 아래 묶음 |
| 캐릭터 미확정 발언 행 | 목록 안에 섞임 | `[인물의 미확정 발언 — 말한 사실만 기록, 내용의 진위는 미확정]` 아래 분리 (행 자체는 동일) |
| legacy ledger 헤더 | `[Memory — 참고, 우선순위 2순위 하위]` | `[미검증 기록 — 원문 근거 없음]` (본문 동일) |
| DeepSeek 서문 | Absolute Facts 문장 | "이 항목은 과거 기억 자료이며 항목마다 성격이 다르다. 각 항목의 머리말에 따라 다룬다." (DeepSeek wire만) |

- 정본/설정(canon): 두 arm 모두 캐릭터 코어·`[HISTORICAL TRUTH]` 규칙·historical truth check는 byte-identical (분리 대상 아님, 그대로 유지).
- 두 arm의 비-시스템 메시지(채팅 히스토리, 유저 꼬리)는 12개 모든 wire 쌍에서 byte-identical (`analysis/wire-diff.md` 각 절 머리의 `non-system messages identical: True`).
- 전체 wire: `wire/g7_<scene>_<cur|cand>_<model>.json` 24개 (`requestBody.messages` 전체). 읽기용 diff: `analysis/wire-diff.md`.

## 4. PRESERVED (변경하지 않은 것)

- lexical guard, summary writer, schema, ledger 저장 형식: 수정 없음 (렌더 문자열만 harness에서 치환).
- B-1 / B-2a, regen/delete episodic 경로: 수정 없음.
- 길이: 요청에 `max_tokens`/길이 상한 없음 (`manifest.json` `hasMaxTokens=false`). 12,000자 client watchdog은 응답 폭주 방지용이며 요청에는 영향 없음 (abort 발생 0건, `call-metrics.json`).
- 새 injector/owner 없음.

## 5. 실험 조건 (정직 표기)

- **synthetic fixture**: 등록 캐릭터/관리자 페르소나 미사용. 캐릭터 라이크(견습 검사), 유저 렌, NPC 서린 등 80턴 합성 대화. Luna 요약은 실제 Luna 봉인 16회를 재생(`data/dump-cur.json`, Gate 2 `dump-cur-real-luna.json` 재사용).
- extractor는 고정 재생(손으로 쓴 입력). T24 "누나 발언"은 정직 라벨(`explicit_character_claim`)로 재생 — 검증기가 귀속 불명 gloss를 막는 경로를 확인한 뒤 수정한 값이다.
- legacy ledger에 가짜 "평생 지키겠다" 약속을 **주입**했다 (근거 원문 없음). 이것은 production 데이터가 아니라 시나리오 장치다.
- 장면 4개 × 모델 3개 × arm 2개. DeepSeek V4.1 Flash는 3회 반복(r1~r3), Gemini 3.8 Flash와 GPT-6.1 Sol은 1회. 모델별 샘플 수가 다르므로 모델 간 비교는 불가, arm 간 비교만 의미가 있고 그것도 N이 작다.
- 장면:
  - S1 존재하지 않는 약속/지인 확인 질문: "네가 나한테 해줬던 약속이 뭐였는지… 시장에서 네 누나가 나를 알아봤다던 이야기가 정말이야?"
  - S2 유저 발언 + 감정 반응: "아마추어 같다는 말 기억나?"
  - S3 정상 NPC 사건: 약초 노점 노파가 칼을 흉봄 (사건 자체는 이번 유저 턴에 포함). 
  - S4 약속 취소 + 시간적 관계 변화: "우리 지금은 어떤 사이야? 그리고 내가 검 갈아다 주겠다고 했던 건 어떻게 됐지?" (fixture 진실: T15 검 약속 취소 / T33 손잡기 / T40 유저가 "그만 헤어지자")
- **미검증 항목 (한계):** fixture에는 열린 *유효한* 약속이 없다. 티켓의 "정상 NPC 사건 + 유효 약속"에서 유효 약속 보존은 이 실험으로 증명되지 않았다. 특히 후보는 legacy ledger 전체를 `[미검증 기록 — 원문 근거 없음]`으로 라벨링하므로, 실제 유효한 legacy 약속이 ledger에만 있는 경우의 회귀는 이번에 관측되지 않았다 (회귀 위험으로 §7에 기재).

## 6. 원문 출력 및 평가 자료

- 모든 원문 (40 호출): `results/*.json` (`execute.log`에 호출 로그).
- 가독 버전, arm 라벨 포함: `analysis/outputs-labeled.md`.
- **블라인드 패킷** (arm을 X/Y로 가림, 순서 무작위): `analysis/blinded-packets.md`, 해독표 `analysis/blinded-key.json` (GPT 평가 후 열기).
- 길이/토큰/비용: `analysis/cost-length-table.md`, `analysis/call-metrics.json`.
- 어휘 항법 표(품질/안전 점수 아님, 읽을 위치 안내용): `analysis/lexical-flags.md`.

### 조건별 표 (budgeted KRW = FX 1700, 캐시 할인 미적용; DeepSeek 행은 3회 호출의 호출당 평균, Gemini/Sol은 1회 값)

| scene | model | n | CUR chars | CAND chars | CUR in-tok | CAND in-tok | CUR out-tok | CAND out-tok | CUR KRW | CAND KRW |
|---|---|---|---|---|---|---|---|---|---|---|
| S1_false_past_probe | deepseek-v4.1-flash | 3 | 1920 | 1066 | 6628 | 6659 | 1426 | 794 | 1.6 | 1.3 |
| S1_false_past_probe | gemini-3.8-flash | 1 | 2852 | 3508 | 5739 | 5793 | 1843 | 2223 | 19.1 | 21.6 |
| S1_false_past_probe | gpt-6.1-sol | 1 | 4181 | 3809 | 5875 | 5928 | 2611 | 2411 | 45.1 | 43.0 |
| S2_user_remark_emotion | deepseek-v4.1-flash | 3 | 1809 | 1449 | 6369 | 6379 | 1373 | 1071 | 1.5 | 1.4 |
| S2_user_remark_emotion | gemini-3.8-flash | 1 | 2610 | 2677 | 5502 | 5534 | 1641 | 2996 | 17.5 | 26.2 |
| S2_user_remark_emotion | gpt-6.1-sol | 1 | 3889 | 4477 | 5638 | 5670 | 2460 | 2779 | 42.8 | 46.4 |
| S3_npc_event_no_cue | deepseek-v4.1-flash | 3 | 1736 | 1805 | 6611 | 6621 | 1300 | 1364 | 1.5 | 1.5 |
| S3_npc_event_no_cue | gemini-3.8-flash | 1 | 3868 | 3321 | 5720 | 5752 | 2512 | 2129 | 23.3 | 20.9 |
| S3_npc_event_no_cue | gpt-6.1-sol | 1 | 4602 | 4131 | 5859 | 5891 | 2969 | 2726 | 49.0 | 46.4 |
| S4_temporal_state | deepseek-v4.1-flash | 3 | 2376 | 2107 | 6527 | 6537 | 1740 | 1551 | 1.7 | 1.6 |
| S4_temporal_state | gemini-3.8-flash | 1 | 4118 | 2742 | 5656 | 5688 | 2458 | 1732 | 22.9 | 18.3 |
| S4_temporal_state | gpt-6.1-sol | 1 | 4368 | 4134 | 5785 | 5817 | 2681 | 2527 | 45.6 | 44.0 |

(호출별 값은 `call-metrics.json`.) 길이 목표(평균 2,700~3,500자, 3,200+) 기준으로 DeepSeek 출력은 두 arm 모두 목표보다 짧다. 길이 상한을 추가하지 않았고 두 arm 모두 같은 조건이다. 후보 입력 토큰 증가: 프롬프트 합계 CUR 124,179 → CAND 124,661 (+0.4%).

## 7. 관찰 (Cursor 점수 없음, 판정 GPT)

아래는 원문 근거 위치와 함께 적은 사실 관찰이다. 어느 쪽이 낫다는 결론은 적지 않는다.

**S1 (근거 없는 과거)**
- DeepSeek: 평생 약속을 사실처럼 말함 CUR 3/3, CAND 2/3 (r1·r2 수용, r3는 평생 약속을 언급하지 않고 검 약속으로 답함). 누나 발언은 CAND에서 "내가 직접 본 게 아니라 누나가 그렇게 말했다"로 귀속하는 비율이 높음(r1·r2·r3). CAND r3에는 "네가 가겠다고 해서 내가 못 갔고" 같은 행위자 혼동이 있고 CAND 출력은 CUR보다 짧음(1,066 vs 1,920자 평균).
- Gemini: CUR은 약속을 수용하고 누나 이야기를 만들어냄("마을 어귀에서 자주 보이던…"). CAND는 평생 약속을 부인하고 누나 발언은 "누나는 널 몰라… 그날 시장에 가지도 않았어"로 단정하며 "없는 약속을 지어내거나…" 같은 *고백*을 서사에 추가함 — 원문에 없는 새 사실 생성.
- Sol: CUR은 평생 약속을 수용하고 누나 발언은 "직접 본 일이 아니다"로 처리. CAND는 어떤 약속도 확인하지 않고("어떤 말을 가리키는지 짚지 못하겠어") 실제 검 약속을 회상하지 않음. 문장이 더 설명적/신중.

**S2 (유저 발언 + 감정)**
- 세 모델 모두 두 arm이 대체로 유사하게 아마추어 발언을 회상하고 감정을 표현. 두 arm 모두 소수 세부 창작이 있음. Gemini CAND는 S2에서 출력 토큰이 크게 늘고(1,641 → 2,996) 이별/연인 관련 서술이 추가됨(`lexical-flags.md`).

**S3 (정상 NPC 사건, 유효 약속 없음)**
- 노파가 칼을 흉본 사건은 두 arm 모두 이후 장면에 반영(Sol CUR "아까 내가 험하게 말한 건 인정하마", Sol CAND "길 물은 사람 앞에서 쓸데없는 소리를 했구먼"; Gemini 양 arm 모두 모욕에 대한 렌의 반응으로 진행). 
- DeepSeek CAND r1·r3가 유저 턴에 이미 있던 노파 대사를 출력 첫머리에 그대로 되풀이함(CUR r1은 변형). Gemini CUR r1도 같은 대사를 되풀이.
- NPC가 여관 이름/가격 등을 지어내는 것은 두 arm 모두 동일(장면 진행을 위한 창작).

**S4 (약속 취소 + 시간 변화; 진실: 검 약속 T15 취소, T40 유저가 이별 선언)**
- DeepSeek 이별 언급: CUR 0/3 (r1·r2는 "연인" 상태로 말함, r3는 "네가 정했던 거 아니었어" 정도), CAND 2/3 (r1 "그만 하자고", r3 "그만 헤어지자고") 이고 CAND r2는 "연인이지… 안 바뀌었어"로 이별 없는 상태로 답함. 검 약속 취소: CUR r1은 "지금도 걸려 있어 / 없던 일인지 유효한지 몰라"로 모호, CUR r3·CAND r1·r2·r3는 취소를 언급. CAND r3는 서사에 없는 "스승님", 날 빠짐/손잡이 풀림 같은 세부를 창작하고 출력이 김.
- Gemini: 두 arm 모두 이별과 검 취소를 정확히 언급. CUR은 긴 독백에서 "오기가 생겨서 숫돌을 대지 않았다" 등 새 사실을 만듦. CAND는 출력이 짧음(4,118 → 2,742자)이고 "틈틈이 숫돌에 갈아 쓰긴 했지만"이라는 새 사실을 만듦.
- Sol: 두 arm 모두 이별/검 취소를 정확히 회상. CAND는 "그 뒤 실제로 검을 갈았는지는 확실히 말할 수 없다"는 유보 문장을 추가함.

### 회귀 위험 (관측/미관측 구분)

- 관측: 요약 권위를 낮추는 문구와 구역 분리가 모델별로 다르게 작동 — Sol CAND S1은 실제 사건(검 약속) 회상 없이 "어떤 약속인지 짚지 못하겠다"고 답함(과한 신중 가능성). Gemini CAND S1은 부인 과정에서 새 사실(누나는 시장에 가지 않았다, 고백)을 만듦.
- 관측: DeepSeek는 후보에서도 legacy ledger의 "평생" 약속을 2/3 수용 — 헤더 라벨만으로 ledger 신뢰가 완전히 내려가지 않음.
- 관측: DeepSeek CAND 일부(r2/r3)에서 행위자 혼동 또는 창작 세부가 늘어남.
- 미관측(검증 불가): 유효한 legacy ledger 약속이 `[미검증 기록 — 원문 근거 없음]` 헤더로 격하되었을 때의 보존. fixture에 유효 열린 약속이 없음.
- 미관측: 30/50/80+턴 이후 지속 효과, 복수 시드에서의 분산(Gemini/Sol N=1).

## 8. PROOF

- 24 wire 봉인 후 호출: `wire/manifest.json` (`bodySha`, `systemSha`, 모델/provider, `hasMaxTokens=false`).
- 호출 40회 전부 `status=200`, abort 0, 완료 `execute.log`의 `DONE posts=40`.
- diff가 머리말/그룹핑에 한정됨: `analysis/wire-diff.md` (12쌍).
- 재현 명령 (임시 worktree에서 harness를 `src/lib/memory/zz-g7-*.ts`로 복사해 실행, 커밋하지 않음):
  - Dump: `AB_VERSION=cur AB_OUT=... node --conditions=react-server --import tsx --test src/lib/memory/zz-g7-dump.test.ts`
  - Prepare: `node --conditions=react-server --import tsx --test src/lib/memory/zz-g7-prepare.test.ts`
  - Execute: `G7_MODELS=deepseek-v4.1-flash,gemini-3.8-flash,gpt-6.1-sol G7_EXECUTE=1 node --conditions=react-server --import tsx src/lib/memory/zz-g7-execute.ts`

### 변경 파일 및 SHA256

| 파일 | sha256 |
|---|---|
| `probes/zz-g7-candidate.ts.txt` | `08768bdea7f3bc014d96f598aad25f7224dd823f1f046e68350badac99b9ff1c` |
| `probes/zz-g7-dump.test.ts.txt` | `7d8306d9fc09c568a436caedc4bf0c678846cf9c655dfc2b9e4f3ab242c64819` |
| `probes/zz-g7-prepare.test.ts.txt` | `0087f48898ef7e262d79c71952a1bd8c7b80c445fb85306272a3c63a505914d6` |
| `probes/zz-g7-execute.ts.txt` | `1c460323fcaed892715e66dbc7f5d7fb667f071f5f7eaf87f5e40fde2e5b705f` |
| `data/dump-cur.json` | `da23f7b621a22cd77e42160725e1e380a3f6064e2ae4863d70222c228129f023` |
| `wire/manifest.json` | `e748b541080815d62b5c8ac7f0b70c7bba7584f4274e95dda36f93814a5f1869` |
| `analysis/blinded-key.json` | `5da93f74e4b6b53c87351c2472d72a5ae94cf171387a3a0faed09cff90f770c7` |
| `analysis/blinded-packets.md` | `4f2c903dfe44a5be1aff34620d244e034fec5de51a8ba45a6de0993eea75508d` |
| `analysis/outputs-labeled.md` | `69ca0dfd9cfec8b0b07545538b6ad31ebc498966f743d4a169b842bce4b8940e` |
| `analysis/call-metrics.json` | `5dc05f0c2d5f10c782d1d09ce50130412fa45378ad15af84f7540ebb9707ae3b` |
| `results/*.json` (사전순 연결 40개) | `ff91884b4cfd6aaa932f154649272a7afc1cef99ab935510ad2e2baf1ac11ca7` |

test 파일은 `src/` 안에 커밋하지 않았다 (`.txt` 사본만). 이 PR의 변경은 `docs/evidence/**` 뿐이다.

## 9. COST

| 항목 | 값 |
|---|---|
| 호출 전 예상 | 588 KRW (계획 상한 968 KRW, 1,000 KRW 미만 → 게이트 통과) |
| 실제 (budgeted, 캐시 할인 미적용, FX 1700, OpenRouter는 `usage.cost` 기준) | **568.1 KRW / 40 호출** |
| CURRENT 합 / CANDIDATE 합 | 284.1 / 284.0 KRW |
| 프롬프트 토큰 합 | CUR 124,179 / CAND 124,661 |
| 완료 토큰 합 | CUR 36,691 / CAND 33,863 |
| 사용 키 | 이 실험 전용 `RP_QUALITY_PAID_*` 키만 사용. production 키 미사용 |

## 10. STOP 조건 점검

- 공정한 동일 재료 비교 불가: 해당 없음 (wire 쌍 12개 모두 비-시스템 메시지 byte-identical).
- "정상 기억·감정 보존과 허위 기억 감소를 둘 다 보일 수 없음": **GPT 판정 필요**. Cursor 관찰로는 허위 기억 수용이 일부 모델/arm에서 줄었으나 감소가 모델마다 다르고, 보존 쪽은 유효 약속 시나리오가 fixture에 없어 입증하지 못했다 (§5, §7).
- 비용 1,000원 이상, canonical owner 변경, production DB 쓰기/배포/과금/권한 경계: 해당 없음.

코드 구현·자동 병합 없이 GPT 검수 대기 상태에서 STOP.
