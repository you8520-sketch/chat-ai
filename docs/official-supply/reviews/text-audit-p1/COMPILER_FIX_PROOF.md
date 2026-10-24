# 공통 컴파일 버그: 문장 중간 절단 + 일반 성격 문장의 말투 오분류

코드 수정은 별도 Draft PR(`cursor/creator-description-sentence-compile-d9a9`)로 제출했습니다. 이 문서는 원고 검수자를 위한 증거 요약입니다.

## 원인 (단일 소유자: `src/lib/creatorDescriptionTriggerCompiler.ts`)

1. `splitSentences`가 `(?<=[.!?。！？다요])\s+`로 나눠, 문장 부호 없이도 **‘다’·‘요’ 뒤 공백**이면 문장 중간에서 잘랐습니다. (예: ‘주요 지역은…’의 ‘주요’ 뒤, ‘…해마다 줄어…’, ‘…보다 가볍게…’)
2. `SPEECH_RULE_RE`가 단독 `평소에는`을 말투 규칙으로 취급해, ‘평소에는 …’로 시작하는 **일반 성격·행동 문장**을 통째로 `speech_control`(비공개 말투 블록)로 보냈습니다.
3. 두 결함이 겹치면 루시안의 성격 문장이 다음처럼 쪼개졌습니다: 앞 조각(`…말보다`)은 비공개 말투 블록으로, 뒷 조각(`손버릇·시선·퇴로부터 본다.`)은 `public_canon` 한복판에 고아로 남았습니다. 정규식에서 `다요`만 지우면 2번 때문에 문장이 여전히 말투 블록으로 오분류됩니다.

## 수정

- `splitSentences`: 문장 종결 부호(`. ! ? 。 ！ ？`) 뒤 공백 또는 줄바꿈에서만 분리.
- `SPEECH_RULE_RE`: 단독 `평소에는` 제거. `평소에는`은 같은 문장에 말씨·어조·호칭·존대/하대·높임·부른다·대답한다 등 **말투 단서가 있을 때만** 말투 규칙. 기존 `말투`, `대사 규칙`, `존댓말`, `반말`, `해요체`, `다나까체`, `군대식`, `사적인 장소`, `단둘이 있을 때`는 그대로.
- 상태창(`STATUS_DISPLAY_RE`)·트리거(`inferTrigger`)·숨은 지식(`HIDDEN_KNOWLEDGE_RE`) 처리는 변경 없음.

## 증거

결정적 단위 테스트(`creatorDescriptionTriggerCompiler.test.ts`, 4건 신규)와 격리 DB 저장→컴파일→`buildContext` 종단 테스트(`officialSupply.worldIntroCanon.test.ts`: 루시안·볼프강)는 **수정 전 실패 / 수정 후 통과**를 확인했습니다.

공식 시스템 프롬프트를 컴파일러에 직접 넣은 결과:

| 캐릭터 | 구분 | `speech_control` | `public_canon` 줄 수 |
| --- | --- | --- | ---: |
| 루시안 | main(수정 전) | `["성격·행동: 평소에는 … 말보다"]` (잘린 조각) | 75 |
| 루시안 | 수정 후 | `[]` | 59 |
| 볼프강 | main(수정 전) | `[]` | 114 |
| 볼프강 | 수정 후 | `[]` | 96 |

줄 수가 줄어든 것은 잘려서 고아가 된 조각이 원래 문장으로 합쳐졌기 때문입니다(볼프강 18곳, 루시안 17곳 근처의 절단 위치). 내용 손실은 없고 줄바꿈 위치만 달라집니다.

최종 와이어 diff: `wire/DIFF-pilot-rf-02-compiler-fix-only.diff`, `wire/DIFF-pilot-rf-03-compiler-fix-only.diff`. 루시안은 `[PRIVATE SPEECH CONTROL - NOT STORY CONTENT]` 블록이 사라지고 `성격·행동: 평소에는 웃는 얼굴과 가벼운 농담으로 상대의 경계를 낮추고, 말보다 손버릇·시선·퇴로부터 본다.`가 한 줄로 canon에 들어갑니다.

운영 저장 JSON(`creator_compiled_description_json`)은 소급 수정하지 않았습니다. 이미 저장된 캐릭터는 다음 저장·재컴파일 때 새 규칙이 적용됩니다.
