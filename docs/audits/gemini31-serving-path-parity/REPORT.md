# FINAL REPORT — Gemini 3.1 Pro serving-path parity

## EXACT MAIN

`63ffa76e21a6f8cb88e31cc43c6378e87d3e8059` (GPT-confirmed)

## EXACT HEAD

Branch `cursor/gemini31-serving-parity-bf59` (investigation commits only)

## BEHIND_MAIN

At start: **3 commits behind** `origin/main` (`844d146c`) — official-supply proof launcher only; Gemini length/serving owners unchanged.

## OWNER MAP

| Concern | Owner |
|---|---|
| Main RP Gemini registry | `chatModels.ts`: CI `gemini-3.1-pro-preview`; OR `google/gemini-3.1-pro-preview` |
| CheaperInference adapter | `cheaperInferenceConfig.ts` → `reasoning_effort=low`, strips `reasoning`/`thinking` |
| OpenRouter direct | `openRouterClient.ts` + `openRouterConfig.ts` |
| Gemini reasoning | `OPENROUTER_RP_REASONING_GEMINI_3_PRO` effort=`low` (not OFF) |
| Temperature | `GEMINI_PRO_GENERATION_PARAMS.temperature=0.95` |
| Prompt assembly | `contextBuilder` + `assemblePrimaryRpRequest` (frozen once) |
| Response model capture | stream final chunk `.model` / `.provider` + non-secret headers |
| Reasoning usage | `completion_tokens_details.reasoning_tokens` → `REPORTED` \| `UNREPORTED` (never coerce missing→0) |

OR provider pin slug (docs + endpoints API): **`google-ai-studio`** with `allow_fallbacks=false`.

OR dated slug `google/gemini-3.1-pro-preview-20260219`: **not a separate catalog id**; endpoints resolve to rolling id; endpoint display names already show `…-20260219`.

Credential note: env `OPENROUTER_API_KEY` returns chat **401 User not found** (models GET still 200). Phase1 B/C used `OPENROUTER_JEV_BENCHMARK_API_KEY`. Secrets not logged.

## FROZEN PROMPT HASH

Current production-equivalent `quiet_intimacy`:

`727818ba432127062d9642c63f1027c99f32a721b964d57a6630604cf3938599`

- USER_TAIL current: yes ×1
- COMMON PROSE: yes
- NARRATIVE_DENSITY live: **no**
- Prompt tokens ≈ **5064–5070**

## PHASE 1 — same prompt, different serving path (n=3)

Invariants held: `provider_calls=1`, `temperature=0.95`, reasoning low, `max_tokens` omitted.

### ARM A — CI preview

| run | visible | prompt | completion | reason state | reason tok | finish | returned model | latency ms |
|---|---|---|---|---|---|---|---|---|
| 1 | 2351 | 5064 | 5313 | REPORTED | 3828 | stop | `gemini-3.1-pro-preview` | 46727 |
| 2 | 3687 | 5064 | 7888 | REPORTED | 5612 | stop | `gemini-3.1-pro-preview` | 65113 |
| 3 | 1691 | 5064 | 3755 | REPORTED | 2681 | stop | `gemini-3.1-pro-preview` | 35044 |

**Distribution:** median **2351**, mean **2576**, max 3687 (1× ≥3200)

No `modelVersion` / flash-lite field in response metadata. CI headers expose `x-ci-request-id` only.

### ARM B — OR rolling / AI Studio

| run | visible | prompt | completion | reason state | reason tok | finish | returned model | provider | cost USD | latency |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1345 | 5070 | 3512 | REPORTED | 2685 | stop | `google/gemini-3.1-pro-preview` | Google AI Studio | 0.052 | 33178 |
| 2 | 1575 | 5070 | 3557 | REPORTED | 2570 | stop | `google/gemini-3.1-pro-preview` | Google AI Studio | 0.053 | 33915 |
| 3 | 634 | 5070 | 1425 | REPORTED | 1022 | stop | `google/gemini-3.1-pro-preview` | Google AI Studio | 0.027 | 13534 |

**Distribution:** median **1345**, mean **1185**, max 1575 (0× ≥2700)

### ARM C — OR dated-20260219 / AI Studio

| run | visible | prompt | completion | reason state | reason tok | finish | returned model | provider | cost USD | latency |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2045 | 5070 | 3831 | REPORTED | 2537 | stop | `google/gemini-3.1-pro-preview` | Google AI Studio | 0.056 | 39579 |
| 2 | 2629 | 5070 | 4792 | REPORTED | 3161 | stop | `google/gemini-3.1-pro-preview` | Google AI Studio | 0.068 | 47090 |
| 3 | 1609 | 5070 | 3758 | REPORTED | 2746 | stop | `google/gemini-3.1-pro-preview` | Google AI Studio | 0.055 | 33482 |

**Distribution:** median **2045**, mean **2094**, max 2629 (0× ≥2700)

Returned model for C is **rolling slug**, not dated — dated request aliases.

### Phase 1 decision

| Case | Result |
|---|---|
| A CI short / OR longer | **NO** — CI mean/median **higher** than OR |
| B rolling short / dated longer | Weak C>B only; neither restores 3k+ |
| C AI Studio long / CI short | **NO** — opposite |
| D all similarly short | **YES** (modal under-length; noisy; no clean serving separation) |

**No confirmed model substitution** (no flash-lite / alternate `modelVersion` in returned metadata).

## optional VERTEX

**Not run** — AI Studio pin already executed; CI was not the uniquely short path.

## HISTORICAL FULL-PROMPT RESULT (Phase 2, Case D)

Historical commit: `692d2e97` (parent of Sep-17 `bbb8cad1`)  
Historical frozen hash: `f2181ff350a05b06ed863a3d67f679f7a8aab21580a2291220c5ac48080c6ac6`  
(old generative USER_TAIL; density still not live; full system/agency/tail assembly from that tree)

Same CI route, n=3:

| run | visible | completion | reason | returned model |
|---|---|---|---|---|
| 1 | 621 | 1857 | 1457 REPORTED | `gemini-3.1-pro-preview` |
| 2 | 549 | 1665 | 1316 REPORTED | `gemini-3.1-pro-preview` |
| 3 | 469 | 1174 | 879 REPORTED | `gemini-3.1-pro-preview` |

**HIST median 549 / mean 546** — **shorter than current CI**, not a recovery.

→ Recent local full-prompt regression is **substantially less likely** as the sole explanation of today’s under-length.

## PRODUCTION-SIZE CONTEXT

**Not run** — serving parity already characterized (~5k); no route restored long distribution; budget stop.

## QUALITY OBSERVATIONS (occurrence only)

- Under-length: dominant on B/C/HIST; A mixed
- Agency violations: 0 heuristic hits on successful A/B/C samples reviewed
- No evidence of flash-lite-capability collapse unique to one route
- Layout: successful samples retain `\n\n` dialogue/narration spacing

## PRODUCTION DIFF

**0** — benchmark/audit scripts + docs only. No picker/provider/pricing/prompt/reasoning/retry/continuation/fallback/cache changes.

## FINAL CLASSIFICATION

**ROOT_CAUSE_UNCONFIRMED**

Ruled-out / weakened for *this* fixture+budget:

- `CI_SERVING_PATH_CANDIDATE` — CI not uniquely short vs AI Studio OR
- `ROLLING_PREVIEW_DRIFT_CANDIDATE` — dated request aliases to rolling; C not materially long
- `GOOGLE_ENDPOINT_VARIANCE_CANDIDATE` — not indicated by AI Studio vs CI pattern
- `LOCAL_FULL_PROMPT_REGRESSION_CANDIDATE` — historical full prompt still short (worse) on today’s CI

Forum flash-lite routing remains an **external lead only** — not proven on our traffic (returned model strings stay preview; no `modelVersion` evidence).

## STOP

Per protocol: serving routes similarly fail to restore 3k+ distribution; no metadata proof of substitution; production mutation not warranted. **STOP.**
