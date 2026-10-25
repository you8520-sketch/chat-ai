# PHASE B — 공용 문체와 모델별 보완 구조

조사 기록이다. Production 프롬프트, 라우팅, 플래그, 런타임 코드는 바꾸지 않았다. 유료 모델 호출은 하지 않았다. 문체 점수는 매기지 않는다.

기준 커밋은 `origin/main` `1b7813c7690028d9dabd25ec09d955a01d3250bf`이다. 토큰은 `estimateTokens` (글자 수 × 0.9)다. 공급업체 usage가 아니다.

Railway 변수는 이 환경에서 읽지 못했다. `.env.example`과 이번 프로세스에는 `SHARED_NOVEL_PROSE_V2_ENABLED`, `PROSE_VNEXT_ENABLED`, `PROSE_VNEXT_ROLLOUT_ENABLED`, `SNPV2_DEEPSEEK_LENGTH_ARM`이 없다. 아래 주입 여부는 코드 기본값이다. Railway가 이 플래그를 켜 두면 허용된 사용자에게만 V2 또는 VNext가 들어가고, 그 값은 여기 표와 다르다.

## BEFORE

선택 가능한 Main RP는 `MAIN_RP_USER_SELECTABLE_OPTIONS` 여섯 개다.

- `deepseek-v4.1-flash`
- `gemini-3.1-pro-preview`
- `gemini-3.7-flash`
- `gemini-3.8-flash`
- `gpt-5.6-terra`
- `claude-opus-5.5`

공용 문체의 라이브 본문은 `COMMON_PROSE_BLOCK`이다. `resolveProseStyleSection`이 undefined를 반환하면 `buildAdvancedProseNsfwGuidelines`가 그 본문을 넣는다. 코드 기본값에서 여섯 모델 모두 이 경로다. VNext, Muse M1, Shared Novel Prose V2는 게이트가 꺼져 있어 들어가지 않는다.

같은 라이크 fixture, 페르소나 렌, 인터랙티브 한 턴, `nsfw: false`, 제작자 문체 빈 문자열로 조립했다. 장면 지시는 이 측정에 넣지 않았다. 자동진행 측정(PR #1329)과 합계를 비교하지 않는다.

## PROBLEM

공용 문체와 모델별 문체 보완이 따로 있는 구조로 이미 갈라져 있다. 다만 모델별 문체 문장은 기본 경로에 없다. 모델마다 다른 것은 문체가 아니라 사용자 서술 권한, 출력 위생, 외형 변주, DeepSeek XML 캐시 배치다.

`[SCENE FLOW]`는 문체 섹션 안에 있다. 인터랙티브 와이어는 그 자리를 페이싱 큐로 바꿀 수 있다. 문체 소유와 장면 소유가 한 문자열을 공유한다.

V2 본문 `PROSE_STYLE_SECTION_V2`는 1,339 estimated tokens다. 라이브 문체 섹션 `PROSE_STYLE_SECTION`은 711이다. V2를 공용으로 켜면 문체 구간은 줄어들지 않고 커진다.

## OWNER MAP

| 책임 | 라이브 owner | 이번 기본 경로 |
|---|---|---|
| 공용 문체 | `COMMON_PROSE_BLOCK` (`src/lib/advancedProseNsfwGuidelines.ts`) | 여섯 모델에 1회 |
| 한국어 출력 언어 | `buildOpenRouterKoreanProseTopBlock` | 여섯 모델에 1회. 캐시 rules |
| 대사·지문 레이아웃 | `buildWebnovelOutputLayoutRecencyBlock` | 여섯 모델에 1회 |
| 마크다운 표기 | `WEBNOVEL_OUTPUT_FORMAT_BLOCK` | 문체 번들 맨 앞. 레이아웃 블록과 문장이 같지 않다 |
| 모델별 문체 보완 | `resolveProseStyleSection`의 VNext / Muse / V2 | 기본값에서 미주입 |
| DeepSeek 길이 어댑터 | `resolveDeepSeekLengthAdapterSection` | `deepseek-v4-pro`와 env B/C일 때만. 현재 선택 모델에는 없음 |
| 장면 진행 | `buildSceneDirective`와 와이어의 scene pacing | 이 측정에는 장면 지시를 넣지 않음 |
| 출력 길이 | `USER_TAIL_LENGTH_OWNER_SENTENCE` | 유저 턴 꼬리. 여섯 모델의 current user turn이 1,096으로 같다 |
| 캐릭터·제작자 문체 | 정본 청크, `buildCreatorNarrationStyleBlock` | 제작자 문체가 빈 문자열이면 섹션 자체가 없다 |
| NORMAL 사용자 서술 | `no-godmodding` / 자동진행이면 `buildAutoProgressionUserControlBlock` | 인터랙티브 공통 블록. Gemini 3.1만 보충 문단 |

새 owner는 만들지 않았다.

## 모델별 주입

추정 토큰이다. 공용 문체 1회는 번들 안의 `[COMMON PROSE]`다. 모델별 문체 보완 문장은 없다.

| 모델 | 공용 문체 | 모델별 문체 보완 | 다른 문체 관련 규칙 | 선택 조건 | 시스템 | 캐시 rules / character / dynamic |
|---|---:|---|---|---|---:|---|
| deepseek-v4.1-flash | 599, 번들 1,185 안에 1회 | 없음 | 한국어 상단 738, 레이아웃 670, 웹소설 표기 97, SCENE FLOW 110 | legacy. V2/VNext off | 15,347 | 4,197 / 9,738 / 1,410 |
| gemini-3.1-pro-preview | 599, 번들 1,185 안에 1회 | 없음 | 위와 같은 문체 규칙 | legacy | 15,491 | 12,094 / 1,185 / 2,210 |
| gemini-3.7-flash | 599, 번들 1,185 안에 1회 | 없음 | 위와 같음 | legacy | 15,215 | 11,817 / 1,185 / 2,210 |
| gemini-3.8-flash | 599, 번들 1,185 안에 1회 | 없음 | 위와 같음 | legacy | 15,215 | 11,817 / 1,185 / 2,210 |
| gpt-5.6-terra | 599, 번들 1,185 안에 1회 | 없음 | 위와 같음 | legacy | 15,215 | 11,817 / 1,185 / 2,210 |
| claude-opus-5.5 | 599, 번들 1,185 안에 1회 | 없음 | 위와 같음 | legacy | 15,215 | 11,817 / 1,185 / 2,210 |

문체 번들 1,185는 `[WEBNOVEL OUTPUT FORMAT]` 97, `[SCENE FLOW]` 110, `[COMMON PROSE]` 599, 그리고 15+ 안전 계약과 구분자다. `promptAudit` signature detector는 이 인터랙티브 조립에서 중복 히트 0건이다. 히트가 있어도 확정 중복이나 절감량으로 쓰지 않는다.

문체가 아닌데 모델마다 다른 구간:

| 구간 | 대상 | 추정 차이 | owner |
|---|---|---:|---|
| `Qwen/DeepSeek 보강` 한 줄 | DeepSeek만 | contamination guard 856 vs 799, +57 | 출력 위생 |
| 외형 변주 한 줄 | DeepSeek만 | character canon 8,527 vs 8,477, +50 | 정본 렌더 |
| `[USER AGENCY — GEMINI 3.1 BODY/INTENT BOUNDARY]` | Gemini 3.1 Pro 인터랙티브만 | no-godmodding 1,263 vs 987, +276 | 사용자 서술 권한 |

Gemini 3.7, Gemini 3.8, Terra, Opus 5.5의 섹션 토큰은 서로 같다. 시스템 합계 15,215다. Gemini 3.1은 그 합계에 서술 권한 보충 276이 더해져 15,491이다. DeepSeek 섹션 합은 위생 57과 외형 변주 50을 더한 107이 더 크고, 시스템 합계 15,347과의 나머지 약 25는 XML 래핑과 join이다. DeepSeek character 캐시 버킷이 큰 이유는 그 XML 모드가 정본을 character 쪽에 두기 때문이다.

## PROPOSED DESIGN

라이브 구조가 이미 다음 세 층이다.

**COMMON ESSENTIAL PROSE.** `COMMON_PROSE_BLOCK` 한 블록. 자연스러운 한국어 해체 지문, 감정은 행동으로, 재해설 금지, 조용한 장면의 이어짐, 대사 집중. 여섯 모델에 한 번.

**MODEL-SPECIFIC CORRECTION.** 기본 경로에는 문체 보완 문장이 없다. 약점이 출력으로 확인되기 전에는 넣지 않는다. 이미 있는 DeepSeek 위생·외형 변주와 Gemini 3.1 서술 권한 보충은 문체 블록으로 옮기지 않는다.

**SEPARATE EXISTING OWNERS.** 언어, 레이아웃, 안전, 정본, 제작자 문체, 기억, 장면 지시, 길이, NORMAL 권한은 지금 owner에 둔다.

V2 코어(714)와 V2 문체 섹션(1,339)은 이 층의 대체재가 아니다. 게이트가 꺼져 있고, 라이브 문체 섹션보다 길다.

## TOKEN DELTA

제안은 기본 경로를 유지하는 것이다. 여섯 모델의 예상 증감은 0이다.

참고로만, 게이트를 켜서 V2 문체 섹션으로 바꾸면 문체 섹션이 711에서 1,339로 늘어난다. 추정 +628이고 캐시 character 버킷도 바뀐다. 절감안이 아니다.

`[SCENE FLOW]` 110을 문체 섹션에서 빼는 안은 와이어가 그 자리를 항상 페이싱 큐로 바꾸는지 확인되기 전에는 절감으로 세지 않는다.

캐시. 비DeepSeek 모델의 character 버킷 1,185는 문체 번들 전체다. 공용 문체를 고치면 그 버킷이 무효가 되고, 정본이 들어 있는 rules 버킷(약 11,817)은 남을 수 있다. DeepSeek XML 모드에서는 정본과 문체 번들이 character 버킷 9,738에 함께 있다. 문체 한 줄을 고쳐도 그 큰 버킷이 무효가 된다. 토큰이 줄어도 캐시 적중 비용은 따로다.

## 분류

- MUST KEEP. `COMMON_PROSE_BLOCK`. 한국어 `[OUTPUT LANG]`. `[OUTPUT LAYOUT]`. `[WEBNOVEL OUTPUT FORMAT]`. 15+ 안전 계약. 유저 턴 길이 문장. 제작자 문체 섹션. `no-godmodding`과 자동진행 권한 블록. 장면 지시 owner. DeepSeek 위생 보강, DeepSeek 외형 변주, Gemini 3.1 서술 권한 보충.
- MERGE INTO COMMON. 이번 측정으로 합칠 문장은 없다. V2 코어는 주제가 겹치지만 더 길고 라이브가 아니다.
- MOVE TO MODEL-SPECIFIC. 옮길 공용 문장은 없다. 출력으로 확인된 모델 약점이 이 조사에 없다.
- SAFE TO DELETE. 없다. `IMMERSIVE_PROSE_BLOCK`과 `DEEPSEEK_V4_PRO_KOREAN_STYLE_BLOCK`은 라이브 블록의 별칭이라 두 번째 주입이 아니다.
- SEPARATE FOLLOW-UP. V2, VNext, Muse 게이트와 그 본문. `[SCENE FLOW]`가 문체 문자열 안에 있는 것. Railway 플래그 실측. `chatModels.opusPublicRemoval.test.ts`가 선택 모델을 3개로 세는 낡은 단언. DeepSeek XML 캐시 버킷.

## PRESERVED

정본, 기억, 안전, 레이아웃, 길이, 제작자 문체, 사용자 서술 권한, 장면 지시. 출력 길이 3,200자 정책.

## REGRESSION RISKS

이번 PR은 프롬프트를 바꾸지 않으므로 동작 위험은 없다. 나중에 공용 문체를 줄이면 다음이 가능하다.

- 이미 안정적인 모델의 지문이 짧아지거나 대사가 늘어남
- 심리·환경 묘사와 조용한 장면이 일찍 끝남
- 감정 재해설이나 반복 동작이 다시 늘어남
- 캐릭터 말투와 제작자 문체 우선순위가 흔들림
- 자동진행·재생성은 같은 문체 번들을 쓰므로 인터랙티브와 함께 바뀜
- DeepSeek은 문체 수정이 정본이 들어 있는 character 캐시 블록을 무효화함

## 검증 계획

구현은 이 PR 다음이다. 같은 라이크 fixture, 페르소나 렌, 같은 창가 비트, 선택 모델 각각에 대해 현재 `COMMON_PROSE_BLOCK`과 짧은 후보를 메모리에서 조립한다. Cursor는 호출과 원문 제출만 한다. GPT와 사용자가 한국어, 심리·감정·환경, 대사 비중, 정본, 사용자 서술 권한, 추정 토큰과 공급업체 usage를 읽는다. 품질이 떨어지거나 개선 근거가 없으면 후보를 넣지 않는다. 모델별 보완 문장은 그 모델의 반복된 약점이 원문에 보일 때만 추가한다.

## CLASSIFICATION

`ROOT_CAUSE_UNCONFIRMED`에 해당하는 구현 결함은 없다. 불확실성은 Railway 플래그와, 공용 문체를 더 줄여도 품질이 유지되는가다. 기본 코드 경로에서는 여섯 모델이 같은 공용 문체를 한 번 받고, 모델별 문체 보완은 없다.
