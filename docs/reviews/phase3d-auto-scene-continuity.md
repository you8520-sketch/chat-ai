# PHASE 3D — 자동진행 장면 연속성

조사 기록이다. Production prompt, routing, billing, runtime code는 바꾸지 않았다. 문체 점수는 매기지 않는다. PR #1318과 #1325는 수정하지 않았다.

조사 기준은 `origin/main` `91d7cebef1f29455603366fc96aa28bcdeb56c2f`이다. DeepSeek V4.1 Flash 자동진행, NORMAL 서술 권한, 빈 장기 기억, 기록된 Q7 두 턴을 그대로 조립했다. 모델은 호출하지 않았다.

## BEFORE

확정된 직전 비트는 유저 줄 `창문 쪽에 같이 서 있자.`와 assistant 줄 `라이크는 유리에 이마를 기대며 하품했다.` / `졸려. 너는 그대로 있어.`이다. 이 두 줄에는 `숙소`, `격리실`, `코드 블랙`, 이름 `렌`이 없다.

원본 Q7 출력은 그 비트 다음을 `본부 숙소 27층`으로 쓰고, 렌을 이미 창가에 있는 사람으로 둔 뒤 조아인과 윤태건을 들여보낸다. 원문: [Q7-auto.txt](phase3d/raw/Q7-auto.txt). sha256 `741ef7246c1cadb04a9954ccc0b96834be1e18969f8d89833af8458529749542`.

PR #1325의 네 출력은 같은 두 턴을 다시 자동진행한 결과다. 그 실험 조립은 production이 넣는 `[이번 턴 장면 지시]` 블록을 빠뜨렸다.

## PROBLEM

같은 직전 비트에서 나온 출력이 갈린다.

| 원문 | 첫 장면 | 렌 | 판정 |
|---|---|---|---|
| Q7-auto | 본부 숙소 27층 | 처음부터 창가에 있음. 이후 NPC가 들어옴 | 연결됨 |
| CONTROL-1 | 격리실 | `렌이 아직 거기 서 있었다` | 격리실로 바뀜 |
| CONTROL-2 | 코드 블랙 챔버 | 서류의 이름 뒤에 `오늘이 배치 첫날`로 입장 | 격리 장소로 바뀜, 렌을 새로 도착시킴 |
| CANDIDATE-1 | 지부 본관 27층 복도 창가 | 이름 `렌` 없음. `오렌지` 안의 음절만 일치 | 전환 없이 렌이 사라짐 |
| CANDIDATE-2 | 이름이 없는 창가 방 | 처음부터 `렌이 창가에 서 있었다` | 세 실패 유형에는 해당하지 않음 |

CANDIDATE-2는 나중에 `오늘 밤 숙소로 들어가세요`라고 해서, 현재 방을 숙소로 부르지는 않는다. 그것은 위에 적지 않은 별도 관찰이다. 새 NPC가 들어오는 것 자체는 실패로 세지 않았다.

원문:

- [CONTROL-1.txt](phase3d/raw/CONTROL-1.txt) `201705844a6271465d28b19b52009f2d706659c5d1085df5c4827757a2e074e5`
- [CONTROL-2.txt](phase3d/raw/CONTROL-2.txt) `3dd83d37daeb2f0a1b09f70f6ee566fa70c3a75b460efff4154c737140f0d395`
- [CANDIDATE-1.txt](phase3d/raw/CANDIDATE-1.txt) `adab2db4cadc2baba2d4276cbb3d989c5515feb191ab4573927acfe9779c4b2f`
- [CANDIDATE-2.txt](phase3d/raw/CANDIDATE-2.txt) `15fee1bc39e56e28c4687c52d13e54070109afc1559bc1a43abbb9e1d8724520`

## OWNER MAP

- 최종 시스템 프롬프트: `buildContext` (`src/services/contextBuilder.ts`).
- 자동진행 유저 턴: `buildContinueNarrativeCommand` (`src/lib/continueNarrative.ts`). DB에 저장되는 표시 문자열 `자동진행`은 모델 입력이 아니다.
- 장면 지시: `buildSceneDirective` / `renderSceneDirectiveForPrompt` (`src/lib/sceneDirective.ts`). 자동진행이면 `scene-directive`로 시스템 동적 구간에 한 번 들어간다. `SCENE_DIRECTIVE_V2_MODE` 기본값은 off, Living Scene Directive는 Flash 모델 허용 목록 밖이라 이 경로의 owner는 legacy V1이다.
- 유저 이름 지칭: `buildUserPersonaReferencePrompt` (`src/lib/userPersonaReference.ts`).
- NORMAL 자동진행 권한: `buildAutoProgressionUserControlBlock` (`src/lib/autoProgressionRules.ts`).
- 재생성의 같은 장면 문장: `buildRegenerateSystemDirective`.
- 본편 짧은 연속 문장: `buildCoreMasterPrompt`의 interactive `CONTINUITY`.
- 토큰 집계: `auditAssembledPrompt` (`src/services/promptAudit.ts`)와 `estimateTokens` (`src/lib/tokenEstimate.ts`). `buildContext`가 이미 섹션별로 같은 추정 함수를 쓴다.
- 대화 기록 선택: 이 패킷은 완료된 한 교환만 있다. `resolveAutoContinueHistoryTurns`는 OOC가 아니면 기록을 자르지 않는다. DeepSeek opening peel은 `[채팅 시작]` 쌍에만 적용되고, 이 두 턴은 그 쌍이 아니다.
- 정본 상한: `buildCombinedCharacterSettingSource`의 10,000자. 이번 조사는 그 상한을 바꾸지 않는다.

## ROOT CAUSE

확정하지 않는다.

최종 요청에는 직전 비트가 들어 있다.

- history에 `창문 쪽에 같이 서 있자.`와 `너는 그대로 있어.`가 있다.
- history에는 `숙소`, `격리`, `렌`이 없다.
- 현재 유저 턴에 `Continue from the exact in-scene moment where the previous RP ended.`와 `[STRICT ANTI-REPETITION RULE]`이 있다. 표시 문자열 `자동진행`은 없다.
- `[USER PERSONA REFERENCE OWNER]`에 `이름/호칭: 렌`이 있다.
- 라이크 카드 greeting에는 `숙소`와 `격리`가 없다. 모델에 들어가는 `character-core-identity`에는 `숙소` 3, `격리` 5, `코드 블랙` 1이 함께 있다. 현재 방 이름을 그 비트에 고정하는 문장은 없다.

이 조용한 자동진행의 장면 지시는 `MICRO_MOTION`이다. 엔진 규칙은 `새 인물·별도 사건은 만들지 않는다`이고 계약은 `새 인물 도입: 없음`, `허용된 변화: 환경 변화`이다. 같은 블록의 앙상블 문장은 `여러 AI 캐릭터·NPC의 대화·판단·갈등·협력·적대 세력의 움직임과 세계 사건은 적극적으로 진행한다`라고도 한다. 한 owner 안의 긴장이다.

그 긴장을 세 실패의 원인으로 확정하지 않는다. #1325 네 출력은 이 장면 지시 없이 생성됐다. 장면 지시가 있던 원본 Q7은 NPC를 새로 들이면서도 숙소와 렌을 유지했다. 샘플이 한 방향으로 모이지 않고, 누락된 데이터 경로도 없다.

## AFTER

Runtime 변경 없음.

## REMOVED

없음. 앙상블 문장과 anti-repetition 문장을 지우거나 새 연속성 문장을 추가하지 않았다.

## PRESERVED

캐릭터 정본, 빈 기억 경로, NORMAL의 관찰 가능한 행동·대사 권한, 출력 길이 owner, 장면 지시 텍스트, 10,000자 정본 상한.

## REGRESSION RISKS

동작 변경이 없다. 추가한 테스트는 전달 여부와 기록된 원문 분류만 고정한다. 새 NPC 입장과, 숙소에서 걸어 나가는 명시적 이동은 실패로 잡지 않는다.

## PROOF

`src/lib/autoProgressionSceneContinuity.test.ts`.

라이크 카드로 조립한 추정 토큰 (`estimateTokens`, provider usage가 아님):

| 구간 | production 장면 지시 포함 | #1325처럼 장면 지시 생략 | 차이 |
|---|---:|---:|---:|
| systemRules | 6985 | 6275 | +710 |
| characterSetting | 8527 | 8527 | 0 |
| worldLore | 0 | 0 | 0 |
| persona | 796 | 796 | 0 |
| memory | 0 | 0 | 0 |
| userNote | 0 | 0 | 0 |
| dialogueExamples | 0 | 0 | 0 |
| recentConversation | 1032 | 1032 | 0 |
| 추정 합계 | 17379 | 16668 | +711 |

장면 지시 블록만 710 estimated tokens이다. 합계 차이 +711은 시스템 프롬프트 join의 1토큰이다. 정본·페르소나·기억·기록 토큰은 그대로다. 같은 입력을 두 번 조립하면 추정 합계가 같다. 매 턴 누적 증가는 이 조립에서 보이지 않는다.

`promptAudit`의 signature detector는 `scene-directive`와 `user-persona-reference-owner`를 `User impersonation (유저 사칭·조종)`으로 함께 집계하고 wasted 738을 적는다. 두 블록이 같은 규칙의 복제가 아니라 `유저 조종` 문구를 각자 가지고 있어서다. 이번 변경으로 지우지 않는다.

#1325 provider usage는 장면 지시가 빠진 요청의 실측이다. 청구 `cost` 필드는 없었다. 아래는 그 응답의 usage다.

| 호출 | prompt | cached | completion |
|---|---:|---:|---:|
| CONTROL-1 | 12066 | 필드 없음 | 2138 |
| CONTROL-2 | 12041 | 0 | 5032 |
| CANDIDATE-1 | 12043 | 0 | 4873 |
| CANDIDATE-2 | 12043 | 12032 | 2910 |

추정 토큰과 provider prompt token은 다른 자이다.

## CLASSIFICATION

`CAUSE_NOT_CONFIRMED_SCENE_DELIVERED`

## FOLLOW-UP

- 성별 표기 재실험.
- 문체 평가.
- 10,000자 정본이 `무서웠는데.”, “왜`에서 끊기는 문제.
- 장면 지시의 MICRO_MOTION과 앙상블 진행 문장이 한 블록에서 동시에 말하는 긴장. 원인 확정 전의 문장 추가는 하지 않는다.
- 독립적인 프롬프트 토큰 최적화.
- production 장면 지시를 포함한 자동진행 재호출이 필요하면 별도 계획이다. 같은 두 턴, DeepSeek V4.1 Flash, 장면 지시 포함, 2회. #1325 실측은 호출당 prompt 약 12,000에 completion 2,000–5,000이었고, 장면 지시는 그 위에 추정 710토큰이다. 이번 조사에서는 호출하지 않았다.
