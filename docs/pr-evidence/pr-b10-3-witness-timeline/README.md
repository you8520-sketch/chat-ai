# B10-3: 지환 사망 — 도착 시점·목격 관계가 어디서 남았는가

조사만. 제품 코드·프롬프트·DB 쓰기·유료 호출 없음.

**main:** `1e8833ffe253d400332b487c36e2c98664f867cc`  
**이 노트:** `docs/pr-evidence/pr-b10-3-witness-timeline/README.md` (브랜치 `cursor/rp-b10-3-witness-order-9d27`)  
**판정:** `CASE 5 — MIXED`

눈빛·표정·손짓을 봤다는 Gemini 확정은, 최종 입력에 그 목격이 없어서도 난다.  
「태형이 이미 주저앉은 렌 곁으로 내려와 앉았다」는 원문 순서는 첫 5턴 요약에서 빠지고, Global은 그 문장을 그대로 복사했다.

## BEFORE

원문 T25 (`origin/cursor/b7-real-rp-memory-eval-c504` `docs/pr-evidence/pr-b7-real-rp-memory-eval/scenario.mts`, 턴 인덱스 25).

유저: 영등포 게이트 브레이크 후 비상계단에 이미 주저앉아 있고, 가이딩이 빨랐으면 지환이 살았을 것이라고 말한다. 지환의 대사는 없다.

어시스턴트 순서:

1. 오지환은 돌아오지 못했다. 가이딩은 폭주 직전에 닿지 못했다.
2. 비상계단에 주저앉은 렌 옆에 태형이 말없이 **내려와 앉았다**.
3. 묻지 않고, 귤을 까 손에 쥐여 주고, 「네 탓 아니야」. 동이 틀 때까지 그 자리에 있었다.

지환의 눈·입술·손짓·마지막 대사는 이 턴에 없다. 「목격하지 못했다」는 부정문도 없다. 있는 것은 도착이 주저앉은 뒤라는 긍정 순서다.

T20–T24는 식당·딸기우유·야시장 취소·브리핑·가이딩 51%다. 사망 현장이 아니다.  
T26은 다음 날 감사와 측정기 이상. T32 부축 주어 전도(렌이 태형을 부축)는 별도 저장 오류다. 이번 목격 문장과 인과는 없다.

## PROBLEM

B10-2 Gemini는 그 순서를 직접 목격으로 바꿨다. B-3은 「숨이 멎은 뒤에 다가갔다」고 하면서 「마지막 눈빛·안도하는 표정」을 봤다고 한다 (`docs/pr-evidence/pr-b10-2-historical-truth-ab/evidence-table.md`).

질문: 그 도착/비목격 관계가 저장과 최종 입력까지 남았는가.

## 턴별 사실

| 턴 | 사실 | 태형이 한 일 | 태형이 하지 않은 일 |
|---|---|---|---|
| T25 유저 | 브레이크 **후** 비상계단에 이미 앉아 자책 | 이 발화의 청자일 뿐, 현장 묘사 없음 | 지환의 말을 전하지 않음 |
| T25 어시스턴트 | 사망·가이딩 실패를 먼저 진술 | 내려와 앉음, 침묵, 귤, 「네 탓 아니야」, 새벽까지 동석 | 지환의 마지막 동작·대사를 보지 않았다고 **쓰지 않음**. 그 동작을 봤다고도 쓰지 않음 |
| T26 | 다음 날 | 감사 수용, 측정기 이상을 알림 | 사망 순간 회상 없음 |

## 단계 대응

| 단계 | 도착 순서 | 위로 | 지환 마지막 대사 | 직접 목격 |
|---|---|---|---|---|
| 원문 T25 | 「내려와 앉았다」. 렌은 이미 앉아 있음 | 귤, 묻지 않음, 「네 탓 아니야」 | 없음 | 없음 |
| 5턴 요약 `[21~25턴]` (`stored-T50.json` `summaries`, turn 21–25) | **없음.** 「주저앉자 곁을 지키며」 | 귤, 묻지 않음, 「네 탓 아니야」 | 없음 | 없음. 봤다는 문장도 없음 |
| Global `recent_summary` | 같은 문장. 3043자, `summarized_turn_count` 45. 이 블록만 다시 압축되지 않음 | 동일 | 없음 | 없음 |
| Episodic `stored-T50` | 행 없음 | 행 없음 | 없음 | T25 `death_event` 한 줄: 「…오지환이 사망했다.» 선택 인용은 「돌아오지 못했다」 (B9-1 source map) |
| T50 raw 46–50 | 사망 턴이 아님 | 아님 | 아님 | 아님 |
| B9-1/B10-2가 기술한 `[현재기억]` | 요약 문장만 | 요약에 있음 | 없음 | 목격 문장 없음 |
| Gemini B10-2 | B-3은 사후 도착을 **지어낸 뒤** 눈빛을 봄 | 요약의 위로를 씀 | 확정 인용은 실행마다 다름 | **확정** |

`[21~25턴]` 사망·위로 두 문장 SHA-256 (UTF-8): `031d7f2278f2156deec3db00910d15a3ea30a3a4dc47b52a47aba7b286d3448b` (121자).

부정문이 없어서 저장 결함이라고 하지 않는다. 빠진 것은 원문에 있던 긍정 서술 「내려와 앉았다」와 장소 「비상계단」이다. 「-자」는 렌이 앉은 직후 곁을 지켰다는 뜻까지는 남기지만, 태형이 다른 곳에서 내려왔다는 순서는 남기지 않는다.

## 최초로 빠진 지점

**첫 손실:** B7 감사에 남은 5턴 요약. 사망과 위로는 유지, 도착 동사·계단·새벽은 탈락.  
**Global:** 그 문장을 그대로 이어 붙임. 두 번째 왜곡 없음. `projection_kind`는 이 감사 JSON에서 null.  
**Episodic:** 도착·위로 행이 저장된 적이 없음. 검색이 뺀 것이 아니라 추출 결과에 없었다. 사망 한 줄은 T50에서 선택됨 (B9-1). Global에 위로 문장이 있으므로, 검색 누락만으로 목격 오류를 설명하지 않는다.  
**최종 입력:** `49475a3df82469187890340b873319cd008cf5eac7bec4a11eab119091fd0458` 본문은 이 저장소에 없다. B10-2 `input-precheck.md`는 그 해시의 A 와이어가 snap-50 Global 3043자를 썼고 `감사했습니다`가 Global에 없었다고 한다. 이 머신에는 `/tmp/b9-preserved/db/snap-50/app.db`가 없어 바이트 재해시하지 않았다. B9-1도 전체 wire JSON이 없다고 적었다.

주입된 요약만으로도 눈빛 목격은 허락되지 않는다. B-3은 사후 도착을 스스로 말한 뒤 눈빛을 확정했다. 그건 빈칸을 채운 모델 해석이다. 캐릭터의 장기 전투 경험으로 이 사건을 본 것처럼 확장한 문장(「11년」, 음파로 전방을 막음)은 원문 T25에 없다. 페르소나 본문이 그 확장을 지시하는지는 비공개 설정이라 여기서 확인하지 않았다.

## ROOT CAUSE

`CASE 5 — MIXED`

- **CASE 1 (확인):** 도착 순서의 긍정 서술이 5턴 요약에서 빠짐.
- **CASE 4 (확인, 눈빛 증상의 직접 원인):** 남은 입력은 목격을 주지 않는데 Gemini는 목격으로 확정. B-3은 자기가 쓴 사후 도착과 모순.
- **CASE 2:** 이 사건에서 주어가 뒤집히지는 않음. T32 부축 전도는 `[31~35턴]`의 다른 문장.
- **CASE 3:** 도착 행은 저장된 뒤 빠진 것이 아님. T50 Global은 B9-1 기준으로 생략 접두 없이 들어갔다.

## Canonical owner (현재 main에서 읽은 실행 경로)

| 책임 | Owner |
|---|---|
| 5턴 요약 배치·저장 | `processRollingSummaryBatch` · `src/lib/memory/memory-rolling-summary.ts`, 행 저장 `src/lib/memory/memory-summary-persist.ts` |
| T50 Global 본문 | 그 배치가 쌓인 `chat_memories.recent_summary`. 이 스냅샷에서는 `[21~25턴]`을 다시 쓰지 않음 |
| Episodic 추출 | `buildEpisodicExtractSystemPrompt` · `src/lib/memory/memory-episodic-extract.ts`. 저장 감사본에는 사망 행만 있음 |
| Episodic 보존 | `src/lib/episodicMemoryFacts.ts` |
| 최종 주입 | `src/services/contextBuilder.ts` |
| 과거 확정 규칙 | `HISTORICAL_TRUTH_POLICY_BLOCK` · `src/lib/historicalTruthPolicy.ts`, section `rule-historical-truth-canonical-memory` |
| 회상형 유저 꼬리 | `buildHistoricalTruthCurrentUserRecencyRef` (같은 파일). T50 질문의 `기억나`에 해당 |
| 전송 | 프로덕션 와이어. 본문 미보관 |
| 다음 턴에 잘못된 과거를 다시 저장 | 같은 rolling-summary persist. B9-1은 Luna를 스텁해 Global을 다시 쓰지 않음 |

`NO_FALSE_SHARED_MEMORY_RULE`, `INTERACTIVE_USER_CONTROL_BLOCK`은 B10-1과 같이 이 경로의 본문이 아니다. Gemini 3.1 보충은 3.8 Flash에 적용되지 않는다.

## AFTER

제품 변경 없음.

## REMOVED

없음.

| 항목 | 분류 |
|---|---|
| 5턴 요약이 남긴 사망·위로 문장 | KEEP |
| `HISTORICAL_TRUTH_POLICY_BLOCK` | KEEP. B10-2가 한 문장 교체를 기각 |
| 비주입 짧은 포인터 규칙 | FOLLOW-UP (B10-1과 동일, 이번 삭제 없음) |
| T32 부축 요약 | FOLLOW-UP. 이번 목격 범위 밖 |

## PRESERVED

사망 뒤 위로, 귤, 「네 탓 아니야」, 지환 대사의 부재, T50에서 Global 전문이 들어갔다는 B9-1 기술, 부축 오류를 이 증상과 묶지 않음.

## REGRESSION RISKS

요약을 고치면 도착 동사는 돌아올 수 있다. B-3은 사후 도착을 쓰고도 눈빛을 확정했으므로, 그 수정만으로 Gemini 목격 확정이 끝난다고 보지 않는다. 진실 블록에 문장을 더하면 B10-2가 이미 기각한 방향이다.

## PROOF

- 원문: B7 브랜치 `scenario.mts` T25. 이 저장소 워킹 트리에는 없고 `5bcab9a0505b9e502798ae13405e0fab9fb77b42`에 있다.
- 요약·Global·episodic: 같은 브랜치 `audit/stored-T50.json`.
- 응답: `docs/pr-evidence/pr-b10-2-historical-truth-ab/responses/t50-B-3.txt`, `evidence-table.md`.
- 와이어 해시: `docs/pr-evidence/pr-b10-2-historical-truth-ab/live-meta/t50-A-1.request-sha256.txt`. 본문 미재검증.
- 현재 주입 owner: `contextBuilder.ts`, `historicalTruthPolicy.ts`.

## 확인 / 가설 / 미확인

**확인:** 원문 순서, 요약에서의 도착 동사 탈락, Global 복사, episodic에는 사망만, 입력 기술상 목격 문장 없음, Gemini가 목격을 확정.

**가설:** 「가볍게 추정」과 비검색=부존재가 아님이라는 문장이 빈 대사를 채우게 한다. B10-1과 같이 분리 실험은 없다. B10-2 B 문장도 목격을 막지 못했다.

**미확인:** SHA `49475a3d…` 본문의 바이트. 페르소나 문장이 전투 경험을 이 사건의 목격으로 확장하라는 지시인지. 요약 모델이 그때 어떤 시스템 문장을 봤는지(저장된 결과만 있음).

## 다음 한 가지

`HISTORICAL_TRUTH_POLICY_BLOCK`은 수정하지 않는다.

다음 구현은 `memory-rolling-summary`가 원문에 「내려와 앉았다」처럼 한 사람이 이미 있는 상태인 다른 사람에게 도착한다고 썼으면, 그 순서 동사를 5턴 요약에 남기는지 고정하는 fixture 하나다. 기대 입력은 T25 유저·어시스턴트 원문, 기대 출력은 도착이 위로보다 앞이거나 같은 문장에 남는 것이다. 부정문 「보지 못했다」를 필수로 하지 않는다. 눈빛 확정은 그 fixture의 통과 조건이 아니다.

## 제한

운영 DB 없음. snap-50 파일 없음. 유료 호출 없음. 전체 프롬프트는 커밋하지 않음.
