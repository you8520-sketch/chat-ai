# Chat image visual-identity prompt snapshots

Synthetic fixtures only. No production character or persona data.
Provider image APIs were not called. ChatGPT should review these prompts directly.

## 1. Gift box — primary character + persona

REFERENCE ORDER:
Image 1: /image-templates/sd-gift-box-duo-hq.webp
Image 2: /synthetic/character-a-primary.webp
Image 3: /synthetic/character-b-primary.webp

APPEARANCE MODE:
Subject A (CharacterA): IMAGE_PLUS_SAVED · ref 2
Subject B (CharacterB): IMAGE_PLUS_SAVED · ref 3

PROMPT:
```
Create one polished 4:3 two-person SD/chibi fixed-template commission illustration.

Reference image 1 is the composition and decoration template. Preserve its recognizable luxury gift-box layout: a cream gift box with lace trim, sage-green ribbon and heart charm, teddy bear, bunny plush, candies, pearls, floating hearts, curling ribbons and golden sparkles on a clean pale background.

SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — CHAT CHARACTER: CharacterA]
Reference: Image 2 belongs ONLY to CharacterA.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- black hair, asymmetric fringe, explicitly NOT center-parted / NOT 5:5
- black pupils, red irises
- white shirt, black harness
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterA.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — USER PERSONA: CharacterB]
Reference: Image 3 belongs ONLY to CharacterB.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- blue-black hair, center-parted hair
- dark gray irises
- black suit
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterB.
Never infer SUBJECT B's identity from any other subject.

IDENTITY OWNERSHIP IS STRICT.
REFERENCE 1 is the layout / composition / decoration template ONLY. It is NEVER a character identity source. Do not copy hair, eyes, iris, pupils, clothes, or face from the template onto any subject.
Each subject owns only the visual traits from their own identity block and own reference.
NEVER transfer between subjects: hair color, haircut, bangs, hair part, center part / 5:5 part, eye color, iris color, pupil color, heterochromia, facial marks, scars, tattoos, accessories, body traits, or signature clothes.
Do not average or homogenize identities even when both subjects look similar.
Do not assume that a visually striking feature belongs to every person.
A trait appearing in one subject's reference is NOT a global style property.
Pupil, iris, and overall eye color are distinct traits. Keep each color on the subject that owns it.
Negative identity constraints are authoritative and belong only to the named subject. Do not drop or invert them.
STYLE may be harmonized globally. IDENTITY may NOT be harmonized globally.
Unify art style, not identity. Do not average the subjects' physical traits while harmonizing style.
Template or another person's appearance must never be treated as a style characteristic.
PRIORITY: 1) explicit generation product option (pose, expression, temporary costume/prop); 2) this subject's stable saved identity only when IMAGE_PLUS_SAVED; 3) this subject's own reference image; 4) template styling/composition.
Product options may add a temporary prop or costume. They must not rewrite hair color, eye/iris/pupil color, or face identity.

GENDER LOCK — mandatory identity rule.
TOP person CharacterA: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
BOTTOM person CharacterB: confirmed FEMALE. Keep her female in face, torso and body shape. Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male. Do not masculinize her body, jaw, torso or clothing beyond the reference identity.
Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.

TOP person is CharacterA. BOTTOM person is CharacterB. Keep those placements exact.

TOP person expression: playful, lively smile. The top person leans over from above and gently hugs or rests both hands on the bottom person's head.

BOTTOM person expression: calm, soft expression. The bottom person sits inside the decorative gift box with both forearms resting naturally on the box edge.

Overall mood: lovely pastel pink and sage-green accents, affectionate and sweet.

Exactly two human characters. No extra person, duplicate face, merged body, swapped hair, extra hands, malformed fingers, text, signature, logo or watermark.

Keep the full gift box and the surrounding decorative objects visible. Do not crop to faces only. Centered, clean, detailed, harmonious, merchandise-quality kawaii anime illustration.
```

## 2. Gift box — alternate / IMAGE_ONLY character

REFERENCE ORDER:
Image 1: /image-templates/sd-gift-box-duo-hq.webp
Image 2: /synthetic/character-a-alternate.webp
Image 3: /synthetic/character-b-primary.webp

APPEARANCE MODE:
Subject A (CharacterA): IMAGE_ONLY · ref 2
Subject B (CharacterB): IMAGE_PLUS_SAVED · ref 3

PROMPT:
```
Create one polished 4:3 two-person SD/chibi fixed-template commission illustration.

Reference image 1 is the composition and decoration template. Preserve its recognizable luxury gift-box layout: a cream gift box with lace trim, sage-green ribbon and heart charm, teddy bear, bunny plush, candies, pearls, floating hearts, curling ribbons and golden sparkles on a clean pale background.

SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — CHAT CHARACTER: CharacterA]
Reference: Image 2 belongs ONLY to CharacterA.
Appearance mode: IMAGE_ONLY
No supplemental saved appearance.
Use this selected reference as the authoritative visual identity for this subject only.
Identity ownership: every trait in this block belongs only to CharacterA.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — USER PERSONA: CharacterB]
Reference: Image 3 belongs ONLY to CharacterB.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- blue-black hair, center-parted hair
- dark gray irises
- black suit
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterB.
Never infer SUBJECT B's identity from any other subject.

IDENTITY OWNERSHIP IS STRICT.
REFERENCE 1 is the layout / composition / decoration template ONLY. It is NEVER a character identity source. Do not copy hair, eyes, iris, pupils, clothes, or face from the template onto any subject.
Each subject owns only the visual traits from their own identity block and own reference.
NEVER transfer between subjects: hair color, haircut, bangs, hair part, center part / 5:5 part, eye color, iris color, pupil color, heterochromia, facial marks, scars, tattoos, accessories, body traits, or signature clothes.
Do not average or homogenize identities even when both subjects look similar.
Do not assume that a visually striking feature belongs to every person.
A trait appearing in one subject's reference is NOT a global style property.
Pupil, iris, and overall eye color are distinct traits. Keep each color on the subject that owns it.
Negative identity constraints are authoritative and belong only to the named subject. Do not drop or invert them.
STYLE may be harmonized globally. IDENTITY may NOT be harmonized globally.
Unify art style, not identity. Do not average the subjects' physical traits while harmonizing style.
Template or another person's appearance must never be treated as a style characteristic.
PRIORITY: 1) explicit generation product option (pose, expression, temporary costume/prop); 2) this subject's stable saved identity only when IMAGE_PLUS_SAVED; 3) this subject's own reference image; 4) template styling/composition.
Product options may add a temporary prop or costume. They must not rewrite hair color, eye/iris/pupil color, or face identity.

GENDER LOCK — mandatory identity rule.
TOP person CharacterA: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
BOTTOM person CharacterB: confirmed FEMALE. Keep her female in face, torso and body shape. Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male. Do not masculinize her body, jaw, torso or clothing beyond the reference identity.
Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.

TOP person is CharacterA. BOTTOM person is CharacterB. Keep those placements exact.

TOP person expression: playful, lively smile. The top person leans over from above and gently hugs or rests both hands on the bottom person's head.

BOTTOM person expression: calm, soft expression. The bottom person sits inside the decorative gift box with both forearms resting naturally on the box edge.

Overall mood: lovely pastel pink and sage-green accents, affectionate and sweet.

Exactly two human characters. No extra person, duplicate face, merged body, swapped hair, extra hands, malformed fingers, text, signature, logo or watermark.

Keep the full gift box and the surrounding decorative objects visible. Do not crop to faces only. Centered, clean, detailed, harmonious, merchandise-quality kawaii anime illustration.
```

## 3. 9 emoticons

REFERENCE ORDER:
Image 1: /image-templates/sd-emoticon-grid-9.webp
Image 2: /synthetic/character-a-primary.webp
Image 3: /synthetic/character-b-primary.webp

APPEARANCE MODE:
Subject A (CharacterA): IMAGE_PLUS_SAVED · ref 2
Subject B (CharacterB): IMAGE_PLUS_SAVED · ref 3

PROMPT:
```
Create one polished square 3-by-3 Korean SD/chibi emoticon sheet with exactly nine equal panels.

Reference image 1 is the layout and finish reference. Keep only its clean 3x3 grid, rounded panel borders, safe text margins, pastel sticker finish and expressive merchandise quality. Do not copy its people.

SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — CHAT CHARACTER: CharacterA]
Reference: Image 2 belongs ONLY to CharacterA.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- black hair, asymmetric fringe, explicitly NOT center-parted / NOT 5:5
- black pupils, red irises
- white shirt, black harness
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterA.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — USER PERSONA: CharacterB]
Reference: Image 3 belongs ONLY to CharacterB.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- blue-black hair, center-parted hair
- dark gray irises
- black suit
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterB.
Never infer SUBJECT B's identity from any other subject.

IDENTITY OWNERSHIP IS STRICT.
REFERENCE 1 is the layout / composition / decoration template ONLY. It is NEVER a character identity source. Do not copy hair, eyes, iris, pupils, clothes, or face from the template onto any subject.
Each subject owns only the visual traits from their own identity block and own reference.
NEVER transfer between subjects: hair color, haircut, bangs, hair part, center part / 5:5 part, eye color, iris color, pupil color, heterochromia, facial marks, scars, tattoos, accessories, body traits, or signature clothes.
Do not average or homogenize identities even when both subjects look similar.
Do not assume that a visually striking feature belongs to every person.
A trait appearing in one subject's reference is NOT a global style property.
Pupil, iris, and overall eye color are distinct traits. Keep each color on the subject that owns it.
Negative identity constraints are authoritative and belong only to the named subject. Do not drop or invert them.
STYLE may be harmonized globally. IDENTITY may NOT be harmonized globally.
Unify art style, not identity. Do not average the subjects' physical traits while harmonizing style.
Template or another person's appearance must never be treated as a style characteristic.
PRIORITY: 1) explicit generation product option (pose, expression, temporary costume/prop); 2) this subject's stable saved identity only when IMAGE_PLUS_SAVED; 3) this subject's own reference image; 4) template styling/composition.
Product options may add a temporary prop or costume. They must not rewrite hair color, eye/iris/pupil color, or face identity.

GENDER LOCK — mandatory identity rule.
chat character CharacterA: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
user persona CharacterB: confirmed FEMALE. Keep her female in face, torso and body shape. Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male. Do not masculinize her body, jaw, torso or clothing beyond the reference identity.
Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.

Use the following exact nine panels in this exact order:

1. Exact Korean text: “사랑해” | Subject: chat character CharacterA only | Acting: holding a big heart.
2. Exact Korean text: “보고 싶어” | Subject: chat character CharacterA only | Acting: hugging a pillow.
3. Exact Korean text: “헉!” | Subject: chat character CharacterA only | Acting: wide-eyed surprise.
4. Exact Korean text: “고마워” | Subject: user persona CharacterB only | Acting: grateful smile.
5. Exact Korean text: “잘 자” | Subject: user persona CharacterB only | Acting: sleepy blanket.
6. Exact Korean text: “미안해” | Subject: user persona CharacterB only | Acting: apologetic face.
7. Exact Korean text: “안녕!” | Subject: both CharacterA and CharacterB | Acting: both waving.
8. Exact Korean text: “화이팅!” | Subject: both CharacterA and CharacterB | Acting: raised fists.
9. Exact Korean text: “꼬옥” | Subject: both CharacterA and CharacterB | Acting: warm hug.

Render exactly one listed Korean phrase in each panel, verbatim and fully legible. The pose, props and facial expression must clearly match that phrase.

Exactly nine panels and exactly two identities overall. Solo panels contain only the named person; duo panels contain both. No third person, duplicate person, extra panel, missing panel, merged face, cropped text, extra text, signature, logo or watermark.
```

## 4. Couple stamps

REFERENCE ORDER:
Image 1: /image-templates/sd-couple-stamps-4.webp
Image 2: /synthetic/character-a-primary.webp
Image 3: /synthetic/character-b-primary.webp

APPEARANCE MODE:
Subject A (CharacterA): IMAGE_PLUS_SAVED · ref 2
Subject B (CharacterB): IMAGE_PLUS_SAVED · ref 3

PROMPT:
```
Create ONE square couple profile stamp sheet: exactly four circular badges arranged in a 2-by-2 grid on a clean white background, with even gaps and equal badge sizes.

Reference image 1 is the fixed template. Reproduce its layout, its four motifs, its bold thick outlines and its soft chibi / SD illustration finish. Replace only the two people.

SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — CHAT CHARACTER: CharacterA]
Reference: Image 2 belongs ONLY to CharacterA.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- black hair, asymmetric fringe, explicitly NOT center-parted / NOT 5:5
- black pupils, red irises
- white shirt, black harness
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterA.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — USER PERSONA: CharacterB]
Reference: Image 3 belongs ONLY to CharacterB.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- blue-black hair, center-parted hair
- dark gray irises
- black suit
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterB.
Never infer SUBJECT B's identity from any other subject.

IDENTITY OWNERSHIP IS STRICT.
REFERENCE 1 is the layout / composition / decoration template ONLY. It is NEVER a character identity source. Do not copy hair, eyes, iris, pupils, clothes, or face from the template onto any subject.
Each subject owns only the visual traits from their own identity block and own reference.
NEVER transfer between subjects: hair color, haircut, bangs, hair part, center part / 5:5 part, eye color, iris color, pupil color, heterochromia, facial marks, scars, tattoos, accessories, body traits, or signature clothes.
Do not average or homogenize identities even when both subjects look similar.
Do not assume that a visually striking feature belongs to every person.
A trait appearing in one subject's reference is NOT a global style property.
Pupil, iris, and overall eye color are distinct traits. Keep each color on the subject that owns it.
Negative identity constraints are authoritative and belong only to the named subject. Do not drop or invert them.
STYLE may be harmonized globally. IDENTITY may NOT be harmonized globally.
Unify art style, not identity. Do not average the subjects' physical traits while harmonizing style.
Template or another person's appearance must never be treated as a style characteristic.
PRIORITY: 1) explicit generation product option (pose, expression, temporary costume/prop); 2) this subject's stable saved identity only when IMAGE_PLUS_SAVED; 3) this subject's own reference image; 4) template styling/composition.
Product options may add a temporary prop or costume. They must not rewrite hair color, eye/iris/pupil color, or face identity.

GENDER LOCK — mandatory identity rule.
chat character CharacterA: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
user persona CharacterB: confirmed FEMALE. Keep her female in face, torso and body shape. Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male. Do not masculinize her body, jaw, torso or clothing beyond the reference identity.
Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.

The same two people appear in all four badges.

TOP-LEFT badge: both wear matching cat ears and raise oversized plush paw mittens toward the viewer — one dark paw, one cream paw. Light blue background with paw prints and sparkles.
TOP-RIGHT badge: no animal ears. They lean together and each holds a plush toy — a brown teddy bear and a white bunny, both with checkered ribbon bows. Lavender background with hearts and a bow.
BOTTOM-LEFT badge: both wear soft bunny-eared hoodies and together form a single heart shape with their hands in front of their chests. Mint background with stars and comic sparkle marks.
BOTTOM-RIGHT badge: no animal ears. Tight cheek-to-cheek face close-up, faces noticeably larger and more zoomed-in than the other three badges, one hand raised near the cheek. Pink background with a heart and a ribbon.

Chat character CharacterA expression in every badge: calm, soft expression.

User persona CharacterB expression in every badge: bright open smile.

Keep each person's chosen expression recognizable in all four badges; only small natural variation such as a wink or a wider smile is allowed.

Height / face position in every badge: Keep both faces at the same vertical height inside the circle — equal eye-line, neither person taller.

Background decoration: Keep each badge's own template background: blue, lavender, mint and pink in that order.

Border decoration: No extra outer frame beyond each badge's clean circular edge.

Keep both faces and important gestures fully inside each circle. Bold clean line art, pastel digital coloring, merchandise-quality kawaii finish.

Exactly two people per badge and exactly four badges. No extra person, identity swap, merged face, text, letters, signature, logo, watermark, UI, screenshot border or cropping mark.
```

## 5. Standard LD duo

REFERENCE ORDER:
Image 1: /synthetic/character-a-primary.webp
Image 2: /synthetic/character-b-primary.webp

APPEARANCE MODE:
Subject A (CharacterA): IMAGE_PLUS_SAVED · ref 1
Subject B (CharacterB): IMAGE_PLUS_SAVED · ref 2

PROMPT:
```
Create one polished vertical 2:3 Korean character illustration, not a comic page.
SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — CHAT CHARACTER: CharacterA]
Reference: Image 1 belongs ONLY to CharacterA.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- black hair, asymmetric fringe, explicitly NOT center-parted / NOT 5:5
- black pupils, red irises
- white shirt, black harness
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterA.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — USER PERSONA: CharacterB]
Reference: Image 2 belongs ONLY to CharacterB.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- blue-black hair, center-parted hair
- dark gray irises
- black suit
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterB.
Never infer SUBJECT B's identity from any other subject.

IDENTITY OWNERSHIP IS STRICT.
Each numbered reference image maps 1:1 to exactly one listed subject. Do not reuse a photo for anyone else.
Each subject owns only the visual traits from their own identity block and own reference.
NEVER transfer between subjects: hair color, haircut, bangs, hair part, center part / 5:5 part, eye color, iris color, pupil color, heterochromia, facial marks, scars, tattoos, accessories, body traits, or signature clothes.
Do not average or homogenize identities even when both subjects look similar.
Do not assume that a visually striking feature belongs to every person.
A trait appearing in one subject's reference is NOT a global style property.
Pupil, iris, and overall eye color are distinct traits. Keep each color on the subject that owns it.
Negative identity constraints are authoritative and belong only to the named subject. Do not drop or invert them.
STYLE may be harmonized globally. IDENTITY may NOT be harmonized globally.
Unify art style, not identity. Do not average the subjects' physical traits while harmonizing style.
Template or another person's appearance must never be treated as a style characteristic.
PRIORITY: 1) explicit generation product option (pose, expression, temporary costume/prop); 2) this subject's stable saved identity only when IMAGE_PLUS_SAVED; 3) this subject's own reference image; 4) template styling/composition.
Product options may add a temporary prop or costume. They must not rewrite hair color, eye/iris/pupil color, or face identity.
GENDER LOCK — mandatory identity rule.
chat character CharacterA: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
user persona CharacterB: confirmed FEMALE. Keep her female in face, torso and body shape. Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male. Do not masculinize her body, jaw, torso or clothing beyond the reference identity.
Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.
SAFETY — depict a wholesome conversation / meeting scene only. Do not depict injury, blood, wounds, scars, weapons, self-harm, suicide, hanging, cutting, or medical trauma even if metaphorical language appears in the turn text.
Depict the selected chat-turn scene brief below as one cinematic, emotionally accurate scene.
Match the drawing style, line quality, coloring, facial design, and overall finish of the supplied character references as closely as possible. If the two references differ, harmonize them into one coherent polished style without changing either identity.
Use natural body language, facial expressions, camera framing, props, lighting, and background that accurately express the setting, atmosphere, and actions.
Key dialogue lines are for emotion and acting only. Do not render speech bubbles, captions, subtitles, or readable dialogue text in the illustration.
Show exactly these two people. Do not add extra people, duplicates, split panels, borders, speech bubbles, captions, sound effects, signatures, logos, or watermarks.
Compose for a vertical 2:3 profile-friendly illustration around 800 by 1200 pixels. Keep important faces and gestures away from the outer crop edges.

SELECTED TURN SCENE BRIEF:
Setting: cafe Actions: CharacterB hands CharacterA a cup.
```

## 6. 3+ person LD/TRPG cast

REFERENCE ORDER:
Image 1: /synthetic/character-a-primary.webp
Image 2: /synthetic/character-b-primary.webp
Image 3: /synthetic/character-c-alt.webp

APPEARANCE MODE:
Subject A (CharacterA): IMAGE_PLUS_SAVED · ref 1
Subject B (CharacterB): IMAGE_PLUS_SAVED · ref 2
Subject C (CharacterC): IMAGE_ONLY · ref 3
Subject D (CharacterD): IMAGE_PLUS_SAVED · ref none

PROMPT:
```
Create one polished vertical 2:3 Korean character illustration, not a comic page.
This is a TRPG party group illustration. Show ALL 4 listed people together in a single scene. Count the people: 4. Do not omit anyone.
CAST (mandatory identity — match each person exactly; do not swap faces, hair, outfits, or genders):
1. CharacterA (companion character). Gender: confirmed male. Reference image 1 is the identity photo for CharacterA only. Do not apply this photo to anyone else.
2. CharacterB (player). Gender: confirmed female. Reference image 2 is the identity photo for CharacterB only. Do not apply this photo to anyone else.
3. CharacterC (companion character). Gender: confirmed gender-unspecified. Reference image 3 is the identity photo for CharacterC only. Do not apply this photo to anyone else.
4. CharacterD (player). Gender: confirmed male. No photo for CharacterD. Do not substitute another referenced face.
SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — COMPANION CHARACTER: CharacterA]
Reference: Image 1 belongs ONLY to CharacterA.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- black hair, asymmetric fringe, explicitly NOT center-parted / NOT 5:5
- black pupils, red irises
- white shirt, black harness
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterA.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — PLAYER: CharacterB]
Reference: Image 2 belongs ONLY to CharacterB.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- blue-black hair, center-parted hair
- dark gray irises
- black suit
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterB.
Never infer SUBJECT B's identity from any other subject.

[SUBJECT C — COMPANION CHARACTER: CharacterC]
Reference: Image 3 belongs ONLY to CharacterC.
Appearance mode: IMAGE_ONLY
No supplemental saved appearance.
Use this selected reference as the authoritative visual identity for this subject only.
Identity ownership: every trait in this block belongs only to CharacterC.
Never infer SUBJECT C's identity from any other subject.

[SUBJECT D — PLAYER: CharacterD]
Reference: No photo for CharacterD. Do not borrow another subject's reference or face.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- short black hair, glasses
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
No selected reference image is available, so do not invent a current-outfit photo or borrow another subject's clothes.
Identity ownership: every trait in this block belongs only to CharacterD.
Never infer SUBJECT D's identity from any other subject.

IDENTITY OWNERSHIP IS STRICT.
Each numbered reference image maps 1:1 to exactly one listed subject. Do not reuse a photo for anyone else.
Each subject owns only the visual traits from their own identity block and own reference.
NEVER transfer between subjects: hair color, haircut, bangs, hair part, center part / 5:5 part, eye color, iris color, pupil color, heterochromia, facial marks, scars, tattoos, accessories, body traits, or signature clothes.
Do not average or homogenize identities even when both subjects look similar.
Do not assume that a visually striking feature belongs to every person.
A trait appearing in one subject's reference is NOT a global style property.
Pupil, iris, and overall eye color are distinct traits. Keep each color on the subject that owns it.
Negative identity constraints are authoritative and belong only to the named subject. Do not drop or invert them.
STYLE may be harmonized globally. IDENTITY may NOT be harmonized globally.
Unify art style, not identity. Do not average the subjects' physical traits while harmonizing style.
Template or another person's appearance must never be treated as a style characteristic.
PRIORITY: 1) explicit generation product option (pose, expression, temporary costume/prop); 2) this subject's stable saved identity only when IMAGE_PLUS_SAVED; 3) this subject's own reference image; 4) template styling/composition.
Product options may add a temporary prop or costume. They must not rewrite hair color, eye/iris/pupil color, or face identity.
GENDER LOCK — mandatory identity rule.
companion character CharacterA: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
player CharacterB: confirmed FEMALE. Keep her female in face, torso and body shape. Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male. Do not masculinize her body, jaw, torso or clothing beyond the reference identity.
companion character CharacterC: gender is unspecified / non-binary. Do not infer or change gender from hair length, cuteness, outfit, pose, blush, eyelashes or body size. Follow the reference identity without adding stereotyped male or female anatomy unless it is clearly present in the reference.
player CharacterD: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.
SAFETY — depict a wholesome conversation / meeting scene only. Do not depict injury, blood, wounds, scars, weapons, self-harm, suicide, hanging, cutting, or medical trauma even if metaphorical language appears in the turn text.
Depict the selected scene brief below as one cinematic, emotionally accurate group scene. If ROUND ACTIONS are listed, pose each named person according to their own action. Use LOCATION as the background.
Match the drawing style, line quality, coloring, facial design, and overall finish of the supplied character references as closely as possible. If the references differ, harmonize them into one coherent polished style without changing any identity.
Use natural body language, facial expressions, camera framing, props, lighting, and background that accurately express the setting, atmosphere, and actions.
Key dialogue lines are for emotion and acting only. Do not render speech bubbles, captions, subtitles, or readable dialogue text in the illustration.
Show exactly these 4 people. Do not add extra people, duplicates, split panels, borders, speech bubbles, captions, sound effects, signatures, logos, or watermarks.
Compose a group shot so every listed face is clearly visible. Prefer a mid-shot or full-body arrangement. Do not hide a listed person behind another, off-canvas, or as a tiny background extra.
Compose for a vertical 2:3 profile-friendly illustration around 800 by 1200 pixels. Keep important faces and gestures away from the outer crop edges.

SELECTED TURN SCENE BRIEF:
LOCATION: ruined gate
GM SCENE: The party stands at a ruined gate.
```

## 7. NO PHOTO + SAVED APPEARANCE

REFERENCE ORDER:


APPEARANCE MODE:
Subject A (CharacterA): IMAGE_PLUS_SAVED · ref none

PROMPT:
```
[SUBJECT A — COMPANION CHARACTER: CharacterA]
Reference: No photo for CharacterA. Do not borrow another subject's reference or face.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- black hair, asymmetric fringe, explicitly NOT center-parted / NOT 5:5
- black pupils, red irises
- white shirt, black harness
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
No selected reference image is available, so do not invent a current-outfit photo or borrow another subject's clothes.
Identity ownership: every trait in this block belongs only to CharacterA.
Never infer SUBJECT A's identity from any other subject.
```

## 8. NO PHOTO + NO SAVED APPEARANCE

REFERENCE ORDER:


APPEARANCE MODE:
Subject A (CharacterE): NO_VISUAL_REFERENCE · ref none

PROMPT:
```
[SUBJECT A — PLAYER: CharacterE]
Reference: No photo for CharacterE. Do not borrow another subject's reference or face.
Appearance mode: NO_VISUAL_REFERENCE
No visual reference or saved appearance is available for this subject.
Use only the subject's name, gender lock and scene role.
Never borrow another subject's face or visual traits.
Identity ownership: every trait in this block belongs only to CharacterE.
Never infer SUBJECT A's identity from any other subject.
```

## 9. TRPG party mixed visual states

REFERENCE ORDER:
Image 1: /synthetic/character-a-primary.webp
Image 2: /synthetic/character-c-alt.webp

APPEARANCE MODE:
Subject A (CharacterA): IMAGE_PLUS_SAVED · ref 1
Subject B (CharacterC): IMAGE_ONLY · ref 2
Subject C (CharacterD): IMAGE_PLUS_SAVED · ref none
Subject D (CharacterE): NO_VISUAL_REFERENCE · ref none

PROMPT:
```
Create one polished vertical 2:3 Korean character illustration, not a comic page.
This is a TRPG party group illustration. Show ALL 4 listed people together in a single scene. Count the people: 4. Do not omit anyone.
CAST (mandatory identity — match each person exactly; do not swap faces, hair, outfits, or genders):
1. CharacterA (companion character). Gender: confirmed male. Reference image 1 is the identity photo for CharacterA only. Do not apply this photo to anyone else.
2. CharacterC (companion character). Gender: confirmed gender-unspecified. Reference image 2 is the identity photo for CharacterC only. Do not apply this photo to anyone else.
3. CharacterD (player). Gender: confirmed male. No photo for CharacterD. Do not substitute another referenced face.
4. CharacterE (player). Gender: confirmed female. No photo for CharacterE. Do not substitute another referenced face.
SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — COMPANION CHARACTER: CharacterA]
Reference: Image 1 belongs ONLY to CharacterA.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- black hair, asymmetric fringe, explicitly NOT center-parted / NOT 5:5
- black pupils, red irises
- white shirt, black harness
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
For temporary clothing/outfit, prefer this subject's selected reference image when it clearly shows a different current outfit.
Identity ownership: every trait in this block belongs only to CharacterA.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — COMPANION CHARACTER: CharacterC]
Reference: Image 2 belongs ONLY to CharacterC.
Appearance mode: IMAGE_ONLY
No supplemental saved appearance.
Use this selected reference as the authoritative visual identity for this subject only.
Identity ownership: every trait in this block belongs only to CharacterC.
Never infer SUBJECT B's identity from any other subject.

[SUBJECT C — PLAYER: CharacterD]
Reference: No photo for CharacterD. Do not borrow another subject's reference or face.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- short black hair, glasses
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
No selected reference image is available, so do not invent a current-outfit photo or borrow another subject's clothes.
Identity ownership: every trait in this block belongs only to CharacterD.
Never infer SUBJECT C's identity from any other subject.

[SUBJECT D — PLAYER: CharacterE]
Reference: No photo for CharacterE. Do not borrow another subject's reference or face.
Appearance mode: NO_VISUAL_REFERENCE
No visual reference or saved appearance is available for this subject.
Use only the subject's name, gender lock and scene role.
Never borrow another subject's face or visual traits.
Identity ownership: every trait in this block belongs only to CharacterE.
Never infer SUBJECT D's identity from any other subject.

IDENTITY OWNERSHIP IS STRICT.
Each numbered reference image maps 1:1 to exactly one listed subject. Do not reuse a photo for anyone else.
Each subject owns only the visual traits from their own identity block and own reference.
NEVER transfer between subjects: hair color, haircut, bangs, hair part, center part / 5:5 part, eye color, iris color, pupil color, heterochromia, facial marks, scars, tattoos, accessories, body traits, or signature clothes.
Do not average or homogenize identities even when both subjects look similar.
Do not assume that a visually striking feature belongs to every person.
A trait appearing in one subject's reference is NOT a global style property.
Pupil, iris, and overall eye color are distinct traits. Keep each color on the subject that owns it.
Negative identity constraints are authoritative and belong only to the named subject. Do not drop or invert them.
STYLE may be harmonized globally. IDENTITY may NOT be harmonized globally.
Unify art style, not identity. Do not average the subjects' physical traits while harmonizing style.
Template or another person's appearance must never be treated as a style characteristic.
PRIORITY: 1) explicit generation product option (pose, expression, temporary costume/prop); 2) this subject's stable saved identity only when IMAGE_PLUS_SAVED; 3) this subject's own reference image; 4) template styling/composition.
Product options may add a temporary prop or costume. They must not rewrite hair color, eye/iris/pupil color, or face identity.
GENDER LOCK — mandatory identity rule.
companion character CharacterA: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
companion character CharacterC: gender is unspecified / non-binary. Do not infer or change gender from hair length, cuteness, outfit, pose, blush, eyelashes or body size. Follow the reference identity without adding stereotyped male or female anatomy unless it is clearly present in the reference.
player CharacterD: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
player CharacterE: confirmed FEMALE. Keep her female in face, torso and body shape. Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male. Do not masculinize her body, jaw, torso or clothing beyond the reference identity.
Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.
SAFETY — depict a wholesome conversation / meeting scene only. Do not depict injury, blood, wounds, scars, weapons, self-harm, suicide, hanging, cutting, or medical trauma even if metaphorical language appears in the turn text.
Depict the selected scene brief below as one cinematic, emotionally accurate group scene. If ROUND ACTIONS are listed, pose each named person according to their own action. Use LOCATION as the background.
Match the drawing style, line quality, coloring, facial design, and overall finish of the supplied character references as closely as possible. If the references differ, harmonize them into one coherent polished style without changing any identity.
Use natural body language, facial expressions, camera framing, props, lighting, and background that accurately express the setting, atmosphere, and actions.
Key dialogue lines are for emotion and acting only. Do not render speech bubbles, captions, subtitles, or readable dialogue text in the illustration.
Show exactly these 4 people. Do not add extra people, duplicates, split panels, borders, speech bubbles, captions, sound effects, signatures, logos, or watermarks.
Compose a group shot so every listed face is clearly visible. Prefer a mid-shot or full-body arrangement. Do not hide a listed person behind another, off-canvas, or as a tiny background extra.
Compose for a vertical 2:3 profile-friendly illustration around 800 by 1200 pixels. Keep important faces and gestures away from the outer crop edges.

SELECTED TURN SCENE BRIEF:
LOCATION: dark hall
GM SCENE: The party waits in the dark.
```

## 10. ALL PARTY REFERENCES ABSENT — provider-bound REFERENCE ORDER

REFERENCE ORDER:


APPEARANCE MODE:
Subject A (CharacterA): IMAGE_PLUS_SAVED · ref none
Subject B (CharacterB): NO_VISUAL_REFERENCE · ref none

PROMPT:
```
canGenerate: false
hiddenIdentityFallback: false
contextFallbackUrls (must not be sent): /synthetic/chat-main-character.webp, /synthetic/user-persona.webp

Create one polished vertical 2:3 Korean character illustration, not a comic page.
This is a TRPG party group illustration. Show ALL 2 listed people together in a single scene. Count the people: 2. Do not omit anyone.
CAST (mandatory identity — match each person exactly; do not swap faces, hair, outfits, or genders):
1. CharacterA (companion character). Gender: confirmed male. No photo for CharacterA. Do not substitute another referenced face.
2. CharacterB (player). Gender: confirmed female. No photo for CharacterB. Do not substitute another referenced face.
SUBJECT IDENTITY MANIFEST — each person is an independent identity owner.

[SUBJECT A — COMPANION CHARACTER: CharacterA]
Reference: No photo for CharacterA. Do not borrow another subject's reference or face.
Appearance mode: IMAGE_PLUS_SAVED
Saved visual identity (this subject only):
- black hair, asymmetric fringe, explicitly NOT center-parted / NOT 5:5
- black pupils, red irises
- white shirt, black harness
Saved stable identity traits (hair, eyes, iris, pupils, face, scars, skin, body, species marks) are authoritative for this subject.
No selected reference image is available, so do not invent a current-outfit photo or borrow another subject's clothes.
Identity ownership: every trait in this block belongs only to CharacterA.
Never infer SUBJECT A's identity from any other subject.

[SUBJECT B — PLAYER: CharacterB]
Reference: No photo for CharacterB. Do not borrow another subject's reference or face.
Appearance mode: NO_VISUAL_REFERENCE
No visual reference or saved appearance is available for this subject.
Use only the subject's name, gender lock and scene role.
Never borrow another subject's face or visual traits.
Identity ownership: every trait in this block belongs only to CharacterB.
Never infer SUBJECT B's identity from any other subject.

IDENTITY OWNERSHIP IS STRICT.
Each numbered reference image maps 1:1 to exactly one listed subject. Do not reuse a photo for anyone else.
Each subject owns only the visual traits from their own identity block and own reference.
NEVER transfer between subjects: hair color, haircut, bangs, hair part, center part / 5:5 part, eye color, iris color, pupil color, heterochromia, facial marks, scars, tattoos, accessories, body traits, or signature clothes.
Do not average or homogenize identities even when both subjects look similar.
Do not assume that a visually striking feature belongs to every person.
A trait appearing in one subject's reference is NOT a global style property.
Pupil, iris, and overall eye color are distinct traits. Keep each color on the subject that owns it.
Negative identity constraints are authoritative and belong only to the named subject. Do not drop or invert them.
STYLE may be harmonized globally. IDENTITY may NOT be harmonized globally.
Unify art style, not identity. Do not average the subjects' physical traits while harmonizing style.
Template or another person's appearance must never be treated as a style characteristic.
PRIORITY: 1) explicit generation product option (pose, expression, temporary costume/prop); 2) this subject's stable saved identity only when IMAGE_PLUS_SAVED; 3) this subject's own reference image; 4) template styling/composition.
Product options may add a temporary prop or costume. They must not rewrite hair color, eye/iris/pupil color, or face identity.
GENDER LOCK — mandatory identity rule.
companion character CharacterA: confirmed MALE. Keep him male in face, torso and body shape. Long hair, soft facial features, slim build, cute SD/chibi styling, blush, eyelashes, delicate clothing or androgynous beauty must NOT be interpreted as female. Use a flat masculine chest and male-coded torso. Do not draw breasts, cleavage, a feminine chest mound, a bra-like chest shape, wide feminine hips, or a girl/woman body.
player CharacterB: confirmed FEMALE. Keep her female in face, torso and body shape. Short hair, uniforms, combat gear, androgynous styling or a tall/lean build must NOT be interpreted as male. Do not masculinize her body, jaw, torso or clothing beyond the reference identity.
Never change a person's gender to fit hairstyle, prettiness, cute SD proportions, pose, outfit, or template decoration.
SAFETY — depict a wholesome conversation / meeting scene only. Do not depict injury, blood, wounds, scars, weapons, self-harm, suicide, hanging, cutting, or medical trauma even if metaphorical language appears in the turn text.
Depict the selected scene brief below as one cinematic, emotionally accurate group scene. If ROUND ACTIONS are listed, pose each named person according to their own action. Use LOCATION as the background.
Match the drawing style, line quality, coloring, facial design, and overall finish of the supplied character references as closely as possible. If the references differ, harmonize them into one coherent polished style without changing any identity.
Use natural body language, facial expressions, camera framing, props, lighting, and background that accurately express the setting, atmosphere, and actions.
Key dialogue lines are for emotion and acting only. Do not render speech bubbles, captions, subtitles, or readable dialogue text in the illustration.
Show exactly these 2 people. Do not add extra people, duplicates, split panels, borders, speech bubbles, captions, sound effects, signatures, logos, or watermarks.
Compose a group shot so every listed face is clearly visible. Prefer a mid-shot or full-body arrangement. Do not hide a listed person behind another, off-canvas, or as a tiny background extra.
Compose for a vertical 2:3 profile-friendly illustration around 800 by 1200 pixels. Keep important faces and gestures away from the outer crop edges.

SELECTED TURN SCENE BRIEF:
LOCATION: camp
GM SCENE: No one brought a photo.
```

