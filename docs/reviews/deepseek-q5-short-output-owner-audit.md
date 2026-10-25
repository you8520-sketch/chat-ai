# DeepSeek Q5 짧은 출력 · 감정 반응 부족 — owner 감사

조사 기록이다. Production prompt, routing, provider 옵션, billing, runtime code는 바꾸지 않았다. #1545, #1550은 병합하지 않았고 수정하지 않았다. 유료 호출은 하지 않았다(기존 원문·usage 재사용). 문체 점수는 매기지 않는다.

기준: `origin/main` `8cc25887ce71ebd8f5933698dabae413999d32c7`.

## BEFORE

| 출처 | fixture | DeepSeek `v4.1-flash` 원문 글자 | Claude `opus-5.5` 원문 글자 |
|---|---|---:|---:|
| Phase 2 (#1318) Q2/Q4/Q5/Q6/Q8/Q9 | 라이크/렌, 로비 이력(직전 assistant 40자, 공백 제외) | 1,793 / 1,960 / 2,053 / 2,067 / 1,978 / 2,131 | 3,353 / 4,101 / 3,045 / 4,329 / 4,179 / 3,534 |
| Phase 2 Q3 (사이렌 이벤트), Q7 (자동진행) | 같은 로비 이력 / 창가 이력 | 4,426 / 4,785 | 3,487 / 3,859 |
| Phase 2 Q1 | 같은 로비 이력 | `"네"` (3자) | 4,010 |
| #1545 Q5 BEFORE / AFTER | `CONTROLLED_FIXTURE_NOT_LIVE_PRODUCTION` | 1,888 / 1,906 (stop) | 2,774 / 3,219 (stop) |
| #1550 Q5 AFTER | `NEW_CONTROLLED_FIXTURE_NOT_1545_PARITY` | 929 (stop) | 3,104 (stop) |

모든 DeepSeek/Claude 호출은 `max_tokens` 없음, `finish_reason=stop`이다. 같은 모델이 같은 owner로 4,426–4,785자까지 쓴 기록이 있으므로 929자는 숨은 출력 상한 결과가 아니다.

## 조사한 owner와 결과

최종 wire는 #1550 AFTER 요청 본문 두 개(`cursor/scene-pacing-micro-focus-d352`의 `docs/reviews/phase2-q5-micro-focus-after/wire/`)를 그대로 비교했다.

| 항목 | 결과 |
|---|---|
| 길이 owner | DeepSeek·Claude 모두 최종 user 턴 맨 아래 `3,200자 이상` 문장 1회. 시스템 길이 문장 없음 |
| 출력 상한 | 둘 다 `max_tokens` 없음, `stream:false`(실험), 서버 보강·이어쓰기·recovery 전부 OFF(`TURN_LENGTH_SUPPLEMENT_API_ENABLED=false`, 1-call invariant) |
| 종료 처리 | `detectAdultGenerationFailure`는 재앙적 짧은 응답만 실패. 정상 `stop` 미달은 그대로 저장. 스트림 글자 상한·절단 guard 없음 |
| provider 옵션 | DeepSeek: `temperature 0.92`, `top_p 0.92`, `thinking disabled`, `reasoning_effort none` (CI non-thinking canonical). Claude: `temperature 0.82`, `thinking disabled`, `effort low`. 모델별 canonical 정책이며 결함 증거 없음 |
| system 본문 | 순서와 DeepSeek 전용 `Qwen/DeepSeek 보강` 한 줄(내부 규칙 비노출)만 다르다. 같은 내용의 블록이 DeepSeek는 card 앞, Claude는 card 뒤. 길이·장면·감정 지시는 동일 |
| history·user 턴 | 바이트 동일 (messages 1–3 동일) |
| 모델별 길이 보정 | Flash에는 없다. `resolveDeepSeekLengthAdapterSection`은 `deepseek-v4-pro` + 실험 env(B/C)에서만 동작. 최종 wire에 `[SHORT HISTORY]` / `[SHORT USER TURN]` / `System Reminder` 0건 |

### 확인된 사실 (증거)

1. 이 fixture의 DeepSeek wire에서 thin-history 판정(`resolveDeepSeekShortHistoryLengthExtra`)과 짧은 유저 턴 판정(`resolveDeepSeekShortUserTurnExtra`)은 둘 다 참이다(직전 assistant 40자, 유저 12자; 실제 실행 확인). 그러나 해당 DeepSeek 전용 문구는 `contextBuilder`의 `deepSeekXmlMode` 분기에서 의도적으로 주입하지 않는다(`Competing length owners ... OFF`, `docs/audits/43-rp-mode-unification/MODE_PROMPT_OWNER_MAP.md` 0건). 사전 정리(`legacy-prose-diet-2026-09-27`)에서 dead로 분류됐다.
2. 같은 로비 이력에서도 DeepSeek는 1,793–2,131자(6건)와 4,426·4,785자(Q3, Q7)로 갈린다. thin-history만으로 길이가 결정되지 않는다. Q3(사이렌)처럼 소재가 있는 장면은 길고, Q5(`무서워. 그래도 안 갈게.`)처럼 이벤트 소재가 적은 입력은 짧다.
3. 과거 감사(`99c7f4aa`, PR #455/#555)는 "true-zero-reasoning DeepSeek에서 길이 문구 효과는 미증명(`HISTORICAL_LENGTH_BLOCK_EFFECT_UNDER_TRUE_ZERO_REASONING_PROVEN=false`)"이고, 이력 형태가 DeepSeek 길이에 영향을 줄 수 있으나 인과는 단정하지 못한다고 기록했다. 길이 블록 A/B/C와 SHORT HISTORY dense-internal 후보 D는 greeting-only 이력에서 2,700 바닥을 못 넘었거나 provider 결과가 없다.
4. #1550(929자)과 #1545(1,888/1,906자)는 다른 fixture다. 프롬프트 토큰이 4,449 대 약 4,990–5,030이다(#1550 카드가 짧다). #1545 요청 본문은 저장되지 않아 두 wire를 직접 diff할 수 없고, 929와 1,888의 차이를 fixture 차이와 표본 분산으로 분리할 수 없다.

### 공통 owner에서 DeepSeek에만 불리할 수 있는 후보 (미증명)

- `[COMMON PROSE]`: "내면은 현재 판단·행동·선택을 바꾸는 만큼 쓴다", "평범한 동작은 줄인다", "이미 드러난 의미는 해설로 되짚지 않는다". 같은 문장 아래 Claude는 풍부하게 쓴다. 비-thinking DeepSeek가 이를 더 축자적으로 따른다는 가설은 이 원문들만으로 검증되지 않는다.
- `[SCENE PACING]` MICRO: #1550이 `허용된 변화`를 `전개 초점`으로 바꿨다. 그 효과는 이 fixture 한 표본으로 측정되지 않았다.
- 캐릭터 카드: `해맑고 단순`, `귀찮은 걸 싫어함`, `분위기를 가볍게 푸는 낙천가`가 감정 반응을 가볍게 처리하는 방향과 일치한다. 캐릭터성 유지가 요구사항이므로 변경 대상 아님.

## ROOT CAUSE

분류: `ROOT_CAUSE_UNCONFIRMED`

확정된 결함은 없다. 공통 owner 중복, 길이 owner 누락, 출력 상한, 종료 처리 절단, 스트림 guard, 죽은 adapter 오주입은 최종 wire와 코드로 모두 배제했다. 남는 후보는 (a) 비-thinking DeepSeek가 얇은 이력·이벤트 소재가 적은 감정 입력에서 3,200자 목표보다 이른 지점에서 장면 단위를 닫는 모델 행동, (b) 공통 문체 문구의 모델별 해석 차이이다. 현재 근거로 둘 중 하나를 고립할 수 없고, 단일 표본으로 모델 고유 결함도 단정하지 않는다.

## AFTER / REMOVED / PRESERVED

- 코드 변경 없음. 추측성 patch 없음.
- 죽은 DeepSeek adapter(`SHORT HISTORY` 등), 길이 문장, provider 옵션(thinking/reasoning/temperature), 모델 설정·과금은 건드리지 않았다.
- 유지: 3,200자 soft target과 출력 상한 없음, Claude 경로, NORMAL 공동서술, 캐릭터 설정, 1-call invariant.

## REGRESSION RISKS

수정이 없어 신규 위험은 없다. 죽은 `SHORT HISTORY` 문구를 되살리면 길이 owner가 둘이 되고(단일 length owner 정책과 충돌), true-zero-reasoning에서의 효과는 과거에도 미증명이다.

## PROOF

- 최종 wire 비교: #1550 AFTER DeepSeek/Claude 요청 본문 (messages 1–3 동일, system은 순서·한 줄 차이, `[SHORT HISTORY]`·`System Reminder`·`DEEPSEEK LENGTH` 0건, 길이 문장 1건).
- 실행 확인: `resolveDeepSeekShortHistoryLengthExtra` → true, `resolveDeepSeekShortUserTurnExtra` → true, 직전 assistant 공백 제외 40자.
- 코드: `src/services/contextBuilder.ts`(`deepSeekXmlMode` 분기), `src/lib/deepseekPromptStructure.ts`, `src/lib/sharedNovelProseModelAdapters.ts`, `src/lib/cheaperInferenceConfig.ts`, `src/lib/turnApiBudget.ts`.
- 과거 원문·usage: `ac755c74`, `a9ce4492`(`cursor/main-rp-prose-quality-d352`), `a94a4165`(`cursor/scene-pacing-micro-focus-d352`), `99c7f4aa`.

## 실제 품질 검증에 남은 항목

원인 고립에는 유료 호출 승인이 필요하다. 승인이 나면 같은 새 fixture에서 한 번에 하나만 바꾸는 최소 실험을 제안한다.

1. 같은 wire에서 DeepSeek를 N회 반복(표본 분산 측정). 929/1,888/1,906/2,053이 분산 안인지 확인.
2. 이력만 길게(직전 assistant 3,000자 수준) 바꾼 DeepSeek N회: 이력 형태 가설 검증. 길어지면 owner는 길이 문구가 아니라 이력 구성(또는 opening 처리)이다.
3. 1·2에서 이력 효과가 확인될 때만, 기존 `DEEPSEEK_SHORT_HISTORY_LENGTH_EXTRA` 계열을 단일 owner 안에 긍정형 한 문장으로 통합하는 후보를 설계한다.

최종 생성 품질 판정은 GPT가 한다. 이 PR은 조사 기록이며 병합 대상 behavior patch가 아니다.
