# Official image automation: style reference role and composition audit

Status: `ROOT_CAUSE_UNCONFIRMED` at image level. Three prompt and review defects are confirmed in code and fixed in the canonical owners. Their effect on generated images, and the `gpt-image-2` vs `gpt-image-2.5-sunburst` A/B, were NOT measured: this environment has no `OPENAI_API_KEY`.

GPT and the user own the quality verdict (style similarity, composition independence, approval). Nothing here is a quality score.

## Real request path (current main `b079c3b6`)

- Transport: Images API `POST /v1/images/edits`, multipart `image[]`, `n=1`, `background=opaque`, webp compression 88, no `input_fidelity` (must be omitted for `gpt-image-2`). Owner: `src/lib/openAiImageEdit.ts`.
- Model: `resolveChatImageGenerationModel` (`OPENAI_IMAGE_MODEL`; default `gpt-image-2`; production env `gpt-image-2.5-sunburst`). Quality `medium`; 1024x1536 rep, 1536x1024 RP slots (`imageProfile.ts`).
- References: `prepareOfficialImageReferences` (rotate, fit inside 1536, webp q90, SHA-checked `official-review-candidate:` / `official-approved-asset:` tokens). Roles come from `resolveOfficialGenerationReferencePlan` and the prompt layout from `imagePrompt.ts`.
- Wolfgang #51 slots use the `representative_identity_and_style` policy: the approved rep is the only image sent for the 13 non-rep slots, and style DNA is not rendered in that layout.
- The prompt never contained "ultra detailed" or "intricate textures". The over-detail pressure came from the wording below.

## Findings (cause classes)

- A, model: not measurable here. `input_fidelity` is always high on `gpt-image-2`, so it cannot explain a delivery difference by itself.
- B, reference delivery: references are delivered as real image inputs. The rep was an in-place edit of `ref_03` made in an out-of-pipeline harness and then adopted, which is the origin of the cloned composition. Every later slot inherits that rep as sole identity and style source.
- C, prompt assembly (fixed):
  - `OFFICIAL_STYLE_USE_CLAUSE` asked for "material detail" and "overall polish".
  - `OFFICIAL_STYLE_COPY_FORBIDDEN_CLAUSE` banned identity but not gaze, head angle, camera, crop, silhouette or expression.
  - The identity+style layout drops style DNA, so no text bounded line, texture or background density.
  - Shot table background wording asked for readable environments without a density limit.
- D, role mixing (fixed): the style ban lacked composition, and the identity ban lacked gaze and silhouette.

## Change

- `imagePrompt.ts`: new `OFFICIAL_DETAIL_RESTRAINT_CLAUSE` (one owner, used inside `OFFICIAL_STYLE_USE_CLAUSE` and in the identity+style rule); style-use wording lists rendering traits only; copy-ban extended with composition and "compose independently even if less similar"; identity copy-ban adds gaze and silhouette. No angle is hardcoded.
- `shotPlan.ts`: environment/scene background wording requires a readable place through a few large simple shapes, no busier than the figure.
- Review path (`types.ts`, `store.ts`, `approvedAssetApplyOperator.ts`): `compositionIndependence` added to the anchor and variation QA. New operator reviews must record it. Reviews recorded before this change remain valid (the key is optional at apply time) but a recorded failure blocks. `artStyle` is documented as smooth skin, large shading planes, clean lines, detail no denser than the references.
- Removed: "material detail", "overall polish" wording; the duplicate Image 2 camera/framing ban is kept only because existing tests pin it.

## BEFORE / AFTER (representative style rule)

BEFORE: `Use the supplied image(s) solely for drawing/rendering language, facial illustration treatment, coloring, lighting, hair rendering density, material detail, detail density, and overall polish. ... Do not copy ... pose, or background.`

AFTER: `Use the supplied image(s) solely for line weight and density, flat color planes and shading shapes, skin coloring, hair and costume material rendering, light and color mood, and detail distribution. Keep detail no denser than the supplied style image: ... Do not copy ... pose, gaze, head angle, expression, camera, crop, silhouette, or background. Compose this shot independently of the reference even if the result looks less similar.`

Identity+style (Wolfgang #51 slots) gains the detail ceiling and the gaze/silhouette ban; reference list and order are unchanged.

## Preserved

14-slot plan and shot table, identity lock, gender and visual-age locks, reference plan modes and order, timeout/strict-fallback path (same `referenceRule` in both prompts), approved assets, legacy QA records, apply-time SHA checks.

## Regression risks

- Prompt wording changes alter every future generation. The test that pinned the historical Wolfgang sig1 prompt hash was changed to structural checks (slot expression, shot responsibility, identity ban, detail ceiling, reference list), because the recorded hash is of the old prompt.
- The detail ceiling could flatten intentional ornament; judge on images.
- Operator reviews now need one more key; templates already list it.

## Proof

- `src/lib/officialSupply/*.test.ts`: 604 pass, 0 fail after the change (baseline 597 pass). The new `officialSupply.styleReferenceRole.test.ts` fails 7/7 against the old owners and passes after.
- `git diff --check`, `npm run lint`, `npm run typecheck:app` clean. Full `tsc --noEmit` errors are the known test-file ones.
- No AFTER images and no side-by-side exist: no paid call was made.

## Paid A/B plan (not run)

Conditions: Wolfgang #51 `sig4`, `identity_and_style` layout with the approved rep as the real image input (or a purpose-picked subset of the 8 refs for the style role only; never the apocalypse diagnostic images), identical prompt, `1536x1024`, quality `medium`, webp 88, `n=1`, one call per model.

Cost cap: recorded sunburst calls cost about USD 0.030 each (`assets/wolfgang-asset-redesign/*`). Even at 3x for three references, two calls are about USD 0.18, roughly 250 KRW, under the 1,000 KRW cap. Blocker is only the missing `OPENAI_API_KEY`.

Model recommendation: none. Per the brief, no provider, model routing or billing change is made; decide after the A/B images are reviewed by GPT and the user.

## Notice

The user's style reference images are already in this public repository (`public/official-supply/style-seeds/...`, `docs/official-supply/reviews/assets/wolfgang-asset-redesign/reattach-2026-10-17/`). This PR adds no new copies.
