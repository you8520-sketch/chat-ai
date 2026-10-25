# PHASE 3D — 자동진행 장면 연속성

조사 기록이다. Production prompt, routing, billing, runtime code는 바꾸지 않았다. 문체 점수는 매기지 않는다. PR #1318과 #1325는 수정하지 않았다.

최신 `origin/main`은 `1b7813c7690028d9dabd25ec09d955a01d3250bf`이다. 그 커밋과 이전 조사 기준 `91d7cebef1f29455603366fc96aa28bcdeb56c2f` 사이에서 `contextBuilder`, `continueNarrative`, `sceneDirective`, `userPersonaReference`, `autoProgressionRules`, `corePrompt`, `promptAudit`, `tokenEstimate`, `openRouterAdult`, `api/chat/route`의 diff는 비어 있다. 프롬프트 owner는 그대로다.

## BEFORE

확정된 직전 비트는 유저 줄 `창문 쪽에 같이 서 있자.`와 assistant 줄 `라이크는 유리에 이마를 기대며 하품했다.` / `졸려. 너는 그대로 있어.`이다. 이 두 줄에는 장소 이름과 이름 `렌`이 없다. 직전 대화가 장소를 정하지 않았으므로, 다음 출력이 격리실·숙소·복도·챔버를 골랐다는 사실만으로 연속성 오류를 확정하지 않는다.

원본 Q7 출력은 그 비트 다음을 `본부 숙소 27층`으로 쓰고, 렌을 이미 창가에 있는 사람으로 둔 뒤 조아인과 윤태건을 들여보낸다. 원문: [Q7-auto.txt](phase3d/raw/Q7-auto.txt). sha256 `741ef7246c1cadb04a9954ccc0b96834be1e18969f8d89833af8458529749542`.

PR #1325의 네 출력은 같은 두 턴을 다시 자동진행한 결과다. 그 실험 조립은 production이 넣는 `[이번 턴 장면 지시]` 블록을 빠뜨렸다. 아래의 장면 지시 포함 2회와 조건을 같이 두지 않으며, 개선 효과로 읽지 않는다.

## PROBLEM

판정은 테스트 파일 안의 기록 분류기다. Production 출력 보정기가 아니다.

확정 오류는 둘뿐이다.

- 이미 함께 있던 렌을, 그 사이에 장소 이동 없이 새로 도착한 인물로 쓰는 경우.
- 렌이 사라졌다고 문장이 말하는 경우.

이름 `렌`이 없는 것과 렌이 물리적으로 사라진 것은 다르다. 명시적 이동과 새 NPC 등장은 오류가 아니다. `오렌지` 안의 음절은 이름 `렌`이 아니다.

| 원문 | 관찰 | 확정 오류 |
|---|---|---|
| Q7-auto | 숙소. 렌은 처음부터 창가에 있고 NPC가 들어옴 | 없음 |
| CONTROL-1 | 격리실. `렌이 아직 거기 서 있었다` | 없음. 장소 이름은 관찰이다 |
| CONTROL-2 | 코드 블랙 챔버. `오늘이 배치 첫날입니다`로 렌을 들이고, 그 앞에 이동 문장이 없다 | 새로 도착한 인물로 재도입 |
| CANDIDATE-1 | 이름 `렌` 없음. 사라졌다는 문장도 없음 | 없음. 이름 부재이지 물리적 실종이 아니다 |
| CANDIDATE-2 | 렌이 처음부터 창가에 있음 | 없음 |
| SCENE-DIRECTIVE-1 | 오프닝에 `복도`. 렌은 첫 1,200자 밖에 `옆에 있는 렌`으로 나온다. 윤태건이 들어옴 | 없음 |
| SCENE-DIRECTIVE-2 | 렌은 `창가에 나란히 서 있었다` | 없음 |

원문:

- [CONTROL-1.txt](phase3d/raw/CONTROL-1.txt) `201705844a6271465d28b19b52009f2d706659c5d1085df5c4827757a2e074e5`
- [CONTROL-2.txt](phase3d/raw/CONTROL-2.txt) `3dd83d37daeb2f0a1b09f70f6ee566fa70c3a75b460efff4154c737140f0d395`
- [CANDIDATE-1.txt](phase3d/raw/CANDIDATE-1.txt) `adab2db4cadc2baba2d4276cbb3d989c5515feb191ab4573927acfe9779c4b2f`
- [CANDIDATE-2.txt](phase3d/raw/CANDIDATE-2.txt) `15fee1bc39e56e28c4687c52d13e54070109afc1559bc1a43abbb9e1d8724520`
- [SCENE-DIRECTIVE-1.txt](phase3d/raw/SCENE-DIRECTIVE-1.txt) `1be0cc0500b1a7771480ea93ef9f8e690faabb8d397660abc9e9ac04c82c4f75`
- [SCENE-DIRECTIVE-2.txt](phase3d/raw/SCENE-DIRECTIVE-2.txt) `395304f23e7940ac3e9537fc0caaafca8769ad7ac9ea286cf28cfd10b4ac1140`

## OWNER MAP

- 최종 시스템 프롬프트: `buildContext` (`src/services/contextBuilder.ts`).
- 자동진행 유저 턴: `buildContinueNarrativeCommand` (`src/lib/continueNarrative.ts`). DB에 저장되는 표시 문자열 `자동진행`은 모델 입력이 아니다.
- 장면 지시: `buildSceneDirective` / `renderSceneDirectiveForPrompt` (`src/lib/sceneDirective.ts`). 이번 조립의 owner는 `resolveScenePacingPromptOwner`가 고른 `legacy_v1`이다. `SCENE_DIRECTIVE_V2_MODE`는 off, Living Scene Directive는 이 Flash 모델에서 false다.
- 유저 이름 지칭: `buildUserPersonaReferencePrompt` (`src/lib/userPersonaReference.ts`). 페르소나 본문은 `formatPublicPersonaForPrompt`.
- NORMAL 자동진행 권한: `buildAutoProgressionUserControlBlock` (`src/lib/autoProgressionRules.ts`).
- 재생성의 같은 장면 문장: `buildRegenerateSystemDirective`.
- 본편 짧은 연속 문장: `buildCoreMasterPrompt`의 interactive `CONTINUITY`.
- 토큰 집계: `auditAssembledPrompt` (`src/services/promptAudit.ts`)와 `estimateTokens` (`src/lib/tokenEstimate.ts`, 글자 수 × 0.9). 공급업체 usage와 다른 자다.
- 최종 와이어: `assemblePrimaryRpRequest` + Cheaper Inference transport. 자동진행은 `skipMotionCue: true`라 `[SCENE PACING]` 큐를 더하지 않는다.
- 정본 상한: `buildCombinedCharacterSettingSource`의 10,000자. 이번 조사는 그 상한을 바꾸지 않는다.

## ROOT CAUSE

`ROOT_CAUSE_UNCONFIRMED`.

최종 요청에는 직전 비트가 들어 있다. 배포 라이크 fixture (`id=18`, sourceHash `295f4d8ae3dc8391`), 관리자 페르소나 `렌` / male, NORMAL, DeepSeek V4.1 Flash, 빈 장기 기억으로 다시 조립했다. 테스트 파일의 짧은 정본 청크와 이 fixture는 다르다.

- `character-core-identity`에 `36/M`이 1회 있고 `36/남`은 0회다. 시스템 프롬프트에도 `36/M` 1회, `36/남` 0회다. 정본 sha256 `0ff7d8b8157b2add40d40da018b4ca500cc72370a281584dfe01683c444cc323`, 9,474자.
- 한국어 청크를 썼다. 영문 레이어는 선택되지 않았다.
- `[이번 턴 장면 지시 - 비공개]`는 tracked section 1개, 시스템 문자열 1회, 최종 요청 본문 1회다. 지시를 뺀 조립에는 0회다.
- 모션은 `MICRO_MOTION`이다. 엔진 규칙은 `새 인물·별도 사건은 만들지 않는다`이고 계약은 `새 인물 도입: 없음`이다. 같은 블록의 앙상블 문장은 여러 NPC와 세계 사건을 진행하라고도 한다.
- 와이어 모델은 `deepseek-v4.1-flash`, endpoint는 `https://api.cheaperinference.com/v1/chat/completions`이다.
- 현재 유저 턴에 `Continue from the exact in-scene moment`가 있고 표시 문자열 `자동진행`은 없다. NORMAL 문장 `외부에서 관찰 가능한 행동`이 있다.

그 긴장을 원인으로 확정하지 않는다. 장면 지시를 뺀 #1325 샘플과 지시를 넣은 2회는 조건이 다르고, 2회 모두 확정 오류에 들어가지 않았지만 샘플이 한 방향으로 모이지 않는다.

## AFTER

Runtime 변경 없음.

## REMOVED

없음. 앙상블 문장과 anti-repetition 문장을 지우거나 새 연속성 문장을 추가하지 않았다. 기록 분류 정규식은 테스트 안에만 있고 런타임에 연결하지 않았다.

## PRESERVED

캐릭터 정본, 빈 기억 경로, NORMAL의 관찰 가능한 행동·대사 권한, 출력 길이 3,200자 owner, 장면 지시 텍스트, 10,000자 정본 상한.

## REGRESSION RISKS

동작 변경이 없다. 테스트는 전달 여부와 기록된 원문 분류만 고정한다. 장소 이름, 이름 부재, 명시적 이동, 새 NPC는 확정 오류로 잡지 않는다.

## PROOF

`src/lib/autoProgressionSceneContinuity.test.ts`. 정규 러너로 8 passed, 0 failed.

아래 숫자는 `estimateTokens`다. 공급업체 prompt token이 아니다. 장면 지시 포함이 이번 production 조립이고, 미포함은 같은 fixture에서 그 블록만 뺀 대조다.

| 구간 | 장면 지시 포함 | 장면 지시 없음 |
|---|---:|---:|
| 시스템 프롬프트 | 16192 | 15481 |
| systemRules | 6985 | 6275 |
| characterSetting | 8527 | 8527 |
| worldLore | 0 | 0 |
| persona | 641 | 641 |
| memory | 0 | 0 |
| userNote | 0 | 0 |
| dialogueExamples | 0 | 0 |
| 직전 대화 historyTokens | 70 | 70 |
| 현재 명령 currentUserTurnTokens | 962 | 962 |
| recentConversation | 1032 | 1032 |
| 최종 조립 | 17224 | 16513 |

장면 지시 section은 710 estimated tokens다. systemRules 차이 710, 시스템 프롬프트 차이 711은 join 1토큰이다. 정본·페르소나·기억·기록은 그대로다.

캐시 분할도 추정이다. 포함 조립의 `openRouterSystemSplit`:

| 버킷 | estimated tokens |
|---|---:|
| cache rules (고정) | 4034 |
| cache character (고정) | 9738 |
| dynamic system | 2418 |

고정 합 13,772. 세 버킷 합 16,190과 시스템 프롬프트 16,192의 차이는 join이다. 장면 지시는 dynamic에 있으므로 캐시 접두부를 바꾸지 않는다. `promptAudit`의 characterSetting 8,527과 cache character 9,738은 다른 분할이다. 전자는 섹션 category, 후자는 캐시 버킷이다.

`promptAudit` signature detector는 `scene-directive`와 `user-persona-reference-owner`를 `User impersonation (유저 사칭·조종)`으로 같이 집계하고 detector wasted 738을 적는다. 이 값은 확정 중복도, 절감 가능 토큰도 아니다.

공급업체 usage는 장면 지시를 넣은 두 호출의 실측이다. `estimated: false`. 응답 usage에는 `prompt_tokens`, `completion_tokens`, `total_tokens`만 있었다. cache read, cache write, cost, cache discount 필드는 없었다. `responseModelId`는 `deepseek-v4.1-flash`, `finishReason`은 `stop`이다.

| 호출 | prompt | completion | total | cache | provider cost |
|---|---:|---:|---:|---|---|
| SCENE-DIRECTIVE-1 | 12466 | 2567 | 15033 | 필드 없음 | 필드 없음 |
| SCENE-DIRECTIVE-2 | 12466 | 3482 | 15948 | 필드 없음 | 필드 없음 |

공개 단가(`publishedModelPricing`, input $0.30/M, output $1.20/M, cache read $0.006/M)로 캐시 없이 환산하면 1회 $0.006820, 2회 $0.007918, 합 $0.014738이다. 이것은 공급업체 청구액이 아니다. 추정 조립 17,224와 실측 prompt 12,466도 다른 자다.

#1325의 prompt 약 12,040은 장면 지시가 빠진 요청의 실측이다. 이번 12,466과 나란히 두고 개선을 계산하지 않는다.

## CLASSIFICATION

`ROOT_CAUSE_UNCONFIRMED`

## FOLLOW-UP

- 성별 표기 재실험.
- 문체 평가.
- 10,000자 정본이 `무서웠는데.”, “왜`에서 끊기는 문제.
- 장면 지시의 MICRO_MOTION과 앙상블 진행 문장이 한 블록에서 동시에 말하는 긴장. 원인 확정 전의 문장 추가는 하지 않는다.
- 독립적인 프롬프트 토큰 최적화.
