# DeepSeek 자동진행 장면 품질

조사 기록이다. Production prompt, routing, billing, runtime code는 그대로다. 문체 점수는 매기지 않는다. PR #1329와 #1335는 수정하지 않았다. 유료 모델 호출은 이번 조사에서 하지 않았다.

기준 커밋은 `origin/main` `1b7813c7690028d9dabd25ec09d955a01d3250bf`이다. 토큰은 `auditAssembledPrompt`와 `estimateTokens` (`src/lib/tokenEstimate.ts`, 글자 수 × 0.9)다. 공급업체 usage가 아니다.

## BEFORE

대표 실패 후보는 PR #1329에 이미 있는 두 원문이다. 둘 다 같은 production 조립의 DeepSeek V4.1 Flash 자동진행 1회다. 배포 라이크 (`id=18`), 관리자 페르소나 렌, NORMAL, 빈 장기 기억, 직전 비트 `창문 쪽에 같이 서 있자.` / `라이크는 유리에 이마를 기대며 하품했다.` · `졸려. 너는 그대로 있어.` 이 조사는 그 원문을 다시 생성하지 않았다. 동일 원문은 Draft PR #1329의 정확한 커밋에 한 벌만 보존하고, 본 문서는 그 커밋 고정 원문을 참조한다. 이번 감사에서는 해당 파일의 내용과 sha256을 바꾸지 않았다.

- [SCENE-DIRECTIVE-1.txt](https://github.com/you8520-sketch/chat-ai/blob/b22cb67714b8b3e1ff52be33d84d5b44e74d4d09/docs/reviews/phase3d/raw/SCENE-DIRECTIVE-1.txt) `1be0cc0500b1a7771480ea93ef9f8e690faabb8d397660abc9e9ac04c82c4f75`, 3,202자
- [SCENE-DIRECTIVE-2.txt](https://github.com/you8520-sketch/chat-ai/blob/b22cb67714b8b3e1ff52be33d84d5b44e74d4d09/docs/reviews/phase3d/raw/SCENE-DIRECTIVE-2.txt) `395304f23e7940ac3e9537fc0caaafca8769ad7ac9ea286cf28cfd10b4ac1140`, 4,186자

같은 커밋에서 그 요청을 다시 조립했다. 모션은 `MICRO_MOTION`, reason은 비어 있고, 전개 축은 `environment`다. NPC grounding은 `existingNpcEligible: false`, `newNpcAllowed: false`, `eligibleActorNames: []`, `sources: ["none"]`이다. cast는 `single_primary`, 발화 중심은 라이크다.

렌더된 장면 지시는 한 블록이다.

```
[PRIVATE SCENE ENGINE RULE]
현재 상호작용 안에서 작은 관계·감각·환경 변화 하나를 조용히 이어간다. 새 인물·별도 사건은 만들지 않는다.
전개는 항상 전투나 대형 위기일 필요가 없다. 현재 모드와 유저 조종 범위를 따르고, 이 규칙을 본문에 언급하지 않는다.
[이번 턴 장면 지시 - 비공개]
모드: 자동진행
정체 감지: 없음
권장 강도: 1
전개 필요: MICRO
허용된 변화: 환경 변화
기존 NPC 행동: 없음
새 인물 도입: 없음
전개 방향: 환경 변화
피할 것: 갑작스러운 납치, 대형 전투, 위기 남발, 괜찮냐는 반복, 이미 지난 설명 반복
다음 장면 힌트: 주변 환경의 작은 변화가 다음 대화의 방향을 자연스럽게 열어 준다.
직접 발화 중심: 라이크. 메인 캐릭터와 유저의 현재 상호작용을 이어가며, 그 밖의 인물과 세계 정보는 서술·메시지·환경 변화로 통합한다.
유저 조종: 유저 캐릭터 [B]의 대사·행동·내면·불가역 운명 범위는 USER AUTHORING owner를 그대로 따른다. 이 scene directive가 권한을 추가하거나 축소하지 않는다. 여러 AI 캐릭터와 NPC의 대화·판단·갈등·협력·적대 세력의 움직임과 세계 사건은 적극적으로 진행한다.
다인물: 전개는 현재 중심 인물 하나에 고정되지 않는다. 여러 AI 캐릭터·NPC의 대화·판단·갈등·협력·적대·세계 사건을 함께 진행할 수 있다. [B]의 대사·행동·내면·불가역 운명 범위는 USER AUTHORING owner를 그대로 따른다.
트리거된 사건 지시가 있으면 이번 턴 장면 지시보다 우선한다.
```

같은 최종 시스템 문자열에서 `여러 AI 캐릭터`는 3회, `새 인물`은 2회다. `NPC`는 시스템과 현재 유저 턴을 합쳐 16회다. 현재 유저 턴에는 `3,200자` 길이 문장과 `Advance through`가 있다.

`character-core-identity` 안의 이름 횟수: 윤태건 1, 조아인 1, 서진화 1, `응급 가이드` 13, `젊은 여자` 0. 윤태건은 정본에 한 번 있으나 이번 턴 eligible actor는 아니다. `젊은 여자`는 정본 인명이 아니다.

## PROBLEM

두 현상은 한 프롬프트에서 갈라진다.

SCENE-DIRECTIVE-1은 방에 새 인물을 들인다. 문이 열리고 윤태건이 서류와 함께 들어오고, 이어서 `응급 가이드 기관 소속 제복을 입은 젊은 여자`가 태블릿을 들고 들어온다. 부분 문자열 횟수: 윤태건 9, 여자 5, 제복 1, 가이드 1, 조아인 0, 서진화 0, 렌 10, 라이크 17. 렌은 `옆에 있는 렌`으로 이미 창가에 있다. 비어 있지 않은 줄 52개 중 따옴표가 있는 줄은 26개다.

SCENE-DIRECTIVE-2는 그 두 사람을 방에 들이지 않는다. 윤태건 0, 조아인 0, 서진화 0, 여자 0, 가이드 0, 렌 3, 라이크 12. 렌은 `창가에 나란히 서 있었다`. 창밖 광장의 봉쇄국 인원과 지원국 직원은 유리 너머로 보이고 방 안으로 들어오지 않는다. 부분 문자열 횟수: 유리 7, 창 24, 하품 2, 이마 4, 빛 13, 소리 11, 광장 6. 비어 있지 않은 줄 38개 중 따옴표가 있는 줄은 15개다. 직전 assistant 턴이 이미 `유리에 이마를 기대며 하품`과 `졸려`를 말했는데, 이 원문은 `이마를 유리에 다시 붙였다`, `하품이 따라 나왔다`, `졸려`를 다시 쓴다.

같은 지시가 한쪽에서는 계약의 `새 인물 도입: 없음` / `기존 NPC 행동: 없음`과 어긋나는 입장을 만들고, 다른 쪽에서는 그 입장을 만들지 않은 채 창·유리·하품을 반복한다. 앙상블 문장을 두 현상의 단일 원인으로 두지 않는다.

## OWNER MAP

| 책임 | 라이브 owner | 이번 자동진행 조립 |
|---|---|---|
| 장면 계약 | `renderSceneMotionBody` + `renderSceneExecutionContract` (`src/lib/sceneDirective.ts`) | MICRO, 환경 변화, 기존 NPC 없음, 새 인물 없음. 시스템 섹션 `scene-directive` 1개, 710 |
| 자동진행 유저 조종 문장 | `AUTO_PROGRESSION_SCENE_USER_CONTROL` (`src/lib/autoProgressionRules.ts`) | 같은 장면 블록의 `유저 조종:` 줄. `newNpcAllowed`와 무관하게 붙는다 |
| 자동진행 다인물 문장 | `AUTO_PROGRESSION_ENSEMBLE_SCENE_RULE` (`src/lib/sceneDirective.ts`) | `mode === "auto_progression"`이면 모션·NPC grounding과 무관하게 붙는다 |
| 자동진행 숨은 명령 | `buildContinueNarrativeCommand` (`src/lib/continueNarrative.ts`) | `[AI_CAST], NPCs... Multiple AI-controlled characters may speak and act`와 `AUTO_PROGRESSION_SHORT_REF` |
| 자동진행 역할 | `AUTO_PROGRESSION_CORE_ROLE` via `buildCoreMasterPrompt` (`src/lib/corePrompt.ts`) | `여러 AI 캐릭터, NPC... 동시에 연기`. 시스템 안의 `여러 AI 캐릭터` 3회 중 장면 블록 밖 1회 |
| 직전 턴 반복 금지 | 같은 continue 명령의 `[STRICT ANTI-REPETITION RULE]` | 직전 assistant의 대사·신체 비트 반복 금지 |
| 공용 문체 | `COMMON_PROSE_BLOCK` (`src/lib/advancedProseNsfwGuidelines.ts`) | 599. 문체 번들 섹션 `prose-style-xml-bundle` 1,185. 여섯 모델 공용 |
| 길이 | `USER_TAIL_LENGTH_OWNER_SENTENCE` (`src/lib/responseLength.ts`) | 189. 현재 유저 턴에 1회. 3,200자 이상, 상한 없음 |
| DeepSeek 위생 | `buildRuntimePromptContaminationGuardBlock` | `deepseek` 부분 문자열이면 `Qwen/DeepSeek 보강` 한 줄. 출력에 내부 규칙을 쓰지 말라는 내용 |
| DeepSeek 외형 | `DEEPSEEK_APPEARANCE_VARIATION_RULE` (`src/lib/appearanceCompiler.ts`) | 외형·복식 변주, 인명 유지. NPC 도입과 감각 반복을 다루지 않는다 |
| DeepSeek 길이 어댑터 | `resolveDeepSeekLengthAdapterSection` | `deepseek-v4-pro`이고 arm B/C일 때만. `deepseek-v4.1-flash`에서는 null |
| 장면 owner 게이트 | `resolveScenePacingPromptOwner` | 코드 기본값 `legacy_v1`. V2와 Living은 이 Flash 기본 경로에 없다 |
| 토큰 집계 | `auditAssembledPrompt`, `estimateTokens` | 아래 표 |

`renderSceneDirectiveForPrompt`가 실행 계약 다음에 유저 조종 문장과 다인물 문장을 항상 붙인다. 금지와 허용이 한 owner 파일 안의 한 렌더에 같이 있다. continue 명령과 CORE ROLE은 그 바깥의 별도 owner다.

공용 문체는 공간·빛·소리·온도·질감을 고르고, 의미가 전달되면 다음 반응으로 나아가며, 평범한 동작은 줄이라고 한다. 길이 문장은 `[AI_CAST]/NPC/환경의 관찰·심리·판단·행동·대화·감각 변화`를 3,200자 이상까지 깊게 전개하라고 한다. 반복 금지 문장은 직전 턴의 신체 비트를 반복하지 말라고 한다. 이 세 문장은 서로 다른 owner다.

V2 렌더(`src/lib/sceneDirectiveV2.ts`)는 자동진행에서 cast가 2명 미만이면 `존재하지 않는 NPC를 추가해 대화량을 채우지 않는다`를 쓴다. 그 경로도 `유저 조종:`에 같은 `AUTO_PROGRESSION_SCENE_USER_CONTROL`을 붙인다. V2는 기본 경로가 아니고, 이번 조립을 V2로 바꾸면 장면 owner 전체가 바뀐다.

대화형 MICRO 테스트 `P2 MICRO_MOTION no-NPC`는 compact pacing 큐만 본다. 자동진행 전용으로 붙는 다인물 문장은 그 테스트의 입력이 아니다.

## ROOT CAUSE

`ROOT_CAUSE_UNCONFIRMED`.

확인된 사실:

- 이번 턴 계약은 환경 변화 하나, 기존 NPC 행동 없음, 새 인물 도입 없음, 발화 중심 라이크다.
- 같은 최종 프롬프트가 그 계약과 함께, 여러 NPC의 대화·판단·갈등·세계 사건을 진행하라는 문장을 continue 명령, CORE ROLE, 장면 블록 두 줄에 둔다.
- 그 프롬프트의 두 원문은 서로 다른 쪽을 따랐다. 1은 정본에 이름이 한 번 있는 윤태건과, 정본 인명이 아닌 젊은 여자를 방 안에 들였다. 2는 그 입장을 만들지 않고 직전 턴의 이마·하품·졸려를 다시 썼다.
- DeepSeek 전용으로 실제로 들어가는 문장은 출력 위생과 외형 변주다. `v4.1-flash`용 문체 어댑터는 기본 경로에 없다.
- 공용 문체와 3,200자 길이 문장은 다른 활성 모델과 공유된다.

그래서 다인물 문장 삭제, 새 금지 문장, DeepSeek 전용 문장 추가를 이번 수정으로 두지 않는다. 삭제가 1의 입장을 막는지, 2의 반복을 줄이는지는 이 두 원문만으로 갈라지지 않는다. 1을 만든 허용이 2에서는 입장을 만들지 않았고, 2의 반복은 이미 직전 턴 반복 금지가 있는 상태에서 나왔다.

## AFTER

Runtime 변경 없음. 추가된 매턴 시스템 토큰은 0이다.

## TOKEN

변경 전과 변경 후가 같다. 아래는 이번 재조립이다.

| 구간 | estimated tokens |
|---|---|
| 시스템 합계 | 16,192 |
| 캐시 rules | 4,034 |
| 캐시 character | 9,738 |
| 캐시 dynamic | 2,418 |
| 장면 지시 본문 | 710 |
| 공용 문체 `COMMON_PROSE_BLOCK` | 599 |
| 문체 번들 섹션 | 1,185 |
| 길이 문장 | 189 |
| continue 명령 본문 | 721 |
| 조립 총량 | 17,224 |

추적 섹션은 12개다. `openrouter-korean-prose-top` 875, `openrouter-co-narration-rule` 106, `runtime-prompt-contamination-guard` 856, `no-godmodding` 798, `rule-historical-truth-canonical-memory` 858, `character-core-identity` 8,527, `identity-and-rules` 641, `prose-style-xml-bundle` 1,185, `rule-user-input-parsing` 189, `scene-directive` 710, `rule-output-layout-recency` 670, `user-persona-reference-owner` 738. 섹션 합 16,153과 시스템 16,192의 차이는 섹션 결합이다.

DeepSeek XML은 정본을 character 캐시 버킷으로 옮긴다. 공용 문체를 바꾸면 그 9,738 버킷이 깨진다. 장면 지시는 dynamic 2,418 안에 있다.

## PRESERVED

공용 문체, 3,200자 이상 길이 정책, 라이크 정본, 페르소나 렌, NORMAL 권한, 10,000자 정본 상한, 성별 경로, 메모리 경로.

## 호출 계획

실행하지 않았다.

격리 실험이라면 `renderSceneDirectiveForPrompt`에서 자동진행일 때 붙는 `AUTO_PROGRESSION_SCENE_USER_CONTROL`의 NPC 진행 문장과 `AUTO_PROGRESSION_ENSEMBLE_SCENE_RULE`만 빼고, MICRO 계약·공용 문체·길이 문장·continue 명령·CORE ROLE은 둔 채 같은 fixture로 2회를 다시 부른다. PR #1329의 장면 지시 포함 호출은 공급업체 prompt 12,466토큰, completion 2,567과 3,482, 공개 단가(input $0.30/M, output $1.20/M, 캐시 미적용)로 약 $0.006820과 $0.007918이었다. 같은 크기면 2회는 약 $0.015이다. 그 실험도 continue 명령과 CORE ROLE의 다인물 허용은 남는다. 이미 동일 프롬프트 2회가 갈라졌으므로 2회 추가가 한 문장을 두 현상의 원인으로 확정하지 못한다.

## REGRESSION RISKS

Production 변경이 없다.

## PROOF

- `origin/main` `1b7813c7690028d9dabd25ec09d955a01d3250bf`에서 `npx tsx --conditions=react-server /tmp/auto-scene-quality-audit.ts`를 다시 실행했다. 모션 `MICRO_MOTION`, 전개 `environment`, NPC grounding 전부 불허, 시스템 16,192, 캐시 4,034 / 9,738 / 2,418, 정본 이름 횟수는 위와 같다.
- 원문은 위 PR #1329 exact-commit 링크를 원본으로 사용하며, 각 sha256은 위에 기록된 값과 같다.
- `git diff`에 `src/` 변경은 없다.

## FOLLOW-UP

- 장면 렌더가 MICRO 계약과 다인물 허용을 한 블록에 같이 쓰는 구조는 남아 있다. 원인 확정 전의 문장 삭제·추가는 하지 않는다.
- V2를 기본 owner로 켜는 일, 공용 문체 개편, 새 문체 시스템, 메모리, 성별, 10,000자 상한은 이 조사 밖이다.
- GPT가 두 원문 전체를 보고 장면 연속성, NPC 정본, 진행, 감정·환경 묘사, 대사 비중을 평가한다.
