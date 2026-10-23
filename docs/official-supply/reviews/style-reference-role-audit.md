# Official image automation: style reference role, representative composition, and A/B readiness

Status: `ROOT_CAUSE_UNCONFIRMED` at image level. The code and review-path causes below are confirmed and fixed in the canonical owners. No paid image was generated, because no safe authenticated path to a provider key exists in the Cloud environment (section 4). GPT and the user own every quality verdict (style fidelity, composition independence, approval); nothing here is a quality score.

## 1. How the clone reached the representative and then 13 slots

Evidence: `pilot-rf-02-asset-redesign.md` sections 13 to 23 and `reattach-2026-10-17/manifest.json`.

- Origin: representative candidate F was an in-place edit of reference 03 made by out-of-pipeline harness scripts (`wolfgang-f-edit.ts.txt`). It never went through `composeOfficialSlotGeneration`, so the shot plan, the style-role bans and the prompt owners did not see it. The manifest marks all 8 user references `usedAsWolfgangGenerationReference: false`.
- Adoption: the review text recorded that head angle, gaze and large face placement are "close to original 3" and filed that as a separate, non-blocking item. The document then adopted F as "the person and style baseline for the next production" (still not an operator approval or QA pass of the live representative).
- Propagation: the 13 RP candidates were generated with F as the only image (`variation_identity_and_style`, token `official-review-candidate:<F sha>`), with the style DNA not rendered in that layout. Every slot therefore inherited F's face, its line and texture density, and its background density.
- Production state: the live `#51` representative is unchanged; applying F to it was never executed. The apply path exists (`registerExternalOfficialAssetReplacement` then `reviewRepresentativeReplacement` with anchor QA, then `applyApprovedOfficialAssetReplacements`) and tests use fixture reviews that say `test-fixture-not-quality-approval`.
- Why review did not catch it: anchor QA had 10 identity/crop/style keys and no composition key; `artStyle` is a pass/fail on style likeness, so a clone scores well on it. Similarity to the reference was written as prose, outside the gate.
- Shot plan versus references: `rep` was fixed to `front / eye_level / bust`. The user's references are mostly frontal or frontal-leaning busts (03, 01, 08 and partly 07), so the shot plan agreed with them and gave the model no independent signal to leave the reference composition. The slot's own pose text for Wolfgang `rep` also says "facing front" while the shot line owns face direction; that is character data and is reported, not edited.

## 2. Changes (same canonical owners, no new system)

- `shotPlan.ts`: the representative keeps the eye-level bust card crop, but with a draft key its head direction (`front`, `left_three_quarter`, `right_three_quarter`) rotates by canonical identity, like every other slot family. No reference image is read, nothing is fixed to 3/4, `profile` is excluded for card readability, and without a draft key the table default is unchanged. The representative shot line now says "Do not inherit any reference image's camera, head angle, gaze, crop, or hand position".
- `imagePrompt.ts`: `OFFICIAL_DETAIL_RESTRAINT_CLAUSE` is rewritten to be style-neutral. It follows the supplied image's own line weight, coloring and detail density, forbids finer lines, noise, grain or material texture than the image shows, and keeps the same level of ornament, embroidery and background the image shows. The earlier "smooth skin / large shading planes / simplified metal / background no busier than the figure" wording is removed from the common owner. The representative rule also states that SHOT RESPONSIBILITY owns face direction and the Pose line owns action, so a pose phrase cannot override the head direction.
- `style.ts` (style data): `ROFAN_CLUSTER_B_GRAPHIC_STYLE_DIRECTION` is reduced to the one rule the DNA does not carry (graphic cel-shading over painterly softness). Saturation, face readability, ornament density and background simplicity were duplicated by the DNA, the shot owner and the common clause. `hairRendering` no longer says "no individual strands"; it says strands only as far as the references show them (the user's references show strand-level hair with gloss).
- `shotPlan.ts` backgrounds: `environment` and `scene` keep their identifiable-place requirement and defer density to "the style image's own background density".
- Review path (`store.ts`): every new review method (`reviewAnchor`, `reviewVariation`, `reviewReplacement`, `reviewRepresentativeReplacement`, `rereviewRepresentativeReplacement`) refuses a report with no `compositionIndependence` answer (`composition_review_required`), and a recorded `ok: false` rejects. The operator form already lists the key. Apply time (`isCompletePassingAnchorQa`) keeps accepting reviews recorded before this key existed; a recorded failure still blocks. An externally generated representative therefore goes through the same existing approval path and now needs this answer.

## 3. Request evidence and A/B readiness

`scripts/wolfgang-rep-model-ab.ts` (one file, same `composeOfficialSlotGeneration` + `prepareOfficialImageReferences` + `callOpenAiImageEdit` owners as the earlier Wolfgang harnesses). `preflight` makes zero provider calls. `post` needs `WOLFGANG_REP_AB_LIVE=1`, refuses a second run into the same `--out`, makes one call per model with no fallback, retry or vision, halts on a 0.35 USD budget (about 490 KRW; anything at or above 1,000 KRW is refused), and records time, cost, request id and raw SHA.

Dry-run on this checkout (`NODE_TEST_CONTEXT=1`, public sheet; production reads the approved private Wolfgang source on the data volume and checks the same Appearance Lock hash `1c3ccd13…`):

- New representative, `1024x1536`, quality `medium`, webp compression 88, `n=1`, opaque, `POST /v1/images/edits`.
- Shot from the character's own identity: `left_three_quarter / eye_level / bust`.
- Identical primary prompt (SHA `bfd38b51…`) and references for both arms; models `gpt-image-2` and `gpt-image-2.5-sunburst`.
- Images sent in this order, selected once by purpose from the 8 references, style role only: 1) `07` face, skin, hair, dense gold embroidery, line weight; 2) `04` fur, chain and metal highlights; 3) `08` constant line weight and jacket ornament near the face. Not sent: `03` (the clone origin), `01`/`02` (open-shirt skin-forward), `05`/`06` (white hair), and the apocalypse 2.0 examples.
- Prepared sizes: 1024x1536 for all three (`preparedSha256` values are in the dry-run JSON).

Comparison items for GPT or the user, from the paid originals next to the three references: line fidelity, skin shading and smooth coloring, natural density of hair, costume and metal, character identity, independence of face, pose and composition from the references, cost and call time per model.

## 4. Railway key path: STOP

- The Cloud VM has no `OPENAI_API_KEY`. `RAILWAY_SSH_*` are 11-byte stubs. `HAV_RAILWAY_SSH_KEY` holds an OpenSSH private key.
- `railway` CLI 5.71.0 `whoami`/`status` with the injected `RAILWAY_TOKEN`: "Unauthorized". The token is rejected by the Railway API both as an account and as a project token. There is no logged-in session.
- `railway ssh` goes through the same authenticated CLI session, so the SSH key alone is not a usable path into the container (not bypassed). The Railway MCP server needs an interactive OAuth that timed out.
- Existing operator pattern for later: `scripts/railway-precall-final-wire.sh` runs a PR overlay inside the container from a throwaway `/tmp` directory with `railway ssh -i`. The same shape works for this script (overlay `scripts/wolfgang-rep-model-ab.ts` plus the three reference files under `docs/.../reattach-2026-10-17/`, run `post --out /tmp/...`, the key stays in the container's `process.env`, no DB, no registered image, no deploy, no restart). It needs a valid Railway login on the operator machine or a working token in the Cloud secrets. No authentication was bypassed and no production file was touched.

## 5. Public reference originals (read only; nothing deleted)

The repository `you8520-sketch/chat-ai` is PUBLIC. `public/` is also served by the live site with no gate on this path, so those files are reachable at `https://hav.chat/official-supply/style-seeds/...` as well.

- Runtime-required public paths (reader: `referencePreparation.platformPublicReferencePath` accepts only `/official-supply/style-seeds/` under `public/`; writers: none after the commits of 2026-09-27):
  - `romance-fantasy-cluster-b-v1/primary/b7, b13, b5` are the production representative style references, and `b3`, `b17`, `holdout/b6, b10, b11, b14` are listed in the bundle manifest and used by tests and proofs.
  - `romance-fantasy-user-owned-v1/` (`p1` to `p5`, `h1` to `h3`) is the legacy v3 proof bundle (`pilotStyleProof.ts`, tests); `p1`, `p2`, `p3`, `h1` are blocked from Cluster B generation.
  - Style seed URLs of this form are stored in the database, so removing or renaming these files breaks stored seeds and production generation.
- Not read by runtime code: `docs/official-supply/reviews/assets/wolfgang-asset-redesign/reattach-2026-10-17/` (11 files, 3.5 MB: the 8 references, the 2.0 source PNG, two apocalypse results). Readers are only the manifest, review text, `.ts.txt` harness copies and the review-candidate token owner (`REVIEW_CANDIDATE_ROOT = docs/official-supply/reviews/assets`), which this A/B script also uses.
- Byte duplicates: reference `01` equals public `p5`, `05` equals `p3`; public `p2` equals `b5`, `p4` equals `b11`.
- Move to private storage later (needs a private review-asset root first, then repoint tokens and the A/B script): references `02`, `03`, `04`, `06`, `07`, `08` and `01`/`05` copies in docs; the 3 comparison files `09`, `10`, `11`.
- Removable from the public repo without touching production behavior after the owner agrees: `09`, `10`, `11` (diagnostic only; cited by prose and the manifest).
- Must stay public until a private reader exists: everything under `public/official-supply/style-seeds/`.
- Git history: the blobs stay in the pack (and in every clone, fork or GitHub-cached PR ref) after removal from `HEAD`. Erasing them needs a history rewrite and force-push of `main`, invalidates open PR refs and does not remove third-party clones. Not done, not approved.

## 6. Before / after at prompt level (representative, Wolfgang)

BEFORE: rep `front / eye_level / bust`; style rule asks for "material detail" and "overall polish"; common clause dictates smooth skin, simplified metal and a quiet background for every style; the style direction repeats the DNA; pose "facing front" and shot owner not tied together.

AFTER: rep head direction from character identity (`left_three_quarter` for Wolfgang); the common rule defers to the references and names no style; style-specific rules stay in Cluster B data and no longer forbid strands; shot and pose ownership stated in the rep rule; background density defers to the reference.

## 7. Preserved and risks

Preserved: the 14-slot plan, identity, gender and visual-age locks, reference roles and the real `image[]` order (`composed.references` order equals the prepared and posted order), primary and strict fallback sharing one rule block, existing QA records, SHA checks, provider and model routing, billing.

Risks:

- Rotated representative direction changes every future official representative; check that the canonical scar (left jaw, under the chin) stays readable at this head direction.
- The Cluster B DNA still says `contrast: high`, `rendering: cel` and `skin: 매끈한 피부`. These are style data; confirm against the paid images whether they suit the 8 references.
- Wolfgang's own `rep` pose text says "facing front"; it needs a scoped data fix after approval, not an edit here.
- Prompt wording changes alter all future generations until the A/B is judged.
