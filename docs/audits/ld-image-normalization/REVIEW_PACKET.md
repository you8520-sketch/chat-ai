# LD Image Generator Normalization — Review Packet

**CURRENT_MAIN_SHA:** `c353a8fd98330748c3f00e375ecf95af75283ef2`  
**PR_NUMBER:** 808  
**PR_HEAD_SHA:** (see branch `cursor/comic-panel-spec-compiler-4a39` after push)

## BEFORE

### USER_VISIBLE_PROBLEM
- LD 장면 설명(`heroScene`, panel `situation`)에 대사·장황한 raw chat이 그대로 노출
- 한 장/컷만화 선택이 UI 하단에 있어 one-click flow가 어려움
- 컷만화 final prompt가 generic panel-index camera/emotion template에 의존

### DETERMINISTIC_REPRODUCTION
Fixture: `sampleMessages()` in `chatImageScenePlan.test.ts`

**Before fix:**
```
heroScene: "후드 귀를 만진다 같이 갈래? 렌이 후드를 만지자 태형이 고개를 돌렸다. 그래. 태형이 자리에서 일어난다."
panel1.situation: includes "같이 갈래?"
```

**After fix:** dialogue only in `panel.dialogue[]`; visual fields exclude spoken text.

### ROOT_CAUSE
`buildDeterministicScenePlan`, `panelFromEvents`, and `validateScenePlan` situation/heroScene fallbacks joined **all** event texts including `kind=dialogue`. UI reads `plan.heroScene` and `panel.situation` directly as user-facing 장면 설명.

### PAST_FIX_AUDIT
| Past change | Still in code? | On LD path? | Why ineffective |
|---|---|---|---|
| `formatApprovedScenePlanForIllustration` dialogue separation | Yes | Final prompt only | UI shows raw `heroScene`, not formatter output |
| `stripChatTurnMarkup` / source sanitization | Yes | Source ingest | Does not split dialogue from visual description |
| Manual-first (#681) deterministic plan on open | Yes | Yes | Plan builder still concatenated dialogue into heroScene |
| PR #808 panel-spec compiler | Yes | Comic final prompt | Upstream plan still contained dialogue in situation |

## OWNER_MAP

| Owner | Canonical module |
|---|---|
| CHAT_IMAGE_SOURCE_OWNER | `buildSceneSourceMessages`, `extractDeterministicEvents` |
| SCENE_DESCRIPTION_OWNER | `buildUserFacingVisualDescription`, `normalizeUserFacingSceneDescription` |
| SCENE_PLANNER_OWNER | `planChatImageScene` (`chatImageScenePlanner.ts`) |
| SCENE_PLAN_VALIDATION_OWNER | `validateScenePlan` |
| REQUESTED_PANEL_COUNT_OWNER | `ChatImageGeneratorPanel` `scenePanelCount` state |
| PANEL_GROUPING_OWNER | `groupEventsContiguously`, `reflowScenePlanPanels` |
| COMIC_VISUAL_PLANNING_OWNER | `compileChatComicPanelSpec` |
| USER_SCENE_EDIT_OWNER | `applyUserIllustrationEdits`, `applyUserPanelEdits` |
| DIALOGUE_OWNER | `ScenePanel.dialogue[]` |
| SFX_OWNER | None (empty `sfx: []` not treated as system) |
| CAST_OWNER | `chatImageCast`, `chatImageCastManifest` |
| EVENT_SUBJECT_BINDING_OWNER | `validateCastMentions` actorEventIds |
| CHARACTER_REFERENCE_OWNER | `bindChatImageReferencePack` |
| SINGLE_ILLUSTRATION_PROMPT_OWNER | `chatLdIllustrationGeneration` |
| COMIC_PROMPT_OWNER | `buildChatComicImagePrompt` + `buildChatComicPanelSpecPromptSection` |
| FINAL_IMAGE_REQUEST_OWNER | `/api/chat/comic-generation`, `/api/chat/image-generation` |
| IMAGE_GENERATOR_UI_MODE_OWNER | `ChatImageGeneratorPanel` `sceneOutputMode` |
| IMAGE_GENERATOR_UI_STATE_OWNER | `ChatImageGeneratorPanel` scene state |
| ADMIN_DIAGNOSTICS_OWNER | `TrpgImageSceneDiagnosticsPanel` |

## AFTER

### USER_FLOW_BEFORE
LD 열기 → 캐스트/AI 제안/편집 필드 → (하단) 형식 선택 → (하단) 컷 수 → 생성

### USER_FLOW_AFTER
LD 열기 → **한 장 일러스트 | 컷만화** → (컷만화) **2|3|4컷** → 자동 미리보기 → (선택) 장면 수정 → 생성

### SCENE_DESCRIPTION_CONTRACT
- **Canonical source:** chat events (unchanged)
- **User-facing:** visual-only via `buildUserFacingVisualDescription`
- **Dialogue:** `panel.dialogue[]` only
- **Final prompt:** existing formatters + COMIC PANEL SPEC compiler

### ADDITIONAL_MODEL_CALLS
| | Count |
|---|---|
| BEFORE (modal open) | 0 |
| AFTER (modal open) | 0 |
| BEFORE (generate) | 0–1 scene planner if user clicks AI 제안 |
| AFTER (generate) | unchanged |

**PROVIDER_ROUTING_CHANGED:** No  
**PRICING_CHANGED:** No

## Representative fixtures

### Single illustration — CASE A
**RAW SOURCE:** `태현이 렌의 손목을 붙잡고 "가지 마."라고 말했다.`  
**USER-FACING SCENE DESCRIPTION:** `태현이 렌의 손목을 붙잡고 라고 말했다.` (no `가지 마`)  
**DIALOGUE:** in panel dialogue when present in multi-event turns

### 2-panel comic — sampleMessages
**USER-FACING panel 1 situation:** visual beats only  
**EXPECTED DIALOGUE:** `같이 갈래?`, `그래.` in speech bubble fields  
**FINAL PROMPT:** includes `COMIC PANEL SPEC` with scene-derived camera/expressions

## Audit counters (from tests)
- DUPLICATE_OWNER_COUNT: 0 new owners added
- SCENE_DESCRIPTION_DIALOGUE_LEAK_COUNT: 0 (post-fix deterministic fixtures)
- ADDITIONAL_MODEL_CALLS_AFTER: 0 on open

## GPT_SCORE: PENDING
## HUMAN_SCORE: PENDING

## COMPLETION_STATUS
**ROOT_CAUSE_FIXED**
