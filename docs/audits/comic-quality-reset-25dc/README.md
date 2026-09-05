# Comic quality reset audit

Status: investigation and admin-only prototype. No merge or deploy.

## Phase 1 — owner map

| Owner | Current implementation |
| --- | --- |
| `SOURCE_SCENE_OWNER` | `resolveSceneSource()` in `src/app/api/chat/comic-generation/route.ts`, with source sanitization in `src/lib/chatImageScenePlan.ts` |
| `SCENE_BEAT_OWNER` | `ScenePlan`, deterministic extraction/reflow, and `projectComicPanelBeat()` |
| `PANEL_COMPOSITION_OWNER` | `compileChatComicPanelSpec()` plus its visual prompt renderer |
| `CAMERA_OWNER` | `resolveCameraFromBeat()`; four-panel roles are setup, progression, turn/escalation, and payoff |
| `CHARACTER_STAGING_OWNER` | prompt subject map, cast manifest bindings, and `resolveComicSubjectStaging()` |
| `BALLOON_GEOMETRY_OWNER` | `computeBubbleGeometry()`, `layoutPanelBubbles()`, collision resolution, and SVG compilation |
| `BALLOON_TAIL_OWNER` | `layoutPanelBubbles()` and the server SVG path compiler |
| `READABLE_TEXT_OWNER` | dialogue safety filtering, Korean wrapping, SVG text rendering, and persistence |
| `FINAL_COMPOSITE_OWNER` | `renderComicTextOverlay()` and Sharp WebP persistence in the comic route |

### Findings

`CURRENT_GPT_VISUAL_FREEDOM: MEDIUM`

The provider still renders the pixels, including pose nuance, expression, lighting,
and exact subject placement. However, the primary prompt prescribes panel roles,
camera intent, framing, left/right layout, action ownership, no-bubble rendering,
and an upper-right overlay reservation. The provider is therefore not a free comic
director.

`SERVER_OVERLAY_COMPOSITION_INTERFERENCE: PROVEN`

The saved image is a Sharp composite of the provider image and server-generated
white bubble bodies, tails, narration boxes, SFX, and glyphs. This proves structural
interference with provider composition. The current code does not measure whether a
specific face, hand, or action was occluded, so the causal quality impact remains
`ROOT_CAUSE_UNCONFIRMED`.

The strict Tier-2 path remains a separate safe prompt compiled from safe structure;
it does not reuse the primary prompt or raw source prose. Reference isolation keeps
template, character, and persona slot identity stable while changing only selected
reference content.

## Admin-only prototype

- `semantic_ladder` accepts exactly one manually selected level `L0`–`L8`.
- Ladder fixtures use four panels, the existing GPT Image 2 model, medium quality,
  the existing comic output size, and the same three reference slots.
- Ladder provider prompts contain visual semantics only: no source prose and no
  readable dialogue.
- `blank_balloon_hybrid` lets GPT own composition, camera, staging, reactions,
  blank balloon/narration geometry, tails, and decorative effects.
- Hybrid Tier-2 (strict safety fallback) preserves the same blank-balloon
  composition contract: complete comic composition, blank white speech balloons,
  black outlines, natural tails toward the speaker, empty interiors, blank
  narration boxes where needed, and zero readable/placeholder/gibberish text.
  Only scene-safety semantics become stricter; the server text glyphs never
  float over artwork without a blank-balloon layer.
- Hybrid server compositing emits text glyphs only (no rect/path/ellipse body).
  The canonical human-QA strategy is `local_image_detection`: Sharp pixel
  analysis finds enclosed bright balloon interiors and the detected region owns
  the glyph bounds. Ambiguous matches are rejected rather than covering artwork.
  `shared_anchor_regions` is EXPERIMENTAL_UNPROVEN — the provider is only told
  speaker/length/side while the server computes its own coordinates, so it is
  not promoted and cannot report text-inside-balloon proof.
- Diagnostic axes are isolated server-side: `semantic_ladder` and
  `blank_balloon_hybrid` both reject any non-`normal` reference isolation or
  visual-context override (400), so one experiment = one variable.
- Semantic ladder results: the primary result owns the moderation boundary
  (`SEMANTIC_BOUNDARY_OWNER=PRIMARY_RESULT`, `PRIMARY_BOUNDARY=PASS|BLOCKED`),
  and Tier-2 recovery is reported separately (`TIER2_SAFE_RECOVERY=PASS|FAIL`).
  A blocked primary with a successful Tier-2 is never reported as `L7 PASS`.
- Text completeness audit: admin diagnostics expose expected/detected/inserted/
  missing text-region counts and `TEXT_INSERTION_COMPLETE`
  (`inserted === expected`). Hybrid is not promoted to normal-user production
  while incomplete.
- Normal users cannot activate either diagnostic mode; normal production requests
  retain the existing overlay-first path.

Every diagnostic request logs only semantic level, prompt hash, reference-set
signature, attempt/result metadata, semantic boundary owner, safety categories,
provider request id, and usage evidence. Prompt text, source prose, reference
URLs, and reference bytes are not included.

## Human QA gate

Do NOT start the semantic ladder first. Compare a normal production-overlay
result (A) with a blank-balloon hybrid result (B) from the same safe source
scene. B must use `local_image_detection` with reference isolation = Normal and
visual context = Normal. Only COMPOSITION_OWNER, BALLOON_GEOMETRY_OWNER, and
TEXT_INSERTION_OWNER may differ between A and B. Review panel composition, shot
variety, identity, scene fidelity, facial reaction, balloon naturalness, subject
occlusion, text-inside-balloon, dialogue readability, speaker attribution, and
manga likeness. The implementation does not self-score those dimensions. After
hybrid quality is proven, run the semantic ladder one level at a time.
