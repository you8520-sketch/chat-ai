# GPT review packet — input only

Do not score in this file. Cursor did not assign an RP style score.

## Live user-authoring policy (current HAV default)

- Owner: `src/lib/userAuthoringPolicy.ts` + `src/lib/noGodmodding.ts#COLLABORATIVE_INTERACTIVE_OWNER_BLOCK`
- Default level: `NORMAL`
- allowDialogue: true
- allowMajorActions: true
- allowInnerPov: false
- allowIrreversibleFate: false

유저 페르소나 `[B]`의 새 직접 대사, 중요한 선택, 동의/거절, 관계·정체성 변경은 확정하지 않는다. 짧은 표정·시선·비자발 반응과 이미 시작한 행동의 자연스러운 마무리는 공동 서술할 수 있다.

## Synthetic character (public fixture)

Source: `src/lib/scenePolicyBenchmarkDataset.ts` fixture `B03a`.
Not a live user chat. Not adult content. Not production roster character 10/18.

- Character: 한서린
- Gender: female
- Personality: 차분하고 관찰력이 뛰어나며, 감정을 겉으로 드러내지 않는다.
- Speech: 평소 "~요", "~죠" 등 정중한 존댓말
- World: 현대 도시의 중형 아파트와 인근 상가
- Example dialog: 유저 "오늘은 좀 쉴까?" / 한서린 "…그래요. 조용히 있어도 괜찮아요."

## Synthetic persona

- Name: 민
- Gender: other
- Description: 20대 후반. 직장인. 말수는 적지만 행동으로 장면을 이끈다.

## Shared memory

- 두 사람은 같은 아파트 단지에 살며, 최근 몇 달간 서로의 일상을 자연스럽게 공유해 왔다.
- affection 55 / trust 60 / label 편안한 지인

## History

1. Assistant: 복도 끝 안내판을 본다.
2. User: 저쪽으로 나가자.
3. Assistant: …알겠어요.
4. User: 엘리베이터 쪽이야.

## Current user turn

앞장서서 엘리베이터 버튼을 누른다.

## Assembled request identity

- systemPromptSha256: `59a2216f1b9aaf912bdd0a4dbde2a9d9a6a69a23567845aab0c93ec40b091768`
- promptSha256: `3ec3f303aa31020395603001f2cac4bf3fdf83c46e556ae1d0b5925bbe8430af`
- estimatedPromptTokens (char heuristic): 8687
- Rebuild locally with `scripts/lib/openscaleDeepseekV41FlashRpPilot.ts#buildOpenScalePilotAssembly` (no network)

## Model settings sent to OpenScale

- model: `deepseek/deepseek-v4.1-flash`
- temperature: 0.92
- top_p: 0.92
- max_tokens: omitted
- stream: true
- stream_options.include_usage: true
- reasoning_effort: none
- thinking object: omitted (not in OpenScale catalog `supported_parameters`)

## Review axes (no scores here)

- 자연스러운 한국어
- 캐릭터 일관성
- 심리·감정·환경 묘사
- 대사와 서술의 균형
- 지시 이행
- 장문 유지 (하브 soft aim 3200+)
- 불필요한 반복
- RP 몰입감
- NORMAL 권한과 맞는 유저 대사·행동 서술 여부
