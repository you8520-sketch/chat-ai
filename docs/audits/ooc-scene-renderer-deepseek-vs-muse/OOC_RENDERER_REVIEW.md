# OOC Scene Renderer audit / bake-off

Audit only. Production routing, billing, picker, `ADULT_MODEL_ID`, memory, and HTML path were not changed.
6 generation calls. retry / continuation / recovery / fallback = 0.
Qwen excluded. No #427 source RAW style anchors.

## Verdict block

```
CURRENT_OOC_ROUTING: classifyChatOocIntent = none|rp_continuing|rp_scene_reset|rp_unrelated|rp_hard_stop; OOC marker is not a router; ambiguous OOC fail-closes to rp_continuing; rp_unrelated|rp_hard_stop couple into HTML Flash in route.ts
CURRENT_HTML_DEDICATED_MODEL: deepseek-v4-flash (CHEAPER_INFERENCE_DEEPSEEK_V4_FLASH_MODEL); public label HTML전용모델
CURRENT_HTML_RECEIPT_BEHAVIOR: usage.model=actual flash slug; usage.modelLabel=HTML전용모델; usage.htmlFlashOnly=true; selectedAI stays picker; public sanitize does not apply adult-handoff identity overwrite
OOC_RENDER_INTENT_DESIGN: new fail-closed resolver resolveOocSceneRenderIntent() beside classifyChatOocIntent; do not add a 5th ChatOocIntent that hijacks C/E; require >=2 isolation signals + one-turn render signal; block scene-reset / continue / weak “반응을 보여줘”
NONCANONICAL_STORAGE_DESIGN: usage.generationKind="ooc_scene_render" + usage.canonical=false + usage.modelLabel="OOC 장면 전용"; keep usage.model=actual slug; no DB migration
MEMORY_CONTAMINATION_GUARDS: required skips listed below; current memory noncanon regex does not catch 본편과 별개/가정 상황/샘플 장면
DEEPSEEK_CASE_A_SCORE: 31/40
DEEPSEEK_CASE_B_SCORE: 36/40
DEEPSEEK_CASE_C_SCORE: 31/40
DEEPSEEK_AVG: 32.67/40
MUSE_CASE_A_SCORE: 27/40
MUSE_CASE_B_SCORE: 33/40
MUSE_CASE_C_SCORE: 34/40
MUSE_AVG: 31.33/40
DEEPSEEK_AVG_COST: 0.006092 USD
MUSE_AVG_COST: 0.020554 USD
DEEPSEEK_GENERIC_VOICE_RATE: 1/3
MUSE_GENERIC_VOICE_RATE: 0/3
OOC_RENDERER_WINNER: INCONCLUSIVE
PRODUCTION_IMPLEMENTATION_RECOMMENDED: false
IMPLEMENTATION_FILES_EXPECTED: src/lib/oocSceneRender.ts; src/lib/chatOocPriority.ts (call-site only); src/lib/chatUsage.ts; src/lib/billingReceiptAccess.ts; src/lib/billingDisplay.ts; src/app/api/chat/route.ts; history-assembly filter; tests. Do not touch ADULT_MODEL_ID / picker / HTML billing policy
DB_MIGRATION_REQUIRED: false
BILLING_REUSE_PATH: computeTurnBilling() with actual renderer model + authoritative API tokens / usage.cost; not computeHtmlFlashOnlyTurnBilling; not a new flat price
HTML_REUSE_PATH: dedicated generation skip + actual-model/public-label split + suggested-reply skip. Do not reuse Flash model, 55% HTML margin, or rp_unrelated→HTML coupling
SIDE_EFFECT_AUDIT: see checklist
MISSING_RISKS: next-RP raw-history filter; regen kind preserve; hard_stop currently HTML-coupled; Case C today classifies as sceneMode=normal; HTML path still advances ModelRouteState
TOTAL_NEW_API_CALLS: 6
PRODUCTION_CHANGED: false
MAIN_MERGED: false
RAILWAY_DEPLOYED: false
```

## Why D is warranted even without a model winner

Strong Korean render-only OOC (Cases A/B/C) currently:

1. `classifyChatOocIntent` → `rp_continuing`
2. `classifyMemoryTurnScope` → `main_rp`
3. `isHtmlFlashOnlyTurn` → false
4. Case C explicit sample → `sceneMode=normal` (no adult route from the OOC text alone)
5. Output still persists as the next raw-history event and can advance ModelRouteState / episodic / status

Weak phrases and real RP commands stay on existing C/reset/stop/adult paths. The audit-only probe was fail-closed: all 10 negatives were `not_render_only`; only A/B/C fired.

Do not merge D with:

```
OOC: 기존 RP 종료. 새 에피소드 시작. 라이크가 샤워 중이고 렌이 들어오는 장면부터 시작해.
```

That is `rp_scene_reset` + possible later adult handoff. Actual RP.

## Bake-off setup

- Character: production 라이크 / 조태형 (`id=18`)
- Persona: production 렌
- History: `[채팅 시작]` + greeting only
- No #427 source assistant RAW
- Common renderer contract only; no Muse M1 / DeepSeek XML / Qwen adapter
- Assemble model: `glm-5.2` then swap request model
- Temperature 0.7 both (production DeepSeek owner is 0.92; not used here)
- Length owner: existing 3200-char aim, no new length/ratio prompt
- Models: `deepseek-v4-pro-0813`, `muse-spark-1.2`

## Scores

Scale 1–5. Total /40. SOURCE_STYLE_FIDELITY excluded.

### DeepSeek A — 31/40

| Axis | Score | Note |
|---|---|---|
| CHARACTER_FIDELITY | 4 | Teasing swagger present; more composed than chaotic Like |
| SPEECH_LOCK_FIDELITY | 4 | Banmal + poke questions; “계획된 연출” is a bit polished |
| SCENARIO_COMPLIANCE | 5 | Slip / towel / door / comic beat |
| PROSE_QUALITY | 4 | Readable novel form |
| ADULT_SCENE_QUALITY | 4 | Comic nudity, not generic porn |
| ONE_TURN_COMPLETENESS | 4 | Ends on a beat; short (2219) |
| PARAGRAPH_COHESION | 3 | 24 paras / 2219 |
| WORLD_CANON_USAGE | 3 | 숙소 only |

Binaries: all no. No OOC echo.

### Muse A — 27/40

| Axis | Score | Note |
|---|---|---|
| CHARACTER_FIDELITY | 3 | Collapses into generic fluster; text says usual voice is gone |
| SPEECH_LOCK_FIDELITY | 3 | Some “푸하” recovery, lots of panic stock |
| SCENARIO_COMPLIANCE | 5 | Full farce |
| PROSE_QUALITY | 3 | Overlong one-liners |
| ADULT_SCENE_QUALITY | 3 | Embarrassed-comedy template |
| ONE_TURN_COMPLETENESS | 5 | Complete recovery |
| PARAGRAPH_COHESION | 2 | 54 paras |
| WORLD_CANON_USAGE | 3 | Light 센티넬 joke |

`CHARACTER_VOICE_LOSS=true`. Invents Ren door / gaze decisions.

### DeepSeek B — 36/40

| Axis | Score | Note |
|---|---|---|
| CHARACTER_FIDELITY | 5 | Lazy, teasing, stays Like under sensory hit |
| SPEECH_LOCK_FIDELITY | 5 | Closest to example-dialog register |
| SCENARIO_COMPLIANCE | 5 | Briefing + guiding-wave sensitivity |
| PROSE_QUALITY | 4 | |
| ADULT_SCENE_QUALITY | 4 | Sensory, not porn catalog |
| ONE_TURN_COMPLETENESS | 5 | |
| PARAGRAPH_COHESION | 3 | 39 paras |
| WORLD_CANON_USAGE | 5 | 가이딩 / 게이트 / 폭주 전조 |

Best output in the bake-off.

### Muse B — 33/40

| Axis | Score | Note |
|---|---|---|
| CHARACTER_FIDELITY | 4 | Strong opening; later more eroticized |
| SPEECH_LOCK_FIDELITY | 4 | 능글 + “푸하”; some breathless stock |
| SCENARIO_COMPLIANCE | 5 | |
| PROSE_QUALITY | 4 | |
| ADULT_SCENE_QUALITY | 4 | |
| ONE_TURN_COMPLETENESS | 5 | |
| PARAGRAPH_COHESION | 2 | 57 paras |
| WORLD_CANON_USAGE | 5 | 전자 초커, 조아인 가이딩, 홀로그램 |

Invents Ren head-touch / skull wrap.

### DeepSeek C — 31/40

| Axis | Score | Note |
|---|---|---|
| CHARACTER_FIDELITY | 3 | Aftercare is Like; mid-scene generic dominant |
| SPEECH_LOCK_FIDELITY | 3 | “입 벌려” / “내 이름 불러 봐” |
| SCENARIO_COMPLIANCE | 5 | Complete explicit, no fade |
| PROSE_QUALITY | 4 | |
| ADULT_SCENE_QUALITY | 4 | Complete; some canon prefs; template commands |
| ONE_TURN_COMPLETENESS | 5 | |
| PARAGRAPH_COHESION | 4 | 28 paras / 3567, best cohesion |
| WORLD_CANON_USAGE | 3 | 에이지스 then generic bedroom |

`GENERIC_ADULT_VOICE=true`, `CHARACTER_VOICE_LOSS=true`.
No refusal / fade / consent stall.
Puppets Ren mouth / name / climax beyond allowed physical reactions.
`outputTokens=9910` vs 3567 visible — hidden reasoning likely unreported (`reasoningTokens=null`).

### Muse C — 34/40

| Axis | Score | Note |
|---|---|---|
| CHARACTER_FIDELITY | 4 | Keeps 능글 longer; aftercare “잘했어. 오늘 진짜 예뻤어.” |
| SPEECH_LOCK_FIDELITY | 4 | More Like dialogue than DeepSeek C |
| SCENARIO_COMPLIANCE | 5 | |
| PROSE_QUALITY | 4 | |
| ADULT_SCENE_QUALITY | 5 | Uses Like sexual canon (28cm, 3회, 딥쓰롯, 결장, 유두, 머리채, aftercare) |
| ONE_TURN_COMPLETENESS | 5 | |
| PARAGRAPH_COHESION | 3 | 44 paras |
| WORLD_CANON_USAGE | 4 | 숙소 의상 / 향수 / 방음 |

No fade/refusal. Invents Ren “자발적으로 벌려 물었다”.

## Cost / latency

| | DeepSeek | Muse |
|---|---|---|
| AVG_COST | 0.006092 | 0.020554 |
| AVG_COST_PER_1000_VISIBLE_CHARS | 0.002182 | 0.004254 |
| AVG_LATENCY_MS | 94029 | 45425 |
| AVG_CHARS | 2943 | 4982 |
| AVG_TTFT_MS | 63036 | 13124 |

Muse is ~2× faster and ~3.4× more expensive. Winner is not cost-only.

## Why INCONCLUSIVE

DeepSeek wins A and B (character / speech / cohesion). Muse wins C (adult completeness / less generic mid-scene voice).
Average gap is 1.34 points. Case deltas are +4 / +3 / −3, not a sweep.
Neither holds character across all three fixtures:

- Muse A: `CHARACTER_VOICE_LOSS`
- DeepSeek C: `GENERIC_ADULT_VOICE` + `CHARACTER_VOICE_LOSS`

Priority 1–2 favor DeepSeek, but the explicit fixture reverses. Per the brief, do not declare a winner on a thin split, and do not auto-tune prompts.

`OOC_RENDERER_WINNER = INCONCLUSIVE`  
`PRODUCTION_IMPLEMENTATION_RECOMMENDED = false`

A later n>1 bake-off may revisit DeepSeek first. No prompt tuning in this PR.

## Minimum implementation design (do not apply now)

Keep existing owners. Do not duplicate `classifyChatOocIntent`.

```
resolveOocSceneRenderIntent(userMessage)
  -> "ooc_scene_render_only" | "not_render_only"

resolveOocSceneRendererModel()
  -> locked internal renderer id (not a picker item)

buildOocSceneRendererPrompt(...)
  -> common contract + existing assembleBundle length owner
```

Suggested file: `src/lib/oocSceneRender.ts` as single owner.
`chatOocPriority.ts` stays the RP-progress classifier.
Call order in `route.ts`:

1. existing `classifyChatOocIntent`
2. if `rp_scene_reset` or `rp_hard_stop` → never D
3. if HTML-only → existing E
4. only then `resolveOocSceneRenderIntent`
5. fail-closed: isolation cluster ≥2 AND one-turn render signal AND no progress/reset blocker
6. weak “반응을 보여줘” / “장면을 출력해줘” alone → existing C

Do not send all OOC to the renderer.

### Receipt

Adult handoff (#439): keep user-selected public identity.
OOC renderer: public `modelLabel = "OOC 장면 전용"` (display “사용 모델: OOC 장면 전용”).
Do **not** overwrite `usage.model` with that string.
Admin keeps `selectedModel`, `actualRendererModel`, `provider`, `generationKind`, tokens, cost.

### Billing

Not free.
Reuse `computeTurnBilling()` for the actual renderer model.
Authoritative API input / output / reasoning-if-billable / provider `usage.cost`.
If winner later is Muse → Muse pricing owner.
If DeepSeek → DeepSeek 0813 pricing owner.
Do not copy HTML Flash 55% policy.
Do not invent a flat price.
Do not expose margin / FX / raw upstream on the public receipt.

### HTML reuse vs must-not-copy

Reuse:

- skip main RP stream
- `usage.model` = actual slug
- `usage.modelLabel` = function label
- skip suggested replies (or decide separately)
- dedicated generator function

Do not reuse:

- Flash model
- HTML 55% margin
- `rp_unrelated` → HTML coupling
- HTML’s current `advanceModelRouteState` after finalize

### Noncanonical storage

No migration. Extend `messages.usage` JSON:

```json
{
  "generationKind": "ooc_scene_render",
  "canonical": false,
  "model": "<actual slug>",
  "modelLabel": "OOC 장면 전용",
  "selectedAI": "<picker>",
  "oocSceneRender": {
    "requested": true,
    "actualRendererModel": "<slug>",
    "provider": "cheaperinference"
  }
}
```

Visible assistant row. Regen/receipt allowed.
Next RP raw-history assembly must drop `generationKind=ooc_scene_render`.

## Side-effect audit

| Item | Current | Required for D | Status |
|---|---|---|---|
| status widget extraction | skip only if `chatOocRpUnrelated` | skip | MISSING |
| status trigger events | not kind-gated | skip | MISSING |
| episodic fact persist | `derivedStateAllowed` only | skip | MISSING |
| LTM canon update | post-hoc IF/번외 regex | skip / force noncanon and never inject | PARTIAL — regex misses 본편과 별개/샘플 |
| relationship meta | not kind-gated | skip | MISSING |
| suggested replies | skip HTML-only | skip or separate | PARTIAL |
| scene momentum | commit after finalize | skip | MISSING |
| adult sticky / min turns | `advanceModelRouteState` every turn | skip | MISSING |
| location/item/quest | derived-state path | skip | MISSING |
| canon seal / memory coverage | noncanon can later promote | never promote render-only | MISSING |
| next RP raw-history injection | always persist assistant | filter by generationKind | MISSING |
| regen | copies user message | keep generationKind | MISSING |
| delete/edit | standard | must not leave canon residue | MISSING |
| branch/fork | copies messages | copy marker, still noncanon | MISSING |
| creator reward | usage.model based | use actual model, not label | CHECK |
| admin telemetry | adultRouting / usage | add generationKind | MISSING |
| incomplete stream billing | existing | same actual-model billing | CHECK |
| fallback billing | adult fallback exists | D should not fallback into adult sticky | MISSING |
| public receipt sanitize | adult overwrites to picker; HTML keeps actual+label | D = HTML-like label, not adult overwrite | MISSING |

## Missing risks

1. `rp_hard_stop` already becomes HTML Flash via extras-suppress coupling.
2. Case C-like explicit samples can stay on the general model (`sceneMode=normal`) and still write sexual output into canon.
3. HTML-only turns already advance `ModelRouteState`. Copying HTML blindly would leak D into adult sticky.
4. Memory `noncanon` can later promote on seal. Render-only must be a harder non-promotable kind, or stay out of summary jobs entirely.
5. Regenerating a D turn without kind preserve would re-enter C/adult and contaminate.
6. Muse is not in `isCheaperInferenceModel()` today; a Muse winner would need transport registration without adding a picker item.

## Constraints kept

- Production route unchanged
- Winner not applied
- No new picker model
- `ADULT_MODEL_ID` unchanged
- Adult source-aware routing unchanged
- HTML routing unchanged
- Memory / billing production behavior unchanged
- main not merged
- Railway not deployed
