# FINAL REPORT — Gemini 3.1 temperature 0.95 vs vendor default

## EXACT MAIN

`a8c343fc4b9f3bb1180d628707aa87218e77433b`

## EXACT HEAD

`cursor/gemini31-temperature-default-bf59` (investigation commits)

## BEHIND_MAIN

0 at branch creation (matched GPT-confirmed main).

## OWNER MAP

| Concern | Owner |
|---|---|
| `GEMINI_PRO_GENERATION_PARAMS` | `openRouterClient.ts` `{ temperature: 0.95 }` |
| Who consumes 0.95 | `normalizeOpenRouterGenerationParams` when `isGeminiProOpenRouterModel` / `isGemini31ProModel` (`id.includes("gemini-3.1-pro")`) |
| Gemini 3.7 Flash | Separate path (`isCheaperInferenceGemini37FlashModel`); **not** Gemini Pro temperature consumer |
| CI reasoning adapt | Preview → `reasoning_effort=low`; bare `gemini-3.1-pro` would default to `none` unless explicitly set (harness forced `low`) |
| Model registry / billing / cache | Unchanged |

## FROZEN PROMPT HASH

`727818ba432127062d9642c63f1027c99f32a721b964d57a6630604cf3938599`  
(`quiet_intimacy`, identical across A/B/C)

## A PREVIEW 0.95

| run | visible | completion | reason | share | finish | returned |
|---|---|---|---|---|---|---|
| 1 | 3569 | 6027 | 3828 REPORTED | 0.635 | stop | preview |
| 2 | 1981 | 4316 | 3062 REPORTED | 0.709 | stop | preview |
| 3 | 591 | 1711 | 1332 REPORTED | 0.778 | stop | preview |
| 4 | 1768 | 3673 | 2570 REPORTED | 0.700 | stop | preview |
| 5 | 2106 | 2490 | 1208 REPORTED | 0.485 | stop | preview |

**median 1981 · mean 2003 · low-tail&lt;1500: 1 · ≥2700: 1 · ≥3200: 1**  
temperature field: **0.95** (present). cache_tokens=4573 all runs. provider_calls=1 each.

## B PREVIEW DEFAULT (temperature OMITTED)

| run | visible | completion | reason | share | finish | returned |
|---|---|---|---|---|---|---|
| 1 | 627 | 1980 | 1578 REPORTED | 0.797 | stop | preview |
| 2 | 508 | 1332 | 995 REPORTED | 0.747 | stop | preview |
| 3 | 1525 | 3792 | 2841 REPORTED | 0.749 | stop | preview |
| 4 | 1258 | 2502 | 1745 REPORTED | 0.697 | stop | preview |
| 5 | 2305 | 3975 | 2524 REPORTED | 0.635 | stop | preview |

**median 1258 · mean 1245 · low-tail&lt;1500: 3 · ≥2700: 0 · ≥3200: 0**  
Request body meta proves **`temperature` key absent**.

## C CI `gemini-3.1-pro` DEFAULT

- Request: model=`gemini-3.1-pro`, temperature OMITTED, `reasoning_effort=low`
- Result: **STOP C** — HTTP 503 `No compatible route completed this request.`
- No usable length distribution (empty/failed). Per protocol: **do not invent alternative reasoning**; STOP C.

## RAW / LOW-TAIL / THRESHOLDS

| Arm | median | mean | &lt;1500 | ≥2700 | ≥3200 |
|---|---|---|---|---|---|
| A | 1981 | 2003 | 1/5 | 1/5 | 1/5 |
| B | 1258 | 1245 | **3/5** | 0/5 | 0/5 |
| C | — | — | STOP | — | — |

## REASONING SHARE / COST / LATENCY / CACHE

- Reasoning: **REPORTED** on all successful A/B calls; shares ~0.49–0.80 (still large)
- Cost: null in CI usage payload this run
- Latency: A ~16–52s; B ~14–38s
- Cache: `cached_tokens=4573` stable on A/B

## RETURNED MODEL METADATA

- A/B returned `gemini-3.1-pro-preview` (matches request)
- No flash-lite / alternate `modelVersion` field
- C failed before usable completion

## QUALITY OCCURRENCES

- User dialogue / major choice-action invented: **0** on A/B
- Catastrophic short (&lt;1500): A=1, B=3
- No agency regression signal favoring B

## SECOND GATE

**Not run** — B did not beat A.

## ROOT CAUSE CLASSIFICATION

**ROOT_CAUSE_UNCONFIRMED**

- Not `LEGACY_TEMPERATURE_OVERRIDE_INTERACTION` — omitting temperature **worsened** median and low-tail vs 0.95
- Not `CI_3_1_PRO_MODEL_CONTRACT` — C unusable (503); stop before production consideration

## SYSTEM DELTA

**PRODUCTION DIFF = 0**

Investigation only: `scripts/gemini31-temperature-default-bisect.ts` + `docs/audits/gemini31-temperature-default-bisect/**`

## PRESERVED

- provider_calls=1 · reasoning_effort=low · max_tokens omitted · prompt/agency/prose/billing/routing unchanged · Gemini 3.7 untouched

## PROOF

Artifacts under `docs/audits/gemini31-temperature-default-bisect/` and `/opt/cursor/artifacts/gemini31-temperature-default-bisect/`  
Per-arm `request-body-meta.json` proves B/C omit temperature.

## STOP

B does not materially beat A; catastrophic short tail worse on B; C only-path requires model/pricing change and failed. **STOP.**
