# Chat image multi-cast prompt snapshots (synthetic)

Provider calls: 0. Synthetic fixtures only.

## 1. Duo focus

### REFERENCE ORDER
1. /synthetic/user-persona-primary.webp
2. /synthetic/character-a-primary.webp

### PROMPT

```
APPROVED CAST MANIFEST
1. UserPersona (user persona) | importance=primary; visibility=required_visible | Image 1 belongs ONLY to UserPersona
2. CharacterA (chat character) | importance=primary; visibility=required_visible | Image 2 belongs ONLY to CharacterA
CAST FIDELITY TIERS — do not promise equal detail for every person.
Subjects with trusted identity evidence must stay visually distinct.
- UserPersona: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
- CharacterA: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
COMPOSITION GOAL: duo_focus. Keep the main two people centered and large. Anyone else is a supporting/background presence only.
Never copy the main character's hair, eyes, outfit, or face onto a supporting person.
Never map a no-photo subject onto another subject's reference image.
```

## 2. Exact trio (3 own refs)

### REFERENCE ORDER
1. /synthetic/user-persona-primary.webp
2. /synthetic/character-a-primary.webp
3. /synthetic/support-a.webp

### PROMPT

```
APPROVED CAST MANIFEST
1. UserPersona (user persona) | importance=primary; visibility=required_visible | Image 1 belongs ONLY to UserPersona
2. CharacterA (chat character) | importance=primary; visibility=required_visible | Image 2 belongs ONLY to CharacterA
3. SupportA (supporting character) | importance=primary; visibility=required_visible | Image 3 belongs ONLY to SupportA
CAST FIDELITY TIERS — do not promise equal detail for every person.
Subjects with trusted identity evidence must stay visually distinct.
- UserPersona: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
- CharacterA: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
- SupportA: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
COMPOSITION GOAL: trio_group. Arrange three distinct people in a stable left / center / right or triangle group shot. Minimize face occlusion. Every listed face must stay readable.
Never copy the main character's hair, eyes, outfit, or face onto a supporting person.
Never map a no-photo subject onto another subject's reference image.
```

## 3. Trio comic 3-cut

### REFERENCE ORDER
1. /image-templates/comic-vertical-sample-hq.webp
2. /synthetic/user-persona-primary.webp
3. /synthetic/character-a-primary.webp
4. /synthetic/support-a.webp

### PROMPT

```
Create one polished Korean manhwa-style page with exactly 3 wide horizontal panels stacked vertically.

Reference image 1 is LAYOUT AND FINISH ONLY. Follow its clean gutters, readable Korean bubbles, expressive acting, polished full-color rendering, and romantic-comedy timing, but do not copy its exact poses.

Ignore the sample people drawn on reference image 1. Do not copy their gender presentation, body type, face shape, age, or hair color. Especially do not treat any pink-haired feminine sample figure as either subject.

APPROVED CAST MANIFEST
1. UserPersona (user persona) | importance=primary; visibility=required_visible | Image 2 belongs ONLY to UserPersona
2. CharacterA (chat character) | importance=primary; visibility=required_visible | Image 3 belongs ONLY to CharacterA
3. SupportA (supporting character) | importance=primary; visibility=required_visible | Image 4 belongs ONLY to SupportA
CAST FIDELITY TIERS — do not promise equal detail for every person.
Subjects with trusted identity evidence must stay visually distinct.
- UserPersona: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
- CharacterA: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
- SupportA: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
COMPOSITION GOAL: trio_group. Arrange three distinct people in a stable left / center / right or triangle group shot. Minimize face occlusion. Every listed face must stay readable.
Never copy the main character's hair, eyes, outfit, or face onto a supporting person.
Never map a no-photo subject onto another subject's reference image.

SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — USER PERSONA: UserPersona]
Reference: Image 2 belongs ONLY to UserPersona.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- Eyes (explicit iris/pupil ownership):
- Iris color: black.
- Pupil color: red.
- Pupil shape: vertical slit.
- Red applies to the small pupil center ONLY — do NOT fill the entire iris red. Keep the iris its own color.
- Iris color and pupil color are distinct; do not merge them into one 'red eyes' simplification.
- 짧은 검은머리 흰셔츠 위에 가죽재질 전투 하네스 검은바지 가르마 없음 full bangs 동공
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to UserPersona.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — CHAT CHARACTER: CharacterA]
Reference: Image 3 belongs ONLY to CharacterA.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- Eyes (explicit iris/pupil ownership):
- Iris color: red.
- Pupil color: black.
- Red irises do NOT imply red pupils unless pupil color is explicitly red above.
- Iris color and pupil color are distinct; do not merge them into one 'red eyes' simplification.
- black hair, asymmetric fringe, explicitly NOT center-parted / NOT 5:5
- large healed scar on the back of the neck
- white shirt, black harness
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterA.
Never infer SUBJECT B's identity from any other subject.

[SUBJECT C — SUPPORTING CHARACTER: SupportA]
Reference: Image 4 belongs ONLY to SupportA.
Appearance mode: IMAGE_ONLY
No supplemental saved appearance.
Use this selected reference as the authoritative visual identity for this subject only.
Identity ownership: every trait in this block belongs only to SupportA.
Never infer SUBJECT C's identity from any other subject.

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
user persona UserPersona: confirmed FEMALE. Keep her female in face, torso and body shape. Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male. Do not masculinize her body, jaw, torso or clothing beyond the reference identity.
chat character CharacterA: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
supporting character SupportA: gender is unspecified / non-binary. Do not infer or change gender from hair length, cuteness, outfit, pose, blush, eyelashes or body size. Follow the reference identity without adding stereotyped male or female anatomy unless it is clearly present in the reference.
Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.

Overall tone: light romantic-comedy energy, exaggerated reactions and playful timing.

STRICT CLOSED TEXT WHITELIST: the only text allowed anywhere in the image is listed below. Copy each used string exactly, character for character.

- “같이 가자.”

Never invent reaction dialogue, bridge dialogue, narration, captions, labels, titles, signs, or sound effects. Silent panels with no speech are valid. Do not create a speech bubble for a panel marked No speech bubble.

Use proper speech bubbles with tails pointing to the correct speaker. Keep all approved text large, centered, uncropped, and easy to read.

Exactly 3 recurring human identities. No extra person, duplicate face, identity swap, malformed hands, watermark, or logo.

Keep all panel borders and the full page visible. Do not crop off speech bubbles or the last panel.
```

## 4. Trio comic 4-cut

### REFERENCE ORDER
1. /image-templates/comic-vertical-sample-hq.webp
2. /synthetic/user-persona-primary.webp
3. /synthetic/character-a-primary.webp
4. /synthetic/support-a.webp

### PROMPT

```
Create one polished Korean manhwa-style page with exactly 4 wide horizontal panels stacked vertically.

Reference image 1 is LAYOUT AND FINISH ONLY. Follow its clean gutters, readable Korean bubbles, expressive acting, polished full-color rendering, and romantic-comedy timing, but do not copy its exact poses.

Ignore the sample people drawn on reference image 1. Do not copy their gender presentation, body type, face shape, age, or hair color. Especially do not treat any pink-haired feminine sample figure as either subject.

APPROVED CAST MANIFEST
1. UserPersona (user persona) | importance=primary; visibility=required_visible | Image 2 belongs ONLY to UserPersona
2. CharacterA (chat character) | importance=primary; visibility=required_visible | Image 3 belongs ONLY to CharacterA
3. SupportA (supporting character) | importance=primary; visibility=required_visible | Image 4 belongs ONLY to SupportA
CAST FIDELITY TIERS — do not promise equal detail for every person.
Subjects with trusted identity evidence must stay visually distinct.
- UserPersona: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
- CharacterA: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
- SupportA: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
COMPOSITION GOAL: trio_group. Arrange three distinct people in a stable left / center / right or triangle group shot. Minimize face occlusion. Every listed face must stay readable.
Never copy the main character's hair, eyes, outfit, or face onto a supporting person.
Never map a no-photo subject onto another subject's reference image.

SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — USER PERSONA: UserPersona]
Reference: Image 2 belongs ONLY to UserPersona.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- Eyes (explicit iris/pupil ownership):
- Iris color: black.
- Pupil color: red.
- Pupil shape: vertical slit.
- Red applies to the small pupil center ONLY — do NOT fill the entire iris red. Keep the iris its own color.
- Iris color and pupil color are distinct; do not merge them into one 'red eyes' simplification.
- 짧은 검은머리 흰셔츠 위에 가죽재질 전투 하네스 검은바지 가르마 없음 full bangs 동공
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to UserPersona.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — CHAT CHARACTER: CharacterA]
Reference: Image 3 belongs ONLY to CharacterA.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- Eyes (explicit iris/pupil ownership):
- Iris color: red.
- Pupil color: black.
- Red irises do NOT imply red pupils unless pupil color is explicitly red above.
- Iris color and pupil color are distinct; do not merge them into one 'red eyes' simplification.
- black hair, asymmetric fringe, explicitly NOT center-parted / NOT 5:5
- large healed scar on the back of the neck
- white shirt, black harness
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterA.
Never infer SUBJECT B's identity from any other subject.

[SUBJECT C — SUPPORTING CHARACTER: SupportA]
Reference: Image 4 belongs ONLY to SupportA.
Appearance mode: IMAGE_ONLY
No supplemental saved appearance.
Use this selected reference as the authoritative visual identity for this subject only.
Identity ownership: every trait in this block belongs only to SupportA.
Never infer SUBJECT C's identity from any other subject.

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
user persona UserPersona: confirmed FEMALE. Keep her female in face, torso and body shape. Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male. Do not masculinize her body, jaw, torso or clothing beyond the reference identity.
chat character CharacterA: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
supporting character SupportA: gender is unspecified / non-binary. Do not infer or change gender from hair length, cuteness, outfit, pose, blush, eyelashes or body size. Follow the reference identity without adding stereotyped male or female anatomy unless it is clearly present in the reference.
Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.

Overall tone: light romantic-comedy energy, exaggerated reactions and playful timing.

STRICT CLOSED TEXT WHITELIST: the only text allowed anywhere in the image is listed below. Copy each used string exactly, character for character.

- “같이 가자.”

Never invent reaction dialogue, bridge dialogue, narration, captions, labels, titles, signs, or sound effects. Silent panels with no speech are valid. Do not create a speech bubble for a panel marked No speech bubble.

Use proper speech bubbles with tails pointing to the correct speaker. Keep all approved text large, centered, uncropped, and easy to read.

Exactly 3 recurring human identities. No extra person, duplicate face, identity swap, malformed hands, watermark, or logo.

Keep all panel borders and the full page visible. Do not crop off speech bubbles or the last panel.
```

## 5. 4+ ensemble ref cap

### REFERENCE ORDER
1. /synthetic/user-persona-primary.webp
2. /synthetic/character-a-primary.webp
3. /synthetic/asset-b.webp

### PROMPT

```
APPROVED CAST MANIFEST
1. UserPersona (user persona) | importance=primary; visibility=required_visible | Image 1 belongs ONLY to UserPersona
2. CharacterA (chat character) | importance=primary; visibility=required_visible | Image 2 belongs ONLY to CharacterA
3. SupportB (supporting character) | importance=secondary; visibility=preferred_visible | Image 3 belongs ONLY to SupportB
4. Extra2 (supporting character) | importance=background; visibility=background_ok | No identity reference available — background/cameo only. Do not borrow another subject's picture.
CAST FIDELITY TIERS — do not promise equal detail for every person.
Four or more people: guarantee exact identity for at most 3 subjects with trusted identity evidence.
- UserPersona: HIGH FIDELITY primary. Strongly preserve face, hair, eyes, iris/pupil, and outfit. Visibility: required_visible.
- CharacterA: HIGH FIDELITY primary. Strongly preserve face, hair, eyes, iris/pupil, and outfit. Visibility: required_visible.
- SupportB: SECONDARY. Recognizable but may be smaller. Do not steal another subject's traits. Visibility: preferred_visible.
- Extra2: BACKGROUND / CAMEO. No identity reference available. Presence is allowed, but exact face/hair/eye/outfit fidelity is not guaranteed. Never borrow another person's reference. Visibility: background_ok.
COMPOSITION GOAL: ensemble_scene. Keep the primary 2-3 people in the foreground. Remaining people may recede as background presence. Do not hide a required_visible face.
Never copy the main character's hair, eyes, outfit, or face onto a supporting person.
Never map a no-photo subject onto another subject's reference image.
```

## 6. No-photo cameo

### REFERENCE ORDER
1. /synthetic/user-persona-primary.webp
2. /synthetic/character-a-primary.webp

### PROMPT

```
APPROVED CAST MANIFEST
1. UserPersona (user persona) | importance=primary; visibility=required_visible | Image 1 belongs ONLY to UserPersona
2. CharacterA (chat character) | importance=primary; visibility=required_visible | Image 2 belongs ONLY to CharacterA
3. SupportC (supporting character) | importance=background; visibility=background_ok | No identity reference available — background/cameo only. Do not borrow another subject's picture.
CAST FIDELITY TIERS — do not promise equal detail for every person.
Subjects with trusted identity evidence must stay visually distinct.
- UserPersona: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
- CharacterA: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
- SupportC: BACKGROUND / CAMEO. No identity reference available. Presence is allowed, but exact face/hair/eye/outfit fidelity is not guaranteed. Never borrow another person's reference. Visibility: background_ok.
COMPOSITION GOAL: duo_focus. Keep the main two people centered and large. Anyone else is a supporting/background presence only.
Never copy the main character's hair, eyes, outfit, or face onto a supporting person.
Never map a no-photo subject onto another subject's reference image.
```

## 7. Supporting event-subject binding

### REFERENCE ORDER
1. /synthetic/user-persona-primary.webp
2. /synthetic/character-a-primary.webp
3. /synthetic/support-a.webp

### PROMPT

```
APPROVED CAST MANIFEST
1. UserPersona (user persona) | importance=primary; visibility=required_visible | Image 1 belongs ONLY to UserPersona
2. CharacterA (chat character) | importance=primary; visibility=required_visible | Image 2 belongs ONLY to CharacterA
3. SupportA (supporting character) | importance=secondary; visibility=preferred_visible | Image 3 belongs ONLY to SupportA
CAST FIDELITY TIERS — do not promise equal detail for every person.
Subjects with trusted identity evidence must stay visually distinct.
- UserPersona: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
- CharacterA: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
- SupportA: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: preferred_visible.
COMPOSITION GOAL: trio_group. Arrange three distinct people in a stable left / center / right or triangle group shot. Minimize face occlusion. Every listed face must stay readable.
Never copy the main character's hair, eyes, outfit, or face onto a supporting person.
Never map a no-photo subject onto another subject's reference image.
EVENT SUBJECT BINDINGS
- E2 (reaction: SupportA가) → SupportA (supporting:SupportA)
- E1 (action: 손을 흔든다) → UserPersona (persona)
```

## 8. Supporting importance reorder reference order

### REFERENCE ORDER
1. /synthetic/user-persona-primary.webp
2. /synthetic/character-a-primary.webp
3. /synthetic/asset-b.webp

### PROMPT

```
APPROVED CAST MANIFEST
1. UserPersona (user persona) | importance=primary; visibility=required_visible | Image 1 belongs ONLY to UserPersona
2. CharacterA (chat character) | importance=primary; visibility=required_visible | Image 2 belongs ONLY to CharacterA
3. SupportB (supporting character) | importance=primary; visibility=required_visible | Image 3 belongs ONLY to SupportB
4. SupportA (supporting character) | importance=secondary; visibility=preferred_visible | No photo attached — use saved appearance only. Do not borrow another subject's picture.
CAST FIDELITY TIERS — do not promise equal detail for every person.
Four or more people: guarantee exact identity for at most 3 subjects with trusted identity evidence.
- UserPersona: HIGH FIDELITY primary. Strongly preserve face, hair, eyes, iris/pupil, and outfit. Visibility: required_visible.
- CharacterA: HIGH FIDELITY primary. Strongly preserve face, hair, eyes, iris/pupil, and outfit. Visibility: required_visible.
- SupportB: HIGH FIDELITY primary. Strongly preserve face, hair, eyes, iris/pupil, and outfit. Visibility: required_visible.
- SupportA: SECONDARY. Recognizable but may be smaller. Do not steal another subject's traits. Visibility: preferred_visible.
COMPOSITION GOAL: trio_group. Arrange three distinct people in a stable left / center / right or triangle group shot. Minimize face occlusion. Every listed face must stay readable.
Never copy the main character's hair, eyes, outfit, or face onto a supporting person.
Never map a no-photo subject onto another subject's reference image.
```

## LD single illustration (trio cast parity)

### REFERENCE ORDER
1. /synthetic/user-persona-primary.webp
2. /synthetic/character-a-primary.webp
3. /synthetic/support-a.webp

### PROMPT (cast block excerpt)

```
Create one polished vertical 2:3 Korean character illustration, not a comic page.
APPROVED CAST MANIFEST
1. UserPersona (user persona) | importance=primary; visibility=required_visible | Image 1 belongs ONLY to UserPersona
2. CharacterA (chat character) | importance=primary; visibility=required_visible | Image 2 belongs ONLY to CharacterA
3. SupportA (supporting character) | importance=primary; visibility=required_visible | Image 3 belongs ONLY to SupportA
CAST FIDELITY TIERS — do not promise equal detail for every person.
Subjects with trusted identity evidence must stay visually distinct.
- UserPersona: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
- CharacterA: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
- SupportA: HIGH FIDELITY. Face, hair, eyes, and outfit must stay distinct and accurate. Visibility: required_visible.
COMPOSITION GOAL: trio_group. Arrange three distinct people in a stable left / center / right or triangle group shot. Minimize face occlusion. Every listed face must stay readable.
Never copy the main character's hair, eyes, outfit, or face onto a supporting person.
Never map a no-photo subject onto another subject's reference image.
SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — USER PERSONA: UserPersona]
Reference: Image 1 belongs ONLY to UserPersona.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- Eyes (explicit iris/pupil ownership):
- Iris color: black.
- Pupil color: red.
- Pupil shape: vertical slit.
- Red applies to the small pupil center ONLY — do NOT fill the entire iris red. Keep the iris its own color.
- Iris color and pupil color are distinct; do not merge them into one 'red eyes' simplification.
- 짧은 검은머리 흰셔츠 위에 가죽재질 전투 하네스 검은바지 가르마 없음 full bangs 동공
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to UserPersona.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — CHAT CHARACTER: CharacterA]
Reference: Image 2 belongs ONLY to CharacterA.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- Eyes (explicit iris/pupil ownership):
- Iris color: red.
- Pupil color: black.
- Red irises do NOT imply red pupils unless pupil color is explicitly red above.
- Iris color and pupil color are distinct; do not merge them into one 'red eyes' simplification.
- black hair, asymmetric fringe, explicitly NOT center-parted / NOT 5:5
- large healed scar on the back of the neck
- white shirt, black harness
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterA.
Never infer SUBJECT B's identity from any other subject.

[SUBJECT C — SUPPORTING CHARACTER: SupportA]
Reference: Image 3 belongs ONLY to SupportA.
Appearance mode: IMAGE_ONLY
No supplemental saved appearance.
Use this selected reference as the authoritative visual identity for this subject only.
Identity ownership: every trait in this block belongs only to SupportA.
Never infer SUBJECT C's identity from any other subject.

IDENTITY OWNERSHIP IS STRICT.
Each numbered reference image maps 1:1 to exactly one listed subject. Do not reuse a photo for anyone else.
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
user persona UserPersona: confirmed FEMALE. Keep her female in face, torso and body shape. Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male. Do not masculinize her body, jaw, torso or clothing beyond the reference identity.
chat character CharacterA: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
supporting character SupportA: gender is unspecified / non-binary. Do not infer or change gender from hair length, cuteness, outfit, pose, blush, eyelashes or body size. Follow the reference identity without adding stereotyped male or female anatomy unless it is clearly present in the reference.
Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.
SAFETY — depict a wholesome conversation / meeting scene only. Do not depict active injury, blood, fresh wounds, weapons, self-harm, suicide, hanging, cutting, or medical trauma even if metaphorical language appears in the turn text. A healed, non-graphic scar that is explicitly part of a subject's saved stable identity or own identity reference may be preserved. Do not invent new scars from scene text.
Depict the approved scene plan below as one cinematic scene.
Match the drawing style of the supplied identity references. Harmonize style, not identity.
Key dialogue lines are for emotion and acting only. Do not render speech bubbles, captions, subtitles, or readable dialogue text in the illustration.
Show exactly these 3 people. Do not add extras, duplicates, split panels, borders, speech bubbles, captions, sound effects, signatures, logos, or watermarks.
Compose for a vertical 2:3 profile-friendly illustration around 800 by 1200 pixels. Keep important faces and gestures away from the outer crop edges.
```
