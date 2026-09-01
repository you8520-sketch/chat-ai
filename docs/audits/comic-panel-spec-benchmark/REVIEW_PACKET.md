# Comic Panel Spec Compiler — REVIEW PACKET

`QUALITY_SCORING_BY_CURSOR=false`
`PROVIDER_IMAGE_CALLS=0`

Compare arms:
- **A (legacy):** `formatApprovedScenePlanForComic` prose block
- **B (new):** `compileChatComicPanelSpec` + `renderChatComicPanelSpecSection`

Scores are **PENDING** — for GPT/human review only.

---

## F01-2panel-invite — 후드 귀 초대

- **Format:** 2panel (2 panels)
- **Expected cast:** A=렌, B=태형
- **Expected key beat:** 후드를 만지며 같이 가자고 묻는다
- **Expected dialogue:** 같이 갈래? | 그래.
- **Expected progression:** Setup → Payoff

### Source scene

```text
*후드 귀를 만진다*
"같이 갈래?"
렌이 후드를 만지자 태형이 고개를 돌렸다. "그래."
```

### Selected scene (ScenePlan)

- heroScene: 후드 귀를 만진다 렌이 후드를 만지자 태형이 고개를 돌렸다.
- heroEventIds: E1, E2, E3
- panelCount: 2

### Arm A — legacy panel section

```text
Shared background: 

Panel count: 2

PANEL 1
Situation: 후드 귀를 만진다
Background: 
Persona action: 후드 귀를 만진다
Exact Korean text: persona: “같이 갈래?”

PANEL 2
Situation: 렌이 후드를 만지자 태형이 고개를 돌렸다.
Background: 
Character action: 렌이 후드를 만지자 태형이 고개를 돌렸다.
Exact Korean text: character: “그래.”
```

### Arm B — structured panel spec section

```text
COMIC PANEL SPEC

Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 후드 귀를 만진다 렌이 후드를 만지자 태형이 고개를 돌렸다.

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (렌)
B = character (태형)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 후드 귀를 만진다
Expressions: 후드 귀를 만진다
Speech bubble (A / persona): “같이 갈래?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Payoff]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 렌이 후드를 만지자 태형이 고개를 돌렸다.
Expressions: 렌이 후드를 만지자 태형이 고개를 돌렸다.
Speech bubble (B / character): “그래.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A and B as the same two identities throughout — hair, outfit,

… (truncated 493 chars)
```

### Full prompt panel region (Arm B integrated)

```text
Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 후드 귀를 만진다 렌이 후드를 만지자 태형이 고개를 돌렸다.

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (렌)
B = character (태형)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 후드 귀를 만진다
Expressions: 후드 귀를 만진다
Speech bubble (A / persona): “같이 갈래?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Payoff]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 렌이 후드를 만지자 태형이 고개를 돌렸다.
Expressions: 렌이 후드를 만지자 태형이 고개를 돌렸다.
Speech bubble (B / character): “그래.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A and B as the same two identities throughout — hair, outfit, and face must not

… (truncated 475 chars)
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F02-2panel-door — 문 열기

- **Format:** 2panel (2 panels)
- **Expected cast:** A=유저, B=민수
- **Expected key beat:** 조용히 문을 연다
- **Expected dialogue:** (silent)
- **Expected progression:** Setup → Payoff

### Source scene

```text
*문을 연다*
민수가 조용히 따라 나선다.
```

### Selected scene (ScenePlan)

- heroScene: 문을 연다 민수가 조용히 따라 나선다.
- heroEventIds: E1, E2
- panelCount: 2

### Arm A — legacy panel section

```text
Shared background: 

Panel count: 2

PANEL 1
Situation: 문을 연다
Background: 
Persona action: 문을 연다
Exact Korean text: No speech bubble

PANEL 2
Situation: 민수가 조용히 따라 나선다.
Background: 
Character action: 민수가 조용히 따라 나선다.
Exact Korean text: No speech bubble
```

### Arm B — structured panel spec section

```text
COMIC PANEL SPEC

Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 문을 연다 민수가 조용히 따라 나선다.

Hero event ids: E1, E2

Shared background: 

Cast:

A = persona (유저)
B = character (민수)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 문을 연다
Expressions: 문을 연다
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Payoff]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 민수가 조용히 따라 나선다.
Expressions: 민수가 조용히 따라 나선다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A and B as the same two identities throughout — hair, outfit, and face must not swap.

- Ma

… (truncated 463 chars)
```

### Full prompt panel region (Arm B integrated)

```text
Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 문을 연다 민수가 조용히 따라 나선다.

Hero event ids: E1, E2

Shared background: 

Cast:

A = persona (유저)
B = character (민수)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 문을 연다
Expressions: 문을 연다
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Payoff]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 민수가 조용히 따라 나선다.
Expressions: 민수가 조용히 따라 나선다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A and B as the same two identities throughout — hair, outfit, and face must not swap.

- Maintain consistent 

… (truncated 445 chars)
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F03-2panel-surprise — 깜짝 선물

- **Format:** 2panel (2 panels)
- **Expected cast:** A=하린, B=지훈
- **Expected key beat:** 상자를 내밀며 깜짝 선물
- **Expected dialogue:** 선물이야! | 진짜?
- **Expected progression:** Setup → Payoff

### Source scene

```text
*작은 상자를 내민다*
"선물이야!"
지훈이 눈을 크게 뜨며 "진짜?"라고 되물었다.
```

### Selected scene (ScenePlan)

- heroScene: 작은 상자를 내민다 지훈이 눈을 크게 뜨며
- heroEventIds: E1, E2, E3
- panelCount: 2

### Arm A — legacy panel section

```text
Shared background: 

Panel count: 2

PANEL 1
Situation: 작은 상자를 내민다 지훈이 눈을 크게 뜨며
Background: 
Persona action: 작은 상자를 내민다
Character action: 지훈이 눈을 크게 뜨며
Exact Korean text: persona: “선물이야!”

PANEL 2
Situation: 라고 되물었다.
Background: 
Character action: 라고 되물었다.
Exact Korean text: character: “진짜?”
```

### Arm B — structured panel spec section

```text
COMIC PANEL SPEC

Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 작은 상자를 내민다 지훈이 눈을 크게 뜨며

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (하린)
B = character (지훈)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 작은 상자를 내민다
B action: 지훈이 눈을 크게 뜨며
Expressions: 작은 상자를 내민다; 지훈이 눈을 크게 뜨며
Speech bubble (A / persona): “선물이야!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Payoff]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 라고 되물었다.
Expressions: 라고 되물었다.
Speech bubble (B / character): “진짜?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A and B as the same two identities throughout — hair, outfit, 

… (truncated 492 chars)
```

### Full prompt panel region (Arm B integrated)

```text
Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 작은 상자를 내민다 지훈이 눈을 크게 뜨며

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (하린)
B = character (지훈)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 작은 상자를 내민다
B action: 지훈이 눈을 크게 뜨며
Expressions: 작은 상자를 내민다; 지훈이 눈을 크게 뜨며
Speech bubble (A / persona): “선물이야!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Payoff]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 라고 되물었다.
Expressions: 라고 되물었다.
Speech bubble (B / character): “진짜?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A and B as the same two identities throughout — hair, outfit, and face must not 

… (truncated 474 chars)
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F04-3koma-rain — 비 오는 날 우산

- **Format:** 3koma (3 panels)
- **Expected cast:** A=서연, B=도윤
- **Expected key beat:** 우산을 건네며 함께 걷자
- **Expected dialogue:** 같이 갈래? | …고마워.
- **Expected progression:** Setup → Development → Climax / punchline

### Source scene

```text
*우산을 든다*
"같이 갈래?"
도윤이 잠시 망설이며 시선을 피한다.
서연이 우산을 더 가까이 건넨다. 도윤이 작게 "…고마워."라고 말한다.
```

### Selected scene (ScenePlan)

- heroScene: 우산을 든다 도윤이 잠시 망설이며
- heroEventIds: E1, E2, E3
- panelCount: 3

### Arm A — legacy panel section

```text
Shared background: 

Panel count: 3

PANEL 1
Situation: 우산을 든다
Background: 
Persona action: 우산을 든다
Exact Korean text: persona: “같이 갈래?”

PANEL 2
Situation: 도윤이 잠시 망설이며 시선을 피한다.
Background: 
Character action: 도윤이 잠시 망설이며
Exact Korean text: No speech bubble

PANEL 3
Situation: 라고 말한다.
Background: 
Character action: 라고 말한다.
Exact Korean text: character: “…고마워.”
```

### Arm B — structured panel spec section

```text
COMIC PANEL SPEC

Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 우산을 든다 도윤이 잠시 망설이며

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (서연)
B = character (도윤)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 우산을 든다
Expressions: 우산을 든다
Speech bubble (A / persona): “같이 갈래?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Development]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 도윤이 잠시 망설이며
Expressions: 도윤이 잠시 망설이며
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Climax / punchline]
Camera: frame the closing scripted beat clearly
Framing: recurring character

… (truncated 914 chars)
```

### Full prompt panel region (Arm B integrated)

```text
Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 우산을 든다 도윤이 잠시 망설이며

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (서연)
B = character (도윤)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 우산을 든다
Expressions: 우산을 든다
Speech bubble (A / persona): “같이 갈래?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Development]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 도윤이 잠시 망설이며
Expressions: 도윤이 잠시 망설이며
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Climax / punchline]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in fram

… (truncated 896 chars)
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F05-3koma-cafe — 카페 주문 실수

- **Format:** 3koma (3 panels)
- **Expected cast:** A=민지, B=현우
- **Expected key beat:** 음료를 잘못 받아 당황
- **Expected dialogue:** 이거 내 주문 아닌데? | 아, 미안!
- **Expected progression:** Setup → Development → Climax / punchline

### Source scene

```text
*카운터에서 음료를 받는다*
"이거 내 주문 아닌데?"
현우가 황급히 돌아서며 "아, 미안!"이라고 외친다.
```

### Selected scene (ScenePlan)

- heroScene: 카운터에서 음료를 받는다 현우가 황급히 돌아서며
- heroEventIds: E1, E2, E3
- panelCount: 3

### Arm A — legacy panel section

```text
Shared background: 

Panel count: 3

PANEL 1
Situation: 카운터에서 음료를 받는다
Background: 
Persona action: 카운터에서 음료를 받는다
Exact Korean text: persona: “이거 내 주문 아닌데?”

PANEL 2
Situation: 현우가 황급히 돌아서며
Background: 
Character action: 현우가 황급히 돌아서며
Exact Korean text: character: “아, 미안!”

PANEL 3
Situation: 이라고 외친다.
Background: 
Character action: 이라고 외친다.
Exact Korean text: No speech bubble
```

### Arm B — structured panel spec section

```text
COMIC PANEL SPEC

Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 카운터에서 음료를 받는다 현우가 황급히 돌아서며

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (민지)
B = character (현우)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 카운터에서 음료를 받는다
Expressions: 카운터에서 음료를 받는다
Speech bubble (A / persona): “이거 내 주문 아닌데?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Development]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 현우가 황급히 돌아서며
Expressions: 현우가 황급히 돌아서며
Speech bubble (B / character): “아, 미안!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Climax / punchline]
Camera: frame the closing scripted beat clearly


… (truncated 947 chars)
```

### Full prompt panel region (Arm B integrated)

```text
Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 카운터에서 음료를 받는다 현우가 황급히 돌아서며

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (민지)
B = character (현우)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 카운터에서 음료를 받는다
Expressions: 카운터에서 음료를 받는다
Speech bubble (A / persona): “이거 내 주문 아닌데?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Development]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 현우가 황급히 돌아서며
Expressions: 현우가 황급히 돌아서며
Speech bubble (B / character): “아, 미안!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Climax / punchline]
Camera: frame the closing scripted beat clearly
Framing: recurring

… (truncated 929 chars)
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F06-3koma-study — 공부 격려

- **Format:** 3koma (3 panels)
- **Expected cast:** A=예린, B=준호
- **Expected key beat:** 졸린 준호를 붙잡고 격려
- **Expected dialogue:** 조금만 더! | 알겠어…
- **Expected progression:** Setup → Development → Climax / punchline

### Source scene

```text
준호가 책상에 엎드려 눈을 감는다.
*어깨를 흔든다*
"조금만 더!"
준호가 고개를 들고 "알겠어…"라고 중얼거린다.
```

### Selected scene (ScenePlan)

- heroScene: 준호가 책상에 엎드려 눈을 감는다. 어깨를 흔든다
- heroEventIds: E1, E2, E3
- panelCount: 3

### Arm A — legacy panel section

```text
Shared background: 

Panel count: 3

PANEL 1
Situation: 준호가 책상에 엎드려 눈을 감는다. 어깨를 흔든다
Background: 
Persona action: 어깨를 흔든다
Character action: 준호가 책상에 엎드려 눈을 감는다.
Exact Korean text: No speech bubble

PANEL 2
Situation: 준호가 고개를 들고
Background: 
Character action: 준호가 고개를 들고
Exact Korean text: persona: “조금만 더!”

PANEL 3
Situation: 라고 중얼거린다.
Background: 
Character action: 라고 중얼거린다.
Exact Korean text: character: “알겠어…”
```

### Arm B — structured panel spec section

```text
COMIC PANEL SPEC

Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 준호가 책상에 엎드려 눈을 감는다. 어깨를 흔든다

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (예린)
B = character (준호)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 어깨를 흔든다
B action: 준호가 책상에 엎드려 눈을 감는다.
Expressions: 어깨를 흔든다; 준호가 책상에 엎드려 눈을 감는다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Development]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 준호가 고개를 들고
Expressions: 준호가 고개를 들고
Speech bubble (A / persona): “조금만 더!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Climax / punchline]
Camera: frame th

… (truncated 977 chars)
```

### Full prompt panel region (Arm B integrated)

```text
Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 준호가 책상에 엎드려 눈을 감는다. 어깨를 흔든다

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (예린)
B = character (준호)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 어깨를 흔든다
B action: 준호가 책상에 엎드려 눈을 감는다.
Expressions: 어깨를 흔든다; 준호가 책상에 엎드려 눈을 감는다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Development]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 준호가 고개를 들고
Expressions: 준호가 고개를 들고
Speech bubble (A / persona): “조금만 더!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Climax / punchline]
Camera: frame the closing scripted

… (truncated 959 chars)
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F07-3koma-lost — 길 잃음

- **Format:** 3koma (3 panels)
- **Expected cast:** A=지아, B=태민
- **Expected key beat:** 지도를 펼치며 길을 찾는다
- **Expected dialogue:** 여기 맞아? | …아마도.
- **Expected progression:** Setup → Development → Climax / punchline

### Source scene

```text
*지도를 펼친다*
"여기 맞아?"
태민이 지도를 보며 "…아마도."라고 답한다.
```

### Selected scene (ScenePlan)

- heroScene: 지도를 펼친다 태민이 지도를 보며
- heroEventIds: E1, E2, E3
- panelCount: 3

### Arm A — legacy panel section

```text
Shared background: 

Panel count: 3

PANEL 1
Situation: 지도를 펼친다
Background: 
Persona action: 지도를 펼친다
Exact Korean text: persona: “여기 맞아?”

PANEL 2
Situation: 태민이 지도를 보며
Background: 
Character action: 태민이 지도를 보며
Exact Korean text: character: “…아마도.”

PANEL 3
Situation: 라고 답한다.
Background: 
Character action: 라고 답한다.
Exact Korean text: No speech bubble
```

### Arm B — structured panel spec section

```text
COMIC PANEL SPEC

Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 지도를 펼친다 태민이 지도를 보며

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (지아)
B = character (태민)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 지도를 펼친다
Expressions: 지도를 펼친다
Speech bubble (A / persona): “여기 맞아?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Development]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 태민이 지도를 보며
Expressions: 태민이 지도를 보며
Speech bubble (B / character): “…아마도.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Climax / punchline]
Camera: frame the closing scripted beat clearly
Framing: recurring characters r

… (truncated 914 chars)
```

### Full prompt panel region (Arm B integrated)

```text
Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 지도를 펼친다 태민이 지도를 보며

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (지아)
B = character (태민)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 지도를 펼친다
Expressions: 지도를 펼친다
Speech bubble (A / persona): “여기 맞아?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Development]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 태민이 지도를 보며
Expressions: 태민이 지도를 보며
Speech bubble (B / character): “…아마도.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Climax / punchline]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
L

… (truncated 896 chars)
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F08-4panel-chase — 복도 추격

- **Format:** 4panel (4 panels)
- **Expected cast:** A=한별, B=시우
- **Expected key beat:** 복도에서 뛰어가며 붙잡기
- **Expected dialogue:** 잠깐! | 안 잡혀!
- **Expected progression:** Establish → Escalation → Turn → Resolution

### Source scene

```text
시우가 복도 끝에서 갑자기 뛰기 시작한다.
*뒤쫓으며 외친다*
"잠깐!"
시우가 돌아보며 "안 잡혀!"라고 외친다.
한별이 코너에서 시우의 소매를 붙잡는다.
```

### Selected scene (ScenePlan)

- heroScene: 시우가 복도 끝에서 갑자기 뛰기 시작한다. 뒤쫓으며 외친다
- heroEventIds: E1, E2, E3
- panelCount: 4

### Arm A — legacy panel section

```text
Shared background: 

Panel count: 4

PANEL 1
Situation: 시우가 복도 끝에서 갑자기 뛰기 시작한다. 뒤쫓으며 외친다
Background: 
Persona action: 뒤쫓으며 외친다
Character action: 시우가 복도 끝에서
Exact Korean text: No speech bubble

PANEL 2
Situation: 시우가 돌아보며
Background: 
Character action: 시우가 돌아보며
Exact Korean text: persona: “잠깐!”

PANEL 3
Situation: 라고 외친다.
Background: 
Character action: 라고 외친다.
Exact Korean text: character: “안 잡혀!”

PANEL 4
Situation: 한별이 코너에서 시우의 소매를 붙잡는다.
Background: 
Character action: 한별이 코너에서
Exact Korean text: No speech bubble
```

### Arm B — structured panel spec section

```text
COMIC PANEL SPEC

Format: 4panel (4 panels)

Layout: 4 wide horizontal panels stacked vertically (vertical comic strip / 4panel)

Hero focus: 시우가 복도 끝에서 갑자기 뛰기 시작한다. 뒤쫓으며 외친다

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (한별)
B = character (시우)

[Panel 1 — Establish]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 뒤쫓으며 외친다
B action: 시우가 복도 끝에서
Expressions: 뒤쫓으며 외친다; 시우가 복도 끝에서
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Escalation]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 시우가 돌아보며
Expressions: 시우가 돌아보며
Speech bubble (A / persona): “잠깐!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Turn]
Camera: continue the scripted beat with cle

… (truncated 1378 chars)
```

### Full prompt panel region (Arm B integrated)

```text
Format: 4panel (4 panels)

Layout: 4 wide horizontal panels stacked vertically (vertical comic strip / 4panel)

Hero focus: 시우가 복도 끝에서 갑자기 뛰기 시작한다. 뒤쫓으며 외친다

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (한별)
B = character (시우)

[Panel 1 — Establish]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 뒤쫓으며 외친다
B action: 시우가 복도 끝에서
Expressions: 뒤쫓으며 외친다; 시우가 복도 끝에서
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Escalation]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 시우가 돌아보며
Expressions: 시우가 돌아보며
Speech bubble (A / persona): “잠깐!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Turn]
Camera: continue the scripted beat with clear character stagi

… (truncated 1360 chars)
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F09-4panel-cooking — 요리 실패

- **Format:** 4panel (4 panels)
- **Expected cast:** A=수아, B=건
- **Expected key beat:** 타버린 요리를 발견
- **Expected dialogue:** 이게 뭐야… | 내 탓이야.
- **Expected progression:** Establish → Escalation → Turn → Resolution

### Source scene

```text
건이 냄비 뚜껑을 연다.
검은 연기가 피어오른다.
"이게 뭐야…"
건이 고개를 숙이며 "내 탓이야."라고 말한다.
```

### Selected scene (ScenePlan)

- heroScene: 건이 냄비 뚜껑을 연다. 검은 연기가 피어오른다.
- heroEventIds: E1, E2, E3
- panelCount: 4

### Arm A — legacy panel section

```text
Shared background: 

Panel count: 4

PANEL 1
Situation: 건이 냄비 뚜껑을 연다. 검은 연기가 피어오른다.
Background: 
Character action: 건이 냄비 뚜껑을 연다.
Exact Korean text: No speech bubble

PANEL 2
Situation: 건이 고개를 숙이며
Background: 
Character action: 건이 고개를 숙이며
Exact Korean text: persona: “이게 뭐야…”

PANEL 3
Situation: 
Background: 
Exact Korean text: character: “내 탓이야.”

PANEL 4
Situation: 라고 말한다.
Background: 
Character action: 라고 말한다.
Exact Korean text: No speech bubble
```

### Arm B — structured panel spec section

```text
COMIC PANEL SPEC

Format: 4panel (4 panels)

Layout: 4 wide horizontal panels stacked vertically (vertical comic strip / 4panel)

Hero focus: 건이 냄비 뚜껑을 연다. 검은 연기가 피어오른다.

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (수아)
B = character (건)

[Panel 1 — Establish]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 건이 냄비 뚜껑을 연다.
Expressions: 건이 냄비 뚜껑을 연다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Escalation]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 건이 고개를 숙이며
Expressions: 건이 고개를 숙이며
Speech bubble (A / persona): “이게 뭐야…”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Turn]
Camera: continue the scripted beat with clear character staging
F

… (truncated 1390 chars)
```

### Full prompt panel region (Arm B integrated)

```text
Format: 4panel (4 panels)

Layout: 4 wide horizontal panels stacked vertically (vertical comic strip / 4panel)

Hero focus: 건이 냄비 뚜껑을 연다. 검은 연기가 피어오른다.

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (수아)
B = character (건)

[Panel 1 — Establish]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 건이 냄비 뚜껑을 연다.
Expressions: 건이 냄비 뚜껑을 연다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Escalation]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 건이 고개를 숙이며
Expressions: 건이 고개를 숙이며
Speech bubble (A / persona): “이게 뭐야…”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Turn]
Camera: continue the scripted beat with clear character staging
Framing: recurring 

… (truncated 1372 chars)
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F10-4panel-confession — 고백 직전

- **Format:** 4panel (4 panels)
- **Expected cast:** A=유나, B=재혁
- **Expected key beat:** 손을 잡고 고백
- **Expected dialogue:** 할 말이 있어. | …들을게.
- **Expected progression:** Establish → Escalation → Turn → Resolution

### Source scene

```text
재혁이 노을진 다리 위에 선다.
*손을 잡는다*
"할 말이 있어."
재혁이 숨을 고르며 "…들을게."라고 답한다.
```

### Selected scene (ScenePlan)

- heroScene: 재혁이 노을진 다리 위에 선다. 손을 잡는다
- heroEventIds: E1, E2, E3
- panelCount: 4

### Arm A — legacy panel section

```text
Shared background: 

Panel count: 4

PANEL 1
Situation: 재혁이 노을진 다리 위에 선다. 손을 잡는다
Background: 
Persona action: 손을 잡는다
Character action: 재혁이 노을진 다리 위에 선다.
Exact Korean text: No speech bubble

PANEL 2
Situation: 재혁이 숨을 고르며
Background: 
Character action: 재혁이 숨을 고르며
Exact Korean text: persona: “할 말이 있어.”

PANEL 3
Situation: 
Background: 
Exact Korean text: character: “…들을게.”

PANEL 4
Situation: 라고 답한다.
Background: 
Character action: 라고 답한다.
Exact Korean text: No speech bubble
```

### Arm B — structured panel spec section

```text
COMIC PANEL SPEC

Format: 4panel (4 panels)

Layout: 4 wide horizontal panels stacked vertically (vertical comic strip / 4panel)

Hero focus: 재혁이 노을진 다리 위에 선다. 손을 잡는다

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (유나)
B = character (재혁)

[Panel 1 — Establish]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 손을 잡는다
B action: 재혁이 노을진 다리 위에 선다.
Expressions: 손을 잡는다; 재혁이 노을진 다리 위에 선다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Escalation]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 재혁이 숨을 고르며
Expressions: 재혁이 숨을 고르며
Speech bubble (A / persona): “할 말이 있어.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Turn]
Camera: continue the scripted be

… (truncated 1422 chars)
```

### Full prompt panel region (Arm B integrated)

```text
Format: 4panel (4 panels)

Layout: 4 wide horizontal panels stacked vertically (vertical comic strip / 4panel)

Hero focus: 재혁이 노을진 다리 위에 선다. 손을 잡는다

Hero event ids: E1, E2, E3

Shared background: 

Cast:

A = persona (유나)
B = character (재혁)

[Panel 1 — Establish]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
A action: 손을 잡는다
B action: 재혁이 노을진 다리 위에 선다.
Expressions: 손을 잡는다; 재혁이 노을진 다리 위에 선다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Escalation]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 재혁이 숨을 고르며
Expressions: 재혁이 숨을 고르며
Speech bubble (A / persona): “할 말이 있어.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Turn]
Camera: continue the scripted beat with clear char

… (truncated 1404 chars)
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---
