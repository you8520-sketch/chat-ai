# Adult fallback bake-off — GLM-5.3 vs DeepSeek V4 Pro (Phase F1)

Evidence-only RAW comparison. No prose score. No model ranking. No winner.

## Frozen production base

```text
EXPECTED_START_SHA: 165c50d04aa4fe1641794abd16e691b6f33c5f75
ACTUAL_ORIGIN_MAIN_SHA: fde06e144b8f77f8059c31491c1be8785405bd5b
MAIN_MOVED: true
MAIN_TIP_SUBJECT: fix(trpg): retry GM provider once on transient HTTP 5xx (#544)
PR_543: MERGED / PRODUCTION ADOPTED at 165c50d04aa4fe1641794abd16e691b6f33c5f75
BRANCH: cursor/adult-fallback-glm53-deepseek-bakeoff-fe23
```

H4 / H4.3 / H4.4 / H4.5 / H4.6 / S2 / length / repetition / prose tuning were not reopened.

## Discovered model IDs (do not invent)

Inspected `origin/main` (`fde06e14`) plus live CheaperInference `GET /v1/models`.

| Role | Exact ID | Provider | Where found |
|---|---|---|---|
| DeepSeek V4 Pro canonical outbound | `deepseek-v4-pro-0813` | CheaperInference `https://api.cheaperinference.com/v1` | `CHEAPER_INFERENCE_DEEPSEEK_V4_PRO_MODEL` in `src/lib/chatModels.ts`; catalog confirmed |
| Legacy stored DeepSeek id (do not send as new model) | `deepseek-v4-pro` | — | alias only; catalog still lists it |
| Production GLM hard-failure fallback | `glm-5.2` | CheaperInference | `CHEAPER_INFERENCE_GLM_52_MODEL`; `ADULT_SCENE_MODEL_POLICY.hardFailureFallbackModelId` |
| This bake-off GLM (user-specified, catalog-confirmed) | `glm-5.3` | CheaperInference | **Not present in production source.** Live catalog `id=glm-5.3` |
| Adult refusal-fallback target | `deepseek-v4-pro-0813` | CheaperInference | `AdultDeliveryPlan.fallbackModelId` / `ADULT_MODEL_ID` default |
| Typical Gemini handoff source | `gemini-3.7-flash` | CheaperInference | `resolveAdultHandoffModelForSource` → DeepSeek 0813 |

Production GLM routing is still `glm-5.2` (hard-failure only). This audit calls `glm-5.3` as specified and does not change routing.

## Adult fallback invocation path (unchanged)

1. `resolveAdultDeliveryPlan` prepares DeepSeek 0813 as `fallbackModelId`.
2. `buildContext({ ...contextBuildInput, modelId: adultFallbackModelId, preserveAdultHandoffRawHistory: true })`
3. `appendAdultHandoffPrompt` + `SceneContinuityPacket`
4. `runStream` / `assemblePrimaryRpRequest` with `provider: "cheaperinference"`, `adultRoute: true`
5. DeepSeek Gemini→adult handoff adds `applyDeepSeekAdultHandoffTrueOff` (`thinking.type=disabled` + `reasoning_effort=none`)
6. GLM 5.2 is **not** the refusal fallback. It is DeepSeek hard-failure fallback only (`runGlmHardFailureFallback`).

This harness reuses that fallback context path for both models. It does not persist chat, deduct points, mutate memory, or change `AdultDeliveryPlan`.

## Parameter adapters (unavoidable differences recorded)

| | GLM-5.3 | DeepSeek V4 Pro 0813 |
|---|---|---|
| Provider | CheaperInference | CheaperInference |
| Temperature | `0.7` (`EURYALE_GENERATION_PARAMS`; GLM 5.3 is not a DeepSeek adapter target) | `0.92` (`resolveDeepSeekTemperatureForTarget`) |
| max_tokens | omitted (provider default) | omitted (provider default) |
| Thinking | no dedicated adapter; generic CI `reasoning_effort: "none"` | `thinking: { type: "disabled" }` |
| Adult handoff TRUE-OFF | not applied (`resolveDeepSeekAdultHandoffTrueOff` is DeepSeek-target only) | applied (`reasoning_effort: "none"` in addition to thinking disabled) |
| OpenRouter `top_p` / frequency / presence | not added | added then **stripped** by `adaptCheaperInferenceChatBody` |
| `isGlmModel("glm-5.3")` | **false** in current source (matches `glm-5.2` / `z-ai/glm*` / `*/glm-*` only) | n/a |
| DeepSeek XML / extras in `buildContext` | off | on when modelId is DeepSeek V4 Pro |

No silent compensation. Differences are left as-is.

## Character fixture

```text
CHARACTER_ID: 6
CHARACTER_NAME: 밤의 비서실장
IN_PROMPT_CHARACTER_NAME: 서이레
CHARACTER_PUBLIC_OR_DEPLOYED_STATUS: public/approved
CHARACTER_CONTEXT_SOURCE: production /data/app.db characters.id=6 (read-only Railway exec)
NSFW: 1
ADULT_STATUS: confirmed
ADULT_CONSENT_MODES_JSON: ["standard"]
CHARACTER_CNC_OPT_IN_ALLOWED: false
USER_PERSONA_ID_OR_AUDIT_LABEL: AUDIT_ADMIN_ADULT_PERSONA_F1
USER_PERSONA_IS_ADMIN_TEST_FIXTURE: true
USER_PERSONA_NAME: 한시우
```

Selected because it is the only public+approved+`nsfw=1`+`adult_status=confirmed` deployed adult RP character. Definition was not shortened. Private H4Mina / H3 canary / private 서이레 clones were not used.

No public deployed character has `cnc_opt_in` in `adult_consent_modes_json`. F3/F4 therefore request CNC and include the production CNC opt-in regex in current input, then keep the **production-resolved** consent mode (`standard`). That incompatibility is recorded; the character was not rotated.

## Run status

```text
PROVIDER_BAKEOFF_BLOCKED: false
F1:
  GLM_HTTP: 200
  DEEPSEEK_HTTP: 200
COMPLETED_FIXTURES: F1 F2 F3 F4 F5 F6
PROVIDER_CALLS:
  GLM: 6
  DEEPSEEK: 6
  TOTAL: 12
RAW_COMPLETE: true
RAW_FILES:
  data/adult-fallback-bakeoff-glm53-vs-deepseek/raw/F1-glm53.txt
  data/adult-fallback-bakeoff-glm53-vs-deepseek/raw/F1-deepseek.txt
  data/adult-fallback-bakeoff-glm53-vs-deepseek/raw/F2-glm53.txt
  data/adult-fallback-bakeoff-glm53-vs-deepseek/raw/F2-deepseek.txt
  data/adult-fallback-bakeoff-glm53-vs-deepseek/raw/F3-glm53.txt
  data/adult-fallback-bakeoff-glm53-vs-deepseek/raw/F3-deepseek.txt
  data/adult-fallback-bakeoff-glm53-vs-deepseek/raw/F4-glm53.txt
  data/adult-fallback-bakeoff-glm53-vs-deepseek/raw/F4-deepseek.txt
  data/adult-fallback-bakeoff-glm53-vs-deepseek/raw/F5-glm53.txt
  data/adult-fallback-bakeoff-glm53-vs-deepseek/raw/F5-deepseek.txt
  data/adult-fallback-bakeoff-glm53-vs-deepseek/raw/F6-glm53.txt
  data/adult-fallback-bakeoff-glm53-vs-deepseek/raw/F6-deepseek.txt
METRICS_COMPLETE: true
ACTUAL_COST_AVAILABLE:
  GLM: true
  DEEPSEEK: true
REFUSAL_DETECTOR_COUNTS:
  GLM: 0
  DEEPSEEK: 0
VISIBLE_PROVIDER_META_COUNTS:
  GLM: 0
  DEEPSEEK: 0
F5_EFFECTIVE_COAUTHOR_MODE: FULL
F5_GLM_USER_PERSONA_DIALOGUE_PRESENT: YES
F5_GLM_USER_PERSONA_DIALOGUE_PRESENT_NOTE: human RAW review correction of detector false-negative; RAW unchanged
F5_GLM_USER_PERSONA_ACTION_PRESENT: yes
F5_DEEPSEEK_USER_PERSONA_DIALOGUE_PRESENT: no
F5_DEEPSEEK_USER_PERSONA_ACTION_PRESENT: yes
F6_GLM_IMMEDIATE_CONTINUATION: yes
F6_DEEPSEEK_IMMEDIATE_CONTINUATION: yes
SOURCE_PRODUCTION_FILES_CHANGED: 0
QUALITY_SCORE_ASSIGNED: false
MODEL_WINNER_SELECTED: false
HUMAN_RAW_REVIEW_REQUIRED: true
```

No retries. No extra samples. No winner. No fallback change.

## True CNC disputed fixture (this turn)

Read-only production search found **0** characters whose `adult_consent_modes_json` includes `cnc_opt_in`. The only public/approved/`nsfw=1`/`adult_status=confirmed` character remains id 6 `밤의 비서실장` with `["standard"]`.

```text
CHARACTER_CNC_OPT_IN_ALLOWED: false
EFFECTIVE_CONSENT_MODE cannot be proven as cnc_opt_in
PROVIDER_CALLS_THIS_TURN: 0
TRUE_CNC_PAIR_RUN: false
F1_F2_F5_F6_RERUN: false
STOP_REASON: no deployed public character allows cnc_opt_in
```

See `CNC_CHARACTER_SEARCH.md` / `cnc-character-search.json`.
