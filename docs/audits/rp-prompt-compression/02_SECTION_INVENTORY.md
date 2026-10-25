# 02 Section Inventory

## MODEL: Claude Opus 5

```text
modelId = claude-opus-5
system_total = 5858
```

### 01 openrouter-korean-prose-top

```text
tokens: 738
chars: 819
cached/dynamic: dynamic
common/model-specific: common
owner category: PROSE_STYLE
content vs instruction: INSTRUCTION
label: [TOP] OpenRouter Korean prose
category(build): systemRules
```

### 02 runtime-prompt-contamination-guard

```text
tokens: 799
chars: 887
cached/dynamic: dynamic
common/model-specific: common
owner category: OTHER
content vs instruction: MIXED
label: [TOP] Runtime prompt contamination guard
category(build): systemRules
```

### 03 no-godmodding

```text
tokens: 409
chars: 454
cached/dynamic: dynamic
common/model-specific: common
owner category: AGENCY
content vs instruction: INSTRUCTION
label: [0a] No godmodding (user agency)
category(build): systemRules
```

### 04 character-core-identity

```text
tokens: 492
chars: 546
cached/dynamic: dynamic
common/model-specific: common
owner category: CHARACTER_CANON
content vs instruction: CONTENT
label: [2] Structured character canon (every turn)
category(build): characterSetting
```

### 05 identity-and-rules

```text
tokens: 292
chars: 324
cached/dynamic: dynamic
common/model-specific: common
owner category: PERSONA_AND_USER_RULES
content vs instruction: CONTENT
label: [0] Identity & Rules (absolute)
category(build): persona
```

### 06 prose-style-xml-bundle

```text
tokens: 1709
chars: 1898
cached/dynamic: dynamic
common/model-specific: common
owner category: PROSE_STYLE
content vs instruction: INSTRUCTION
label: [1.4] Prose style policy (XML)
category(build): systemRules
```

### 07 current-memory

```text
tokens: 49
chars: 54
cached/dynamic: dynamic
common/model-specific: common
owner category: MEMORY
content vs instruction: CONTENT
label: [3] Current Memory
category(build): memory
```

### 08 narrative-style

```text
tokens: 144
chars: 159
cached/dynamic: dynamic
common/model-specific: common
owner category: OTHER
content vs instruction: MIXED
label: [7] Style Mode
category(build): systemRules
```

### 09 rule-output-layout-recency

```text
tokens: 670
chars: 744
cached/dynamic: dynamic
common/model-specific: common
owner category: OUTPUT_LAYOUT
content vs instruction: INSTRUCTION
label: Output layout recency (Korean webnovel paragraph breaks)
category(build): systemRules
```

### 10 user-persona-reference-owner

```text
tokens: 545
chars: 605
cached/dynamic: dynamic
common/model-specific: common
owner category: PERSONA_AND_USER_RULES
content vs instruction: CONTENT
label: User persona reference owner (current-turn gender and naming)
category(build): systemRules
```

### USER TURN

```text
current_user_tokens: 1530
has Opus Arm E: true
literal (갸웃) in user turn: true
bare 갸웃 in user turn: true
```

<details><summary>user turn preview</summary>

```text
[CURRENT USER INPUT]
The following is the user's latest input.
It is what the user already said/did.
Do not continue writing the user's future actions, dialogue, thoughts, or decisions.
If the input contains parentheses or action text, treat it as completed user input — not permission to keep narrating the user.
[유저 대사]
신입 ...맞아.나 본적있어?
[유저 지문/행동 — 캐릭터가 관찰 가능]
(갸웃)나는 렌이라고 부르면 돼.

레이아웃: 지문과 "…" 대사 사이 빈 줄(\n\n) 필수 — 지문 줄 끝에 대사 붙이지 말 것.

이번 응답은 한국어 총 표시 3,200~4,200자의 하나의 밀도 있는 장면으로 전개한다.

분량은 [A]와 AI가 담당하는 NPC·환경의 판단, 대사, 행동, 감각, 반응 및 그 결과를 중심으로 확장한다.

[B]의 유저 페르소나와 최근 행동 양식은 [B]의 즉각적인 반응을 자연스럽게 연결하기 위한 보조 근거로만 사용한다. 페르소나에 어울린다는 이유만으로 새로운 목표·선택·대사·동의·거절·관계 결정·위험 행동을 대신 만들지 않는다.

[B]가 현재 입력에서 이미 시작한 행동은 즉각적이고 가역적인 범위에서 자연스럽게 마무리할 수 있다. 또한 현재 상황에서 거의 자동적으로 발생하는 작고 비결정적인 반응은 유저 페르소나와 명백히 모순되지 않을 때만 제한적으로 묘사할 수 있다.

허용 가능한 [B]의 보조 행동은 모두 다음 조건을 충족해야 한다.

1. 현재 입력이나 직전 상황에서 직접 이어지는 행동이다.
2. 유저 페르소나 및 최근 행동과 모순되지 않는다.
3. 짧고 즉각적이며 되돌릴 수 있다.
4. 장면의 방향·관계·위험·동의를 결정하지 않는다.
5. 새로운 직접 대사를 포함하지 않는다.
6. 여러 단계의 후속 행동 연쇄로 확장되지 않는다.

[B]가 현재 입력에서 직접 선언하거나 시작한 하나의 행동은 그 행동 자체의 즉각적인 결과까지 이어갈 수 있다. 그러나 [B]가 “지시해”, “시키는 대로 하겠다”, “명령만 해”, “따르겠다”처럼 아직 특정되지 않은 이후 행동을 맡긴 표현은 미래 행동 전체에 대한 포괄적 위임이 아니다.
이 경우 AI는
```

</details>

## MODEL: Gemini 3.1 Pro Preview

```text
modelId = gemini-3.1-pro-preview
system_total = 5858
```

### 01 openrouter-korean-prose-top

```text
tokens: 738
chars: 819
cached/dynamic: dynamic
common/model-specific: common
owner category: PROSE_STYLE
content vs instruction: INSTRUCTION
label: [TOP] OpenRouter Korean prose
category(build): systemRules
```

### 02 runtime-prompt-contamination-guard

```text
tokens: 799
chars: 887
cached/dynamic: dynamic
common/model-specific: common
owner category: OTHER
content vs instruction: MIXED
label: [TOP] Runtime prompt contamination guard
category(build): systemRules
```

### 03 no-godmodding

```text
tokens: 409
chars: 454
cached/dynamic: dynamic
common/model-specific: common
owner category: AGENCY
content vs instruction: INSTRUCTION
label: [0a] No godmodding (user agency)
category(build): systemRules
```

### 04 character-core-identity

```text
tokens: 492
chars: 546
cached/dynamic: dynamic
common/model-specific: common
owner category: CHARACTER_CANON
content vs instruction: CONTENT
label: [2] Structured character canon (every turn)
category(build): characterSetting
```

### 05 identity-and-rules

```text
tokens: 292
chars: 324
cached/dynamic: dynamic
common/model-specific: common
owner category: PERSONA_AND_USER_RULES
content vs instruction: CONTENT
label: [0] Identity & Rules (absolute)
category(build): persona
```

### 06 prose-style-xml-bundle

```text
tokens: 1709
chars: 1898
cached/dynamic: dynamic
common/model-specific: common
owner category: PROSE_STYLE
content vs instruction: INSTRUCTION
label: [1.4] Prose style policy (XML)
category(build): systemRules
```

### 07 current-memory

```text
tokens: 49
chars: 54
cached/dynamic: dynamic
common/model-specific: common
owner category: MEMORY
content vs instruction: CONTENT
label: [3] Current Memory
category(build): memory
```

### 08 narrative-style

```text
tokens: 144
chars: 159
cached/dynamic: dynamic
common/model-specific: common
owner category: OTHER
content vs instruction: MIXED
label: [7] Style Mode
category(build): systemRules
```

### 09 rule-output-layout-recency

```text
tokens: 670
chars: 744
cached/dynamic: dynamic
common/model-specific: common
owner category: OUTPUT_LAYOUT
content vs instruction: INSTRUCTION
label: Output layout recency (Korean webnovel paragraph breaks)
category(build): systemRules
```

### 10 user-persona-reference-owner

```text
tokens: 545
chars: 605
cached/dynamic: dynamic
common/model-specific: common
owner category: PERSONA_AND_USER_RULES
content vs instruction: CONTENT
label: User persona reference owner (current-turn gender and naming)
category(build): systemRules
```

### USER TURN

```text
current_user_tokens: 500
has Opus Arm E: false
literal (갸웃) in user turn: true
bare 갸웃 in user turn: true
```

<details><summary>user turn preview</summary>

```text
[CURRENT USER INPUT]
The following is the user's latest input.
It is what the user already said/did.
Do not continue writing the user's future actions, dialogue, thoughts, or decisions.
If the input contains parentheses or action text, treat it as completed user input — not permission to keep narrating the user.
[유저 대사]
신입 ...맞아.나 본적있어?
[유저 지문/행동 — 캐릭터가 관찰 가능]
(갸웃)나는 렌이라고 부르면 돼.

레이아웃: 지문과 "…" 대사 사이 빈 줄(\n\n) 필수 — 지문 줄 끝에 대사 붙이지 말 것.

이번 응답은 한국어 3,200~4,200자 범위의 하나의 밀도 있는 장면으로 전개한다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다.
```

</details>

## MODEL: DeepSeek V4 Pro

```text
modelId = deepseek-v4-pro
system_total = 6064
```

### 01 openrouter-korean-prose-top

```text
tokens: 738
chars: 819
cached/dynamic: dynamic
common/model-specific: common
owner category: PROSE_STYLE
content vs instruction: INSTRUCTION
label: [TOP] OpenRouter Korean prose
category(build): systemRules
```

### 02 runtime-prompt-contamination-guard

```text
tokens: 856
chars: 951
cached/dynamic: dynamic
common/model-specific: common
owner category: OTHER
content vs instruction: MIXED
label: [TOP] Runtime prompt contamination guard
category(build): systemRules
```

### 03 no-godmodding

```text
tokens: 409
chars: 454
cached/dynamic: dynamic
common/model-specific: common
owner category: AGENCY
content vs instruction: INSTRUCTION
label: [0a] No godmodding (user agency)
category(build): systemRules
```

### 04 character-core-identity

```text
tokens: 492
chars: 546
cached/dynamic: dynamic
common/model-specific: common
owner category: CHARACTER_CANON
content vs instruction: CONTENT
label: [2] Structured character canon (every turn)
category(build): characterSetting
```

### 05 identity-and-rules

```text
tokens: 292
chars: 324
cached/dynamic: dynamic
common/model-specific: common
owner category: PERSONA_AND_USER_RULES
content vs instruction: CONTENT
label: [0] Identity & Rules (absolute)
category(build): persona
```

### 06 prose-style-xml-bundle

```text
tokens: 1709
chars: 1898
cached/dynamic: dynamic
common/model-specific: common
owner category: PROSE_STYLE
content vs instruction: INSTRUCTION
label: [1.4] Prose style policy (XML)
category(build): systemRules
```

### 07 current-memory

```text
tokens: 49
chars: 54
cached/dynamic: dynamic
common/model-specific: common
owner category: MEMORY
content vs instruction: CONTENT
label: [3] Current Memory
category(build): memory
```

### 08 narrative-style

```text
tokens: 144
chars: 159
cached/dynamic: dynamic
common/model-specific: common
owner category: OTHER
content vs instruction: MIXED
label: [7] Style Mode
category(build): systemRules
```

### 09 rule-output-layout-recency

```text
tokens: 670
chars: 744
cached/dynamic: dynamic
common/model-specific: common
owner category: OUTPUT_LAYOUT
content vs instruction: INSTRUCTION
label: Output layout recency (Korean webnovel paragraph breaks)
category(build): systemRules
```

### 10 user-persona-reference-owner

```text
tokens: 545
chars: 605
cached/dynamic: dynamic
common/model-specific: common
owner category: PERSONA_AND_USER_RULES
content vs instruction: CONTENT
label: User persona reference owner (current-turn gender and naming)
category(build): systemRules
```

### USER TURN

```text
current_user_tokens: 835
has Opus Arm E: false
literal (갸웃) in user turn: true
bare 갸웃 in user turn: true
```

<details><summary>user turn preview</summary>

```text
[System Reminder: 지문은 -다/-했다체(경어 금지), 실제 발화만 큰따옴표, 속마음·감정은 따옴표 없이 지문으로. 대사는 캐릭터 말투에 따라 짧을 수 있다. 지문은 이어지는 행동·감각·의도를 같은 의미 단락 안에서 자연스럽게 연결하며, 짧은 문장마다 새 문단을 만들거나 한두 단어짜리 파편문을 습관적으로 반복하지 않는다.]
[CURRENT USER INPUT]
The following is the user's latest input.
It is what the user already said/did.
Do not continue writing the user's future actions, dialogue, thoughts, or decisions.
If the input contains parentheses or action text, treat it as completed user input — not permission to keep narrating the user.
[유저 대사]
신입 ...맞아.나 본적있어?
[유저 지문/행동 — 캐릭터가 관찰 가능]
(갸웃)나는 렌이라고 부르면 돼.

레이아웃: 지문과 "…" 대사 사이 빈 줄(\n\n) 필수 — 지문 줄 끝에 대사 붙이지 말 것.

[B]가 “시키는 대로 하겠다”, “지시해”, “따르겠다”처럼 포괄적으로 순응 의사를 밝혀도 이후 모든 행동·대사·선택을 대신 수행하라는 뜻은 아니다. 현재 상황에서 짧고 즉각적이며 되돌릴 수 있는 단일 보조 행동은 자연스럽게 이어갈 수 있지만, 그것을 두 번째 행동·새 대사·새 동의·중요한 선택으로 자동 연쇄하지 않는다.

이번 응답은 한국어 3,200~4,200자 범위의 하나의 밀도 있는 장면으로 전개한다. 현재 상호작용을 요약하거나 성급히 닫지 말고, 관찰·행동·대사·감각·심리가 서로 다음 변화를 일으키도록 충분히 전개한다.
```

</details>

## MODEL: GPT-5.6 Terra

```text
modelId = gpt-5.6-terra
system_total = 5858
```

### 01 openrouter-korean-prose-top

```text
tokens: 738
chars: 819
cached/dynamic: dynamic
common/model-specific: common
owner category: PROSE_STYLE
content vs instruction: INSTRUCTION
label: [TOP] OpenRouter Korean prose
category(build): systemRules
```

### 02 runtime-prompt-contamination-guard

```text
tokens: 799
chars: 887
cached/dynamic: dynamic
common/model-specific: common
owner category: OTHER
content vs instruction: MIXED
label: [TOP] Runtime prompt contamination guard
category(build): systemRules
```

### 03 no-godmodding

```text
tokens: 409
chars: 454
cached/dynamic: dynamic
common/model-specific: common
owner category: AGENCY
content vs instruction: INSTRUCTION
label: [0a] No godmodding (user agency)
category(build): systemRules
```

### 04 character-core-identity

```text
tokens: 492
chars: 546
cached/dynamic: dynamic
common/model-specific: common
owner category: CHARACTER_CANON
content vs instruction: CONTENT
label: [2] Structured character canon (every turn)
category(build): characterSetting
```

### 05 identity-and-rules

```text
tokens: 292
chars: 324
cached/dynamic: dynamic
common/model-specific: common
owner category: PERSONA_AND_USER_RULES
content vs instruction: CONTENT
label: [0] Identity & Rules (absolute)
category(build): persona
```

### 06 prose-style-xml-bundle

```text
tokens: 1709
chars: 1898
cached/dynamic: dynamic
common/model-specific: common
owner category: PROSE_STYLE
content vs instruction: INSTRUCTION
label: [1.4] Prose style policy (XML)
category(build): systemRules
```

### 07 current-memory

```text
tokens: 49
chars: 54
cached/dynamic: dynamic
common/model-specific: common
owner category: MEMORY
content vs instruction: CONTENT
label: [3] Current Memory
category(build): memory
```

### 08 narrative-style

```text
tokens: 144
chars: 159
cached/dynamic: dynamic
common/model-specific: common
owner category: OTHER
content vs instruction: MIXED
label: [7] Style Mode
category(build): systemRules
```

### 09 rule-output-layout-recency

```text
tokens: 670
chars: 744
cached/dynamic: dynamic
common/model-specific: common
owner category: OUTPUT_LAYOUT
content vs instruction: INSTRUCTION
label: Output layout recency (Korean webnovel paragraph breaks)
category(build): systemRules
```

### 10 user-persona-reference-owner

```text
tokens: 545
chars: 605
cached/dynamic: dynamic
common/model-specific: common
owner category: PERSONA_AND_USER_RULES
content vs instruction: CONTENT
label: User persona reference owner (current-turn gender and naming)
category(build): systemRules
```

### USER TURN

```text
current_user_tokens: 548
has Opus Arm E: false
literal (갸웃) in user turn: true
bare 갸웃 in user turn: true
```

<details><summary>user turn preview</summary>

```text
[CURRENT USER INPUT]
The following is the user's latest input.
It is what the user already said/did.
Do not continue writing the user's future actions, dialogue, thoughts, or decisions.
If the input contains parentheses or action text, treat it as completed user input — not permission to keep narrating the user.

[유저 대사]
신입 ...맞아.나 본적있어?

[유저 지문/행동 — 캐릭터가 관찰 가능]
(갸웃)나는 렌이라고 부르면 돼.

레이아웃: 지문과 "…" 대사 사이 빈 줄(\n\n) 필수 — 지문 줄 끝에 대사 붙이지 말 것.
이번 응답은 한국어 RP 본문만 3,200~4,200자로 작성한다. 현재 상호작용을 관찰·행동·대사·감각·심리의 인과적 연쇄로 전개하여, 조용한 장면에서는 관계나 상황의 확인 가능한 변화 하나에 도달하고, 행동 장면에서는 이번 턴에 시작된 주요 행동의 최초로 확인 가능한 결과에 도달한 뒤 마무리한다.
```

</details>

