# Current 1:1 OOC / adult / HTML turn structure

Audit-only. Production code was not changed for this document.
Read from current `main` (`3f4eca0`) on branch `audit/ooc-scene-renderer-deepseek-vs-muse`.

## Work types already in production

| Type | Current owner | Current model path |
|---|---|---|
| A. 일반 RP | selected model + `decideAdultModelRoute` | user picker / general |
| B. 일반 RP에서 이어지는 성인 장면 | `classifySceneMode` + `decideAdultModelRoute` + source-aware handoff | adult model (`deepseek-v4-pro-0813`) |
| C. OOC로 RP 진행 방향 조종 | `classifyChatOocIntent` → `rp_continuing` / `rp_scene_reset` / `rp_hard_stop` | same as A/B |
| D. OOC 독립 장면 생성 | **no dedicated type** | currently falls into C, sometimes E |
| E. HTML 전용 | `isHtmlFlashOnlyTurn` / `chatOocRpUnrelated` | `deepseek-v4-flash` |

There is no `OOC_SCENE_RENDER_ONLY` / `generationKind=ooc_scene_render` today.

## 1. OOC intent is not a model router

Owner: `src/lib/chatOocPriority.ts`

`ChatOocIntent = "none" | "rp_continuing" | "rp_scene_reset" | "rp_unrelated" | "rp_hard_stop"`

| Intent | Meaning | Prompt owner |
|---|---|---|
| `none` | no OOC marker | raw user message |
| `rp_continuing` | OOC steers current RP | `buildChatOocRpContinuingUserPrompt` |
| `rp_scene_reset` | close previous physical scene, start new episode | `buildChatOocSceneResetUserPrompt` |
| `rp_unrelated` | HTML/UI/alt-world/no-narration | HTML Flash path |
| `rp_hard_stop` | stop RP, do not start a new one | general route, extras suppressed |

`OOC` marker itself is not a stop. Ambiguous OOC defaults to **`rp_continuing`** (fail-closed).

`chatOocSuppressesUserNoteExtras()` is true for `rp_unrelated` **or** `rp_hard_stop`.

Critical coupling in `src/app/api/chat/route.ts`:

```ts
const chatOocRpUnrelated = chatOocSuppressesUserNoteExtras(storedUserMessage);
const htmlFlashOnlyTurn =
  chatOocRpUnrelated || isHtmlFlashOnlyTurn(storedUserMessage);
```

Any `rp_unrelated` **or** `rp_hard_stop` currently skips the main RP model and goes to **HTML Flash**.
English `what-if` / parallel / 외전 can become HTML-only, not prose.

Korean “만약/가정/샘플 장면/본편과 별개/RP에는 반영하지 말고” is **not** in `RP_UNRELATED_ALT_SCENE`.
Those strong render-only examples currently classify as **`rp_continuing`** → main/adult path → **canon/adult-state contamination**.

`RP_CONTINUING_HINT` includes `이 장면`, so even a sentence like “이 장면은 본편이 아니다” can look like continuing RP.

## 2. Named symbols

### Present

| Symbol | File | Role |
|---|---|---|
| `classifySceneMode()` | `src/lib/adultSceneRouting.ts` | scene / adult / oocIntent / sceneReset / hardStop |
| `decideAdultModelRoute()` | same | general vs adult + sticky |
| `transientAdultCapableRoute` | same | one-turn adult model for OOC explicit-anatomy reaction; not sticky |
| `ooc_explicit_anatomy_reaction` | same | classification `reason` |
| `sceneReset` / `hardStop` | same + `chatOocPriority.ts` | `rp_scene_reset` / `rp_hard_stop` |
| `resolveAdultHandoffTargetModelId()` | `src/lib/adultHandoffSourceRouting.ts` | source-aware adult target |
| `adultHandoffSourceModelId` | `ModelRouteState` + `route.ts` | persisted source for handoff |
| `adultHandoffTargetModelId` | same | persisted actual adult target |
| `isHtmlDisplayOnlyTurn()` | `src/lib/htmlDisplayOnlyTurn.ts` | display-input HTML |
| `isOocCreativeHtmlTurn()` | same | OOC + RP stop + HTML UI |
| `isHtmlFlashOnlyTurn()` | same | either of the above |
| `advanceModelRouteState()` | `src/lib/adultSceneRouting.ts` | after every finalized turn |

`adultSceneOocRouting.ts` does **not** exist as a production owner. Only `adultSceneOocRouting.test.ts` covers OOC scene-reset + anatomy-reaction cases.

### How the named adult fields interact

`classifySceneMode()` now calls `classifyChatOocIntent()` first.

- `hardStop` → sceneMode normal, no adult, reason `ooc_hard_stop`
- `rp_scene_reset` → previous scene treated as `normal`, recent raw cleared
- `ooc_explicit_anatomy_reaction` + `rp_continuing`/`rp_scene_reset` + no current sexual context → `transientAdultCapableRoute=true` and `sexualContextActive=false`
- `advanceModelRouteState()` returns to general and does **not** stick adult / minimum turns when transient and the output did not newly establish sexual context

This is **not** render-only. Transient adult is still a real RP turn (especially scene-reset + continue). The shower/reset example in the brief is this path, not D.

## 3. Adult handoff

Owners:

- `src/lib/adultSceneRouting.ts`
- `src/lib/adultHandoffSourceRouting.ts`
- `src/lib/adultHandoffDisplay.ts`

Adult model: `env.ADULT_MODEL_ID` or `CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL`.
On this tree that constant is **`deepseek-v4-pro-0813`**.
This audit must not change `ADULT_MODEL_ID`.

Source-aware targets today:

- Opus / Gemini 3.1 → `qwen-3-8-max`
- Gemini 3.7 Flash → `deepseek-v4-pro` (normalized to 0813)
- otherwise existing adult model

Public receipt (`src/lib/billingReceiptAccess.ts` + `adultHandoffDisplay.ts`):
if `adultRouting.activeRoute === "adult"`, public `model` / `modelLabel` / `selectedAI` / `provider`
are overwritten to **user-selected** (#439).
Admin keeps actual model in DB `adultRouting`.

`usage.adultRouting` fields today:

- `requestedModel`
- `actualModel`
- `userSelectedModel`
- `userSelectedModelLabel`
- `userSelectedProvider`

`adultHandoffSourceModelId` / `adultHandoffTargetModelId` live on `ModelRouteState`, not as those exact names on `usage`.

## 4. HTML-only dedicated path (reuse candidate)

Owner: `src/lib/htmlDisplayOnlyTurn.ts` + `src/app/api/chat/route.ts`
Generator: `generateHtmlVisualCardWithFlash`

Dedicated model: `CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL` = `deepseek-v4-flash`  
Public label: `HTML_ONLY_MODEL_LABEL` = `"HTML전용모델"` in `src/lib/htmlVisualCardRecovery.ts`

Billing: `computeHtmlFlashOnlyTurnBilling()` in `src/lib/points.ts`

- actual Flash API tokens when present
- 55% margin via DeepSeek margin owner
- not a fake flat price
- deprecated 10P/1000-token helpers exist; do **not** copy HTML price policy

Receipt pattern to reuse:

- `usage.model` = actual slug (`deepseek-v4-flash`)
- `usage.modelLabel` = `"HTML전용모델"`
- `usage.htmlFlashOnly: true`
- `usage.selectedAI` stays user picker
- public sanitize does **not** overwrite HTML actual model the same way adult handoff does

HTML skips:

- main OpenRouter / Cheaper Inference RP stream
- suggested replies (`!htmlFlashOnlyTurn`)
- Muse acceptance telemetry

HTML does **not** currently skip:

- `advanceModelRouteState` after finalize
- assistant message persist into raw history
- `commitSceneProgressionState`
- episodic persist when `derivedStateAllowed`
- some memory/status paths unless separately gated by `chatOocRpUnrelated`

So HTML is a reuse candidate for **dedicated generation + billing + public label + suggested-reply skip**, not for full noncanonical isolation.

## 5. Memory / side effects

| System | Owner | Current gate |
|---|---|---|
| Episodic facts | `reconcileEpisodicMemoryFactsForGeneration` | `derivedStateAllowed` only |
| Long-term summary | memory summary jobs | post-hoc `classifyMemoryTurnScope` |
| Status widget | status extract | skipped when `chatOocRpUnrelated` |
| Status triggers | `status_trigger_events` | not generation-kind gated |
| Relationship meta | dock / extract | not generation-kind gated |
| Suggested replies | `scheduleSuggestedRepliesExtraction` | skipped for HTML-only |
| Scene momentum | `commitSceneProgressionState` | after finalize |
| Adult sticky | `advanceModelRouteState` | after every finalized turn |
| Memory scope | `src/lib/memory/memory-summary-scope.ts` | `noncanon` / `meaningful_noncanon` for IF/이프/번외/가상 상황/what-if |

`scopesInjectedIntoPrompt` = `main_canon | branch_canon | preference` only.
This is **post-generation classification**, not a generation-kind gate.

`MEANINGFUL_NONCANON_RE` does **not** include `본편과 별개` / `가정 상황` / `RP에는 반영하지` / `샘플 장면`.
A strong Korean render-only OOC without IF/번외/가상 상황 currently classifies as **`main_rp`**.

A `rp_continuing` render-only turn still updates ModelRouteState / adult sticky / episodic persist unless skipped.

## 6. Message schema

`messages.usage` is TEXT JSON. There is **no** `generation_kind` column.
`messages.adult_route_meta_json` exists for adult routing.
`generation_status` exists for finalize/partial.

Minimum noncanonical marker, no migration:

```json
{
  "generationKind": "ooc_scene_render",
  "canonical": false,
  "model": "<actual renderer slug>",
  "modelLabel": "OOC 장면 전용",
  "selectedAI": "<user picker>",
  "oocSceneRender": {
    "requested": true,
    "actualRendererModel": "<slug>",
    "provider": "cheaperinference"
  }
}
```

Do not overwrite billing `usage.model` with the public label.

Display/regen/receipt can keep the assistant row.
Next-RP raw-history assembly must filter `generationKind=ooc_scene_render`.

## 7. Length owner

`DEFAULT_TARGET_RESPONSE_CHARS = 3200` in `src/lib/responseLengthConstants.ts`.
`assembleBundle` / `buildContext` already pass `targetResponseChars: 3200`.
Do not add new length / paragraph-count / dialogue% prompts.

Production DeepSeek temperature owner is `0.92`. This bake-off uses **0.7 for both models** so the comparison is the common renderer contract, not DeepSeek's production temperature adapter.

## 8. Why a dedicated D path may be warranted

Strong Korean render-only OOC currently:

1. classifies as `rp_continuing` (fail-closed, correct for C)
2. can trigger adult handoff if sexual, including sticky adult
3. persists as the next raw-history event
4. advances ModelRouteState / adult sticky unless it happens to be transient anatomy-reaction
5. can contaminate episodic / LTM / status / relationship
6. memory scope often treats it as `main_rp`

English what-if currently can become HTML Flash (`rp_unrelated`), which is the wrong renderer for a novel-form scene.

So D is not “all OOC”. D is the missing third path between C and E.

## 9. Do not merge D with scene-reset continue

This is actual RP, not render-only:

```
OOC:
기존 RP 종료.
새 에피소드 시작.
라이크가 샤워 중이고 렌이 들어오는 장면부터 시작해.
```

Current classification: `rp_scene_reset` + possible `ooc_explicit_anatomy_reaction` / adult handoff.
Next turn may continue as real RP. Source-aware adult handoff stays.

`OOC_RENDER_ONLY` = one-turn specialized render  
`OOC_RESET_AND_CONTINUE` = actual RP

## 10. Live classification probe (no extra generation)

See `CLASSIFICATION_PROBE.json`. Proposed `resolveOocSceneRenderIntent` is audit-only.

| Example | Current `classifyChatOocIntent` | Memory scope | Proposed D |
|---|---|---|---|
| 지금 장면 계속해 | `rp_continuing` | `main_rp` | not_render_only |
| 좀 더 코믹하게 진행해 | `rp_continuing` | `main_rp` | not_render_only |
| 말투를 더 능글맞게 해 | `rp_continuing` | `main_rp` | not_render_only |
| 기존 RP 종료 | `rp_hard_stop` | `main_rp` | not_render_only |
| 기존 RP 종료하고 새 에피소드 시작 | `rp_scene_reset` | `main_rp` | not_render_only |
| 이 장면부터 새로운 RP 시작 | `rp_continuing` | `main_rp` | not_render_only |
| 현재 상황에서 성인 장면으로 이어지게 해 | `rp_continuing` + intimate_transition | `main_rp` | not_render_only |
| 기존 RP 종료 + 새 에피소드 + 샤워 장면부터 | `rp_scene_reset` | `main_rp` | not_render_only |
| 반응을 보여줘 | `rp_continuing` | `main_rp` | not_render_only |
| 장면을 출력해줘 | `rp_continuing` | `main_rp` | not_render_only |
| Case A/B/C strong isolation | `rp_continuing` | `main_rp` | **ooc_scene_render_only** |

Case C (explicit sample) currently classifies as `sceneMode=normal`. A standalone explicit OOC sample can stay on the general model today, then still contaminate canon if the output is sexual.

`rp_hard_stop` is not `isHtmlFlashOnlyTurn`, but `route.ts` still sets `htmlFlashOnlyTurn` via `chatOocSuppressesUserNoteExtras`.
