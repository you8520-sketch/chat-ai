# 배포 홈 채팅의 매 턴 시스템 프롬프트 감사

기준 커밋: `2132ea6`  
측정일: 2026-08-27  
대상 경로: 메인 홈의 일반 캐릭터 채팅이 호출하는 `POST /api/chat`

## 한눈에 보는 결론

- 채팅 요청마다 `buildContext()`가 시스템 프롬프트를 다시 조립한다. 즉, 최초 한 번만 보내는 문구가 아니라 **모델 호출의 매 턴 입력에 포함**된다.
- 다만 모든 채팅에 동일한 고정 길이는 아니다. 모델, 캐릭터 설정, 페르소나, 메모리, 성인 모드, 상태 위젯, 현재 장면과 활성화된 실험 플래그에 따라 조건부 블록이 붙거나 빠진다.
- 저장소에 production DB가 없는 상태에서, 현재 코드의 OpenRouter/Gemini 3.1 Pro 기본 감사 fixture를 실행한 대표값은 다음과 같다.

| 항목 | 대표 측정값 |
| --- | ---: |
| 시스템 프롬프트 | 7,477자 / 208줄 / 약 6,730 토큰 |
| 시스템 규칙 | 약 5,556 토큰 |
| 캐릭터 설정 | 약 657 토큰 |
| 페르소나·필수 규칙 | 약 399 토큰 |
| 장기 기억·관계 메모 | 약 107 토큰 |
| 시스템 프롬프트 외 최근 대화 | 약 135 토큰 |
| 시스템 프롬프트 외 현재 user 턴 래퍼·길이 지시 포함 | 약 1,630 토큰 |
| 최종 조립 입력 전체 | 약 8,495 토큰 / 9,438자 |

여기서 “약 토큰”은 API 실측 usage가 아니라 프로젝트의 보수적 추정식 `ceil(문자 수 × 0.9)` 결과다. 한글 중심 프롬프트의 비용·예산을 빠르게 비교하기 위한 값이므로 실제 모델 tokenizer 결과와는 다를 수 있다.

> **중요:** 위 수치는 “현재 코드가 만드는 프롬프트의 재현 가능한 대표값”이지 실서비스 모든 방의 고정값이나 production usage 영수증이 아니다. 정확한 특정 배포 채팅 값은 해당 배포 DB snapshot과 채팅 ID로 같은 dump를 실행하거나, 저장된 provider usage를 확인해야 한다.

## 매 턴 들어가는 내용

대표 fixture에서는 다음 10개 system section이 실제로 조립됐다. 순서는 모델에 보내는 큰 흐름과 동일하다.

| 순서 | section id | 약 토큰 | 실제 역할 |
| ---: | --- | ---: | --- |
| 1 | `openrouter-korean-prose-top` | 738 | 정본 우선순위, 현재 장면 유지, 한국어 출력, 캐릭터 역할과 대화 연속성 같은 최상위 RP 규칙 |
| 2 | `runtime-prompt-contamination-guard` | 799 | 내부 프롬프트·메타 지시가 캐릭터의 지식이나 출력에 섞이지 않도록 막는 오염 방지 규칙 |
| 3 | `no-godmodding` | 685 | AI가 유저의 새 대사, 중요한 선택·동의·거절을 대신 확정하지 않도록 하는 유저 주도권 경계 |
| 4 | `character-core-identity` | 657 | 캐릭터 이름·성별·성격·외형·말투·예시 대화와 world canon. 캐릭터마다 길이가 달라지는 핵심 변동분 |
| 5 | `identity-and-rules` | 399 | 현재 유저 페르소나의 이름·성별·설명과 사용자 노트의 필수 규칙 |
| 6 | `prose-style-xml-bundle` | 1,975 | 문체, 대사/서술 운용, 장면 감각, 성인 모드일 때의 prose 정책을 묶은 XML 스타일 번들 |
| 7 | `current-memory` | 107 | 장기 기억 요약과 관계 메타. 대화가 진행되면 내용과 크기가 변한다 |
| 8 | `narrative-style` | 144 | 일반 인터랙티브/공동 서술 등 현재 채팅 모드에 맞춘 서술 스타일 |
| 9 | `rule-output-layout-recency` | 670 | 한국 웹소설식 문단, 대사와 서술 배치, 읽기 쉬운 출력 레이아웃의 최근성 잠금 |
| 10 | `user-persona-reference-owner` | 545 | 현재 턴에서 유저 배우의 이름·성별·지칭을 최종 확정하는 동적 소유자 |

대표값 기준으로 시스템 규칙만 약 5,556 토큰이며, 전체 시스템 프롬프트의 약 83%다. 반대로 캐릭터 설정은 약 10%, 페르소나는 약 6%, 메모리는 약 2%다(각 추정치를 반올림했으므로 합계가 정확히 100%가 아닐 수 있다). 따라서 이 fixture에서는 캐릭터 원문보다 공통 RP·문체·출력 규칙이 입력의 대부분을 차지한다.

### 조건에 따라 추가되는 블록

실제 배포 방에서는 다음 항목도 조건이 맞으면 system section으로 매 턴 들어간다.

- archive/current/episodic memory, 관계 메모, 공개된 페르소나 비밀
- relevance-selected active canon과 비공개 캐릭터 secret
- 사용자 노트 reference RAG, keyword/global lorebook
- 시나리오 trigger event, simulation/party mode owner, private speech control
- OOC 공동 서술, regenerate divergence, 현재 narrative POV
- 상태창 정책 또는 status-widget override
- 모델별 DeepSeek/Qwen 오염 방지·길이 adapter, 관리자 canary
- 성인 장면 handoff가 발생한 경우 연속성 packet

따라서 “매 턴 얼마인가”의 정확한 답은 아래 식으로 보는 것이 맞다.

```text
매 턴 전체 입력
= systemPrompt(공통 규칙 + 캐릭터 canon + 페르소나/노트 + 메모리 + 조건부 정책)
+ 잘린 최근 대화 history
+ 현재 user 입력 wrapper
+ user 턴 말미의 출력 길이/형식 지시
+ 조건부 lore/장면/감정 overlay
```

## 시스템 프롬프트와 혼동하기 쉬운 매 턴 입력

현재 user 메시지는 원문 그대로만 전달되지 않는다. 역할 구분 wrapper를 씌우고, 모델/모드에 따라 동적 lore, scene directive, 감정 태그, 그리고 최종 응답 길이 계약을 user 턴 말미에 붙인다. 대표 측정에서 현재 user 턴이 1,630 토큰으로 큰 이유도 짧은 샘플 발화 자체가 아니라 이 terminal contract가 포함되기 때문이다.

그러므로 비용과 컨텍스트 점유율을 볼 때는 `systemPrompt` 6,730 토큰만 보지 말고 최근 대화와 현재 user 턴까지 포함한 `FINAL ASSEMBLED` 8,495 토큰을 봐야 한다. provider가 보고하는 실제 prompt token은 이 전체 입력을 기준으로 한다.

## 캐시 관점

OpenRouter 경로는 시스템 프롬프트를 다음 세 덩어리로 나눈다.

| 캐시 구간 | 대표값 | 성격 |
| --- | ---: | --- |
| `systemRulesBlock` | 약 2,483 토큰 | 공통 규칙 중심, 캐시 후보 |
| `characterSettingsBlock` | 약 1,975 토큰 | 문체/캐릭터 쪽 정적 구간, 캐시 후보 |
| `dynamicBlock` | 약 2,269 토큰 | 메모리·페르소나 참조·최근성 규칙 등 턴별 변동 |
| 캐시 가능 합계 | 약 4,458 토큰 | 앞의 두 구간 합계 |

즉 매 턴 논리적으로는 전체 시스템 프롬프트를 보내지만, provider가 prompt cache hit를 인정하면 약 4,458 토큰 규모의 정적 prefix는 일반 신규 입력과 다른 캐시 요율로 집계될 수 있다. “매 턴 포함되는 토큰”과 “매 턴 신규 요율로 과금되는 토큰”은 같은 개념이 아니다.

## 재현 방법

production DB를 저장소에 커밋하지 않고도 현재 코드 기준 fixture를 다음처럼 재현할 수 있다.

```bash
NODE_OPTIONS='--conditions=react-server' npm run dump:system-prompt -- \
  --mock \
  --provider=openrouter \
  --model=google/gemini-3.1-pro-preview \
  --include-history \
  --output=/tmp/system-prompt-dump.txt
```

실제 DB snapshot이 있는 운영 환경에서는 `--mock`을 빼고 `--chat-id=<ID>`를 지정한다.

```bash
NODE_OPTIONS='--conditions=react-server' npm run dump:system-prompt -- \
  --chat-id=<ID> \
  --provider=openrouter \
  --model=<실제 모델 ID> \
  --include-history \
  --output=/tmp/system-prompt-chat-<ID>.txt
```

dump에는 section index, 각 section의 추정 토큰, category별 audit, line-numbered 전체 시스템 프롬프트, 선택 시 history/current user 턴이 포함된다. dump에 캐릭터 비공개 설정, 유저 페르소나·노트, 대화 및 기억이 들어갈 수 있으므로 운영 dump 자체는 PR에 첨부하지 않는다.

## 해석상 제한

1. 저장소의 `data/app.db`는 gitignore 대상이며 이번 감사 환경에는 없었다. 그래서 특정 운영 채팅의 개인화된 원문이나 API usage를 production 실측했다고 주장하지 않는다.
2. 대표 fixture는 일반 캐릭터, OpenRouter, Gemini 3.1 Pro 모델 ID, NSFW on, 9 completed turns 조건이다. 다른 모델, safe mode, simulation, regenerate, continue, 상태 위젯은 section 구성과 크기가 달라진다.
3. `estimateTokens()`는 문자 기반 추정치다. 비용 정산에는 OpenRouter 응답의 `usage.prompt_tokens`, cache read/write/standard input 분해를 우선한다.
4. 캐릭터별 정확한 “내용”에는 비공개 설정과 사용자 데이터가 포함될 수 있어, 이 문서는 구조와 역할만 공개하고 실제 운영 원문은 의도적으로 싣지 않았다.
