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
- **Canonical identity map:** A=태형, B=렌
- **Reference map:** Image 1 → 태형; Image 2 → 렌
- **Expected key beat:** 후드를 만지며 같이 가자고 묻는다
- **Expected dialogue:** 같이 갈래? | 그래.
- **Expected progression:** Opening beat → Closing beat
- **Identity audit:** SUBJECT_LABEL_CONFLICT=0, ACTION_OWNER_CONFLICT=0, SPEECH_OWNER_CONFLICT=0

### Source scene

```text
*후드 귀를 만진다*
"같이 갈래?"
렌이 후드를 만지자 태형이 고개를 돌렸다. "그래."
```

### Selected scene (ScenePlan summary, untruncated)

- heroScene: 후드 귀를 만진다 렌이 후드를 만지자 태형이 고개를 돌렸다.
- heroEventIds: E1, E2, E3
- panelCount: 2
- panel 1: 후드 귀를 만진다 | dialogue: persona:"같이 갈래?"
- panel 2: 렌이 후드를 만지자 태형이 고개를 돌렸다. | dialogue: character:"그래."

### Arm A — legacy panel section (untruncated)

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
Exact Korean text: character: “그래.”
```

### Arm B — structured panel spec section (untruncated)

```text
COMIC PANEL SPEC

Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 후드 귀를 만진다 렌이 후드를 만지자 태형이 고개를 돌렸다.

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (태형)
B = user persona (렌)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 후드 귀를 만진다
Background:
B action (렌): 후드 귀를 만진다
Speech bubble (B / persona): “같이 갈래?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 렌이 후드를 만지자 태형이 고개를 돌렸다.
Background:
Scene action: 렌이 후드를 만지자 태형이 고개를 돌렸다.
Speech bubble (A / character): “그래.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

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

### FULL FINAL ASSEMBLED PROMPT (untruncated)

```text
Create one polished Korean manhwa-style page with exactly 2 wide horizontal panels stacked vertically.

Reference image 1 is LAYOUT AND FINISH ONLY. Follow its clean gutters, readable Korean bubbles, expressive acting, polished full-color rendering, and panel polish, but do not copy its exact poses.

Ignore the sample people drawn on reference image 1. Do not copy their gender presentation, body type, face shape, age, or hair color. Especially do not treat any pink-haired feminine sample figure as either subject.

SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — CHAT CHARACTER: 태형]
Reference: Image 1 belongs ONLY to 태형.
Appearance mode: IMAGE_ONLY
No supplemental saved appearance.
Use this selected reference as the authoritative visual identity for this subject only.
Identity ownership: every trait in this block belongs only to 태형.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — USER PERSONA: 렌]
Reference: Image 2 belongs ONLY to 렌.
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

- “같이 갈래?”
- “그래.”

Never invent reaction dialogue, bridge dialogue, narration, captions, labels, titles, signs, or sound effects. Silent panels with no speech are valid. Do not create a speech bubble for a panel marked No speech bubble.

Use proper speech bubbles with tails pointing to the correct speaker. Keep all approved text large, centered, uncropped, and easy to read.

Exactly two recurring human characters. No extra person, duplicate face, identity swap, malformed hands, watermark, or logo.

Keep all panel borders and the full page visible. Do not crop off speech bubbles or the last panel.

COMIC PANEL SPEC

Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 후드 귀를 만진다 렌이 후드를 만지자 태형이 고개를 돌렸다.

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (태형)
B = user persona (렌)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 후드 귀를 만진다
Background:
B action (렌): 후드 귀를 만진다
Speech bubble (B / persona): “같이 갈래?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 렌이 후드를 만지자 태형이 고개를 돌렸다.
Background:
Scene action: 렌이 후드를 만지자 태형이 고개를 돌렸다.
Speech bubble (A / character): “그래.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

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

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F02-2panel-door — 문 열기

- **Format:** 2panel (2 panels)
- **Canonical identity map:** A=민수, B=유저
- **Reference map:** Image 1 → 민수; Image 2 → 유저
- **Expected key beat:** 조용히 문을 연다
- **Expected dialogue:** (silent)
- **Expected progression:** Opening beat → Closing beat
- **Identity audit:** SUBJECT_LABEL_CONFLICT=0, ACTION_OWNER_CONFLICT=0, SPEECH_OWNER_CONFLICT=0

### Source scene

```text
*문을 연다*
민수가 조용히 따라 나선다.
```

### Selected scene (ScenePlan summary, untruncated)

- heroScene: 문을 연다 민수가 조용히 따라 나선다.
- heroEventIds: E1, E2
- panelCount: 2
- panel 1: 문을 연다 | dialogue: (silent)
- panel 2: 민수가 조용히 따라 나선다. | dialogue: (silent)

### Arm A — legacy panel section (untruncated)

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
Exact Korean text: No speech bubble
```

### Arm B — structured panel spec section (untruncated)

```text
COMIC PANEL SPEC

Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 문을 연다 민수가 조용히 따라 나선다.

Hero event ids: E1, E2

Shared background:

Cast:

A = chat character (민수)
B = user persona (유저)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 문을 연다
Background:
B action (유저): 문을 연다
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 민수가 조용히 따라 나선다.
Background:
Scene action: 민수가 조용히 따라 나선다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

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

### Full prompt panel region (Arm B integrated, untruncated)

```text


Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 문을 연다 민수가 조용히 따라 나선다.

Hero event ids: E1, E2

Shared background:

Cast:

A = chat character (민수)
B = user persona (유저)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 문을 연다
Background:
B action (유저): 문을 연다
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 민수가 조용히 따라 나선다.
Background:
Scene action: 민수가 조용히 따라 나선다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

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

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F03-2panel-surprise — 깜짝 선물

- **Format:** 2panel (2 panels)
- **Canonical identity map:** A=지훈, B=하린
- **Reference map:** Image 1 → 지훈; Image 2 → 하린
- **Expected key beat:** 상자를 내밀며 깜짝 선물
- **Expected dialogue:** 선물이야! | 진짜?
- **Expected progression:** Opening beat → Closing beat
- **Identity audit:** SUBJECT_LABEL_CONFLICT=0, ACTION_OWNER_CONFLICT=0, SPEECH_OWNER_CONFLICT=0

### Source scene

```text
*작은 상자를 내민다*
"선물이야!"
지훈이 눈을 크게 뜨며 "진짜?"라고 되물었다.
```

### Selected scene (ScenePlan summary, untruncated)

- heroScene: 작은 상자를 내민다 지훈이 눈을 크게 뜨며
- heroEventIds: E1, E2, E3
- panelCount: 2
- panel 1: 작은 상자를 내민다 | dialogue: persona:"선물이야!"
- panel 2: 지훈이 눈을 크게 뜨며 | dialogue: character:"진짜?"

### Arm A — legacy panel section (untruncated)

```text
Shared background:

Panel count: 2

PANEL 1
Situation: 작은 상자를 내민다
Background:
Persona action: 작은 상자를 내민다
Exact Korean text: persona: “선물이야!”

PANEL 2
Situation: 지훈이 눈을 크게 뜨며
Background:
Exact Korean text: character: “진짜?”
```

### Arm B — structured panel spec section (untruncated)

```text
COMIC PANEL SPEC

Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 작은 상자를 내민다 지훈이 눈을 크게 뜨며

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (지훈)
B = user persona (하린)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 작은 상자를 내민다
Background:
B action (하린): 작은 상자를 내민다
Speech bubble (B / persona): “선물이야!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 지훈이 눈을 크게 뜨며
Background:
Scene action: 지훈이 눈을 크게 뜨며
Speech bubble (A / character): “진짜?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

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

### Full prompt panel region (Arm B integrated, untruncated)

```text


Format: 2panel (2 panels)

Layout: 2 wide horizontal panels stacked vertically (vertical comic strip / 2panel)

Hero focus: 작은 상자를 내민다 지훈이 눈을 크게 뜨며

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (지훈)
B = user persona (하린)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 작은 상자를 내민다
Background:
B action (하린): 작은 상자를 내민다
Speech bubble (B / persona): “선물이야!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 지훈이 눈을 크게 뜨며
Background:
Scene action: 지훈이 눈을 크게 뜨며
Speech bubble (A / character): “진짜?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

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

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F04-3koma-rain — 비 오는 날 우산

- **Format:** 3koma (3 panels)
- **Canonical identity map:** A=도윤, B=서연
- **Reference map:** Image 1 → 도윤; Image 2 → 서연
- **Expected key beat:** 우산을 건네며 함께 걷자
- **Expected dialogue:** 같이 갈래? | …고마워.
- **Expected progression:** Opening beat → Middle beat → Closing beat
- **Identity audit:** SUBJECT_LABEL_CONFLICT=0, ACTION_OWNER_CONFLICT=0, SPEECH_OWNER_CONFLICT=0

### Source scene

```text
*우산을 든다*
"같이 갈래?"
도윤이 잠시 망설이며 시선을 피한다.
서연이 우산을 더 가까이 건넨다. 도윤이 작게 "…고마워."라고 말한다.
```

### Selected scene (ScenePlan summary, untruncated)

- heroScene: 우산을 든다 도윤이 잠시 망설이며
- heroEventIds: E1, E2, E3
- panelCount: 3
- panel 1: 우산을 든다 | dialogue: persona:"같이 갈래?"
- panel 2: 도윤이 잠시 망설이며 시선을 피한다. | dialogue: (silent)
- panel 3: 서연이 우산을 더 가까이 건넨다. 도윤이 작게 | dialogue: character:"…고마워."

### Arm A — legacy panel section (untruncated)

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
Exact Korean text: No speech bubble

PANEL 3
Situation: 서연이 우산을 더 가까이 건넨다. 도윤이 작게
Background:
Exact Korean text: character: “…고마워.”
```

### Arm B — structured panel spec section (untruncated)

```text
COMIC PANEL SPEC

Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 우산을 든다 도윤이 잠시 망설이며

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (도윤)
B = user persona (서연)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 우산을 든다
Background:
B action (서연): 우산을 든다
Speech bubble (B / persona): “같이 갈래?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Middle beat]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 도윤이 잠시 망설이며 시선을 피한다.
Background:
Scene action: 도윤이 잠시 망설이며 시선을 피한다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 서연이 우산을 더 가까이 건넨다. 도윤이 작게
Background:
Scene action: 서연이 우산을 더 가까이 건넨다. 도윤이 작게
Speech bubble (A / character): “…고마워.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 3-panel rhythm: opening → middle → closing beat — each panel covers a distinct scripted moment.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### FULL FINAL ASSEMBLED PROMPT (untruncated)

```text
Create one polished Korean manhwa-style page with exactly 3 wide horizontal panels stacked vertically.

Reference image 1 is LAYOUT AND FINISH ONLY. Follow its clean gutters, readable Korean bubbles, expressive acting, polished full-color rendering, and panel polish, but do not copy its exact poses.

Ignore the sample people drawn on reference image 1. Do not copy their gender presentation, body type, face shape, age, or hair color. Especially do not treat any pink-haired feminine sample figure as either subject.

SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — CHAT CHARACTER: 도윤]
Reference: Image 1 belongs ONLY to 도윤.
Appearance mode: IMAGE_ONLY
No supplemental saved appearance.
Use this selected reference as the authoritative visual identity for this subject only.
Identity ownership: every trait in this block belongs only to 도윤.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — USER PERSONA: 서연]
Reference: Image 2 belongs ONLY to 서연.
Appearance mode: IMAGE_ONLY
No supplemental saved appearance.
Use this selected reference as the authoritative visual identity for this subject only.
Identity ownership: every trait in this block belongs only to 서연.
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
chat character 도윤: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
user persona 서연: confirmed FEMALE. Keep her female in face, torso and body shape. Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male. Do not masculinize her body, jaw, torso or clothing beyond the reference identity.
Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.

Overall tone: light romantic-comedy energy, exaggerated reactions and playful timing.

STRICT CLOSED TEXT WHITELIST: the only text allowed anywhere in the image is listed below. Copy each used string exactly, character for character.

- “같이 갈래?”
- “…고마워.”

Never invent reaction dialogue, bridge dialogue, narration, captions, labels, titles, signs, or sound effects. Silent panels with no speech are valid. Do not create a speech bubble for a panel marked No speech bubble.

Use proper speech bubbles with tails pointing to the correct speaker. Keep all approved text large, centered, uncropped, and easy to read.

Exactly two recurring human characters. No extra person, duplicate face, identity swap, malformed hands, watermark, or logo.

Keep all panel borders and the full page visible. Do not crop off speech bubbles or the last panel.

COMIC PANEL SPEC

Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 우산을 든다 도윤이 잠시 망설이며

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (도윤)
B = user persona (서연)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 우산을 든다
Background:
B action (서연): 우산을 든다
Speech bubble (B / persona): “같이 갈래?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Middle beat]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 도윤이 잠시 망설이며 시선을 피한다.
Background:
Scene action: 도윤이 잠시 망설이며 시선을 피한다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 서연이 우산을 더 가까이 건넨다. 도윤이 작게
Background:
Scene action: 서연이 우산을 더 가까이 건넨다. 도윤이 작게
Speech bubble (A / character): “…고마워.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 3-panel rhythm: opening → middle → closing beat — each panel covers a distinct scripted moment.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F05-3koma-cafe — 카페 주문 실수

- **Format:** 3koma (3 panels)
- **Canonical identity map:** A=현우, B=민지
- **Reference map:** Image 1 → 현우; Image 2 → 민지
- **Expected key beat:** 음료를 잘못 받아 당황
- **Expected dialogue:** 이거 내 주문 아닌데? | 아, 미안!
- **Expected progression:** Opening beat → Middle beat → Closing beat
- **Identity audit:** SUBJECT_LABEL_CONFLICT=0, ACTION_OWNER_CONFLICT=0, SPEECH_OWNER_CONFLICT=0

### Source scene

```text
*카운터에서 음료를 받는다*
"이거 내 주문 아닌데?"
현우가 황급히 돌아서며 "아, 미안!"이라고 외친다.
```

### Selected scene (ScenePlan summary, untruncated)

- heroScene: 카운터에서 음료를 받는다 현우가 황급히 돌아서며
- heroEventIds: E1, E2, E3
- panelCount: 3
- panel 1: 카운터에서 음료를 받는다 | dialogue: persona:"이거 내 주문 아닌데?"
- panel 2: 현우가 황급히 돌아서며 | dialogue: (silent)
- panel 3:  | dialogue: character:"아, 미안!"

### Arm A — legacy panel section (untruncated)

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
Exact Korean text: No speech bubble

PANEL 3
Situation:
Background:
Exact Korean text: character: “아, 미안!”
```

### Arm B — structured panel spec section (untruncated)

```text
COMIC PANEL SPEC

Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 카운터에서 음료를 받는다 현우가 황급히 돌아서며

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (현우)
B = user persona (민지)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 카운터에서 음료를 받는다
Background:
B action (민지): 카운터에서 음료를 받는다
Speech bubble (B / persona): “이거 내 주문 아닌데?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Middle beat]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 현우가 황급히 돌아서며
Background:
Scene action: 현우가 황급히 돌아서며
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (A / character): “아, 미안!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 3-panel rhythm: opening → middle → closing beat — each panel covers a distinct scripted moment.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### Full prompt panel region (Arm B integrated, untruncated)

```text


Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 카운터에서 음료를 받는다 현우가 황급히 돌아서며

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (현우)
B = user persona (민지)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 카운터에서 음료를 받는다
Background:
B action (민지): 카운터에서 음료를 받는다
Speech bubble (B / persona): “이거 내 주문 아닌데?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Middle beat]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 현우가 황급히 돌아서며
Background:
Scene action: 현우가 황급히 돌아서며
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (A / character): “아, 미안!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 3-panel rhythm: opening → middle → closing beat — each panel covers a distinct scripted moment.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F06-3koma-study — 공부 격려

- **Format:** 3koma (3 panels)
- **Canonical identity map:** A=준호, B=예린
- **Reference map:** Image 1 → 준호; Image 2 → 예린
- **Expected key beat:** 졸린 준호를 붙잡고 격려
- **Expected dialogue:** 조금만 더! | 알겠어…
- **Expected progression:** Opening beat → Middle beat → Closing beat
- **Identity audit:** SUBJECT_LABEL_CONFLICT=0, ACTION_OWNER_CONFLICT=0, SPEECH_OWNER_CONFLICT=0

### Source scene

```text
준호가 책상에 엎드려 눈을 감는다.
*어깨를 흔든다*
"조금만 더!"
준호가 고개를 들고 "알겠어…"라고 중얼거린다.
```

### Selected scene (ScenePlan summary, untruncated)

- heroScene: 준호가 책상에 엎드려 눈을 감는다. 어깨를 흔든다
- heroEventIds: E1, E2, E3
- panelCount: 3
- panel 1: 준호가 책상에 엎드려 눈을 감는다. 어깨를 흔든다 | dialogue: (silent)
- panel 2: 준호가 고개를 들고 | dialogue: persona:"조금만 더!"
- panel 3:  | dialogue: character:"알겠어…"

### Arm A — legacy panel section (untruncated)

```text
Shared background:

Panel count: 3

PANEL 1
Situation: 준호가 책상에 엎드려 눈을 감는다. 어깨를 흔든다
Background:
Persona action: 어깨를 흔든다
Exact Korean text: No speech bubble

PANEL 2
Situation: 준호가 고개를 들고
Background:
Exact Korean text: persona: “조금만 더!”

PANEL 3
Situation:
Background:
Exact Korean text: character: “알겠어…”
```

### Arm B — structured panel spec section (untruncated)

```text
COMIC PANEL SPEC

Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 준호가 책상에 엎드려 눈을 감는다. 어깨를 흔든다

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (준호)
B = user persona (예린)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 준호가 책상에 엎드려 눈을 감는다. 어깨를 흔든다
Background:
B action (예린): 어깨를 흔든다
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Middle beat]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 준호가 고개를 들고
Background:
Scene action: 준호가 고개를 들고
Speech bubble (B / persona): “조금만 더!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (A / character): “알겠어…”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 3-panel rhythm: opening → middle → closing beat — each panel covers a distinct scripted moment.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### Full prompt panel region (Arm B integrated, untruncated)

```text


Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 준호가 책상에 엎드려 눈을 감는다. 어깨를 흔든다

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (준호)
B = user persona (예린)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 준호가 책상에 엎드려 눈을 감는다. 어깨를 흔든다
Background:
B action (예린): 어깨를 흔든다
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Middle beat]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 준호가 고개를 들고
Background:
Scene action: 준호가 고개를 들고
Speech bubble (B / persona): “조금만 더!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (A / character): “알겠어…”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 3-panel rhythm: opening → middle → closing beat — each panel covers a distinct scripted moment.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F07-3koma-lost — 길 잃음

- **Format:** 3koma (3 panels)
- **Canonical identity map:** A=태민, B=지아
- **Reference map:** Image 1 → 태민; Image 2 → 지아
- **Expected key beat:** 지도를 펼치며 길을 찾는다
- **Expected dialogue:** 여기 맞아? | …아마도.
- **Expected progression:** Opening beat → Middle beat → Closing beat
- **Identity audit:** SUBJECT_LABEL_CONFLICT=0, ACTION_OWNER_CONFLICT=0, SPEECH_OWNER_CONFLICT=0

### Source scene

```text
*지도를 펼친다*
"여기 맞아?"
태민이 지도를 보며 "…아마도."라고 답한다.
```

### Selected scene (ScenePlan summary, untruncated)

- heroScene: 지도를 펼친다 태민이 지도를 보며
- heroEventIds: E1, E2, E3
- panelCount: 3
- panel 1: 지도를 펼친다 | dialogue: persona:"여기 맞아?"
- panel 2: 태민이 지도를 보며 | dialogue: (silent)
- panel 3:  | dialogue: character:"…아마도."

### Arm A — legacy panel section (untruncated)

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
Exact Korean text: No speech bubble

PANEL 3
Situation:
Background:
Exact Korean text: character: “…아마도.”
```

### Arm B — structured panel spec section (untruncated)

```text
COMIC PANEL SPEC

Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 지도를 펼친다 태민이 지도를 보며

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (태민)
B = user persona (지아)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 지도를 펼친다
Background:
B action (지아): 지도를 펼친다
Speech bubble (B / persona): “여기 맞아?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Middle beat]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 태민이 지도를 보며
Background:
Scene action: 태민이 지도를 보며
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (A / character): “…아마도.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 3-panel rhythm: opening → middle → closing beat — each panel covers a distinct scripted moment.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### Full prompt panel region (Arm B integrated, untruncated)

```text


Format: 3koma (3 panels)

Layout: 3 wide horizontal panels stacked vertically (vertical comic strip / 3koma)

Hero focus: 지도를 펼친다 태민이 지도를 보며

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (태민)
B = user persona (지아)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 지도를 펼친다
Background:
B action (지아): 지도를 펼친다
Speech bubble (B / persona): “여기 맞아?”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Middle beat]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 태민이 지도를 보며
Background:
Scene action: 태민이 지도를 보며
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (A / character): “…아마도.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 3-panel rhythm: opening → middle → closing beat — each panel covers a distinct scripted moment.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F08-4panel-chase — 복도 추격

- **Format:** 4panel (4 panels)
- **Canonical identity map:** A=시우, B=한별
- **Reference map:** Image 1 → 시우; Image 2 → 한별
- **Expected key beat:** 복도에서 뛰어가며 붙잡기
- **Expected dialogue:** 잠깐! | 안 잡혀!
- **Expected progression:** Opening beat → Beat 2 → Beat 3 → Closing beat
- **Identity audit:** SUBJECT_LABEL_CONFLICT=0, ACTION_OWNER_CONFLICT=0, SPEECH_OWNER_CONFLICT=0

### Source scene

```text
시우가 복도 끝에서 갑자기 뛰기 시작한다.
*뒤쫓으며 외친다*
"잠깐!"
시우가 돌아보며 "안 잡혀!"라고 외친다.
한별이 코너에서 시우의 소매를 붙잡는다.
```

### Selected scene (ScenePlan summary, untruncated)

- heroScene: 시우가 복도 끝에서 갑자기 뛰기 시작한다. 뒤쫓으며 외친다
- heroEventIds: E1, E2, E3
- panelCount: 4
- panel 1: 시우가 복도 끝에서 갑자기 뛰기 시작한다. | dialogue: (silent)
- panel 2: 뒤쫓으며 외친다 | dialogue: persona:"잠깐!"
- panel 3: 시우가 돌아보며 | dialogue: character:"안 잡혀!"
- panel 4: 한별이 코너에서 시우의 소매를 붙잡는다. | dialogue: (silent)

### F08 closing action audit

- SOURCE CLOSING ACTION: 한별이 코너에서 시우의 소매를 붙잡는다.
- PANEL 4 situation: 한별이 코너에서 시우의 소매를 붙잡는다.
- PANEL 4 subjectActions: (none — neutral scene action only)
- PANEL 4 sceneAction: 한별이 코너에서 시우의 소매를 붙잡는다.

### Arm A — legacy panel section (untruncated)

```text
Shared background:

Panel count: 4

PANEL 1
Situation: 시우가 복도 끝에서 갑자기 뛰기 시작한다.
Background:
Exact Korean text: No speech bubble

PANEL 2
Situation: 뒤쫓으며 외친다
Background:
Persona action: 뒤쫓으며 외친다
Exact Korean text: persona: “잠깐!”

PANEL 3
Situation: 시우가 돌아보며
Background:
Exact Korean text: character: “안 잡혀!”

PANEL 4
Situation: 한별이 코너에서 시우의 소매를 붙잡는다.
Background:
Exact Korean text: No speech bubble
```

### Arm B — structured panel spec section (untruncated)

```text
COMIC PANEL SPEC

Format: 4panel (4 panels)

Layout: 4 wide horizontal panels stacked vertically (vertical comic strip / 4panel)

Hero focus: 시우가 복도 끝에서 갑자기 뛰기 시작한다. 뒤쫓으며 외친다

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (시우)
B = user persona (한별)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 시우가 복도 끝에서 갑자기 뛰기 시작한다.
Background:
Scene action: 시우가 복도 끝에서 갑자기 뛰기 시작한다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Beat 2]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 뒤쫓으며 외친다
Background:
B action (한별): 뒤쫓으며 외친다
Speech bubble (B / persona): “잠깐!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Beat 3]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 시우가 돌아보며
Background:
Scene action: 시우가 돌아보며
Speech bubble (A / character): “안 잡혀!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 4 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 한별이 코너에서 시우의 소매를 붙잡는다.
Background:
Scene action: 한별이 코너에서 시우의 소매를 붙잡는다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 4-panel rhythm: opening → beat 2 → beat 3 → closing beat — each panel covers a distinct scripted moment.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### FULL FINAL ASSEMBLED PROMPT (untruncated)

```text
Create one polished Korean manhwa-style page with exactly 4 wide horizontal panels stacked vertically.

Reference image 1 is LAYOUT AND FINISH ONLY. Follow its clean gutters, readable Korean bubbles, expressive acting, polished full-color rendering, and panel polish, but do not copy its exact poses.

Ignore the sample people drawn on reference image 1. Do not copy their gender presentation, body type, face shape, age, or hair color. Especially do not treat any pink-haired feminine sample figure as either subject.

SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — CHAT CHARACTER: 시우]
Reference: Image 1 belongs ONLY to 시우.
Appearance mode: IMAGE_ONLY
No supplemental saved appearance.
Use this selected reference as the authoritative visual identity for this subject only.
Identity ownership: every trait in this block belongs only to 시우.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — USER PERSONA: 한별]
Reference: Image 2 belongs ONLY to 한별.
Appearance mode: IMAGE_ONLY
No supplemental saved appearance.
Use this selected reference as the authoritative visual identity for this subject only.
Identity ownership: every trait in this block belongs only to 한별.
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
chat character 시우: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
user persona 한별: confirmed FEMALE. Keep her female in face, torso and body shape. Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male. Do not masculinize her body, jaw, torso or clothing beyond the reference identity.
Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.

Overall tone: light romantic-comedy energy, exaggerated reactions and playful timing.

STRICT CLOSED TEXT WHITELIST: the only text allowed anywhere in the image is listed below. Copy each used string exactly, character for character.

- “잠깐!”
- “안 잡혀!”

Never invent reaction dialogue, bridge dialogue, narration, captions, labels, titles, signs, or sound effects. Silent panels with no speech are valid. Do not create a speech bubble for a panel marked No speech bubble.

Use proper speech bubbles with tails pointing to the correct speaker. Keep all approved text large, centered, uncropped, and easy to read.

Exactly two recurring human characters. No extra person, duplicate face, identity swap, malformed hands, watermark, or logo.

Keep all panel borders and the full page visible. Do not crop off speech bubbles or the last panel.

COMIC PANEL SPEC

Format: 4panel (4 panels)

Layout: 4 wide horizontal panels stacked vertically (vertical comic strip / 4panel)

Hero focus: 시우가 복도 끝에서 갑자기 뛰기 시작한다. 뒤쫓으며 외친다

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (시우)
B = user persona (한별)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 시우가 복도 끝에서 갑자기 뛰기 시작한다.
Background:
Scene action: 시우가 복도 끝에서 갑자기 뛰기 시작한다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Beat 2]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 뒤쫓으며 외친다
Background:
B action (한별): 뒤쫓으며 외친다
Speech bubble (B / persona): “잠깐!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Beat 3]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 시우가 돌아보며
Background:
Scene action: 시우가 돌아보며
Speech bubble (A / character): “안 잡혀!”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 4 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 한별이 코너에서 시우의 소매를 붙잡는다.
Background:
Scene action: 한별이 코너에서 시우의 소매를 붙잡는다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 4-panel rhythm: opening → beat 2 → beat 3 → closing beat — each panel covers a distinct scripted moment.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F09-4panel-cooking — 요리 실패

- **Format:** 4panel (4 panels)
- **Canonical identity map:** A=건, B=수아
- **Reference map:** Image 1 → 건; Image 2 → 수아
- **Expected key beat:** 타버린 요리를 발견
- **Expected dialogue:** 이게 뭐야… | 내 탓이야.
- **Expected progression:** Opening beat → Beat 2 → Beat 3 → Closing beat
- **Identity audit:** SUBJECT_LABEL_CONFLICT=0, ACTION_OWNER_CONFLICT=0, SPEECH_OWNER_CONFLICT=0

### Source scene

```text
건이 냄비 뚜껑을 연다.
검은 연기가 피어오른다.
"이게 뭐야…"
건이 고개를 숙이며 "내 탓이야."라고 말한다.
```

### Selected scene (ScenePlan summary, untruncated)

- heroScene: 건이 냄비 뚜껑을 연다. 검은 연기가 피어오른다.
- heroEventIds: E1, E2, E3
- panelCount: 4
- panel 1: 건이 냄비 뚜껑을 연다. 검은 연기가 피어오른다. | dialogue: (silent)
- panel 2:  | dialogue: persona:"이게 뭐야…"
- panel 3: 건이 고개를 숙이며 | dialogue: (silent)
- panel 4:  | dialogue: character:"내 탓이야."

### Arm A — legacy panel section (untruncated)

```text
Shared background:

Panel count: 4

PANEL 1
Situation: 건이 냄비 뚜껑을 연다. 검은 연기가 피어오른다.
Background:
Exact Korean text: No speech bubble

PANEL 2
Situation:
Background:
Exact Korean text: persona: “이게 뭐야…”

PANEL 3
Situation: 건이 고개를 숙이며
Background:
Exact Korean text: No speech bubble

PANEL 4
Situation:
Background:
Exact Korean text: character: “내 탓이야.”
```

### Arm B — structured panel spec section (untruncated)

```text
COMIC PANEL SPEC

Format: 4panel (4 panels)

Layout: 4 wide horizontal panels stacked vertically (vertical comic strip / 4panel)

Hero focus: 건이 냄비 뚜껑을 연다. 검은 연기가 피어오른다.

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (건)
B = user persona (수아)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 건이 냄비 뚜껑을 연다. 검은 연기가 피어오른다.
Background:
Scene action: 건이 냄비 뚜껑을 연다. 검은 연기가 피어오른다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Beat 2]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (B / persona): “이게 뭐야…”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Beat 3]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 건이 고개를 숙이며
Background:
Scene action: 건이 고개를 숙이며
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 4 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (A / character): “내 탓이야.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 4-panel rhythm: opening → beat 2 → beat 3 → closing beat — each panel covers a distinct scripted moment.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### Full prompt panel region (Arm B integrated, untruncated)

```text


Format: 4panel (4 panels)

Layout: 4 wide horizontal panels stacked vertically (vertical comic strip / 4panel)

Hero focus: 건이 냄비 뚜껑을 연다. 검은 연기가 피어오른다.

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (건)
B = user persona (수아)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 건이 냄비 뚜껑을 연다. 검은 연기가 피어오른다.
Background:
Scene action: 건이 냄비 뚜껑을 연다. 검은 연기가 피어오른다.
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Beat 2]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (B / persona): “이게 뭐야…”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Beat 3]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 건이 고개를 숙이며
Background:
Scene action: 건이 고개를 숙이며
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 4 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (A / character): “내 탓이야.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 4-panel rhythm: opening → beat 2 → beat 3 → closing beat — each panel covers a distinct scripted moment.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## F10-4panel-confession — 고백 직전

- **Format:** 4panel (4 panels)
- **Canonical identity map:** A=재혁, B=유나
- **Reference map:** Image 1 → 재혁; Image 2 → 유나
- **Expected key beat:** 손을 잡고 고백
- **Expected dialogue:** 할 말이 있어. | …들을게.
- **Expected progression:** Opening beat → Beat 2 → Beat 3 → Closing beat
- **Identity audit:** SUBJECT_LABEL_CONFLICT=0, ACTION_OWNER_CONFLICT=0, SPEECH_OWNER_CONFLICT=0

### Source scene

```text
재혁이 노을진 다리 위에 선다.
*손을 잡는다*
"할 말이 있어."
재혁이 숨을 고르며 "…들을게."라고 답한다.
```

### Selected scene (ScenePlan summary, untruncated)

- heroScene: 재혁이 노을진 다리 위에 선다. 손을 잡는다
- heroEventIds: E1, E2, E3
- panelCount: 4
- panel 1: 재혁이 노을진 다리 위에 선다. 손을 잡는다 | dialogue: (silent)
- panel 2:  | dialogue: persona:"할 말이 있어."
- panel 3: 재혁이 숨을 고르며 | dialogue: (silent)
- panel 4:  | dialogue: character:"…들을게."

### Arm A — legacy panel section (untruncated)

```text
Shared background:

Panel count: 4

PANEL 1
Situation: 재혁이 노을진 다리 위에 선다. 손을 잡는다
Background:
Persona action: 손을 잡는다
Exact Korean text: No speech bubble

PANEL 2
Situation:
Background:
Exact Korean text: persona: “할 말이 있어.”

PANEL 3
Situation: 재혁이 숨을 고르며
Background:
Exact Korean text: No speech bubble

PANEL 4
Situation:
Background:
Exact Korean text: character: “…들을게.”
```

### Arm B — structured panel spec section (untruncated)

```text
COMIC PANEL SPEC

Format: 4panel (4 panels)

Layout: 4 wide horizontal panels stacked vertically (vertical comic strip / 4panel)

Hero focus: 재혁이 노을진 다리 위에 선다. 손을 잡는다

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (재혁)
B = user persona (유나)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 재혁이 노을진 다리 위에 선다. 손을 잡는다
Background:
B action (유나): 손을 잡는다
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Beat 2]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (B / persona): “할 말이 있어.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Beat 3]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 재혁이 숨을 고르며
Background:
Scene action: 재혁이 숨을 고르며
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 4 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (A / character): “…들을게.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 4-panel rhythm: opening → beat 2 → beat 3 → closing beat — each panel covers a distinct scripted moment.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### Full prompt panel region (Arm B integrated, untruncated)

```text


Format: 4panel (4 panels)

Layout: 4 wide horizontal panels stacked vertically (vertical comic strip / 4panel)

Hero focus: 재혁이 노을진 다리 위에 선다. 손을 잡는다

Hero event ids: E1, E2, E3

Shared background:

Cast:

A = chat character (재혁)
B = user persona (유나)

[Panel 1 — Opening beat]
Camera: establish the scripted opening beat in one readable frame
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 재혁이 노을진 다리 위에 선다. 손을 잡는다
Background:
B action (유나): 손을 잡는다
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 2 — Beat 2]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (B / persona): “할 말이 있어.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 3 — Beat 3]
Camera: continue the scripted beat with clear character staging
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Situation: 재혁이 숨을 고르며
Background:
Scene action: 재혁이 숨을 고르며
Speech bubble: (silent panel — no bubble)
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

[Panel 4 — Closing beat]
Camera: frame the closing scripted beat clearly
Framing: recurring characters readable in frame
Layout: A left, B right — maintain stable orientation across panels
Background:
Speech bubble (A / character): “…들을게.”
SFX: (none — do not render sound-effect text)
Must avoid: invented SFX text; speech bubble without an approved line below

Continuity rules:

- Keep A, B as the same identities throughout — hair, outfit, and face must not swap.

- Maintain consistent character orientation unless a deliberate mirrored staging note says otherwise.

- Advance the scripted beats in source order — each panel covers a distinct moment from the Scene Plan.

- 4-panel rhythm: opening → beat 2 → beat 3 → closing beat — each panel covers a distinct scripted moment.

Global must avoid:

- invented dialogue or narration

- sound effects or onomatopoeia text

- extra unnamed characters

- identity swaps between A and B

- cropped panel borders or speech bubbles
```

### Results

- **GPT SCORE:** PENDING
- **HUMAN SCORE:** PENDING
- **Notes:** Compare panel clarity, cast layout, bubble separation, continuity rules.

---

## Audit counters

- ACTION_DIRECTIVE_DUPLICATE_COUNT: 0
- REVIEW_ARTIFACT_LEGACY_GENRE_LABEL_COUNT: 0
- REVIEW_PACKET_TRUNCATION_COUNT: 0
- SUBJECT_LABEL_CONFLICT_COUNT: 0
- ACTION_OWNER_CONFLICT_COUNT: 0
- PROMPT_SUBJECT_LABEL_OWNER_COUNT: 1
