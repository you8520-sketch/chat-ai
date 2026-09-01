# LD Image Normalization — REVIEW PACKET

**CURRENT_MAIN_SHA:** `c353a8fd98330748c3f00e375ecf95af75283ef2`
**PR_NUMBER:** 808
**PR_HEAD_SHA:** `43ecd614b37c9f5e16a36c0bb808c0e94c6d39b7`

## Flagship fixture

### RAW SOURCE
```text
태현이 렌의 손목을 붙잡고 "가지 마."라고 말했다.
```

### CANONICAL EVENTS
```json
[
  {
    "sourceMessageId": 1,
    "sourceRole": "assistant",
    "kind": "reaction",
    "actor": "character",
    "text": "태현이 렌의 손목을 붙잡고",
    "id": "E1",
    "order": 1
  },
  {
    "sourceMessageId": 1,
    "sourceRole": "assistant",
    "kind": "dialogue",
    "actor": "character",
    "text": "가지 마.",
    "id": "E2",
    "order": 2
  }
]
```

### HERO EVENT IDS
E1, E2

### USER-FACING VISUAL DESCRIPTION
```text
태현이 렌의 손목을 붙잡고
```

### DOWNSTREAM DIALOGUE (Key dialogue / panels)
```text
 (acting/emotion only — do not render as readable text):
character: “가지 마.”
```

### FINAL ILLUSTRATION PROMPT (scene section excerpt)
```text
Background: 
Hero scene: 태현이 렌의 손목을 붙잡고
Hero beats:
- reaction: 태현이 렌의 손목을 붙잡고
- dialogue: 가지 마.
Key dialogue (acting/emotion only — do not render as readable text):
character: “가지 마.”
```

### COMIC PANEL SPEC
```text
COMIC PANEL SPEC

Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 태현이 렌의 손목을 붙잡고

Hero event ids: E1, E2

Shared background: 

Cast:

A = persona (렌)
B = character (태현)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 태현이 렌의 손목을 붙잡고
Expressions: 태현이 렌의 손목을 붙잡고
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Payoff]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
Acting: 
Expressions: posture and expression matching the scripted beat: 
Speech bubble (B / character): “가지 마.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A and B as the same two identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Gradual emotional progression — each panel should visibly advance the beat from the prior panel.

- 2-panel rhythm: opening beat in panel 1, closing beat in panel 2.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### FINAL COMIC PROMPT (panel region excerpt)
```text


Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 태현이 렌의 손목을 붙잡고

Hero event ids: E1, E2

Shared background: 

Cast:

A = persona (렌)
B = character (태현)

[Panel 1 — Setup]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
B action: 태현이 렌의 손목을 붙잡고
Expressions: 태현이 렌의 손목을 붙잡고
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Payoff]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background: 
Acting: 
Expressions: posture and expression matching the scripted beat: 
Speech bubble (B / character): “가지 마.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A and B as the same two identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Gradual emotional progression — each panel should visibly advance the beat from the prior panel.

- 2-panel rhythm: opening beat in panel 1, closing beat in panel 2.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

## Invariant checks (generated)

- USER_VISIBLE_NO_VERBATIM_DIALOGUE: true
- NO_DANGLING_ATTRIBUTION: true
- HERO_IDS_INCLUDE_DIALOGUE: true
- DOWNSTREAM_KEY_DIALOGUE: true

## AI auto panel planning

**AI_AUTO_PANEL_PLANNING:** NOT_IMPLEMENTED_REQUIRES_PRODUCT_DECISION

Default modal open uses deterministic ScenePlan (0 provider calls). AI planner runs only when user clicks optional AI 장면 제안.

## Scores

**GPT_SCORE:** PENDING
**HUMAN_SCORE:** PENDING

**COMPLETION_STATUS:** (see PR system delta report after full CI green)
