# Comic quality reset audit — full provider-rendered comic

Status: dev-stage simplification. No merge or deploy.

## Product decision (NEW)

The final comic is the GPT-Image-2 provider output itself — a complete,
readable manhwa page. The provider owns 4-panel composition, camera, staging,
facial reactions, speech balloons, balloon tails, Korean dialogue, narration
boxes, SFX text, and manga direction. The server performs no text postprocessing
for the comic final image. Imperfect Korean typography is acceptable; natural
comic direction is prioritized over text fidelity.

## Owner map (post-reset, user-facing production path)

| Owner | Current implementation |
| --- | --- |
| `SCENE_SOURCE_OWNER` | `resolveSceneSource()` in `src/app/api/chat/comic-generation/route.ts`, sanitized in `src/lib/chatImageScenePlan.ts` |
| `SCENEPLAN_OWNER` | `ScenePlan` / `resolveApprovedScenePlan()` — beat, speaker ownership, exact approved Korean text |
| `CAST_IDENTITY_OWNER` | subject map, cast manifest bindings, gender lock, identity ownership manifest |
| `PROVIDER_PROMPT_OWNER` | `buildChatComicGenerationPlan()` → `buildChatComicImagePrompt()` (`full_provider_rendered`) |
| `FULL_COMIC_TEXT_OWNER` | the provider prompt carries the exact approved dialogue / narration / SFX as readable Korean text |
| `SPEECH_BUBBLE_OWNER` | provider-rendered balloons + tails (no server body) |
| `NARRATION_OWNER` | provider-rendered narration boxes (no server box) |
| `SFX_OWNER` | provider-rendered SFX text (no server SFX) |
| `SERVER_OVERLAY_OWNER` | removed from the production path — `assembleComicFinalImage()` returns the provider buffer as-is |
| `FINAL_IMAGE_PERSISTENCE_OWNER` | `fs.writeFile(savedPath, providerBuffer)` + WebP re-encode in `generateComicImage()` |
| `SETTLEMENT_OWNER` | `settleChatImageGenerationResult()` — success-only, unchanged |

Reported values: `CURRENT_SERVER_TEXT_POSTPROCESS_PRESENT: false`,
`CURRENT_PROVIDER_READABLE_TEXT_EXPECTED: true`,
`TARGET_SERVER_TEXT_POSTPROCESS_PRESENT: false`,
`TARGET_PROVIDER_READABLE_TEXT_EXPECTED: true`.

## Retired from the user-facing production path

- `overlay_first` final rendering branch (server-created bubble/narration/SFX)
- `blank_balloon_hybrid` text insertion + `local_image_detection` + `shared_anchor_regions`
- server text wrapping / text-only SVG composite for the comic final image
- server balloon slot / text-completeness insertion logic for final rendering

The related lib code (`chatComicTextOverlay*`, detection, balloon metadata) is
retained test-only and is no longer called by the comic production route. The
old experimental UI controls (hybrid mode, text-insertion strategy, anchor
strategy, blank-balloon result audit) are removed.

## ScenePlan is beat-oriented, not geometry-forcing

The planner passes panel beat, who speaks, exact dialogue text, optional
narration/SFX, emotional beat, important action, and panel narrative role. The
full-provider panel spec does NOT prescribe camera angle, framing, left/right
layout, or negative-space coordinates — GPT owns pose, camera, balloon
position/size, tail geometry, and negative-space arrangement.

## Admin-only diagnostics

- `semantic_ladder` (V axis `L0`–`L8`) stays admin-only and source-free.
- TEXT × VISUAL moderation matrix: `comicTextBoundaryLevel` (T axis `T0`–`T4`)
  injects one fixed dialogue fixture into panel 1 of the ladder scene. One
  request probes one specific (V, T) cell. Admin-only; raw prompt / raw source /
  reference URLs / reference bytes are never stored in logs.
- The semantic ladder provider prompt now uses the full provider-rendered
  contract (no server text insertion assumption).
- Diagnostic isolation still requires normal reference / visual-context axes for
  ladder and hybrid probes.

Every diagnostic request logs only semantic level, text-boundary level, prompt
hash, reference-set signature, attempt/result metadata, semantic boundary owner,
safety categories, provider request id, and usage evidence.

## Human QA gate

Run FULL PROVIDER-RENDERED COMIC NORMAL first (readable dialogue / narration /
SFX rendered by GPT), then the TEXT × VISUAL boundary matrix one cell at a time.
Review panel composition, shot variety, identity, scene fidelity, facial
reaction, balloon naturalness, subject occlusion, dialogue readability, speaker
attribution, and manga likeness. The implementation does not self-score those
dimensions.