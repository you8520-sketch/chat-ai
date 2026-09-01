# LD Image Normalization — REVIEW PACKET

**CURRENT_MAIN_SHA:** `80140cf8afc59de38d849eb9323e7ccdf32ea3fb`
**GENERATED_FROM_SOURCE_SHA:** `5434fcf32511dd6494b99bb04eb4b047fc1f2b52`
**PR_NUMBER:** 808

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
B = character (태형)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
B action: 태현이 렌의 손목을 붙잡고
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (B / character): “가지 마.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A and B as the same two identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 2-panel rhythm: opening beat in panel 1, closing beat in panel 2.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### Arm A — legacy panel section (untruncated)
```text
Shared background:

Panel count: 2

PANEL 1
Situation: 태현이 렌의 손목을 붙잡고
Background:
Character action: 태현이 렌의 손목을 붙잡고
Exact Korean text: No speech bubble

PANEL 2
Situation:
Background:
Exact Korean text: character: “가지 마.”
```

### FINAL COMIC PROMPT (full, untruncated)
```text
Create one polished Korean manhwa-style page with exactly 2 wide horizontal panels stacked vertically.

Reference image 1 is LAYOUT AND FINISH ONLY. Follow its clean gutters, readable Korean bubbles, expressive acting, polished full-color rendering, and panel polish, but do not copy its exact poses.

Ignore the sample people drawn on reference image 1. Do not copy their gender presentation, body type, face shape, age, or hair color. Especially do not treat any pink-haired feminine sample figure as either subject.

SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — CHAT CHARACTER: 태형]
Reference: Image 2 belongs ONLY to 태형.
Appearance mode: IMAGE_ONLY
No supplemental saved appearance.
Use this selected reference as the authoritative visual identity for this subject only.
Identity ownership: every trait in this block belongs only to 태형.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — USER PERSONA: 렌]
Reference: Image 3 belongs ONLY to 렌.
Appearance mode: IMAGE_ONLY
No supplemental saved appearance.
Use this selected reference as the authoritative visual identity for this subject only.
Identity ownership: every trait in this block belongs only to 렌.
Never infer SUBJECT B's identity from any other subject.

IDENTITY OWNERSHIP IS STRICT.
REFERENCE 1 is the layout / composition / decoration template ONLY. It is NEVER a character identity source. Do not copy hair, eyes, iris, pupils, clothes, or face from the template onto any subject.
Each subject owns only the visual traits from their own identity block and own reference.
NEVER transfer between subjects: hair color, haircut, bangs, hair part, center part / 5:5 part, eye color, iris color, pupil color, pupil shape, heterochromia, facial marks, scars, tattoos, accessories, body traits, or signature clothes.
Do not average or homogenize identities even when both subjects look similar.
Do not assume that a visually striking feature belongs to every person.
A trait appearing in one subject's reference is NOT a global style property.
Pupil, iris, and overall eye color are distinct traits. Keep each color on the subject that owns it.
Negative identity constraints are authoritative and belong only to the named subject. Do not drop or invert them.
A healed, non-graphic scar that is explicitly part of a subject's saved stable identity or own identity reference may be preserved. Do not invent new scars from scene text or another subject.
STYLE may be harmonized globally. IDENTITY may NOT be harmonized globally.
Unify art style, not identity. Do not average the subjects' physical traits while harmonizing style.
Template or another person's appearance must never be treated as a style characteristic.
PRIORITY: 1) explicit generation product option (pose, expression, temporary costume/prop); 2) this subject's stable saved identity only when IMAGE_PLUS_SAVED; 3) this subject's own reference image; 4) template styling/composition.
Product options may add a temporary prop or costume. They must not rewrite hair color, eye/iris/pupil color, or face identity.

GENDER LOCK — mandatory identity rule.
chat character 태형: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
user persona 렌: confirmed FEMALE. Keep her female in face, torso and body shape. Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male. Do not masculinize her body, jaw, torso or clothing beyond the reference identity.
Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.

Overall tone: light romantic-comedy energy, exaggerated reactions and playful timing.

STRICT CLOSED TEXT WHITELIST: the only text allowed anywhere in the image is listed below. Copy each used string exactly, character for character.

- “가지 마.”

Never invent reaction dialogue, bridge dialogue, narration, captions, labels, titles, signs, or sound effects. Silent panels with no speech are valid. Do not create a speech bubble for a panel marked No speech bubble.

Use proper speech bubbles with tails pointing to the correct speaker. Keep all approved text large, centered, uncropped, and easy to read.

Exactly two recurring human characters. No extra person, duplicate face, identity swap, malformed hands, watermark, or logo.

Keep all panel borders and the full page visible. Do not crop off speech bubbles or the last panel.

COMIC PANEL SPEC

Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 태현이 렌의 손목을 붙잡고

Hero event ids: E1, E2

Shared background:

Cast:

A = persona (렌)
B = character (태형)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
B action: 태현이 렌의 손목을 붙잡고
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (B / character): “가지 마.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A and B as the same two identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 2-panel rhythm: opening beat in panel 1, closing beat in panel 2.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

## DIALOGUE_EDITOR_REVIEW

### 2-panel duo (source)

#### Panel 1
- VISIBLE SCENE DESCRIPTION: 후드 귀를 만진다
- LINE 1
  - VISIBLE SPEAKER NAME: 렌
  - VISIBLE DIALOGUE TEXT: 같이 갈래?
  - PROVENANCE: source
  - SOURCE EVENT ID: E2
  - FINAL BUBBLE: 같이 갈래?

#### Panel 2
- VISIBLE SCENE DESCRIPTION: 렌이 후드를 만지자 태형이 고개를 돌렸다.
- LINE 1
  - VISIBLE SPEAKER NAME: 태형
  - VISIBLE DIALOGUE TEXT: 그래.
  - PROVENANCE: source
  - SOURCE EVENT ID: E4
  - FINAL BUBBLE: 그래.

- FINAL WHITELIST: "같이 갈래?", "그래."

### 2-panel duo (user text edit: 그래. → 좋아.)

#### Panel 1
- VISIBLE SCENE DESCRIPTION: 후드 귀를 만진다
- LINE 1
  - VISIBLE SPEAKER NAME: 렌
  - VISIBLE DIALOGUE TEXT: 같이 갈래?
  - PROVENANCE: source
  - SOURCE EVENT ID: E2
  - FINAL BUBBLE: 같이 갈래?

#### Panel 2
- VISIBLE SCENE DESCRIPTION: 렌이 후드를 만지자 태형이 고개를 돌렸다.
- LINE 1
  - VISIBLE SPEAKER NAME: 태형
  - VISIBLE DIALOGUE TEXT: 좋아.
  - PROVENANCE: user_edit
  - SOURCE EVENT ID: (none)
  - FINAL BUBBLE: 좋아.

- FINAL WHITELIST: "같이 갈래?", "좋아."

### 3-panel duo

#### Panel 1
- VISIBLE SCENE DESCRIPTION: 후드 귀를 만진다
- LINE 1
  - VISIBLE SPEAKER NAME: 렌
  - VISIBLE DIALOGUE TEXT: 같이 갈래?
  - PROVENANCE: source
  - SOURCE EVENT ID: E2
  - FINAL BUBBLE: 같이 갈래?

#### Panel 2
- VISIBLE SCENE DESCRIPTION: 렌이 후드를 만지자 태형이 고개를 돌렸다.
- VISIBLE DIALOGUE: (silent)

#### Panel 3
- VISIBLE SCENE DESCRIPTION:
- LINE 1
  - VISIBLE SPEAKER NAME: 태형
  - VISIBLE DIALOGUE TEXT: 그래.
  - PROVENANCE: source
  - SOURCE EVENT ID: E4
  - FINAL BUBBLE: 그래.

- FINAL WHITELIST: "같이 갈래?", "그래."


## KEYSTROKE_EDIT_REVIEW

### 2-panel keystroke (같이 → 같이 가자.)

#### Panel 1
- VISIBLE SCENE DESCRIPTION:
- LINE 1
  - VISIBLE SPEAKER NAME: 태형
  - VISIBLE DIALOGUE TEXT: 같이 가자.
  - PROVENANCE: user_edit
  - SOURCE EVENT ID: (none)
  - FINAL BUBBLE: 같이 가자.
- LINE 2
  - VISIBLE SPEAKER NAME: 렌
  - VISIBLE DIALOGUE TEXT: (empty)
  - PROVENANCE: user_edit
  - SOURCE EVENT ID: (none)
  - FINAL BUBBLE: (silent)

#### Panel 2
- VISIBLE SCENE DESCRIPTION:
- VISIBLE DIALOGUE: (silent)

- FINAL WHITELIST: "같이 가자."


## USER_ATTRIBUTION_REVIEW

### Source
```text
"좋아."라고 말했다.
```

- CANONICAL DIALOGUE: 좋아.
- FAKE ATTRIBUTION IN EVENTS: false


## Invariant checks (computed)

- USER_VISIBLE_NO_VERBATIM_DIALOGUE: true
- NO_DANGLING_ATTRIBUTION: true
- HERO_IDS_INCLUDE_DIALOGUE: true
- DOWNSTREAM_KEY_DIALOGUE: true
- MALFORMED_ATTRIBUTION_COUNT: 0
- FAKE_ATTRIBUTION_BUBBLE_COUNT: 0
- PANEL_TEXT_WHITELIST_MISMATCH_COUNT: 0
- USER_EDIT_DIALOGUE_MISMATCH_COUNT: 0

## Provenance semantics

- UNCHANGED SOURCE LINE: provenance=source, sourceEventId preserved
- TEXT OR SPEAKER EDIT: provenance=user_edit, sourceEventId removed
- REORDER ONLY (unchanged text/speaker): source provenance + sourceEventId preserved; presentation order is user-controlled

## AI auto panel planning

**AI_AUTO_PANEL_PLANNING_STATUS:** IMPLEMENTED_COMIC_DEFAULT_ONE_CALL

- CLIENT_SCENE_PLAN_REQUESTS_PER_SOURCE: 1
- LOGICAL_SCENE_PLANNER_RUNS_PER_SOURCE: 1
- MAX_PHYSICAL_PROVIDER_ATTEMPTS_PER_LOGICAL_RUN: 2
- ACTUAL_PRIMARY_PROVIDER: CheaperInference
- ACTUAL_PRIMARY_MODEL: gpt-5.6-luna
- ACTUAL_FALLBACK_PROVIDER: OpenRouter
- ACTUAL_FALLBACK_MODEL: google/gemini-3.1-flash-lite
- PANEL_SWITCH_EXTRA_CLIENT_REQUESTS: 0
- PANEL_SWITCH_EXTRA_PROVIDER_ATTEMPTS: 0

## Scores

**GPT_SCORE:** PENDING
**HUMAN_SCORE:** PENDING

**COMPLETION_STATUS:** (see PR system delta report after full CI green)
