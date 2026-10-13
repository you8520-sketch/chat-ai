# Main RP B-2 / S1 봉인 진행과 사실 권위 분리 — 격리 결정적 검증

상태: GPT 검수 대기 · 제품 코드 변경 없음(#1591 포함) · 병합/배포 없음 · provider(Luna/Main RP) 호출 0회 · 새 DB/그래프/LLM 판정기 없음.
Cursor는 RP 품질 점수를 매기지 않는다. 아래 수치는 결정적 코드 경로 결과이며 LLM 거동(= RP 품질)은 측정하지 않았다.

> 한 줄 요약: S1은 "frontier 전진"과 "사실 권위"를 분리해 **격리·라벨 보존 기준은 통과**한다. 그러나 (a) #1591 위에서는 보호 범위가 명시 단서 가짜 과거 16건뿐이고, (b) 대조군(#1591 이전 가드) 위에서는 정상 사건(유저 약속·이별·NPC 주장)까지 "미확인"으로 강등하며, (c) 단서 없는 가짜 과거 8건은 모든 arm에서 정상 봉인된다. 또한 새 non-ltm wire 슬롯이 필요해 변경 지점이 넓다. **부분 STOP**(§12).

---

## 0. 실험 구성 (모두 임시 worktree, 어떤 제품 브랜치에도 적용하지 않음)

| arm | 코드 | 설명 |
|---|---|---|
| `main` | `3b553c6c` | 현재 main |
| `ctl` | `8fb7f7f3` | main + 짧은 희소 요약 봉인(길이 80 → 12 + sparse anchor). `이후` 문두 완화 없음 |
| `pr` | `4d6862c7` | #1591 head (`ctl` + 문두 `이후` 완화) |
| `s1ctl` | `ctl` + S1 | 대조군 위 S1 |
| `s1pr` | `pr` + S1 | #1591 위 S1 |

- 재사용 입력: 16구간 Luna 원문(`src/lib/memory/fixtures/rolling-summary-seal-stall.real-luna.json`), 104건 반례(`main-rp-b2-core-provenance-contract-audit/data/false-past-cases.json`). 새 테스트 인프라 없음 — 기존 `__setSummarizeTurnBatchCallerForTests` / `__setCompactCurrentMemoryTestOverride` 시임과 격리 DB 헬퍼만 사용.
- 실행: `probes/run.sh.txt` (`node --conditions=react-server --import tsx --import regularTestEgressPolicy --test`). 하네스 `probes/s1-isolated.test.ts.txt`는 기록만 하고(assert 없음) 결과를 `data/out-*.json`에 쓴다. 5 arm 모두 38 테스트 통과(= 하네스가 완주했다는 뜻이며 S1 승인 의미 아님).
- 프롬프트는 `regularTestEgressPolicy`가 유료 키를 제거하고 Luna 호출은 원문 재생 스텁이다. 네트워크 호출은 환율 갱신(`[exchangeRate] refreshed`, 무과금 FX 조회)뿐이다.
- S1 패치 전체: `s1-experiment.patch.txt` (11 파일, +198/−30, **참고용; 적용 안 함**).

## 1. BEFORE / PROBLEM / AFTER

**BEFORE (main).** 5턴 요약이 grounding 가드에서 3회 실패하면 해당 구간은 봉인되지 않고 frontier가 멈춘다. 페르소나가 있는 16구간에서 main은 구간 1에서 멈춰 봉인 0, 80턴 wire의 raw pool이 80교환(정상은 4)까지 커진다. 반대로 가드를 통과했다는 사실이 "확정된 과거"로 취급된다 — 통과는 진실 검증이 아니다.

**PROBLEM.** 한 개의 `chat_turn_summaries` 행이 (1) frontier 전진 수단과 (2) 사실 권위(DeepSeek `LTM_ABSOLUTE_FACTS_RULE` 래퍼, Global/Medium/원장)를 동시에 맡는다. 그래서 가드를 풀면 가짜 과거가 권위를 얻고, 가드를 유지하면 진행이 막힌다.

**AFTER (S1 실험).** 기존 3회 시도 후 "근거 없는 단정" 실패만 남은 `main_canon` 평범한 봉인 구간에 한해 `scope_payload.sealAuthority="unverified_summary"`(JSON 필드, 마이그레이션 없음)로 봉인한다. frontier는 전진하지만 해당 행은 Global/Medium/compaction/원장/episodic에서 제외되고, wire에서는 래퍼 밖 별도 구역 `unverified-summary`(규칙문 + `[미확인 요약 · T{a}–{b}]`)로만 노출된다. 추가 모델 호출 없음(시도 3회 그대로).

## 2. 단일 canonical owner 맵 (새 owner 없음, 기존 owner에 필드 1개)

| 책임 | owner(기존) | S1 변경 |
|---|---|---|
| 봉인 판정/생성 | `memory-rolling-summary.ts` `summarizeTurnBatch`/`composeBatchScopePayload` | `allowUnverifiedSeal` opt-in(기본 false; regen·migration 미전달), 라벨 부여 |
| 가드 | `memory-summary-integrity.ts` | `isRollingSummaryGroundedInDialogue` = `diagnose(...)===null` (동작 동일, 실패 사유 분류만 노출) |
| 권위 라벨 저장 | `ScopePayloadV1` (`memory-summary-scope.ts`) | optional `sealAuthority` |
| 주입 가능 여부 | `isPromptInjectibleMemoryRecord` (`memory-turn-summary.ts`) | 라벨 행 제외 → Global exact·Medium·compaction·mirror·fingerprint가 한 지점에서 모두 제외 |
| 라벨 비권위 노출 | `memory-medium-term.ts` | `buildUnverifiedSealBlock` (링 15, RAW cutoff 동일) |
| wire 배치 | `contextBuilder.ts` + `types.ts` | `unverified-summary` 섹션(xml 그룹 없음 = DeepSeek 래퍼 밖) |
| 중복 reader | `memory-variant-switch-reconcile.ts` | 라벨 제외 + `sealAuthority` 전달 |
| fork | `memory-fork-snapshot.ts` payload rewind / `fork/route.ts` evidence SQL | 라벨 보존 / 라벨 행 evidence 제외 |
| 유저 수정 | `updateMemoryRecordById` | 수정 시 라벨 해제 |

판정: 새 권위 owner는 생기지 않았다. 다만 기존 wire에는 래퍼 밖 memory 채널이 없어 `types.ts` + `contextBuilder` 슬롯이 **새로 필요**하다(§10).

## 3. 사실 권위 분리가 "verified_fact"가 아닌 이유

S1은 `verified_fact`/`verified` 라벨을 만들지 않는다. 값은 `normal`(= 기존 동작과 동일, "가드 통과, 미검증") 과 `unverified_summary` 둘뿐이고, 가드 통과 행에 새 이름을 붙이지 않았다. "통과 = 진실 검증"이 아님은 §5의 cue 없는 가짜 과거 8건이 모든 arm에서 `normal`로 통과하는 것으로 증명된다.

## 4. 봉인 우회 금지 매트릭스 (E, s1ctl·s1pr 동일, `data/out-*.json#E_nonbypass`)

봉인(미확인)되는 경우: 3회 모두 "근거 없는 단정" 실패(`grounding_only_x3`, 변형 포함 `grounding_variants_x3`), 윈도 대화에 일반 OOC 턴이 포함된 평범한 구간(`plain_ooc_turn_in_window`).

봉인되지 않는 경우(모두 Luna 3회 호출, 기록 0): grounding 후 provider 오류/타임아웃, provider 오류 ×3, 타임아웃 ×3, 빈 출력 ×3, grounding 후 빈 출력, grounding 후 echo, echo ×3, 요약문 내 OOC 마커 ×3, 너무 짧은 invalid ×3, grounding 후 invalid, sparse-unanchored ×3, 요약 중 epoch 증가(stale), 요약 중 source reset 경계, branch IF 턴 구간, preference 구간, main_adopt 구간, 플래그 미전달. 4턴 미완 구간은 0회 호출·기록 0. 미확인 행에 대한 regen은 grounded 후보일 때만 라벨이 해제되고(s1pr), 비grounded 후보는 행을 바꾸지 않는다. baseline arm(main/ctl/pr)은 위 항목 중 어느 것도 봉인하지 않는다.

주의(열린 질문 → GPT 결정): "OOC 턴이 윈도 대화 안에 있음"(sealed unverified)과 "Luna 출력이 OOC 마커"(not sealed)를 다르게 처리했다. 전자를 우회로 볼지 GPT 판단이 필요하다. 또한 branch/preference/main_adopt 구간은 우회 금지를 지키는 대신 기존처럼 **여전히 정지**한다(한계).

## 5. 104건 반례 비교 (B, `B_cases104`)

원 반례 104행 = `short` 52 + `long` 52. **정정:** 감사 보고서의 `long` 라벨은 68–104자이며 80자 이상은 4행뿐이다. 80자 하한 때문에 main은 대부분 `too_short`로 막혔다. 그래서 `long`에 같은 꼬리 문장(" 두 사람은 밤이 깊도록 불가에서 장작을 정리하며 시간을 보냄.")을 붙인 파생 `xlong` 52행을 추가해 ≥80자 비교를 같게 맞췄다(총 156행). 파생행은 `variant=xlong`로 구분된다.

`xlong`(≥80자, 길이 효과 제거) 52행 = 가짜 과거 계열 44행(단서 없음 8행 포함) + legit 8행:

| arm | 가짜 과거 → 정상 봉인(`established`) | 가짜 → 차단(frontier 정지) | 가짜 → 미확인 봉인 | legit(정상 사건) 결과 |
|---|---|---|---|---|
| main | 8 | 36 | 0 | 8 모두 차단 |
| ctl | 8 | 36 | 0 | 8 모두 차단 |
| pr (#1591) | 28 | 16 | 0 | 8 모두 정상 |
| s1ctl | 8 | 0 | 36 | **8 모두 미확인으로 강등** |
| s1pr | 28 | 0 | 16 | 8 모두 정상 |

(legit 8행 = `scene-sequencing-ok` 4 + `user-promise-ok` 4. 표의 가짜 과거 열 합은 arm마다 44.)

패밀리별 xlong (`mentor-noiHu`/`lover-noiHu` = 단서 없음):
- `friend-persona`, `mentor-family`, `lover-hardcue-no-iHu`, `lover-그날` (명시 단서): main/ctl/pr 차단 → s1ctl/s1pr 미확인.
- `mentor-persona(-2)`, `lover-persona(-2)`, `mentor-nouser` (`이후`만 단서 또는 페르소나 없음): main/ctl 차단 → **pr/s1pr 정상 봉인(= #1591의 residual false-past 16+4)** → s1ctl 미확인.
- `mentor-noiHu`, `lover-noiHu` (단서 없음): **5 arm 모두 정상 봉인.** S1이 해결하지 못하는 별도 미해결 결함이다. S1은 모든 거짓 기억을 고친다고 주장하지 않는다.
- `scene-sequencing-ok`, `user-promise-ok` (legit): main/ctl 차단, pr/s1pr 정상, **s1ctl 미확인**.

`short`(<80자) 52행: main은 전부 `too_short`. ctl 이후 arm은 sparse anchor 규칙으로 판정되며 `sparse_unanchored` 50행은 미확인 봉인 대상이 아니라 **차단**(S1은 echo·sparse 구제 안 함). legit 중 2행(`user-promise` 단문)만 pr/s1pr 정상, s1ctl 미확인, 나머지 legit 6행은 차단.

해석(사실만): S1 단독(대조군 위)은 가짜 과거 36건을 래퍼 밖으로 옮기지만 **정상 사건 같은 문장도 같은 경로로 강등**한다(가드가 `이후` 문두를 구분하지 못하기 때문). #1591 위에서는 정상 사건이 강등되지 않지만, S1이 추가로 보호하는 것은 명시 단서 16건이다.

## 6. 16구간 봉인 결과 (C, 페르소나 `이름/호칭: 렌`)

| arm | 봉인 | normal / unverified | frontier | Luna 호출 | 정지 구간 |
|---|---|---|---|---|---|
| main | 0/16 | 0 / 0 | 0 | 3 | 1 |
| ctl | 0/16 | 0 / 0 | 0 | 3 | 1 |
| pr | 16/16 | 16 / 0 | 80 | 16 | – |
| s1ctl | 16/16 | 13 / 3 (구간 1·21·36) | 80 | 22 | – |
| s1pr | 16/16 | 16 / 0 | 80 | 16 | – |

s1ctl 호출 22 = 16 + 미확인 3구간 × 재시도 2(기존 3회 시도 한도 내, **추가 호출 아님**: baseline arm도 같은 3회를 시도하고 포기한다).
페르소나 없음: main만 구간 11에서 정지(frontier 10, 80자 하한), 나머지 4 arm은 16/16 정상(`C_seal16_nopersona`).
거절 사유 분리(A): main = 구간 1·21·36(문두 `이후`) + 12개 짧은 구간(<80); ctl = 1·21·36만; pr/s1pr = 0. 세 구간은 `이후` 문두 제거 시 모두 통과(`sequencingOnlyCause=true`), 진단 사유 `unsupported_user_linked_history`.

## 7. 30/50/80턴 최종 wire (D, deepseek-v4.1-flash 어댑터, `<LONG_TERM_MEMORY>` 래퍼)

페르소나, T80 기준(30/50은 `data/out-*.json#D_wire_*`):

| arm | 봉인 구간 | raw pool(교환) | current_memory chars | unverified chars | system tokens(추정) | 합계 chars(system+raw) | Luna 호출 |
|---|---|---|---|---|---|---|---|
| main | 0 | 80 (messages 162) | 0 | 0 | 6003 | 8,961 | 3 |
| ctl | 0 | 80 | 0 | 0 | 6003 | 8,961 | 3 |
| pr | 16 | 4 | 1,197 | 0 | 7,207 | 8,115 | 16 |
| s1ctl | 16 | 4 | 876 | 458 | 7,332 | 8,254 | 22 |
| s1pr | 16 | 4 | 1,197 | 0 | 7,207 | 8,115 | 16 |

- T30/T50 토큰: pr 6,654/6,896 vs s1ctl 6,771/7,021 (+117/+125). T80 s1ctl − pr = +125 tokens, +139 chars, 호출 +6.
- 하네스 fixture는 턴이 매우 짧아(평균 ~14자) main/ctl raw history가 2,291자에 그친다. **실제 RP 턴(수천 자)에서는 raw pool 80교환이 raw 입력을 크게 키운다.** 실제 크기는 이 실험이 측정하지 않았다.
- 이벤트 위치 (T80, s1ctl): 검 약속·수줍은 감정(구간 1), 누나 주장(21), 이별(36)이 `unverified_block(outside wrapper)`; 연애 제안/수락 해석, 검 약속 취소, NPC 서린, 커피, 산책은 `established_past(LONG_TERM_MEMORY)`. **관측된 불일치:** 약속 취소(구간 11)는 래퍼 안(확정)이고 그 취소 대상인 약속(구간 1)은 래퍼 밖(미확인)이다.
- 미확인 텍스트가 `LONG_TERM_MEMORY` 래퍼 안에 들어간 경우: 5 arm 모두 0 (`unverifiedInsideWrapper=false`).
- 전체 구간 요약이 하나 단위로 이동하므로 구간 1의 감정 문장도 미확인 구역으로 옮겨진다(사라지지 않으나 "확정 과거"가 아님). 미확인 구역 링은 15구간이라 그보다 오래된 미확인 행은 노출에서 빠진다(한계).

## 8. 라벨 보존/세탁 검증 (F, 30구간 150턴, 라벨 8행 + Global compaction 실제 발생)

`data/out-s1*.json#F1~F6`. baseline arm은 첫 라벨 구간(구간 1)에서 정지하므로 F 시나리오가 skip된다(`records=0`).

| 항목 | s1ctl | s1pr |
|---|---|---|
| compaction 실제 발생 | 1회(스텁 시임, `globalProjectionKind=global_compact`) | 동일 |
| compaction 입력/Global/Medium/저장 mirror 안의 미확인 텍스트 | 0 / 0 / 0 / 0 | 동일 |
| 150턴 wire: 래퍼 안 / 미확인 구역 / RAW 소유 구간 | 0 / 4 / 4 (합 8 = 라벨 전부) | 동일 |
| episodic fact 행, memory_meta | 0행, 변경 없음 | 동일 |
| 유저 수정 | 라벨 `normal`, `userEdited=true`, Global에 포함, 미확인 구역 미포함 | 동일 |
| 삭제(inactive) | Global·미확인 구역에서 제거 (행 고유 전체 텍스트로 확인) | 동일 |
| variant-switch reconcile mirror | 미확인 0 | 동일 |
| fork 복사 | 라벨 보존(`unverified_summary`,`normal`), fork lorebook에 미확인 0 | 동일 |
| fork 라우트 evidence SQL | 라벨 행 제외 필터 존재(소스 텍스트 검사) | 동일 |
| regen(비grounded 후보) | 행·라벨 불변 | 동일 |
| regen(grounded 후보) | 대조군 가드가 원문 구간 1을 거절 → 라벨 유지 | 라벨 `normal`로 해제 |

정정: 1차 실행에서 `deletedRowInUnverifiedBlock=true`는 하네스 오류(라벨 행 8개의 앞 18자 동일)였고, 행별 고유 텍스트(`(구간 N)` 태그, 전체 문자열 비교)로 고쳐 재실행해 false가 되었다. 1차 compaction은 Global이 9,195자(<10,000)라 트리거되지 않아 요약 문장을 늘려 재실행했다(최종 결과만 위 표).

### 변이(mutation) 증거 — 각 보호 지점을 제거하면 실제로 깨지는가 (`data/mutation/`)

s1ctl에서 한 줄씩 제거, 나머지 불변, 복구 후 재확인(`probes/mutate.sh.txt`).

| 제거한 보호 | 관측된 깨짐 |
|---|---|
| `isPromptInjectibleMemoryRecord`의 라벨 제외 | compaction 입력 8, Global 8, Medium 4, 저장 mirror 8, **래퍼 안 8**, fork lorebook 오염 (세탁) |
| variant reconcile reader의 라벨 제외 | mirror에 미확인 6 (세탁) |
| fork payload의 `sealAuthority` 전달 | fork 라벨이 `normal`,`normal`로 소실 + fork lorebook 오염 (세탁) |
| fork route evidence SQL 필터 | 소스 검사 false |
| `updateMemoryRecordById`의 라벨 해제 | 수정 후에도 `unverified_summary` 유지, 수정문이 미확인 구역에 노출 |

즉 위 5개 지점이 각각 필요하며(= 변경 범위), 하나라도 빠지면 세탁/소실이 재현된다.

## 9. 비용·호출 (provider 0회)

- 이번 실험의 Luna/Main RP 호출: 0. 스텁 호출 수만 표기(§6, §7).
- 제품 관점 추가 호출: 0 (재시도 3회 불변). 입력 증가는 wire의 미확인 구역과 규칙문 약 +125 tokens(T80, 3구간 기준).
- 길이 목표(한국어 RP 평균 2,700–3,500자, 3,200+ 지향)는 출력 상한을 추가하지 않았으므로 건드리지 않았고, 실제 출력 길이는 이 단계에서 **미측정**이다(B3/K2 재발 여부는 유료 A/B에서만 관측 가능).

### 최소 실제 RP A/B 호출 수와 예상 비용 (실행하지 않음)

wire가 달라지는 arm은 (a) main/ctl(정지: 요약 없이 raw), (b) pr(전부 확정), (c) s1ctl(래퍼 밖 구역). 장면 4개: 검 약속 회상, 누나 주장 회상, 이별 이후 반응(정상 이벤트 보존), 정상 감정/NPC 서린(대조). 호출당 비용은 `main-rp-b2-core-authority-split-live/REPORT.md` 실측(예산 환율 1,700원, 캐시 할인 없음)을 사용: DeepSeek ≈1.3–1.7원, Gemini 3.8 flash ≈17.5–26.2원, Sol ≈42.8–49.0원.

| 구성 | 호출 수 | 예상 비용 |
|---|---|---|
| 최소: 3 arm(main, pr, s1ctl) × 4 장면 × DeepSeek n=3 | 36 | ≈ 47–61원 |
| 권장: 위 + Gemini 3 arm × 4 장면 × n=1 + Sol 2 arm(pr, s1ctl) × 4 장면 × n=1 | 36 + 12 + 8 = 56 | ≈ 600–770원 (중앙 ≈ 680원) |

권장안 상한 ≈ 770원 < 1,000원이므로 사전 게이트(1,000원 미만) 통과 후보이다. 1,000원 이상이면 별도 승인이 필요하다. 모든 원문은 GPT가 판정하고 Cursor는 점수를 매기지 않는다. **이번 단계에서는 실행하지 않는다.**

## 10. 실제 제품 변경 최소 범위와 회귀 위험 (제안일 뿐 승인 전)

필수 변경(실험에서 모두 필요했음): `memory-summary-integrity`(진단 사유 노출), `memory-summary-scope`(필드), `memory-rolling-summary`(opt-in 경로·라벨), `memory-turn-summary`(주입 제외·수정 해제·리스트), `memory-medium-term`(미확인 블록), `types.ts`+`contextBuilder`(래퍼 밖 슬롯), `memory-variant-switch-reconcile`, `memory-fork-snapshot`, `fork/route.ts`. 실험 패치는 11 파일 +198/−30.

추가 확인이 필요한 실제 wire 접점(실험 하네스는 `buildContext`까지만 조립함): `memory-injector`/`MemoryInjection` 반환 필드, 채팅 route 4곳과 `nextTurnAssemblyPreparation`이 `unverifiedSummaryBlock`을 전달하도록 하는 배선.

회귀 위험:
1. 대조군 위에 얹으면 정상 사건(약속·이별·NPC 주장)이 "미확인"으로 강등되어 관계 연속성이 흔들릴 수 있다(§5·§7).
2. #1591 위에서는 `이후`-only/페르소나 없음 가짜 과거 20건과 단서 없는 8건이 계속 확정으로 남는다(S1 효과 없음).
3. 미확인 구간 안의 정상 감정/행동은 래퍼 밖으로 이동해 "확정 과거" 강도가 약해진다. LLM이 이를 어떻게 쓰는지는 미측정이다.
4. 미확인 링 15구간 초과분 비노출, branch/preference/main_adopt 구간 정지 유지.
5. 새 wire 슬롯은 토큰·프롬프트 순서에 영향을 준다(약 +125 tokens).

## 11. 검증 실행 기록

- `git diff --check` (S1 패치 대 `4d6862c7`): 통과.
- `npm run typecheck:app`: s1pr / s1ctl / pr(baseline) 모두 exit 0.
- 기존 회귀 묶음 `src/lib/memory/*.test.ts src/services/*.test.ts` (1,309–1,310 테스트): `pr` 62 fail, S1 적용 63 fail. 정규화한 실패 목록 차이는 `memory-branch-noncanon-phase2.test.ts` 파일 단위 hook 실패 1건(`SQLITE_BUSY`, worktree 동시 DB 잠금)뿐이었고, 해당 파일을 단독 3회 재실행하면 S1/pr 모두 `8 pass / 2 fail`로 동일(기존 실패). 즉 **S1이 새로 깨뜨린 테스트는 없음**(실패 목록: `data/regress-*.txt`). 62건은 `pr` baseline에 이미 있던 실패다(= 이번 단계 밖).
- 전체 `npm run typecheck`는 테스트 파일의 기존 오류로 실패하는 알려진 상태이며 이번 변경과 무관.

## 12. STOP 판정

티켓 STOP 조건 대비:

| 조건 | 결과 |
|---|---|
| 정상 사건/감정/관계 보존 실패 | **YES (대조군 위 S1)**: 정상 약속·이별·NPC 주장이 미확인으로 강등. #1591 위 S1에서는 NO. |
| 미확인 내용이 사실로 세탁 | NO (§4·§8). 단 가드 통과 자체가 진실이 아니라는 점은 §5에서 확인(단서 없는 8건 확정). |
| 다른 owner와 중복되는 새 권위 | NO (필드 1개, 기존 owner 재사용). |
| 새 DB/verifier/큰 compat layer 필요 | NO (단, 래퍼 밖 wire 슬롯과 반드시 필요한 reader 5곳 보호). |
| 출력량 감소(B3/K2 재발) | **미측정** (유료 A/B 필요). 근거 없이 NO라 하지 않음. |
| 안전 처리에 무관한 큰 변경 필요 | 경계 사례: wire 슬롯 배선은 route 다수 접점. |

**결론: 부분 STOP.** S1을 단독 제품 수정으로 올리는 것은 권장하지 않는다. 격리·라벨 보존 설계는 기술적으로 성립하지만, 이득이 명시 단서 가짜 과거 16건으로 한정되고(#1591 위), 단서 없는 가짜 과거는 별도 결함으로 남는다. #1591 제품 코드는 변경하지 않았다.

## 13. GPT 검수 요청 사항

1. §4의 `plain_ooc_turn_in_window`(윈도 대화에 일반 OOC 턴 포함 시 미확인 봉인)를 우회로 볼지.
2. 대조군 위 S1의 정상 사건 강등을 수용 불가로 볼지, 그리고 #1591 위 S1의 이득(명시 단서 16건)이 wire 슬롯 변경 범위를 정당화하는지.
3. 단서 없는 가짜 과거(§5) 별도 owner(원문 증거 연결)를 다음 단계로 열지.
4. 유료 A/B(§9)를 승인할지, 승인 시 어떤 구성(최소 36호출 / 권장 56호출)으로 할지. 승인 전에는 실행하지 않는다.

## 14. 파일

- `data/out-{main,ctl,pr,s1ctl,s1pr}.json` — 모든 결과(A–F), `data/logs/` 실행 로그
- `data/mutation/` — 변이 5종 결과·로그
- `data/regress-*.txt` — 기존 회귀 실패 목록(정규화)
- `probes/s1-isolated.test.ts.txt`, `run.sh.txt`, `summarize.py.txt`, `mutate.sh.txt`
- `s1-experiment.patch.txt` — S1 실험 diff(미적용)
