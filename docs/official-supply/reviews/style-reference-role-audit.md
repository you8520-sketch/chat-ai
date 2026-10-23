# Official image automation: style reference role, representative composition, and A/B readiness

Status: Wolfgang representative A/B was run (1 call per model, 0 regenerations) and judged by the user and GPT directly: `gpt-image-2` is more faithful to the style references than `gpt-image-2.5-sunburst`. See sections 8 to 11. The `ROOT_CAUSE_FIXED` declaration still waits for GPT re-review of the model proposal and a wider (non-Wolfgang) check. Sections 1 to 7 are the earlier analysis and fixes (the dry-run and Railway wording in section 3/4 predates the run).

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
- Identical primary prompt and references for both arms. Canonical SHA before the run: `4245452eb05dc13608927efd0fafd8ceac80678d80daee4d14fe2f85d6ce1269`, enforced in the script (a different SHA stops the run before any provider call). Earlier values: `bfd38b51…` was an intermediate dry-run written into this document before the last prompt edit and is not reproducible at any commit; `2f3b6e96…` is the dry-run of `08f678bf`, which differs from the canonical SHA only in the pose line (below).
- One direction in the prompt: the approved rep pose says "정면을 향해 서서" while the shot owner sets `left_three_quarter`. The plan owner is `pilot-rf-02-approved-asset-plan-f.json` (locked; edited nowhere). For the experiment only, the script replaces that pose in memory with "갑옷을 입은 채 서서 한 손을 검 손잡이에 얹는다" (action and prop kept) and fails if the approved pose text ever changes. The rep `poseFamily: sit` is a table default that is not rendered into the prompt. A permanent fix is a locked-plan revision (follow-up, not done here).
- Same SHA from the public sheet and from the frozen approved `c91ba66a` source (checked with `OFFICIAL_SUPPLY_PILOT_DIR`); the `08f678bf` build differs only in the pose line (diffed). The image prompt reads only name, age, Appearance Lock (`1c3ccd13…`) and the rep expression/pose/outfit, which are identical in all of them.
- Models: `gpt-image-2` (A) then `gpt-image-2.5-sunburst` (B).
- Images sent in this order, selected once by purpose from the 8 references, style role only: 1) `07` face, skin, hair, dense gold embroidery, line weight; 2) `04` fur, chain and metal highlights; 3) `08` constant line weight and jacket ornament near the face. Not sent: `03` (the clone origin), `01`/`02` (open-shirt skin-forward), `05`/`06` (white hair), and the apocalypse 2.0 examples.
- Prepared sizes: 1024x1536 for all three (`preparedSha256` values are in the dry-run JSON).

Comparison items for GPT or the user, from the paid originals next to the three references: line fidelity, skin shading and smooth coloring, natural density of hair, costume and metal, character identity, independence of face, pose and composition from the references, cost and call time per model.

## 4. Railway key path: STOP (re-checked once on 2026-10-23)

- The Cloud VM has no `OPENAI_API_KEY`. The injected `RAILWAY_TOKEN` is still rejected by `railway whoami` (as `RAILWAY_TOKEN` and as `RAILWAY_API_TOKEN`: "Unauthorized"). No other login session exists, so `railway ssh` is unavailable. No token or SSH-key creation was retried; auth investigation stops here.
- Railway MCP OAuth (confirmed by GPT) lists the service and `OPENAI_API_KEY` but cannot run container commands, so it does not unblock the A/B.
- Needed from the user, not via chat: either a working Railway login for the Work browser path, or `OPENAI_API_KEY` as a Cursor Cloud secret (the script reads only `process.env`; a Cloud secret key is then used on this VM instead of Railway).

Container execution design (`scripts/wolfgang-rep-model-ab-railway.sh`, one-off; classify for cleanup after the evidence is archived):

- Builds an overlay from PR HEAD (changed non-test `.ts` files since the `origin/main` merge-base, the three reference webp files, the approved plan fixture) and unpacks it over a copy of `/app/src`, `/app/scripts` in a throwaway `/tmp` dir with `/app/node_modules` linked. `/app` itself, the data volume, the DB and registered assets are not written.
- The script refuses to run unless the prompt carries the PR-only markers (rep head-direction line, the "do not inherit reference camera/head/gaze/crop/hand" line, the new detail clause, the new hair rendering) and every owner file (`imagePrompt`, `shotPlan`, `style`, `runner`, `referencePreparation`, `imageProfile`, `openAiImageEdit`) hashes to the PR HEAD blob from `--owners-manifest`.
- Simulation without Railway: overlay on a checkout of the merge-base main produced the canonical SHA `4245452e…`; copying only the script into a plain main tree stopped with "prompt lacks PR owner markers" (fail closed).
- Cost gate: key never printed; before call 1 the reserve is 0.12 USD; call 2 starts only if `spent + max(0.06 USD, first measured cost x 2)` is within the 0.35 USD budget and below 90% of 1,000 KRW at a conservative 1,500 KRW/USD. A missing first-call cost halts before call 2. `callOpenAiImageEdit` prices usage at gpt-image-2 token rates for every model, so the 2.5 provider bill is checked against the provider dashboard after the run. Simulated with a stubbed provider: normal usage runs both arms (0.102 USD), an expensive first call skips call 2 (projected 841 KRW), missing usage halts.

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

## 8. A/B result (final judgment for this experiment)

- Scope: Wolfgang #51 new representative, 1024x1536, quality medium, same approved manuscript, Appearance Lock, prompt (canonical SHA `4245452e…`), reference list (07, 04, 08) and settings for both arms; one call per model, no regeneration.
- Judged by the user and GPT from the original images next to the references (Cursor did not score or approve):
  - `gpt-image-2` follows the style references more faithfully.
  - `gpt-image-2.5-sunburst` leans toward the GPT default look.
- Cost (reported by the operator run): `gpt-image-2` $0.087504, `gpt-image-2.5-sunburst` $0.056784, total $0.144288 (about 202 KRW at 1,400/USD; under the 1,000 KRW cap). Sunburst was cheaper (about 0.65x) and faster.
- Conclusion: Sunburst is cheaper and faster but fits the goal (reproduce the user's reference style) less well. `gpt-image-2` is the recommended default for official character automation. This is one character and one slot; it is not proof that 2.0 always wins (section 11).
- The #1713 structure (independent rep composition, style-role separation, style-neutral detail clause, composition QA) is model independent and stays.

## 9. Model owner investigation

- Effective model today: `resolveOfficialAssetImageModel(env)` in `imageProfile.ts` delegated to `resolveChatImageGenerationModel`, i.e. `OPENAI_IMAGE_MODEL` or the code default `gpt-image-2` (`CHAT_IMAGE_GENERATION_DEFAULT_MODEL`). The code default has never been Sunburst (`git log -S` on the default shows only its introduction). Sunburst reached official assets through the production `OPENAI_IMAGE_MODEL` value (not readable from the Cloud VM; GPT confirmed the variable exists) and through the pinned one-off harnesses below.
- Official call sites that read the one resolver: `runner.ts` (`composeOfficialSlotGeneration`, so the generation runner and the operator/overlay scripts), `qualityShotQa.ts` (`resolveLucianSig4ProofImageModel`), `scripts/official-supply-quality-shot-qa.ts`, `lockedSnapshotReconcileOperator.ts` (assembly only). No official source hardcodes a model id (guarded by `officialSupply.qa.test.ts`).
- Chat owners sharing `OPENAI_IMAGE_MODEL`: `api/chat/image-generation/route.ts`, `api/chat/comic-generation/route.ts`, `scripts/run-cast-gpt-image-smoke.ts`. These must not change.
- Duplicate owners (cleanup candidates, not changed except the env key): `scripts/wolfgang-asset-redesign-emo5-r2.ts`, `-emo-f-candidates.ts`, `-remaining-10.ts` each hardcode `gpt-image-2.5-sunburst` and pass `env: { OPENAI_IMAGE_MODEL }`; `-build-remaining-boards.ts` writes the string into an evidence JSON. They are executed one-off evidence harnesses: KEEP until the Wolfgang redesign evidence is archived, then classify for removal.
- Conclusion: the single owner is `resolveOfficialAssetImageModel`, but it is coupled to the chat-wide env, so switching official assets via the env would also switch chat, comic and TRPG illustration.

## 10. Minimal change to return official automation to gpt-image-2 (proposal: Draft PR #1717, stacked on this PR)

- `imageProfile.ts`: `resolveOfficialAssetImageModel` = `OFFICIAL_ASSET_IMAGE_MODEL` (optional explicit override) or `OFFICIAL_ASSET_IMAGE_DEFAULT_MODEL = "gpt-image-2"`; it stops reading `OPENAI_IMAGE_MODEL`. One function, one file; chat resolver untouched.
- Test and harness env keys renamed accordingly (13 officialSupply tests, the three pinned redesign scripts, the A/B script); one new owner test; the old "never owns a model id" guard narrowed to "only `imageProfile.ts` may".
- Impact: official generation uses gpt-image-2 after deploy independent of the production `OPENAI_IMAGE_MODEL`. Stored assets and DB are not touched; new rows record `gpt-image-2`. Cost per representative call about 1.54x (measured); the existing 0.12 USD per-image reserve covers it, operator `--per-call-reserve-usd` values must be at least 0.10. Only the representative was measured; the landscape slots are not.
- Rollback: set `OFFICIAL_ASSET_IMAGE_MODEL=gpt-image-2.5-sunburst` or revert.
- Not applied to production; routing change waits for GPT re-review.

## 11. Regression review

- Over-similarity risk with 2.0: a model that follows references more closely can also copy face, gaze, pose and crop more closely, which is the original defect. The A/B prompt carries the #1713 independence rules and the rep head direction (`left_three_quarter`); whether 2.0 still clones the reference composition was judged by the user and GPT on this one image, not measured.
- Is `compositionIndependence` enough? Not by itself. Findings: (1) it is a human attestation with a boolean and an optional note; nothing forces the reviewer to compare against the specific references used; (2) `scripts/official-supply-approve-anchor.ts` builds the whole QA report from one human "approve" decision and marks every key including `compositionIndependence` as pass with one shared note, so on that path it is a blanket pass; (3) there is no automated similarity signal. Recommended follow-up (not in this PR): require a per-key note for `compositionIndependence` that names which references were compared, have the review surface show the references next to the candidate, and consider an automated pre-filter (head-pose and crop comparison against the sent references) that only flags, never approves.
- Representative to 13 slots: unchanged. Slots still use `identity_then_style` / `identity_and_style` with the approved representative as the sole image in the latter, so a faithful but over-similar representative still propagates into all 13. That makes the representative review the single gate that matters; keep it before slot generation.
- 2.0 is not proven better for every character: one character, one slot, one sample per model. Before treating it as proven, run the same A/B on at least two other official characters with different style clusters and on one RP (landscape, `identity_and_style`) slot, within the cost cap, and have GPT or the user judge.
- Cost: 2.0 is about 1.5x per representative call; the 13 landscape slots could differ.

